//! Tauri IPC commands exposing core Hybrid Local AI Hub engine to the GUI frontend.
//!
//! Mirrors CLI functionality without duplication: calls into `hybrid_local_ai_hub` library.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Deserialize;
use tauri::{Emitter, Manager};
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

#[derive(Default)]
pub struct ChatState {
    pub active_tasks: tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
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
    let client = OllamaClient::new_no_timeout(&url);

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

#[tauri::command]
pub async fn cancel_llm_task(
    state: tauri::State<'_, ChatState>,
    task_id: String,
) -> Result<(), String> {
    let mut tasks = state.active_tasks.lock().await;
    if let Some(sender) = tasks.remove(&task_id) {
        let _ = sender.send(());
    }
    Ok(())
}

/// 5. Generate a workflow graph from natural language instruction.
#[tauri::command]
pub async fn chat_generate(
    state: tauri::State<'_, ChatState>,
    instruction: String,
    model: Option<String>,
    ollama_url: Option<String>,
    temperature: Option<f32>,
    task_id: Option<String>,
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
    
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(id) = &task_id {
        state.active_tasks.lock().await.insert(id.clone(), tx);
    }

    let result = tokio::select! {
        res = compiler::generate_workflow(&instruction, &m, &u, t) => res,
        _ = rx => Err("Generation cancelled by user.".to_string()),
    };

    if let Some(id) = task_id {
        state.active_tasks.lock().await.remove(&id);
    }
    result
}

/// 6. Iteratively refine an existing workflow graph via natural language.
#[tauri::command]
pub async fn chat_edit(
    state: tauri::State<'_, ChatState>,
    instruction: String,
    existing_graph: Graph,
    model: Option<String>,
    ollama_url: Option<String>,
    temperature: Option<f32>,
    task_id: Option<String>,
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
    
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(id) = &task_id {
        state.active_tasks.lock().await.insert(id.clone(), tx);
    }

    let result = tokio::select! {
        res = compiler::edit_workflow(&instruction, &existing_graph, &m, &u, t) => res,
        _ = rx => Err("Generation cancelled by user.".to_string()),
    };

    if let Some(id) = task_id {
        state.active_tasks.lock().await.remove(&id);
    }
    result
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

/// 8b. Save arbitrary text to a file.
#[tauri::command]
pub fn save_text_file(path: String, text: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, text)
        .map_err(|e| format!("Failed to write text file '{path}': {e}"))
}

// ———————————————————————————————————————————————————————————————————
// System Info (for onboarding wizard hardware-aware recommendations)
// ———————————————————————————————————————————————————————————————————

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub total_ram_gb: f64,
    pub gpu_name: Option<String>,
    pub gpu_vram_gb: Option<f64>,
    pub os_name: String,
    pub cpu_cores: usize,
}

/// 9. Detect system hardware specs for model recommendations.
#[tauri::command]
pub fn cmd_system_info() -> SystemInfo {
    use sysinfo::System;

    let mut sys = System::new_all();
    sys.refresh_all();

    let total_ram_gb = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
    let cpu_cores = sys.cpus().len();
    let os_name = format!(
        "{} {}",
        System::name().unwrap_or_else(|| "Unknown".to_string()),
        System::os_version().unwrap_or_default()
    );

    // GPU detection via wmic on Windows
    let (gpu_name, gpu_vram_gb) = detect_gpu();

    SystemInfo {
        total_ram_gb,
        gpu_name,
        gpu_vram_gb,
        os_name,
        cpu_cores,
    }
}

#[cfg(target_os = "windows")]
fn detect_gpu() -> (Option<String>, Option<f64>) {
    use std::process::Command;
    let output = Command::new("wmic")
        .args(["path", "win32_VideoController", "get", "Name,AdapterRAM", "/format:csv"])
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        // CSV lines: Node,AdapterRAM,Name
        for line in text.lines().skip(1) {
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() >= 3 {
                let vram_bytes: Option<u64> = parts[1].trim().parse().ok();
                let name = parts[2].trim().to_string();
                // Skip Microsoft Basic Display Adapter (not a real GPU)
                if name.contains("Microsoft") || name.is_empty() {
                    continue;
                }
                let vram_gb = vram_bytes.map(|b| b as f64 / (1024.0 * 1024.0 * 1024.0));
                return (Some(name), vram_gb);
            }
        }
    }
    (None, None)
}

#[cfg(not(target_os = "windows"))]
fn detect_gpu() -> (Option<String>, Option<f64>) {
    // GPU detection on Linux/macOS can be added later
    (None, None)
}

// ———————————————————————————————————————————————————————————————————
// Saved Agents Library Commands
// ———————————————————————————————————————————————————————————————————

#[tauri::command]
pub fn list_agents(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let agents_dir = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("agents");
    
    if !agents_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut agents = Vec::new();
    if let Ok(entries) = std::fs::read_dir(agents_dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    if let Some(ext) = entry.path().extension() {
                        if ext == "json" {
                            if let Some(name) = entry.path().file_stem().and_then(|n| n.to_str()) {
                                agents.push(name.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(agents)
}

#[tauri::command]
pub fn save_agent(app: tauri::AppHandle, name: String, graph: Graph) -> Result<(), String> {
    let agents_dir = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("agents");
        
    std::fs::create_dir_all(&agents_dir).map_err(|e| format!("Failed to create agents dir: {e}"))?;
    
    // Sanitize filename for Windows
    let safe_name = name.replace(|c: char| {
        c == '<' || c == '>' || c == ':' || c == '"' || c == '/' || c == '\\' || c == '|' || c == '?' || c == '*'
    }, "_");
    
    let path = agents_dir.join(format!("{}.json", safe_name));
    
    let json_str = serde_json::to_string_pretty(&graph)
        .map_err(|e| format!("Serialization failed: {e}"))?;
        
    std::fs::write(&path, json_str)
        .map_err(|e| format!("Failed to write agent file: {e}"))
}

#[tauri::command]
pub fn load_agent(app: tauri::AppHandle, name: String) -> Result<Graph, String> {
    let agents_dir = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("agents");
        
    let path = agents_dir.join(format!("{}.json", name));
    if !path.exists() {
        return Err(format!("Agent file not found: {}", path.display()));
    }
    
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read agent '{name}': {e}"))?;

    let graph: Graph = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid workflow JSON in '{name}': {e}"))?;

    Ok(graph)
}

#[tauri::command]
pub fn launch_agent_terminal(app: tauri::AppHandle, name: String) -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        return Err("Agent Terminal Launcher is only available in development mode (requires Cargo).".to_string());
    }

    #[cfg(debug_assertions)]
    {
        let agents_dir = app.path().app_local_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
            .join("agents");
            
        let path = agents_dir.join(format!("{}.json", name));
        if !path.exists() {
            return Err(format!("Agent file not found: {}", path.display()));
        }
        
        let path_str = path.to_string_lossy().to_string();
        
        #[cfg(target_os = "windows")]
        {
            let mut cmd = std::process::Command::new("cmd");
            if let Ok(cwd) = std::env::current_dir() {
                if cwd.ends_with("src-tauri") {
                    if let Some(parent) = cwd.parent() {
                        cmd.current_dir(parent);
                    }
                }
            }
            cmd.args(["/c", "start", "cmd.exe", "/k", &format!("cargo run -- run \"{}\"", path_str)])
                .spawn()
                .map_err(|e| format!("Failed to launch terminal: {e}"))?;
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            return Err("Terminal launching currently only implemented for Windows.".to_string());
        }

        Ok(())
    }
}

#[tauri::command]
pub async fn help_agent_ask(
    state: tauri::State<'_, ChatState>,
    prompt: String,
    images: Vec<String>,
    model: String,
    url: String,
    workflow_context: Option<String>,
    task_id: Option<String>,
) -> Result<String, String> {
    let client = OllamaClient::new_no_timeout(&url);
    
    let mut full_prompt = String::from("You are an expert developer and AI assistant. The user has encountered an error or needs help debugging.\n");
    if let Some(ctx) = workflow_context {
        full_prompt.push_str(&format!("\nHere is the current workflow JSON for context:\n{}\n", ctx));
    }
    full_prompt.push_str(&format!("\nUser's Request / Error:\n{}\n", prompt));

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(id) = &task_id {
        state.active_tasks.lock().await.insert(id.clone(), tx);
    }

    let result = tokio::select! {
        res = client.generate(&model, &full_prompt, images, 0.2, false) => res.map_err(|e| format!("Help agent failed: {e}")),
        _ = rx => Err("Generation cancelled by user.".to_string()),
    };

    if let Some(id) = task_id {
        state.active_tasks.lock().await.remove(&id);
    }
    result
}
