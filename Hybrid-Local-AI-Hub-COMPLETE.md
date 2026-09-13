# Hybrid Local AI Hub — Complete Package (Plan + Addendum + Master Prompt)

Paste this entire file to Antigravity as one document. It contains, in order:
1. The full phase-by-phase implementation plan (CLI core)
2. The addendum: dual interface (CLI + GUI canvas/chat) + human-in-the-loop execution protocol
3. The master prompt instructing how the agent should operate

---

# Hybrid Local AI Hub — Agent Implementation Plan (v1.0)
### For execution by an AI coding agent (e.g. Antigravity). Follow phases strictly in order. Do not skip a phase's acceptance checks.

---

## How to use this document (read first)

This plan is written so a coding agent can execute it autonomously, phase by phase, without human clarification mid-task. Each phase has:
- **Goal** — what "done" means
- **Delete** — files/folders that must be removed (leftovers from the earlier Tauri/React prototype)
- **Create/Modify** — exact files to write
- **Acceptance check** — a concrete, runnable test the agent must pass before moving to the next phase
- **Stop condition** — do not proceed past this phase if the acceptance check fails; fix it first

The end product is a **single Rust binary CLI application**, not a GUI, not a prototype. Every command must work against real user input in real time — the LLM must generate genuinely new workflow graphs from whatever the user describes, not select from a fixed set of canned examples. Templates (Phase 8) are starting points a user can copy and modify, never the ceiling of what the tool can produce.

---

## Phase 0 — Clean Slate & Repo Setup

**Goal:** Remove all leftover GUI-era code and establish the new Rust-only project skeleton.

**Delete** (if present from the earlier Tauri/React attempt):
- `src/` (entire React source tree)
- `src-tauri/` (Tauri shell — note: keep `src-tauri/src/executor.rs`, `ollama.rs`, `chroma.rs`, `watcher.rs` *only if* they already contain working logic worth porting; otherwise delete and rewrite fresh in Phase 2)
- `package.json`, `package-lock.json`, `node_modules/`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`
- `index.html`
- Any `.tsx`, `.jsx` files anywhere in the repo
- `tauri.conf.json`

**Create/Modify:**
1. Run `cargo init --name hybrid-local-ai-hub` at repo root (or `cargo new` if starting in an empty directory).
2. `Cargo.toml` — add dependencies:
   ```toml
   [dependencies]
   clap = { version = "4", features = ["derive"] }
   tokio = { version = "1", features = ["full"] }
   serde = { version = "1", features = ["derive"] }
   serde_json = "1"
   reqwest = { version = "0.12", features = ["json", "stream"] }
   notify = "6"
   lopdf = "0.32"
   crossterm = "0.27"
   indicatif = "0.17"
   uuid = { version = "1", features = ["v4"] }
   chrono = "0.4"
   anyhow = "1"
   thiserror = "1"
   dirs = "5"
   zip = "1"
   sysinfo = "0.30"
   ```
   (`zip` supports Phase 7.5's export/import bundles; `sysinfo` supports Phase 4's RAM-aware model warnings.)
3. `LICENSE` — MIT text.
4. `CONTRIBUTING.md` — brief contribution guide.
5. `.github/workflows/ci.yml` — build matrix: `ubuntu-latest`, `windows-latest`, `macos-latest`; run `cargo build --release` and `cargo test` on each.
6. `.gitignore` — standard Rust gitignore (`/target`, `Cargo.lock` for a binary crate should actually be **committed**, not ignored).

**Acceptance check:** `cargo build` succeeds with zero errors/warnings on a totally empty `main.rs` (just `fn main() {}`). `git status` shows no leftover `.tsx`/`.jsx`/`package.json` files anywhere in the tree.

**Stop condition:** Do not proceed to Phase 1 until the repo contains only Rust + config/CI files.

---

## Phase 1 — Native Schema & Validation

**Goal:** Port the workflow graph schema to native Rust structs — this is the single source of truth every other phase depends on.

**Create:**
- `src/schema.rs` containing:
  - `NodeType` enum (`FileWatcherNode`, `TextInputNode`, `ImageInputNode`, `OllamaSelectorNode`, `LocalEmbedderNode`, `PDFExtractorNode`, `ChromaDbStoreNode`, `ConditionalRouterNode`, `LocalFileWriterNode`) — `#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]`, `#[serde(tag = "type")]` internally-tagged so each variant carries its own config fields directly (Rust's equivalent of the Zod discriminated union).
  - Per-variant config fields exactly as specified in the earlier schema design (watch path/pattern/recursive for FileWatcher; model/temperature/promptTemplate for OllamaSelector; etc.) — **including the `inputMap` field on `ChromaDbStoreNode`** to support multi-input binding (this was an identified gap — fix it now, don't carry the gap forward): `input_map: Option<HashMap<String, String>>` mapping named inputs (e.g. `"vector"`, `"document"`) to `"node_id.output"` references.
  - `GraphNode { id: String, position: Option<(f64, f64)>, data: NodeType }` — position is optional/unused in CLI mode but kept for forward JSON-compatibility if a GUI is ever added later.
  - `GraphEdge { id: String, source: String, source_handle: Option<String>, target: String, target_handle: Option<String> }`
  - `Graph { version: u32, nodes: Vec<GraphNode>, edges: Vec<GraphEdge> }`
- `src/validate.rs`:
  - `validate_graph(graph: &Graph) -> Result<(), Vec<String>>` — checks structural validity, that every edge references a real node id, that every `{{node_id.output}}` reference in any string field points at a real ancestor node (walk the graph, don't just regex-check existence).
  - `would_create_cycle(nodes: &[GraphNode], edges: &[GraphEdge], candidate: (&str, &str)) -> bool` — DFS cycle check, ported directly from the earlier TypeScript logic.
- `tests/schema_tests.rs` — unit tests: valid graph parses; missing required field fails with a specific error; edge referencing nonexistent node fails; cycle is detected; the gym-automation example graph (fan-out + conditional router reconverging at one node) parses and validates cleanly.

**Acceptance check:** `cargo test schema_tests` passes, covering at minimum: valid-graph-passes, invalid-node-fails, dangling-edge-fails, cycle-detected, gym-example-validates.

**Stop condition:** Do not proceed until every test above passes and `cargo clippy` reports no warnings on `schema.rs`/`validate.rs`.

---

## Phase 2 — Execution Engine

**Goal:** A fully working, UI-agnostic execution engine, tested completely headless.

**Create:**
- `src/executor.rs` — Kahn's algorithm topological sort producing execution layers; `tokio::spawn` for same-layer nodes to run concurrently; per-node timeout (configurable, default 120s for `OllamaSelectorNode`, 10s otherwise); halt-on-failure by default with an opt-in continue-independent-branches mode (see the runtime spec's failure-policy section for exact rules).
- `src/interpolation.rs` — resolves `{{input}}` (only valid when a node has exactly one incoming edge — hard error otherwise, forcing explicit `{{node_id.output}}`) and `{{node_id.output}}`; validated at compile time before execution starts, not discovered mid-run.
- `src/ollama.rs` — async REST client: `generate()` (streaming, with `format: "json"` mode support for the chat compiler in Phase 5), `embeddings()`, `list_models()`, `pull_model()` (streamed progress).
- `src/chroma.rs` — REST client: `create_collection`, `upsert`, `query`.
- `src/watcher.rs` — wraps `notify`; exposes an async stream of file-change events for the `--watch` execution mode.
- `src/execution_record.rs` — `ExecutionRecord` struct (execution_id, graph_id, trigger_source, timestamps, overall_status, per-node `NodeRecord` list with status/timing/output_preview/error) serialized to `~/.hybrid-hub/logs/<execution_id>.json`.

**Acceptance check:** Write integration tests using a mock/local Ollama instance if available in CI, otherwise unit-test the executor's scheduling logic with stub async functions standing in for real Ollama/ChromaDB calls (inject via trait objects so real network calls aren't required for `cargo test`). At minimum: fan-out nodes run concurrently (assert via timing or call-order instrumentation), a failing node halts downstream-dependent nodes but not independent branches when that mode is enabled, cycle graphs are rejected before any node runs.

**Stop condition:** Do not proceed until the executor passes its scheduling tests without requiring a live Ollama/ChromaDB connection (those get exercised for real in Phase 3's manual end-to-end check).

---

## Phase 3 — CLI Command Layer

**Goal:** A working `clap`-based CLI exposing every command from the earlier command surface design, tested end-to-end against a real local Ollama instance.

**Create:**
- `src/main.rs` — `clap::Parser`-derived top-level CLI with subcommands.
- `src/cli/run.rs` — `hybrid-hub run <path> [--watch] [--json]`
- `src/cli/validate.rs` — `hybrid-hub validate <path>`
- `src/cli/models.rs` — `hybrid-hub models list` / `hybrid-hub models pull <name>`
- `src/cli/logs.rs` — `hybrid-hub logs <execution_id>`
- `src/cli/init.rs` — `hybrid-hub init` (checks Ollama/ChromaDB reachability on localhost, offers to pull default models)

**Output requirements (do not skip — this replaces the old GUI's error surfacing):**
- Colored, human-readable output by default (`crossterm`): node name, status icon, timing, truncated output preview as each node completes.
- `--json` flag on every command for machine-readable output.
- `validate` must produce specific, actionable errors — e.g. `"llm1.promptTemplate references {{nonexistent.output}} — no node with id 'nonexistent' exists"`, never a generic parse failure.

**Help system (do not rely on clap's bare auto-generated `--help` alone — a first-time user needs runnable examples, not just a flag list):**
- Give every subcommand a `clap` `after_help` block with 2–3 copy-pasteable example invocations, not just flag descriptions. E.g. for `run`:
  ```
  EXAMPLES:
    hybrid-hub run workflow.json                # run once
    hybrid-hub run workflow.json --watch         # keep running, re-trigger on file events
    hybrid-hub run workflow.json --json          # machine-readable output
  ```
- Add a top-level `hybrid-hub help` / bare `hybrid-hub` with no args that prints a short "getting started" block covering the whole flow in order: `init` → `chat "<instruction>"` → `run <generated file>` → `logs <execution_id>` — so a brand-new user sees the full path in one screen, not just a command list.
- Add `hybrid-hub examples` as its own dedicated command (not just `--help` text) that prints a longer curated set of real example instructions for `chat` (including the gym-automation one from this project) alongside their matching `run` commands — a quick-reference a user can return to any time without re-reading full help text.

**Manual real-world acceptance check (must be done with actual local Ollama running, not mocked):**
1. Hand-write one real workflow JSON (2–3 nodes, e.g. TextInput → OllamaSelector → LocalFileWriter).
2. `hybrid-hub validate that.json` → passes.
3. `hybrid-hub run that.json` → actually calls a real local Ollama model, writes a real output file, prints a clean success report.
4. Intentionally break the JSON (bad node type) → `validate` reports the specific, correct error.
5. `hybrid-hub` with no arguments and `hybrid-hub examples` both print genuinely useful, runnable guidance — verify by having someone unfamiliar with the tool follow only that output and successfully run a workflow.

**Stop condition:** Do not proceed until step 3 above genuinely produces a real file with real LLM-generated content on disk — not a mocked/simulated success. This is the first point in the plan where "not a prototype" is actually verified end-to-end.

---

## Phase 4 — Model & Service Management

**Goal:** Smooth first-run experience — a user with a completely bare machine should be able to run one command and end up ready to go, with no manual Ollama installation steps required unless they choose to do it themselves.

**Create:**
- `src/cli/init.rs` with a layered detection flow:

  **Step 1 — Is the `ollama` binary installed at all?**
  Check via `which ollama` (or `where ollama` on Windows) / attempt to run `ollama --version`. This is distinct from "is the service running" — a user might have it installed but not started.

  **Step 2 — If not installed, offer to auto-install it.** Prompt the user (default: yes):
  ```
  Ollama is not installed on this system.
  Install it automatically now? [Y/n]
  ```
  - **Linux / macOS:** run the official install script (`curl -fsSL https://ollama.com/install.sh | sh`), shelled out via `std::process::Command`. Stream its output to the terminal so the user sees real progress, not a frozen prompt.
  - **Windows:** there is no unattended silent-install script equivalent — either shell out to `winget install Ollama.Ollama` if `winget` is available, or, if not, print the direct download URL (`https://ollama.com/download/windows`) and pause, asking the user to install manually and press Enter to continue. Do not attempt to silently download and execute an arbitrary `.exe` yourself — that's the one case where handing off to the user is the right call for both correctness and trust.
  - If the user declines auto-install, print the same manual instructions and exit cleanly (non-zero exit code, clear message) rather than proceeding into a broken state.

  **Step 3 — Is the Ollama service actually running?** (installed ≠ running) Check `http://localhost:11434`. If installed but not running, print the exact command to start it (`ollama serve`, or note that on macOS/Windows the desktop app auto-starts it) and offer to start it directly via `Command::new("ollama").arg("serve").spawn()` in the background if appropriate for the platform.

  **Step 4 — Model check.** Once the service is confirmed reachable, check `ollama list` output against the recommended defaults. If `llama3.2` and `nomic-embed-text` aren't present, pull them automatically with a progress bar — this part was already in the plan, kept as-is.

  **Step 5 — ChromaDB check.** Same reachability pattern against the configured ChromaDB URL; ChromaDB has no equivalent one-line auto-install (it's a `pip install chromadb` + `chroma run`), so print exact setup instructions rather than attempting to auto-install a Python package — auto-installing into an arbitrary Python environment is a legitimate place *not* to automate, since it can silently break other things on the user's machine.

### Recommended default Ollama models for 8GB RAM systems

Based on current (2026) benchmarks, an 8GB machine running CPU-only inference through Ollama should stay at 3–4B parameter models at Q4 quantization, which use roughly 2–5GB of RAM and leave headroom for the OS and the rest of your app. A 7B model at Q4 quantization uses roughly 4–5GB, which is workable but leaves little margin — prefer 3–4B models as the safer default.

| Purpose | Recommended model | Why |
|---|---|---|
| **Default general-purpose / chat-to-graph compiler** | `llama3.2` (3B) | Described as the most versatile all-rounder for 8GB RAM, running through Ollama at Q4 quantization with no GPU required — well-tested, good instruction-following for structured JSON output. |
| **Fastest option / low-end machines** | `phi4-mini` (3.8B) | Benchmarked as the fastest option for 8GB RAM at roughly 28 tokens/sec, a strong choice if generation speed matters more than raw capability. |
| **Best reasoning within 8GB budget (for the chat compiler specifically, if `llama3.2` struggles with your prompt complexity)** | `qwen3:4b` | Identified as the best-reasoning option in the 8GB tier — reasoning quality matters directly for reliably producing valid structured graphs from ambiguous instructions. |
| **Fastest/lightest fallback for very constrained machines** | `gemma2:2b` | A 2B model noted as the fastest option for basic tasks when even 3B models are too slow on a given machine. |
| **Embeddings (for `LocalEmbedderNode`/ChromaDB)** | `nomic-embed-text` | Small (~270MB), purpose-built for embeddings, negligible RAM impact alongside a chat model. |

**Default `hybrid-hub init` behavior end-to-end on a totally bare machine:** detect Ollama missing → offer auto-install → install → detect service not running → start it → detect models missing → pull `llama3.2` and `nomic-embed-text` automatically (single recommended combination covering both generation and embeddings); mention `phi4-mini` and `qwen3:4b` as alternate `--model` choices in help text, not pulled by default (avoid forcing extra downloads on first run beyond the one recommended model).

**Practical guidance to bake into the tool itself:** when a user's machine has 8GB or less, `hybrid-hub init` should detect available system RAM (via a crate like `sysinfo`) and warn if they attempt to pull anything above ~4B parameters, since models up to 3–7B parameters in 4-bit quantization are the practical ceiling for comfortable operation on 8GB systems.

**Acceptance check:**
1. On a machine/container with **no Ollama installed at all**, `hybrid-hub init` detects this, installs Ollama (Linux/macOS path), starts the service, pulls `llama3.2` and `nomic-embed-text`, and reports readiness — genuinely zero manual steps for the user on those platforms.
2. On a machine with Ollama installed but not running, `init` detects and starts it without re-installing.
3. On a machine already fully set up, `init` detects that and exits immediately reporting "already ready" — must not re-run installs/pulls needlessly every time.

**Stop condition:** Do not proceed until scenario 1 above works against a genuinely clean environment, not a pre-provisioned one — this is the actual test of "zero setup burden."

---

## Phase 5 — Chat-to-Graph Compiler (the core "not a prototype" requirement)

**Goal:** Real, general-purpose natural-language-to-workflow generation. This must handle **arbitrary user instructions**, not a fixed set of examples. The gym-automation prompt used earlier in this project is a *test case*, never a hardcoded special path in the code.

**Create:**
- `src/translator_prompt.rs`:
  - Programmatically derive the JSON Schema of `Graph`/`NodeType` from the Rust structs (either via a `schemars`-derived export, or a hand-maintained function that must be updated whenever `schema.rs` changes — pick one and add a `cargo test` that fails if they drift apart).
  - Embed that literal schema plus 2–3 full worked examples (instruction → correct graph) in the system prompt.
  - Enumerate the closed node-type vocabulary explicitly, even though it's also in the schema.
- `src/cli/chat.rs`:
  - `hybrid-hub chat "<any user instruction>" [-o output.json] [--edit existing.json]`
  - Calls `ollama.rs::generate()` with `format: "json"`, low temperature (0.1–0.3).
  - Parses the result against `schema.rs`; on failure, feeds the model its own output plus the specific validation error(s) and asks for a targeted fix; allow up to 3 repair rounds.
  - If all rounds fail, print the last attempt, the specific validation errors, and exit non-zero — never silently fall back to a template or a canned graph.
  - `--edit` mode: load the existing graph as context, apply the same generate→validate→repair loop to produce a modified graph, print a clear diff of what changed before writing.
  - **On successful generation, print a "what now" summary before exiting** — do not just silently write the file. This is a first-time-user requirement, not optional polish:
    ```
    ✓ Workflow saved to: gym_intake.json

    This workflow: watches ./gym_intake, extracts PDF text, generates a plan,
    routes on goal type, embeds + stores the profile, writes the final plan.

    Next steps:
      hybrid-hub validate gym_intake.json      # double-check before running
      hybrid-hub run gym_intake.json           # run it once
      hybrid-hub run gym_intake.json --watch   # keep it running (this graph has a FileWatcherNode)
      hybrid-hub export gym_intake.json -o gym_intake_bundle.zip   # to share it
    ```
    The specific suggested commands should be generated dynamically from the graph's actual contents — e.g. only suggest `--watch` if a `FileWatcherNode` is actually present; if the graph has no trigger node requiring a long-running process, don't suggest it.

**Critical correctness requirement — real-time generation, not canned responses:** Do not implement this by pattern-matching keywords in the user's instruction to pre-built graph templates. The only acceptable implementation is: user instruction → LLM call → schema-validated output. Verify this by testing with instructions that were never discussed anywhere in this project's history (e.g. a completely unrelated domain — invoice processing, a recipe-suggestion pipeline, a customer-support ticket triager) and confirming the tool produces a coherent, schema-valid, *novel* graph for each, not a near-duplicate of the gym example.

**Acceptance check (must all pass against a real local Ollama call, no mocking):**
1. The gym-automation prompt from earlier in this project produces a valid graph using at least 6 of the 9 node types.
2. Two entirely new, previously-unseen instructions (pick domains unrelated to gym/fitness) each produce distinct, schema-valid graphs appropriate to their instructions.
3. A deliberately ambiguous or underspecified instruction still produces *some* valid graph (the compiler should make reasonable assumptions, not fail outright, matching the "should work in real time" requirement) or, if genuinely unresolvable, exits with a clear message about what's missing rather than a malformed graph.
4. `--edit` on an existing graph correctly modifies only what was asked and leaves the rest of the graph intact.
5. The post-generation "what now" summary correctly reflects each test graph's actual contents — e.g. `--watch` is suggested only when the graph genuinely contains a `FileWatcherNode`, not printed unconditionally.

**Stop condition:** Do not consider this phase complete until item 2 above is verified with prompts you did not write in advance as part of this plan — write them fresh, at implementation time, specifically to stress-test generality.

---

## Phase 6 — Iterative Refinement (`chat --edit`)

Already specified as part of Phase 5's `--edit` mode above — no separate deliverable, but keep as a distinct testing milestone:

**Acceptance check:** Starting from the gym-automation graph, run three sequential `--edit` calls each making one small change ("add a step that also sends an email notification" [note: this will correctly fail if there's no email node type — verify it fails clearly rather than inventing a node type outside the closed vocabulary], "change the LLM model to phi4-mini", "add a second file watcher for a different folder"). Confirm the graph remains valid after each step and unrelated parts are untouched.

---

## Phase 7 — Structured Logs

**Create:**
- `src/cli/logs.rs` — `hybrid-hub logs <execution_id>`: pretty-prints the stored `ExecutionRecord`, per-node status table with timings and truncated outputs/errors.
- `--json` output mode for scripting.

**Acceptance check:** Run a real workflow via `run`, then `logs <that_execution_id>` correctly reproduces its per-node history from disk.

---

## Phase 7.5 — Export & Import (Portable Agent Bundles)

**Goal:** A generated workflow must be a genuinely shareable, downloadable artifact — not just a bare `.json` file that silently assumes the recipient has the exact same models and services set up.

**Why this matters:** a raw graph JSON references model names (`llama3.2`), ChromaDB collection names, and local file paths (`watchPath`, `outputPath`). Handed as-is to someone else, it will either fail to run or silently misbehave (wrong model pulled, wrong folder watched). An export needs to carry that context with it.

**Create:**
- `src/cli/export.rs` — `hybrid-hub export <workflow.json> -o <bundle.zip>`
  - Validates the workflow first (refuse to export something broken).
  - Scans the graph and builds a `manifest.json` recording:
    - every distinct Ollama model referenced (from `OllamaSelectorNode.model` / `LocalEmbedderNode.model` fields)
    - every ChromaDB collection name referenced
    - the tool version the graph was created with, and the graph's own `version` field
    - any absolute local file paths used (`watchPath`, `outputPath`, etc.) — flagged in the manifest as "machine-specific, review before running," since these won't exist on the recipient's machine
  - Packages `workflow.json` + `manifest.json` + a short auto-generated `README.md` (plain-English description of what the workflow does, derived from its node list) into a single `.zip` at the given output path — this zip is the "download."
- `src/cli/import.rs` — `hybrid-hub import <bundle.zip> [-o extracted.json]`
  - Unpacks the bundle, runs `validate` on the contained workflow.
  - Prints the manifest: required models (with pull status — installed vs. missing), required ChromaDB collections, and a clear warning listing any machine-specific paths that need updating before running.
  - Offers to `ollama pull` any missing required models on the spot (reusing Phase 4's pull logic).
  - Writes the workflow JSON to disk at the requested path, ready to `run` once paths are adjusted.

**Acceptance check:**
1. `hybrid-hub export gym_intake.json -o gym_intake_bundle.zip` produces a real zip file containing all three components.
2. On a separate clean machine/directory (simulating a different user), `hybrid-hub import gym_intake_bundle.zip` correctly reports which required models are missing, correctly pulls them when confirmed, and correctly flags the machine-specific `watchPath`/`outputPath` fields as needing review.
3. After adjusting the flagged paths, the imported workflow passes `validate` and runs successfully.

**Stop condition:** Do not consider export "done" until a workflow genuinely round-trips through export → import → run on a second, independently clean environment — this is the real test of "downloadable," not just that a zip file gets created.

---

## Phase 8 — Starter Templates

**Create:**
- `templates/` directory with 3–5 real, tested `.json` workflows (gym intake processor as one of them, since it's already validated).
- `hybrid-hub template list` / `hybrid-hub template use <name> -o <path>`.

**Important:** these exist purely as *editable starting points* — explicitly state in `--help` text and README that `chat` can generate anything within the node vocabulary, templates are just convenience shortcuts for common cases, not the limit of what the tool does.

**Acceptance check:** Every shipped template passes `hybrid-hub validate` and actually runs successfully end-to-end against real local services.

---

## Phase 9 — Optional TUI Dashboard (stretch, do only after Phases 0–8 are solid)

`ratatui`-based live view for `run --watch` sessions — active executions, per-node status, scrollable log pane. Skip if time-constrained; does not block a real-world-usable v1.

---

## Phase 10 — Cross-OS Hardening & Release

1. Test path handling and `notify` behavior separately on Windows, macOS, Linux (path separators, permission models, and `notify` backend differences are real cross-platform risks).
2. Confirm CI produces a working release binary per OS on tagged releases.
3. Final README: install instructions ("download the binary for your OS" or `cargo install`), Ollama/ChromaDB setup, the model table from Phase 4, full command reference.
4. Tag `v1.0.0` only after every phase's acceptance check has been re-run once, end to end, on a clean machine/VM with nothing pre-installed except Ollama.

**Final stop condition before calling this "done":** a person with a clean machine, 8GB RAM, no prior setup, should be able to: install Ollama, download your binary, run `hybrid-hub init`, then `hybrid-hub chat "<their own real automation idea, not one from this document>"`, and get a working, valid, executable workflow — with no code changes, no manual JSON editing, and no internet access beyond the initial Ollama model pull.

---

## Cleanup Discipline (apply throughout, not just Phase 0)

At the end of **every** phase, before moving to the next:
1. Run `cargo clippy --all-targets -- -D warnings` and fix everything it flags.
2. Run `cargo fmt` for consistent style.
3. Delete any scratch/debug files, commented-out old code, or unused `#[allow(dead_code)]` stubs left over from that phase's development.
4. Confirm `cargo build --release` succeeds with zero warnings before committing.

This keeps the repo in a genuinely shippable state at every checkpoint, rather than accumulating cruft that only gets cleaned up at the very end.
-e 

---


# Addendum — Dual Interface + Human-in-the-Loop Execution

Applies on top of `Agent-Implementation-Plan-v1.md`. Read both together.

---

## 1. Architecture change: CLI stays, GUI comes back

**Shared core (unchanged, built once):** `schema.rs`, `executor.rs`, `ollama.rs`, `chroma.rs`, `watcher.rs`, `interpolation.rs`, `translator_prompt.rs`. Zero duplication — both interfaces call into this same Rust engine.

**Two front-ends on top of it:**
- **CLI** (`hybrid-hub run/chat/validate/...`) — exactly as planned, unchanged.
- **GUI** (Tauri + React + `@xyflow/react`) — manual drag-and-drop canvas + chat panel, talking to the same core via Tauri IPC commands (`run_graph`, `list_models`, etc., thin wrappers around the Rust functions the CLI already uses).

**New phases, inserted after Phase 8 (Starter Templates), before Phase 9 (TUI):**

- **Phase 8.5 — Tauri Shell:** `tauri init` inside the existing repo (adds `src-tauri/` alongside current `src/` Rust lib — restructure `main.rs` logic into a `lib.rs` the Tauri binary and CLI binary both depend on). `commands.rs` exposes `run_graph`, `validate_graph`, `list_models`, `pull_model`, `chat_generate`, `chat_edit`, `save_workflow`, `load_workflow`.
- **Phase 8.6 — Manual Canvas:** React + TypeScript + `@xyflow/react`. Port `schema.rs`'s node types to a matching Zod schema (`graphSchema.ts`) for frontend validation — mirror, not source of truth (Rust stays canonical). 9 node components, DFS cycle rejection on edge-connect, Dagre auto-layout, multi-tab workspace (Zustand), native save/load (`@tauri-apps/plugin-dialog`).
- **Phase 8.7 — Chat Panel (GUI):** Reuses `translator_prompt.rs` and the repair loop via `chat_generate`/`chat_edit` IPC calls — no new prompt logic, just a UI wrapping the same backend the CLI's `chat` command uses. "Load onto Canvas" button on successful generation.
- **Phase 8.8 — GUI Polish:** live node status highlighting via Tauri events during execution, log panel (same `ExecutionRecord` data the CLI's `logs` command reads), model manager panel (wraps `init`/`models` commands visually).

**Acceptance check for this block:** a workflow built manually on the canvas and a workflow generated via GUI chat both produce the exact same JSON shape the CLI can independently `validate`/`run` — prove interop by round-tripping a GUI-built file through the CLI and vice versa.

**Not a prototype, either interface:** both must run real local Ollama/ChromaDB calls end-to-end, same as the CLI's existing stop conditions — no mocked success in the GUI either.

---

## 2. Execution protocol change: agent proposes, human runs

**The coding agent must never execute shell commands itself.** For every step that requires running something (`cargo build`, `cargo test`, `npm install`, `tauri dev`, `ollama pull`, etc.):

1. Agent writes/edits the necessary files.
2. Agent outputs **only the exact command(s)** to run next, clearly marked, e.g.:
   ```
   RUN THIS:
   cargo build --release
   ```
3. Agent stops and waits.
4. Human runs it manually in their own terminal, then replies with one of:
   - `next` / `go` / `proceed` / `done` → command succeeded, agent continues to the next step.
   - the actual error output → agent diagnoses, fixes the code, and proposes the next command to re-run (repeat from step 2).

**No exceptions** — this applies through every phase, including acceptance checks. The agent proposes the verification command; the human runs it and reports the result back.

---

## 3. Quality bar (unchanged, restated)

Real working product, not a prototype: no `unwrap()` on fallible paths, real validation, real tests, real LLM calls at acceptance-check time (run by the human, per §2), GUI and CLI both fully functional and interoperable, not just one or the other.

## 4. Token discipline (unchanged from the master prompt)

Still applies: terse phase reports, no re-explaining the plan, batch file writes per phase, one command-proposal at a time rather than a long list — this keeps each human-confirmation round-trip small and fast.
-e 

---


# Master Prompt — Paste This to Antigravity (or any coding agent)

---

You are implementing **Hybrid Local AI Hub**, a Rust CLI application. The full implementation plan is attached/available at `Agent-Implementation-Plan-v1.md` — that document is your source of truth for architecture, phase order, exact files to create, models to recommend, and acceptance criteria. Do not deviate from its schema, node vocabulary, or phase ordering without a strong, stated reason.

## Operating constraints — read before starting

You have a **limited token budget**. Work as if every token costs real money, because it does. This changes how you should behave, not how much you should accomplish:

1. **Write code, not commentary.** Do not re-explain the plan back to me before implementing it. Do not narrate what you're about to do in prose before doing it — just do it, then report results tersely. I have already read the plan; I don't need it summarized.
2. **No filler acknowledgments.** Skip phrases like "Great, let's get started" or "I'll now proceed to implement." Go straight to tool calls and code.
3. **Batch your work.** Within a phase, write all the files that phase requires before pausing to report — don't create one file, explain it, create another file, explain it. One consolidated report per phase, not per file.
4. **Report progress in this exact compact format, nothing more, at the end of each phase:**
   ```
   Phase N: [DONE/BLOCKED] — <one line on what was built>
   Acceptance check: [PASS/FAIL] — <one line on how you verified it>
   Next: Phase N+1
   ```
   If something failed, state the specific error in one or two lines and your fix, not a full retrospective.
5. **Do not ask for permission between phases** unless the plan's stop condition genuinely fails and you cannot resolve it yourself after a reasonable attempt. Proceed autonomously through all phases in order. Only interrupt me for: (a) a stop condition that fails after your own reasonable debugging effort, (b) a genuine ambiguity in the plan that materially changes architecture, not a minor implementation detail — for minor details, make the most reasonable choice and note the assumption in one line, don't ask.
6. **No mocked or placeholder "success."** Every acceptance check in the plan that requires a real local Ollama/ChromaDB call must be run for real. Do not report a phase as done based on code that "should work" — run it.
7. **Clean as you go, not just at the end.** Follow the plan's per-phase cleanup discipline (`cargo clippy -D warnings`, `cargo fmt`, delete scratch/dead code) before reporting a phase complete — this prevents a large, expensive cleanup pass later that burns more tokens than doing it incrementally.
8. **If you're running low on budget mid-plan**, prioritize in this order and say so explicitly rather than silently truncating: Phase 0–3 (repo, schema, engine, CLI core) is non-negotiable — a broken foundation makes everything after it worthless. Phase 4–5 (model management, chat compiler) is the core value proposition — do not skip. Phase 6–8 (refinement, logs, export, templates) are valuable but can be left as a clearly marked TODO with exact remaining steps if budget runs out. Phase 9 (TUI) is optional — skip it first if budget is tight. Phase 10 (release hardening) can be summarized as a checklist for me to run manually if you can't complete it.

## Quality bar — non-negotiable regardless of budget

- No prototype-quality shortcuts: real error handling (no `unwrap()` on anything that can fail from user input or network calls — use `anyhow`/`thiserror` as specified in the plan), real validation, real tests.
- The chat-to-graph compiler must generalize to instructions never seen in this plan — verify this with genuinely new test prompts at implementation time, per Phase 5's stop condition.
- Every phase's acceptance check must actually pass before you move on. A skipped or fudged acceptance check compounds into a broken final product, which costs far more tokens to fix later than getting it right now.

## Start now

Begin at Phase 0. Work through the plan in order. Report using the compact format above after each phase. Do not stop to summarize the whole plan back to me — start building.
