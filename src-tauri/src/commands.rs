use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

use notify::RecommendedWatcher;

pub struct WatcherState {
    pub watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

const TRANSLATOR_SYSTEM_PROMPT: &str = r#"You are a graph-compiler assistant. You convert a plain-English description of
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
}"#;

#[derive(Serialize)]
struct OllamaGenerateRequest<'a> {
    model: &'a str,
    system: &'a str,
    prompt: &'a str,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaGenerateResponse {
    response: String,
    #[allow(dead_code)]
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
        system: TRANSLATOR_SYSTEM_PROMPT,
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

#[tauri::command]
pub async fn list_ollama_models() -> Result<Vec<String>, String> {
    crate::ollama::list_ollama_models().await.or_else(|_| {
        Ok(vec![
            "llama3.2:latest".to_string(),
            "llama3.2-vision:latest".to_string(),
            "qwen2.5:latest".to_string(),
            "nomic-embed-text:latest".to_string(),
        ])
    })
}

#[tauri::command]
pub async fn pick_folder<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    match folder {
        Some(path) => Ok(path.to_string()),
        None => Err("No folder selected".to_string()),
    }
}

#[tauri::command]
pub async fn pick_image<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app
        .dialog()
        .file()
        .add_filter("Image", &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file();
    match file {
        Some(path) => Ok(path.to_string()),
        None => Err("No image selected".to_string()),
    }
}

#[tauri::command]
pub async fn execute_graph<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    graph: crate::executor::GraphState,
) -> Result<(), String> {
    crate::executor::execute_graph_pipeline(app, graph).await
}

#[tauri::command]
pub async fn start_file_watch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, WatcherState>,
    path: String,
    node_id: String,
) -> Result<(), String> {
    let watcher = crate::watcher::start_watching(app, node_id.clone(), path)?;
    let mut map = state
        .watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    map.insert(node_id, watcher);
    Ok(())
}

#[tauri::command]
pub async fn stop_file_watch(
    state: tauri::State<'_, WatcherState>,
    node_id: String,
) -> Result<(), String> {
    let mut map = state
        .watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    map.remove(&node_id);
    Ok(())
}

#[tauri::command]
pub async fn write_output(
    path: String,
    content: String,
    format: String,
) -> Result<(), String> {
    let target_file = format!("{}/output.{}", path.trim_end_matches('/'), format);
    std::fs::write(&target_file, content)
        .map_err(|e| format!("Failed to write output to {target_file}: {e}"))?;
    Ok(())
}
