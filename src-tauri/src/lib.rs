pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::PullState::default())
        .manage(commands::ChatState::default())
        .invoke_handler(tauri::generate_handler![
            commands::run_graph,
            commands::validate_graph,
            commands::list_models,
            commands::cmd_check_ollama,
            commands::pull_model,
            commands::cancel_pull,
            commands::chat_generate,
            commands::chat_edit,
            commands::cancel_llm_task,
            commands::save_workflow,
            commands::save_text_file,
            commands::load_workflow,
            commands::cmd_system_info,
            commands::list_agents,
            commands::save_agent,
            commands::load_agent,
            commands::launch_agent_terminal,
            commands::help_agent_ask,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
