//! Tauri IPC commands exposing core Hybrid Local AI Hub engine to the GUI frontend.
//!
//! Mirrors CLI functionality without duplication: calls into `hybrid_local_ai_hub` library.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Deserialize;
use tauri::Emitter;
use tokio::sync::Mutex;

use hybrid_local_ai_hub::compiler;
use hybrid_local_ai_hub::execution_record::ExecutionRecord;
use hybrid_local_ai_hub::executor::{self, ExecutorConfig, FailurePolicy};
use hybrid_local_ai_hub::ollama::{ModelInfo, OllamaClient, OllamaStatus, check_ollama_status};
use hybrid_local_ai_hub::schema::Graph;
use hybrid_local_ai_hub::validate;

// â”€â”€â”€ Shared state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Tracks in-progress model pulls so they can be cancelled.
#[derive(Default)]
pub struct PullState {
    pub active_pulls: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

// â”€â”€â”€ Executor config payload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutorConfigPayload {
    pub ollama_url: Option<String>,
    pub chroma_url: Option<String>,
    pub continue_on_failure: Option<bool>,
    pub default_timeout_secs: Option<u64>,
    pub llm_timeout_secs: Option<u64>,
}

// â”€â”€â”€ Commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// 1. Run a workflow graph end-to-end.
#[tauri::command]
pub async fn run_graph(
    app: tauri::AppHandle,
    graph: Graph,
    config: Option<ExecutorConfigPayload>,
) -> Result<ExecutionRecord, String> {
    // Validate first before executing.
    validate::validate_graph(&graph).map_err(|errs| errs.join("\n"))?;

    let default_cfg = ExecutorConfig::default();
    let executor_cfg = if let Some(c) = config {
        ExecutorConfig {
            ollama_url: c.ollama_url.unwrap_or(default_cfg.ollama_url),
            chroma_url: c.chroma_url.unwrap_or(default_cfg.chroma_url),
            failure_policy: if c.continue_on_failure.unwrap_or(false) {
                FailurePolicy::ContinueIndependentBranches
            } else {
                FailurePolicy::HaltOnFailure
            },
            default_timeout_secs: c.default_timeout_secs.unwrap_or(default_cfg.default_timeout_secs),
            llm_timeout_secs: c.llm_timeout_secs.unwrap_or(default_cfg.llm_timeout_secs),
        }
    } else {
        default_cfg
    };

    let _ = app.emit("execution-status", "running");

    // Spawn a relay task: forwards per-node records from the executor to the frontend.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let app_relay = app.clone();
    tokio::spawn(async move {
        while let Some(node_record) = rx.recv().await {
            let _ = app_relay.emit("node-progress", node_record);
        }
    });

    match executor::run_graph(&graph, executor_cfg, "gui", Some(tx)).await {
        Ok(record) => {
            let _ = app.emit("execution-completed", &record);
            Ok(record)
        }
        Err(e) => {
            let _ = app.emit("execution-status", "failed");
            Err(e.to_string())
        }
    }
}

/// 2. Validate a workflow graph against native schema rules.
#[tauri::command]
pub fn validate_graph(graph: Graph) -> Result<(), Vec<String>> {
    validate::validate_graph(&graph)
}

/// 3. List models available locally in Ollama.
#[tauri::command]
pub async fn list_models(ollama_url: Option<String>) -> Result<Vec<ModelInfo>, String> {
    let url = ollama_url.unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    let client = OllamaClient::new(&url);
    client.list_models().await.map_err(|e| format!("{e}"))
}

#[tauri::command]
pub async fn cmd_check_ollama(ollama_url: Option<String>) -> OllamaStatus {
    let url = ollama_url.unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    check_ollama_status(&url).await
}

/// 4. Pull a model from Ollama with streaming progress events.
#[tauri::command]
pub async fn pull_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, PullState>,
    model_name: String,
    ollama_url: Option<String>,
) -> Result<(), String> {
    let url = ollama_url.unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    let client = OllamaClient::new(&url);

    let app_handle = app.clone();
    let model_for_event = model_name.clone();

    let cancel_flag = Arc::new(AtomicBool::new(false));
    state.active_pulls.lock().await.insert(model_name.clone(), cancel_flag.clone());

    let result = client
        .pull_model(&model_name, Some(cancel_flag), move |progress| {
            let _ = app_handle.emit(
                "pull-progress",
                serde_json::json!({
                    "model": &model_for_event,
                    "status": progress.status,
                    "completed": progress.completed,
                    "total": progress.total,
                }),
            );
        })
        .await
        .map_err(|e| format!("{e}"));

    state.active_pulls.lock().await.remove(&model_name);
    result
}

#[tauri::command]
pub async fn cancel_pull(
    state: tauri::State<'_, PullState>,
    model_name: String,
) -> Result<(), String> {
    if let Some(flag) = state.active_pulls.lock().await.get(&model_name) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// 5. Generate a workflow graph from natural language instruction.
#[tauri::command]
pub async fn chat_generate(
    instruction: String,
    model: Option<String>,
    ollama_url: Option<String>,
    temperature: Option<f32>,
) -> Result<Graph, String> {
    let m = model.unwrap_or_else(|| compiler::DEFAULT_MODEL.to_string());
    let u = ollama_url.unwrap_or_else(|| compiler::DEFAULT_OLLAMA_URL.to_string());

    let status = check_ollama_status(&u).await;
    let installed: Vec<String> = match status {
        OllamaStatus::Ready { models } => models.into_iter().map(|mi| mi.name).collect(),
        _ => return Err("No local model detected â€” install one first.".to_string()),
    };
    if !installed.contains(&m) {
        return Err(format!("Model '{m}' is not installed. Installed models: {:?}", installed));
    }

    let t = temperature.unwrap_or(compiler::DEFAULT_TEMPERATURE);
    compiler::generate_workflow(&instruction, &m, &u, t).await
}

/// 6. Iteratively refine an existing workflow graph via natural language.
#[tauri::command]
pub async fn chat_edit(
    instruction: String,
    existing_graph: Graph,
    model: Option<String>,
    ollama_url: Option<String>,
    temperature: Option<f32>,
) -> Result<Graph, String> {
    let m = model.unwrap_or_else(|| compiler::DEFAULT_MODEL.to_string());
    let u = ollama_url.unwrap_or_else(|| compiler::DEFAULT_OLLAMA_URL.to_string());

    let status = check_ollama_status(&u).await;
    let installed: Vec<String> = match status {
        OllamaStatus::Ready { models } => models.into_iter().map(|mi| mi.name).collect(),
        _ => return Err("No local model detected â€” install one first.".to_string()),
    };
    if !installed.contains(&m) {
        return Err(format!("Model '{m}' is not installed. Installed models: {:?}", installed));
    }

    let t = temperature.unwrap_or(compiler::DEFAULT_TEMPERATURE);
    compiler::edit_workflow(&instruction, &existing_graph, &m, &u, t).await
}

/// 7. Save a workflow graph to a local file.
/// Note: intentionally skips validation so work-in-progress graphs can be saved.
#[tauri::command]
pub fn save_workflow(path: String, graph: Graph) -> Result<(), String> {
    let json_str = serde_json::to_string_pretty(&graph)
        .map_err(|e| format!("Serialization failed: {e}"))?;

    if let Some(parent) = Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    std::fs::write(&path, json_str)
        .map_err(|e| format!("Failed to write file '{path}': {e}"))
}

/// 8. Load a workflow graph from a local file.
/// Note: validates JSON structure but not strict field rules, so any valid graph loads.
#[tauri::command]
pub fn load_workflow(path: String) -> Result<Graph, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file '{path}': {e}"))?;

    let graph: Graph = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid workflow JSON in '{path}': {e}"))?;

    Ok(graph)
}
