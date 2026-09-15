pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::PullState::default())
        .invoke_handler(tauri::generate_handler![
            commands::run_graph,
            commands::validate_graph,
            commands::list_models,
            commands::cmd_check_ollama,
            commands::pull_model,
            commands::cancel_pull,
            commands::chat_generate,
            commands::chat_edit,
            commands::save_workflow,
            commands::load_workflow,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
