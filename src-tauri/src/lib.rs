mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::generate_graph,
            commands::list_ollama_models,
            commands::pick_folder,
            commands::pick_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
