/// ollama.rs
/// Ollama REST client for Hybrid Local AI Hub.
/// Uses a shared, connection-pooling reqwest::Client with 120s timeout.
/// All functions return real errors — callers decide how to handle failures.
use serde::{Deserialize, Serialize};
use std::time::Duration;

// ─────────────────────────────────────────────────────────────────────────────
// Shared HTTP Client (lazy, connection-pooled, 120s timeout)
// ─────────────────────────────────────────────────────────────────────────────

fn ollama_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(4)
        .build()
        .expect("Failed to build reqwest client")
}

const OLLAMA_BASE: &str = "http://localhost:11434";

// ─────────────────────────────────────────────────────────────────────────────
// Embeddings
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct EmbeddingsResponse {
    #[serde(default)]
    embedding: Vec<f32>,
    #[serde(default)]
    embeddings: Vec<Vec<f32>>,
}

/// Embeds text using the local nomic-embed-text model.
/// Returns a real error if Ollama is unreachable or returns an empty embedding.
pub async fn embed_text(text: &str) -> Result<Vec<f32>, String> {
    let client = ollama_client();
    let body = serde_json::json!({
        "model": "nomic-embed-text",
        "prompt": text,
        "input": text
    });

    let res = client
        .post(format!("{OLLAMA_BASE}/api/embeddings"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama embeddings unreachable: {e}"))?;

    let parsed: EmbeddingsResponse = res
        .json()
        .await
        .map_err(|e| format!("Ollama embeddings response parse error: {e}"))?;

    if !parsed.embedding.is_empty() {
        return Ok(parsed.embedding);
    }
    if let Some(first) = parsed.embeddings.into_iter().next() {
        if !first.is_empty() {
            return Ok(first);
        }
    }

    Err(format!(
        "Ollama returned empty embedding for model nomic-embed-text. \
         Run `ollama pull nomic-embed-text` to install the model."
    ))
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Listing
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<TagsModel>,
}

#[derive(Deserialize)]
struct TagsModel {
    name: String,
}

/// Lists locally available Ollama models.
/// Returns a real error if Ollama is not running.
pub async fn list_ollama_models() -> Result<Vec<String>, String> {
    let client = ollama_client();
    let res = client
        .get(format!("{OLLAMA_BASE}/api/tags"))
        .send()
        .await
        .map_err(|e| format!("Ollama service unreachable at {OLLAMA_BASE}. Start Ollama with `ollama serve`. Detail: {e}"))?;

    let parsed: TagsResponse = res
        .json()
        .await
        .map_err(|e| format!("Unexpected Ollama /api/tags response: {e}"))?;

    Ok(parsed.models.into_iter().map(|m| m.name).collect())
}

// ─────────────────────────────────────────────────────────────────────────────
// Text / Vision Generation
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
    stream: bool,
}

#[derive(Deserialize)]
struct GenerateResponse {
    #[serde(default)]
    response: String,
    #[serde(default)]
    error: Option<String>,
}

/// Calls the Ollama /api/generate endpoint with a 120s timeout.
/// Returns the model's response text, or a real descriptive error.
pub async fn generate(
    model: &str,
    prompt: &str,
    image_base64: Option<String>,
) -> Result<String, String> {
    let client = ollama_client();
    let images = image_base64.map(|img| vec![img]);
    let body = GenerateRequest {
        model,
        prompt,
        images,
        stream: false,
    };

    let res = client
        .post(format!("{OLLAMA_BASE}/api/generate"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama generate unreachable for model '{model}': {e}"))?;

    let parsed: GenerateResponse = res
        .json()
        .await
        .map_err(|e| format!("Ollama generate response parse error for model '{model}': {e}"))?;

    // Surface Ollama-reported errors (e.g. model not found)
    if let Some(ref err_msg) = parsed.error {
        if !err_msg.trim().is_empty() {
            return Err(format!("Ollama model '{model}' error: {err_msg}"));
        }
    }

    if parsed.response.trim().is_empty() {
        return Err(format!(
            "Ollama returned empty response for model '{model}'. \
             The model may be loading — please wait and retry."
        ));
    }

    Ok(parsed.response)
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat-style generation (system + prompt)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GenerateWithSystemRequest<'a> {
    model: &'a str,
    system: &'a str,
    prompt: &'a str,
    stream: bool,
    format: &'a str,
}

/// Like `generate` but also accepts a system prompt and forces JSON output format.
pub async fn generate_with_system(
    model: &str,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    let client = ollama_client();
    let body = GenerateWithSystemRequest {
        model,
        system,
        prompt,
        stream: false,
        format: "json",
    };

    let res = client
        .post(format!("{OLLAMA_BASE}/api/generate"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama generate_with_system unreachable for model '{model}': {e}"))?;

    let parsed: GenerateResponse = res
        .json()
        .await
        .map_err(|e| format!("Ollama generate_with_system response parse error: {e}"))?;

    if let Some(ref err_msg) = parsed.error {
        if !err_msg.trim().is_empty() {
            return Err(format!("Ollama model '{model}' error: {err_msg}"));
        }
    }

    if parsed.response.trim().is_empty() {
        return Err(format!("Ollama returned empty response for model '{model}'"));
    }

    Ok(parsed.response)
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Pulling (streaming progress)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct PullRequest<'a> {
    model: &'a str,
    stream: bool,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct PullProgress {
    pub status: String,
    #[serde(default)]
    pub completed: Option<u64>,
    #[serde(default)]
    pub total: Option<u64>,
}

/// Pulls a model from Ollama registry, streaming download progress events.
pub async fn pull_model<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    model: String,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    // Use longer timeout for pulls (large models can take a while to start)
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3600))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build pull client: {e}"))?;

    let body = PullRequest {
        model: &model,
        stream: true,
    };

    let res = client
        .post(format!("{OLLAMA_BASE}/api/pull"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not reachable for pull: {e}"))?;

    let mut stream = res.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        if let Ok(chunk) = chunk_result {
            for line in chunk.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
                if let Ok(progress) = serde_json::from_slice::<PullProgress>(line) {
                    let _ = app.emit("model-pull-progress", (model.clone(), progress));
                }
            }
        }
    }
    Ok(())
}
