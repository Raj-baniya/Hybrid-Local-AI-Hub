# Hybrid Local AI Hub

**Local-first AI workflow orchestrator.** Generate, run, and manage AI automation pipelines entirely on your machine — no cloud, no API keys, no data leaving your system.

Powered by [Ollama](https://ollama.com) (local LLMs) and [ChromaDB](https://www.trychroma.com) (local vector storage).

---

## Quick Start

```bash
# 1. Install and set up (detects Ollama, pulls default models)
hybrid-hub init

# 2. Generate a workflow from plain English
hybrid-hub chat "Watch my ./inbox folder for PDFs and summarise each one" -o summariser.json

# 3. Validate it
hybrid-hub validate summariser.json

# 4. Run it
hybrid-hub run summariser.json --watch
```

That's it. Real LLM inference, real local files, zero cloud.

---

## Installation

### Option A: Download a pre-built binary

Download the binary for your OS from the [releases page](../../releases) and put it somewhere on your PATH.

### Option B: Build from source

```bash
# Requires Rust (https://rustup.rs)
git clone <repo-url>
cd hybrid-local-ai-hub
cargo build --release
# Binary: target/release/hybrid-hub (or hybrid-hub.exe on Windows)
```

---

## Commands

| Command | Description |
|---|---|
| `hybrid-hub init` | Set up Ollama, pull recommended models, check ChromaDB |
| `hybrid-hub chat "<instruction>"` | Generate a workflow from natural language |
| `hybrid-hub validate <file>` | Check a workflow JSON for errors |
| `hybrid-hub run <file>` | Run a workflow (once, or `--watch` for continuous) |
| `hybrid-hub models list` | List installed Ollama models |
| `hybrid-hub models pull <name>` | Pull an Ollama model |
| `hybrid-hub logs <execution-id>` | Show results from a past run |
| `hybrid-hub export <file> -o <bundle.zip>` | Package a workflow for sharing |
| `hybrid-hub import <bundle.zip>` | Import a shared workflow bundle |
| `hybrid-hub template list` | Browse starter templates |
| `hybrid-hub template use <name> -o <file>` | Copy a starter template |
| `hybrid-hub examples` | See real example `chat` instructions |

---

## Workflow Node Types

Workflows are JSON graphs composed of 9 node types:

| Node | Purpose |
|---|---|
| `FileWatcherNode` | Triggers on new/changed files in a folder |
| `TextInputNode` | Provides static text or template input |
| `ImageInputNode` | Reads an image from disk |
| `OllamaSelectorNode` | Calls a local LLM via Ollama |
| `LocalEmbedderNode` | Generates embeddings (for ChromaDB) |
| `PDFExtractorNode` | Extracts text from PDFs |
| `ChromaDbStoreNode` | Stores embeddings + documents in ChromaDB |
| `ConditionalRouterNode` | Routes execution based on content |
| `LocalFileWriterNode` | Writes output to a local file |

Generate workflows with `hybrid-hub chat`, or build them manually in JSON.

---

## Recommended Models (8 GB RAM)

| Purpose | Model | Why |
|---|---|---|
| **Default chat/generation** | `llama3.2` (3B) | Best all-rounder for 8 GB, strong instruction-following |
| **Fastest** | `phi4-mini` (3.8B) | ~28 tokens/sec, good for speed-critical workflows |
| **Best reasoning** | `qwen3:4b` | Best reasoning quality in the 8 GB tier |
| **Lightest fallback** | `gemma2:2b` | For very RAM-constrained machines |
| **Embeddings** | `nomic-embed-text` | Purpose-built, ~270 MB, negligible RAM overhead |

```bash
hybrid-hub init              # pulls llama3.2 + nomic-embed-text automatically
hybrid-hub models pull phi4-mini   # add alternate models as needed
```

---

## ChromaDB Setup (optional, for embedding workflows)

ChromaDB is only required if your workflow uses `ChromaDbStoreNode` or `LocalEmbedderNode`.

```bash
pip install chromadb
chroma run --host localhost --port 8000
```

---

## Example Workflows

```bash
# See all examples
hybrid-hub examples

# Use a starter template
hybrid-hub template list
hybrid-hub template use gym-intake -o gym.json
```

Or generate anything:
```bash
hybrid-hub chat "Watch ./invoices for new PDFs, extract vendor + amount with an LLM, append to invoices.jsonl"
```

---

## Sharing Workflows

```bash
# Export a workflow with its manifest (required models, paths, etc.)
hybrid-hub export my_workflow.json -o my_bundle.zip

# On the recipient's machine
hybrid-hub import my_bundle.zip          # shows required models + flags paths to review
hybrid-hub run imported_workflow.json    # run it
```

---

## License

MIT — see [LICENSE](LICENSE).
