//! Hybrid Local AI Hub — library crate.
//!
//! All core modules exposed here for use by:
//!   - `src/main.rs` (CLI binary)
//!   - `tests/` (integration tests)
//!   - Future Tauri shell (Phase 8.5)

pub mod schema;
pub mod validate;
pub mod interpolation;
pub mod execution_record;
pub mod executor;
pub mod ollama;
pub mod chroma;
pub mod watcher;
pub mod translator_prompt;
pub mod compiler;
