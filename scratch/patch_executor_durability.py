import os
import re

file_path = "e:/Hybrid Local AI Hub/src/executor.rs"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add run_id and state_store to execute_node signature
signature_old = """async fn execute_node(
    node_id: String,
    node_data: NodeType,
    outputs: Arc<Mutex<HashMap<String, String>>>,
    chroma: ChromaClient,
    ollama: std::sync::Arc<ProviderManager>,
    predecessors: Vec<String>,
    skipped: Arc<Mutex<HashSet<String>>>,
    trigger_source: String,
) -> Result<String> {"""
signature_new = """async fn execute_node(
    node_id: String,
    node_data: NodeType,
    outputs: Arc<Mutex<HashMap<String, String>>>,
    chroma: ChromaClient,
    ollama: std::sync::Arc<ProviderManager>,
    predecessors: Vec<String>,
    skipped: Arc<Mutex<HashSet<String>>>,
    trigger_source: String,
    run_id: String,
    state_store: crate::state_store::StateStore,
) -> Result<String> {"""

content = content.replace(signature_old, signature_new)

# 2. Add run_id to run_graph execution record creation
rec_old = """    let mut record = ExecutionRecord::new(trigger_source, None);"""
rec_new = """    let mut record = ExecutionRecord::new(trigger_source, None);
    let run_id = record.execution_id.clone();
    
    // Attempt crash recovery: load checkpoints for this run_id (or if we passed a specific run_id to resume)
    // For now we'll just prepopulate from any existing checkpoint
    if let Ok(Some(cp)) = state_store.load_checkpoint(&run_id).await {
        let mut out = outputs.lock().await;
        for (k, v) in cp.state {
            out.insert(k, v);
        }
    }
"""
content = content.replace(rec_old, rec_new)

# 3. Add state_store to tokio spawn and execute_node call
tokio_old = """            let handle = tokio::spawn(async move {"""
tokio_new = """            let state_store = state_store.clone();
            let run_id_clone = run_id.clone();
            let handle = tokio::spawn(async move {"""
content = content.replace(tokio_old, tokio_new)

call_old = """                let fut = execute_node(node_id.clone(), node_data.clone(), outputs.clone(), chroma.clone(), ollama.clone(), predecessors.clone(), skipped.clone(), trigger_source_cloned);"""
call_new = """                
                // If output already exists from checkpoint, skip execution and return it
                {
                    let out = outputs.lock().await;
                    if let Some(res) = out.get(&node_id) {
                        return (node_id.clone(), Ok(res.clone()));
                    }
                }
                
                let fut = execute_node(node_id.clone(), node_data.clone(), outputs.clone(), chroma.clone(), ollama.clone(), predecessors.clone(), skipped.clone(), trigger_source_cloned, run_id_clone, state_store.clone());"""
content = content.replace(call_old, call_new)

# 4. Save checkpoint after successful node execution
success_old = """                    nr.succeed(&output);
                    outputs.lock().await.insert(node_id.clone(), output);"""
success_new = """                    nr.succeed(&output);
                    let mut out = outputs.lock().await;
                    out.insert(node_id.clone(), output);
                    
                    // Save checkpoint
                    let cp = crate::schema::Checkpoint {
                        checkpoint_id: uuid::Uuid::new_v4().to_string(),
                        run_id: run_id.clone(),
                        graph_hash: "TODO".to_string(),
                        created_at: chrono::Utc::now().to_rfc3339(),
                        node_id: node_id.clone(),
                        state: out.clone(),
                    };
                    let _ = state_store.save_checkpoint(&cp).await;
"""
content = content.replace(success_old, success_new)

# 5. FileWatcherNode deduplication
fw_old = """            if let Some(p) = target_path {
                let resolved_path = p.to_string_lossy().to_string();"""
fw_new = """            if let Some(p) = target_path {
                let resolved_path = p.to_string_lossy().to_string();
                
                // Dedupe ledger check
                let mut idempotency_key = String::new();
                if let Ok(meta) = p.metadata() {
                    let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH).duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
                    idempotency_key = format!("blake3:{}:{}", resolved_path, mtime);
                } else {
                    idempotency_key = format!("blake3:{}", resolved_path);
                }
                
                if state_store.check_event_duplicate(&idempotency_key).await {
                    return Err(anyhow::anyhow!("SKIP")); // Skip if already processed
                }
                
                let event = crate::schema::Event {
                    event_id: uuid::Uuid::new_v4().to_string(),
                    schema_version: "1.0".to_string(),
                    type_: "fs.file_created".to_string(),
                    source: "watcher".to_string(),
                    occurred_at: chrono::Utc::now().to_rfc3339(),
                    recorded_at: chrono::Utc::now().to_rfc3339(),
                    idempotency_key: idempotency_key.clone(),
                    ttl_s: 86400,
                };
                state_store.record_event(event).await;
                
"""
content = content.replace(fw_old, fw_new)

# 6. Intent logging for LocalFileWriterNode
lfw_old = """        NodeType::LocalFileWriterNode(cfg) => {
            let locked = outputs.lock().await;"""
lfw_new = """        NodeType::LocalFileWriterNode(cfg) => {
            let mut effect = crate::schema::SideEffectRecord {
                effect_id: uuid::Uuid::new_v4().to_string(),
                run_id: run_id.clone(),
                node_id: node_id.clone(),
                type_: "fs.write".to_string(),
                idempotency_key: format!("blake3:fs.write:{}", cfg.output_path),
                intent_at: chrono::Utc::now().to_rfc3339(),
                completed_at: None,
                reversible: false,
                verified: false,
            };
            let _ = state_store.log_side_effect(&effect).await;

            let locked = outputs.lock().await;"""
lfw_old_end = """            Ok(format!("Written to {}", cfg.output_path))
        }"""
lfw_new_end = """            
            effect.completed_at = Some(chrono::Utc::now().to_rfc3339());
            effect.verified = true;
            let _ = state_store.log_side_effect(&effect).await;
            
            Ok(format!("Written to {}", cfg.output_path))
        }"""
content = content.replace(lfw_old, lfw_new).replace(lfw_old_end, lfw_new_end)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patched executor.rs successfully.")
