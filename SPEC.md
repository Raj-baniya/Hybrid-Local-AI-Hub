# Build Spec: Hybrid Local AI Hub — Full System (Chat-to-Graph + Manual Canvas)

**Target tool:** Google Antigravity (agentic IDE)
**How to use this document:** Save this file as `SPEC.md` in the root of your workspace/repo before starting. Paste the "ANTIGRAVITY AGENT PROMPT" section (bottom of this file) into Antigravity as your task. Antigravity will re-read this file as it works rather than relying only on the prompt, so keep this file present throughout the build.

---

## 1. Scope of this build

This version builds the **complete dual system**:

- **Option 1 — Chat-to-Graph**: user describes a pipeline in plain English → a local LLM (via Ollama) converts it to a structured JSON graph → validated → rendered live on the canvas.
- **Option 2 — Manual Canvas**: user drags node cards from a palette onto an infinite canvas and wires them together by hand.
- **Shared execution engine**: regardless of which option produced the graph, clicking "Execute" runs the real pipeline — local inference, vector storage, conditional routing, file output — 100% offline.

Both options write to and read from the **same graph state** (Section 3), so a chat-generated graph can be manually edited afterward, and a manually-built graph can be described back in chat for AI-assisted tweaks (stretch goal, not required for v1 — acceptable to punt if time-constrained).

Out of scope for this build (flag clearly as future work, do not attempt):
- Multi-user / cloud sync of any kind
- Any node type beyond the palette in Section 5
- Fine-tuning or model management beyond selecting from locally installed Ollama models

---

## 1a. Open Source & Cross-Platform Requirements

This project is **open source** and must build and run natively on **macOS, Windows, and Linux** from the same codebase. Treat this as a hard constraint on every decision below, not an afterthought.

### License
- License the repo under **MIT** (default choice — permissive, simple, widely compatible with the crates/npm packages in Section 2). Include a `LICENSE` file at the repo root, and add SPDX headers or a license note in `README.md` and `package.json` / `Cargo.toml` (`license = "MIT"`).
- Every dependency pulled in (Rust crates, npm packages) must itself be permissively licensed (MIT/Apache-2.0/BSD). Flag and avoid anything GPL/AGPL-licensed, since that would force the whole project's license to change. ChromaDB itself (Apache-2.0) and Ollama (MIT) are both fine to depend on as external local services — this only applies to code actually compiled/bundled into the app.

### Cross-platform correctness
Tauri is cross-platform by design, but several specific choices need explicit care so the app doesn't quietly become Mac-only or Windows-only:

- **Never hardcode file paths.** Use Rust's `std::path::PathBuf` / `Path` everywhere (never manual string concatenation with `/` or `\`), and Tauri's `path` API (`app_handle.path()`) for resolving app-data, config, and temp directories per-OS.
- **Folder/file pickers** (`pick_folder`, `pick_image`) must use Tauri's official `dialog` plugin, which already abstracts native OS picker differences — do not shell out to OS-specific picker binaries.
- **File watching** via the `notify` crate is cross-platform (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows) — use it as-is, but test that watched-path behavior (especially symlinks and network drives) is at least sane on all three, and document any known OS-specific quirks in the README rather than silently special-casing.
- **ChromaDB sidecar process** (Section 6.4): the way you launch/kill a subprocess differs subtly across OSes (process groups, signal handling). Use Tauri's `shell` plugin's sidecar/command APIs rather than raw `std::process::Command` where possible, since the plugin handles cross-platform process lifecycle. Ship clear setup docs for installing ChromaDB (and Ollama) on each OS — these are external local dependencies the app cannot bundle, so first-run onboarding should detect if either is missing/unreachable and tell the user how to install it for their OS.
- **Ollama & GPU acceleration**: Ollama itself already abstracts CUDA (Windows/Linux) vs Metal (macOS) vs CPU fallback — the app should never try to detect or manage GPU backends itself. Just talk to Ollama's HTTP API and let it handle hardware.
- **Line endings / packaging**: add a `.gitattributes` normalizing line endings, and rely on Tauri's built-in bundler (`tauri build`) to produce the right native artifact per OS (`.dmg`/`.app` for macOS, `.msi`/`.exe` for Windows, `.deb`/`.AppImage`/`.rpm` for Linux) rather than any custom packaging scripts.

### CI: build and verify on all three OSes
Set up a GitHub Actions workflow (`.github/workflows/build.yml`) with a build matrix across `macos-latest`, `windows-latest`, and `ubuntu-latest`, running `npm install`, `cargo check`, and `npm run tauri build` on each. This is the actual proof the "works on any OS" requirement holds — a single-OS build passing locally is not sufficient. Failing CI on any one OS should block considering a milestone complete.

### Repo hygiene for open source
- `README.md` with: project description, screenshots/GIF once there's a UI, prerequisites (Ollama + ChromaDB install links per OS), build-from-source instructions per OS, and a link to the LICENSE.
- `CONTRIBUTING.md` with basic dev setup steps (matching the CI steps above) so external contributors can build on their own OS without guesswork.
- No secrets, API keys, or telemetry of any kind in the repo or the app — this is a fully local, fully open tool by design (also already required by Section 6/7's "no network calls leave localhost" rule).

---

## 2. Tech stack (pin these)

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2.x (Rust backend) |
| Frontend | React 18 + TypeScript + Vite |
| Canvas | `@xyflow/react` (React Flow v12+) |
| Auto-layout (chat-generated graphs only) | `dagre` |
| Local LLM runtime | Ollama, HTTP API at `http://localhost:11434` |
| Translator model | `llama3.2` or `qwen2.5` (text-only, fast, JSON-capable) |
| Vision model | user-selected, e.g. `llama3.2-vision`, `llava` |
| Embedding model | `nomic-embed-text` via Ollama |
| Vector store | ChromaDB, run locally (`chroma run` as a sidecar/companion process — see Section 6.4) |
| PDF parsing | Rust crate `pdf-extract` or `lopdf` for text extraction |
| File watching | Rust crate `notify` |
| Styling | Tailwind CSS |
| Schema validation | `zod` (TypeScript) |
| State management | Zustand (graph state, chat state, execution state) |
| Backend↔frontend live updates | Tauri event system (`emit` / `listen`) for streaming execution status and logs |

Antigravity should scaffold with `npm create tauri-app@latest` (React + TypeScript + Vite template), then layer the above on top.

---

## 3. Data contract: the JSON Graph Schema (shared by both options)

This schema is the single source of truth for both the chat translator and the manual canvas — every node either option creates must conform to it.

```typescript
// graphSchema.ts
import { z } from "zod";

export const NodeTypeEnum = z.enum([
  "file_watcher",
  "image_input",
  "text_input",
  "local_embedder",
  "chromadb_store",
  "ollama_selector",
  "conditional_router",
  "local_file_writer",
  "log_terminal",
]);

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeEnum,
  label: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()).optional(), // node-specific config
});

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  condition: z.string().optional(), // for conditional_router branches, e.g. "if_image"
});

export const GraphStateSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  meta: z.object({
    title: z.string(),
    generated_from_prompt: z.string().optional(), // present only if AI-generated
  }).optional(),
});

export type GraphState = z.infer<typeof GraphStateSchema>;
```

Per-node `data` conventions (used by both the palette's config inspector and the LLM translator):

| type | expected `data` fields |
|---|---|
| `file_watcher` | `{ watch_path: string }` |
| `image_input` | `{}` (populated at runtime with uploaded file path) |
| `text_input` | `{ default_text?: string }` |
| `local_embedder` | `{ model: "nomic-embed-text" }` |
| `chromadb_store` | `{ collection_name: string, mode: "read" \| "write" }` |
| `ollama_selector` | `{ model: string }` (e.g. `"llama3.2-vision"`) |
| `conditional_router` | `{ condition_type: "has_image" \| "has_text" \| "custom", expression?: string }` |
| `local_file_writer` | `{ output_path: string, format: "md" \| "txt" \| "json" }` |
| `log_terminal` | `{}` (read-only, receives streamed execution events) |

---

## 4. Option 1: Chat-to-Graph

### 4.1 System prompt for the translator model

Store as `src/lib/translatorSystemPrompt.ts`. Requirements:
- Output **only** raw JSON conforming exactly to `GraphStateSchema`.
- Only use node types from the fixed vocabulary above.
- Include 2–3 few-shot examples: a simple linear pipeline, and one with a `conditional_router` branch.
- Positions are rough left-to-right guesses (`x` incrementing ~250 per stage) — exact placement is recalculated by `dagre` auto-layout after parsing, so the model just needs correct sequence order.

### 4.2 Call pattern

Chat panel → Rust command `invoke("generate_graph", { prompt })` → Rust POSTs to `http://localhost:11434/api/generate` with the system prompt → returns raw text → frontend parses/validates with zod → on failure, retry once with a repair prompt ("Your last output was invalid JSON / failed schema. Return corrected JSON only.") → on second failure, surface the raw output in the Log Terminal and show an error toast, without crashing the canvas → on success, run `dagre` layout → commit to the shared Zustand graph store → React Flow re-renders.

---

## 5. Option 2: Manual Canvas

### 5.1 Node palette

A collapsible sidebar (or floating panel) listing every `NodeTypeEnum` value grouped by category, matching the original product doc:

- **Ingestion**: File Watcher, Image Input, Text Input
- **Processing & Vector Memory**: Local Embedder, ChromaDB Vector Store
- **Inference & Logic Routing**: Ollama Selector, Conditional Router
- **Output**: Local File Writer, Log Terminal

Each palette entry is draggable (`draggable` + `onDragStart` setting `event.dataTransfer`) onto the React Flow canvas. On drop, instantiate a new `GraphNodeSchema` entry at the drop coordinates with sensible default `data` for that type, and push it into the shared Zustand store — the identical store the chat pipeline writes to.

### 5.2 Node config inspector

Clicking a node on the canvas opens a right-side inspector panel showing editable fields for that node's `data` object (per the table in Section 3):

- `ollama_selector`: dropdown populated by a live Rust command `list_ollama_models` (calls `GET /api/tags` on Ollama) rather than a hardcoded list, so it always reflects what the user actually has installed.
- `file_watcher`: a folder picker (Tauri's dialog plugin) writing an absolute path into `watch_path`.
- `image_input`: a native drop-zone; on drop, store the resolved file path in the node's runtime data (not persisted in the graph JSON itself — the graph defines structure, not per-run data).
- `conditional_router`: a `condition_type` dropdown plus, for `custom`, a text expression field.
- `local_file_writer`: output path (folder picker) + format dropdown.

### 5.3 Wiring

Standard React Flow edge creation (drag from a source handle to a target handle). For `conditional_router` nodes, render two named output handles (`true` / `false`, or however many branches `condition_type` implies) so the user can wire different downstream paths per branch, matching the "If image detected → vision node, else bypass" example from the product doc.

### 5.4 Manual node CRUD

Delete key removes selected node/edge (with confirmation if the node has active connections). Right-click context menu for duplicate/delete. All of this operates on the same Zustand graph store as Option 1 — there is no separate "manual graph" vs "AI graph" data model.

---

## 6. Shared execution engine (real node execution, not a stub)

This is what turns the graph from a diagram into an actual running pipeline. Execution is identical regardless of which option built the graph.

### 6.1 Compilation

On clicking "Execute": serialize the current `GraphState`, topologically sort nodes (Kahn's algorithm) to determine execution order, and detect cycles — reject execution with a clear error if the graph isn't a DAG.

### 6.2 Execution loop (Rust side, `executor.rs`)

Walk the sorted node list. For each node, dispatch by `type`:

- `file_watcher`: start a `notify` watcher on `watch_path`; when a new file appears, that event becomes the trigger that (re)starts a graph run. (For a manual "Execute" click during testing, allow bypassing the watch and using the most recent file in that folder.)
- `image_input` / `text_input`: pass through the runtime-provided file path / text string as this node's output.
- `local_embedder`: POST to Ollama's `/api/embeddings` with `nomic-embed-text` and the upstream text, output = vector.
- `chromadb_store`: if `mode: "write"`, upsert the embedding + source metadata into the named collection via the local ChromaDB HTTP API; if `mode: "read"`, run a similarity query against the collection using the upstream embedding and output the retrieved context chunks (this is the RAG "Context Injection" step from the product doc).
- `ollama_selector`: POST to `/api/generate` with the selected model, merging upstream text/image/context into the prompt payload; stream tokens back.
- `conditional_router`: evaluate `condition_type` against upstream data (e.g. `has_image` checks whether an image path is present in the upstream payload) and only propagate data along the matching edge(s).
- `local_file_writer`: write the final accumulated output to `output_path` in the given `format` via Rust `fs::write`.
- `log_terminal`: not executed — it's a passive sink that receives every execution event emitted below.

### 6.3 Streaming status to the frontend

Emit a Tauri event per node transition — `node-status` with `{ node_id, status: "running" | "success" | "error", message? }` — so the canvas can highlight the active node in real time and the Log Terminal node can render a live scrolling log. Frontend subscribes via `listen("node-status", …)`.

### 6.4 ChromaDB as a local dependency

ChromaDB isn't embeddable directly in Rust — run it as a local sidecar process (`chroma run --path ./chroma_data`) that the app either launches itself (via Tauri's `shell` plugin, spawned on app start and killed on app close) or expects the user to have running. Document this clearly in the README as a prerequisite. If Antigravity judges a zero-process-dependency alternative preferable, a Rust-native embedded vector store (e.g. `lancedb`) is an acceptable substitute — flag the tradeoff to the user rather than silently deciding.

---

## 7. Rust/Tauri backend commands (full list)

```rust
generate_graph(prompt: String) -> Result<String, String>       // Section 4.2
list_ollama_models() -> Result<Vec<String>, String>             // Section 5.2
execute_graph(graph: GraphState) -> Result<(), String>          // Section 6, streams node-status events
start_file_watch(path: String, node_id: String) -> Result<(), String>
stop_file_watch(node_id: String) -> Result<(), String>
pick_folder() -> Result<String, String>                         // wraps Tauri dialog plugin
pick_image() -> Result<String, String>
write_output(path: String, content: String, format: String) -> Result<(), String>
```

Handle Ollama-not-running and ChromaDB-not-running as first-class, clearly-messaged errors (not stack traces) — these are the two most common failure modes for a local-only app.

---

## 8. Suggested file structure

```
/src
  /components
    /nodes              // one .tsx per node type — shared by both canvas modes
    ChatPanel.tsx
    NodePalette.tsx      // Option 2
    NodeInspector.tsx    // Option 2 config panel
    GraphCanvas.tsx       // shared React Flow wrapper
    LogTerminal.tsx
    ExecutionToolbar.tsx // Run / Stop button, execution status summary
  /lib
    graphSchema.ts
    translatorSystemPrompt.ts
    autoLayout.ts         // dagre wrapper, chat-graph only
    useGraphStore.ts       // Zustand — shared by both options
    useExecutionStore.ts   // Zustand — node statuses, logs
  App.tsx
  main.tsx
/src-tauri
  /src
    main.rs
    commands.rs
    executor.rs           // Section 6.2
    watcher.rs             // notify wrapper
    chroma.rs               // HTTP client for local ChromaDB
    ollama.rs                // HTTP client for Ollama
  Cargo.toml
  tauri.conf.json
```

---

## 9. Milestones (build in this order)

**Phase A — Shell & Chat-to-Graph**
1. Scaffold Tauri + React + TS + Vite; confirm `npm run tauri dev` opens a blank window.
2. Add Tailwind, two-pane layout (chat panel + empty canvas).
3. Install `@xyflow/react`, render a static hardcoded graph to prove it works.
4. Build all 9 custom node components as visually distinct cards (static for now).
5. Write `graphSchema.ts` (zod) exactly as in Section 3.
6. Implement Rust `generate_graph`; sanity-test against Ollama with `curl` before wiring UI.
7. Wire chat panel → `generate_graph` → parse/validate → repair-retry logic.
8. Add `dagre` auto-layout before committing generated positions.
9. Wire Zustand store → React Flow so generated graphs render live.

**Phase B — Manual Canvas**
10. Build `NodePalette.tsx`; implement drag-from-palette → drop-on-canvas → new node in shared store.
11. Build `NodeInspector.tsx` with per-type config fields (Section 5.2), including `list_ollama_models` and folder/image pickers.
12. Implement conditional_router's multiple named handles and manual wiring UX.
13. Implement node/edge delete, duplicate, and cycle-free wiring validation.

**Phase C — Real Execution**
14. Implement `executor.rs` with topological sort + cycle detection.
15. Implement per-node-type execution logic (Section 6.2) one node type at a time, testing each against Ollama/ChromaDB directly before wiring into the graph runner.
16. Wire Tauri event streaming (`node-status`) → canvas highlighting + Log Terminal live output.
17. Implement `file_watcher` trigger flow end-to-end.
18. Polish: error states for Ollama/ChromaDB unreachable, execution cancel/stop, run history.

---

## 10. Acceptance criteria

- [ ] App launches as a native desktop window via Tauri.
- [ ] Chat request *"Create an automated quality assurance pipeline. Upload a product photo, cross-reference it with a local PDF spec sheet using an 11B vision model, and output a markdown report."* produces a correctly-wired graph.
- [ ] The same graph can be built from scratch by dragging nodes from the palette and wiring them manually, with identical execution behavior.
- [ ] Clicking Execute on either graph actually runs it: image passed to the vision model, PDF-derived context retrieved from ChromaDB, conditional routing respected, and a real `.md` file written to disk.
- [ ] Log Terminal shows live per-node status during execution.
- [ ] Invalid/malformed LLM output never crashes the app — caught, retried once, then surfaced as a readable error.
- [ ] Ollama-not-running and ChromaDB-not-running produce clear, non-crashing error messages.
- [ ] No network calls leave localhost at any point in either option.
- [ ] Nodes can be manually repositioned/deleted after either AI generation or manual placement without breaking graph state.
- [ ] `npm run tauri build` succeeds on macOS, Windows, and Linux (verified via the CI matrix in Section 1a), producing the correct native installer for each.
- [ ] Repo includes `LICENSE` (MIT), `README.md` with per-OS setup instructions, and `CONTRIBUTING.md`.
- [ ] No GPL/AGPL-licensed dependencies are present anywhere in `Cargo.toml` or `package.json`.
- [ ] No hardcoded OS-specific file paths anywhere in the codebase.

---

## 12. Advanced Features (v2 — build after Section 10's acceptance criteria pass)

These are differentiators beyond the core dual-system app. Each is written
with the same rigor as Sections 3–7 so it can be executed with the same
step-gated discipline in Section 13. Do not start these until every item in
Section 10 is PASS — they all build on top of the working core.

### 12.1 Execution Caching

**Why:** Local inference is slow and VRAM-bound. Re-running a pipeline
during iteration shouldn't redo work for nodes whose inputs didn't change.

**Design:** Each node's cache key is a hash of `(node.type, node.data,
hash_of_upstream_outputs)`. Before executing a node, compute its key; if a
cached `NodeOutput` exists for that key, skip execution and reuse it,
still emitting a `node-status` event with `status: "cached"` so the UI
shows it was skipped rather than silently doing nothing.

```rust
// src-tauri/src/cache.rs
use sha2::{Sha256, Digest};

pub fn compute_cache_key(node_type: &str, node_data: &serde_json::Value, upstream_hash: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(node_type.as_bytes());
    hasher.update(node_data.to_string().as_bytes());
    hasher.update(upstream_hash.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub struct ExecutionCache {
    store: std::collections::HashMap<String, NodeOutput>, // key -> output
}

impl ExecutionCache {
    pub fn get(&self, key: &str) -> Option<&NodeOutput> { self.store.get(key) }
    pub fn set(&mut self, key: String, output: NodeOutput) { self.store.insert(key, output); }
}
```

Cache lives in memory for v2 (cleared on app restart) — do not add disk
persistence unless explicitly asked, to avoid stale-cache-across-sessions
bugs with no invalidation UI yet.

### 12.2 Headless CLI Runner

**Why:** Decouples execution from the GUI so pipelines can run in cron
jobs, shell scripts, or CI — this is what makes the tool usable as
infrastructure, not just a demo.

**Design:** A second binary target in the same Cargo workspace, reusing
`executor.rs` directly (no duplication of execution logic).

```toml
# src-tauri/Cargo.toml — add a second [[bin]] target
[[bin]]
name = "hub"
path = "src/bin/cli.rs"
```

```rust
// src-tauri/src/bin/cli.rs
use clap::Parser;

#[derive(Parser)]
#[command(name = "hub")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(clap::Subcommand)]
enum Command {
    Run {
        pipeline: std::path::PathBuf,   // path to a saved GraphState JSON file
        #[arg(long)] input: Option<std::path::PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let cli = Cli::parse();
    match cli.command {
        Command::Run { pipeline, input } => {
            let graph_json = std::fs::read_to_string(&pipeline)
                .map_err(|e| format!("Could not read {}: {e}", pipeline.display()))?;
            let graph: hub_lib::GraphState = serde_json::from_str(&graph_json)
                .map_err(|e| format!("Invalid graph JSON: {e}"))?;
            hub_lib::executor::execute_graph_headless(graph, input).await
        }
    }
}
```

Usage: `hub run pipeline.json --input ./folder`. Requires refactoring
`executor.rs` into a shared library crate (`hub_lib`) that both the Tauri
app and this CLI binary depend on, so execution logic is written once.

### 12.3 Reverse Mode — Graph → Plain English

**Why:** Instant documentation for a manually-built graph; reuses the
existing Ollama translator connection in the opposite direction.

**Design:** A "Describe this graph" button. Serialize the current
`GraphState` to JSON, send it to the same translator model with a
different system prompt, get back a plain-English paragraph, show it in
the chat panel as an assistant message.

```typescript
// lib/reverseTranslatorSystemPrompt.ts
export const REVERSE_TRANSLATOR_SYSTEM_PROMPT = `
You are a technical writer. Given a JSON pipeline graph (nodes + edges),
describe in 2-4 plain-English sentences what the pipeline does, in the
order data flows through it. Do not mention node ids or JSON structure —
describe it the way you'd explain it to a colleague.
`;

// components/ChatPanel.tsx addition
async function describeGraph(graph: GraphState): Promise<string> {
  return invoke<string>("generate_graph", {
    // reuse generate_graph's Ollama call, but note this returns prose,
    // NOT graph JSON — do not run it through GraphStateSchema.safeParse
    prompt: JSON.stringify(graph),
  });
}
```

Note the reuse: this is the same Rust `generate_graph` command from Step
6, just with a different system prompt constant swapped in — do not write
a second Rust command for this.

### 12.4 Plugin Architecture for Community Node Types

**Why:** The palette is fixed at 9 types; open-source adoption benefits
from extensibility without touching core code.

**Design:** A node plugin is a folder with a manifest + a WASM module
implementing a single `execute` function. Ship a `plugins/` directory the
app scans on startup.

```json
// plugins/whisper-transcribe/manifest.json
{
  "id": "community.whisper_transcribe",
  "label": "Whisper Transcription",
  "category": "Processing & Vector Memory",
  "data_schema": { "model": "string" },
  "wasm_entry": "plugin.wasm"
}
```

```rust
// src-tauri/src/plugins.rs
#[derive(Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub label: String,
    pub category: String,
    pub data_schema: serde_json::Value,
    pub wasm_entry: String,
}

pub fn discover_plugins(plugins_dir: &std::path::Path) -> Vec<PluginManifest> {
    // read each subfolder's manifest.json, validate against a minimal
    // schema (id/label/category/wasm_entry all required strings), skip
    // and log any folder that fails validation rather than crashing startup
    todo!("implement folder scan + serde_json parse per manifest")
}

// Execution: use `wasmtime` to instantiate wasm_entry and call a required
// exported function `execute(input_json_ptr) -> output_json_ptr`, with
// input/output both being the same NodeOutput JSON shape used natively.
```

This is the most involved v2 feature — treat it as its own multi-step
sub-build (Step 24 below breaks it down further) rather than one-shotting
it, and confirm the WASM sandboxing approach with the user before writing
the `wasmtime` integration, since it has real security implications
(untrusted community plugins executing on the user's machine).

### 12.5 Dry-Run / Synthetic Data Mode

**Why:** Lets users test conditional routing and wiring without live
Ollama/ChromaDB — also solves the "can't test in CI without live
services" problem from Section 9/13's own build steps.

**Design:** A toggle on `ExecutionToolbar.tsx`. When enabled, `executor.rs`
skips real Ollama/ChromaDB/filesystem calls and instead returns
deterministic fake `NodeOutput` values per node type, so the execution
path (including which conditional branch fires) can be observed and
tested end-to-end.

```rust
// src-tauri/src/executor.rs
pub fn synthetic_output_for(node_type: &str) -> NodeOutput {
    match node_type {
        "image_input" => NodeOutput { image_path: Some("SYNTHETIC/fake.png".into()), ..Default::default() },
        "text_input" => NodeOutput { text: Some("SYNTHETIC sample text".into()), ..Default::default() },
        "local_embedder" => NodeOutput { embedding: Some(vec![0.1; 8]), ..Default::default() },
        "ollama_selector" => NodeOutput { text: Some("SYNTHETIC generated response".into()), ..Default::default() },
        "chromadb_store" => NodeOutput { context_chunks: Some(vec!["SYNTHETIC retrieved chunk".into()]), ..Default::default() },
        _ => NodeOutput::default(),
    }
}
// execute_graph(graph, dry_run: bool) — when dry_run is true, every
// handler in Step 16 short-circuits to synthetic_output_for(node.type)
// instead of making the real call, but node-status events still fire
// normally so the UI/log behavior is identical to a real run.
```

### 12.6 ChromaDB Inspector Panel

**Why:** RAG behavior is otherwise a black box — no way to see what's
actually stored or test retrieval without external tooling.

**Design:** A panel (opened from a `chromadb_store` node's inspector)
showing the collection's stored documents and a free-text query box that
runs a live similarity search and shows results with scores.

```rust
// src-tauri/src/commands.rs — new command, reuses chroma.rs
#[tauri::command]
pub async fn chroma_inspect(collection: String, query: Option<String>) -> Result<serde_json::Value, String> {
    if let Some(q) = query {
        let embedding = crate::ollama::embed_text("nomic-embed-text", &q).await?;
        let results = crate::chroma::chroma_query(&collection, embedding, 5).await?;
        Ok(serde_json::json!({ "mode": "query", "results": results }))
    } else {
        crate::chroma::chroma_list_all(&collection).await // new helper: GET /collections/{name}/get
    }
}
```

### 12.7 Configurable Chat-to-Graph Model + In-App Model Downloader

**Why:** Step 6 hardcodes `model: "llama3.2"` for the translator. Different
users have different models pulled locally, and some — like
[`qwen2.5vl:7b`](https://ollama.com/library/qwen2.5vl:7b), a vision-language
model — support attaching an image to the chat request (e.g. "build a
pipeline like this whiteboard sketch"), which plain text models can't do.
Users also shouldn't need the `ollama pull` CLI at all — the app should
let them browse and download models from inside the UI.

**Design — two parts:**

**(a) Configurable translator model.** Replace the hardcoded model string
in `generate_graph` with a parameter, backed by a persisted setting.

```rust
// src-tauri/src/commands.rs — generate_graph updated signature
#[derive(Serialize)]
struct OllamaGenerateRequest<'a> {
    model: &'a str,
    system: &'a str,
    prompt: &'a str,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>, // base64, only sent if the selected model is vision-capable
}

#[tauri::command]
pub async fn generate_graph(
    model: String,          // e.g. "llama3.2" or "qwen2.5vl:7b" — no hardcoded default
    prompt: String,
    images: Option<Vec<String>>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let body = OllamaGenerateRequest {
        model: &model,
        system: TRANSLATOR_SYSTEM_PROMPT,
        prompt: &prompt,
        stream: false,
        images,
    };
    let resp = client.post("http://localhost:11434/api/generate").json(&body)
        .send().await.map_err(|e| format!("Ollama not reachable at localhost:11434: {e}"))?;
    let parsed: OllamaGenerateResponse = resp.json().await
        .map_err(|e| format!("Unexpected Ollama response shape: {e}"))?;
    Ok(parsed.response)
}
```

```typescript
// lib/useSettingsStore.ts — persisted via tauri-plugin-store, not localStorage
import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";

type Settings = { translatorModel: string };
const store = new Store(".hub-settings.json"); // cross-platform app-data path, resolved by the plugin

type SettingsStore = {
  settings: Settings;
  setTranslatorModel: (model: string) => Promise<void>;
  load: () => Promise<void>;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: { translatorModel: "llama3.2" }, // fallback only until load() resolves
  load: async () => {
    const saved = await store.get<string>("translatorModel");
    set((s) => ({ settings: { ...s.settings, translatorModel: saved ?? s.settings.translatorModel } }));
  },
  setTranslatorModel: async (model) => {
    await store.set("translatorModel", model);
    await store.save();
    set((s) => ({ settings: { ...s.settings, translatorModel: model } }));
  },
}));
```

ChatPanel.tsx's `requestGraph()` (Step 8) now passes
`useSettingsStore.getState().settings.translatorModel` as the `model` arg
to `invoke("generate_graph", ...)` instead of nothing — the Rust side no
longer defaults it.

**(b) In-app model downloader.** A settings panel listing installed
models (reusing `list_ollama_models` from Step 12) plus a curated list of
recommended models — including `qwen2.5vl:7b` — with a Download button
that streams pull progress via Ollama's `/api/pull` endpoint.

```rust
// src-tauri/src/ollama.rs
#[derive(Serialize)]
struct PullRequest<'a> { model: &'a str, stream: bool } // stream: true here — pull progress needs streaming

#[derive(Deserialize, Serialize, Clone)]
pub struct PullProgress {
    pub status: String,               // e.g. "pulling manifest", "downloading", "success"
    #[serde(default)] pub completed: Option<u64>,
    #[serde(default)] pub total: Option<u64>,
}

#[tauri::command]
pub async fn pull_model(app: tauri::AppHandle, model: String) -> Result<(), String> {
    use futures_util::StreamExt;
    let client = reqwest::Client::new();
    let mut stream = client.post("http://localhost:11434/api/pull")
        .json(&PullRequest { model: &model, stream: true })
        .send().await.map_err(|e| format!("Ollama not reachable at localhost:11434: {e}"))?
        .bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error while pulling {model}: {e}"))?;
        for line in chunk.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
            if let Ok(progress) = serde_json::from_slice::<PullProgress>(line) {
                let _ = app.emit("model-pull-progress", (model.clone(), progress));
            }
        }
    }
    Ok(())
}
```

```typescript
// components/ModelManagerPanel.tsx
const RECOMMENDED_MODELS = [
  { name: "llama3.2", note: "fast, general-purpose translator model" },
  { name: "qwen2.5", note: "strong JSON-following alternative translator" },
  { name: "qwen2.5vl:7b", note: "vision-language — lets chat-to-graph accept an attached image" },
  { name: "llama3.2-vision", note: "vision model for ollama_selector nodes" },
  { name: "nomic-embed-text", note: "required for local_embedder / RAG" },
];

async function downloadModel(name: string) {
  const unlisten = await listen<[string, { status: string; completed?: number; total?: number }]>(
    "model-pull-progress",
    (e) => {
      const [modelName, progress] = e.payload;
      if (modelName === name) updateProgressUI(name, progress);
    }
  );
  try {
    await invoke("pull_model", { model: name });
  } finally {
    unlisten();
  }
}
```

Installed vs. not-yet-installed status for each recommended model is
determined by cross-referencing `list_ollama_models`'s output against
`RECOMMENDED_MODELS` — do not maintain a separate "is installed" flag by
hand.

---

## 13. ANTIGRAVITY AGENT PROMPT (step-gated, anti-hallucination)

*(Paste everything below this line into Antigravity as the task. This file must be saved as `SPEC.md` in the workspace root before running. This prompt is written as a sequence of discrete, independently-verifiable STEPs on purpose — each step tells the agent exactly which SPEC.md section to read, what to build, and how to prove it worked, so the agent never has to guess, re-derive scope from memory, or re-read the whole spec repeatedly.)*

```
ROLE
You are a disciplined build agent working strictly from SPEC.md, saved at the
root of this workspace. You do not have creative license over scope,
architecture, or the data schema — SPEC.md is authoritative for all three.

GLOBAL RULES (apply to every step below, do not restate them back to me)
1. Token discipline: for each STEP, open and read ONLY the SPEC.md section(s)
   named in that step's "Read:" line — not the whole file. Do not re-read
   sections you've already implemented correctly in a prior step unless a
   later step explicitly tells you to revisit one.
2. No invention: if a step requires a detail that isn't in the cited SPEC.md
   section (an API shape, a field name, a library choice), STOP and ask a
   single clarifying question rather than guessing or inventing a plausible-
   sounding default. Do not silently add fields, node types, endpoints, or
   dependencies that aren't in SPEC.md.
3. One step at a time: complete a step fully, run its Verify command, and
   only report a step "done" if Verify actually passes. If Verify fails, fix
   only within that step's own file scope — do not touch files outside the
   step's listed scope to patch it. If you cannot make Verify pass after two
   attempts, STOP, report exactly what fails, and wait for guidance instead
   of moving to the next step.
4. No scope creep: do not pre-build later steps early "while you're in
   there." Each step's file scope is intentionally narrow.
5. Output discipline: after each step, report in this exact short format and
   nothing more —
     STEP <n> — <name>: PASS | FAIL
     Files touched: <list>
     Verify result: <one line>
   Do not restate the spec back to me, do not narrate intentions at length —
   code and the verification result are the deliverable.
6. If a step is marked [CHECKPOINT], stop after it regardless of pass/fail
   and wait for explicit go-ahead before continuing to the next step.

═══════════════════════════════════════════════════════════════════
PHASE A — SHELL & CHAT-TO-GRAPH
═══════════════════════════════════════════════════════════════════

STEP 1 — Scaffold project
Read: Section 2 (Tech stack), Section 8 (file structure)
Do: Run `npm create tauri-app@latest` with the React + TypeScript + Vite
    template. Match the folder layout in Section 8 as closely as the
    scaffold tool allows; note any deviation in your report.
Contract — expected result of scaffolding, verify each exists:
  /package.json          -> scripts: { "dev": "vite", "tauri": "tauri" }
  /src/main.tsx           -> ReactDOM.createRoot(...).render(<App />)
  /src/App.tsx
  /src-tauri/Cargo.toml    -> [dependencies] tauri = { version = "2", ... }
  /src-tauri/src/main.rs    -> fn main() { tauri::Builder::default()...run(...) }
  /src-tauri/tauri.conf.json
Verify: `npm run tauri dev` opens a native window with no console errors.
Scope: root project files, /src, /src-tauri only — no feature code yet.

STEP 2 — Layout shell + Tailwind
Read: Section 8 (file structure) for where App.tsx/components live.
Do: Install Tailwind (`npm install -D tailwindcss postcss autoprefixer`,
    `npx tailwindcss init -p`). Build App.tsx as a two-pane layout.
Contract:
  // App.tsx
  export default function App(): JSX.Element {
    return (
      <div className="flex h-screen w-screen overflow-hidden">
        <aside className="w-[340px] shrink-0 border-r border-neutral-800">
          {/* ChatPanel mounted here in Step 8 */}
        </aside>
        <main className="flex-1 relative">
          {/* GraphCanvas mounted here in Step 3 */}
        </main>
      </div>
    );
  }
Verify: `npm run tauri dev` shows the two-pane layout with visible
    boundaries (even if empty).
Scope: App.tsx, tailwind.config.js, postcss.config.js only.

STEP 3 — Static React Flow proof
Read: none new (uses only @xyflow/react's own docs, not SPEC.md)
Do: `npm install @xyflow/react`. Render ONE hardcoded static graph.
Contract:
  // GraphCanvas.tsx
  import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
  import "@xyflow/react/dist/style.css";

  const demoNodes: Node[] = [
    { id: "n1", position: { x: 0, y: 0 }, data: { label: "Node 1" } },
    { id: "n2", position: { x: 250, y: 0 }, data: { label: "Node 2" } },
  ];
  const demoEdges: Edge[] = [{ id: "e1-2", source: "n1", target: "n2" }];

  export default function GraphCanvas(): JSX.Element {
    return (
      <ReactFlow nodes={demoNodes} edges={demoEdges} fitView>
        <Background /><Controls />
      </ReactFlow>
    );
  }
Verify: canvas visibly shows 2 connected nodes; pan/zoom works.
Scope: GraphCanvas.tsx only.

STEP 4 — Custom node components
Read: Section 5.1 (node palette categories) — this is the ONLY source of
      truth for which 9 node types exist. Do not add or rename any.
Do: Build one .tsx file per NodeTypeEnum value under /components/nodes.
Contract — shared prop type and one full reference implementation, every
other node file follows this exact shape with only label/icon/color changed:
  // components/nodes/types.ts
  import type { NodeProps } from "@xyflow/react";
  export type HubNodeData = { label: string; [key: string]: unknown };
  export type HubNodeProps = NodeProps & { data: HubNodeData };

  // components/nodes/OllamaSelectorNode.tsx  (reference implementation)
  import { Handle, Position } from "@xyflow/react";
  import type { HubNodeProps } from "./types";

  export default function OllamaSelectorNode({ data, selected }: HubNodeProps) {
    return (
      <div className={`rounded-lg border px-3 py-2 bg-violet-950 border-violet-700
        ${selected ? "ring-2 ring-violet-400" : ""}`}>
        <Handle type="target" position={Position.Left} />
        <div className="text-xs uppercase text-violet-300">Inference</div>
        <div className="text-sm font-medium text-white">{data.label}</div>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }
  // Repeat for: FileWatcherNode, ImageInputNode, TextInputNode,
  // LocalEmbedderNode, ChromaDbStoreNode, ConditionalRouterNode (see Step 13
  // for its extra handles), LocalFileWriterNode, LogTerminalNode.
  // Category -> color mapping (keep consistent across all 9):
  //   Ingestion: emerald | Processing/Vector: sky | Inference/Logic: violet
  //   Output: amber
Verify: temporarily register all 9 in GraphCanvas.tsx's nodeTypes map
    (`const nodeTypes = { file_watcher: FileWatcherNode, ... }`) and confirm
    each renders distinctly with no console warnings.
Scope: /components/nodes/*.tsx only.

STEP 5 — Graph schema [CHECKPOINT]
Read: Section 3 (JSON Graph Schema) in full — copy it verbatim into code,
      do not paraphrase or "improve" field names.
Do: Create graphSchema.ts exactly as specified in Section 3, using zod.
    Copy the zod code block from Section 3 verbatim — do not retype it
    from memory, to avoid drift between spec and code.
Contract — the throwaway validation test:
  // graphSchema.test.ts (delete after verifying, or keep as a real test)
  import { GraphStateSchema } from "./graphSchema";

  const valid = { nodes: [{ id: "n1", type: "text_input", label: "In",
    position: { x: 0, y: 0 } }], edges: [] };
  const invalid = { nodes: [{ id: "n1", type: "not_a_real_type",
    label: "In", position: { x: 0, y: 0 } }], edges: [] };

  console.assert(GraphStateSchema.safeParse(valid).success === true, "valid failed");
  console.assert(GraphStateSchema.safeParse(invalid).success === false, "invalid passed");
Verify: both console.assert lines pass (no assertion failure printed).
Scope: lib/graphSchema.ts only.
[CHECKPOINT] — stop here and wait for go-ahead. This schema is depended
on by every remaining step in Phases A, B, and C — get confirmation
before building on top of it.

STEP 6 — Rust generate_graph command
Read: Section 4.2 (call pattern), Section 7 (Rust command signatures)
Do: Implement `generate_graph` in src-tauri using reqwest.
Contract — exact request/response shapes for Ollama's /api/generate
(non-streaming mode, since stream: false is required so the whole JSON
graph comes back as one parseable string):
  // src-tauri/src/commands.rs
  use serde::{Deserialize, Serialize};

  #[derive(Serialize)]
  struct OllamaGenerateRequest<'a> {
      model: &'a str,
      system: &'a str,
      prompt: &'a str,
      stream: bool, // always false here
  }

  #[derive(Deserialize)]
  struct OllamaGenerateResponse {
      response: String, // this is the raw text the model produced
      done: bool,
      #[serde(default)]
      #[allow(dead_code)]
      model: Option<String>,
  }

  #[tauri::command]
  pub async fn generate_graph(prompt: String) -> Result<String, String> {
      let client = reqwest::Client::new();
      let body = OllamaGenerateRequest {
          model: "llama3.2",
          system: TRANSLATOR_SYSTEM_PROMPT, // mirror of translatorSystemPrompt.ts, Step 7
          prompt: &prompt,
          stream: false,
      };
      let resp = client
          .post("http://localhost:11434/api/generate")
          .json(&body)
          .send()
          .await
          .map_err(|e| format!("Ollama not reachable at localhost:11434: {e}"))?;

      let parsed: OllamaGenerateResponse = resp
          .json()
          .await
          .map_err(|e| format!("Unexpected Ollama response shape: {e}"))?;

      Ok(parsed.response)
  }
Verify: standalone Rust test (or temporary main.rs call) prints a non-
    empty response from Ollama, OR — if Ollama isn't available in this
    environment — prints a clearly labeled "MOCKED — Ollama unreachable"
    response using one of the few-shot examples from Section 4.1.
Scope: src-tauri/src/commands.rs only.

STEP 7 — Translator system prompt
Read: Section 4.1 in full — use the rules and few-shot structure exactly.
Do: Create translatorSystemPrompt.ts as a plain exported string constant.
Contract:
  // lib/translatorSystemPrompt.ts
  export const TRANSLATOR_SYSTEM_PROMPT = `
  You are a graph-compiler assistant. Convert the user's plain-English
  automation request into a JSON object describing a node-based pipeline
  graph.
  ... [paste the exact rules block from SPEC.md Section 4.1 verbatim] ...
  ... [paste the 2-3 few-shot examples from SPEC.md Section 4.1 verbatim] ...
  `;
  // NOTE: this string must be mirrored into the Rust side (Step 6's
  // TRANSLATOR_SYSTEM_PROMPT constant) since the actual HTTP call happens
  // in Rust, not TypeScript. Keep both copies byte-identical; consider a
  // build step that generates one from the other if they drift.
Verify: string is non-empty, includes the fixed node-type vocabulary list,
    and includes at least 2 few-shot examples as specified.
Scope: lib/translatorSystemPrompt.ts only.

STEP 8 — Wire chat panel to generation, with repair-retry
Read: Section 4.2 (call pattern, including the repair-retry rule)
Do: Build ChatPanel.tsx.
Contract:
  // components/ChatPanel.tsx
  import { invoke } from "@tauri-apps/api/core";
  import { GraphStateSchema, type GraphState } from "../lib/graphSchema";

  async function requestGraph(prompt: string): Promise<
    { ok: true; graph: GraphState } | { ok: false; rawOutput: string }
  > {
    const raw = await invoke<string>("generate_graph", { prompt });
    const parsed = GraphStateSchema.safeParse(safeJsonParse(raw));
    if (parsed.success) return { ok: true, graph: parsed.data };

    // repair-retry: one retry with an explicit correction instruction
    const repairPrompt =
      `Your last output was invalid JSON or failed the schema. ` +
      `Return corrected JSON only, no prose. Original request: ${prompt}`;
    const raw2 = await invoke<string>("generate_graph", { prompt: repairPrompt });
    const parsed2 = GraphStateSchema.safeParse(safeJsonParse(raw2));
    if (parsed2.success) return { ok: true, graph: parsed2.data };

    return { ok: false, rawOutput: raw2 }; // caller shows this, never throws
  }

  function safeJsonParse(text: string): unknown {
    try { return JSON.parse(text); } catch { return null; }
  }
Verify: with Ollama mocked or live, submitting the QA-pipeline example
    prompt from Section 10's acceptance criteria produces either a valid
    parsed GraphState object logged to console, or a clean visible error
    (never an unhandled exception).
Scope: components/ChatPanel.tsx only.

STEP 9 — Auto-layout
Read: Section 3's auto-layout note only (inside the Data Contract section)
Do: `npm install dagre @types/dagre`. Write autoLayout.ts.
Contract:
  // lib/autoLayout.ts
  import dagre from "dagre";
  import type { GraphNodeSchema } from "./graphSchema";
  import { z } from "zod";

  type GNode = z.infer<typeof GraphNodeSchema>;
  const NODE_WIDTH = 180;
  const NODE_HEIGHT = 60;

  export function autoLayout<T extends GNode>(
    nodes: T[],
    edges: { source: string; target: string }[]
  ): T[] {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
    g.setDefaultEdgeLabel(() => ({}));
    nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
    edges.forEach((e) => g.setEdge(e.source, e.target));
    dagre.layout(g);
    return nodes.map((n) => {
      const { x, y } = g.node(n.id);
      return { ...n, position: { x, y } };
    });
  }
Verify: feed it a 4-node linear graph with identical (0,0) positions for
    every node; confirm output positions are all distinct and ordered.
Scope: lib/autoLayout.ts only.

STEP 10 — Shared Zustand store + live rendering [CHECKPOINT]
Read: Section 1 ("same graph state" note), Section 3 (schema)
Do: `npm install zustand`. Create useGraphStore.ts.
Contract:
  // lib/useGraphStore.ts
  import { create } from "zustand";
  import type { GraphState } from "./graphSchema";

  type GraphStore = {
    graph: GraphState;
    setGraph: (g: GraphState) => void;
    updateNodePosition: (id: string, x: number, y: number) => void;
  };

  export const useGraphStore = create<GraphStore>((set) => ({
    graph: { nodes: [], edges: [] },
    setGraph: (g) => set({ graph: g }),
    updateNodePosition: (id, x, y) =>
      set((s) => ({
        graph: {
          ...s.graph,
          nodes: s.graph.nodes.map((n) =>
            n.id === id ? { ...n, position: { x, y } } : n
          ),
        },
      })),
  }));

  // GraphCanvas.tsx now reads from the store instead of demoNodes/demoEdges:
  const graph = useGraphStore((s) => s.graph);
  const setGraph = useGraphStore((s) => s.setGraph);
  // ChatPanel.tsx, on requestGraph() ok:true -> setGraph(autoLayout(graph.nodes, graph.edges) ...)
Verify: submitting a chat prompt causes the canvas to re-render with the
    generated graph, using the Step 4 custom node components.
Scope: lib/useGraphStore.ts, GraphCanvas.tsx (update to read from store).
[CHECKPOINT] — Phase A is now complete and independently demoable. Stop
and wait for go-ahead before starting Phase B, since Phase B builds
directly on this store.

═══════════════════════════════════════════════════════════════════
PHASE B — MANUAL CANVAS
═══════════════════════════════════════════════════════════════════

STEP 11 — Node palette + drag-to-drop
Read: Section 5.1 only
Do: Build NodePalette.tsx listing all 9 types grouped by category.
Contract:
  // components/NodePalette.tsx
  import { useGraphStore } from "../lib/useGraphStore";
  import type { GraphNodeSchema } from "../lib/graphSchema";
  import { z } from "zod";

  type GNode = z.infer<typeof GraphNodeSchema>;

  const PALETTE: { category: string; items: { type: GNode["type"]; label: string }[] }[] = [
    { category: "Ingestion", items: [
        { type: "file_watcher", label: "File Watcher" },
        { type: "image_input", label: "Image Input" },
        { type: "text_input", label: "Text Input" } ] },
    { category: "Processing & Vector Memory", items: [
        { type: "local_embedder", label: "Local Embedder" },
        { type: "chromadb_store", label: "ChromaDB Vector Store" } ] },
    { category: "Inference & Logic Routing", items: [
        { type: "ollama_selector", label: "Ollama Selector" },
        { type: "conditional_router", label: "Conditional Router" } ] },
    { category: "Output", items: [
        { type: "local_file_writer", label: "Local File Writer" },
        { type: "log_terminal", label: "Log Terminal" } ] },
  ];

  const DEFAULT_DATA: Record<GNode["type"], Record<string, unknown>> = {
    file_watcher: { watch_path: "" },
    image_input: {},
    text_input: { default_text: "" },
    local_embedder: { model: "nomic-embed-text" },
    chromadb_store: { collection_name: "default", mode: "write" },
    ollama_selector: { model: "llama3.2" },
    conditional_router: { condition_type: "has_image" },
    local_file_writer: { output_path: "", format: "md" },
    log_terminal: {},
  };

  function onPaletteDragStart(e: React.DragEvent, type: GNode["type"]) {
    e.dataTransfer.setData("application/hub-node-type", type);
    e.dataTransfer.effectAllowed = "move";
  }

  // GraphCanvas.tsx drop handler (add alongside existing onDrop from Step 3/10):
  function onCanvasDrop(e: React.DragEvent, screenToFlowPosition: (p: {x:number;y:number}) => {x:number;y:number}) {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/hub-node-type") as GNode["type"];
    if (!type) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const newNode: GNode = {
      id: `node_${crypto.randomUUID().slice(0, 8)}`,
      type, position,
      label: type.replace(/_/g, " "),
      data: DEFAULT_DATA[type],
    };
    const graph = useGraphStore.getState().graph;
    useGraphStore.getState().setGraph({ ...graph, nodes: [...graph.nodes, newNode] });
  }
Verify: dragging each of the 9 palette entries onto the canvas creates a
    node of the correct type at the drop position, visible immediately.
Scope: components/NodePalette.tsx, minor GraphCanvas.tsx drop-handler edit.

STEP 12 — Node config inspector
Read: Section 5.2 in full, and the per-type `data` field table in Section 3
Do: Build NodeInspector.tsx. Implement list_ollama_models, pick_folder,
    pick_image Rust commands.
Contract — Rust side, exact Ollama /api/tags shape:
  // src-tauri/src/commands.rs
  #[derive(Deserialize)]
  struct OllamaTagsResponse { models: Vec<OllamaModelEntry> }
  #[derive(Deserialize)]
  struct OllamaModelEntry { name: String }

  #[tauri::command]
  pub async fn list_ollama_models() -> Result<Vec<String>, String> {
      let client = reqwest::Client::new();
      let resp = client.get("http://localhost:11434/api/tags").send().await
          .map_err(|e| format!("Ollama not reachable at localhost:11434: {e}"))?;
      let parsed: OllamaTagsResponse = resp.json().await
          .map_err(|e| format!("Unexpected /api/tags response shape: {e}"))?;
      Ok(parsed.models.into_iter().map(|m| m.name).collect())
  }

  #[tauri::command]
  pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
      use tauri_plugin_dialog::DialogExt;
      let path = app.dialog().file().blocking_pick_folder();
      Ok(path.map(|p| p.to_string()))
  }

  #[tauri::command]
  pub async fn pick_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
      use tauri_plugin_dialog::DialogExt;
      let path = app.dialog().file()
          .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
          .blocking_pick_file();
      Ok(path.map(|p| p.to_string()))
  }
Contract — frontend inspector, field-per-type switch driven by the
Section 3 `data` table (not invented ad hoc):
  // components/NodeInspector.tsx
  function FieldsFor(node: GNode): JSX.Element {
    switch (node.type) {
      case "file_watcher":
        return <FolderPickerField label="Watch folder" dataKey="watch_path" />;
      case "text_input":
        return <TextAreaField label="Default text" dataKey="default_text" />;
      case "local_embedder":
        return <ReadOnlyField label="Model" value="nomic-embed-text" />;
      case "chromadb_store":
        return <>
          <TextField label="Collection name" dataKey="collection_name" />
          <SelectField label="Mode" dataKey="mode" options={["read", "write"]} />
        </>;
      case "ollama_selector":
        return <OllamaModelDropdown dataKey="model" />; // calls list_ollama_models on mount
      case "conditional_router":
        return <SelectField label="Condition" dataKey="condition_type"
          options={["has_image", "has_text", "custom"]} />;
      case "local_file_writer":
        return <>
          <FolderPickerField label="Output folder" dataKey="output_path" />
          <SelectField label="Format" dataKey="format" options={["md", "txt", "json"]} />
        </>;
      case "image_input": case "log_terminal":
        return <p className="text-xs text-neutral-400">No configuration needed.</p>;
    }
  }
Verify: selecting each of the 9 node types on canvas shows the correct
    config fields per the Section 3 table, and the Ollama model dropdown
    populates from a live (or clearly-mocked) list_ollama_models call.
Scope: components/NodeInspector.tsx, src-tauri commands.rs (3 new commands).
Also register `tauri-plugin-dialog` in src-tauri/Cargo.toml and main.rs's
`.plugin(tauri_plugin_dialog::init())` if not already present from scaffold.

STEP 13 — Conditional router handles + manual wiring
Read: Section 5.3 only
Do: Give conditional_router nodes multiple named output handles.
Contract — handle count/id is driven directly by condition_type, never
invented per-instance:
  // components/nodes/ConditionalRouterNode.tsx
  import { Handle, Position } from "@xyflow/react";
  import type { HubNodeProps } from "./types";

  const BRANCHES_BY_CONDITION: Record<string, string[]> = {
    has_image: ["true", "false"],
    has_text: ["true", "false"],
    custom: ["true", "false"], // same two branches; the "expression" field
                                 // from Section 5.2 decides which fires at
                                 // execution time (Step 16f), not the handle count
  };

  export default function ConditionalRouterNode({ data }: HubNodeProps) {
    const conditionType = (data.condition_type as string) ?? "has_image";
    const branches = BRANCHES_BY_CONDITION[conditionType] ?? ["true", "false"];
    return (
      <div className="rounded-lg border px-3 py-2 bg-violet-950 border-violet-700">
        <Handle type="target" position={Position.Left} />
        <div className="text-sm font-medium text-white">Conditional Router</div>
        <div className="text-xs text-violet-300">{conditionType}</div>
        {branches.map((b, i) => (
          <Handle key={b} type="source" position={Position.Right} id={b}
            style={{ top: `${30 + i * 25}%` }} />
        ))}
      </div>
    );
  }
  // Downstream edges set edge.data.condition = "true" | "false" to record
  // which branch they represent (used by GraphEdgeSchema.condition, Section 3).
Verify: manually wire a 3-node graph (input -> conditional_router ->
    2 different outputs on its two branches) entirely by drag-and-drop,
    no chat involved.
Scope: components/nodes/ConditionalRouterNode.tsx only.

STEP 14 — Node/edge CRUD + cycle validation [CHECKPOINT]
Read: Section 5.4 only
Do: Implement delete, duplicate, and a cycle-rejecting wiring guard.
Contract — lightweight DFS cycle check at wire-time (separate from the
full topological sort used at execute-time in Step 15 — this one only
needs to answer "would this one new edge create a cycle?"):
  // GraphCanvas.tsx
  function wouldCreateCycle(
    nodes: GNode[], edges: GEdge[], newEdge: { source: string; target: string }
  ): boolean {
    const adjacency = new Map<string, string[]>();
    [...edges, newEdge].forEach((e) => {
      adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
    });
    const visited = new Set<string>();
    function dfs(nodeId: string, path: Set<string>): boolean {
      if (path.has(nodeId)) return true; // cycle found
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);
      path.add(nodeId);
      for (const next of adjacency.get(nodeId) ?? []) {
        if (dfs(next, path)) return true;
      }
      path.delete(nodeId);
      return false;
    }
    return nodes.some((n) => dfs(n.id, new Set()));
  }

  // onConnect handler:
  function onConnect(params: { source: string; target: string }) {
    const { nodes, edges } = useGraphStore.getState().graph;
    if (wouldCreateCycle(nodes, edges, params)) {
      toast.error("That connection would create a cycle — rejected.");
      return;
    }
    // ...append the new edge to the store as normal
  }
Verify: attempt to manually wire a cycle; confirm it's rejected with a
    visible message, not silently allowed or silently dropped.
Scope: GraphCanvas.tsx (edge-connect handler) only.
[CHECKPOINT] — Phase B complete. A graph can now be built either by chat
or fully by hand, in the same store. Stop and wait for go-ahead before
Phase C, since execution in Phase C must work identically for graphs
from either origin.

═══════════════════════════════════════════════════════════════════
PHASE C — REAL EXECUTION ENGINE
═══════════════════════════════════════════════════════════════════

STEP 15 — Topological sort + cycle rejection at execute-time
Read: Section 6.1 only
Do: Implement graph compilation in executor.rs.
Contract:
  // src-tauri/src/executor.rs
  use std::collections::{HashMap, VecDeque};

  pub fn topo_sort(nodes: &[GraphNode], edges: &[GraphEdge]) -> Result<Vec<String>, String> {
      let mut in_degree: HashMap<&str, usize> = nodes.iter().map(|n| (n.id.as_str(), 0)).collect();
      let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
      for e in edges {
          *in_degree.get_mut(e.target.as_str()).ok_or("edge references unknown target")? += 1;
          adjacency.entry(e.source.as_str()).or_default().push(e.target.as_str());
      }
      let mut queue: VecDeque<&str> = in_degree.iter()
          .filter(|(_, &deg)| deg == 0).map(|(id, _)| *id).collect();
      let mut order = Vec::new();
      while let Some(id) = queue.pop_front() {
          order.push(id.to_string());
          for &next in adjacency.get(id).unwrap_or(&vec![]) {
              let deg = in_degree.get_mut(next).unwrap();
              *deg -= 1;
              if *deg == 0 { queue.push_back(next); }
          }
      }
      if order.len() != nodes.len() {
          return Err("Graph contains a cycle — cannot execute".to_string());
      }
      Ok(order)
  }
Verify: unit test executor.rs with a valid DAG (produces an ordered list)
    and a cyclic graph (produces the expected error, not a panic/hang).
Scope: src-tauri/src/executor.rs only.

STEP 16 — Per-node execution logic, one type at a time
Read: Section 6.2 only. Implement and verify ONE node type fully before
      moving to the next — do not write all 8 handlers in one pass.
Contract — shared execution context type used by every handler below:
  // src-tauri/src/executor.rs
  #[derive(Clone, Debug, Default)]
  pub struct NodeOutput {
      pub text: Option<String>,
      pub image_path: Option<String>,
      pub embedding: Option<Vec<f32>>,
      pub context_chunks: Option<Vec<String>>,
  }
  pub type RunContext = std::collections::HashMap<String, NodeOutput>; // node_id -> output

Do, in this exact order, each with its own standalone verify before
moving on:

  16a. local_embedder -> Ollama /api/embeddings
  Contract:
    // src-tauri/src/ollama.rs
    #[derive(Serialize)] struct EmbedRequest<'a> { model: &'a str, prompt: &'a str }
    #[derive(Deserialize)] struct EmbedResponse { embedding: Vec<f32> }

    pub async fn embed_text(model: &str, text: &str) -> Result<Vec<f32>, String> {
        let client = reqwest::Client::new();
        let resp = client.post("http://localhost:11434/api/embeddings")
            .json(&EmbedRequest { model, prompt: text })
            .send().await.map_err(|e| format!("Ollama not reachable: {e}"))?;
        let parsed: EmbedResponse = resp.json().await
            .map_err(|e| format!("Unexpected /api/embeddings shape: {e}"))?;
        Ok(parsed.embedding)
    }
  Verify: standalone call against Ollama (or clearly-labeled mock) returns
    a non-empty float vector.

  16b. ollama_selector -> Ollama /api/generate (text or vision)
  Contract:
    // src-tauri/src/ollama.rs
    #[derive(Serialize)] struct GenerateRequest<'a> {
        model: &'a str, prompt: &'a str, stream: bool,
        #[serde(skip_serializing_if = "Option::is_none")] images: Option<Vec<String>>, // base64
    }
    #[derive(Deserialize)] struct GenerateResponse { response: String }

    pub async fn generate(model: &str, prompt: &str, image_b64: Option<String>) -> Result<String, String> {
        let client = reqwest::Client::new();
        let body = GenerateRequest {
            model, prompt, stream: false,
            images: image_b64.map(|b| vec![b]),
        };
        let resp = client.post("http://localhost:11434/api/generate").json(&body)
            .send().await.map_err(|e| format!("Ollama not reachable: {e}"))?;
        let parsed: GenerateResponse = resp.json().await
            .map_err(|e| format!("Unexpected /api/generate shape: {e}"))?;
        Ok(parsed.response)
    }
  Verify: standalone call returns generated text (or labeled mock).

  16c/16d. chromadb_store (write + read) -> local ChromaDB HTTP API
  Contract — ChromaDB's REST shape (v1 API, collection-scoped):
    // src-tauri/src/chroma.rs
    const CHROMA_BASE: &str = "http://localhost:8000/api/v1";

    #[derive(Serialize)] struct AddRequest<'a> {
        ids: Vec<&'a str>, embeddings: Vec<Vec<f32>>, documents: Vec<&'a str>,
    }
    pub async fn chroma_add(collection: &str, id: &str, embedding: Vec<f32>, document: &str) -> Result<(), String> {
        let client = reqwest::Client::new();
        let url = format!("{CHROMA_BASE}/collections/{collection}/add");
        client.post(&url).json(&AddRequest { ids: vec![id], embeddings: vec![embedding], documents: vec![document] })
            .send().await.map_err(|e| format!("ChromaDB not reachable at localhost:8000: {e}"))?;
        Ok(())
    }

    #[derive(Serialize)] struct QueryRequest { query_embeddings: Vec<Vec<f32>>, n_results: usize }
    #[derive(Deserialize)] struct QueryResponse { documents: Vec<Vec<String>> }
    pub async fn chroma_query(collection: &str, embedding: Vec<f32>, n_results: usize) -> Result<Vec<String>, String> {
        let client = reqwest::Client::new();
        let url = format!("{CHROMA_BASE}/collections/{collection}/query");
        let resp = client.post(&url).json(&QueryRequest { query_embeddings: vec![embedding], n_results })
            .send().await.map_err(|e| format!("ChromaDB not reachable at localhost:8000: {e}"))?;
        let parsed: QueryResponse = resp.json().await
            .map_err(|e| format!("Unexpected ChromaDB query response shape: {e}"))?;
        Ok(parsed.documents.into_iter().next().unwrap_or_default())
    }
  Verify 16c: a document is confirmed queryable back out (call chroma_add,
    then immediately chroma_query with the same embedding, assert the
    document text comes back).
  Verify 16d: querying after 16c's write returns the expected document.

  16e. image_input / text_input -> pass-through
  Contract:
    fn passthrough_text(input: &str) -> NodeOutput { NodeOutput { text: Some(input.to_string()), ..Default::default() } }
    fn passthrough_image(path: &str) -> NodeOutput { NodeOutput { image_path: Some(path.to_string()), ..Default::default() } }
  Verify: trivial unit test asserting the returned NodeOutput's field
    matches the input.

  16f. conditional_router -> evaluate + propagate along matching edge only
  Contract:
    pub fn evaluate_condition(condition_type: &str, upstream: &NodeOutput) -> bool {
        match condition_type {
            "has_image" => upstream.image_path.is_some(),
            "has_text" => upstream.text.is_some(),
            _ => false, // "custom" expressions: v1 stub, always false — do not
                        // invent an expression evaluator not in SPEC.md
        }
    }
    // executor.rs: only walk edges where edge.condition matches the
    // evaluate_condition() result ("true"/"false"), skip the other branch entirely.
  Verify: unit test with has_image true and false, confirming correct
    branch selection both times.

  16g. local_file_writer -> Rust fs::write
  Contract:
    pub fn write_output(path: &std::path::Path, content: &str) -> Result<(), String> {
        std::fs::write(path, content).map_err(|e| format!("Failed to write {}: {e}", path.display()))
    }
  Verify: file actually appears on disk with correct content and format
    (check extension matches the node's `format` field).

  16h. file_watcher -> notify crate registration/deregistration
  Contract:
    // src-tauri/src/watcher.rs
    use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event};
    use std::sync::mpsc::channel;

    pub fn start_watch(path: &std::path::Path, app: tauri::AppHandle, node_id: String) -> Result<RecommendedWatcher, String> {
        let (tx, rx) = channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(move |res| { let _ = tx.send(res); })
            .map_err(|e| format!("Could not create watcher: {e}"))?;
        watcher.watch(path, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Could not watch {}: {e}", path.display()))?;
        let app2 = app.clone();
        std::thread::spawn(move || {
            for res in rx {
                if let Ok(event) = res {
                    let _ = app2.emit("file-watch-triggered", (node_id.clone(), format!("{:?}", event.kind)));
                }
            }
        });
        Ok(watcher)
    }
  Verify: dropping a file into a watched folder fires the expected
    Rust-side event (log it) without wiring the full graph trigger yet.
Scope: src-tauri/src/executor.rs, src-tauri/src/ollama.rs,
       src-tauri/src/chroma.rs, src-tauri/src/watcher.rs.

STEP 17 — Event streaming to frontend
Read: Section 6.3 only
Do: Emit `node-status` Tauri events from executor.rs during a real run.
Contract:
  // src-tauri/src/executor.rs
  #[derive(Serialize, Clone)]
  struct NodeStatusEvent { node_id: String, status: String, message: Option<String> } // status: "running"|"success"|"error"

  fn emit_status(app: &tauri::AppHandle, node_id: &str, status: &str, message: Option<String>) {
      let _ = app.emit("node-status", NodeStatusEvent {
          node_id: node_id.to_string(), status: status.to_string(), message,
      });
  }
  // call emit_status(&app, id, "running", None) before each handler,
  // then "success" or "error" after, per node in the topo-sorted order.

  // components/LogTerminal.tsx
  import { listen } from "@tauri-apps/api/event";
  useEffect(() => {
    const unlisten = listen<{ node_id: string; status: string; message?: string }>(
      "node-status",
      (event) => appendLogLine(event.payload)
    );
    return () => { unlisten.then((f) => f()); };
  }, []);
Verify: running any graph from Phase A or B produces visible status
    transitions (running -> success/error) on canvas nodes and a
    scrolling log in LogTerminal, in real time, not only after completion.
Scope: executor.rs (emit calls), LogTerminal.tsx, ExecutionToolbar.tsx.

STEP 18 — file_watcher end-to-end trigger [CHECKPOINT]
Read: Section 6.2's file_watcher bullet only
Do: Wire the Step 16h watcher registration to kick off a full graph
    execution when a new file lands in the watched folder.
Contract:
  // src-tauri/src/main.rs (or a listener set up at watch-start time)
  app.listen("file-watch-triggered", move |event| {
      // event.payload() -> (node_id, kind); resolve which graph is
      // currently loaded (frontend holds it; request it via a stored
      // AppState, or have the frontend re-invoke execute_graph itself
      // upon receiving this event — simplest option, keep execution
      // triggering logic in one place: the frontend's ExecutionToolbar).
  });
  // Simplest correct design: watcher emits "file-watch-triggered" ->
  // frontend listens -> frontend calls the SAME invoke("execute_graph", ...)
  // path as a manual Run click. Do not duplicate execution logic in Rust.
Verify: drop a file into a watched folder and observe the full pipeline
    run end-to-end (status events + final output file), with no chat or
    manual "Execute" click involved.
Scope: executor.rs, watcher.rs, ExecutionToolbar.tsx (listen handler) only.

STEP 19 — Error states for unreachable services
Read: Section 7's "handle as first-class errors" note only
Do: Ensure every Ollama call and every ChromaDB call has a specific,
    readable error path.
Contract — pattern already established in Steps 6/12/16a-d (every
    reqwest .map_err already returns a "X not reachable at Y: {e}"
    string) — this step is an audit pass, not new logic:
  // frontend: components/ErrorToast.tsx
  function showServiceError(message: string) {
    // message already contains "Ollama not reachable..." or
    // "ChromaDB not reachable..." verbatim from Rust — display as-is,
    // do not re-word or generalize it into "Something went wrong".
    toast.error(message, { duration: 8000 });
  }
Verify: with Ollama/ChromaDB stopped, trigger execution and confirm the
    UI shows the specific "X not reachable at Y" message, app doesn't
    crash, and execution can be retried after starting the service.
Scope: any file with an Ollama/ChromaDB call — grep for both client
       modules to find them all; do not touch unrelated files.

STEP 20 — Open source + cross-platform packaging [CHECKPOINT]
Read: Section 1a in full
Do: Add LICENSE (MIT), README.md, CONTRIBUTING.md, .gitattributes, CI matrix.
Contract:
  # .github/workflows/build.yml
  name: build
  on: [push, pull_request]
  jobs:
    build:
      strategy:
        matrix:
          os: [macos-latest, windows-latest, ubuntu-latest]
      runs-on: ${{ matrix.os }}
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 20 }
        - uses: dtolnay/rust-toolchain@stable
        - if: matrix.os == 'ubuntu-latest'
          run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev
        - run: npm install
        - run: cargo check --manifest-path src-tauri/Cargo.toml
        - run: npm run tauri build
Verify: CI workflow file is syntactically valid (YAML lints clean); if
    you can, trigger it and report per-OS pass/fail; if not, report that
    live CI confirmation is still needed post-merge.
Scope: LICENSE, README.md, CONTRIBUTING.md, .gitattributes,
       .github/workflows/build.yml only.
[CHECKPOINT] — Phase C complete. This is the full core product per
Section 10's acceptance criteria. Stop and wait for explicit go-ahead
before starting Phase D — the steps below are optional v2 differentiators,
not required for a working v1 product, and should only be built if asked.

═══════════════════════════════════════════════════════════════════
PHASE D — ADVANCED FEATURES (V2, OPTIONAL — WAIT FOR GO-AHEAD)
═══════════════════════════════════════════════════════════════════
Do not start Phase D unless explicitly told to. Each step below is
independent of the others — they do not need to be built in order,
except Step 22 (CLI) which depends on Step 21's library refactor only if
you choose to build both; if only one Phase D feature is requested,
build only that step.

STEP 21 — Execution caching
Read: Section 12.1 only
Do: Implement cache-key hashing and an in-memory ExecutionCache, wire it
    into executor.rs so each node checks the cache before executing and
    populates it after. Emit `node-status` with status "cached" for
    skipped nodes (extend the status enum from Step 17, don't replace it).
Verify: run the same graph twice without changing any node; second run's
    node-status events all show "cached" and complete near-instantly
    compared to the first run's real execution time.
Scope: src-tauri/src/cache.rs (new), executor.rs (integrate cache checks).

STEP 22 — Headless CLI runner
Read: Section 12.2 only
Do: Refactor executor.rs (and the node handler modules it depends on)
    into a library crate `hub_lib` shared by both the Tauri app binary and
    a new `hub` CLI binary. Implement `hub run <pipeline.json> --input <path>`.
Verify: `cargo build --bin hub` succeeds; `./hub run examples/qa-pipeline.json
    --input ./test-image.png` runs the pipeline and produces the expected
    output file, with zero Tauri/GUI dependencies loaded.
Scope: src-tauri/Cargo.toml (add [[bin]] + lib target), new
       src-tauri/src/bin/cli.rs, minimal executor.rs restructuring only —
       do not change executor.rs's actual node-execution logic, only how
       it's exposed/imported.

STEP 23 — Reverse mode (graph -> plain English)
Read: Section 12.3 only
Do: Add reverseTranslatorSystemPrompt.ts. Add a "Describe this graph"
    button to ExecutionToolbar.tsx that reuses the existing generate_graph
    Rust command (do not write a new Rust command) with this new system
    prompt, and posts the plain-English result as an assistant message in
    ChatPanel.tsx.
Verify: clicking the button on any existing graph (chat-built or manual)
    produces a 2-4 sentence plain-English description in the chat panel,
    with no JSON or node-id references in the output text.
Scope: lib/reverseTranslatorSystemPrompt.ts (new), ExecutionToolbar.tsx,
       ChatPanel.tsx (append-message logic only).

STEP 24 — Plugin architecture (build in sub-steps, this is the largest Phase D item)
Read: Section 12.4 in full
  24a. Manifest discovery only — implement discover_plugins() reading
       and validating manifest.json files from a `plugins/` folder, no
       execution yet. Verify: given 2 sample manifest.json files (one
       valid, one missing a required field), discover_plugins() returns
       1 valid plugin and logs a clear skip-reason for the invalid one.
  24b. Palette integration — merge discovered plugins into NodePalette.tsx
       alongside the fixed 9 built-in types, grouped under their declared
       category. Verify: a dropped-in sample plugin folder appears in the
       palette on next app launch without any code changes.
  24c. [CHECKPOINT — confirm sandboxing approach before continuing] WASM
       execution via wasmtime — only proceed after explicit confirmation,
       since this executes third-party code on the user's machine. Do not
       silently choose a sandboxing/permission model; present the planned
       wasmtime capability restrictions (no filesystem/network access by
       default) for approval first.
Scope: src-tauri/src/plugins.rs (new), NodePalette.tsx, plugins/ example
       folder — do not touch executor.rs's core node handlers.

STEP 25 — Dry-run / synthetic data mode
Read: Section 12.5 only
Do: Add a `dry_run: bool` parameter to execute_graph, implement
    synthetic_output_for() per the contract, add a toggle to
    ExecutionToolbar.tsx.
Verify: with dry-run enabled and Ollama/ChromaDB both stopped, running any
    graph completes successfully end-to-end using only synthetic data, with
    node-status events firing identically to a real run (so conditional
    routing can be visually verified with zero live services running).
Scope: executor.rs (dry_run branch only), ExecutionToolbar.tsx (toggle UI).

STEP 26 — ChromaDB inspector panel
Read: Section 12.6 only
Do: Implement the chroma_inspect Rust command and chroma_list_all helper
    in chroma.rs, build ChromaInspectorPanel.tsx opened from a
    chromadb_store node's inspector (Step 12's NodeInspector.tsx).
Verify: opening the inspector on a collection populated during Step 16c's
    testing shows its stored documents, and running a free-text query
    returns ranked results with visible similarity ordering.
Scope: src-tauri/src/commands.rs (chroma_inspect), chroma.rs
       (chroma_list_all), components/ChromaInspectorPanel.tsx (new),
       NodeInspector.tsx (add an "Inspect" button for chromadb_store only).

STEP 27 — Configurable chat-to-graph model
Read: Section 12.7(a) only
Do: Remove the hardcoded `"llama3.2"` from `generate_graph` (Step 6) —
    change its signature to accept `model: String` and an optional
    `images: Option<Vec<String>>`. Add `useSettingsStore.ts` backed by
    `tauri-plugin-store` (persisted to disk, not localStorage — this is a
    real desktop app, not a sandboxed artifact). Add a model-select
    dropdown to ChatPanel.tsx (or a settings icon) populated by
    `list_ollama_models` (Step 12), defaulting to whatever was last saved.
Verify: switching the selected model in the UI, restarting the app, and
    confirming the previously-selected model is still shown (persistence
    works); submitting a chat prompt with `qwen2.5vl:7b` selected and an
    image attached successfully includes that image in the `generate_graph`
    call's `images` field.
Scope: src-tauri/src/commands.rs (generate_graph signature only),
       lib/useSettingsStore.ts (new), ChatPanel.tsx (model selector UI +
       image attach input).

STEP 28 — In-app model downloader
Read: Section 12.7(b) only
Do: Implement `pull_model` in ollama.rs streaming Ollama's `/api/pull`
    response, emitting `model-pull-progress` events. Build
    ModelManagerPanel.tsx showing `RECOMMENDED_MODELS` (including
    `qwen2.5vl:7b`) cross-referenced against `list_ollama_models`'s
    output, each with a Download button and a live progress bar driven by
    the streamed events.
Verify: from a clean environment without `qwen2.5vl:7b` installed,
    clicking Download in ModelManagerPanel shows incrementing progress and,
    on completion, the model then appears in `list_ollama_models`'s output
    and becomes selectable in Step 27's model dropdown without restarting
    the app.
Scope: src-tauri/src/ollama.rs (pull_model), src-tauri/Cargo.toml (add
       `futures-util` dependency if not already present),
       components/ModelManagerPanel.tsx (new).

[CHECKPOINT] — end of Phase D. Stop here regardless of how many Phase D
steps were requested/completed.

═══════════════════════════════════════════════════════════════════
FINAL REPORT
═══════════════════════════════════════════════════════════════════
After the last step you were asked to complete (Step 20 if only the core
product was requested, or the relevant Phase D steps if v2 features were
included), produce ONE consolidated report checking off every item in
SPEC.md Section 10 (Acceptance Criteria) as PASS / FAIL / UNTESTED-NO-
SERVICE, with a one-line reason for any FAIL or UNTESTED item, plus a
separate short list of which Phase D steps (if any) were completed. Do
not re-explain the architecture — this report is a checklist, not a summary.
```

---
