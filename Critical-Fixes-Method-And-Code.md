# Critical Fixes — Method + Full Code

Assumes the Tauri (Rust backend) + React (TypeScript frontend) stack from your original project, since "buttons not working" implies the GUI build. Give this to Antigravity alongside the step-by-step prompt — this is the actual reference code for what each step should produce, so it has something concrete to match rather than inventing its own approach.

---

## ITEM 1 — Model detection on app open

**Method:** Ollama exposes `GET /api/tags` which lists installed models, and simply returns a connection error if the service isn't running at all. So detection is really a 3-state check: (a) can't connect → Ollama not running, (b) connects but empty list → no models, (c) connects with models → ready. Do this check in Rust (not JS `fetch`, to avoid CORS/webview quirks) and expose it as a Tauri command the frontend calls on mount.

**`src-tauri/src/ollama.rs`**
```rust
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OllamaModel {
    pub name: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "state")]
pub enum OllamaStatus {
    NotRunning,
    NoModels,
    Ready { models: Vec<OllamaModel> },
}

pub async fn check_ollama_status() -> OllamaStatus {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();

    let resp = match client.get("http://localhost:11434/api/tags").send().await {
        Ok(r) => r,
        Err(_) => return OllamaStatus::NotRunning,
    };

    #[derive(Deserialize)]
    struct TagsResponse {
        models: Vec<OllamaModel>,
    }

    let parsed: TagsResponse = match resp.json().await {
        Ok(p) => p,
        Err(_) => return OllamaStatus::NotRunning,
    };

    if parsed.models.is_empty() {
        OllamaStatus::NoModels
    } else {
        OllamaStatus::Ready { models: parsed.models }
    }
}

/// Streams pull progress as Tauri events named "ollama-pull-progress"
pub async fn pull_model(app: tauri::AppHandle, model_name: String) -> Result<(), String> {
    use tauri::Emitter;
    let client = reqwest::Client::new();

    let resp = client
        .post("http://localhost:11434/api/pull")
        .json(&serde_json::json!({ "name": model_name, "stream": true }))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {e}"))?;

    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        for line in chunk.split(|b| *b == b'\n') {
            if line.is_empty() { continue; }
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(line) {
                let _ = app.emit("ollama-pull-progress", &v);
                if let Some(err) = v.get("error") {
                    return Err(err.to_string());
                }
            }
        }
    }
    Ok(())
}
```

**`src-tauri/src/commands.rs`** (add these command handlers)
```rust
use crate::ollama::{check_ollama_status, pull_model, OllamaStatus};

#[tauri::command]
pub async fn cmd_check_ollama() -> OllamaStatus {
    check_ollama_status().await
}

#[tauri::command]
pub async fn cmd_pull_model(app: tauri::AppHandle, model_name: String) -> Result<(), String> {
    pull_model(app, model_name).await
}
```

Register both in `src-tauri/src/lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    // ...existing commands...
    commands::cmd_check_ollama,
    commands::cmd_pull_model,
])
```

**`src/components/ModelManagerPanel.tsx`**
```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type OllamaStatus =
  | { state: "NotRunning" }
  | { state: "NoModels" }
  | { state: "Ready"; models: { name: string }[] };

export function ModelManagerPanel() {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [pullProgress, setPullProgress] = useState<string>("");
  const [pullError, setPullError] = useState<string | null>(null);

  const checkStatus = async () => {
    const result = await invoke<OllamaStatus>("cmd_check_ollama");
    setStatus(result);
  };

  useEffect(() => {
    checkStatus(); // real check on mount, not a stub
    const unlisten = listen<any>("ollama-pull-progress", (event) => {
      setPullProgress(event.payload.status ?? JSON.stringify(event.payload));
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const handlePull = async (model: string) => {
    setPullError(null);
    setPullProgress("starting...");
    try {
      await invoke("cmd_pull_model", { modelName: model });
      await checkStatus(); // re-check for real after pull completes
    } catch (e) {
      setPullError(String(e));
    }
  };

  if (!status) return <div>Checking Ollama...</div>;

  if (status.state === "NotRunning") {
    return (
      <div className="panel">
        <p>Ollama is not running.</p>
        <ol>
          <li>Install it from <a href="https://ollama.com/download">ollama.com/download</a></li>
          <li>Run <code>ollama serve</code> in a terminal</li>
        </ol>
        <button onClick={checkStatus}>Check again</button>
      </div>
    );
  }

  if (status.state === "NoModels") {
    return (
      <div className="panel">
        <p>Ollama is running but no models are installed.</p>
        <button onClick={() => handlePull("llama3.2")}>
          Download recommended model (llama3.2)
        </button>
        {pullProgress && <p>{pullProgress}</p>}
        {pullError && (
          <div className="error">
            <p>{pullError}</p>
            <p>Manual fix: run <code>ollama pull llama3.2</code> in a terminal.</p>
          </div>
        )}
      </div>
    );
  }

  // status.state === "Ready"
  return (
    <div className="panel">
      <p>Models installed:</p>
      <ul>{status.models.map((m) => <li key={m.name}>{m.name}</li>)}</ul>
    </div>
  );
}
```

---

## ITEM 2 — Generation must only use an installed model

**Method:** Never hardcode a model name in the generation call. Fetch the real list (Item 1's `cmd_check_ollama`) first, pass the selected model explicitly into the generation command, and refuse generation entirely if the list is empty.

**`src-tauri/src/commands.rs`** (generation command signature)
```rust
#[tauri::command]
pub async fn cmd_generate_graph(model: String, instruction: String) -> Result<serde_json::Value, String> {
    let status = check_ollama_status().await;
    let installed: Vec<String> = match status {
        OllamaStatus::Ready { models } => models.into_iter().map(|m| m.name).collect(),
        _ => return Err("No local model detected — install one first.".to_string()),
    };

    if !installed.contains(&model) {
        return Err(format!(
            "Model '{model}' is not installed. Installed models: {:?}",
            installed
        ));
    }

    crate::translator::generate_graph(&model, &instruction).await
}
```

**Frontend selection (inside `ChatPanel.tsx`)**
```tsx
const [selectedModel, setSelectedModel] = useState<string>("");

// populate from the same status object ModelManagerPanel uses
useEffect(() => {
  invoke<OllamaStatus>("cmd_check_ollama").then((s) => {
    if (s.state === "Ready" && s.models.length > 0) {
      setSelectedModel(s.models[0].name); // default to first real installed model
    }
  });
}, []);

const handleGenerate = async (instruction: string) => {
  if (!selectedModel) {
    setError("No model selected — install one in the Model Manager first.");
    return;
  }
  const graph = await invoke("cmd_generate_graph", { model: selectedModel, instruction });
  // ...
};
```

This makes it structurally impossible to call generation with a model that isn't actually installed — the check happens both client-side (button disabled if `selectedModel` is empty) and server-side (Rust command re-validates against the real list).

---

## ITEM 3 — Real generation, not canned examples

**Method:** One function, one real HTTP call to `/api/generate` with `format: "json"`, parse the result against your schema, repair-loop on failure. No branching on the user's instruction text anywhere in this path.

**`src-tauri/src/translator.rs`**
```rust
use serde_json::Value;

const SYSTEM_PROMPT_TEMPLATE: &str = r#"
You generate workflow graphs as JSON matching this schema exactly:
{schema}

Valid node types: FileWatcherNode, TextInputNode, ImageInputNode, OllamaSelectorNode,
LocalEmbedderNode, PDFExtractorNode, ChromaDbStoreNode, ConditionalRouterNode, LocalFileWriterNode.

Example 1:
Instruction: "Summarize a text file and save the summary"
Output: {"version":1,"nodes":[{"id":"t1","data":{"type":"TextInputNode","text":""}},{"id":"l1","data":{"type":"OllamaSelectorNode","model":"llama3.2","temperature":0.5,"promptTemplate":"Summarize: {{input}}"}},{"id":"w1","data":{"type":"LocalFileWriterNode","outputPath":"summary.md","format":"md"}}],"edges":[{"id":"e1","source":"t1","target":"l1"},{"id":"e2","source":"l1","target":"w1"}]}

Return ONLY valid JSON. No prose, no markdown fences.
"#;

pub async fn generate_graph(model: &str, instruction: &str) -> Result<Value, String> {
    let schema = crate::schema::graph_json_schema(); // your schema export function
    let system_prompt = SYSTEM_PROMPT_TEMPLATE.replace("{schema}", &schema.to_string());

    let mut last_error: Option<String> = None;
    let mut last_output: Option<String> = None;

    for attempt in 0..3 {
        let prompt = if let (Some(err), Some(prev)) = (&last_error, &last_output) {
            format!(
                "Your previous output was invalid: {err}\nPrevious output: {prev}\nInstruction: {instruction}\nFix ONLY the error and return corrected JSON."
            )
        } else {
            format!("Instruction: {instruction}")
        };

        let client = reqwest::Client::new();
        let resp = client
            .post("http://localhost:11434/api/generate")
            .json(&serde_json::json!({
                "model": model,
                "system": system_prompt,
                "prompt": prompt,
                "format": "json",
                "stream": false,
                "options": { "temperature": 0.2 }
            }))
            .send()
            .await
            .map_err(|e| format!("Ollama request failed: {e}"))?;

        let body: Value = resp.json().await.map_err(|e| format!("Bad response: {e}"))?;
        let raw_text = body["response"].as_str().unwrap_or("").to_string();

        match serde_json::from_str::<Value>(&raw_text) {
            Ok(graph_json) => match crate::validate::validate_graph_json(&graph_json) {
                Ok(()) => return Ok(graph_json), // real success, real validated graph
                Err(errors) => {
                    last_error = Some(errors.join("; "));
                    last_output = Some(raw_text);
                }
            },
            Err(e) => {
                last_error = Some(format!("Invalid JSON: {e}"));
                last_output = Some(raw_text);
            }
        }

        eprintln!("Generation attempt {} failed: {:?}", attempt + 1, last_error);
    }

    Err(format!(
        "Generation failed after 3 attempts. Last error: {}",
        last_error.unwrap_or_default()
    ))
}
```

Note there is **no `if instruction.contains("gym")` branch anywhere** — that's the actual bug fix here if one exists in your current code. If Antigravity finds a match-on-keywords fallback, deleting it is the fix, not adding to it.

---

## ITEM 4 — Pipeline execution failing on simple nodes

**Method:** Most "simple nodes fail" bugs come from either (a) swallowed errors turning into silent no-ops, or (b) the executor trying to resolve an interpolation before validating that the input actually exists. Fix both explicitly, and make every node function return a real `Result` that propagates up.

**`src-tauri/src/executor.rs`**
```rust
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NodeError {
    #[error("Missing required input for node {0}")]
    MissingInput(String),
    #[error("Ollama call failed: {0}")]
    OllamaError(String),
    #[error("File write failed: {0}")]
    FileError(String),
    #[error("Unknown node type: {0}")]
    UnknownType(String),
}

pub async fn execute_node(
    node: &crate::schema::GraphNode,
    inputs: &HashMap<String, String>, // upstream outputs, keyed by node_id
) -> Result<String, NodeError> {
    match &node.data {
        crate::schema::NodeType::TextInputNode { text } => Ok(text.clone()),

        crate::schema::NodeType::LocalFileWriterNode { output_path, format, .. } => {
            let content = inputs.values().next()
                .ok_or_else(|| NodeError::MissingInput(node.id.clone()))?;
            std::fs::write(output_path, content)
                .map_err(|e| NodeError::FileError(e.to_string()))?;
            Ok(format!("Wrote {} bytes to {}", content.len(), output_path))
        }

        crate::schema::NodeType::OllamaSelectorNode { model, prompt_template, temperature, .. } => {
            let input = inputs.values().next()
                .ok_or_else(|| NodeError::MissingInput(node.id.clone()))?;
            let resolved_prompt = prompt_template.replace("{{input}}", input);

            let client = reqwest::Client::new();
            let resp = client
                .post("http://localhost:11434/api/generate")
                .json(&serde_json::json!({
                    "model": model, "prompt": resolved_prompt,
                    "stream": false, "options": { "temperature": temperature }
                }))
                .send().await
                .map_err(|e| NodeError::OllamaError(e.to_string()))?;

            let body: serde_json::Value = resp.json().await
                .map_err(|e| NodeError::OllamaError(e.to_string()))?;
            Ok(body["response"].as_str().unwrap_or_default().to_string())
        }

        // ... other node types follow the same pattern: real Result, no silent catch-all
        other => Err(NodeError::UnknownType(format!("{other:?}"))),
    }
}

pub async fn run_graph(graph: &crate::schema::Graph) -> Result<HashMap<String, String>, String> {
    let order = topological_sort(graph)?; // existing Kahn's algorithm fn
    let mut outputs: HashMap<String, String> = HashMap::new();

    for node_id in order {
        let node = graph.nodes.iter().find(|n| n.id == node_id).unwrap();
        let upstream: HashMap<String, String> = graph.edges.iter()
            .filter(|e| e.target == node_id)
            .filter_map(|e| outputs.get(&e.source).map(|v| (e.source.clone(), v.clone())))
            .collect();

        match execute_node(node, &upstream).await {
            Ok(output) => { outputs.insert(node_id.clone(), output); }
            Err(e) => return Err(format!("Node '{}' failed: {e}", node_id)), // real error, not swallowed
        }
    }
    Ok(outputs)
}
```

The critical difference from a broken version: **every match arm returns `Result`, and `run_graph` returns the real error message including which node failed** — instead of `unwrap()`-ing or silently returning an empty string on failure, which is the most common cause of "even simple nodes fail" with no visible reason.

---

Give this file to Antigravity as the reference implementation for the step-by-step prompt — it should adapt these to your actual current file structure/naming, not necessarily copy-paste verbatim, but the logic (real 3-state Ollama check, model-locked generation, no-keyword-matching generation, `Result`-propagating executor) is exactly what each step needs to produce.
