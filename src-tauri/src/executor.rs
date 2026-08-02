use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use tauri::{AppHandle, Emitter};

use crate::chroma;
use crate::ollama;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodePayload {
    pub source_node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_chunks: Option<Vec<String>>,
    pub has_image: bool,
    pub has_text: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub r#type: String,
    pub label: String,
    pub position: Position,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(rename = "sourceHandle")]
    pub source_handle: Option<String>,
    #[serde(rename = "targetHandle")]
    pub target_handle: Option<String>,
    pub condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphState {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Serialize, Clone)]
pub struct NodeStatusEvent {
    pub node_id: String,
    pub status: String,
    pub message: Option<String>,
}

pub fn topological_sort(graph: &GraphState) -> Result<Vec<GraphNode>, String> {
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut adj_list: HashMap<String, Vec<String>> = HashMap::new();
    let node_map: HashMap<String, GraphNode> = graph
        .nodes
        .iter()
        .map(|n| (n.id.clone(), n.clone()))
        .collect();

    for node in &graph.nodes {
        in_degree.insert(node.id.clone(), 0);
        adj_list.insert(node.id.clone(), Vec::new());
    }

    for edge in &graph.edges {
        if let Some(degree) = in_degree.get_mut(&edge.target) {
            *degree += 1;
        }
        if let Some(neighbors) = adj_list.get_mut(&edge.source) {
            neighbors.push(edge.target.clone());
        }
    }

    let mut queue: VecDeque<String> = VecDeque::new();
    for (node_id, &degree) in &in_degree {
        if degree == 0 {
            queue.push_back(node_id.clone());
        }
    }

    let mut sorted: Vec<GraphNode> = Vec::new();

    while let Some(current_id) = queue.pop_front() {
        if let Some(node) = node_map.get(&current_id) {
            sorted.push(node.clone());
        }

        if let Some(neighbors) = adj_list.get(&current_id) {
            for neighbor in neighbors {
                if let Some(degree) = in_degree.get_mut(neighbor) {
                    *degree -= 1;
                    if *degree == 0 {
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }
    }

    if sorted.len() != graph.nodes.len() {
        return Err("Cycle detected in pipeline graph! Execution halted.".to_string());
    }

    Ok(sorted)
}

fn merge_upstream_payloads(
    current_node_id: &str,
    incoming_edges: &[&GraphEdge],
    payload_map: &HashMap<String, NodePayload>,
) -> NodePayload {
    let mut merged_texts: Vec<String> = Vec::new();
    let mut merged_chunks: Vec<String> = Vec::new();
    let mut first_image: Option<String> = None;
    let mut first_embedding: Option<Vec<f32>> = None;
    let mut has_image = false;
    let mut has_text = false;

    for edge in incoming_edges {
        if let Some(payload) = payload_map.get(&edge.source) {
            if let Some(ref t) = payload.text {
                if !t.trim().is_empty() {
                    merged_texts.push(t.clone());
                }
            }
            if let Some(ref chunks) = payload.context_chunks {
                merged_chunks.extend(chunks.clone());
            }
            if first_image.is_none() && payload.image_path.is_some() {
                first_image = payload.image_path.clone();
            }
            if first_embedding.is_none() && payload.embedding.is_some() {
                first_embedding = payload.embedding.clone();
            }
            if payload.has_image {
                has_image = true;
            }
            if payload.has_text {
                has_text = true;
            }
        }
    }

    let joined_text = if merged_texts.is_empty() {
        None
    } else {
        Some(merged_texts.join("\n\n"))
    };

    let chunks_opt = if merged_chunks.is_empty() {
        None
    } else {
        Some(merged_chunks)
    };

    NodePayload {
        source_node_id: current_node_id.to_string(),
        text: joined_text.clone(),
        image_path: first_image,
        embedding: first_embedding,
        context_chunks: chunks_opt,
        has_image,
        has_text: has_text || joined_text.is_some(),
    }
}

pub async fn execute_graph_pipeline<R: tauri::Runtime>(
    app: AppHandle<R>,
    graph: GraphState,
) -> Result<(), String> {
    let sorted_nodes = topological_sort(&graph)?;
    let mut payload_map: HashMap<String, NodePayload> = HashMap::new();
    let chroma_client = reqwest::Client::new();
    let mut collection_id_cache: HashMap<String, String> = HashMap::new();

    for node in sorted_nodes {
        let _ = app.emit(
            "node-status",
            NodeStatusEvent {
                node_id: node.id.clone(),
                status: "running".to_string(),
                message: Some(format!("Executing {}", node.label)),
            },
        );

        let incoming_edges: Vec<&GraphEdge> = graph
            .edges
            .iter()
            .filter(|e| e.target == node.id)
            .collect();

        let merged_input = merge_upstream_payloads(&node.id, &incoming_edges, &payload_map);
        let node_data = node.data.clone().unwrap_or(serde_json::json!({}));

        let result: Result<NodePayload, String> = match node.r#type.as_str() {
            "text_input" => {
                let text_val = node_data
                    .get("default_text")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let has_t = text_val.is_some();
                Ok(NodePayload {
                    source_node_id: node.id.clone(),
                    text: text_val,
                    image_path: None,
                    embedding: None,
                    context_chunks: None,
                    has_image: false,
                    has_text: has_t,
                })
            }
            "image_input" => {
                let img_path = node_data
                    .get("image_path")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let has_img = img_path.is_some();
                Ok(NodePayload {
                    source_node_id: node.id.clone(),
                    text: None,
                    image_path: img_path,
                    embedding: None,
                    context_chunks: None,
                    has_image: has_img,
                    has_text: false,
                })
            }
            "file_watcher" => {
                let watch_path = node_data
                    .get("watch_path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                let text_content = if !watch_path.is_empty() && std::path::Path::new(watch_path).is_file() {
                    std::fs::read_to_string(watch_path).ok()
                } else {
                    None
                };

                let has_t = text_content.is_some();
                Ok(NodePayload {
                    source_node_id: node.id.clone(),
                    text: text_content,
                    image_path: None,
                    embedding: None,
                    context_chunks: None,
                    has_image: false,
                    has_text: has_t,
                })
            }
            "local_embedder" => {
                let text_to_embed = merged_input
                    .text
                    .clone()
                    .unwrap_or_else(|| "default content".to_string());

                let vec = ollama::embed_text(&text_to_embed).await?;
                Ok(NodePayload {
                    source_node_id: node.id.clone(),
                    text: merged_input.text,
                    image_path: merged_input.image_path,
                    embedding: Some(vec),
                    context_chunks: merged_input.context_chunks,
                    has_image: merged_input.has_image,
                    has_text: merged_input.has_text,
                })
            }
            "chromadb_store" => {
                let collection_name = node_data
                    .get("collection_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("default_collection");
                let mode = node_data
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("write");

                let col_id = match collection_id_cache.get(collection_name) {
                    Some(id) => id.clone(),
                    None => {
                        let id = chroma::get_or_create_collection(&chroma_client, collection_name).await?;
                        collection_id_cache.insert(collection_name.to_string(), id.clone());
                        id
                    }
                };

                if mode == "write" {
                    let doc_text = merged_input
                        .text
                        .clone()
                        .unwrap_or_else(|| "sample text".to_string());
                    let emb = match merged_input.embedding {
                        Some(ref e) => e.clone(),
                        None => ollama::embed_text(&doc_text).await?,
                    };
                    let doc_id = format!("doc_{}", uuid::Uuid::new_v4());
                    chroma::add_document(
                        &chroma_client,
                        &col_id,
                        doc_id,
                        emb,
                        doc_text,
                        &node.id,
                    )
                    .await?;

                    Ok(merged_input)
                } else {
                    let query_emb = match merged_input.embedding {
                        Some(ref e) => e.clone(),
                        None => {
                            let q_text = merged_input
                                .text
                                .clone()
                                .unwrap_or_else(|| "query".to_string());
                            ollama::embed_text(&q_text).await?
                        }
                    };

                    let retrieved = chroma::query_similar(&chroma_client, &col_id, query_emb, 4).await?;
                    let mut out = merged_input;
                    out.context_chunks = Some(retrieved);
                    Ok(out)
                }
            }
            "ollama_selector" => {
                let model = node_data
                    .get("model")
                    .and_then(|v| v.as_str())
                    .unwrap_or("llama3.2");

                let mut prompt_parts: Vec<String> = Vec::new();

                if let Some(ref chunks) = merged_input.context_chunks {
                    prompt_parts.push(format!("Retrieved Context:\n{}", chunks.join("\n---\n")));
                }
                if let Some(ref t) = merged_input.text {
                    prompt_parts.push(format!("Input:\n{}", t));
                }

                let final_prompt = if prompt_parts.is_empty() {
                    "Generate response".to_string()
                } else {
                    prompt_parts.join("\n\n")
                };

                let response_text = ollama::generate(model, &final_prompt, None).await?;
                Ok(NodePayload {
                    source_node_id: node.id.clone(),
                    text: Some(response_text),
                    image_path: merged_input.image_path,
                    embedding: None,
                    context_chunks: merged_input.context_chunks,
                    has_image: merged_input.has_image,
                    has_text: true,
                })
            }
            "conditional_router" => {
                let condition_type = node_data
                    .get("condition_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("has_image");

                let passed = match condition_type {
                    "has_image" => merged_input.has_image,
                    "has_text" => merged_input.has_text,
                    "custom" => {
                        let expr = node_data
                            .get("expression")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if let Some(ref t) = merged_input.text {
                            t.contains(expr)
                        } else {
                            false
                        }
                    }
                    _ => false,
                };

                let mut out = merged_input;
                out.text = Some(format!("branch:{}", if passed { "true" } else { "false" }));
                Ok(out)
            }
            "local_file_writer" => {
                let out_dir = node_data
                    .get("output_path")
                    .and_then(|v| v.as_str())
                    .unwrap_or(".");
                let format = node_data
                    .get("format")
                    .and_then(|v| v.as_str())
                    .unwrap_or("md");

                let content = merged_input
                    .text
                    .clone()
                    .unwrap_or_else(|| "Pipeline Output Result".to_string());

                let file_name = format!("output_{}.{}", uuid::Uuid::new_v4(), format);
                let target_path = std::path::Path::new(out_dir).join(file_name);

                if let Some(parent) = target_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }

                std::fs::write(&target_path, content)
                    .map_err(|e| format!("Failed to write output file at {}: {e}", target_path.display()))?;

                Ok(NodePayload {
                    source_node_id: node.id.clone(),
                    text: Some(format!("Saved to {}", target_path.display())),
                    image_path: None,
                    embedding: None,
                    context_chunks: None,
                    has_image: false,
                    has_text: true,
                })
            }
            "log_terminal" => Ok(merged_input),
            _ => Err(format!("Unknown node type: {}", node.r#type)),
        };

        match result {
            Ok(payload) => {
                payload_map.insert(node.id.clone(), payload);
                let _ = app.emit(
                    "node-status",
                    NodeStatusEvent {
                        node_id: node.id.clone(),
                        status: "success".to_string(),
                        message: Some(format!("Completed {}", node.label)),
                    },
                );
            }
            Err(err) => {
                let _ = app.emit(
                    "node-status",
                    NodeStatusEvent {
                        node_id: node.id.clone(),
                        status: "error".to_string(),
                        message: Some(err.clone()),
                    },
                );
                return Err(err);
            }
        }
    }

    Ok(())
}
