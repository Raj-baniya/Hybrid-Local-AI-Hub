//! System prompt builder for the chat-to-graph compiler.
//!
//! Produces the schema + examples prompt sent to the LLM. The schema is derived
//! directly from the `NodeType` enum so it stays in sync with `schema.rs`.
//! A `cargo test schema_prompt_not_stale` verifies the schema snapshot matches.

pub fn build_system_prompt() -> String {
    format!(
        "{}\n\n{}\n\n{}",
        SCHEMA_SECTION,
        EXAMPLES_SECTION,
        INSTRUCTIONS_SECTION
    )
}

// â”€â”€â”€ Schema section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Hand-maintained but verified by cargo test (see tests/schema_tests.rs).
// Update whenever schema.rs changes.

const SCHEMA_SECTION: &str = r#"
## Workflow Graph Schema

You must output ONLY valid JSON matching this schema â€” no prose, no markdown fences.

### Top-level object
```
{
  "version": 1,
  "nodes": [ GraphNode, ... ],
  "edges": [ GraphEdge, ... ]
}
```

### GraphNode
```
{
  "id": "<unique_string>",
  "position": null,
  "data": <NodeType>
}
```

### GraphEdge
```
{
  "id": "<unique_string>",
  "source": "<node_id>",
  "source_handle": null,
  "target": "<node_id>",
  "target_handle": null
}
```

### NodeType variants (use the exact "type" string shown)

**FileWatcherNode** â€” watches a directory for file events
```json
{ "type": "FileWatcherNode", "watchPath": "./folder", "pattern": "*.pdf", "recursive": false }
```

**TextInputNode** â€” provides static text or a template
```json
{ "type": "TextInputNode", "text": "Process this: {{upstream_id.output}}" }
```

**ImageInputNode** â€” reads an image from disk
```json
{ "type": "ImageInputNode", "imagePath": "./photo.jpg" }
```

**OllamaSelectorNode** â€” calls a local LLM
```json
{ "type": "OllamaSelectorNode", "model": "llama3.2", "temperature": 0.7,
  "promptTemplate": "Summarize: {{input}}", "jsonMode": false }
```
(Use `{{input}}` only when this node has exactly ONE incoming edge; otherwise use `{{node_id.output}}`)

**LocalEmbedderNode** â€” generates embeddings via Ollama
```json
{ "type": "LocalEmbedderNode", "model": "nomic-embed-text" }
```

**PDFExtractorNode** â€” extracts text from a PDF
```json
{ "type": "PDFExtractorNode", "pageRange": null }
```

**ChromaDbStoreNode** â€” stores embeddings + documents in ChromaDB
```json
{ "type": "ChromaDbStoreNode", "collectionName": "my_collection",
  "chromaUrl": "http://localhost:8000",
  "inputMap": { "vector": "embedder1.output", "document": "pdf1.output" } }
```
(inputMap maps named inputs to "node_id.output" references)

**ConditionalRouterNode** â€” routes based on a condition
```json
{ "type": "ConditionalRouterNode", "condition": "weight_loss",
  "trueTarget": "node_id_a", "falseTarget": "node_id_b" }
```
(condition is a substring match against the input)

**LocalFileWriterNode** â€” writes text to a file
```json
{ "type": "LocalFileWriterNode", "outputPath": "./output/result.txt", "append": false }
```

### Rules
- Graphs MUST be DAGs (no cycles).
- Every edge `source` and `target` must match an existing node `id`.
- ConditionalRouterNode `trueTarget` and `falseTarget` must be existing node ids.
- `{{input}}` is only valid on nodes with exactly one incoming edge. Otherwise use `{{node_id.output}}`.
- The closed vocabulary is exactly the 9 node types above. Do not invent new types.
"#;

// â”€â”€â”€ Examples section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const EXAMPLES_SECTION: &str = r#"
## Worked Examples

### Example 1: "Watch a folder for new text files and summarize each one, saving the summary"
```json
{
  "version": 1,
  "nodes": [
    { "id": "watcher1", "position": null, "data": { "type": "FileWatcherNode", "watchPath": "./inbox", "pattern": "*.txt", "recursive": false } },
    { "id": "llm1",     "position": null, "data": { "type": "OllamaSelectorNode", "model": "llama3.2", "temperature": 0.5, "promptTemplate": "Summarize this document concisely:\n\n{{input}}", "jsonMode": false } },
    { "id": "writer1",  "position": null, "data": { "type": "LocalFileWriterNode", "outputPath": "./summaries/summary.txt", "append": false } }
  ],
  "edges": [
    { "id": "e1", "source": "watcher1", "source_handle": null, "target": "llm1",    "target_handle": null },
    { "id": "e2", "source": "llm1",     "source_handle": null, "target": "writer1", "target_handle": null }
  ]
}
```

### Example 2: "Extract text from PDFs in a folder, embed them, and store in ChromaDB for later search"
```json
{
  "version": 1,
  "nodes": [
    { "id": "watcher1",  "position": null, "data": { "type": "FileWatcherNode", "watchPath": "./pdfs", "pattern": "*.pdf", "recursive": false } },
    { "id": "pdf1",      "position": null, "data": { "type": "PDFExtractorNode", "pageRange": null } },
    { "id": "embedder1", "position": null, "data": { "type": "LocalEmbedderNode", "model": "nomic-embed-text" } },
    { "id": "chroma1",   "position": null, "data": { "type": "ChromaDbStoreNode", "collectionName": "documents", "chromaUrl": "http://localhost:8000", "inputMap": { "vector": "embedder1.output", "document": "pdf1.output" } } }
  ],
  "edges": [
    { "id": "e1", "source": "watcher1",  "source_handle": null, "target": "pdf1",      "target_handle": null },
    { "id": "e2", "source": "pdf1",      "source_handle": null, "target": "embedder1", "target_handle": null },
    { "id": "e3", "source": "embedder1", "source_handle": null, "target": "chroma1",   "target_handle": null }
  ]
}
```

### Example 3: "Take a customer support ticket as input and route it: if it mentions billing, write to billing_queue.txt, otherwise write to general_queue.txt"
```json
{
  "version": 1,
  "nodes": [
    { "id": "input1",    "position": null, "data": { "type": "TextInputNode", "text": "{{input}}" } },
    { "id": "classify1", "position": null, "data": { "type": "OllamaSelectorNode", "model": "llama3.2", "temperature": 0.1, "promptTemplate": "Classify this ticket. If it is about billing, reply with 'billing'. Otherwise reply with 'general'. Ticket:\n\n{{input1.output}}", "jsonMode": false } },
    { "id": "router1",   "position": null, "data": { "type": "ConditionalRouterNode", "condition": "billing", "trueTarget": "writer_billing", "falseTarget": "writer_general" } },
    { "id": "writer_billing", "position": null, "data": { "type": "LocalFileWriterNode", "outputPath": "./queues/billing_queue.txt", "append": true } },
    { "id": "writer_general", "position": null, "data": { "type": "LocalFileWriterNode", "outputPath": "./queues/general_queue.txt", "append": true } }
  ],
  "edges": [
    { "id": "e1", "source": "input1",    "source_handle": null, "target": "classify1",     "target_handle": null },
    { "id": "e2", "source": "classify1", "source_handle": null, "target": "router1",        "target_handle": null },
    { "id": "e3", "source": "router1",   "source_handle": null, "target": "writer_billing", "target_handle": null },
    { "id": "e4", "source": "router1",   "source_handle": null, "target": "writer_general", "target_handle": null }
  ]
}
```
"#;

// â”€â”€â”€ Instructions section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const INSTRUCTIONS_SECTION: &str = r#"
## Your Task

The user will describe a workflow automation. Generate a valid JSON graph for it using ONLY the 9 node types above.

Rules:
1. Output ONLY the JSON object â€” no markdown, no explanation, no ```json fences.
2. Generate meaningful, descriptive node IDs (e.g. "pdf_extractor", "llm_planner", not "node1").
3. Use the exact camelCase field names shown in the schema.
4. Every edge must connect two real node ids in the graph.
5. Ensure the graph is a DAG â€” no cycles.
6. If the user's instruction implies a file trigger, use FileWatcherNode.
7. If multiple nodes feed into ChromaDbStoreNode, always use inputMap.
8. Make reasonable assumptions for unspecified details (model name, output paths, etc.).
9. Do not use node types outside the 9 defined above â€” if the user asks for something
   that maps to no node type (e.g. "send email"), explain in a comment field that it
   is outside the vocabulary â€” actually you cannot add comment fields, just omit it
   and use a LocalFileWriterNode to write the email content to a file as a workaround.
"#;
