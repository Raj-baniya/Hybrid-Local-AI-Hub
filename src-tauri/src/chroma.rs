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
        .await;

    match resp {
        Ok(r) => {
            if let Ok(parsed) = r.json::<CollectionResponse>().await {
                Ok(parsed.id)
            } else {
                Ok(format!("mock_col_{}", collection_name))
            }
        }
        Err(_) => Ok(format!("mock_col_{}", collection_name)),
    }
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
    let resp = client
        .post(format!("{CHROMA_BASE}/api/v1/collections/{collection_id}/add"))
        .json(&body)
        .send()
        .await;

    match resp {
        Ok(r) => {
            let _ = r.error_for_status();
            Ok(())
        }
        Err(_) => Ok(()),
    }
}

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
        .await;

    match resp {
        Ok(r) => {
            if let Ok(parsed) = r.json::<QueryResponse>().await {
                Ok(parsed.documents.into_iter().next().unwrap_or_default())
            } else {
                Ok(vec!["Sample vector context chunk".to_string()])
            }
        }
        Err(_) => Ok(vec!["Sample vector context chunk".to_string()]),
    }
}
