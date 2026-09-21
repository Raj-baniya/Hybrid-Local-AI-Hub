use std::path::{Path, PathBuf};
use std::fs;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use anyhow::{Result, Context};
use crate::schema::{Checkpoint, SideEffectRecord, Event};

#[derive(Clone)]
pub struct StateStore {
    base_dir: PathBuf,
    dedupe_cache: Arc<Mutex<HashMap<String, Event>>>,
}

/// Compute a deterministic blake3 hex hash of a graph's JSON string.
/// Used to bind checkpoints to a specific graph version.
pub fn graph_hash(graph_json: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(graph_json.as_bytes());
    format!("blake3:{}", hasher.finalize().to_hex())
}

impl StateStore {
    pub fn new(base_dir: &Path) -> Result<Self> {
        let store_dir = base_dir.join("state");
        fs::create_dir_all(&store_dir).context("Failed to create state directory")?;

        fs::create_dir_all(store_dir.join("checkpoints"))?;
        fs::create_dir_all(store_dir.join("ledgers"))?;
        fs::create_dir_all(store_dir.join("dedupe"))?;

        // Load persisted dedupe cache on startup
        let dedupe_cache = Self::load_persisted_dedupe_sync(&store_dir);

        Ok(Self {
            base_dir: store_dir,
            dedupe_cache: Arc::new(Mutex::new(dedupe_cache)),
        })
    }

    fn ledger_path(&self, run_id: &str) -> PathBuf {
        self.base_dir.join("ledgers").join(format!("{}.jsonl", run_id))
    }

    fn checkpoint_path(&self, run_id: &str) -> PathBuf {
        self.base_dir.join("checkpoints").join(format!("{}.json", run_id))
    }

    fn dedupe_path(&self) -> PathBuf {
        self.base_dir.join("dedupe").join("events.jsonl")
    }

    // ─── Checkpoint operations ────────────────────────────────────────────────

    pub async fn save_checkpoint(&self, checkpoint: &Checkpoint) -> Result<()> {
        let path = self.checkpoint_path(&checkpoint.run_id);
        let data = serde_json::to_string_pretty(checkpoint)?;
        // Atomic write: temp file → rename
        let tmp_path = path.with_extension("tmp");
        fs::write(&tmp_path, &data)?;
        fs::rename(&tmp_path, &path)?;
        Ok(())
    }

    pub async fn load_checkpoint(&self, run_id: &str) -> Result<Option<Checkpoint>> {
        let path = self.checkpoint_path(run_id);
        if !path.exists() {
            return Ok(None);
        }
        let data = fs::read_to_string(path)?;
        let cp: Checkpoint = serde_json::from_str(&data)?;
        Ok(Some(cp))
    }

    pub async fn delete_checkpoint(&self, run_id: &str) -> Result<()> {
        let path = self.checkpoint_path(run_id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    // ─── Side-effect ledger operations ───────────────────────────────────────

    /// Append a side-effect record to the run's JSONL ledger.
    pub async fn log_side_effect(&self, record: &SideEffectRecord) -> Result<()> {
        use std::io::Write;
        let path = self.ledger_path(&record.run_id);
        let mut file = fs::OpenOptions::new().create(true).append(true).open(path)?;
        let data = serde_json::to_string(record)?;
        writeln!(file, "{}", data)?;
        Ok(())
    }

    /// Look up a completed+verified side effect by its idempotency key for a given run.
    /// Returns the completed record if found, None if not found or only an intent record exists.
    /// This is the critical method for idempotency enforcement: before re-executing a node,
    /// call this to check if the effect already happened.
    pub async fn get_side_effect_by_key(&self, run_id: &str, key: &str) -> Option<SideEffectRecord> {
        let path = self.ledger_path(run_id);
        if !path.exists() {
            return None;
        }
        let content = fs::read_to_string(&path).ok()?;
        // Collect all records with this key, prefer the completed+verified one
        let mut completed_record: Option<SideEffectRecord> = None;
        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(record) = serde_json::from_str::<SideEffectRecord>(line) {
                if record.idempotency_key == key {
                    if record.completed_at.is_some() && record.verified {
                        completed_record = Some(record);
                    }
                }
            }
        }
        completed_record
    }

    /// Return all completed+verified side effects for a run (used in crash recovery).
    pub async fn get_all_completed_side_effects(&self, run_id: &str) -> Vec<SideEffectRecord> {
        let path = self.ledger_path(run_id);
        if !path.exists() {
            return vec![];
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => return vec![],
        };
        let mut by_key: HashMap<String, SideEffectRecord> = HashMap::new();
        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(record) = serde_json::from_str::<SideEffectRecord>(line) {
                if record.completed_at.is_some() && record.verified {
                    by_key.insert(record.idempotency_key.clone(), record);
                }
            }
        }
        by_key.into_values().collect()
    }

    /// Append a completion record to the JSONL ledger for a side effect that was previously
    /// logged as intent-only. The caller supplies the fully-populated completion record.
    pub async fn mark_side_effect_complete(&self, run_id: &str, effect_id: &str) -> Result<()> {
        // Re-read the ledger to find the original intent record and build a completion record.
        let path = self.ledger_path(run_id);
        let content = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read ledger for run {}", run_id))?;

        let mut found: Option<SideEffectRecord> = None;
        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(record) = serde_json::from_str::<SideEffectRecord>(line) {
                if record.effect_id == effect_id {
                    found = Some(record);
                }
            }
        }

        let mut record = found.with_context(|| {
            format!("No ledger entry found for effect_id {} in run {}", effect_id, run_id)
        })?;

        // Stamp completion
        record.completed_at = Some(chrono::Utc::now().to_rfc3339());
        record.verified = true;

        // Append the completion record
        self.log_side_effect(&record).await
    }

    // ─── Event deduplication (persistent) ────────────────────────────────────

    fn load_persisted_dedupe_sync(store_dir: &Path) -> HashMap<String, Event> {
        let path = store_dir.join("dedupe").join("events.jsonl");
        if !path.exists() {
            return HashMap::new();
        }
        let mut map = HashMap::new();
        if let Ok(content) = fs::read_to_string(&path) {
            for line in content.lines() {
                if let Ok(event) = serde_json::from_str::<Event>(line) {
                    map.insert(event.idempotency_key.clone(), event);
                }
            }
        }
        map
    }

    pub async fn persist_event_dedupe(&self, event: &Event) -> Result<()> {
        use std::io::Write;
        let path = self.dedupe_path();
        let mut file = fs::OpenOptions::new().create(true).append(true).open(path)?;
        let data = serde_json::to_string(event)?;
        writeln!(file, "{}", data)?;
        Ok(())
    }

    pub async fn check_event_duplicate(&self, idempotency_key: &str) -> bool {
        let cache = self.dedupe_cache.lock().await;
        cache.contains_key(idempotency_key)
    }

    pub async fn record_event(&self, event: Event) {
        let _ = self.persist_event_dedupe(&event).await;
        let mut cache = self.dedupe_cache.lock().await;
        cache.insert(event.idempotency_key.clone(), event);
    }
}
