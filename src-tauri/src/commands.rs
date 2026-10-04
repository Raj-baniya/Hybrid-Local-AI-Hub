//! Tauri IPC commands exposing core Hybrid Local AI Hub engine to the GUI frontend.
//!
//! Mirrors CLI functionality without duplication: calls into `hybrid_local_ai_hub` library.

use std::collections::HashMap;
use std::path::Path;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use hybrid_local_ai_hub::compiler;
use hybrid_local_ai_hub::execution_record::ExecutionRecord;
use hybrid_local_ai_hub::executor::{self, ExecutorConfig, FailurePolicy};
use hybrid_local_ai_hub::ollama::{check_ollama_status, ModelInfo, OllamaClient, OllamaStatus};
use hybrid_local_ai_hub::schema::{Graph, NodeType};
use hybrid_local_ai_hub::validate;
use tokio::sync::oneshot;

// ─── Shared state & helpers ──────────────────────────────────────────────────

fn is_valid_filename(name: &str) -> bool {
    !name.chars().any(|c| {
        c == '<'
            || c == '>'
            || c == ':'
            || c == '"'
            || c == '/'
            || c == '\\'
            || c == '|'
            || c == '?'
            || c == '*'
    })
}

/// Tracks in-progress model pulls so they can be cancelled.
#[derive(Default)]
pub struct PullState {
    pub active_pulls: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Default)]
pub struct ChatState {
    pub active_tasks:
        tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

pub struct ScheduledTaskHandle {
    pub stop_tx: oneshot::Sender<()>,
    pub paused: Arc<AtomicBool>,
    pub cancel_flag: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct ScheduledTaskState {
    pub active_tasks: Arc<tokio::sync::Mutex<HashMap<String, ScheduledTaskHandle>>>,
}

#[derive(Default)]
pub struct ManualRunState {
    pub cancel_flag: Arc<AtomicBool>,
    pub pause_flag: Arc<AtomicBool>,
    pub manual_input_tx: Arc<tokio::sync::Mutex<Option<tokio::sync::mpsc::Sender<String>>>>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskInfo {
    pub task_id: String,
    pub paused: bool,
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
    pub suppress_actions: Option<bool>,
}

// â”€â”€â”€ Execution Logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[tauri::command]
pub fn get_cli_command(agent_path: String) -> String {
    let escaped_path = agent_path.replace("'", "''");

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Check if hybrid-hub.exe exists in the same directory (like target/release)
            // or in a parent directory (like target/release vs target/release/bundle)
            let sibling1 = dir.join("hybrid-hub.exe");
            let sibling2 = dir.join("../../hybrid-hub.exe");
            let sibling3 = dir.join("../../../target/release/hybrid-hub.exe"); // from src-tauri dev

            if sibling1.exists() {
                return format!(
                    "& '{}' run '{}'",
                    sibling1.display().to_string().replace("'", "''"),
                    escaped_path
                );
            } else if sibling2.exists() {
                return format!(
                    "& '{}' run '{}'",
                    sibling2.display().to_string().replace("'", "''"),
                    escaped_path
                );
            } else if sibling3.exists() {
                return format!(
                    "& '{}' run '{}'",
                    sibling3.display().to_string().replace("'", "''"),
                    escaped_path
                );
            }
        }
    }

    // Fallback if binary not found, suggest using cargo run
    format!("cargo run --bin hybrid-hub -- run '{}'", escaped_path)
}

#[tauri::command]
pub async fn launch_terminal_interact(
    _app: tauri::AppHandle,
    agent_path: String,
) -> Result<String, String> {
    let path = std::path::Path::new(&agent_path);
    if !path.exists() {
        return Err(format!("File not found: {}", agent_path));
    }

    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().unwrap().to_path_buf();
    let mut bin_path = exe_dir.join("hybrid-hub.exe");
    if !bin_path.exists() {
        // Fallbacks for dev modes
        bin_path = std::path::PathBuf::from("C:\\Hybrid Local AI Hub\\target\\release\\hybrid-hub.exe");
        if !bin_path.exists() {
            bin_path = std::path::PathBuf::from("C:\\Hybrid Local AI Hub\\target\\debug\\hybrid-hub.exe");
        }
        if !bin_path.exists() {
            return Err("Could not find hybrid-hub.exe agent binary".to_string());
        }
    }
    
    // Convert to string safely handling spaces in paths for shell
    let escaped_bin = bin_path.to_string_lossy().replace("\"", "\\\"");
    let escaped_agent = path.to_string_lossy().replace("\"", "\\\"");

    // Windows only
    #[cfg(target_os = "windows")]
    {
        let script = format!("& '{}' interact '{}'", escaped_bin, escaped_agent);
        let _ = std::process::Command::new("powershell")
            .arg("-Command")
            .arg(format!("Start-Process powershell -ArgumentList '-NoExit', '-Command', \"{}\"", script.replace("'", "''")))
            .spawn()
            .map_err(|e| format!("Failed to spawn terminal: {}", e))?;
        return Ok("Terminal spawned".to_string());
    }

// fallback for unsupported OS
    #[cfg(not(target_os = "windows"))]
    {
        Err("Interactive terminal launch is only supported on Windows currently.".to_string())
    }
}

#[tauri::command]
pub fn cmd_load_in_terminal(agent_path: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?
        .parent().ok_or("no exe dir")?.join(if cfg!(windows) { "hybrid-hub.exe" } else { "hybrid-hub" });
    let exe = exe.to_string_lossy().to_string();
    let display_cmd = format!("\"{}\" agent \"{}\"", exe, agent_path);

    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("cmd")
        .args(["/C", "start", "Hybrid Hub Agent", "cmd", "/K", &display_cmd])
        .spawn();

    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("osascript")
        .args(["-e", &format!("tell application \"Terminal\" to do script \"{}\"",
            display_cmd.replace('\\', "\\\\").replace('"', "\\\""))])
        .spawn();

    #[cfg(target_os = "linux")]
    let r = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"].iter()
        .find_map(|t| std::process::Command::new(t)
            .args(if *t == "gnome-terminal" { vec!["--", "sh", "-c", &display_cmd] } else { vec!["-e", &display_cmd] })
            .spawn().ok())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no terminal found"));

    r.map(|_| ()).map_err(|e| format!("Could not open a terminal ({}). Run this yourself:\n{}", e, display_cmd))
}

#[tauri::command]
pub async fn validate_node(node: hybrid_local_ai_hub::schema::GraphNode) -> Result<serde_json::Value, String> {
    use hybrid_local_ai_hub::schema::NodeType;

    match &node.data {
        NodeType::SourceFileNode(cfg) => {
            if std::path::Path::new(&cfg.path).exists() {
                Ok(serde_json::json!({ "success": true, "message": "File exists and is accessible." }))
            } else {
                Err(format!("File not found at path: {}", cfg.path))
            }
        },
        NodeType::OllamaSelectorNode(cfg) => {
            if cfg.model.is_empty() {
                return Err("No model selected.".to_string());
            }
            Ok(serde_json::json!({ "success": true, "message": format!("Model '{}' is configured.", cfg.model) }))
        },
        NodeType::ImageInputNode(cfg) => {
            if std::path::Path::new(&cfg.image_path).exists() {
                Ok(serde_json::json!({ "success": true, "message": "Image exists and is accessible." }))
            } else {
                Err(format!("Image not found at path: {}", cfg.image_path))
            }
        },
        NodeType::ShellCommandNode(cfg) => {
            if cfg.command.is_empty() {
                return Err("Command is empty.".to_string());
            }
            Ok(serde_json::json!({ "success": true, "message": "Command format is valid." }))
        },
        _ => {
            Ok(serde_json::json!({ "success": true, "message": "Node configuration format is valid." }))
        }
    }
}

// â”€â”€â”€ Commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// 1. Run a workflow graph end-to-end.
#[tauri::command]
pub async fn run_graph(
    app: tauri::AppHandle,
    state: State<'_, ManualRunState>,
    graph: Graph,
    config: Option<ExecutorConfigPayload>,
    offline_mode: Option<bool>,
) -> Result<ExecutionRecord, String> {
    let mut is_offline = offline_mode.unwrap_or(true);

    if !is_offline {
        let is_connected = hybrid_local_ai_hub::network::check_internet_connection().await;
        if !is_connected {
            is_offline = true;
        }
    }

    let online_keys = if !is_offline {
        if let Ok(providers) = get_providers(app.clone()) {
            providers
                .into_iter()
                .map(|p| hybrid_local_ai_hub::providers::ApiKeyConfig {
                    key: p.key,
                    name: p.name,
                    model: p.model,
                })
                .collect()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    if is_offline {
        for node in &graph.nodes {
            if matches!(
                node.data,
                hybrid_local_ai_hub::schema::NodeType::WebScraperNode(_)
                    | hybrid_local_ai_hub::schema::NodeType::NotifyWebhookNode(_)
            ) {
                return Err("Online-only nodes (Web Scraper, Webhook) cannot be used in Strict Offline Mode. Turn off Offline Mode to run this workflow.".to_string());
            }
        }
    }

    // Validate first before executing.
    validate::validate_graph(&graph).map_err(|errs| errs.join("\n"))?;

    let (input_tx, input_rx) = tokio::sync::mpsc::channel(1);
    {
        let mut guard = state.manual_input_tx.lock().await;
        *guard = Some(input_tx);
    }
    let manual_input_rx = Some(std::sync::Arc::new(tokio::sync::Mutex::new(input_rx)));

    let default_cfg = ExecutorConfig::default();
    let executor_cfg = if let Some(c) = config {
        ExecutorConfig {
            manual_input_rx: manual_input_rx.clone(),
            agents_dir: Default::default(),
            ollama_url: c.ollama_url.unwrap_or(default_cfg.ollama_url),
            chroma_url: c.chroma_url.unwrap_or(default_cfg.chroma_url),
            failure_policy: if c.continue_on_failure.unwrap_or(false) {
                FailurePolicy::ContinueIndependentBranches
            } else {
                FailurePolicy::HaltOnFailure
            },
            default_timeout_secs: c
                .default_timeout_secs
                .unwrap_or(default_cfg.default_timeout_secs),
            llm_timeout_secs: c.llm_timeout_secs.unwrap_or(default_cfg.llm_timeout_secs),
            suppress_actions: c.suppress_actions.unwrap_or(false),
            is_offline,
            online_keys,
        }
    } else {
        ExecutorConfig { 
            manual_input_rx: None,
            agents_dir: Default::default(),
            is_offline,
            online_keys,
            ..default_cfg
        }
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

    let cancel_flag = state.cancel_flag.clone();
    cancel_flag.store(false, Ordering::Relaxed);
    let pause_flag = state.pause_flag.clone();
    pause_flag.store(false, Ordering::Relaxed);

    match executor::run_graph(&graph, None, executor_cfg, "gui", Some(tx), None, Some(cancel_flag), Some(pause_flag)).await {
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
    state
        .active_pulls
        .lock()
        .await
        .insert(model_name.clone(), cancel_flag.clone());

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
pub async fn delete_model(model_name: String, ollama_url: Option<String>) -> Result<(), String> {
    let url = ollama_url.unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    let client = OllamaClient::new_no_timeout(&url);
    client
        .delete_model(&model_name)
        .await
        .map_err(|e| format!("{e}"))
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
    app: tauri::AppHandle,
    state: tauri::State<'_, ChatState>,
    messages: Vec<hybrid_local_ai_hub::schema::ChatMessage>,
    model: Option<String>,
    ollama_url: Option<String>,
    task_id: Option<String>,
    offline_mode: Option<bool>,
) -> Result<Graph, String> {
    let m = model.unwrap_or_else(|| compiler::DEFAULT_MODEL.to_string());
    let u = ollama_url.unwrap_or_else(|| compiler::DEFAULT_OLLAMA_URL.to_string());

    let status = check_ollama_status(&u).await;
    let installed: Vec<String> = match status {
        OllamaStatus::Ready { models } => models.into_iter().map(|mi| mi.name).collect(),
        _ => return Err("No local model detected â€” install one first.".to_string()),
    };
    if !installed.contains(&m) && !m.contains("API|") && m != "NEMOTRON_SUPER" {
        return Err(format!(
            "Model '{m}' is not installed. Installed models: {:?}",
            installed
        ));
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(id) = &task_id {
        state.active_tasks.lock().await.insert(id.clone(), tx);
    }

    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let task_id_clone = task_id.clone().unwrap_or_default();
    let app_clone = app.clone();
    tokio::spawn(async move {
        use tauri::Emitter;
        while let Some(msg) = progress_rx.recv().await {
            let _ = app_clone.emit(
                "generation-progress",
                serde_json::json!({
                    "taskId": task_id_clone,
                    "message": msg
                }),
            );
        }
    });

    let mut is_offline = offline_mode.unwrap_or(true);
    if !is_offline {
        let is_connected = hybrid_local_ai_hub::network::check_internet_connection().await;
        if !is_connected {
            is_offline = true;
        }
    }

    // online_keys is only for the COMPILER LLM (the AI generating the graph JSON).
    // Graph node OllamaSelectorNodes always use local Ollama models regardless of compiler mode.
    let online_keys = if !is_offline || m.starts_with("API|") || m == "NEMOTRON_SUPER" {
        if let Ok(providers) = get_providers(app.clone()) {
            providers
                .into_iter()
                .map(|p| hybrid_local_ai_hub::providers::ApiKeyConfig {
                    key: p.key,
                    name: p.name,
                    model: p.model,
                })
                .collect()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    // Force graph node execution to always use local Ollama (graph_is_offline is always true)
    // Only the compiler LLM itself may be online; the nodes it generates are always local
    let graph_is_offline = true;

    let mut result = tokio::select! {
        res = compiler::generate_workflow(&messages, &m, &u, graph_is_offline, online_keys, Some(progress_tx.clone())) => res,
        _ = rx => Err("Generation cancelled by user.".to_string()),
    };

    if let Ok(ref mut graph) = result {
        if is_offline {
            for node in &graph.nodes {
                if matches!(
                    node.data,
                    hybrid_local_ai_hub::schema::NodeType::WebScraperNode(_) | hybrid_local_ai_hub::schema::NodeType::NotifyWebhookNode(_)
                ) {
                    if let Some(ref id) = task_id {
                        let _ = state.active_tasks.lock().await.remove(id);
                    }
                    return Err("Online-only nodes (Web Scraper, Webhook) cannot be used in Strict Offline Mode. Turn off Offline Mode to use this workflow.".to_string());
                }
            }
        }

        let _ = progress_tx.send("Generating intelligent title...".to_string());
        if let Ok(title) = compiler::auto_name_graph(graph, &m, &u).await {
            graph.name = Some(title);
        }
    }

    if let Some(id) = task_id {
        state.active_tasks.lock().await.remove(&id);
    }
    result
}

/// 6. Iteratively refine an existing workflow graph via natural language.
#[tauri::command]
pub async fn chat_edit(
    app: tauri::AppHandle,
    state: tauri::State<'_, ChatState>,
    messages: Vec<hybrid_local_ai_hub::schema::ChatMessage>,
    existing_graph: Graph,
    model: Option<String>,
    ollama_url: Option<String>,
    task_id: Option<String>,
    offline_mode: Option<bool>,
) -> Result<Graph, String> {
    let m = model.unwrap_or_else(|| compiler::DEFAULT_MODEL.to_string());
    let u = ollama_url.unwrap_or_else(|| compiler::DEFAULT_OLLAMA_URL.to_string());

    let status = check_ollama_status(&u).await;
    let installed: Vec<String> = match status {
        OllamaStatus::Ready { models } => models.into_iter().map(|mi| mi.name).collect(),
        _ => return Err("No local model detected â€” install one first.".to_string()),
    };
    if !installed.contains(&m) && !m.contains("API|") && m != "NEMOTRON_SUPER" {
        return Err(format!(
            "Model '{m}' is not installed. Installed models: {:?}",
            installed
        ));
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(id) = &task_id {
        state.active_tasks.lock().await.insert(id.clone(), tx);
    }

    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let task_id_clone = task_id.clone().unwrap_or_default();
    let app_clone = app.clone();
    tokio::spawn(async move {
        use tauri::Emitter;
        while let Some(msg) = progress_rx.recv().await {
            let _ = app_clone.emit(
                "generation-progress",
                serde_json::json!({
                    "taskId": task_id_clone,
                    "message": msg
                }),
            );
        }
    });

    let mut is_offline = offline_mode.unwrap_or(true);
    if !is_offline {
        let is_connected = hybrid_local_ai_hub::network::check_internet_connection().await;
        if !is_connected {
            is_offline = true;
        }
    }

    let online_keys = if !is_offline || m.starts_with("API|") || m == "NEMOTRON_SUPER" {
        if let Ok(providers) = get_providers(app.clone()) {
            providers
                .into_iter()
                .map(|p| hybrid_local_ai_hub::providers::ApiKeyConfig {
                    key: p.key,
                    name: p.name,
                    model: p.model,
                })
                .collect()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    let graph_is_offline = true;

    let result = tokio::select! {
        res = compiler::edit_workflow(&messages, &existing_graph, &m, &u, graph_is_offline, online_keys, Some(progress_tx.clone())) => res,
        _ = rx => Err("Generation cancelled by user.".to_string()),
    };

    if let Ok(ref graph) = result {
        if is_offline {
            for node in &graph.nodes {
                if matches!(
                    node.data,
                    hybrid_local_ai_hub::schema::NodeType::WebScraperNode(_) | hybrid_local_ai_hub::schema::NodeType::NotifyWebhookNode(_)
                ) {
                    if let Some(ref id) = task_id {
                        let _ = state.active_tasks.lock().await.remove(id);
                    }
                    return Err("Online-only nodes (Web Scraper, Webhook) cannot be used in Strict Offline Mode. Turn off Offline Mode to use this workflow.".to_string());
                }
            }
        }
    }

    if let Some(id) = task_id {
        state.active_tasks.lock().await.remove(&id);
    }
    result
}

/// 7. Save a workflow graph to a local file.
/// Note: intentionally skips validation so work-in-progress graphs can be saved.
#[tauri::command]
pub fn save_workflow(path: String, graph: Graph) -> Result<(), String> {
    let json_str =
        serde_json::to_string_pretty(&graph).map_err(|e| format!("Serialization failed: {e}"))?;

    if let Some(parent) = Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    std::fs::write(&path, json_str).map_err(|e| format!("Failed to write file '{path}': {e}"))
}

/// 8. Load a workflow graph from a local file.
/// Note: validates JSON structure but not strict field rules, so any valid graph loads.
#[tauri::command]
pub fn load_workflow(path: String) -> Result<Graph, String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file '{path}': {e}"))?;

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
    std::fs::write(&path, text).map_err(|e| format!("Failed to write text file '{path}': {e}"))
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

fn get_env_dir(base: &std::path::Path, folder: &str, offline_mode: bool) -> std::path::PathBuf {
    if offline_mode {
        base.join(folder)
    } else {
        base.join(format!("online_{}", folder))
    }
}

#[cfg(target_os = "windows")]
fn detect_gpu() -> (Option<String>, Option<f64>) {
    use std::process::Command;
    let output = Command::new("wmic")
        .args([
            "path",
            "win32_VideoController",
            "get",
            "Name,AdapterRAM",
            "/format:csv",
        ])
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
pub fn list_agents(app: tauri::AppHandle, offline_mode: bool) -> Result<Vec<String>, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let agents_dir = get_env_dir(&base_dir, "agents", offline_mode);

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
pub fn save_agent(
    app: tauri::AppHandle,
    name: String,
    graph: Graph,
    offline_mode: bool,
) -> Result<(), String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let agents_dir = get_env_dir(&base_dir, "agents", offline_mode);

    std::fs::create_dir_all(&agents_dir)
        .map_err(|e| format!("Failed to create agents dir: {e}"))?;

    if !is_valid_filename(&name) {
        return Err(
            "Agent name contains invalid characters. Please avoid < > : \" / \\ | ? *".to_string(),
        );
    }

    let path = agents_dir.join(format!("{}.json", name));

    let json_str =
        serde_json::to_string_pretty(&graph).map_err(|e| format!("Serialization failed: {e}"))?;

    std::fs::write(&path, json_str).map_err(|e| format!("Failed to write agent file: {e}"))
}

#[tauri::command]
pub fn load_agent(
    app: tauri::AppHandle,
    name: String,
    offline_mode: bool,
) -> Result<Graph, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let agents_dir = get_env_dir(&base_dir, "agents", offline_mode);

    if !is_valid_filename(&name) {
        return Err("Invalid agent name.".to_string());
    }

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

// ———————————————————————————————————————————————————————————————————
// Execution Logs
// ———————————————————————————————————————————————————————————————————

#[tauri::command]
pub fn save_execution_log(
    app: tauri::AppHandle,
    record: ExecutionRecord,
    offline_mode: bool,
) -> Result<(), String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let logs_dir = get_env_dir(&base_dir, "logs", offline_mode);

    std::fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {e}"))?;

    let uuid = uuid::Uuid::parse_str(&record.execution_id)
        .map_err(|e| format!("Invalid execution ID: {e}"))?;

    // Save file named after the execution_id
    let path = logs_dir.join(format!("{}.json", uuid.as_simple()));

    let json_str =
        serde_json::to_string_pretty(&record).map_err(|e| format!("Serialization failed: {e}"))?;

    std::fs::write(&path, json_str).map_err(|e| format!("Failed to write log file: {e}"))
}

#[tauri::command]
pub fn list_execution_logs(
    app: tauri::AppHandle,
    offline_mode: bool,
) -> Result<Vec<ExecutionRecord>, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let logs_dir = get_env_dir(&base_dir, "logs", offline_mode);

    let mut records = Vec::new();
    if logs_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(logs_dir) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension() {
                    if ext == "json" {
                        if let Ok(content) = std::fs::read_to_string(entry.path()) {
                            if let Ok(record) = serde_json::from_str::<ExecutionRecord>(&content) {
                                records.push(record);
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort descending by started_at
    records.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    Ok(records)
}

#[tauri::command]
pub fn rename_agent(
    app: tauri::AppHandle,
    old_name: String,
    new_name: String,
    offline_mode: bool,
) -> Result<(), String> {
    if !is_valid_filename(&old_name) || !is_valid_filename(&new_name) {
        return Err(
            "Agent name contains invalid characters. Please avoid < > : \" / \\ | ? *".to_string(),
        );
    }

    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let agents_dir = get_env_dir(&base_dir, "agents", offline_mode);

    let old_path = agents_dir.join(format!("{}.json", old_name));
    let new_path = agents_dir.join(format!("{}.json", new_name));

    if !old_path.exists() {
        return Err(format!("Agent file not found: {}", old_path.display()));
    }
    if new_path.exists() {
        return Err(format!(
            "An agent with the name '{}' already exists.",
            new_name
        ));
    }

    std::fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename agent file: {e}"))?;

    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let outputs_dir = get_env_dir(&base_dir, "outputs", offline_mode);
    let old_output = outputs_dir.join(format!("{}_output.txt", old_name));
    let new_output = outputs_dir.join(format!("{}_output.txt", new_name));
    if old_output.exists() {
        let _ = std::fs::rename(old_output, new_output);
    }

    Ok(())
}

#[tauri::command]
pub fn delete_agent(app: tauri::AppHandle, name: String, offline_mode: bool) -> Result<(), String> {
    if !is_valid_filename(&name) {
        return Err("Invalid agent name.".to_string());
    }

    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let agents_dir = get_env_dir(&base_dir, "agents", offline_mode);

    let path = agents_dir.join(format!("{}.json", name));
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to delete agent file: {e}"))?;
    }
    Ok(())
}


#[tauri::command]
pub fn get_agent_output(
    app: tauri::AppHandle,
    name: String,
    offline_mode: bool,
) -> Result<String, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let outputs_dir = get_env_dir(&base_dir, "outputs", offline_mode);

    if !is_valid_filename(&name) {
        return Err("Invalid agent name.".to_string());
    }

    let path = outputs_dir.join(format!("{}_output.txt", name));
    if !path.exists() {
        return Err(format!("No saved output found for agent: {}", name));
    }

    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read output: {e}"))
}

#[tauri::command]
pub fn get_agent_path(
    app: tauri::AppHandle,
    name: String,
    offline_mode: bool,
) -> Result<String, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let agents_dir = get_env_dir(&base_dir, "agents", offline_mode);

    if !is_valid_filename(&name) {
        return Err("Invalid agent name.".to_string());
    }

    let path = agents_dir.join(format!("{}.json", name));
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
#[allow(unused_variables)]
pub fn launch_agent_terminal(
    app: tauri::AppHandle,
    name: String,
    offline_mode: bool,
) -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        return Err(
            "Agent Terminal Launcher is only available in development mode (requires Cargo)."
                .to_string(),
        );
    }

    #[cfg(debug_assertions)]
    {
        let base_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
        let agents_dir = get_env_dir(&base_dir, "agents", offline_mode);

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
            cmd.args([
                "/c",
                "start",
                "cmd.exe",
                "/k",
                &format!("cargo run -- run \"{}\"", path_str),
            ])
            .spawn()
            .map_err(|e| format!("Failed to launch terminal: {e}"))?;
        }

        #[cfg(not(target_os = "windows"))]
        {
            return Err("Terminal launching currently only implemented for Windows.".to_string());
        }
    }

    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════════
// Scheduled Graph Execution Commands
// ═══════════════════════════════════════════════════════════════════════════════

/// Normalize 5-field unix cron (min hour day month weekday) to 6-field
/// (sec min hour day month weekday) expected by the `cron` crate.
fn normalize_cron_expression(expr: &str) -> Result<String, String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Err("Cron expression is empty".to_string());
    }
    let fields: Vec<&str> = trimmed.split_whitespace().collect();
    match fields.len() {
        5 => Ok(format!("0 {}", trimmed)),
        6 => Ok(trimmed.to_string()),
        7 => Ok(trimmed.to_string()),
        n => Err(format!(
            "Invalid cron expression '{}': expected 5, 6, or 7 fields, got {}",
            expr, n
        )),
    }
}

fn extract_agent_output(record: &ExecutionRecord) -> String {
    let mut chunks: Vec<String> = Vec::new();
    for node in &record.nodes {
        if node.node_type == "LocalFileWriterNode" {
            continue;
        }
        if let Some(preview) = &node.output_preview {
            let trimmed = preview.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with("FILE_EVENT:")
                || trimmed.starts_with("[ScheduleNode")
                || trimmed.starts_with("Wrote ")
            {
                continue;
            }
            chunks.push(format!("[{}] {}", node.node_id, trimmed));
        }
    }
    if chunks.is_empty() {
        record
            .nodes
            .iter()
            .rev()
            .find_map(|n| n.output_preview.clone())
            .unwrap_or_else(|| "No output generated.".to_string())
    } else {
        chunks.join("\n\n")
    }
}

fn persist_scheduled_output(app: &AppHandle, graph: &Graph, record: &ExecutionRecord, offline_mode: bool) {
    let _name = graph
        .name
        .clone()
        .filter(|n| !n.trim().is_empty() && is_valid_filename(n))
        .unwrap_or_else(|| "scheduled-agent".to_string());
    let _ = save_execution_log(app.clone(), record.clone(), offline_mode);
}

fn build_executor_config(
    config: Option<ExecutorConfigPayload>,
    offline_mode: bool,
) -> ExecutorConfig {
    let default_cfg = ExecutorConfig::default();
    if let Some(c) = config {
        ExecutorConfig { 
            manual_input_rx: None,
            agents_dir: Default::default(),
            ollama_url: c.ollama_url.unwrap_or(default_cfg.ollama_url),
            chroma_url: c.chroma_url.unwrap_or(default_cfg.chroma_url),
            failure_policy: if c.continue_on_failure.unwrap_or(false) {
                FailurePolicy::ContinueIndependentBranches
            } else {
                FailurePolicy::HaltOnFailure
            },
            default_timeout_secs: c
                .default_timeout_secs
                .unwrap_or(default_cfg.default_timeout_secs),
            llm_timeout_secs: c.llm_timeout_secs.unwrap_or(default_cfg.llm_timeout_secs),
            suppress_actions: c.suppress_actions.unwrap_or(false),
            is_offline: offline_mode,
            online_keys: vec![],
        }
    } else {
        ExecutorConfig { 
            manual_input_rx: None,
            agents_dir: Default::default(),
            is_offline: offline_mode,
            online_keys: vec![],
            ..default_cfg
        }
    }
}

/// Start a graph running continuously on its ScheduleNode cron schedule.
#[tauri::command]
pub async fn run_graph_scheduled(
    app: AppHandle,
    state: State<'_, ScheduledTaskState>,
    task_id: String,
    graph: Graph,
    config: Option<ExecutorConfigPayload>,
    offline_mode: Option<bool>,
) -> Result<String, String> {
    let schedule_node = graph
        .nodes
        .iter()
        .find(|n| matches!(n.data, NodeType::ScheduleNode(_)))
        .ok_or("Graph must contain a ScheduleNode for automated execution")?;

    let cron_expr = if let NodeType::ScheduleNode(cfg) = &schedule_node.data {
        cfg.cron_expression.clone()
    } else {
        return Err("Invalid ScheduleNode configuration".to_string());
    };

    let normalized = normalize_cron_expression(&cron_expr)?;
    let schedule = cron::Schedule::from_str(&normalized).map_err(|e| {
        format!(
            "Invalid cron expression '{}': {}. Use 5 fields (min hour day month weekday) e.g. '*/2 * * * *' for every 2 minutes, or 6 fields including seconds.",
            cron_expr, e
        )
    })?;

    {
        let tasks = state.active_tasks.lock().await;
        if tasks.contains_key(&task_id) {
            return Err(format!("Task '{}' is already running", task_id));
        }
    }

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    let paused = Arc::new(AtomicBool::new(false));
    let run_cancel_flag = Arc::new(AtomicBool::new(false));

    {
        let mut tasks = state.active_tasks.lock().await;
        tasks.insert(
            task_id.clone(),
            ScheduledTaskHandle {
                stop_tx: cancel_tx,
                paused: paused.clone(),
                cancel_flag: run_cancel_flag.clone(),
            },
        );
    }

    let active_tasks = state.active_tasks.clone();
    let app_handle = app.clone();
    let spawned_task_id = task_id.clone();
    let graph_clone = graph.clone();
    let is_offline = offline_mode.unwrap_or(true);

    tokio::spawn(async move {
        let executor_cfg = build_executor_config(config, is_offline);
        let _ = app_handle.emit("scheduled-task-started", &spawned_task_id);

        let run_once = |trigger: String| {
            let graph = graph_clone.clone();
            let executor_cfg = executor_cfg.clone();
            let app_handle = app_handle.clone();
            let task_id = spawned_task_id.clone();
            let c_flag = run_cancel_flag.clone();
            async move {
                match executor::run_graph(
                    &graph,
                    None,
                    executor_cfg,
                    "gui-scheduled",
                    None,
                    None,
                    Some(c_flag),
                    None,
                )
                .await
                {
                    Ok(record) => {
                        persist_scheduled_output(&app_handle, &graph, &record, is_offline);
                        let output = extract_agent_output(&record);
                        let _ = app_handle.emit(
                            "scheduled-task-execution",
                            serde_json::json!({
                                "taskId": task_id,
                                "record": record,
                                "trigger": trigger,
                                "output": output,
                            }),
                        );
                    }
                    Err(e) => {
                        let _ = app_handle.emit(
                            "scheduled-task-error",
                            serde_json::json!({
                                "taskId": task_id,
                                "error": e.to_string(),
                                "trigger": trigger,
                            }),
                        );
                    }
                }
            }
        };

        run_once("immediate".to_string()).await;

        let mut cancelled = false;
        for datetime in schedule.upcoming(chrono::Utc) {
            if cancel_rx.try_recv().is_ok() {
                break;
            }

            while paused.load(Ordering::Relaxed) {
                if cancel_rx.try_recv().is_ok() {
                    cancelled = true;
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            }
            if cancelled {
                break;
            }

            let now = chrono::Utc::now();
            if let Ok(duration) = (datetime - now).to_std() {
                let _ = app_handle.emit(
                    "scheduled-task-next-run",
                    serde_json::json!({
                        "taskId": spawned_task_id,
                        "nextRun": datetime.to_rfc3339(),
                        "in": duration.as_secs_f64(),
                        "paused": paused.load(Ordering::Relaxed),
                    }),
                );

                tokio::select! {
                    _ = tokio::time::sleep(duration) => {}
                    _ = &mut cancel_rx => { break; }
                }

                while paused.load(Ordering::Relaxed) {
                    if cancel_rx.try_recv().is_ok() {
                        cancelled = true;
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                }
                if cancelled {
                    break;
                }

                run_once(format!("cron:{}", datetime)).await;
            }
        }

        let _ = app_handle.emit("scheduled-task-stopped", &spawned_task_id);
        let mut tasks = active_tasks.lock().await;
        if let Some(handle) = tasks.get(&spawned_task_id) {
            if std::sync::Arc::ptr_eq(&handle.paused, &paused) {
                tasks.remove(&spawned_task_id);
            }
        }
    });

    Ok(task_id)
}

#[tauri::command]
pub async fn cancel_manual_graph(
    state: State<'_, ManualRunState>,
) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}
#[tauri::command]
pub async fn send_manual_input(
    state: State<'_, ManualRunState>,
    input: String,
) -> Result<(), String> {
    let tx_guard = state.manual_input_tx.lock().await;
    if let Some(tx) = tx_guard.as_ref() {
        if tx.send(input).await.is_err() {
            return Err("Input channel closed".into());
        }
    } else {
        return Err("No active prompt waiting for input".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn pause_manual_graph(
    state: State<'_, ManualRunState>,
) -> Result<(), String> {
    state.pause_flag.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn resume_manual_graph(
    state: State<'_, ManualRunState>,
) -> Result<(), String> {
    state.pause_flag.store(false, Ordering::Relaxed);
    Ok(())
}


#[tauri::command]
pub async fn stop_scheduled_graph(
    state: State<'_, ScheduledTaskState>,
    task_id: String,
) -> Result<(), String> {
    let mut tasks = state.active_tasks.lock().await;
    if let Some(handle) = tasks.remove(&task_id) {
        handle.cancel_flag.store(true, Ordering::Relaxed);
        let _ = handle.stop_tx.send(());
        Ok(())
    } else {
        Err(format!("Task '{}' not found", task_id))
    }
}

#[tauri::command]
pub async fn pause_scheduled_graph(
    state: State<'_, ScheduledTaskState>,
    task_id: String,
) -> Result<(), String> {
    let tasks = state.active_tasks.lock().await;
    if let Some(handle) = tasks.get(&task_id) {
        handle.paused.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("Task '{}' not found", task_id))
    }
}

#[tauri::command]
pub async fn resume_scheduled_graph(
    state: State<'_, ScheduledTaskState>,
    task_id: String,
) -> Result<(), String> {
    let tasks = state.active_tasks.lock().await;
    if let Some(handle) = tasks.get(&task_id) {
        handle.paused.store(false, Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("Task '{}' not found", task_id))
    }
}

#[tauri::command]
pub async fn list_scheduled_tasks(
    state: State<'_, ScheduledTaskState>,
) -> Result<Vec<ScheduledTaskInfo>, String> {
    let tasks = state.active_tasks.lock().await;
    Ok(tasks
        .iter()
        .map(|(id, handle)| ScheduledTaskInfo {
            task_id: id.clone(),
            paused: handle.paused.load(Ordering::Relaxed),
        })
        .collect())
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
    let pm = hybrid_local_ai_hub::providers::ProviderManager::new(&url, false, vec![]);
    
    let mut full_prompt = String::from("You are an expert developer and AI assistant. The user has encountered an error or needs help debugging.\n");
    if let Some(ctx) = workflow_context {
        full_prompt.push_str(&format!(
            "\nHere is the current workflow JSON for context:\n{}\n",
            ctx
        ));
    }
    full_prompt.push_str(&format!("\nUser's Request / Error:\n{}\n", prompt));

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(id) = &task_id {
        state.active_tasks.lock().await.insert(id.clone(), tx);
    }

    let actual_model = if model == "NEMOTRON_SUPER" || model.contains("nemotron") {
        "API|NVIDIA|nvidia/nemotron-3-super-120b-a12b"
    } else {
        model.as_str()
    };

    let result = tokio::select! {
        res = pm.generate(actual_model, &full_prompt, images, false) => res.map_err(|e| format!("Help agent failed: {e}")),
        _ = rx => Err("Generation cancelled by user.".to_string()),
    };

    if let Some(id) = task_id {
        state.active_tasks.lock().await.remove(&id);
    }
    result
}

// ———————————————————————————————————————————————————————————————————
// Chat History
// ———————————————————————————————————————————————————————————————————

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ChatHistoryEntry {
    pub id: String,
    pub timestamp: String,
    pub instruction: String,
    pub model: String,
    pub graph: Graph,
    #[serde(default)]
    pub messages: Vec<hybrid_local_ai_hub::schema::ChatMessage>,
}

#[tauri::command]
pub fn save_chat_history(
    app: tauri::AppHandle,
    entry: ChatHistoryEntry,
    offline_mode: bool,
) -> Result<(), String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let history_dir = get_env_dir(&base_dir, "chat_history", offline_mode);

    std::fs::create_dir_all(&history_dir)
        .map_err(|e| format!("Failed to create history dir: {e}"))?;

    if entry.id == ".." || !is_valid_filename(&entry.id) {
        return Err("Invalid history entry ID".to_string());
    }
    let path = history_dir.join(format!("{}.json", entry.id));

    let json_str =
        serde_json::to_string_pretty(&entry).map_err(|e| format!("Serialization failed: {e}"))?;

    std::fs::write(&path, json_str).map_err(|e| format!("Failed to write history file: {e}"))
}

#[tauri::command]
pub fn list_chat_history(
    app: tauri::AppHandle,
    offline_mode: bool,
) -> Result<Vec<ChatHistoryEntry>, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let history_dir = get_env_dir(&base_dir, "chat_history", offline_mode);

    let mut entries = Vec::new();
    if history_dir.exists() {
        if let Ok(dir_entries) = std::fs::read_dir(history_dir) {
            for dir_entry in dir_entries.flatten() {
                if let Some(ext) = dir_entry.path().extension() {
                    if ext == "json" {
                        if let Ok(content) = std::fs::read_to_string(dir_entry.path()) {
                            match serde_json::from_str::<ChatHistoryEntry>(&content) {
                                Ok(record) => entries.push(record),
                                Err(e) => println!(
                                    "Failed to parse chat history file {:?}: {}",
                                    dir_entry.path(),
                                    e
                                ),
                            }
                        }
                    }
                }
            }
        }
    }
    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(entries)
}

#[tauri::command]
pub fn delete_chat_history(
    app: tauri::AppHandle,
    id: String,
    offline_mode: bool,
) -> Result<(), String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let history_dir = get_env_dir(&base_dir, "chat_history", offline_mode);

    if id == ".." || !is_valid_filename(&id) {
        return Err("Invalid history ID".to_string());
    }
    let path = history_dir.join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to delete history file: {e}"))?;
    }
    Ok(())
}

// ———————————————————————————————————————————————————————————————————
// Providers (API Keys)
// ———————————————————————————————————————————————————————————————————
use keyring::Entry;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ProviderConfig {
    pub key: String, // Will be redacted or omitted when sent to frontend
    pub name: String,
    pub model: String,
}

#[tauri::command]
pub fn save_provider(app: tauri::AppHandle, provider: ProviderConfig) -> Result<(), String> {
    let providers_file = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("providers.json");

    // 1. Save key to OS credential store
    let entry = Entry::new("hybrid-local-ai-hub", &provider.name)
        .map_err(|e| format!("Failed to create keyring entry: {e}"))?;
    entry
        .set_password(&provider.key)
        .map_err(|e| format!("Failed to save API key to OS credential store: {e}"))?;

    // 2. Save non-secret config to providers.json
    let mut providers: std::collections::HashMap<String, ProviderConfig> =
        std::collections::HashMap::new();
    if providers_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&providers_file) {
            if let Ok(existing) = serde_json::from_str(&content) {
                providers = existing;
            }
        }
    }

    // Store with redacted key in the file
    let mut public_provider = provider.clone();
    public_provider.key = "***".to_string();
    providers.insert(public_provider.name.clone(), public_provider);

    let json_str = serde_json::to_string_pretty(&providers)
        .map_err(|e| format!("Serialization failed: {e}"))?;

    std::fs::write(&providers_file, json_str)
        .map_err(|e| format!("Failed to write providers file: {e}"))
}

#[tauri::command]
pub fn get_providers(app: tauri::AppHandle) -> Result<Vec<ProviderConfig>, String> {
    let providers_file = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("providers.json");

    let mut providers: std::collections::HashMap<String, ProviderConfig> =
        std::collections::HashMap::new();

    // Auto-populate from .env.local if running in development mode
    #[cfg(debug_assertions)]
    {
        if !providers_file.exists() {
            if let Ok(content) = std::fs::read_to_string(".env.local") {
                let mut map = std::collections::HashMap::new();
                for line in content.lines() {
                    if let Some((k, v)) = line.split_once('=') {
                        map.insert(k.trim().to_string(), v.trim().to_string());
                    }
                }
                let mut i = 1;
                while let Some(key) = map.get(&format!("NVIDIA_API_KEY_{}", i)) {
                    let name = map
                        .get(&format!("NVIDIA_API_KEY_{}_NAME", i))
                        .cloned()
                        .unwrap_or_default();
                    let model = map
                        .get(&format!("NVIDIA_API_KEY_{}_MODEL", i))
                        .cloned()
                        .unwrap_or_default();
                    if !name.is_empty() {
                        providers.insert(
                            name.clone(),
                            ProviderConfig {
                                key: key.clone(),
                                name,
                                model,
                            },
                        );
                    }
                    i += 1;
                }
                // Save it for future
                if let Ok(json_str) = serde_json::to_string_pretty(&providers) {
                    let _ = std::fs::create_dir_all(providers_file.parent().unwrap());
                    let _ = std::fs::write(&providers_file, json_str);
                }
            }
        }
    }

    if providers_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&providers_file) {
            if let Ok(existing) = serde_json::from_str(&content) {
                providers = existing;
            }
        }
    }

    // Return redacted keys to the frontend; the real key stays backend-only.
    Ok(providers
        .into_values()
        .map(|mut p| {
            p.key = "***".to_string();
            p
        })
        .collect())
}

#[tauri::command]
pub fn delete_provider(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let entry = Entry::new("hybrid-local-ai-hub", &name)
        .map_err(|e| format!("Failed to access keyring: {e}"))?;
    match entry.delete_credential() {
        Ok(_) => {}
        Err(keyring::Error::NoEntry) => {} // Ignore if already not there
        Err(e) => return Err(format!("Failed to delete credential: {e}")),
    }
    let providers_file = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("providers.json");

    if providers_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&providers_file) {
            if let Ok(mut existing) =
                serde_json::from_str::<std::collections::HashMap<String, ProviderConfig>>(&content)
            {
                existing.remove(&name);
                if let Ok(json_str) = serde_json::to_string_pretty(&existing) {
                    let _ = std::fs::write(&providers_file, json_str);
                }
            }
        }
    }
    Ok(())
}


use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::thread;

#[tauri::command]
pub async fn run_terminal_agent(
    app: tauri::AppHandle,
    task: String,
    model: String,
    max_steps: u32,
    ollama_url: String,
    is_offline_mode: bool,
) -> Result<(), String> {
    if is_offline_mode && !ollama_url.contains("localhost") && !ollama_url.contains("127.0.0.1") {
        return Err("Offline mode is active. Cannot use non-local Ollama URL.".to_string());
    }
    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().unwrap().to_path_buf();
    let mut bin_path = exe_dir.join("hybrid-hub.exe");
    if !bin_path.exists() {
        // Fallbacks for dev modes
        bin_path = std::path::PathBuf::from("C:\\Hybrid Local AI Hub\\target\\release\\hybrid-hub.exe");
        if !bin_path.exists() {
            bin_path = std::path::PathBuf::from("C:\\Hybrid Local AI Hub\\target\\debug\\hybrid-hub.exe");
        }
        if !bin_path.exists() {
            return Err("Could not find hybrid-hub.exe agent binary".to_string());
        }
    }
    
    let mut child = Command::new(bin_path)
        .arg("agent")
        .arg("--task").arg(task)
        .arg("--model").arg(model)
        .arg("--max-steps").arg(max_steps.to_string())
        .arg("--ollama-url").arg(ollama_url)
        .arg("--yes")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn agent: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;
    
    let app_clone = app.clone();
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                let _ = app_clone.emit("terminal-agent-output", l);
            }
        }
    });

    let app_clone2 = app.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                let _ = app_clone2.emit("terminal-agent-output", l);
            }
        }
    });

    thread::spawn(move || {
        let code = child.wait().map(|s| s.code().unwrap_or(0)).unwrap_or(1);
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();
        let _ = app.emit("terminal-agent-exit", code);
    });

    Ok(())
}

#[tauri::command]
pub fn launch_autoagent_cli() -> Result<(), String> {
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
        cmd.args([
            "/c",
            "start",
            "cmd",
            "/k",
            "cargo run --bin autoagent"
        ]);
        match cmd.spawn() {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to launch AutoAgent CLI: {}", e)),
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Err("AutoAgent CLI is only supported on Windows currently.".into())
    }
}

#[tauri::command]
pub fn register_startup_agent(app: tauri::AppHandle, agent_name: String) -> Result<String, String> {
    let base_dir = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to get app dir: {e}"))?;
    let agent_path = base_dir.join("agents").join(format!("{}.json", agent_name));
    
    if !agent_path.exists() {
        return Err(format!("Agent '{}' not found.", agent_name));
    }

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let reg_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let val_name = format!("HybridHub-{}", agent_name.replace(' ', "_"));
    
    let command = format!(
        r#"reg add "{}" /v "{}" /t REG_SZ /d "\"{}\" run \"{}\"" /f"#,
        reg_key,
        val_name,
        exe_path.to_string_lossy(),
        agent_path.to_string_lossy()
    );

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .output()
        .map_err(|e| format!("Failed to run reg add: {e}"))?;
    
    if output.status.success() {
        Ok(format!("Agent '{}' registered for startup.", agent_name))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Registry error: {}", err))
    }
}

#[tauri::command]
pub fn remove_startup_agent(agent_name: String) -> Result<String, String> {
    let reg_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let val_name = format!("HybridHub-{}", agent_name.replace(' ', "_"));
    
    let command = format!(r#"reg delete "{}" /v "{}" /f"#, reg_key, val_name);
    
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .output()
        .map_err(|e| format!("Failed to run reg delete: {e}"))?;
        
    if output.status.success() {
        Ok(format!("Removed startup registration for {}.", agent_name))
    } else {
        Err("Failed to remove startup agent (it may not exist).".to_string())
    }
}

#[tauri::command]
pub fn register_scheduled_agent(app: tauri::AppHandle, agent_name: String, time: String) -> Result<String, String> {
    let base_dir = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to get app dir: {e}"))?;
    let agent_path = base_dir.join("agents").join(format!("{}.json", agent_name));
    
    if !agent_path.exists() {
        return Err(format!("Agent '{}' not found.", agent_name));
    }

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let task_name = format!("HybridHub-Sched-{}", agent_name.replace(' ', "_"));
    
    let command = format!(
        r#"schtasks /create /tn "{}" /tr "\"{}\" run \"{}\"" /sc daily /st {} /f"#,
        task_name,
        exe_path.to_string_lossy(),
        agent_path.to_string_lossy(),
        time
    );

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .output()
        .map_err(|e| format!("Failed to run schtasks: {e}"))?;
    
    if output.status.success() {
        Ok(format!("Agent '{}' scheduled daily at {}.", agent_name, time))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Task Scheduler error: {}", err))
    }
}

#[tauri::command]
pub fn remove_scheduled_agent(agent_name: String) -> Result<String, String> {
    let task_name = format!("HybridHub-Sched-{}", agent_name.replace(' ', "_"));
    let command = format!(r#"schtasks /delete /tn "{}" /f"#, task_name);
    
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .output()
        .map_err(|e| format!("Failed to run schtasks: {e}"))?;
        
    if output.status.success() {
        Ok(format!("Removed schedule for {}.", agent_name))
    } else {
        Err("Failed to remove scheduled agent (it may not exist).".to_string())
    }
}

#[tauri::command]
pub fn unregister_agent_task(agent_name: String, task_type: String) -> Result<String, String> {
    if task_type == "startup" {
        return remove_startup_agent(agent_name);
    }

    let prefix = "HybridHub-Sched";
    let task_name = format!("{}-{}", prefix, agent_name.replace(' ', "_"));

    let command = format!(r#"schtasks /delete /tn "{}" /f"#, task_name);

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .output()
        .map_err(|e| format!("Failed to run schtasks: {e}"))?;

    if output.status.success() {
        Ok(format!("Agent task '{}' removed.", agent_name))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to remove task: {}", err))
    }
}

#[tauri::command]
pub fn list_agent_tasks() -> Result<Vec<serde_json::Value>, String> {
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command",
               "schtasks /query /fo csv /nh | ConvertFrom-Csv -Header TaskName,NextRun,Status,LogonMode | Where-Object { $_.TaskName -like '*HybridHub*' } | ConvertTo-Json"])
        .output()
        .map_err(|e| format!("Failed to query tasks: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() || stdout.trim() == "null" {
        return Ok(vec![]);
    }

    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap_or(serde_json::json!([]));
    if let Some(arr) = parsed.as_array() {
        Ok(arr.clone())
    } else {
        Ok(vec![parsed])
    }
}

#[tauri::command]
pub fn speak_text(text: String, rate: Option<i32>) -> Result<(), String> {
    let rate_val = rate.unwrap_or(0);
    let ps_script = format!(
        "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = {}; $s.Speak('{}')",
        rate_val,
        text.replace('\'', " ")
    );

    std::process::Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_script])
        .spawn()
        .map_err(|e| format!("Failed to speak: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn test_microphone() -> Result<String, String> {
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command",
               "Get-PnpDevice -Class AudioEndpoint -Status OK | Select-Object -First 3 FriendlyName | ConvertTo-Json"])
        .output()
        .map_err(|e| format!("Failed to check microphone: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() || stdout.trim() == "null" {
        return Err("No microphone detected.".to_string());
    }

    Ok(format!("Microphone detected: {}", stdout.trim()))
}
