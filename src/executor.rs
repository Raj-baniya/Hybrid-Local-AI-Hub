//! Execution engine: topological sort Ã¢â€ â€™ concurrent node execution via Kahn's algorithm.
//!
//! Failure policy:
//!   - Default (`FailurePolicy::HaltOnFailure`): any node failure immediately skips
//!     all downstream-dependent nodes and halts the run.
//!   - `FailurePolicy::ContinueIndependentBranches`: a failing node skips only its
//!     direct dependents; independent branches continue executing.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::chroma::ChromaClient;
use crate::execution_record::{ExecutionRecord, NodeRecord, NodeStatus};
use crate::interpolation;
use crate::providers::ProviderManager;
use crate::schema::{AgentDefinition, Graph, NodeType};

// â”€â”€â”€ Permission Broker Stub â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

pub struct PermissionBroker;

impl PermissionBroker {
    pub fn authorize(agent: Option<&AgentDefinition>, capability: &str) -> Result<()> {
        if let Some(agent) = agent {
            // Check if the agent's autonomy allows the capability, or if it requires approval
            if agent.autonomy.requires_approval_for.iter().any(|c| capability.starts_with(c)) {
                return Err(anyhow::anyhow!("Capability '{}' requires explicit user approval based on agent autonomy policy.", capability));
            }
        }
        // In Phase 1, we default to allow unless it matches a known requires_approval_for rule.
        Ok(())
    }
}


// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Public API Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FailurePolicy {
    HaltOnFailure,
    ContinueIndependentBranches,
}

/// Configuration for a single execution run.
#[derive(Debug, Clone)]
pub struct ExecutorConfig {
    pub ollama_url: String,
    pub chroma_url: String,
    pub failure_policy: FailurePolicy,
    /// Default per-node timeout in seconds.
    pub default_timeout_secs: u64,
    /// Timeout for OllamaSelectorNode and LocalEmbedderNode in seconds.
    pub llm_timeout_secs: u64,
    pub is_offline: bool,
    pub online_keys: Vec<crate::providers::ApiKeyConfig>,
    /// When true, side-effecting nodes log intent but do not actually perform actions.
    pub suppress_actions: bool,
}

impl Default for ExecutorConfig {
    fn default() -> Self {
        Self {
            ollama_url: "http://127.0.0.1:11434".to_string(),
            chroma_url: "http://localhost:8000".to_string(),
            failure_policy: FailurePolicy::HaltOnFailure,
            default_timeout_secs: 10,
            llm_timeout_secs: 600,
            is_offline: true,
            online_keys: vec![],
            suppress_actions: false,
        }
    }
}

/// Run a graph end-to-end.
///
/// Returns the `ExecutionRecord` describing what happened (saved to disk on completion).
pub async fn run_graph(
    graph: &Graph,
    agent: Option<&AgentDefinition>,
    config: ExecutorConfig,
    trigger_source: &str,
    event_sender: Option<tokio::sync::mpsc::UnboundedSender<crate::execution_record::NodeRecord>>,
    resume_run_id: Option<String>,
) -> Result<ExecutionRecord> {
    // Validate graph structure and templates before any node runs.
    crate::validate::validate_graph(graph)
        .map_err(|errors| anyhow!("Workflow validation failed:\n{}", errors.join("\n")))?;
    interpolation::validate_templates(graph)?;

    let ollama = ProviderManager::new(&config.ollama_url, config.is_offline, config.online_keys.clone());
    let chroma = ChromaClient::new(&config.chroma_url);
    
    let base_dir = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")).join(".hybrid-hub");
    let state_store = crate::state_store::StateStore::new(&base_dir)
        .map_err(|e| anyhow!("Failed to initialise state store at {}: {e}", base_dir.display()))?;

    let mut record = ExecutionRecord::new(trigger_source, None);
    if let Some(res_id) = resume_run_id {
        record.execution_id = res_id;
    }
    let run_id = record.execution_id.clone();
    
    let outputs: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    let mut already_completed: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut resumed_from: Option<String> = None;
    
    // Attempt crash recovery: load checkpoints for this run_id
    if let Ok(Some(cp)) = state_store.load_checkpoint(&run_id).await {
        resumed_from = Some(cp.checkpoint_id.clone());
        
        let mut out = outputs.lock().await;
        for (k, v) in &cp.state {
            out.insert(k.clone(), v.clone());
        }
        
        // Mark all nodes present in checkpoint.state as already_completed
        for (node_id, _) in &cp.state {
            already_completed.insert(node_id.clone());
        }
    }


    // Initialise per-node records.
    for node in &graph.nodes {
        let type_name = node_type_name(&node.data);
        record.nodes.push(NodeRecord::new(&node.id, type_name));
    }

    // Mark recovered nodes as Success in the record immediately (fix #5)
    for node_id in &already_completed {
        record.nodes_skipped_on_recovery.push(node_id.clone());
        if let Some(nr) = record.nodes.iter_mut().find(|r| &r.node_id == node_id) {
            let cached_output = {
                let out = outputs.lock().await;
                out.get(node_id).cloned().unwrap_or_default()
            };
            nr.start();
            nr.succeed(&cached_output);
        }
    }

    // Validate that all edges reference existing nodes
    for edge in &graph.edges {
        if !graph.nodes.iter().any(|n| n.id == edge.source) {
            return Err(anyhow::anyhow!("Graph validation error: missing node definition for '{}'", edge.source));
        }
        if !graph.nodes.iter().any(|n| n.id == edge.target) {
            return Err(anyhow::anyhow!("Graph validation error: missing node definition for '{}'", edge.target));
        }
    }

    // Build adjacency and in-degree maps.
    let (adj, mut in_degree) = build_adj_and_indegree(graph);

    let suppress_actions = config.suppress_actions;

    // Hoist failure policy before the loop so it's in scope everywhere.
    let failure_policy = config.failure_policy;

    // Shared state.
    let skipped: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

    // Kahn's BFS: start with all zero-in-degree nodes.
    let mut ready: VecDeque<String> = graph
        .nodes
        .iter()
        .filter(|n| in_degree.get(n.id.as_str()).copied().unwrap_or(0) == 0)
        .map(|n| n.id.clone())
        .collect();

    while !ready.is_empty() {
        // Collect all currently-ready nodes into a concurrent execution layer.
        let layer: Vec<String> = ready.drain(..).collect();

        let mut handles = vec![];
        for node_id in &layer {
            let node = match graph
                .nodes
                .iter()
                .find(|n| &n.id == node_id)
            {
                Some(n) => n,
                None => {
                    return Err(anyhow::anyhow!("Graph validation error: missing node definition for '{}'", node_id));
                }
            };

            let node_data = node.data.clone();
            let node_id = node_id.clone();
            let ollama = std::sync::Arc::new(ollama.clone());
            let chroma = chroma.clone();
            let outputs = Arc::clone(&outputs);
            let skipped = Arc::clone(&skipped);
            let timeout_secs = llm_timeout_if_needed(&node.data, &config);
            // Collect predecessor node IDs for single-input resolution.
            let predecessors: Vec<String> = graph
                .edges
                .iter()
                .filter(|e| e.target == *node_id)
                .map(|e| e.source.clone())
                .collect();

            let tx = event_sender.clone();
            
            // Only mark running if not already marked as Success (from checkpoint recovery)
            let is_already_recovered = already_completed.contains(&node_id);
            let initial_record = {
                if !is_already_recovered {
                    if let Some(nr) = record.nodes.iter_mut().find(|r| r.node_id == *node_id) {
                        nr.start();
                        Some(nr.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            };

            if let (Some(ref s), Some(ir)) = (&tx, initial_record) {
                let _ = s.send(ir);
            }

            let agent_clone = agent.cloned();
            let trigger_source_cloned = trigger_source.to_string();
            let state_store = state_store.clone();
            let run_id_clone = run_id.clone();
            let already_completed_clone = already_completed.clone();
            let handle = tokio::spawn(async move {
                // If this node was skipped (because an upstream failed), skip it too.
                if skipped.lock().await.contains(&node_id) {
                    return (node_id.clone(), Err::<String, anyhow::Error>(anyhow!("SKIP")));
                }

                // If output already exists from checkpoint recovery, return cached result immediately
                if already_completed_clone.contains(&node_id) {
                    let out = outputs.lock().await;
                    if let Some(res) = out.get(&node_id) {
                        return (node_id.clone(), Ok(res.clone()));
                    }
                }

                // Authorize node capabilities
                let capability = match &node_data {
                    NodeType::LocalFileWriterNode(_) => Some("fs.write"),
                    NodeType::ImageInputNode(_) | NodeType::PDFExtractorNode(_) | NodeType::FileWatcherNode(_) | NodeType::CsvReaderNode(_) => Some("fs.read"),
                    NodeType::ShellCommandNode(_) => Some("shell.execute"),
                    NodeType::WebScraperNode(_) => Some("net.egress"),
                    NodeType::NotifyWebhookNode(_) => Some("net.egress"),
                    NodeType::ChromaDbStoreNode(_) => Some("db.write"),
                    _ => None,
                };
                
                if let Some(cap) = capability {
                    if let Err(e) = PermissionBroker::authorize(agent_clone.as_ref(), cap) {
                        return (node_id.clone(), Err(e));
                    }
                }

                
                let fut = execute_node(
                    node_id.clone(),
                    node_data.clone(),
                    outputs.clone(),
                    chroma.clone(),
                    ollama.clone(),
                    predecessors.clone(),
                    skipped.clone(),
                    trigger_source_cloned,
                    run_id_clone,
                    state_store.clone(),
                    suppress_actions,
                );
                let result = timeout(Duration::from_secs(timeout_secs), fut).await;

                match result {
                    Ok(res) => (node_id, res),
                    Err(_) => (
                        node_id.clone(),
                        Err(anyhow!(
                            "Node '{}' timed out after {}s",
                            node_id,
                            timeout_secs
                        )),
                    ),
                }
            });
            handles.push(handle);
        }

        // Collect results and update record.
        let mut any_failed = false;
        let mut failed_ids: Vec<String> = vec![];

        for handle in handles {
            let (node_id, result) = handle.await.map_err(|e| anyhow!("Task panic: {e}"))?;

            let nr = match record
                .nodes
                .iter_mut()
                .find(|r| r.node_id == *node_id)
            {
                Some(n) => n,
                None => continue,
            };

            match result {
                Ok(output) => {
                    // Don't re-mark nodes that were already recovered from checkpoint
                    if nr.status != NodeStatus::Success {
                        if nr.status == NodeStatus::Pending {
                            nr.start();
                        }
                        nr.succeed(&output);
                    }
                    let mut out = outputs.lock().await;
                    out.insert(node_id.clone(), output);
                    // Save checkpoint
                    let cp = crate::schema::Checkpoint {
                        checkpoint_id: uuid::Uuid::new_v4().to_string(),
                        run_id: run_id.clone(),
                        graph_hash: crate::state_store::graph_hash(&serde_json::to_string(graph).unwrap_or_default()),
                        created_at: chrono::Utc::now().to_rfc3339(),
                        node_id: node_id.clone(),
                        input_hashes: out.clone(),
                        state: out.clone(),
                    };
                    state_store.save_checkpoint(&cp).await?;

                    if let Some(ref s) = event_sender {
                        let _ = s.send(nr.clone());
                    }
                }
                Err(e) if e.to_string() == "SKIP" => {
                    nr.skip();
                    if let Some(ref s) = event_sender {
                        let _ = s.send(nr.clone());
                    }
                }
                Err(e) => {
                    if nr.status == NodeStatus::Pending {
                        nr.start();
                    }
                    nr.fail(&e.to_string());
                    any_failed = true;
                    failed_ids.push(node_id.clone());
                    if let Some(ref s) = event_sender {
                        let _ = s.send(nr.clone());
                    }
                }
            }
        }

        // Propagate skip to dependents on failure.
        if any_failed {
            for failed_id in &failed_ids {
                if let Some(deps) = adj.get(failed_id.as_str()) {
                    let mut skip_guard = skipped.lock().await;
                    for dep in deps {
                        if failure_policy == FailurePolicy::HaltOnFailure {
                            // Mark ALL remaining nodes as skipped.
                            for n in &graph.nodes {
                                skip_guard.insert(n.id.clone());
                            }
                        } else {
                            skip_guard.insert(dep.to_string());
                        }
                    }
                }
            }
        }

        // Advance: decrement in-degree for all nodes that were direct children of
        // this layer, then enqueue newly-ready ones.
        for node_id in &layer {
            if let Some(children) = adj.get(node_id.as_str()) {
                for child in children {
                    let deg = in_degree.entry(*child).or_insert(0);
                    *deg = deg.saturating_sub(1);
                    if *deg == 0 {
                        ready.push_back(child.to_string());
                    }
                }
            }
        }
    }

    // Fix #10: save resumed_from before finishing
    record.resumed_from = resumed_from;

    // Fix #9: if all non-recovered nodes ended up Skipped, mark as Failed
    let all_effectively_skipped = record.nodes.iter().all(|n| {
        n.status == NodeStatus::Skipped || record.nodes_skipped_on_recovery.contains(&n.node_id)
    });

    record.finish();

    if all_effectively_skipped && !record.nodes.is_empty() {
        record.overall_status = crate::execution_record::ExecutionStatus::Failed;
    }

    record.save().await?;
    Ok(record)
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Internals Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

fn build_adj_and_indegree(
    graph: &Graph,
) -> (HashMap<&str, Vec<&str>>, HashMap<&str, usize>) {
    let mut adj: HashMap<&str, Vec<&str>> = graph
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), vec![]))
        .collect();
    let mut in_degree: HashMap<&str, usize> = graph
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), 0usize))
        .collect();

    for edge in &graph.edges {
        adj.entry(edge.source.as_str())
            .or_default()
            .push(edge.target.as_str());
        *in_degree.entry(edge.target.as_str()).or_insert(0) += 1;
    }

    (adj, in_degree)
}

fn llm_timeout_if_needed(data: &NodeType, config: &ExecutorConfig) -> u64 {
    match data {
        NodeType::OllamaSelectorNode(_) | NodeType::LocalEmbedderNode(_) => config.llm_timeout_secs,
        NodeType::DelayNode(cfg) => cfg.duration_seconds.saturating_add(config.default_timeout_secs),
        _ => config.default_timeout_secs,
    }
}

fn node_type_name(data: &NodeType) -> &'static str {
    match data {
        NodeType::FileWatcherNode(_) => "FileWatcherNode",
        NodeType::ScheduleNode(_) => "ScheduleNode",
        NodeType::TextInputNode(_) => "TextInputNode",
        NodeType::ImageInputNode(_) => "ImageInputNode",
        NodeType::OllamaSelectorNode(_) => "OllamaSelectorNode",
        NodeType::LocalEmbedderNode(_) => "LocalEmbedderNode",
        NodeType::PDFExtractorNode(_) => "PDFExtractorNode",
        NodeType::ChromaDbStoreNode(_) => "ChromaDbStoreNode",
        NodeType::ConditionalRouterNode(_) => "ConditionalRouterNode",
        NodeType::LocalFileWriterNode(_) => "LocalFileWriterNode",
        NodeType::WebScraperNode(_) => "WebScraperNode",
        NodeType::ShellCommandNode(_) => "ShellCommandNode",
        NodeType::RegexExtractorNode(_) => "RegexExtractorNode",
        NodeType::SourceFileNode(_) => "SourceFileNode",
        NodeType::DatasetProfileNode(_) => "DatasetProfileNode",
        NodeType::TransformAggregateNode(_) => "TransformAggregateNode",
        NodeType::AnalysisStatsHypothesisTestNode(_) => "AnalysisStatsHypothesisTestNode",
        NodeType::AiInterpretNode(_) => "AiInterpretNode",
        NodeType::AiPlanNode(_) => "AiPlanNode",
        NodeType::NotifyDesktopNode(_) => "NotifyDesktopNode",
        NodeType::NotifyWebhookNode(_) => "NotifyWebhookNode",
        NodeType::ClipboardTriggerNode(_) => "ClipboardTriggerNode",
        NodeType::CsvReaderNode(_) => "CsvReaderNode",
        NodeType::DelayNode(_) => "DelayNode",
        NodeType::TemplateFormatterNode(_) => "TemplateFormatterNode",
        NodeType::MergeNode(_) => "MergeNode",

    }
}

/// Execute a single node. Returns its string output.
async fn execute_node(
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
    suppress_actions: bool,
) -> Result<String> {
    match node_data {
        // â”€â”€ TextInputNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::TextInputNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            
            let text_val = cfg.text.clone();
            if text_val.trim().is_empty() && predecessors.is_empty() {
                return Err(anyhow!("TextInputNode '{}': text is empty", node_id));
            }

            let resolved = interpolation::resolve(&text_val, &locked, single.as_deref())?;
            Ok(resolved)
        }

        // â”€â”€ FileWatcherNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::FileWatcherNode(cfg) => {
            let mut target_path = None;
            if trigger_source.starts_with("watch:") {
                let p = trigger_source.trim_start_matches("watch:");
                target_path = Some(std::path::PathBuf::from(p));
            } else {
                let path = std::path::Path::new(&cfg.watch_path);
                if !path.exists() {
                    let _ = std::fs::create_dir_all(path);
                }
                if path.is_dir() {
                    let mut most_recent_time = std::time::UNIX_EPOCH;
                    if let Ok(entries) = std::fs::read_dir(path) {
                        for entry in entries.flatten() {
                            let p = entry.path();
                            if p.is_file() {
                                let mut matches_pattern = true;
                                if let Some(pat) = &cfg.pattern {
                                    if !pat.is_empty() {
                                        let pat_ext = pat.trim_start_matches('*');
                                        if !p.to_string_lossy().ends_with(pat_ext) {
                                            matches_pattern = false;
                                        }
                                    }
                                }
                                if matches_pattern {
                                    if let Ok(meta) = p.metadata() {
                                        if let Ok(mod_time) = meta.modified() {
                                            if mod_time > most_recent_time {
                                                most_recent_time = mod_time;
                                                target_path = Some(p);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            if let Some(p) = target_path {
                Ok(format!("FILE_EVENT:{}", p.to_string_lossy()))
            } else {
                Err(anyhow::anyhow!("FileWatcherNode: No matching files found in '{}' to simulate trigger.", cfg.watch_path))
            }
        }

        // â”€â”€ ScheduleNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::ScheduleNode(_cfg) => {
            // Similar to FileWatcher, yields a placeholder when run sequentially.
            Ok("[ScheduleNode: time-driven â€” use --watch mode]".to_string())
        }

        // â”€â”€ Phase 2 Deterministic Analytics Nodes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::SourceFileNode(cfg) => {
            let path = std::path::Path::new(&cfg.path);
            if !path.exists() {
                return Err(anyhow::anyhow!("SourceFileNode '{}': File not found: '{}'", node_id, cfg.path));
            }

            let connector = cfg.connector.to_lowercase();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

            // CSV connector or auto-detect
            if connector == "csv" || (connector == "auto" || connector.is_empty()) && ext == "csv" {
                let mut rdr = csv::ReaderBuilder::new()
                    .has_headers(true)
                    .from_path(path)?;
                let mut rows: Vec<serde_json::Value> = Vec::new();
                for result in rdr.deserialize::<serde_json::Value>() {
                    match result {
                        Ok(row) => rows.push(row),
                        Err(e) => return Err(anyhow::anyhow!("SourceFileNode '{}': CSV parse error: {}", node_id, e)),
                    }
                }
                return Ok(serde_json::to_string(&rows)?);
            }

            // Parquet not supported offline without a large dep, return a clear message
            if connector == "parquet" || ext == "parquet" {
                return Err(anyhow::anyhow!("SourceFileNode '{}': Parquet format requires an online connector. Use CSV for offline operation.", node_id));
            }

            // Default: read as raw text
            let content = tokio::fs::read_to_string(&cfg.path).await
                .map_err(|e| anyhow::anyhow!("SourceFileNode '{}': Failed to read file '{}': {}", node_id, cfg.path, e))?;
            Ok(content)
        }
        NodeType::DatasetProfileNode(_cfg) => {
            let locked = outputs.lock().await;
            let input = single_input_value(&predecessors, &locked)
                .ok_or_else(|| anyhow::anyhow!("DatasetProfileNode '{}': No incoming input", node_id))?;
            drop(locked);

            // Parse input as JSON array of objects
            match serde_json::from_str::<Vec<serde_json::Value>>(&input) {
                Ok(rows) => {
                    let row_count = rows.len();
                    let column_names: Vec<String> = if let Some(first) = rows.first() {
                        if let serde_json::Value::Object(map) = first {
                            map.keys().cloned().collect()
                        } else {
                            vec![]
                        }
                    } else {
                        vec![]
                    };

                    let profile = serde_json::json!({
                        "row_count": row_count,
                        "columns": column_names,
                        "sample_size": std::cmp::min(row_count, 5),
                        "mode": "basic_profile"
                    });
                    Ok(serde_json::to_string_pretty(&profile)?)
                }
                Err(_) => {
                    // If not JSON array, return text stats
                    let char_count = input.len();
                    let line_count = input.lines().count();
                    let profile = serde_json::json!({
                        "type": "text",
                        "char_count": char_count,
                        "line_count": line_count,
                        "mode": "text_profile"
                    });
                    Ok(serde_json::to_string_pretty(&profile)?)
                }
            }
        }
        NodeType::TransformAggregateNode(cfg) => {
            let locked = outputs.lock().await;
            let input = single_input_value(&predecessors, &locked)
                .ok_or_else(|| anyhow::anyhow!("TransformAggregateNode '{}': No incoming input", node_id))?;
            drop(locked);

            let rows: Vec<serde_json::Value> = serde_json::from_str(&input)
                .unwrap_or_else(|_| {
                    // If input is not JSON array, treat single value as one-element array
                    vec![serde_json::json!({"value": input})]
                });

            let mut result = serde_json::Map::new();
            for col in &cfg.group_by {
                if rows.is_empty() {
                    result.insert(col.clone(), serde_json::Value::Null);
                    continue;
                }
                let col_values: Vec<&serde_json::Value> = rows.iter()
                    .filter_map(|r| r.get(col))
                    .collect();
                result.insert(col.clone(), serde_json::json!(col_values));
            }

            for agg in &cfg.aggregations {
                let (func, arg_col) = if let Some(p) = agg.find('(') {
                    (&agg[..p], agg[p+1..].trim_end_matches(')'))
                } else {
                    (agg.as_str(), "")
                };
                let func_upper = func.to_uppercase();
                let values: Vec<&serde_json::Value> = if arg_col.is_empty() {
                    rows.iter().collect()
                } else {
                    rows.iter().filter_map(|r| r.get(arg_col)).collect()
                };
                let agg_result = match func_upper.as_str() {
                    "COUNT" => serde_json::json!(values.len()),
                    "SUM" => {
                        let sum: f64 = values.iter()
                            .filter_map(|v| v.as_f64())
                            .sum();
                        serde_json::json!(sum)
                    }
                    "AVG" | "AVERAGE" => {
                        let nums: Vec<f64> = values.iter().filter_map(|v| v.as_f64()).collect();
                        if nums.is_empty() { serde_json::json!(0.0) } else { serde_json::json!(nums.iter().sum::<f64>() / nums.len() as f64) }
                    }
                    "MIN" => {
                        let nums: Vec<f64> = values.iter().filter_map(|v| v.as_f64()).collect();
                        if nums.is_empty() { serde_json::json!(null) } else { serde_json::json!(nums.iter().cloned().fold(f64::INFINITY, f64::min)) }
                    }
                    "MAX" => {
                        let nums: Vec<f64> = values.iter().filter_map(|v| v.as_f64()).collect();
                        if nums.is_empty() { serde_json::json!(null) } else { serde_json::json!(nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max)) }
                    }
                    _ => serde_json::json!(format!("unknown:{}", agg)),
                };
                result.insert(agg.clone(), agg_result);
            }

            Ok(serde_json::Value::Object(result).to_string())
        }
        NodeType::AnalysisStatsHypothesisTestNode(cfg) => {
            let locked = outputs.lock().await;
            let input = single_input_value(&predecessors, &locked)
                .ok_or_else(|| anyhow::anyhow!("AnalysisStatsHypothesisTestNode '{}': No incoming input", node_id))?;
            drop(locked);

            let rows: Vec<serde_json::Value> = serde_json::from_str(&input)
                .unwrap_or_else(|_| vec![serde_json::json!({cfg.value_column.clone(): input})]);

            let mut values: Vec<f64> = rows.iter()
                .filter_map(|r| r.get(&cfg.value_column).and_then(|v| v.as_f64()))
                .collect();

            if values.is_empty() {
                return Err(anyhow::anyhow!("AnalysisStatsHypothesisTestNode '{}': No numeric values found in column '{}'", node_id, cfg.value_column));
            }

            values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let n = values.len();
            let mean = values.iter().sum::<f64>() / n as f64;
            let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (n - 1) as f64;
            let std_dev = variance.sqrt();
            let median = if n % 2 == 0 {
                (values[n/2 - 1] + values[n/2]) / 2.0
            } else {
                values[n/2]
            };

            let result = match cfg.test.to_lowercase().as_str() {
                "t-test" => {
                    // One-sample t-test against mean=0
                    let se = std_dev / (n as f64).sqrt();
                    let t_stat = if se > 0.0 { mean / se } else { 0.0 };
                    serde_json::json!({
                        "test": "t-test",
                        "n": n,
                        "mean": mean,
                        "median": median,
                        "std_dev": std_dev,
                        "t_statistic": t_stat,
                        "degrees_of_freedom": n - 1,
                        "interpretation": if t_stat.abs() > 2.0 { "Statistically significant (|t| > 2)" } else { "Not statistically significant (|t| <= 2)" }
                    })
                }
                _ => serde_json::json!({
                    "test": cfg.test,
                    "n": n,
                    "mean": mean,
                    "median": median,
                    "std_dev": std_dev,
                    "interpretation": "Unknown test type"
                }),
            };

            Ok(result.to_string())
        }
        NodeType::AiInterpretNode(cfg) => {
            let locked = outputs.lock().await;
            let mut facts = String::new();
            for req in &cfg.requires_facts {
                let ref_node_id = req.split('.').next().unwrap_or("");
                if let Some(val) = locked.get(ref_node_id) {
                    facts.push_str(&format!("Fact from {}:\n{}\n\n", ref_node_id, val));
                }
            }
            drop(locked);

            let prompt = format!(
                "You are an AI Interpreter (Role 5). Synthesize the following deterministic facts into a maximum of {} claims.\n\nFacts:\n{}",
                cfg.max_claims, facts
            );
            
            let model = cfg.model.clone().unwrap_or_else(|| "llama3.2".to_string());
            ollama.generate(&model, &prompt, vec![], false).await
                .map_err(|e| anyhow!("AiInterpretNode '{}': {e}", node_id))
        }
        NodeType::AiPlanNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let input_data = single.unwrap_or_default();
            drop(locked);

            let prompt = format!(
                "You are an AI Planner agent (Role 2). Your role is: {}.\nYour objective is: {}\n\nBased on the following input data, generate a step-by-step execution plan.\n\nInput Data:\n{}",
                cfg.model_role, cfg.objective, input_data
            );

            let model = cfg.model.clone().unwrap_or_else(|| "llama3.2".to_string());
            ollama.generate(&model, &prompt, vec![], false).await
                .map_err(|e| anyhow!("AiPlanNode '{}': {e}", node_id))
        }

        // â”€â”€ ImageInputNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::ImageInputNode(cfg) => {
            // Read image bytes and base64-encode them for downstream LLM nodes.
            let bytes = tokio::fs::read(&cfg.image_path).await.map_err(|e| {
                anyhow!("ImageInputNode '{}': cannot read '{}': {e}", node_id, cfg.image_path)
            })?;
            use base64::{Engine as _, engine::general_purpose::STANDARD};
            let b64 = STANDARD.encode(&bytes);
            Ok(format!("<image>{}</image>", b64))
        }

        // â”€â”€ PDFExtractorNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::PDFExtractorNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            drop(locked);

            let mut pdf_path = single
                .ok_or_else(|| anyhow!("PDFExtractorNode '{}' has no incoming input", node_id))?;
            if pdf_path.starts_with("FILE_EVENT:") {
                pdf_path = pdf_path.trim_start_matches("FILE_EVENT:").to_string();
            }
            extract_pdf_text(&node_id, &pdf_path, cfg.page_range)
        }

        // â”€â”€ OllamaSelectorNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::OllamaSelectorNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let raw_prompt = interpolation::resolve(&cfg.prompt_template, &locked, single.as_deref())?;
            drop(locked);

            let mut images = Vec::new();
            let mut prompt = raw_prompt.clone();
            
            while let Some(start) = prompt.find("<image>") {
                if let Some(end) = prompt[start..].find("</image>") {
                    let end_idx = start + end;
                    let b64 = &prompt[start + 7..end_idx];
                    images.push(b64.to_string());
                    prompt.replace_range(start..end_idx + 8, "[Attached Image]");
                } else {
                    break;
                }
            }

            ollama
                .generate(&cfg.model, &prompt, images, cfg.json_mode)
                .await
                .map_err(|e| anyhow!("OllamaSelectorNode '{}': {e}", node_id))
        }

        // â”€â”€ LocalEmbedderNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::LocalEmbedderNode(cfg) => {
            let prompt = single_input_value(&predecessors, &*outputs.lock().await).unwrap_or_default();
            let embedding = ollama.embed(&cfg.model, &prompt).await?;
            Ok(serde_json::to_string(&embedding).unwrap_or_default())
        }

        // â”€â”€ ChromaDbStoreNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::ChromaDbStoreNode(cfg) => {
            let locked = outputs.lock().await;

            // Resolve the vector and document from input_map or fallback to single input.
            let (vector_str, document) = if let Some(ref im) = cfg.input_map {
                let vec_ref = im.get("vector").cloned().unwrap_or_default();
                let doc_ref = im.get("document").cloned().unwrap_or_default();
                let vec_node = vec_ref.split('.').next().unwrap_or("");
                let doc_node = doc_ref.split('.').next().unwrap_or("");
                let v = locked.get(vec_node).cloned().unwrap_or_default();
                let d = locked.get(doc_node).cloned().unwrap_or_default();
                (v, d)
            } else {
                let s = single_input_value(&predecessors, &locked)
                    .unwrap_or_default();
                (s.clone(), s)
            };
            drop(locked);

            chroma.create_collection(&cfg.collection_name).await?;

            let embedding: Vec<f32> = serde_json::from_str(&vector_str).map_err(|e| {
                anyhow!(
                    "ChromaDbStoreNode '{}': vector input is not a valid JSON float array: {e}",
                    node_id
                )
            })?;

            let id = uuid::Uuid::new_v4().to_string();
            chroma
                .upsert(&cfg.collection_name, &id, embedding, &document, HashMap::new())
                .await?;

            Ok(format!("Stored document '{}' in collection '{}'", id, cfg.collection_name))
        }

        // â”€â”€ ConditionalRouterNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Fix #8: handle empty condition and empty target edge cases
        NodeType::ConditionalRouterNode(cfg) => {
            // Validate targets first
            if cfg.true_target.is_empty() {
                return Err(anyhow!("ConditionalRouterNode '{}': true_target cannot be empty", node_id));
            }
            if cfg.false_target.is_empty() {
                return Err(anyhow!("ConditionalRouterNode '{}': false_target cannot be empty", node_id));
            }

            let locked = outputs.lock().await;
            let input = single_input_value(&predecessors, &locked)
                .ok_or_else(|| {
                    anyhow!("ConditionalRouterNode '{}' has no incoming input", node_id)
                })?;
            drop(locked);

            // Fix #8: empty condition always routes to true_target
            let matched = if cfg.condition.is_empty() {
                true
            } else {
                !input.is_empty() && input.to_lowercase().contains(&cfg.condition.to_lowercase())
            };

            let (routed_to, skipped_target) = if matched {
                (&cfg.true_target, &cfg.false_target)
            } else {
                (&cfg.false_target, &cfg.true_target)
            };

            // Mark the un-routed target as skipped so it and its children don't run
            skipped.lock().await.insert(skipped_target.clone());

            Ok(format!("routed:{}", routed_to))
        }

                // â”€â”€ LocalFileWriterNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Fix #3: idempotency check before writing
        // Fix #4: dry-run support
        NodeType::LocalFileWriterNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let content = single
                .ok_or_else(|| anyhow!("LocalFileWriterNode '{}' has no incoming input", node_id))?;
            let actual_path = interpolation::resolve(&cfg.output_path, &locked, None)?;
            drop(locked);

            // Fix #4: dry-run mode -- no actual write
            if suppress_actions {
                return Ok(format!("[DRY-RUN] Would write {} bytes to {}", content.len(), actual_path));
            }

            // Fix #3: idempotency check -- if this effect was already completed, skip re-write
            let effect_key = format!("blake3:fs.write:{}", actual_path);
            if let Some(_completed) = state_store.get_side_effect_by_key(&run_id, &effect_key).await {
                // Effect already completed in a previous run - verify file exists
                if std::path::Path::new(&actual_path).exists() {
                    return Ok(format!("Idempotent: file already written to {}", actual_path));
                }
                // File doesn't exist despite completed record - fall through to re-write
            }

            // Log intent before the write using the resolved path as the idempotency key.
            let mut effect = crate::schema::SideEffectRecord {
                effect_id: uuid::Uuid::new_v4().to_string(),
                run_id: run_id.clone(),
                node_id: node_id.clone(),
                type_: "fs.write".to_string(),
                idempotency_key: effect_key,
                intent_at: chrono::Utc::now().to_rfc3339(),
                completed_at: None,
                reversible: false,
                verified: false,
            };
            let _ = state_store.log_side_effect(&effect).await;

            // Ensure parent directory exists.
            let out_path = std::path::Path::new(&actual_path);
            if let Some(parent) = out_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }

            if cfg.append {
                let mut file = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&actual_path)
                    .await?;
                use tokio::io::AsyncWriteExt;
                file.write_all(content.as_bytes()).await?;
            } else {
                tokio::fs::write(&actual_path, &content).await?;
            }
            // Verify the write actually succeeded (post-condition check, not just OS OK signal)
            let verification_result = crate::verification::verify_assertion(
                &crate::verification::VerificationAssertion::FileExists { path: actual_path.clone() },
                &std::collections::HashMap::new(),
            );
            match verification_result {
                Ok(result) if !result.passed => {
                    return Err(anyhow::anyhow!(
                        "LocalFileWriterNode '{}': Write verification failed - file does not exist at '{}' after write. Reason: {}",
                        node_id, actual_path, result.reason
                    ));
                }
                Err(e) => {
                    // Verification infrastructure error, log but don't fail the node
                    eprintln!("LocalFileWriterNode '{}': Verification check error: {}", node_id, e);
                }
                _ => {} // Passed
            }
            // Log the completed side-effect record.
            effect.completed_at = Some(chrono::Utc::now().to_rfc3339());
            effect.verified = true;
            let _ = state_store.log_side_effect(&effect).await;

            Ok(format!("Wrote {} bytes to {}", content.len(), actual_path))
        }

        NodeType::WebScraperNode(cfg) => {
            if ollama.is_offline() {
                return Err(anyhow!("WebScraperNode '{}': Cannot be used in Strict Offline Mode. Turn off Offline Mode to execute this node.", node_id));
            }

            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let url = interpolation::resolve(&cfg.url, &locked, single.as_deref())?;
            drop(locked);

            if suppress_actions {
                return Ok(format!("[DRY-RUN] Would scrape URL: {}", url));
            }

            let client = reqwest::Client::new();
            let response = client.get(&url).send().await
                .map_err(|e| anyhow!("WebScraperNode '{}': Failed to fetch URL: {e}", node_id))?
                .error_for_status()
                .map_err(|e| anyhow!("WebScraperNode '{}': HTTP error: {e}", node_id))?;

            let text = response.text().await
                .map_err(|e| anyhow!("WebScraperNode '{}': Failed to read body: {e}", node_id))?;

            Ok(text)
        }

        NodeType::ShellCommandNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);

            if cfg.unsafe_raw_shell.unwrap_or(false) {
                let command_str = interpolation::resolve(&cfg.command, &locked, single.as_deref())?;
                drop(locked);

                // Fix #4: dry-run mode
                if suppress_actions {
                    return Ok(format!("[DRY-RUN] Would execute: {}", command_str));
                }

                // Fix #3: idempotency check via command hash
                let cmd_hash = {
                    let mut hasher = blake3::Hasher::new();
                    hasher.update(command_str.as_bytes());
                    format!("blake3:{}", hasher.finalize().to_hex())
                };
                let effect_key = format!("blake3:shell:{}", cmd_hash);
                if let Some(_completed) = state_store.get_side_effect_by_key(&run_id, &effect_key).await {
                    return Ok(format!("Idempotent: shell command already executed (hash: {})", cmd_hash));
                }

                let mut effect = crate::schema::SideEffectRecord {
                    effect_id: uuid::Uuid::new_v4().to_string(),
                    run_id: run_id.clone(),
                    node_id: node_id.clone(),
                    type_: "shell.execute".to_string(),
                    idempotency_key: effect_key,
                    intent_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: None,
                    reversible: false,
                    verified: false,
                };
                let _ = state_store.log_side_effect(&effect).await;

                let output = tokio::process::Command::new("powershell")
                    .args(["-Command", &command_str])
                    .kill_on_drop(true)
                    .output()
                    .await
                    .map_err(|e| anyhow!("ShellCommandNode '{}': Execution failed: {e}", node_id))?;

                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

                if !output.status.success() {
                    return Err(anyhow!("ShellCommandNode '{}': Command failed with status {}. Stderr: {}", node_id, output.status, stderr));
                }

                effect.completed_at = Some(chrono::Utc::now().to_rfc3339());
                effect.verified = true;
                let _ = state_store.log_side_effect(&effect).await;

                Ok(stdout)
            } else {
                if cfg.command.contains("{{") {
                    return Err(anyhow!("ShellCommandNode '{}': Input interpolation is rejected by default to prevent shell injection. Enable unsafeRawShell in config if raw shell execution is intended.", node_id));
                }

                // Fix #4: dry-run mode
                if suppress_actions {
                    drop(locked);
                    return Ok(format!("[DRY-RUN] Would execute: {}", cfg.command));
                }

                // Fix #3: idempotency check via command hash (safe path)
                let cmd_hash = {
                    let mut hasher = blake3::Hasher::new();
                    hasher.update(cfg.command.as_bytes());
                    format!("blake3:{}", hasher.finalize().to_hex())
                };
                let effect_key = format!("blake3:shell:{}", cmd_hash);
                if let Some(_completed) = state_store.get_side_effect_by_key(&run_id, &effect_key).await {
                    drop(locked);
                    return Ok(format!("Idempotent: shell command already executed (hash: {})", cmd_hash));
                }

                let mut effect = crate::schema::SideEffectRecord {
                    effect_id: uuid::Uuid::new_v4().to_string(),
                    run_id: run_id.clone(),
                    node_id: node_id.clone(),
                    type_: "shell.execute".to_string(),
                    idempotency_key: effect_key,
                    intent_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: None,
                    reversible: false,
                    verified: false,
                };
                let _ = state_store.log_side_effect(&effect).await;

                drop(locked);

                let mut parts = shlex::split(&cfg.command)
                    .ok_or_else(|| anyhow!("ShellCommandNode '{}': Malformed command string (check quotes)", node_id))?
                    .into_iter();
                let prog = parts.next().ok_or_else(|| anyhow!("ShellCommandNode '{}': Empty command provided", node_id))?;

                let mut cmd = tokio::process::Command::new(&prog);
                cmd.args(parts);

                if let Some(input_val) = single.as_deref() {
                    cmd.arg(input_val);
                }

                let output = cmd
                    .kill_on_drop(true)
                    .output()
                    .await
                    .map_err(|e| anyhow!("ShellCommandNode '{}': Execution failed: {e}", node_id))?;

                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

                if !output.status.success() {
                    return Err(anyhow!("ShellCommandNode '{}': Command failed with status {}. Stderr: {}", node_id, output.status, stderr));
                }

                effect.completed_at = Some(chrono::Utc::now().to_rfc3339());
                effect.verified = true;
                let _ = state_store.log_side_effect(&effect).await;

                Ok(stdout)
            }
        }

                // â”€â”€ RegexExtractorNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::RegexExtractorNode(cfg) => {
            let locked = outputs.lock().await;
            let content_raw = single_input_value(&predecessors, &locked)
                .ok_or_else(|| anyhow!("RegexExtractorNode '{}': no incoming input", node_id))?;
            drop(locked);
            let content = if content_raw.starts_with("FILE_EVENT:") {
                let p = content_raw.trim_start_matches("FILE_EVENT:");
                std::fs::read_to_string(p).unwrap_or_else(|_| content_raw)
            } else {
                content_raw
            };

            let re = regex::Regex::new(&cfg.pattern)
                .map_err(|e| anyhow!("RegexExtractorNode '{}': Invalid regex: {e}", node_id))?;
                
            if let Some(caps) = re.captures(&content) {
                if let Some(m) = caps.get(cfg.group) {
                    return Ok(m.as_str().to_string());
                } else {
                    return Err(anyhow!("RegexExtractorNode '{}': Group {} not found in match", node_id, cfg.group));
                }
            }
            Err(anyhow!("RegexExtractorNode '{}': Pattern did not match", node_id))
        }
        NodeType::ClipboardTriggerNode(_) => {
            let mut board = arboard::Clipboard::new()
                .map_err(|e| anyhow::anyhow!("Clipboard error: {}", e))?;
            let text = board.get_text()
                .map_err(|e| anyhow::anyhow!("Failed to read clipboard text: {}", e))?;
            Ok(text)
        }
        NodeType::CsvReaderNode(cfg) => {
            let locked = outputs.lock().await;
            let path = interpolation::resolve(&cfg.file_path, &locked, None)?;
            drop(locked);
            let mut rdr = csv::ReaderBuilder::new()
                .has_headers(cfg.has_header_row)
                .from_path(path)?;
            let mut rows = Vec::new();
            for result in rdr.deserialize::<serde_json::Value>() {
                rows.push(result?);
            }
            Ok(serde_json::to_string(&rows)?)
        }
        NodeType::DelayNode(cfg) => {
            tokio::time::sleep(tokio::time::Duration::from_secs(cfg.duration_seconds)).await;
            Ok(format!("Delayed for {}s", cfg.duration_seconds))
        }
        NodeType::TemplateFormatterNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let resolved = interpolation::resolve(&cfg.template, &locked, single.as_deref())?;
            Ok(resolved)
        }
        NodeType::MergeNode(_) => {
            let locked = outputs.lock().await;
            let mut merged = std::collections::HashMap::new();
            for pred in &predecessors {
                if let Some(val) = locked.get(pred) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(val) {
                        merged.insert(pred.clone(), json);
                    } else {
                        merged.insert(pred.clone(), serde_json::Value::String(val.clone()));
                    }
                }
            }
            Ok(serde_json::to_string(&merged)?)
        }
        NodeType::NotifyDesktopNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let title = interpolation::resolve(&cfg.title, &locked, single.as_deref())?;
            let body = interpolation::resolve(&cfg.body, &locked, single.as_deref())?;
            drop(locked);

            // Fix #4: dry-run mode
            if suppress_actions {
                return Ok(format!("[DRY-RUN] Would send notification: {}", title));
            }

            tauri_winrt_notification::Toast::new(tauri_winrt_notification::Toast::POWERSHELL_APP_ID)
                .title(&title)
                .text1(&body)
                .show()
                .map_err(|e| anyhow::anyhow!("Failed to send desktop notification: {e}"))?;

            Ok(format!("Notification sent: {}", title))
        }
                NodeType::NotifyWebhookNode(cfg) => {
            if ollama.is_offline() {
                return Err(anyhow::anyhow!("NotifyWebhookNode '{}': Cannot be used in Strict Offline Mode. Turn off Offline Mode to execute this node.", node_id));
            }

            // Fix #4: dry-run mode
            if suppress_actions {
                return Ok(format!("[DRY-RUN] Would send webhook to: {}", cfg.url));
            }

            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let url = interpolation::resolve(&cfg.url, &locked, single.as_deref())?;
            let payload = interpolation::resolve(&cfg.payload, &locked, single.as_deref())?;
            drop(locked);

            let client = reqwest::Client::new();
            let res = client.post(&url)
                .header("Content-Type", "application/json")
                .body(payload)
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to send webhook: {e}"))?;

            if !res.status().is_success() {
                return Err(anyhow::anyhow!("Webhook failed with status: {}", res.status()));
            }
            Ok(format!("Webhook sent successfully"))
        }
    }
}

/// Resolve the single predecessor's output value.
/// If there is exactly one predecessor, returns its output from the outputs map.
/// Returns None if there are zero or multiple predecessors (caller must use explicit refs).
fn single_input_value(
    predecessors: &[String],
    outputs: &HashMap<String, String>,
) -> Option<String> {
    if predecessors.len() == 1 {
        outputs.get(&predecessors[0]).cloned()
    } else {
        None
    }
}

fn extract_pdf_text(
    node_id: &str,
    path: &str,
    page_range: Option<(u32, u32)>,
) -> Result<String> {
    let doc = lopdf::Document::load(path)
        .map_err(|e| anyhow!("PDFExtractorNode '{}': cannot load '{}': {e}", node_id, path))?;

    let mut text = String::new();
    let pages = doc.get_pages();

    for (page_num, &page_id) in &pages {
        let include = match page_range {
            Some((start, end)) => *page_num >= start && *page_num <= end,
            None => true,
        };
        if include {
            if let Ok(page_text) = doc.extract_text(&[page_id.0]) {
                text.push_str(&page_text);
                text.push('\n');
            }
        }
    }

    Ok(text)
}
