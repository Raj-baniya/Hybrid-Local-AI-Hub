# Data Analysis Architecture Rules

When implementing or extending data analysis features in this repository, you MUST adhere to the following architectural rules derived from the Hybrid Local AI Hub Data Analysis Architecture:

1. **Determinism over AI for Compute (P2)**
   - Never use an LLM for arithmetic, statistics, SQL, joins, ML fitting, or chart data.
   - If a task can be done deterministically using DuckDB, Polars, SciPy, or sklearn, use them. The LLM is a planner/interpreter, NOT a calculator.

2. **Data Isolation (P5)**
   - Raw data row dumps do NOT enter the LLM context window.
   - Only feed schemas, profiles (like min/max, null counts), aggregates, and explicitly provenanced samples to prompts.

3. **Verifiable Numbers (P3 & P6)**
   - Every number presented to the user must be traceable to a deterministic execution over real data.
   - A full lineage record must be maintained so runs are reproducible.

4. **Tech Stack Constraints**
   - **Compute**: DuckDB (analytical SQL), Polars (lazy dataframes), Apache Arrow (interchange), SciPy/statsmodels (classical stats).
   - **Presentation**: Vega-Lite JSON (charts), Markdown (reports).
   - **AI Runtime**: Ollama (local default).

5. **Node Architecture & Safety (P8)**
   - Side effects (fs.write, net.egress, db.write) must be explicitly gated.
   - Every new capability must be added as a Node with a explicit `NodeManifest` (inputs, outputs, side effects, planner hints).
   - Do NOT implement un-budgeted autonomous loops. Autonomy is metered per run.

6. **Schema Enforcement**
   - Use the canonical schemas (DatasetRef, DatasetVersion, TableSchema, DataProfile, NodeManifest). 
   - Never invent parallel data shapes. Add fields, but never rename or repurpose existing ones.

# Execution Pipeline & Architecture Rules

1. **Exhaustive Node Execution**
   - Every new node type defined in `schema.rs` MUST have corresponding, robust execution logic implemented in the `match node_data` block of `executor.rs:execute_node`. 

2. **Dual-Mode Trigger Resilience**
   - Trigger nodes (like `FileWatcherNode` or `ScheduleNode`) MUST support dual-mode execution:
     - **Event-Driven:** Process the explicit trigger source path/timestamp injected by the orchestrator.
     - **Manual GUI Execution:** Automatically simulate a trigger (e.g., scanning the target directory for the most recently modified file matching the glob pattern) so the downstream pipeline has real data to test against, rather than failing on dummy placeholder strings.

3. **Async Lifetime Safety in Tokio Spawns**
   - When spawning asynchronous background tasks (`tokio::spawn(async move { ... })`), all referenced variables (especially strings and configs) MUST be cloned into fully owned types (e.g., `String`, `Arc`) *before* the closure to prevent `'static` lifetime borrowing errors (Error E0521).

4. **React UI Portaling for Modals**
   - All modal dialogs or pre-flight UI components in React MUST use `ReactDOM.createPortal(..., document.body)` to escape constrained CSS stacking contexts (`zIndex` and `position` trapping) from parent components (e.g., `TopBar`).
