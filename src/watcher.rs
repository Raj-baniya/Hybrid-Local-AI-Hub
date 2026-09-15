use anyhow::{anyhow, Result};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;
use tokio::sync::mpsc as tokio_mpsc;

/// A file-system watcher that yields paths of changed files via a tokio channel.
///
/// Wraps `notify`'s platform-native watcher and bridges it to async.
pub struct FileWatcher {
    _watcher: RecommendedWatcher, // keep alive
    pub rx: tokio_mpsc::Receiver<Result<std::path::PathBuf>>,
}

impl FileWatcher {
    /// Start watching `path`. If `recursive` is true, all subdirectories are
    /// watched; otherwise only the immediate directory.
    pub fn new(path: &str, recursive: bool) -> Result<Self> {
        let (sync_tx, sync_rx) = mpsc::channel::<notify::Result<Event>>();
        let (async_tx, async_rx) = tokio_mpsc::channel::<Result<std::path::PathBuf>>(256);

        let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
            let _ = sync_tx.send(event);
        })
        .map_err(|e| anyhow!("Failed to create file watcher: {e}"))?;

        let mode = if recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };

        watcher
            .watch(Path::new(path), mode)
            .map_err(|e| anyhow!("Failed to watch path '{}': {e}", path))?;

        // Bridge sync â†’ async in a dedicated thread.
        let async_tx_clone = async_tx.clone();
        std::thread::spawn(move || {
            loop {
                match sync_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(Ok(event)) => {
                        for path in event.paths {
                            if async_tx_clone
                                .blocking_send(Ok(path))
                                .is_err()
                            {
                                return; // receiver dropped, stop thread
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        let _ = async_tx_clone
                            .blocking_send(Err(anyhow!("Watcher error: {e}")));
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
        });

        Ok(Self {
            _watcher: watcher,
            rx: async_rx,
        })
    }
}
