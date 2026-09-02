use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedOutput {
    pub output_json: String,
    pub timestamp: u64,
}

pub struct ExecutionCache {
    store: Mutex<HashMap<String, CachedOutput>>,
}

impl ExecutionCache {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, key: &str) -> Option<CachedOutput> {
        let store = self.store.lock().unwrap();
        store.get(key).cloned()
    }

    pub fn set(&self, key: String, output: CachedOutput) {
        let mut store = self.store.lock().unwrap();
        store.insert(key, output);
    }

    pub fn clear(&self) {
        let mut store = self.store.lock().unwrap();
        store.clear();
    }
}
