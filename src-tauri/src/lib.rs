use std::collections::HashMap;
use std::sync::Mutex;

pub mod chroma;
mod commands;
pub mod executor;
pub mod ollama;
pub mod watcher;
pub mod python_sandbox;
pub mod agent_runner;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(commands::WatcherState {
            watchers: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            // Existing Pipeline Canvas commands
            commands::generate_graph,
            commands::list_ollama_models,
            commands::pull_model,
            commands::save_agent_file,
            commands::load_agent_file,
            commands::pick_folder,
            commands::pick_image,
            commands::execute_graph,
            commands::start_file_watch,
            commands::stop_file_watch,
            commands::write_output,
            // Agent Mode commands — Hybrid Local AI Hub Zero-Code Framework
            commands::run_autoagent_task,
            commands::profile_agent_requirement,
            commands::create_and_test_tool,
            commands::profile_workflow_requirement,
            commands::execute_xml_workflow,
            // New: Custom Agent Execution + Agent File Viewer
            commands::run_custom_agent,
            commands::get_generated_agents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hybrid Local AI Hub");
}
