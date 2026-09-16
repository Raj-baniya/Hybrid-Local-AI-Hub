//! Execution engine: topological sort â†’ concurrent node execution via Kahn's algorithm.
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
use crate::ollama::OllamaClient;
use crate::schema::{Graph, NodeType};

// â”€â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
}

impl Default for ExecutorConfig {
    fn default() -> Self {
        Self {
            ollama_url: "http://127.0.0.1:11434".to_string(),
            chroma_url: "http://localhost:8000".to_string(),
            failure_policy: FailurePolicy::HaltOnFailure,
            default_timeout_secs: 10,
            llm_timeout_secs: 600,
        }
    }
}

/// Run a graph end-to-end.
///
/// Returns the `ExecutionRecord` describing what happened (saved to disk on completion).
pub async fn run_graph(
    graph: &Graph,
    config: ExecutorConfig,
    trigger_source: &str,
    event_sender: Option<tokio::sync::mpsc::UnboundedSender<crate::execution_record::NodeRecord>>,
) -> Result<ExecutionRecord> {
    // Pre-validate templates before any node runs.
    interpolation::validate_templates(graph)?;

    let ollama = OllamaClient::new(&config.ollama_url);
    let chroma = ChromaClient::new(&config.chroma_url);

    let mut record = ExecutionRecord::new(trigger_source, None);

    // Initialise per-node records.
    for node in &graph.nodes {
        let type_name = node_type_name(&node.data);
        record.nodes.push(NodeRecord::new(&node.id, type_name));
    }

    // Build adjacency and in-degree maps.
    let (adj, mut in_degree) = build_adj_and_indegree(graph);

    // Hoist failure policy before the loop so it's in scope everywhere.
    let failure_policy = config.failure_policy;

    // Shared state.
    let outputs: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
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
                    // Node missing from graph definition, skip gracefully
                    continue;
                }
            };

            let node_data = node.data.clone();
            let node_id = node_id.clone();
            let ollama = ollama.clone();
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
            
            // Mark the actual record as running
            let initial_record = {
                if let Some(nr) = record.nodes.iter_mut().find(|r| r.node_id == *node_id) {
                    nr.start();
                    Some(nr.clone())
                } else {
                    None
                }
            };

            if let (Some(ref s), Some(ir)) = (tx, initial_record) {
                let _ = s.send(ir);
            }

            let handle = tokio::spawn(async move {
                // If this node was skipped (because an upstream failed), skip it too.
                if skipped.lock().await.contains(&node_id) {
                    return (node_id.clone(), Err::<String, anyhow::Error>(anyhow!("SKIP")));
                }

                let fut = execute_node(node_id.clone(), node_data, outputs, chroma, ollama, predecessors, skipped.clone());
                let result = timeout(Duration::from_secs(timeout_secs), fut).await;

                match result {
                    Ok(inner) => (node_id, inner),
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
                    if nr.status == NodeStatus::Pending {
                        nr.start();
                    }
                    nr.succeed(&output);
                    outputs.lock().await.insert(node_id.clone(), output);
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

    record.finish();
    record.save().await?;
    Ok(record)
}

// â”€â”€â”€ Internals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        _ => config.default_timeout_secs,
    }
}

fn node_type_name(data: &NodeType) -> &'static str {
    match data {
        NodeType::FileWatcherNode(_) => "FileWatcherNode",
        NodeType::TextInputNode(_) => "TextInputNode",
        NodeType::ImageInputNode(_) => "ImageInputNode",
        NodeType::OllamaSelectorNode(_) => "OllamaSelectorNode",
        NodeType::LocalEmbedderNode(_) => "LocalEmbedderNode",
        NodeType::PDFExtractorNode(_) => "PDFExtractorNode",
        NodeType::ChromaDbStoreNode(_) => "ChromaDbStoreNode",
        NodeType::ConditionalRouterNode(_) => "ConditionalRouterNode",
        NodeType::LocalFileWriterNode(_) => "LocalFileWriterNode",
    }
}

/// Execute a single node. Returns its string output.
async fn execute_node(
    node_id: String,
    node_data: NodeType,
    outputs: Arc<Mutex<HashMap<String, String>>>,
    chroma: ChromaClient,
    ollama: OllamaClient,
    predecessors: Vec<String>,
    skipped: Arc<Mutex<HashSet<String>>>,
) -> Result<String> {
    match node_data {
        // â”€â”€ TextInputNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::TextInputNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            
            let mut text_val = cfg.text.clone();
            if text_val.trim().is_empty() && predecessors.is_empty() {
                // Interactive prompt for standalone empty text nodes
                use std::io::Write;
                println!();
                print!("> Agent input required for '{}': ", node_id);
                let _ = std::io::stdout().flush();
                let mut input = String::new();
                if std::io::stdin().read_line(&mut input).is_ok() {
                    text_val = input.trim().to_string();
                }
            }
            
            let resolved = interpolation::resolve(&text_val, &locked, single.as_deref())?;
            Ok(resolved)
        }

        // â”€â”€ FileWatcherNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::FileWatcherNode(_cfg) => {
            // In `run` (one-shot) mode, a FileWatcherNode yields a static placeholder;
            // in `--watch` mode, the watcher module feeds events from outside.
            Ok("[FileWatcherNode: event-driven â€” use --watch mode]".to_string())
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

            let pdf_path = single
                .ok_or_else(|| anyhow!("PDFExtractorNode '{}' has no incoming input", node_id))?;
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
                .generate(&cfg.model, &prompt, images, cfg.temperature, cfg.json_mode)
                .await
                .map_err(|e| anyhow!("OllamaSelectorNode '{}': {e}", node_id))
        }

        // â”€â”€ LocalEmbedderNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::LocalEmbedderNode(cfg) => {
            let locked = outputs.lock().await;
            let text = single_input_value(&predecessors, &locked)
                .ok_or_else(|| anyhow!("LocalEmbedderNode '{}' has no incoming input", node_id))?;
            drop(locked);

            let embedding = ollama.embeddings(&cfg.model, &text).await?;
            // Serialize embedding as JSON array string for downstream use.
            Ok(serde_json::to_string(&embedding)?)
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

        // â”€â”€ ConditionalRouterNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::ConditionalRouterNode(cfg) => {
            let locked = outputs.lock().await;
            let input = single_input_value(&predecessors, &locked)
                .ok_or_else(|| {
                    anyhow!("ConditionalRouterNode '{}' has no incoming input", node_id)
                })?;
            drop(locked);

            // Simple substring condition: if the condition string appears in the input.
            let matched = input.to_lowercase().contains(&cfg.condition.to_lowercase());
            let (routed_to, skipped_target) = if matched { 
                (&cfg.true_target, &cfg.false_target) 
            } else { 
                (&cfg.false_target, &cfg.true_target) 
            };
            
            // Mark the un-routed target as skipped so it and its children don't run
            skipped.lock().await.insert(skipped_target.clone());

            Ok(format!("routed:{}", routed_to))
        }

        // â”€â”€ LocalFileWriterNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        NodeType::LocalFileWriterNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let content = single
                .ok_or_else(|| anyhow!("LocalFileWriterNode '{}' has no incoming input", node_id))?;
            let path = interpolation::resolve(&cfg.output_path, &locked, None)?;
            drop(locked);

            // Ensure parent directory exists.
            if let Some(parent) = std::path::Path::new(&path).parent() {
                tokio::fs::create_dir_all(parent).await?;
            }

            if cfg.append {
                use tokio::io::AsyncWriteExt;
                let mut file = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .await
                    .map_err(|e| anyhow!("LocalFileWriterNode '{}': cannot open '{}': {e}", node_id, path))?;
                file.write_all(content.as_bytes()).await?;
            } else {
                tokio::fs::write(&path, &content).await.map_err(|e| {
                    anyhow!("LocalFileWriterNode '{}': cannot write '{}': {e}", node_id, path)
                })?;
            }

            Ok(format!("Written {} bytes to '{}'", content.len(), path))
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
