# Build Spec: Hybrid Local AI Hub — Full System (Chat-to-Graph + Manual Canvas)

**Target tool:** Google Antigravity (agentic IDE)
**How to use this document:** Save this file as `SPEC.md` in the root of your workspace/repo before starting. Paste the "ANTIGRAVITY AGENT PROMPT" section (bottom of this file) into Antigravity as your task. Antigravity will re-read this file as it works rather than relying only on the prompt, so keep this file present throughout the build.

> **Revision note:** this version adds the pieces an agent previously had to
> guess at — a concrete runtime data-passing contract (§3.1), the actual full
> translator system prompt text with three worked few-shot examples instead of
> a description of what it should contain (§4.1), exact external API
> request/response shapes for Ollama and ChromaDB (§6.5), reference Rust
> implementations for `ollama.rs`/`chroma.rs`/`watcher.rs` (§6.6), and pinned
> dependency names for `Cargo.toml`/`package.json` (§7.1). The relevant
> STEPs in Section 11 now point at these new sections in their `Read:` lines.

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

### 3.1 Runtime execution payload (the data that flows along edges)

The tables above define the **static graph schema** (what's saved to disk / shown
in the inspector). They do NOT define what actually flows between nodes while a
graph is *running* — that is a separate, equally load-bearing contract. Without
it, Step 16's per-node handlers have no fixed shape to read from or write to, and
an agent will invent one (a hallucination risk this section closes).

Every node, when executed, produces exactly one `NodePayload` as its output. A
downstream node reads the `NodePayload`(s) of its direct upstream node(s) — never
raw graph JSON, never a global variable.

```typescript
// lib/runtimePayload.ts
export type NodePayload = {
  /** The node id that produced this payload. */
  sourceNodeId: string;
  /** Free text — user input, generated model output, or retrieved context joined
   *  into one string. Undefined if this node produced no text. */
  text?: string;
  /** Absolute path to an image file on disk. Undefined if no image is present. */
  imagePath?: string;
  /** Embedding vector, only ever produced by local_embedder. */
  embedding?: number[];
  /** Retrieved chunks from chromadb_store in "read" mode, one string per chunk. */
  contextChunks?: string[];
  /** Convenience flags so conditional_router never has to re-derive presence
   *  checks from the fields above — always set these accurately when a node
   *  produces a payload. */
  hasImage: boolean;
  hasText: boolean;
};
```

```rust
// src-tauri/src/executor.rs (payload struct — shared by every node handler)
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodePayload {
    pub source_node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_chunks: Option<Vec<String>>,
    pub has_image: bool,
    pub has_text: bool,
}
```

**Merge rule for nodes with more than one incoming edge** (e.g. `ollama_selector`
fed by both an `image_input` and a `chromadb_store` read): collect the
`NodePayload` from every incoming edge into a `Vec<NodePayload>`, then build a
single merged payload before running that node's own logic —
- `text`: join all non-empty `text` fields with `"\n\n"`, in edge-definition order.
- `contextChunks`: concatenate all non-empty arrays, in edge-definition order.
- `imagePath` / `embedding`: take the first non-`None` value found (only one
  upstream node is expected to supply these per graph; if more than one does,
  keep the first and log a `node-status` warning — do not silently drop or crash).
- `hasImage` / `hasText`: `true` if true for *any* upstream payload.

`conditional_router` always evaluates its `condition_type` against this merged
payload, never against a single upstream node in isolation.

The executor keeps a `HashMap<String, NodePayload>` (`node_id -> output`)
populated in topological order as each node finishes; a node's inputs are
looked up from this map using the edges whose `target` equals the current
node's `id`.

---

## 4. Option 1: Chat-to-Graph

### 4.1 System prompt for the translator model

Store as `src/lib/translatorSystemPrompt.ts` (TypeScript) **and** mirror
byte-identically into `src-tauri/src/commands.rs` as a Rust `&str` constant,
since Step 6 shows the actual HTTP call happens in Rust — the TypeScript copy
exists only so the frontend can display/validate against the same rules. This
is the literal string both copies must contain; Step 7 copies it verbatim, no
paraphrasing:

```
You are a graph-compiler assistant. You convert a plain-English description of
an automation pipeline into a single JSON object describing a node graph. You
must follow these rules exactly:

1. Output ONLY raw JSON. No markdown code fences, no prose before or after,
   no explanation. The first character of your output must be `{` and the
   last character must be `}`.
2. The JSON must conform to this shape:
   {
     "nodes": [
       { "id": string, "type": one of the 9 types listed below, "label": string,
         "position": { "x": number, "y": number }, "data": object (optional) }
     ],
     "edges": [
       { "id": string, "source": node id, "target": node id,
         "condition": string (optional, only on edges leaving a
         conditional_router node) }
     ],
     "meta": { "title": string, "generated_from_prompt": string }
   }
3. The ONLY valid values for "type" are exactly these 9 strings — never invent,
   rename, or abbreviate a type:
   file_watcher, image_input, text_input, local_embedder, chromadb_store,
   ollama_selector, conditional_router, local_file_writer, log_terminal
4. Populate each node's "data" field using exactly these per-type shapes and
   no other fields:
   - file_watcher: { "watch_path": string }
   - image_input: {}
   - text_input: { "default_text": string (optional) }
   - local_embedder: { "model": "nomic-embed-text" }
   - chromadb_store: { "collection_name": string, "mode": "read" | "write" }
   - ollama_selector: { "model": string }
   - conditional_router: { "condition_type": "has_image" | "has_text" | "custom",
     "expression": string (optional, only when condition_type is "custom") }
   - local_file_writer: { "output_path": string, "format": "md" | "txt" | "json" }
   - log_terminal: {}
5. Position values are rough left-to-right sequence hints only — set "x" to
   roughly (stage_index * 250) and "y" to 0 for a simple chain, spreading
   parallel branches vertically by 150 per branch. Exact final placement is
   recalculated by auto-layout after parsing, so precision here does not
   matter — sequence order does.
6. Every node must be reachable from at least one input node (file_watcher,
   image_input, or text_input) and the graph must be a DAG — never produce a
   cycle.
7. For a conditional_router node, create one edge per branch leaving it, each
   with a "condition" field matching one of that router's possible outcomes
   (e.g. "true" / "false" for has_image or has_text, or the router's
   "expression" value for a custom condition).

Below are examples of correct input/output pairs. Match this exact structure
and style for any new request.

--- EXAMPLE 1: simple linear pipeline ---
User: "Watch a folder for text files and store their embeddings in ChromaDB."
Output:
{
  "nodes": [
    { "id": "n1", "type": "file_watcher", "label": "Watch Inbox",
      "position": { "x": 0, "y": 0 }, "data": { "watch_path": "" } },
    { "id": "n2", "type": "local_embedder", "label": "Embed Text",
      "position": { "x": 250, "y": 0 }, "data": { "model": "nomic-embed-text" } },
    { "id": "n3", "type": "chromadb_store", "label": "Store Vector",
      "position": { "x": 500, "y": 0 },
      "data": { "collection_name": "inbox_docs", "mode": "write" } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2" },
    { "id": "e2", "source": "n2", "target": "n3" }
  ],
  "meta": { "title": "Text Embedding Pipeline",
    "generated_from_prompt": "Watch a folder for text files and store their embeddings in ChromaDB." }
}

--- EXAMPLE 2: conditional_router branch ---
User: "Create an automated quality assurance pipeline. Upload a product photo,
cross-reference it with a local PDF spec sheet using an 11B vision model, and
output a markdown report."
Output:
{
  "nodes": [
    { "id": "n1", "type": "image_input", "label": "Product Photo",
      "position": { "x": 0, "y": 0 }, "data": {} },
    { "id": "n2", "type": "file_watcher", "label": "PDF Spec Sheet",
      "position": { "x": 0, "y": 150 }, "data": { "watch_path": "" } },
    { "id": "n3", "type": "local_embedder", "label": "Embed Spec Text",
      "position": { "x": 250, "y": 150 }, "data": { "model": "nomic-embed-text" } },
    { "id": "n4", "type": "chromadb_store", "label": "Spec Context Lookup",
      "position": { "x": 500, "y": 150 },
      "data": { "collection_name": "spec_sheets", "mode": "read" } },
    { "id": "n5", "type": "conditional_router", "label": "Has Image?",
      "position": { "x": 250, "y": 0 }, "data": { "condition_type": "has_image" } },
    { "id": "n6", "type": "ollama_selector", "label": "Vision QA Check",
      "position": { "x": 750, "y": 0 }, "data": { "model": "llama3.2-vision" } },
    { "id": "n7", "type": "local_file_writer", "label": "Write QA Report",
      "position": { "x": 1000, "y": 0 },
      "data": { "output_path": "", "format": "md" } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n5" },
    { "id": "e2", "source": "n2", "target": "n3" },
    { "id": "e3", "source": "n3", "target": "n4" },
    { "id": "e4", "source": "n5", "target": "n6", "condition": "true" },
    { "id": "e5", "source": "n4", "target": "n6" },
    { "id": "e6", "source": "n6", "target": "n7" }
  ],
  "meta": { "title": "Product QA Vision Pipeline",
    "generated_from_prompt": "Create an automated quality assurance pipeline. Upload a product photo, cross-reference it with a local PDF spec sheet using an 11B vision model, and output a markdown report." }
}

--- EXAMPLE 3: text-only branch with a custom condition ---
User: "Take user text input, if it contains the word 'urgent' log it, otherwise
save it to a file."
Output:
{
  "nodes": [
    { "id": "n1", "type": "text_input", "label": "User Message",
      "position": { "x": 0, "y": 0 }, "data": {} },
    { "id": "n2", "type": "conditional_router", "label": "Contains 'urgent'?",
      "position": { "x": 250, "y": 0 },
      "data": { "condition_type": "custom", "expression": "text.includes('urgent')" } },
    { "id": "n3", "type": "log_terminal", "label": "Urgent Log",
      "position": { "x": 500, "y": -75 }, "data": {} },
    { "id": "n4", "type": "local_file_writer", "label": "Save Message",
      "position": { "x": 500, "y": 75 }, "data": { "output_path": "", "format": "txt" } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2" },
    { "id": "e2", "source": "n2", "target": "n3", "condition": "true" },
    { "id": "e3", "source": "n2", "target": "n4", "condition": "false" }
  ],
  "meta": { "title": "Urgent Message Router",
    "generated_from_prompt": "Take user text input, if it contains the word 'urgent' log it, otherwise save it to a file." }
}
```

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

### 6.5 External API reference — exact request/response shapes (do not invent)

These are the concrete wire shapes for every external HTTP call the app makes.
Copy field names exactly as written — do not guess plausible-looking alternatives
(e.g. `embedding` vs `embeddings`, `documents` vs `texts`). Ollama's shapes below
are stable across recent versions; ChromaDB's REST surface has changed between
major versions (0.4.x vs 0.5.x vs 1.x), so before wiring `chroma.rs`, hit
`http://localhost:8000/docs` (Chroma's own live OpenAPI page for whatever version
is actually installed) and diff it against the shapes below — treat this section
as the expected default, not an unconditional override of what the running
instance actually serves.

**Ollama — `POST /api/generate`** (used by `generate_graph` and `ollama_selector`)
```
Request:
{ "model": "llama3.2", "system": "...", "prompt": "...", "stream": false }

Response (stream: false returns one JSON object, not a stream of lines):
{ "model": "llama3.2", "response": "...the generated text...", "done": true }
```

**Ollama — `POST /api/embeddings`** (used by `local_embedder`)
```
Request:
{ "model": "nomic-embed-text", "prompt": "text to embed" }

Response:
{ "embedding": [0.0123, -0.0456, ...] }
```

**Ollama — `GET /api/tags`** (used by `list_ollama_models`)
```
Response:
{
  "models": [
    { "name": "llama3.2:latest", "model": "llama3.2:latest", "size": 2019393189,
      "modified_at": "2025-01-01T00:00:00Z" },
    { "name": "llama3.2-vision:latest", "model": "llama3.2-vision:latest", ... }
  ]
}
// list_ollama_models returns the "name" field of every entry.
```

**ChromaDB — collection existence / creation** (`chromadb_store`, either mode,
called once before the first add/query against a given `collection_name`)
```
POST /api/v1/collections
Request: { "name": "spec_sheets", "get_or_create": true }
Response: { "id": "<uuid>", "name": "spec_sheets", "metadata": null }
```

**ChromaDB — `POST /api/v1/collections/{collection_id}/add`** (`chromadb_store`,
`mode: "write"`)
```
Request:
{
  "ids": ["doc_1"],
  "embeddings": [[0.0123, -0.0456, ...]],
  "documents": ["the source text this embedding represents"],
  "metadatas": [{ "source_node_id": "n2" }]
}
Response: HTTP 201, empty body on success.
```

**ChromaDB — `POST /api/v1/collections/{collection_id}/query`** (`chromadb_store`,
`mode: "read"`)
```
Request:
{ "query_embeddings": [[0.0123, -0.0456, ...]], "n_results": 4 }

Response:
{
  "ids": [["doc_1", "doc_7"]],
  "documents": [["chunk text 1", "chunk text 2"]],
  "distances": [[0.12, 0.31]]
}
// chromadb_store in read mode sets NodePayload.contextChunks to
// response.documents[0] (the first, and only, query's result list).
```

Note: `{collection_id}` is Chroma's internal UUID returned by the
`get_or_create` call above, **not** the human-readable `collection_name` from
the graph's `data` field — `chroma.rs` must cache the name→id mapping it gets
back from the first call rather than re-deriving or guessing the id.

### 6.6 Reference implementations for supporting Rust modules

These mirror the level of detail Section 7 gives for `generate_graph` so the
agent has a concrete starting shape for the three modules Section 8 lists but
Section 7 doesn't show code for. Treat function names and signatures as fixed;
internal implementation details (error strings, retry counts) may be adapted
as long as the public shape and the API calls in Section 6.5 are respected.

```rust
// src-tauri/src/ollama.rs
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct EmbeddingsRequest<'a> { model: &'a str, prompt: &'a str }

#[derive(Deserialize)]
struct EmbeddingsResponse { embedding: Vec<f32> }

pub async fn embed_text(text: &str) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();
    let body = EmbeddingsRequest { model: "nomic-embed-text", prompt: text };
    let resp = client
        .post("http://localhost:11434/api/embeddings")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not reachable at localhost:11434: {e}"))?;
    let parsed: EmbeddingsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected Ollama /api/embeddings response shape: {e}"))?;
    Ok(parsed.embedding)
}

#[derive(Deserialize)]
struct TagsResponse { models: Vec<TagsModel> }
#[derive(Deserialize)]
struct TagsModel { name: String }

#[tauri::command]
pub async fn list_ollama_models() -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| format!("Ollama not reachable at localhost:11434: {e}"))?;
    let parsed: TagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected Ollama /api/tags response shape: {e}"))?;
    Ok(parsed.models.into_iter().map(|m| m.name).collect())
}
```

```rust
// src-tauri/src/chroma.rs
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const CHROMA_BASE: &str = "http://localhost:8000";

#[derive(Serialize)]
struct GetOrCreateRequest<'a> { name: &'a str, get_or_create: bool }
#[derive(Deserialize)]
struct CollectionResponse { id: String }

/// Resolves a human collection_name to Chroma's internal id, creating the
/// collection on first use. Cache this map in executor state so repeated
/// nodes in the same run (or later runs) don't re-create it every time.
pub async fn get_or_create_collection(
    client: &reqwest::Client,
    collection_name: &str,
) -> Result<String, String> {
    let body = GetOrCreateRequest { name: collection_name, get_or_create: true };
    let resp = client
        .post(format!("{CHROMA_BASE}/api/v1/collections"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ChromaDB not reachable at localhost:8000: {e}"))?;
    let parsed: CollectionResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected ChromaDB /api/v1/collections response shape: {e}"))?;
    Ok(parsed.id)
}

#[derive(Serialize)]
struct AddRequest {
    ids: Vec<String>,
    embeddings: Vec<Vec<f32>>,
    documents: Vec<String>,
    metadatas: Vec<HashMap<String, String>>,
}

pub async fn add_document(
    client: &reqwest::Client,
    collection_id: &str,
    doc_id: String,
    embedding: Vec<f32>,
    document: String,
    source_node_id: &str,
) -> Result<(), String> {
    let mut meta = HashMap::new();
    meta.insert("source_node_id".to_string(), source_node_id.to_string());
    let body = AddRequest {
        ids: vec![doc_id],
        embeddings: vec![embedding],
        documents: vec![document],
        metadatas: vec![meta],
    };
    client
        .post(format!("{CHROMA_BASE}/api/v1/collections/{collection_id}/add"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ChromaDB not reachable at localhost:8000: {e}"))?
        .error_for_status()
        .map_err(|e| format!("ChromaDB rejected the add request: {e}"))?;
    Ok(())
}

#[derive(Serialize)]
struct QueryRequest { query_embeddings: Vec<Vec<f32>>, n_results: u32 }
#[derive(Deserialize)]
struct QueryResponse { documents: Vec<Vec<String>> }

pub async fn query_similar(
    client: &reqwest::Client,
    collection_id: &str,
    query_embedding: Vec<f32>,
    n_results: u32,
) -> Result<Vec<String>, String> {
    let body = QueryRequest { query_embeddings: vec![query_embedding], n_results };
    let resp = client
        .post(format!("{CHROMA_BASE}/api/v1/collections/{collection_id}/query"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ChromaDB not reachable at localhost:8000: {e}"))?;
    let parsed: QueryResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected ChromaDB query response shape: {e}"))?;
    Ok(parsed.documents.into_iter().next().unwrap_or_default())
}
```

```rust
// src-tauri/src/watcher.rs
use notify::{Watcher, RecursiveMode, RecommendedWatcher, Event};
use std::path::Path;
use std::sync::mpsc::channel;
use tauri::{AppHandle, Emitter};

/// Starts watching `path` for new files. On each create event, emits a
/// `file-watcher-triggered` Tauri event carrying { node_id, file_path } so
/// executor.rs (Step 18) can kick off a full graph run. Returns immediately;
/// the watcher itself runs on a background thread until stop_file_watch
/// drops it (track the RecommendedWatcher handle per node_id in app state
/// so it can be dropped later — dropping a notify::Watcher stops it).
pub fn start_watching(
    app: AppHandle,
    node_id: String,
    path: String,
) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("Failed to create file watcher: {e}"))?;
    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch path {path}: {e}"))?;

    std::thread::spawn(move || {
        for res in rx {
            if let Ok(event) = res {
                if event.kind.is_create() {
                    if let Some(file_path) = event.paths.first() {
                        let _ = app.emit(
                            "file-watcher-triggered",
                            serde_json::json!({
                                "node_id": node_id,
                                "file_path": file_path.to_string_lossy(),
                            }),
                        );
                    }
                }
            }
        }
    });

    Ok(watcher)
}
```

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

### 7.1 Pinned dependencies (do not substitute or freelance versions)

Use these exact package names as the starting `Cargo.toml` / `package.json`
entries. Version numbers below are minimums, not exact pins — run
`cargo add` / `npm install` for the package **names** listed (they resolve the
current compatible version), but never substitute a different crate/package for
the same job (e.g. do not swap `notify` for a hand-rolled polling loop, or
`reqwest` for `hyper` directly).

```toml
# src-tauri/Cargo.toml — [dependencies] section
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
notify = "6"
lopdf = "0.32"          # or pdf-extract, per Section 2 — pick one, do not add both
anyhow = "1"

[package]
license = "MIT"
```

```json
// package.json — "dependencies" (versions illustrative; use current majors)
{
  "@xyflow/react": "^12.0.0",
  "@tauri-apps/api": "^2.0.0",
  "@tauri-apps/plugin-dialog": "^2.0.0",
  "@tauri-apps/plugin-shell": "^2.0.0",
  "dagre": "^0.8.5",
  "@types/dagre": "^0.7.52",
  "zod": "^3.23.0",
  "zustand": "^4.5.0",
  "react": "^18.3.0",
  "react-dom": "^18.3.0"
}
```

Both `tauri-plugin-dialog` and `tauri-plugin-shell` must also be registered in
`src-tauri/src/main.rs` via `.plugin(tauri_plugin_dialog::init())` and
`.plugin(tauri_plugin_shell::init())` on the `tauri::Builder` — installing the
crate/npm package alone does not activate it.

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

## 11. ANTIGRAVITY AGENT PROMPT (step-gated, anti-hallucination)

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
Read: Section 2 (Tech stack), Section 8 (file structure), Section 7.1
    (pinned dependencies — use these exact package names, do not substitute)
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
Read: Section 4.2 (call pattern), Section 7 (Rust command signatures),
    Section 6.5's `/api/generate` shape, Section 4.1's note that the system
    prompt string must be mirrored byte-identically from the TypeScript copy
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
Do: Build NodePalette.tsx listing all 9 types grouped by category exactly
    as named in Section 5.1. Implement drag-from-palette, drop-on-canvas
    creating a new node in the SAME store from Step 10 (not a new store).
Verify: dragging each of the 9 palette entries onto the canvas creates a
    node of the correct type at the drop position, visible immediately.
Scope: components/NodePalette.tsx, minor GraphCanvas.tsx drop-handler edit.

STEP 12 — Node config inspector
Read: Section 5.2 in full, and the per-type `data` field table in Section 3
Do: Build NodeInspector.tsx. Implement the list_ollama_models,
    pick_folder, pick_image Rust commands per Section 7's signatures.
Verify: selecting each of the 9 node types on canvas shows the correct
    config fields per the Section 3 table, and the Ollama model dropdown
    populates from a live (or clearly-mocked) list_ollama_models call.
Scope: components/NodeInspector.tsx, src-tauri commands.rs (3 new commands).

STEP 13 — Conditional router handles + manual wiring
Read: Section 5.3 only
Do: Give conditional_router nodes multiple named output handles per its
    condition_type. Confirm standard React Flow edge-drag wiring works
    for all node types, not just conditional_router.
Verify: manually wire a 3-node graph (input -> conditional_router ->
    2 different outputs on its two branches) entirely by drag-and-drop,
    no chat involved.
Scope: components/nodes/ConditionalRouterNode.tsx only.

STEP 14 — Node/edge CRUD + cycle validation [CHECKPOINT]
Read: Section 5.4 only
Do: Implement delete (Delete key + confirm-if-connected), duplicate, and
    a wiring guard that rejects an edge that would create a cycle.
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
Do: Implement graph compilation in executor.rs: topological sort (Kahn's
    algorithm), reject non-DAGs with a clear error even though Step 14
    should already prevent most cycles at wiring-time (defense in depth).
Verify: unit test executor.rs with a valid DAG (produces an ordered list)
    and a cyclic graph (produces the expected error, not a panic/hang).
Scope: src-tauri/src/executor.rs only.

STEP 16 — Per-node execution logic, one type at a time
Read: Section 6.2, Section 3.1 (the NodePayload contract every handler must
    read from and write to — do not invent an ad hoc payload shape), Section
    6.5 (exact Ollama/ChromaDB request/response shapes), Section 6.6
    (reference implementations for ollama.rs/chroma.rs/watcher.rs). Implement
    and verify ONE node type fully before moving to the next — do not write
    all 8 handlers in one pass.
Do, in this exact order, each with its own standalone verify before
moving on:
  16a. local_embedder -> Ollama /api/embeddings. Verify: standalone call
       against Ollama (or clearly-labeled mock) returns a vector.
  16b. ollama_selector -> Ollama /api/generate with merged upstream data.
       Verify: standalone call returns generated text (or labeled mock).
  16c. chromadb_store (write mode) -> upsert to local ChromaDB per
       Section 6.4. Verify: a document is confirmed queryable back out.
  16d. chromadb_store (read mode) -> similarity query. Verify: querying
       after 16c's write returns the expected document.
  16e. image_input / text_input -> pass-through of runtime data. Verify:
       trivial unit test of the pass-through function.
  16f. conditional_router -> evaluate condition_type, propagate only
       along the matching edge. Verify: unit test with has_image true
       and false, confirming correct branch selection both times.
  16g. local_file_writer -> Rust fs::write to output_path. Verify: file
       actually appears on disk with correct content and format.
  16h. file_watcher -> notify crate watcher registration/deregistration.
       Verify: dropping a file into a watched folder fires the expected
       Rust-side event (log it) without wiring the full graph trigger yet.
Scope: src-tauri/src/executor.rs, src-tauri/src/ollama.rs,
       src-tauri/src/chroma.rs, src-tauri/src/watcher.rs.

STEP 17 — Event streaming to frontend
Read: Section 6.3 only
Do: Emit `node-status` Tauri events from executor.rs during a real run.
    Build LogTerminal.tsx and ExecutionToolbar.tsx to subscribe and
    display live per-node status.
Verify: running any graph from Phase A or B produces visible status
    transitions (running -> success/error) on canvas nodes and a
    scrolling log in LogTerminal, in real time, not only after completion.
Scope: executor.rs (emit calls), LogTerminal.tsx, ExecutionToolbar.tsx.

STEP 18 — file_watcher end-to-end trigger [CHECKPOINT]
Read: Section 6.2's file_watcher bullet + Section 9 milestone 17 only
Do: Wire the Step 16h watcher registration to actually kick off a full
    graph execution when a new file lands in the watched folder.
Verify: drop a file into a watched folder and observe the full pipeline
    run end-to-end (status events + final output file), with no chat or
    manual "Execute" click involved.
Scope: executor.rs, watcher.rs only.

STEP 19 — Error states for unreachable services
Read: Section 5, Section 6.4, Section 7's "handle as first-class errors"
      note only
Do: Ensure every Ollama call and every ChromaDB call has a specific,
    readable error path (not a generic failure) surfaced to the UI.
Verify: with Ollama/ChromaDB stopped, trigger execution and confirm the
    UI shows the specific "X not reachable at Y" message, app doesn't
    crash, and execution can be retried after starting the service.
Scope: any file with an Ollama/ChromaDB call — grep for both client
       modules to find them all; do not touch unrelated files.

STEP 20 — Open source + cross-platform packaging [CHECKPOINT]
Read: Section 1a in full
Do: Add LICENSE (MIT), README.md, CONTRIBUTING.md per Section 1a. Add
    .gitattributes. Set up the GitHub Actions build matrix
    (.github/workflows/build.yml) across macos-latest, windows-latest,
    ubuntu-latest running npm install / cargo check / npm run tauri build.
    Grep Cargo.toml and package.json dependency trees for any GPL/AGPL
    license and flag/replace any found (do not just note it — resolve it).
Verify: CI workflow file is syntactically valid; if you can, trigger it
    and report per-OS pass/fail; if not, report that live CI confirmation
    is still needed post-merge.
Scope: LICENSE, README.md, CONTRIBUTING.md, .gitattributes,
       .github/workflows/build.yml only.
[CHECKPOINT] — final step. Stop here.

═══════════════════════════════════════════════════════════════════
FINAL REPORT
═══════════════════════════════════════════════════════════════════
After Step 20, produce ONE consolidated report checking off every item in
SPEC.md Section 10 (Acceptance Criteria) as PASS / FAIL / UNTESTED-NO-
SERVICE, with a one-line reason for any FAIL or UNTESTED item. Do not
re-explain the architecture — this report is a checklist, not a summary.
```
