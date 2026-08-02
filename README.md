# Hybrid Local AI Hub — Full System (Chat-to-Graph + Manual Canvas)

A 100% offline, privacy-first, cross-platform desktop automation hub built with **Tauri 2.x + React + TypeScript + Rust**, powered by local LLMs (**Ollama**) and local vector storage (**ChromaDB**).

---

## Features

- **Option 1 — Chat-to-Graph Assistant**: Describe an automation pipeline in plain English → local LLM compiles it into a structured JSON DAG graph with schema validation and automatic 1-retry repair logic.
- **Option 2 — Manual Node Canvas**: Drag-and-drop 9 custom node types across 4 categories onto an infinite React Flow canvas with custom handle wiring, node inspector configuration, and real-time cycle rejection.
- **Shared Offline Execution Engine**: Executes pipelines locally using topological sort (Kahn's algorithm) with streaming status highlights and scrolling live log terminal output.

---

## Prerequisites & Installation

### 1. Ollama (Local LLM Engine)
Install Ollama for your operating system:
- **macOS / Linux**: `curl -fsSL https://ollama.com/install.sh | sh`
- **Windows**: Download installer from [ollama.com/download](https://ollama.com/download)

Pull recommended models:
```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

### 2. ChromaDB (Local Vector Database)
Install and launch ChromaDB locally:
```bash
pip install chromadb
chroma run --path ./chroma_data
```

---

## Building from Source

### Prerequisites
- Node.js (v18+)
- Rust & Cargo (`rustup target add ...`)

### Build Steps (macOS / Windows / Linux)

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode
npm run tauri dev

# 3. Build native production installer (.dmg, .msi, .AppImage)
npm run tauri build
```

---

## License

This project is licensed under the [MIT License](LICENSE).
