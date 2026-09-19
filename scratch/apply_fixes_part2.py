"""
Patch for OS credential store and executor run_graph resume_run_id.
"""
import os

ROOT = "e:/Hybrid Local AI Hub"

def read(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as f:
        return f.read()

def write(path, content):
    with open(os.path.join(ROOT, path), "w", encoding="utf-8") as f:
        f.write(content)

def replace_once(content, old, new, label):
    if old not in content:
        print(f"  SKIP [{label}]: target string not found")
        return content
    result = content.replace(old, new, 1)
    print(f"  OK   [{label}]")
    return result

# 1. Add keyring to Cargo.toml
c = read("src-tauri/Cargo.toml")
if "keyring = " not in c:
    c = replace_once(c, "uuid = \"1.26.1\"", "uuid = \"1.26.1\"\nkeyring = \"3.6.1\"", "add keyring")
    write("src-tauri/Cargo.toml", c)
else:
    print("  SKIP [add keyring] already present")

# 2. Update commands.rs (ProviderConfig, save_provider, get_providers, delete_provider)
c = read("src-tauri/src/commands.rs")

old_providers_block = """// ———————————————————————————————————————————————————————————————————
// Providers (API Keys)
// ———————————————————————————————————————————————————————————————————

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ProviderConfig {
    pub key: String,
    pub name: String,
    pub model: String,
}

#[tauri::command]
pub fn save_provider(app: tauri::AppHandle, provider: ProviderConfig) -> Result<(), String> {
    let providers_file = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("providers.json");
        
    let mut providers: std::collections::HashMap<String, ProviderConfig> = std::collections::HashMap::new();
    if providers_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&providers_file) {
            if let Ok(existing) = serde_json::from_str(&content) {
                providers = existing;
            }
        }
    }
    
    providers.insert(provider.name.clone(), provider);
    
    let json_str = serde_json::to_string_pretty(&providers)
        .map_err(|e| format!("Serialization failed: {e}"))?;
        
    std::fs::write(&providers_file, json_str)
        .map_err(|e| format!("Failed to write providers file: {e}"))
}"""

new_providers_block = """// ———————————————————————————————————————————————————————————————————
// Providers (API Keys)
// ———————————————————————————————————————————————————————————————————
use keyring::Entry;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ProviderConfig {
    pub key: String, // Will be redacted or omitted when sent to frontend
    pub name: String,
    pub model: String,
}

#[tauri::command]
pub fn save_provider(app: tauri::AppHandle, provider: ProviderConfig) -> Result<(), String> {
    let providers_file = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("providers.json");
        
    // 1. Save key to OS credential store
    let entry = Entry::new("hybrid-local-ai-hub", &provider.name)
        .map_err(|e| format!("Failed to create keyring entry: {e}"))?;
    entry.set_password(&provider.key)
        .map_err(|e| format!("Failed to save API key to OS credential store: {e}"))?;

    // 2. Save non-secret config to providers.json
    let mut providers: std::collections::HashMap<String, ProviderConfig> = std::collections::HashMap::new();
    if providers_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&providers_file) {
            if let Ok(existing) = serde_json::from_str(&content) {
                providers = existing;
            }
        }
    }
    
    // Store with redacted key in the file
    let mut public_provider = provider.clone();
    public_provider.key = "***".to_string();
    providers.insert(public_provider.name.clone(), public_provider);
    
    let json_str = serde_json::to_string_pretty(&providers)
        .map_err(|e| format!("Serialization failed: {e}"))?;
        
    std::fs::write(&providers_file, json_str)
        .map_err(|e| format!("Failed to write providers file: {e}"))
}"""
c = replace_once(c, old_providers_block, new_providers_block, "save_provider keyring")

# Update get_providers (which currently populates from .env and just returns)
# I need to make sure delete_provider also deletes from keyring
old_delete_provider = """#[tauri::command]
pub fn delete_provider(app: tauri::AppHandle, name: String) -> Result<(), String> {"""
new_delete_provider = """#[tauri::command]
pub fn delete_provider(app: tauri::AppHandle, name: String) -> Result<(), String> {
    if let Ok(entry) = Entry::new("hybrid-local-ai-hub", &name) {
        let _ = entry.delete_password();
    }"""
c = replace_once(c, old_delete_provider, new_delete_provider, "delete_provider keyring")

write("src-tauri/src/commands.rs", c)


# 3. Update executor.rs run_graph signature and resume functionality
c = read("src/executor.rs")

old_run_graph = """pub async fn run_graph(
    graph: &Graph,
    agent: Option<&AgentDefinition>,
    config: ExecutorConfig,
    trigger_source: &str,
    event_sender: Option<tokio::sync::mpsc::UnboundedSender<crate::execution_record::NodeRecord>>,
) -> Result<ExecutionRecord> {"""

new_run_graph = """pub async fn run_graph(
    graph: &Graph,
    agent: Option<&AgentDefinition>,
    config: ExecutorConfig,
    trigger_source: &str,
    event_sender: Option<tokio::sync::mpsc::UnboundedSender<crate::execution_record::NodeRecord>>,
    resume_run_id: Option<String>,
) -> Result<ExecutionRecord> {"""
c = replace_once(c, old_run_graph, new_run_graph, "run_graph signature")

old_resume = """    let mut record = ExecutionRecord::new(trigger_source, None);
    let run_id = record.execution_id.clone();
    
    let outputs: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    // Attempt crash recovery: load checkpoints for this run_id (or if we passed a specific run_id to resume)
    // For now we'll just prepopulate from any existing checkpoint
    if let Ok(Some(cp)) = state_store.load_checkpoint(&run_id).await {"""

new_resume = """    let mut record = ExecutionRecord::new(trigger_source, None);
    if let Some(res_id) = resume_run_id {
        record.execution_id = res_id;
    }
    let run_id = record.execution_id.clone();
    
    let outputs: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    // Attempt crash recovery: load checkpoints for this run_id
    if let Ok(Some(cp)) = state_store.load_checkpoint(&run_id).await {"""
c = replace_once(c, old_resume, new_resume, "run_graph resume")
write("src/executor.rs", c)

# 4. Update src/lib.rs (tests / calls to run_graph)
c = read("src/lib.rs")
# wait, lib.rs might not call run_graph directly, but if there's any tests
c = c.replace("run_graph(&graph, None, config, trigger_source, None).await", 
              "run_graph(&graph, None, config, trigger_source, None, None).await")
write("src/lib.rs", c)

# 5. Update src-tauri/src/commands.rs calls to run_graph
c = read("src-tauri/src/commands.rs")
c = c.replace("hybrid_local_ai_hub::executor::run_graph(&graph, agent_ref, config, \"api\", Some(tx)).await",
              "hybrid_local_ai_hub::executor::run_graph(&graph, agent_ref, config, \"api\", Some(tx), None).await")
write("src-tauri/src/commands.rs", c)

# 6. Update src/bin/test_nodes.rs
c = read("src/bin/test_nodes.rs")
c = c.replace("hybrid_local_ai_hub::executor::run_graph(&graph, None, config, \"manual\", None).await",
              "hybrid_local_ai_hub::executor::run_graph(&graph, None, config, \"manual\", None, None).await")
write("src/bin/test_nodes.rs", c)

# 7. Update src/providers.rs to use keyring when fetching keys for API requests
c = read("src/providers.rs")
old_provider_init = """    pub fn new(ollama_url: &str, offline_mode: bool, online_keys: std::collections::HashMap<String, String>) -> Self {
        Self {
            ollama_url: ollama_url.to_string(),
            offline_mode,
            online_keys,
        }
    }"""
new_provider_init = """    pub fn new(ollama_url: &str, offline_mode: bool, online_keys: std::collections::HashMap<String, String>) -> Self {
        Self {
            ollama_url: ollama_url.to_string(),
            offline_mode,
            online_keys,
        }
    }

    /// Resolve API key checking OS credential store first, fallback to `online_keys`.
    fn get_api_key(&self, provider_name: &str) -> Option<String> {
        if let Ok(entry) = keyring::Entry::new("hybrid-local-ai-hub", provider_name) {
            if let Ok(pw) = entry.get_password() {
                return Some(pw);
            }
        }
        self.online_keys.get(provider_name).cloned()
    }"""
c = replace_once(c, old_provider_init, new_provider_init, "providers get_api_key")

old_auth_header = """            // We assume a single primary key for now if multiple models aren't passed.
            // A more complete system would lookup by provider name.
            let key = self.online_keys.values().next().cloned().unwrap_or_default();
            req = req.bearer_auth(key);"""
new_auth_header = """            // We'll use get_api_key with a known provider name or fallback
            // In a complete implementation, the exact provider name is passed.
            // For now we'll check common ones like "OpenAI" or "Anthropic" or the first value.
            let key = self.get_api_key("OpenAI")
                .or_else(|| self.get_api_key("Anthropic"))
                .or_else(|| self.online_keys.values().next().cloned())
                .unwrap_or_default();
            req = req.bearer_auth(key);"""
c = replace_once(c, old_auth_header, new_auth_header, "providers auth header")
write("src/providers.rs", c)

print("Done phase 2.")
