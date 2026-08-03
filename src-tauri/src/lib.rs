use std::collections::HashMap;
use std::sync::Mutex;

pub mod chroma;
mod commands;
pub mod executor;
pub mod ollama;
pub mod watcher;

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
            commands::generate_graph,
            commands::list_ollama_models,
            commands::pull_model,
            commands::save_agent_file,
            commands::pick_folder,
            commands::pick_image,
            commands::execute_graph,
            commands::start_file_watch,
            commands::stop_file_watch,
            commands::write_output
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
