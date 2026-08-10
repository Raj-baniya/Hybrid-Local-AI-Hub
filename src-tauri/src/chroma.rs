/// chroma.rs
/// ChromaDB REST client for Hybrid Local AI Hub.
/// All functions propagate real errors — no silent mock fallbacks.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const CHROMA_BASE: &str = "http://localhost:8000";

// ─────────────────────────────────────────────────────────────────────────────
// Collection management
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GetOrCreateRequest<'a> {
    name: &'a str,
    get_or_create: bool,
}

#[derive(Deserialize)]
struct CollectionResponse {
    id: String,
}

/// Gets or creates a ChromaDB collection. Returns its UUID.
/// Returns a real error if ChromaDB is unreachable or returns an unexpected response.
pub async fn get_or_create_collection(
    client: &reqwest::Client,
    collection_name: &str,
) -> Result<String, String> {
    let body = GetOrCreateRequest {
        name: collection_name,
        get_or_create: true,
    };

    let res = client
        .post(format!("{CHROMA_BASE}/api/v1/collections"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!(
            "ChromaDB unreachable at {CHROMA_BASE}. Start ChromaDB with `chroma run --path ./chroma_data`. Detail: {e}"
        ))?;

    let status = res.status();
    let body_text = res.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "ChromaDB returned HTTP {status} for collection '{collection_name}': {body_text}"
        ));
    }

    let parsed: CollectionResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("ChromaDB collection response parse error: {e} — body: {body_text}"))?;

    Ok(parsed.id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Document ingestion
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct AddRequest {
    ids: Vec<String>,
    embeddings: Vec<Vec<f32>>,
    documents: Vec<String>,
    metadatas: Vec<HashMap<String, String>>,
}

/// Adds a document + embedding to a ChromaDB collection.
/// Returns a real error on any failure so callers can surface it.
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
        ids: vec![doc_id.clone()],
        embeddings: vec![embedding],
        documents: vec![document],
        metadatas: vec![meta],
    };

    let res = client
        .post(format!("{CHROMA_BASE}/api/v1/collections/{collection_id}/add"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ChromaDB add_document failed for doc '{doc_id}': {e}"))?;

    let status = res.status();
    if !status.is_success() {
        let body_text = res.text().await.unwrap_or_default();
        return Err(format!(
            "ChromaDB add_document returned HTTP {status} for doc '{doc_id}': {body_text}"
        ));
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Similarity search
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct QueryRequest {
    query_embeddings: Vec<Vec<f32>>,
    n_results: u32,
}

#[derive(Deserialize)]
struct QueryResponse {
    #[serde(default)]
    documents: Vec<Vec<String>>,
}

/// Queries ChromaDB for the most similar documents to a query embedding.
/// Returns a real error if ChromaDB is unreachable or the query fails.
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

    let res = client
        .post(format!("{CHROMA_BASE}/api/v1/collections/{collection_id}/query"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ChromaDB query failed for collection '{collection_id}': {e}"))?;

    let status = res.status();
    let body_text = res.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "ChromaDB query returned HTTP {status} for collection '{collection_id}': {body_text}"
        ));
    }

    let parsed: QueryResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("ChromaDB query response parse error: {e}"))?;

    Ok(parsed.documents.into_iter().next().unwrap_or_default())
}
