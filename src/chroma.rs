use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

// ─── Request / Response types ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct UpsertRequest {
    ids: Vec<String>,
    embeddings: Vec<Vec<f32>>,
    documents: Vec<String>,
    metadatas: Vec<HashMap<String, Value>>,
}

#[derive(Debug, Serialize)]
struct QueryRequest {
    query_embeddings: Vec<Vec<f32>>,
    n_results: usize,
}

#[derive(Debug, Deserialize)]
pub struct QueryResult {
    pub ids: Vec<Vec<String>>,
    pub documents: Vec<Vec<String>>,
    pub distances: Vec<Vec<f32>>,
}

// ─── Public client ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ChromaClient {
    base_url: String,
    http: Client,
}

impl ChromaClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("Failed to build HTTP client"),
        }
    }

    /// Create a collection, ignoring 409 Conflict (already exists).
    pub async fn create_collection(&self, name: &str) -> Result<()> {
        let body = json!({ "name": name });
        let resp = self
            .http
            .post(format!("{}/api/v1/collections", self.base_url))
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow!("ChromaDB create_collection failed: {e}"))?;

        match resp.status().as_u16() {
            200 | 201 | 409 => Ok(()), // 409 = already exists, that's fine
            s => {
                let body = resp.text().await.unwrap_or_default();
                Err(anyhow!("ChromaDB create_collection returned HTTP {s}: {body}"))
            }
        }
    }

    /// Get the internal collection id by name.
    async fn collection_id(&self, name: &str) -> Result<String> {
        let resp = self
            .http
            .get(format!("{}/api/v1/collections/{}", self.base_url, name))
            .send()
            .await
            .map_err(|e| anyhow!("ChromaDB get_collection failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("ChromaDB get_collection HTTP {status}: {body}"));
        }

        let val: Value = resp.json().await.map_err(|e| anyhow!("{e}"))?;
        val.get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("ChromaDB collection response missing 'id' field"))
    }

    /// Upsert a single document with its embedding into the named collection.
    pub async fn upsert(
        &self,
        collection_name: &str,
        id: &str,
        embedding: Vec<f32>,
        document: &str,
        metadata: HashMap<String, Value>,
    ) -> Result<()> {
        let coll_id = self.collection_id(collection_name).await?;
        let req = UpsertRequest {
            ids: vec![id.to_string()],
            embeddings: vec![embedding],
            documents: vec![document.to_string()],
            metadatas: vec![metadata],
        };
        let resp = self
            .http
            .post(format!(
                "{}/api/v1/collections/{}/upsert",
                self.base_url, coll_id
            ))
            .json(&req)
            .send()
            .await
            .map_err(|e| anyhow!("ChromaDB upsert failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("ChromaDB upsert HTTP {status}: {body}"));
        }
        Ok(())
    }

    /// Query a collection for the `n` nearest neighbors of a given embedding.
    pub async fn query(
        &self,
        collection_name: &str,
        query_embedding: Vec<f32>,
        n_results: usize,
    ) -> Result<QueryResult> {
        let coll_id = self.collection_id(collection_name).await?;
        let req = QueryRequest {
            query_embeddings: vec![query_embedding],
            n_results,
        };
        let resp = self
            .http
            .post(format!(
                "{}/api/v1/collections/{}/query",
                self.base_url, coll_id
            ))
            .json(&req)
            .send()
            .await
            .map_err(|e| anyhow!("ChromaDB query failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("ChromaDB query HTTP {status}: {body}"));
        }

        let result: QueryResult = resp
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse ChromaDB query result: {e}"))?;
        Ok(result)
    }

    /// Check whether ChromaDB is reachable at the configured URL.
    pub async fn is_reachable(&self) -> bool {
        self.http
            .get(format!("{}/api/v1/heartbeat", self.base_url))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}
