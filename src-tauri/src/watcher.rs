use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc::channel;
use tauri::{AppHandle, Emitter};

pub fn start_watching<R: tauri::Runtime>(
    app: AppHandle<R>,
    node_id: String,
    path: String,
) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("Failed to create file watcher: {e}"))?;
    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch path {path}: {e}"))?;

    std::thread::spawn(move || {
        for res in rx {
            if let Ok(event) = res {
                if event.kind.is_create() {
                    if let Some(file_path) = event.paths.first() {
                        let _ = app.emit(
                            "file-watcher-triggered",
                            serde_json::json!({
                                "node_id": node_id,
                                "file_path": file_path.to_string_lossy(),
                            }),
                        );
                    }
                }
            }
        }
    });

    Ok(watcher)
}
