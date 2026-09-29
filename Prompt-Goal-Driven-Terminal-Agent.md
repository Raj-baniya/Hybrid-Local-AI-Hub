## Protocol (same as every prior prompt)

One step, one `RUN THIS:` command, then stop and wait. Human replies `go`/`continue`/`next`/`done`, or pastes the error. You never run commands yourself. Never claim a step is done without the human's confirmation word. No placeholder logic, no `unwrap()`/`expect()` on anything fallible, no API key literal in any tracked file. Do not modify the existing offline pipeline executor, chat-to-graph compiler, or node code except where a step below says so.

---

## What we are building

1. `hybrid-hub agent` — a **goal-driven agent loop** for the terminal. It works on a task until the task is verifiably done, then stops by itself. It must never just repeat the whole process forever.
2. A **"Load in Terminal"** button in the GUI that opens a real terminal window and starts a saved agent with that command.

## Design principles for the loop

- The agent's state is simply the history of actions taken and what was observed after each one. Every turn, the model sees that history and picks exactly one next action.
- The loop ends only through an explicit exit action — never by silently running out of ideas. There are two exits: "I believe the task is done" and "I cannot make progress, here's why." Both are deliberate choices the model makes, not something inferred from its behavior.
- A model claiming the task is done is **not proof** that it's done. Small local models claim success incorrectly fairly often. So the claim must always be checked against concrete, predefined success criteria before the loop is allowed to actually stop. If the check fails, the specific failing criteria get fed back to the model as feedback, and the loop continues — counted against a small limit so a model that keeps falsely claiming success eventually triggers a hard stop instead of looping forever.
- "It ran without producing an error" and "it actually did what the user wanted" are two different things, and the second one usually can't be confirmed just by retrying — it needs an explicit, checkable definition of done, decided before the work starts.
- Every retry-style step (planning, generation, verification) has a hard cap on attempts. No loop in this feature is allowed to be unbounded.
- Keep the system prompt short and the tool list small — a short, focused prompt with few tools produces much more reliable behavior from small local models than a long prompt with many options.
- Long command output must never be dumped in full into the model's context — it needs to be truncated/paginated, since small local models have limited context windows (a fresh check with the user's own installed model showed a 4096-token context, which is easy to blow past with raw file or command output).
- For models that don't reliably support native tool-calling (most small local models don't), have the model emit a simple structured text format for its chosen action, and parse that — don't depend on Ollama's function-calling being reliable here.

## What the design above does NOT solve on its own — extra safeguards needed

- Trusting the model's own success claim is not enough by itself — a verifier step is required (see above).
- A step-by-step loop can still stall — repeating the same action, making no measurable progress, or producing unparseable output over and over. All three need explicit detection, separate from the step cap.
- Since this agent runs real shell commands, it needs safety tiers (auto-approve safe reads, ask before destructive actions, hard-block genuinely dangerous ones) — this is a general engineering practice for any agent with shell access, not optional polish.

---

## The stop logic (implement exactly this)

The loop ends in **exactly one** of these ways, and always prints which one:

| Stop reason | Trigger | Exit code |
|---|---|---|
| `Success` | All success criteria verified as passing | 0 |
| `NotResolved` | Model calls `case_not_resolved(reason)` | 1 |
| `MaxSteps` | Step cap reached | 2 |
| `Stalled` | Same action+observation seen 3 times, OR no criteria progress for `patience` steps (default 6), OR 3 unparseable outputs in a row | 2 |
| `FalseClaimLimit` | Model claimed done, verifier said no, more than `max_false_claims` times (default 2) | 2 |
| `Timeout` | Wall-clock limit reached (default 10 min) | 2 |
| `BudgetExceeded` | Online mode only: token/request budget hit | 2 |
| `UserInterrupt` | Ctrl+C | 130 |

Two rules that make it "stop when done, not loop":

1. **Early success detection.** After every executed step, run the cheap deterministic criteria checks. If all pass, stop immediately with `Success`. Do not wait for the model to notice it finished.
2. **A claim is not a stop.** `case_resolved` only triggers verification. If verification fails, the failing criteria are fed back to the model as feedback ("you said done, but criterion c2 failed: <detail>") and the loop continues, counted against `max_false_claims`.

---

## STEP 1 — Add an optional `goal` block to the workflow schema

Backward compatible: workflows without it keep working exactly as today.

```json
"goal": {
  "task": "Organize every PDF in ./inbox into folders by year",
  "success_criteria": [
    { "id": "c1", "description": "inbox has no loose .pdf files", "check": { "type": "command_exit_zero", "command": "…" } },
    { "id": "c2", "description": "a 2024 folder exists", "check": { "type": "dir_exists", "path": "./inbox/2024" } }
  ],
  "limits": { "max_steps": 15, "timeout_secs": 600, "patience": 6, "max_false_claims": 2 },
  "working_dir": "./inbox"
}
```

Allowed `check.type` values: `file_exists`, `dir_exists`, `file_contains` (`path`, `text` or `regex`), `command_exit_zero` (`command`), `output_contains` (`text`, checked against the last command output), `llm_judge` (`question`). Put a `#[serde(default)]` on `goal` in `schema.rs`, add the same optional field to `graphSchema.ts`, and make `validate` check that every criterion has a valid check type.

→ `RUN THIS:` `cargo build --release`
→ Human confirms it builds and that an old workflow JSON (no `goal`) still validates. Replies `go` or pastes the error.

## STEP 2 — Tool layer and action parser (`src/agent/tools.rs`)

Tools the agent may call (keep the set small — this genuinely improves reliability): `run_command`, `read_file`, `write_file`, `list_dir`, and optionally `run_graph(path)` which executes a saved workflow once and returns its per-node result summary. Plus two exits: `case_resolved(summary)` and `case_not_resolved(reason)`.

The model must reply with **exactly one** action, in a simple structured text format:

```
<function=run_command>
<parameter=command>dir C:\Users\me\inbox</parameter>
</function>
```
```
<function=case_resolved>
<parameter=summary>Moved 14 PDFs into year folders.</parameter>
</function>
```

Write `parse_action(raw) -> Result<Action, String>`. The parser must tolerate surrounding prose and markdown fences, reject zero or multiple `<function=…>` blocks with a specific error message (this message is fed back to the model), and never panic.

→ `RUN THIS:` `cargo test agent_parser` (write unit tests: valid action, action inside prose, two actions, unknown tool, missing parameter, empty output).
→ Human confirms tests pass. Replies `go` or pastes the failure.

## STEP 3 — Safety hooks (`src/agent/hooks.rs`)

This agent can run shell commands on the user's machine. Before every tool execution, classify the call:

- `Deny`: blocked patterns (recursive delete of a drive/root/home, format/disk tools, registry edits, `curl|sh`-style pipes, anything writing outside `working_dir`). Feed the denial reason back to the model as an observation.
- `Ask`: anything that deletes, overwrites, moves files, or installs software. Print the exact command and require `y/N` in the terminal.
- `Allow`: read-only commands and reads/writes inside `working_dir`.

Flag `--yes` auto-approves `Ask` for that session only. It must never be the default and never persisted. `Deny` can never be overridden by `--yes`.

→ `RUN THIS:` `cargo test agent_hooks` (tests: `rm -rf /`, `del /s /q C:\`, a write outside `working_dir`, a normal `dir`, a file move).
→ Human confirms. Replies `go` or pastes the failure.

## STEP 4 — Observation manager (`src/agent/observations.rs`)

Small local models have small context (the user's own installed model showed a 4096-token context window when checked). Implement:
- Truncate every observation to `obs_limit` characters (default 2000), keeping head and tail with a `[... N chars omitted ...]` marker, so the model can ask for a specific portion via a targeted `read_file`/`run_command` re-query.
- History compaction: when the rendered prompt exceeds ~70% of the context budget, replace the oldest steps with a one-line-per-step summary. Never drop the goal, the criteria, or the last 3 steps.
- Set `options.num_ctx` explicitly in the Ollama request instead of relying on the default; make it configurable and mention RAM cost in a comment.

→ `RUN THIS:` `cargo test agent_observations`
→ Human confirms. Replies `go` or pastes the failure.

## STEP 5 — Completion verifier (`src/agent/verifier.rs`)

`verify(criteria, ctx) -> VerifyResult { all_passed, results: Vec<CriterionResult{id, passed, detail}> }`.

- Deterministic checks (`file_exists`, `dir_exists`, `file_contains`, `command_exit_zero`, `output_contains`) run locally, with a per-check timeout, and never panic. `command_exit_zero` goes through the same safety hooks as any other command.
- `llm_judge` is the fallback only when no deterministic check is possible. The judge prompt must include the **actual evidence** (the file excerpt or command output), not just the model's summary, and must answer only `PASS` or `FAIL: <reason>`. Mark its result `low_confidence` in the final report — semantic correctness genuinely can't be confirmed with full certainty by an LLM judging itself, so keep this the exception, not the default.
- `verify_deterministic(...)` runs only the deterministic subset. The loop calls this after every step for early success detection.

→ `RUN THIS:` `cargo test agent_verifier` (tests use temp directories: criteria pass, criteria fail with a clear `detail`, a command that hangs hits the timeout).
→ Human confirms. Replies `go` or pastes the failure.

## STEP 6 — Contract planning (`src/agent/contract.rs`)

If the workflow has no `goal` (or the user passes `--task "..."`), generate one before the loop starts: one LLM call that returns the `goal` JSON above, validated and repaired with the same bounded retry (max 3 rounds, feeding back the exact error). Then **show the criteria to the user and ask for confirmation** (`y/N/edit`) before any command runs. If planning fails after 3 rounds, ask the user to type a done-condition, or fall back to `llm_judge`-only with `max_steps` halved. Never start the loop without at least one criterion.

→ `RUN THIS:` `cargo test agent_contract`
→ Human confirms. Replies `go` or pastes the failure.

## STEP 7 — The loop controller (`src/agent/runner.rs`)

Reference implementation. Adapt names to the codebase, but keep the control flow and every stop condition.

```rust
pub async fn run_agent(cfg: AgentConfig, llm: &dyn LlmProvider, tools: &ToolBox, hooks: &Hooks)
    -> Result<AgentReport, AgentError>
{
    let contract = plan_or_load_contract(&cfg, llm).await?;
    let mut state = AgentState::new(&contract);
    let start = Instant::now();
    let (mut false_claims, mut parse_errors, mut best_passed, mut no_progress) = (0, 0, 0usize, 0);
    let mut seen: HashMap<u64, u32> = HashMap::new();

    for step in 1..=contract.limits.max_steps {
        if interrupted() { return Ok(report(StopReason::UserInterrupt, &state)); }
        if start.elapsed() > contract.limits.timeout { return Ok(report(StopReason::Timeout, &state)); }

        let raw = llm.generate(&state.render_prompt(), Some(SYSTEM_PROMPT)).await
            .map_err(AgentError::Llm)?;

        let action = match parse_action(&raw) {
            Ok(a) => { parse_errors = 0; a }
            Err(e) => {
                parse_errors += 1;
                if parse_errors >= 3 { return Ok(report(StopReason::Stalled, &state)); }
                state.push_feedback(format!("Your last reply was invalid: {e}. Reply with exactly one <function=...> block."));
                continue;
            }
        };

        match action {
            Action::CaseNotResolved { reason } => return Ok(report(StopReason::NotResolved(reason), &state)),

            Action::CaseResolved { summary } => {
                let v = verify(&contract.criteria, &state).await;
                if v.all_passed { return Ok(report_with(StopReason::Success, &state, v)); }
                false_claims += 1;
                if false_claims > contract.limits.max_false_claims {
                    return Ok(report_with(StopReason::FalseClaimLimit, &state, v));
                }
                state.push_feedback(v.failure_feedback(&summary)); // names each failing criterion + detail
            }

            Action::Tool(call) => {
                match hooks.pre(&call).await {
                    HookDecision::Deny(msg)  => { state.push_feedback(format!("Blocked: {msg}")); continue; }
                    HookDecision::Ask        => if !ask_user(&call) { state.push_feedback("User declined that command.".into()); continue; },
                    HookDecision::Allow      => {}
                }
                let obs = truncate(tools.execute(&call).await, contract.limits.obs_limit); // errors become text, never panics
                let key = hash_pair(&call, &obs);
                let n = seen.entry(key).and_modify(|c| *c += 1).or_insert(1);
                if *n >= 3 { return Ok(report(StopReason::Stalled, &state)); }
                state.push_step(step, call, obs);

                // early success detection: stop as soon as the work is verifiably done
                let v = verify_deterministic(&contract.criteria, &state).await;
                if v.all_passed && v.has_criteria { return Ok(report_with(StopReason::Success, &state, v)); }

                let passed = v.passed_count();
                if passed > best_passed { best_passed = passed; no_progress = 0; } else { no_progress += 1; }
                if no_progress >= contract.limits.patience { return Ok(report(StopReason::Stalled, &state)); }
            }
        }
    }
    Ok(report(StopReason::MaxSteps, &state))
}
```

The `SYSTEM_PROMPT` must be short: state the goal, list the criteria, list the tools with the exact action format, and say: *"Take one action per reply. When you believe every criterion is met, call `case_resolved`. If you cannot make progress, call `case_not_resolved` with the reason. Do not repeat an action that already gave the same result."*

→ `RUN THIS:` `cargo test agent_runner`. Use a **scripted fake `LlmProvider`** so tests need no Ollama. Required tests (each asserts the exact `StopReason` and that the step count is bounded):
1. Task finishes in 3 steps → `Success`, stops at step ≤ 4 with no extra steps.
2. Fake model repeats the same command forever → `Stalled` within 3 repeats.
3. Fake model never calls an exit and makes no progress → `Stalled` at `patience`, never runs to `max_steps`.
4. Fake model claims `case_resolved` with unmet criteria → verifier rejects, then `FalseClaimLimit`.
5. Fake model outputs garbage 3 times → `Stalled`.
6. Fake model calls `case_not_resolved` → `NotResolved`, exit code 1.
7. A blocked command is denied, fed back, and the loop continues.
8. Criteria already satisfied after step 1 → `Success` immediately (early detection).

→ Human confirms all 8 pass. Replies `go` or pastes the failure.

## STEP 8 — CLI command (`src/cli/agent.rs`)

`hybrid-hub agent <workflow.json>` or `hybrid-hub agent --task "..."`, flags `--yes`, `--max-steps`, `--timeout`, `--json`.

- Live output per step: step number, the action, a truncated observation, and a one-line criteria status (`3/5 criteria passing`).
- Final report always shows: stop reason in plain words, steps used, a criteria pass/fail table (mark `llm_judge` results as low confidence), and files created or changed.
- Exit codes exactly as in the stop table. Ctrl+C is handled gracefully and prints the report.
- Uses the `LlmProvider` from the mode switch: offline mode → the installed Ollama model, online mode → the configured cloud providers with fallback. Offline mode must make zero cloud calls.
- Add `agent` to the bare `hybrid-hub` help and `hybrid-hub examples`.

→ `RUN THIS:` `cargo build --release`, then run a real 2-step task against the real local model, e.g. `hybrid-hub agent --task "Create a file hello.txt in ./sandbox containing the word hello"`.
→ Human confirms it created the file **and stopped on its own** without extra steps, and pastes the final report. Replies `go` or pastes what happened.

## STEP 9 — "Load in Terminal" button (GUI)

Tauri command in `src-tauri/src/commands.rs`. Two important details: the button must find the `hybrid-hub` binary itself (use the executable next to the app, or a Tauri sidecar) rather than assuming it is on `PATH`, and quoting differs per OS.

```rust
#[tauri::command]
pub fn cmd_load_in_terminal(agent_path: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?
        .parent().ok_or("no exe dir")?.join(if cfg!(windows) { "hybrid-hub.exe" } else { "hybrid-hub" });
    let exe = exe.to_string_lossy().to_string();
    let display_cmd = format!("\"{exe}\" agent \"{agent_path}\"");

    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("cmd")
        .args(["/C", "start", "Hybrid Hub Agent", "cmd", "/K", &display_cmd]) // 3rd arg is the window title
        .spawn();

    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("osascript")
        .args(["-e", &format!("tell application \"Terminal\" to do script \"{}\"",
            display_cmd.replace('\\', "\\\\").replace('"', "\\\""))])
        .spawn();

    #[cfg(target_os = "linux")]
    let r = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"].iter()
        .find_map(|t| std::process::Command::new(t)
            .args(if *t == "gnome-terminal" { vec!["--", "sh", "-c", &display_cmd] } else { vec!["-e", &display_cmd] })
            .spawn().ok())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no terminal found"));

    r.map(|_| ()).map_err(|e| format!("Could not open a terminal ({e}). Run this yourself:\n{display_cmd}"))
}
```

Add the button to the Saved Agents panel and the top bar. If the command returns an error, show the exact command in a copyable box. Never fail silently. The terminal window must stay open after the agent finishes so the user can read the final report.

→ `RUN THIS:` build/run command.
→ Human clicks the button on a saved agent and confirms a real terminal opens, the agent runs, and the window stays open at the end. Replies `go` or pastes what happened.

## STEP 10 — Real-world proof

→ `RUN THIS:` three real runs, in this order, with the real local model:
1. An easy task (create a file with given content) → must stop by itself at `Success`.
2. An impossible task (e.g. "read C:\definitely\missing\file.txt and summarize it") → must stop with `NotResolved` or `Stalled`, never `MaxSteps` after burning every step.
3. A vague task with no clear finish ("make my folder nicer") → the contract step must force the user to confirm concrete criteria before anything runs.

→ Human pastes the three final reports. Antigravity checks each stop reason against the expectation above and fixes any run that ended for the wrong reason. Replies `go` when all three end correctly.

---

## Rules

1. One step, one `RUN THIS:` command, then wait.
2. The loop must be impossible to run forever: every path through `run_agent` either returns a `StopReason` or is bounded by `max_steps`. If you find a path that isn't, that is a bug to fix before anything else.
3. A model's claim of success never ends the loop by itself. Only the verifier or an explicit failure exit does.
4. `--yes` is opt-in per session and never overrides `Deny`.
5. If the same step fails 3 times, add diagnostics instead of guessing. After 5 failures, stop and report using the STUCK format from the master checklist.

## Done condition

```
Step 1:  [VERIFIED / STILL BROKEN] — goal block in schema, old workflows unaffected
Step 2:  [VERIFIED / STILL BROKEN] — action parser
Step 3:  [VERIFIED / STILL BROKEN] — safety hooks
Step 4:  [VERIFIED / STILL BROKEN] — observation manager
Step 5:  [VERIFIED / STILL BROKEN] — verifier
Step 6:  [VERIFIED / STILL BROKEN] — contract planning with user confirmation
Step 7:  [VERIFIED / STILL BROKEN] — loop controller, all 8 tests
Step 8:  [VERIFIED / STILL BROKEN] — `hybrid-hub agent` stops by itself on a real task
Step 9:  [VERIFIED / STILL BROKEN] — Load in Terminal button
Step 10: [VERIFIED / STILL BROKEN] — three real runs end for the right reasons
```
