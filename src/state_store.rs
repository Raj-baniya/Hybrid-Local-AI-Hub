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

impl StateStore {
    pub fn new(base_dir: &Path) -> Result<Self> {
        let store_dir = base_dir.join("state");
        if !store_dir.exists() {
            fs::create_dir_all(&store_dir).context("Failed to create state directory")?;
        }
        
        let checkpoints_dir = store_dir.join("checkpoints");
        if !checkpoints_dir.exists() {
            fs::create_dir_all(&checkpoints_dir)?;
        }
        
        let ledger_dir = store_dir.join("ledgers");
        if !ledger_dir.exists() {
            fs::create_dir_all(&ledger_dir)?;
        }

        Ok(Self {
            base_dir: store_dir,
            dedupe_cache: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    fn ledger_path(&self, run_id: &str) -> PathBuf {
        self.base_dir.join("ledgers").join(format!("{}.jsonl", run_id))
    }

    fn checkpoint_path(&self, run_id: &str) -> PathBuf {
        self.base_dir.join("checkpoints").join(format!("{}.json", run_id))
    }

    pub async fn save_checkpoint(&self, checkpoint: &Checkpoint) -> Result<()> {
        let path = self.checkpoint_path(&checkpoint.run_id);
        let data = serde_json::to_string_pretty(checkpoint)?;
        // Write to a temp file in the same directory then rename for atomicity.
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

    pub async fn log_side_effect(&self, record: &SideEffectRecord) -> Result<()> {
        use std::io::Write;
        let path = self.ledger_path(&record.run_id);
        let mut file = fs::OpenOptions::new().create(true).append(true).open(path)?;
        let data = serde_json::to_string(record)?;
        writeln!(file, "{}", data)?;
        Ok(())
    }

    pub async fn check_event_duplicate(&self, idempotency_key: &str) -> bool {
        let cache = self.dedupe_cache.lock().await;
        cache.contains_key(idempotency_key)
    }

    pub async fn record_event(&self, event: Event) {
        let mut cache = self.dedupe_cache.lock().await;
        cache.insert(event.idempotency_key.clone(), event);
        // Simple memory cache for now. In Phase 2 this should be persisted and respect ttl_s.
    }
}
