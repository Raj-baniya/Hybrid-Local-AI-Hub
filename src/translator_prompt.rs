//! System prompt builder for the chat-to-graph compiler.
//!
//! Produces the schema + examples prompt sent to the LLM. The schema is derived
//! directly from the `NodeType` enum so it stays in sync with `schema.rs`.
//! A `cargo test schema_prompt_not_stale` verifies the schema snapshot matches.

pub fn build_system_prompt(is_offline: bool) -> String {
    let mut schema = SCHEMA_SECTION_PART_1.to_string();
    if !is_offline {
        schema.push_str(WEB_SCRAPER_NODE_SCHEMA);
    }
    schema.push_str(SCHEMA_SECTION_PART_2);

    let mut instructions = INSTRUCTIONS_SECTION.to_string();

    if is_offline {
        schema = schema.replace("32 Node Types Available", "31 Node Types Available"); // Assuming there's a count in schema
        instructions = instructions.replace("32 available node types", "31 available node types");
        instructions = instructions.replace("outside the 32 available nodes", "outside the 31 available nodes");
        instructions = instructions.replace(
            "NOTE: The following analytics nodes are currently UNAVAILABLE and MUST NOT be used:",
            "NOTE: The following nodes are currently UNAVAILABLE and MUST NOT be used:\n- WebScraperNode (Offline Mode Active)"
        );
    }

    let mut examples = EXAMPLES_SECTION.to_string();
    if is_offline {
        if let Some(pos) = examples.find("### Example 4:") {
            examples.truncate(pos);
        }
    }

    format!(
        "{}\n\n{}\n\n{}",
        schema,
        examples,
        instructions
    )
}

// ─── Schema section ─────────────────────────────────────────────────────────────
// Hand-maintained but verified by cargo test (see tests/schema_tests.rs).
// Update whenever schema.rs changes.

const SCHEMA_SECTION_PART_1: &str = r#"
## Workflow Graph Schema

You must output ONLY valid JSON matching this schema — no prose, no markdown fences.

### Top-level object
```
{
  "version": 1,
  "name": "<Short, descriptive title for this agent/workflow>",
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

**FileWatcherNode** — watches a directory for file events
```json
{ "type": "FileWatcherNode", "watchPath": "./folder", "pattern": "*.pdf", "recursive": false }
```

**TextInputNode** — provides static text or a template
```json
{ "type": "TextInputNode", "text": "Process this: {{upstream_id.output}}" }
```
(TextInputNode with no incoming edges MUST contain real hardcoded text, NOT `{{input}}`. Use `{{input}}` or `{{node_id.output}}` only when the node has incoming edges.)

**ImageInputNode** — reads an image from disk
```json
{ "type": "ImageInputNode", "imagePath": "./photo.jpg" }
```

**OllamaSelectorNode** — calls a local LLM
```json
{ "type": "OllamaSelectorNode", "model": "llama3.2",
  "promptTemplate": "Summarize: {{input}}", "jsonMode": false }
```
(Use `{{input}}` only when this node has exactly ONE incoming edge; otherwise use `{{node_id.output}}`)

**LocalEmbedderNode** — generates embeddings via Ollama
```json
{ "type": "LocalEmbedderNode", "model": "nomic-embed-text" }
```

**PDFExtractorNode** — extracts text from a PDF
```json
{ "type": "PDFExtractorNode", "pageRange": null }
```

**ChromaDbStoreNode** — stores embeddings + documents in ChromaDB
```json
{ "type": "ChromaDbStoreNode", "collectionName": "my_collection",
  "chromaUrl": "http://localhost:8000",
  "inputMap": { "vector": "embedder1.output", "document": "pdf1.output" } }
```
(inputMap maps named inputs to "node_id.output" references)

**ConditionalRouterNode** — routes based on a condition
```json
{ "type": "ConditionalRouterNode", "condition": "weight_loss",
  "trueTarget": "node_id_a", "falseTarget": "node_id_b" }
```
(condition is a substring match against the input)

**LocalFileWriterNode** — writes text to a file
```json
{ "type": "LocalFileWriterNode", "outputPath": "./Agent JSON files/Agent Output/result.txt", "append": false }
```
"#;

const WEB_SCRAPER_NODE_SCHEMA: &str = r#"
**WebScraperNode** — fetches content from a URL
```json
{ "type": "WebScraperNode", "url": "https://example.com" }
```
"#;

const SCHEMA_SECTION_PART_2: &str = r#"
**ShellCommandNode** — runs a local shell command (Powershell/Bash)
```json
{ "type": "ShellCommandNode", "command": "python script.py {{input}}" }
```

**RegexExtractorNode** — extracts structured data via regex
```json
{ "type": "RegexExtractorNode", "pattern": "Email: ([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})", "group": 1 }
```

**ScheduleNode** - triggers workflow periodically based on a cron expression
```json
{ "type": "ScheduleNode", "cronExpression": "0 0 */2 * * *" }
```

**SourceFileNode** - loads a dataset (CSV, Parquet, etc.)
```json
{ "type": "SourceFileNode", "path": "./data.csv", "connector": "auto" }
```

**DatasetProfileNode** - computes statistics and quality profiles for a dataset deterministically
```json
{ "type": "DatasetProfileNode", "mode": "auto" }
```

**TransformAggregateNode** - deterministically aggregates data
```json
{ "type": "TransformAggregateNode", "groupBy": ["region"], "aggregations": ["sum(revenue)"] }
```

**AnalysisStatsHypothesisTestNode** - performs statistical hypothesis testing
```json
{ "type": "AnalysisStatsHypothesisTestNode", "test": "t-test", "groupColumn": "variant", "valueColumn": "conversion_rate" }
```

**AiPlanNode** - acts as the Planner role (R2) to generate an execution plan for a complex objective
```json
{ "type": "AiPlanNode", "objective": "Analyze regional sales", "modelRole": "Planner" }
```

**NotifyDesktopNode** - sends a native OS desktop notification
```json
{ "type": "NotifyDesktopNode", "title": "System Alert", "body": "CPU usage is at {{input}}%" }
```

**NotifyWebhookNode** - sends an HTTP POST request with a JSON payload
```json
{ "type": "NotifyWebhookNode", "url": "https://hooks.slack.com/services/T000/B000/XXX", "payload": "{ \"text\": \"Alert: {{input}}\" }" }
```

**ClipboardTriggerNode** - triggers execution on clipboard content
```json
{ "type": "ClipboardTriggerNode" }
```

**CsvReaderNode** - reads a CSV file from a path
```json
{ "type": "CsvReaderNode", "filePath": "./data.csv", "hasHeaderRow": true }
```

**DelayNode** - delays execution
```json
{ "type": "DelayNode", "delayMs": 5000 }
```

**TemplateFormatterNode** - formats text with templates
```json
{ "type": "TemplateFormatterNode", "template": "Result: {{node_id.output}}" }
```

**MergeNode** - merges multiple inputs
```json
{ "type": "MergeNode", "strategy": "concat" }
```

**AiInterpretNode** - interprets text or data using local AI
```json
{ "type": "AiInterpretNode", "prompt": "Interpret this: {{input}}", "jsonMode": false }
```

### Rules
- Graphs MUST be DAGs (no cycles).
- Every edge `source` and `target` must match an existing node `id`.
- ConditionalRouterNode `trueTarget` and `falseTarget` must be existing node ids.
- `{{input}}` is only valid on nodes with exactly one incoming edge. Otherwise use `{{node_id.output}}`.
- A TextInputNode with zero incoming edges MUST contain real hardcoded text (e.g. "My customer complaint is about billing"). NEVER use `{{input}}` on a source TextInputNode.
- The closed vocabulary is exactly the 32 available node types defined above. The analytics and notification nodes are available. Do not invent new types.
- ALWAYS use a highly specific filename for LocalFileWriterNode `outputPath` based on the task (e.g. `./Agent JSON files/Agent Output/fitness_plan.txt` instead of generic `result.txt`) so multiple agents don't overwrite each other's outputs.
- YOU ARE AN EXPERT PROMPT ENGINEER. When generating `promptTemplate` for `OllamaSelectorNode`, NEVER use a basic one-liner like "Summarize this: {{input}}". You MUST generate a highly detailed, professional prompt containing: 1) A clear persona/role, 2) Step-by-step thinking instructions, and 3) Strict output formatting constraints. For example: "You are an expert financial analyst. Read the following text and extract key metrics. Think step-by-step. Output your final answer as a markdown list. Text to analyze:\n\n{{input}}"
"#;

// ─── Examples section ─────────────────────────────────────────────────────────────

const EXAMPLES_SECTION: &str = r#"
## Worked Examples

### Example 1: "Watch a folder for new text files and summarize each one, saving the summary"
```json
{
  "version": 1,
  "name": "Folder Summarizer",
  "nodes": [
    { "id": "watcher1", "position": null, "data": { "type": "FileWatcherNode", "watchPath": "./inbox", "pattern": "*.txt", "recursive": false } },
    { "id": "llm1",     "position": null, "data": { "type": "OllamaSelectorNode", "model": "llama3.2", "promptTemplate": "You are an expert technical writer. Read the following document and provide a concise, 3-sentence summary highlighting the main conclusions. Document:\n\n{{input}}", "jsonMode": false } },
    { "id": "writer1",  "position": null, "data": { "type": "LocalFileWriterNode", "outputPath": "./Agent JSON files/Agent Output/summary.txt", "append": false } }
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
  "name": "PDF Embedder to Chroma",
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
  "name": "Support Ticket Classifier",
  "nodes": [
    { "id": "input1",    "position": null, "data": { "type": "TextInputNode", "text": "Hi, I was charged twice on my credit card for order #12345. Please help me get a refund." } },
    { "id": "classify1", "position": null, "data": { "type": "OllamaSelectorNode", "model": "llama3.2", "promptTemplate": "You are a customer support triage agent. Read the ticket below and classify it strictly as either 'billing' or 'general'. Output only the single classification word. Ticket:\n\n{{input1.output}}", "jsonMode": false } },
    { "id": "router1",   "position": null, "data": { "type": "ConditionalRouterNode", "condition": "billing", "trueTarget": "writer_billing", "falseTarget": "writer_general" } },
    { "id": "writer_billing", "position": null, "data": { "type": "LocalFileWriterNode", "outputPath": "./Agent JSON files/Agent Output/billing_queue.txt", "append": true } },
    { "id": "writer_general", "position": null, "data": { "type": "LocalFileWriterNode", "outputPath": "./Agent JSON files/Agent Output/general_queue.txt", "append": true } }
  ],
  "edges": [
    { "id": "e1", "source": "input1",    "source_handle": null, "target": "classify1",     "target_handle": null },
    { "id": "e2", "source": "classify1", "source_handle": null, "target": "router1",        "target_handle": null },
    { "id": "e3", "source": "router1",   "source_handle": "true", "target": "writer_billing", "target_handle": null },
    { "id": "e4", "source": "router1",   "source_handle": "false", "target": "writer_general", "target_handle": null }
  ]
}
```

### Example 4: "Create a bot that fetches tech news daily, extracts keywords using regex, and commits them to git via shell command"
```json
{
  "version": 1,
  "name": "Tech News Git Bot",
  "nodes": [
    { "id": "timer1",   "position": null, "data": { "type": "ScheduleNode", "cronExpression": "0 0 8 * * *" } },
    { "id": "scraper1", "position": null, "data": { "type": "WebScraperNode", "url": "https://news.ycombinator.com" } },
    { "id": "llm1",     "position": null, "data": { "type": "OllamaSelectorNode", "model": "llama3.2", "promptTemplate": "You are an AI analyst. Extract the top 3 technology keywords from the following raw html/text:\n\n{{input}}\n\nOutput ONLY a comma-separated list of the 3 keywords (e.g. AI, Rust, Security).", "jsonMode": false } },
    { "id": "regex1",   "position": null, "data": { "type": "RegexExtractorNode", "pattern": "^(.*)$", "group": 1 } },
    { "id": "format1",  "position": null, "data": { "type": "TextInputNode", "text": "Daily Keywords: {{input}}" } },
    { "id": "writer1",  "position": null, "data": { "type": "LocalFileWriterNode", "outputPath": "./Agent JSON files/Agent Output/daily_keywords.txt", "append": false } },
    { "id": "shell1",   "position": null, "data": { "type": "ShellCommandNode", "command": "git commit -F './Agent JSON files/Agent Output/daily_keywords.txt'" } }
  ],
  "edges": [
    { "id": "e1", "source": "timer1",   "source_handle": null, "target": "scraper1", "target_handle": null },
    { "id": "e2", "source": "scraper1", "source_handle": null, "target": "llm1",     "target_handle": null },
    { "id": "e3", "source": "llm1",     "source_handle": null, "target": "regex1",   "target_handle": null },
    { "id": "e4", "source": "regex1",   "source_handle": null, "target": "format1",  "target_handle": null },
    { "id": "e5", "source": "format1",  "source_handle": null, "target": "writer1",  "target_handle": null },
    { "id": "e6", "source": "writer1",  "source_handle": null, "target": "shell1",   "target_handle": null }
  ]
}
```
"#;

// ─── Instructions section ─────────────────────────────────────────────────────────────

const INSTRUCTIONS_SECTION: &str = r#"
## Your Task

You are an Autonomous Agent Architect. The user will describe a workflow automation, bot, or agent. Generate a valid JSON graph for it using ONLY the 32 available node types. 

NOTE: The following analytics nodes are currently UNAVAILABLE and MUST NOT be used:
- SourceFileNode
- DatasetProfileNode
- TransformAggregateNode
- AnalysisStatsHypothesisTestNode
- AiInterpretNode

Rules:
1. Output ONLY the JSON object — no markdown, no explanation, no ```json fences.
2. Generate meaningful, descriptive node IDs (e.g. "pdf_extractor", "llm_planner", not "node1").
3. Generate a highly descriptive, concise `name` for the graph that represents what it does.
4. Use the exact camelCase field names shown in the schema.
5. Every edge must connect two real node ids in the graph.
6. Ensure the graph is a DAG — no cycles.
7. If the user's instruction implies a file trigger, use FileWatcherNode.
8. CRITICAL - AUTONOMY: If the user's instruction implies a time-based trigger, periodic task (e.g. "every 2 hours", "daily", "always running"), or an "automated bot/agent", YOU MUST START THE GRAPH WITH A `ScheduleNode`. This gives the agent autonomy to run on its own. Use standard cron expressions.
9. If multiple nodes feed into ChromaDbStoreNode, always use inputMap.
10. Make reasonable assumptions for unspecified details (model name, output paths, etc.).
11. Do not use node types outside the 32 available nodes defined above. The analytics and notification nodes are available.
12. CRITICAL - EXPERT PROMPTING: When configuring OllamaSelectorNode, ALWAYS act as an expert Prompt Engineer. Write complex, comprehensive `promptTemplate` values with persona, step-by-step instructions, and formatting rules.
13. For AiPlanNode, always make sure the upstream data dependencies are properly connected.
"#;
