"""
Multi-file patch: apply all verified reviewer fixes.
Run from e:/Hybrid Local AI Hub root.
"""
import os, re

ROOT = "e:/Hybrid Local AI Hub"

def read(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as f:
        return f.read()

def write(path, content):
    with open(os.path.join(ROOT, path), "w", encoding="utf-8") as f:
        f.write(content)

def replace_once(content, old, new, label):
    if old not in content:
        print(f"  SKIP [{label}]: target string not found in file")
        return content
    result = content.replace(old, new, 1)
    print(f"  OK   [{label}]")
    return result

# ────────────────────────────────────────────────────────────────────────────
# 1. Delete scratch patch scripts (keep directory but remove the 3 one-off files)
# ────────────────────────────────────────────────────────────────────────────
print("=== 1. Removing scratch patch scripts ===")
for fname in ["patch_compile_errors.py", "patch_executor_durability.py", "patch_test_nodes.py",
              "patch_topbar_portals.py"]:
    p = os.path.join(ROOT, "scratch", fname)
    if os.path.exists(p):
        os.remove(p)
        print(f"  Deleted scratch/{fname}")
    else:
        print(f"  Already absent: scratch/{fname}")

# ────────────────────────────────────────────────────────────────────────────
# 2. commands.rs – chat history path traversal guard
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 2. commands.rs – chat history ID validation ===")
c = read("src-tauri/src/commands.rs")

# save_chat_history: add ID validation before path construction
old_save = """    std::fs::create_dir_all(&history_dir).map_err(|e| format!("Failed to create history dir: {e}"))?;
    
    let path = history_dir.join(format!("{}.json", entry.id));"""
new_save = """    std::fs::create_dir_all(&history_dir).map_err(|e| format!("Failed to create history dir: {e}"))?;

    if entry.id == ".." || !is_valid_filename(&entry.id) {
        return Err("Invalid history entry ID".to_string());
    }
    let path = history_dir.join(format!("{}.json", entry.id));"""
c = replace_once(c, old_save, new_save, "save_chat_history ID guard")

# delete_chat_history: add ID validation
old_delete = """    let path = history_dir.join(format!("{}.json", id));
    if path.exists() {"""
new_delete = """    if id == ".." || !is_valid_filename(&id) {
        return Err("Invalid history ID".to_string());
    }
    let path = history_dir.join(format!("{}.json", id));
    if path.exists() {"""
c = replace_once(c, old_delete, new_delete, "delete_chat_history ID guard")

# save_provider / get_providers: redact key in get_providers return
old_providers_return = "    Ok(providers.into_values().collect())"
new_providers_return = """    // Return redacted keys to the frontend; the real key stays backend-only.
    Ok(providers.into_values().map(|mut p| { p.key = "***".to_string(); p }).collect())"""
c = replace_once(c, old_providers_return, new_providers_return, "get_providers redact key")

write("src-tauri/src/commands.rs", c)

# ────────────────────────────────────────────────────────────────────────────
# 3. executor.rs – StateStore propagate error instead of unwrap
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 3. executor.rs – StateStore::new propagate error ===")
c = read("src/executor.rs")

old_state_store = """    let base_dir = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")).join(".hybrid-hub");
    let state_store = crate::state_store::StateStore::new(&base_dir).unwrap();"""
new_state_store = """    let base_dir = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")).join(".hybrid-hub");
    let state_store = crate::state_store::StateStore::new(&base_dir)
        .map_err(|e| anyhow!("Failed to initialise state store at {}: {e}", base_dir.display()))?;"""
c = replace_once(c, old_state_store, new_state_store, "StateStore::new propagate error")

# 4. executor.rs – llm_timeout_if_needed: handle DelayNode separately
print("\n=== 4. executor.rs – DelayNode timeout ===")
old_timeout = """fn llm_timeout_if_needed(data: &NodeType, config: &ExecutorConfig) -> u64 {
    match data {
        NodeType::OllamaSelectorNode(_) | NodeType::LocalEmbedderNode(_) => config.llm_timeout_secs,
        _ => config.default_timeout_secs,
    }
}"""
new_timeout = """fn llm_timeout_if_needed(data: &NodeType, config: &ExecutorConfig) -> u64 {
    match data {
        NodeType::OllamaSelectorNode(_) | NodeType::LocalEmbedderNode(_) => config.llm_timeout_secs,
        NodeType::DelayNode(cfg) => cfg.duration_seconds.saturating_add(config.default_timeout_secs),
        _ => config.default_timeout_secs,
    }
}"""
c = replace_once(c, old_timeout, new_timeout, "DelayNode timeout")

# 5. executor.rs – Checkpoint: save only the new output, not the full map
print("\n=== 5. executor.rs – Checkpoint per-node output only ===")
old_cp = """                    // Save checkpoint
                    let cp = crate::schema::Checkpoint {
                        checkpoint_id: uuid::Uuid::new_v4().to_string(),
                        run_id: run_id.clone(),
                        graph_hash: "TODO".to_string(),
                        created_at: chrono::Utc::now().to_rfc3339(),
                        node_id: node_id.clone(),
                        state: out.clone(),
                    };
                    let _ = state_store.save_checkpoint(&cp).await;"""
new_cp = """                    // Save checkpoint with only this node's output to avoid
                    // serialising the full accumulated map on every node completion.
                    let cp = crate::schema::Checkpoint {
                        checkpoint_id: uuid::Uuid::new_v4().to_string(),
                        run_id: run_id.clone(),
                        graph_hash: "TODO".to_string(),
                        created_at: chrono::Utc::now().to_rfc3339(),
                        node_id: node_id.clone(),
                        state: std::collections::HashMap::from([(node_id.clone(), out.get(&node_id).cloned().unwrap_or_default())]),
                    };
                    let _ = state_store.save_checkpoint(&cp).await;"""
c = replace_once(c, old_cp, new_cp, "Checkpoint per-node output only")

# 6. executor.rs – LocalFileWriterNode: mutable effect, resolved path in key, log after write
print("\n=== 6. executor.rs – LocalFileWriterNode side-effect fix ===")
old_effect = """        NodeType::LocalFileWriterNode(cfg) => {
            let effect = crate::schema::SideEffectRecord {
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

            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let content = single
                .ok_or_else(|| anyhow!("LocalFileWriterNode '{}' has no incoming input", node_id))?;
            let path = interpolation::resolve(&cfg.output_path, &locked, None)?;
            let actual_path = path;
            drop(locked);"""
new_effect = """        NodeType::LocalFileWriterNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let content = single
                .ok_or_else(|| anyhow!("LocalFileWriterNode '{}' has no incoming input", node_id))?;
            let actual_path = interpolation::resolve(&cfg.output_path, &locked, None)?;
            drop(locked);

            // Log intent before the write using the resolved path as the idempotency key.
            let mut effect = crate::schema::SideEffectRecord {
                effect_id: uuid::Uuid::new_v4().to_string(),
                run_id: run_id.clone(),
                node_id: node_id.clone(),
                type_: "fs.write".to_string(),
                idempotency_key: format!("blake3:fs.write:{}", actual_path),
                intent_at: chrono::Utc::now().to_rfc3339(),
                completed_at: None,
                reversible: false,
                verified: false,
            };
            let _ = state_store.log_side_effect(&effect).await;"""
c = replace_once(c, old_effect, new_effect, "LocalFileWriterNode side-effect fix")

# Log completed_at after write
old_write_ok = """            Ok(format!("Wrote {} bytes to {}", content.len(), actual_path))
        }

        // ── WebScraperNode"""
new_write_ok = """            // Log the completed side-effect record.
            effect.completed_at = Some(chrono::Utc::now().to_rfc3339());
            effect.verified = true;
            let _ = state_store.log_side_effect(&effect).await;

            Ok(format!("Wrote {} bytes to {}", content.len(), actual_path))
        }

        // ── WebScraperNode"""
c = replace_once(c, old_write_ok, new_write_ok, "LocalFileWriterNode log completed")

write("src/executor.rs", c)

# ────────────────────────────────────────────────────────────────────────────
# 7. network.rs – require both timeout AND connect to succeed
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 7. network.rs – require connect success ===")
c = read("src/network.rs")
old_net = """    for addr in addrs {
        if let Ok(_) = tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(addr)).await {
            return true;
        }
    }"""
new_net = """    for addr in addrs {
        if let Ok(Ok(_)) = tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(addr)).await {
            return true;
        }
    }"""
c = replace_once(c, old_net, new_net, "require connect success")
write("src/network.rs", c)

# ────────────────────────────────────────────────────────────────────────────
# 8. state_store.rs – atomic write for checkpoints
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 8. state_store.rs – atomic checkpoint write ===")
c = read("src/state_store.rs")
old_save_cp = """    pub async fn save_checkpoint(&self, checkpoint: &Checkpoint) -> Result<()> {
        let path = self.checkpoint_path(&checkpoint.run_id);
        let data = serde_json::to_string_pretty(checkpoint)?;
        fs::write(path, data)?;
        Ok(())
    }"""
new_save_cp = """    pub async fn save_checkpoint(&self, checkpoint: &Checkpoint) -> Result<()> {
        let path = self.checkpoint_path(&checkpoint.run_id);
        let data = serde_json::to_string_pretty(checkpoint)?;
        // Write to a temp file in the same directory then rename for atomicity.
        let tmp_path = path.with_extension("tmp");
        fs::write(&tmp_path, &data)?;
        fs::rename(&tmp_path, &path)?;
        Ok(())
    }"""
c = replace_once(c, old_save_cp, new_save_cp, "atomic checkpoint write")
write("src/state_store.rs", c)

# ────────────────────────────────────────────────────────────────────────────
# 9. translator_prompt.rs – fix node counts (32→26, 31→25) and JSON examples
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 9. translator_prompt.rs – node counts + JSON examples ===")
c = read("src/translator_prompt.rs")

# The actual counts in the file are 32/31. The finding says to update to 26/25.
# Verify current state:
if "32 Node Types Available" in c or "32 available node types" in c:
    c = c.replace('"32 Node Types Available"', '"26 Node Types Available"')
    c = c.replace('"32 available node types"', '"26 available node types"')
    c = c.replace('"outside the 32 available nodes"', '"26 available node types"')
    c = c.replace('schema = schema.replace("32 Node Types Available", "31 Node Types Available")',
                  'schema = schema.replace("26 Node Types Available", "25 Node Types Available")')
    c = c.replace('instructions = instructions.replace("32 available node types", "31 available node types")',
                  'instructions = instructions.replace("26 available node types", "25 available node types")')
    c = c.replace('instructions = instructions.replace("outside the 32 available nodes", "outside the 31 available nodes")',
                  'instructions = instructions.replace("outside the 26 available nodes", "outside the 25 available nodes")')
    # Inline occurrences in the const strings
    c = c.replace("the 32 available node types defined above", "the 26 available node types defined above")
    c = c.replace("using ONLY the 32 available node types", "using ONLY the 26 available node types")
    print("  OK   [node type counts 32->26 / 31->25]")
else:
    print("  SKIP [node counts]: strings not found, already updated or different value")

# Fix JSON examples: DelayNode delayMs -> durationSeconds
c = replace_once(c,
    '{ "type": "DelayNode", "delayMs": 5000 }',
    '{ "type": "DelayNode", "durationSeconds": 5 }',
    "DelayNode durationSeconds")

# Fix MergeNode: remove strategy field
c = replace_once(c,
    '{ "type": "MergeNode", "strategy": "concat" }',
    '{ "type": "MergeNode" }',
    "MergeNode remove strategy")

# Fix AiInterpretNode: use requiresFacts / maxClaims instead of prompt/jsonMode
c = replace_once(c,
    '{ "type": "AiInterpretNode", "prompt": "Interpret this: {{input}}", "jsonMode": false }',
    '{ "type": "AiInterpretNode", "requiresFacts": [], "maxClaims": 5 }',
    "AiInterpretNode fields")

write("src/translator_prompt.rs", c)

# ────────────────────────────────────────────────────────────────────────────
# 10. ChatHistorySidebar.tsx – remove clearHistory from mount effect
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 10. ChatHistorySidebar.tsx – fix effects ===")
c = read("ui/components/ChatHistorySidebar.tsx")

old_sidebar_effects = """  useEffect(() => {
    fetchHistory();
    clearHistory();
  }, [isOfflineMode]);

  const { history, fetchHistory, deleteHistoryItem, loadHistoryItem, clearHistory } = useChatStore();

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);"""
new_sidebar_effects = """  const { history, fetchHistory, deleteHistoryItem, loadHistoryItem, clearHistory } = useChatStore();

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, isOfflineMode]);"""
c = replace_once(c, old_sidebar_effects, new_sidebar_effects, "remove clearHistory from effect")
write("ui/components/ChatHistorySidebar.tsx", c)

# ────────────────────────────────────────────────────────────────────────────
# 11. ChatPanel.tsx – preserve valid model selection on mode change
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 11. ChatPanel.tsx – preserve valid model selection ===")
c = read("ui/components/ChatPanel.tsx")
old_model_effect = """  useEffect(() => {
    if (isOfflineMode) {
      if (installedModels.length > 0) setModel(installedModels[0].name);
    } else {
      if (providers.length > 0) setModel(`API|${providers[0].name}|${providers[0].model}`);
    }
  }, [isOfflineMode, installedModels, providers, setModel]);"""
new_model_effect = """  useEffect(() => {
    const currentModel = useChatStore.getState().model;
    if (isOfflineMode) {
      const valid = installedModels.some(m => m.name === currentModel);
      if (!valid && installedModels.length > 0) setModel(installedModels[0].name);
    } else {
      const validApiValues = providers.map(p => `API|${p.name}|${p.model}`);
      const valid = validApiValues.includes(currentModel);
      if (!valid && providers.length > 0) setModel(`API|${providers[0].name}|${providers[0].model}`);
    }
  }, [isOfflineMode, installedModels, providers, setModel]);"""
c = replace_once(c, old_model_effect, new_model_effect, "preserve valid model selection")
write("ui/components/ChatPanel.tsx", c)

# ────────────────────────────────────────────────────────────────────────────
# 12. Navbar.tsx – fix bare isOfflineMode reference
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 12. Navbar.tsx – fix isOfflineMode reference ===")
c = read("ui/components/Navbar.tsx")
old_navbar = "        await invoke('save_execution_log', { offlineMode: isOfflineMode,  record });"
new_navbar = "        await invoke('save_execution_log', { offlineMode: useSettingsStore.getState().isOfflineMode, record });"
c = replace_once(c, old_navbar, new_navbar, "fix isOfflineMode reference")
write("ui/components/Navbar.tsx", c)

# ────────────────────────────────────────────────────────────────────────────
# 13. NodeInspector.tsx – add missing node cases
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 13. NodeInspector.tsx – add missing node cases ===")
c = read("ui/components/NodeInspector.tsx")
old_switch_end = """      case 'RegexExtractorNode':
        return (
          <>
            <label style={labelStyle}>Regex Pattern</label>
            <input
              type="text"
              value={data.pattern}
              onChange={(e) => updateNodeData(selectedNode.id, { pattern: e.target.value })}
              style={inputStyle}
              placeholder="(?i)Total: \\$([0-9.]+)"
            />
            <label style={labelStyle}>Capture Group (0 = full match)</label>
            <input
              type="number"
              value={data.group}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                updateNodeData(selectedNode.id, { group: isNaN(val) ? 0 : val });
              }}
              style={inputStyle}
            />
          </>
        );
    }
  };"""
new_switch_end = """      case 'RegexExtractorNode':
        return (
          <>
            <label style={labelStyle}>Regex Pattern</label>
            <input
              type="text"
              value={data.pattern}
              onChange={(e) => updateNodeData(selectedNode.id, { pattern: e.target.value })}
              style={inputStyle}
              placeholder="(?i)Total: \\$([0-9.]+)"
            />
            <label style={labelStyle}>Capture Group (0 = full match)</label>
            <input
              type="number"
              value={data.group}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                updateNodeData(selectedNode.id, { group: isNaN(val) ? 0 : val });
              }}
              style={inputStyle}
            />
          </>
        );

      case 'NotifyDesktopNode':
        return (
          <>
            <label style={labelStyle}>Title</label>
            <input type="text" value={data.title || ''} onChange={(e) => updateNodeData(selectedNode.id, { title: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>Body</label>
            <input type="text" value={data.body || ''} onChange={(e) => updateNodeData(selectedNode.id, { body: e.target.value })} style={inputStyle} />
          </>
        );

      case 'NotifyWebhookNode':
        return (
          <>
            <label style={labelStyle}>Webhook URL</label>
            <input type="text" value={data.url || ''} onChange={(e) => updateNodeData(selectedNode.id, { url: e.target.value })} style={inputStyle} placeholder="https://hooks.example.com/..." />
            <label style={labelStyle}>Payload Template</label>
            <textarea rows={3} value={data.payload || ''} onChange={(e) => updateNodeData(selectedNode.id, { payload: e.target.value })} style={textareaStyle} placeholder='{"text": "{{input}}"}' />
          </>
        );

      case 'ClipboardTriggerNode':
        return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Reads text from the system clipboard. No configuration required.</p>;

      case 'CsvReaderNode':
        return (
          <>
            <label style={labelStyle}>CSV File Path</label>
            <input type="text" value={data.filePath || ''} onChange={(e) => updateNodeData(selectedNode.id, { filePath: e.target.value })} style={inputStyle} placeholder="./data.csv" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input type="checkbox" checked={data.hasHeaderRow ?? true} onChange={(e) => updateNodeData(selectedNode.id, { hasHeaderRow: e.target.checked })} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>First row is header</span>
            </div>
          </>
        );

      case 'DelayNode':
        return (
          <>
            <label style={labelStyle}>Duration (seconds)</label>
            <input type="number" min={0} value={data.durationSeconds ?? 5} onChange={(e) => updateNodeData(selectedNode.id, { durationSeconds: parseInt(e.target.value, 10) || 0 })} style={inputStyle} />
          </>
        );

      case 'TemplateFormatterNode':
        return (
          <>
            <label style={labelStyle}>Template</label>
            <textarea rows={4} value={data.template || ''} onChange={(e) => updateNodeData(selectedNode.id, { template: e.target.value })} style={textareaStyle} placeholder="Result: {{node_id.output}}" />
          </>
        );

      case 'MergeNode':
        return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Merges all incoming node outputs into a JSON object. No configuration required.</p>;

      case 'SourceFileNode':
        return (
          <>
            <label style={labelStyle}>File Path</label>
            <input type="text" value={data.path || ''} onChange={(e) => updateNodeData(selectedNode.id, { path: e.target.value })} style={inputStyle} placeholder="./dataset.csv" />
            <label style={labelStyle}>Connector</label>
            <input type="text" value={data.connector || 'auto'} onChange={(e) => updateNodeData(selectedNode.id, { connector: e.target.value })} style={inputStyle} placeholder="auto" />
          </>
        );

      case 'DatasetProfileNode':
        return (
          <>
            <label style={labelStyle}>Profile Mode</label>
            <input type="text" value={data.mode || 'auto'} onChange={(e) => updateNodeData(selectedNode.id, { mode: e.target.value })} style={inputStyle} placeholder="auto" />
          </>
        );

      case 'TransformAggregateNode':
        return (
          <>
            <label style={labelStyle}>Group By (comma-separated columns)</label>
            <input type="text" value={(data.groupBy || []).join(',')} onChange={(e) => updateNodeData(selectedNode.id, { groupBy: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} style={inputStyle} />
            <label style={labelStyle}>Aggregations (comma-separated)</label>
            <input type="text" value={(data.aggregations || []).join(',')} onChange={(e) => updateNodeData(selectedNode.id, { aggregations: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} style={inputStyle} />
          </>
        );

      case 'AnalysisStatsHypothesisTestNode':
        return (
          <>
            <label style={labelStyle}>Statistical Test</label>
            <input type="text" value={data.test || 't-test'} onChange={(e) => updateNodeData(selectedNode.id, { test: e.target.value })} style={inputStyle} placeholder="t-test" />
            <label style={labelStyle}>Group Column</label>
            <input type="text" value={data.groupColumn || ''} onChange={(e) => updateNodeData(selectedNode.id, { groupColumn: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>Value Column</label>
            <input type="text" value={data.valueColumn || ''} onChange={(e) => updateNodeData(selectedNode.id, { valueColumn: e.target.value })} style={inputStyle} />
          </>
        );

      case 'AiInterpretNode':
        return (
          <>
            <label style={labelStyle}>Required Facts (one per line)</label>
            <textarea rows={3} value={(data.requiresFacts || []).join('\\n')} onChange={(e) => updateNodeData(selectedNode.id, { requiresFacts: e.target.value.split('\\n').map((s: string) => s.trim()).filter(Boolean) })} style={textareaStyle} />
            <label style={labelStyle}>Max Claims</label>
            <input type="number" min={0} value={data.maxClaims ?? 5} onChange={(e) => updateNodeData(selectedNode.id, { maxClaims: parseInt(e.target.value, 10) || 5 })} style={inputStyle} />
          </>
        );

      case 'AiPlanNode':
        return (
          <>
            <label style={labelStyle}>Objective</label>
            <textarea rows={3} value={data.objective || ''} onChange={(e) => updateNodeData(selectedNode.id, { objective: e.target.value })} style={textareaStyle} />
            <label style={labelStyle}>Model Role</label>
            <input type="text" value={data.modelRole || 'planner'} onChange={(e) => updateNodeData(selectedNode.id, { modelRole: e.target.value })} style={inputStyle} />
          </>
        );
    }
  };"""
c = replace_once(c, old_switch_end, new_switch_end, "add missing node inspector cases")
write("ui/components/NodeInspector.tsx", c)

# ────────────────────────────────────────────────────────────────────────────
# 14. TopBar.tsx – confirm preflightStatus portal has document.body
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 14. TopBar.tsx – verify preflightStatus portal ===")
c = read("ui/components/TopBar.tsx")
# Already patched; check it's correct
if "preflightStatus && ReactDOM.createPortal(" in c and "document.body" in c:
    # Check it ends with document.body (not missing)
    idx = c.find("preflightStatus && ReactDOM.createPortal(")
    snippet = c[idx:idx+500]
    if "document.body" in snippet:
        print("  OK   [preflightStatus portal]: already correctly passing document.body")
    else:
        # The portal is missing document.body – add it
        old_preflight_end = """          </div>
        </div>
      )}"""
        new_preflight_end = """          </div>
        </div>,
        document.body
      )}"""
        c = replace_once(c, old_preflight_end, new_preflight_end, "preflightStatus portal document.body")
        write("ui/components/TopBar.tsx", c)
else:
    print("  SKIP [preflightStatus portal]: structure unexpected, manual review needed")

# ────────────────────────────────────────────────────────────────────────────
# 15. graphSchema.ts – maxClaims nonnegative, cron validation
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 15. graphSchema.ts – maxClaims nonnegative ===")
c = read("ui/schema/graphSchema.ts")
c = replace_once(c,
    "maxClaims: z.number().int().default(5),",
    "maxClaims: z.number().int().nonnegative().default(5),",
    "maxClaims nonnegative")
# cron validation: add a basic regex check
c = replace_once(c,
    "cronExpression: z.string().min(1, 'Cron expression is required'),",
    "cronExpression: z.string().min(1, 'Cron expression is required')\n    .regex(/^(\\S+\\s){4}\\S+$/, 'Cron expression must have exactly 5 fields'),",
    "cron 5-field validation")
write("ui/schema/graphSchema.ts", c)

# ────────────────────────────────────────────────────────────────────────────
# 16. chatStore.ts – typed invoke for list_chat_history
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 16. chatStore.ts – typed invoke ===")
c = read("ui/store/chatStore.ts")
c = replace_once(c,
    "const history = await invoke('list_chat_history', { offlineMode: useSettingsStore.getState().isOfflineMode });",
    "const history = await invoke<ChatHistoryEntry[]>('list_chat_history', { offlineMode: useSettingsStore.getState().isOfflineMode });",
    "typed invoke list_chat_history")
write("ui/store/chatStore.ts", c)

print("\n=== All patches complete ===")
