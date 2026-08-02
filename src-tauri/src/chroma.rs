use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const CHROMA_BASE: &str = "http://localhost:8000";

#[derive(Serialize)]
struct GetOrCreateRequest<'a> {
    name: &'a str,
    get_or_create: bool,
}
#[derive(Deserialize)]
struct CollectionResponse {
    id: String,
}

pub async fn get_or_create_collection(
    client: &reqwest::Client,
    collection_name: &str,
) -> Result<String, String> {
    let body = GetOrCreateRequest {
        name: collection_name,
        get_or_create: true,
    };
    let resp = client
        .post(format!("{CHROMA_BASE}/api/v1/collections"))
        .json(&body)
        .send()
        .await
        .map_err(|_| "ChromaDB service unreachable at http://localhost:8000. Please verify ChromaDB is running (`chroma run --path ./chroma_data`).".to_string())?;
    let parsed: CollectionResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected ChromaDB /api/v1/collections response shape: {e}"))?;
    Ok(parsed.id)
}

#[derive(Serialize)]
struct AddRequest {
    ids: Vec<String>,
    embeddings: Vec<Vec<f32>>,
    documents: Vec<String>,
    metadatas: Vec<HashMap<String, String>>,
}

pub async fn add_document(
    client: &reqwest::Client,
    collection_id: &str,
    doc_id: String,
    embedding: Vec<f32>,
    document: String,
    source_node_id: &str,
) -> Result<(), String> {
    let mut meta = HashMap::new();
    meta.insert("source_node_id".to_string(), source_node_id.to_string());
    let body = AddRequest {
        ids: vec![doc_id],
        embeddings: vec![embedding],
        documents: vec![document],
        metadatas: vec![meta],
    };
    client
        .post(format!("{CHROMA_BASE}/api/v1/collections/{collection_id}/add"))
        .json(&body)
        .send()
        .await
        .map_err(|_| "ChromaDB service unreachable at http://localhost:8000. Please verify ChromaDB is running (`chroma run --path ./chroma_data`).".to_string())?
        .error_for_status()
        .map_err(|e| format!("ChromaDB rejected the add request: {e}"))?;
    Ok(())
}

#[derive(Serialize)]
struct QueryRequest {
    query_embeddings: Vec<Vec<f32>>,
    n_results: u32,
}
#[derive(Deserialize)]
struct QueryResponse {
    documents: Vec<Vec<String>>,
}

pub async fn query_similar(
    client: &reqwest::Client,
    collection_id: &str,
    query_embedding: Vec<f32>,
    n_results: u32,
) -> Result<Vec<String>, String> {
    let body = QueryRequest {
        query_embeddings: vec![query_embedding],
        n_results,
    };
    let resp = client
        .post(format!("{CHROMA_BASE}/api/v1/collections/{collection_id}/query"))
        .json(&body)
        .send()
        .await
        .map_err(|_| "ChromaDB service unreachable at http://localhost:8000. Please verify ChromaDB is running (`chroma run --path ./chroma_data`).".to_string())?;
    let parsed: QueryResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected ChromaDB query response shape: {e}"))?;
    Ok(parsed.documents.into_iter().next().unwrap_or_default())
}
