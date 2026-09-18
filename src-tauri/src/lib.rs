pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
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
            commands::delete_model,
            commands::chat_generate,
            commands::chat_edit,
            commands::cancel_llm_task,
            commands::save_workflow,
            commands::save_text_file,
            commands::load_workflow,
            commands::cmd_system_info,
            commands::get_cli_command,
            commands::save_execution_log,
            commands::list_execution_logs,
            commands::list_agents,
            commands::save_agent,
            commands::rename_agent,
            commands::load_agent,
            commands::save_agent_output,
            commands::get_agent_output,
            commands::get_agent_path,
            commands::launch_agent_terminal,
            commands::help_agent_ask,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        eprintln!("Fatal error while running Tauri application: {}", e);
        std::process::exit(1);
    }
}
