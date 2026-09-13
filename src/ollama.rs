use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ─── Request / Response types ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<&'static str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    images: Vec<&'a str>,
    options: GenerateOptions,
}

#[derive(Debug, Serialize)]
struct GenerateOptions {
    temperature: f32,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
    #[allow(dead_code)]
    done: bool,
}

#[derive(Debug, Serialize)]
struct EmbedRequest<'a> {
    model: &'a str,
    prompt: &'a str,
}

#[derive(Debug, Deserialize)]
struct EmbedResponse {
    embedding: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ListModelsResponse {
    models: Vec<ModelInfo>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct PullProgress {
    pub status: String,
    pub completed: Option<u64>,
    pub total: Option<u64>,
}

// ─── Public client ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct OllamaClient {
    base_url: String,
    http: Client,
}

impl OllamaClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(300))
                .build()
                .expect("Failed to build HTTP client"),
        }
    }

    /// Generate text from a prompt. Streams internally but returns the full
    /// concatenated response. Use `generate_streaming` if you need to surface
    /// partial tokens to a UI.
    pub async fn generate(
        &self,
        model: &str,
        prompt: &str,
        images: Vec<String>,
        temperature: f32,
        json_mode: bool,
    ) -> Result<String> {
        let req = GenerateRequest {
            model,
            prompt,
            stream: false,
            format: if json_mode { Some("json") } else { None },
            images: images.iter().map(|s| s.as_str()).collect(),
            options: GenerateOptions { temperature },
        };
        let resp = self
            .http
            .post(format!("{}/api/generate", self.base_url))
            .json(&req)
            .send()
            .await
            .map_err(|e| anyhow!("Ollama request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Ollama returned HTTP {status}: {body}"));
        }

        let gen: GenerateResponse = resp
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse Ollama response: {e}"))?;

        Ok(gen.response)
    }

    /// Compute embeddings for a single string.
    pub async fn embeddings(&self, model: &str, text: &str) -> Result<Vec<f32>> {
        let req = EmbedRequest { model, prompt: text };
        let resp = self
            .http
            .post(format!("{}/api/embeddings", self.base_url))
            .json(&req)
            .send()
            .await
            .map_err(|e| anyhow!("Ollama embeddings request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Ollama embeddings returned HTTP {status}: {body}"));
        }

        let embed: EmbedResponse = resp
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse embedding response: {e}"))?;
        Ok(embed.embedding)
    }

    /// List models currently available on the local Ollama instance.
    pub async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        let resp = self
            .http
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .map_err(|e| anyhow!("Ollama list_models failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(anyhow!("Ollama /api/tags returned HTTP {status}"));
        }

        let list: ListModelsResponse = resp
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse model list: {e}"))?;
        Ok(list.models)
    }

    /// Pull a model by name, streaming progress to the caller via a callback.
    /// The callback receives structured progress events.
    pub async fn pull_model<F>(
        &self,
        model_name: &str,
        cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
        on_progress: F,
    ) -> Result<()>
    where
        F: Fn(PullProgress),
    {
        use futures::stream::StreamExt;

        let body = json!({ "name": model_name, "stream": true });
        let resp = self
            .http
            .post(format!("{}/api/pull", self.base_url))
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow!("Ollama pull request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Ollama pull returned HTTP {status}: {text}"));
        }

        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if let Some(ref flag) = cancel_flag {
                if flag.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err(anyhow!("Model pull cancelled by user"));
                }
            }

            let chunk = chunk.map_err(|e| anyhow!("Stream error during pull: {e}"))?;
            // Each line from Ollama is a JSON object; parse what we can.
            if let Ok(text) = std::str::from_utf8(&chunk) {
                for line in text.lines() {
                    if line.is_empty() {
                        continue;
                    }
                    if let Ok(val) = serde_json::from_str::<Value>(line) {
                        let status = val
                            .get("status")
                            .and_then(|s| s.as_str())
                            .unwrap_or(line)
                            .to_string();
                        let completed = val.get("completed").and_then(|v| v.as_u64());
                        let total = val.get("total").and_then(|v| v.as_u64());
                        
                        on_progress(PullProgress {
                            status,
                            completed,
                            total,
                        });
                    }
                }
            }
        }
        Ok(())
    }

    /// Check whether the Ollama service is reachable at the configured URL.
    pub async fn is_reachable(&self) -> bool {
        self.http
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}
