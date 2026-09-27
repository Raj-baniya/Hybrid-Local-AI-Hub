# Prompt: Fix Automation Engine + Add Dedicated Agent Chat UI
### (Hybrid Local AI Hub — grounded in `AutonomousSystemController.json` screenshots)

## Context / workflow under test
`AutonomousSystemController.json`:
`Schedule (trigger_node, cron */30 * * * *)` → three parallel nodes `ListProcessesNode (proc_node)`, `GetMemoryUsageNode (mem_node)`, `GetCpuUsageNode (cpu_node)` → `Template Formatter (merge_node)` → `Ollama LLM (ai_planner, llama3.2)` → `Conditional Router (router)` → True: `Template Formatter (format_log)` → `File Writer (save_log, system_alert_log.txt, append)` → `Desktop Notification (alert_notify)`; False: `Desktop Notification (all_good_notify)`.

## Problem 1 — Data isn't actually flowing through the connected nodes (root cause found)
The graph edges *are* drawn correctly (dashed lines visibly link every node), so this isn't a rendering/wiring problem — it's a data-substitution bug. The output popup shows the `merge_node` template being sent to the LLM still containing **unresolved placeholders**:
```
CPU Usage: {cpu_node}%
Memory Usage: {mem_node}%
Top Processes: {proc_node}
```
`{cpu_node}`, `{mem_node}`, `{proc_node}` were never replaced with the real output of `GetCpuUsageNode`, `GetMemoryUsageNode`, and `ListProcessesNode`. The LLM then correctly (and unhelpfully) replies that it can't see any real data.

**Fix:**
- In the `Template Formatter` node's execution step, confirm it receives the *resolved output* of each upstream node it references, keyed by that node's ID (`cpu_node`, `mem_node`, `proc_node`), before string-substituting them into the template.
- Add a check: if a placeholder has no matching upstream output at merge time, fail loudly (log an error / mark the node "Error") instead of silently passing the literal `{placeholder}` text downstream.
- Add a unit test: run `merge_node` with mock upstream outputs and assert the rendered template contains no `{...}` placeholders.

## Problem 2 — Automation runs in an infinite loop instead of stopping at task completion
The `Schedule` node is cron-driven (`*/30 * * * *`), which is fine — but the run must still terminate cleanly at the end of *each* triggered execution (reach the End of that run's graph, i.e. one of `alert_notify` / `all_good_notify`), and must not keep re-executing nodes within a single run.

**Fix:**
- Replace the current loop with a bounded run per trigger: `while (task_not_complete) { execute_next_ready_node() }`, where "complete" = no more ready nodes / a terminal node (`alert_notify`, `all_good_notify`) was reached.
- Add a hard safety cap (max node executions or wall-clock time) that force-stops a run and reports `max_steps_exceeded` if it never reaches a terminal node — this catches accidental cycles instead of hanging forever.
- Expose the termination reason per run: `completed`, `max_steps_exceeded`, `stopped_by_user`, `error`.

## Problem 3 — Pause/Stop doesn't actually stop the agent
Clicking Stop/Pause (top-right controls, confirmed present in both the paused and running screenshots) updates the button state but the backend keeps running.

**Fix:**
- Stop must cancel the in-flight run via a real cancellation token checked between every node execution, cancel any in-flight Ollama call, and kill any spawned subprocess — then confirm the backend task has actually exited before the UI reports "stopped."
- Stop must also cancel the *next* scheduled cron trigger, not just the current run — otherwise the Schedule node fires again 30 minutes later even though the user stopped the automation.
- Pause should suspend at the next safe checkpoint (after the current node finishes, before the next starts), not kill mid-node.

## Problem 4 — Replace the output modal with a dedicated offline chat UI
Currently, output renders as a **modal dialog overlaying the whole canvas** (see screenshot: a popup box with raw concatenated log text — the unresolved-template LLM reply, the router decision, the notification line — and a single "Close" button blocking the graph underneath).

**Fix:** when an agent capable of accessing/altering device documents is run, open a **separate, persistent chat UI** instead of this modal:
- Its own window or clearly separated panel — never an overlay blocking the canvas.
- Standard chat layout: scrollable message list + input box + streaming responses, like ChatGPT/Claude/Gemini.
- Each node's output becomes one chat message (e.g. `[ai_planner] ...`, `[router] routed: all_good_notify`, `[all_good_notify] Notification sent: System Health`) instead of one dumped block of text.
- Persists chat history per automation/session locally; fully offline, all inference via the local Ollama backend.

## Problem 5 — Remove the current "save output" logic
Whatever currently persists this modal's text should be deleted, not patched — replace it with the chat UI's own message store from Problem 4. Agent output should never be written through the old save-output path again.

## Acceptance Criteria
- [ ] Rendering `merge_node`'s template with real upstream data produces a fully-substituted string — no literal `{cpu_node}` / `{mem_node}` / `{proc_node}` ever reaches the LLM.
- [ ] A single triggered run executes each ready node once and stops at a terminal node — verified by termination-reason logging, not just visual inspection.
- [ ] Clicking Stop cancels the current run *and* the next scheduled cron trigger; verified via logs/process state.
- [ ] Running `AutonomousSystemController.json` opens a separate persistent chat window showing each node's output as its own message, with history preserved across runs.
- [ ] The old output modal and save-output path are gone from the codebase.

---

## How to improve this prompt further
- **Confirm the exact node ID → template key mapping** you intend (is it always the upstream node's ID, like `cpu_node`, or a separate named output?) — spelling this out removes any remaining ambiguity for the agent.
- **Decide what "Error" should look like** for node/UI purposes when a placeholder can't resolve — a red node state? a chat message? Define it before the agent implements Problem 1's fix.
- **Confirm cron cancellation semantics** — should Stop cancel just the next trigger, or disable the schedule entirely until manually restarted? This changes Problem 2/3's implementation.
- **Split into two implementation passes** if handing to Antigravity one command at a time: Problems 1–3 (execution/data bugs) first, then 4–5 (new chat UI) — they touch different parts of the codebase and are easy to verify independently.
- Attach these three screenshots directly to the ticket/prompt so the agent can see the exact modal and node layout rather than relying on this written description alone.
