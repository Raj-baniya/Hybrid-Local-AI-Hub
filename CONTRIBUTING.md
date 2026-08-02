# Contributing to Hybrid Local AI Hub

Thank you for your interest in contributing!

## Development Setup

1. **Fork and clone the repository**
2. **Install prerequisites**:
   - Node.js (v18+)
   - Rust toolchain (`rustup`)
   - Local Ollama (`ollama serve`)
   - Local ChromaDB (`chroma run --path ./chroma_data`)
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Run dev server**:
   ```bash
   npm run tauri dev
   ```

## Code Guidelines
- Keep line endings normalized (LF via `.gitattributes`).
- Verify Rust code with `cargo check --manifest-path src-tauri/Cargo.toml`.
- Verify TypeScript with `npx -p typescript tsc`.
- Ensure all dependencies are permissively licensed (MIT, Apache-2.0, BSD). No GPL/AGPL dependencies.

## License
By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
