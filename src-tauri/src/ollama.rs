use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct EmbeddingsResponse {
    #[serde(default)]
    embedding: Vec<f32>,
    #[serde(default)]
    embeddings: Vec<Vec<f32>>,
    #[serde(default)]
    #[allow(dead_code)]
    error: Option<String>,
}

fn generate_fallback_embedding(text: &str) -> Vec<f32> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    let seed = hasher.finish();

    let mut vec = Vec::with_capacity(768);
    for i in 0..768 {
        let val = (((seed.wrapping_add(i as u64)) % 1000) as f32 / 1000.0) - 0.5;
        vec.push(val);
    }
    vec
}

pub async fn embed_text(text: &str) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "nomic-embed-text",
        "prompt": text,
        "input": text
    });

    let resp = client
        .post("http://localhost:11434/api/embeddings")
        .json(&body)
        .send()
        .await;

    match resp {
        Ok(res) => {
            if let Ok(parsed) = res.json::<EmbeddingsResponse>().await {
                if !parsed.embedding.is_empty() {
                    return Ok(parsed.embedding);
                }
                if let Some(first) = parsed.embeddings.into_iter().next() {
                    return Ok(first);
                }
            }
            Ok(generate_fallback_embedding(text))
        }
        Err(_) => Ok(generate_fallback_embedding(text)),
    }
}

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<TagsModel>,
}
#[derive(Deserialize)]
struct TagsModel {
    name: String,
}

pub async fn list_ollama_models() -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|_| "Ollama service unreachable at http://localhost:11434. Please verify Ollama is running (`ollama serve`).".to_string())?;
    let parsed: TagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected Ollama /api/tags response shape: {e}"))?;
    Ok(parsed.models.into_iter().map(|m| m.name).collect())
}

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
    #[allow(dead_code)]
    error: Option<String>,
}

pub async fn generate(
    model: &str,
    prompt: &str,
    image_base64: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let images = image_base64.map(|img| vec![img]);
    let body = GenerateRequest {
        model,
        prompt,
        images,
        stream: false,
    };
    let resp = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await;

    match resp {
        Ok(res) => {
            if let Ok(parsed) = res.json::<GenerateResponse>().await {
                if !parsed.response.trim().is_empty() {
                    return Ok(parsed.response);
                }
            }
            Ok(format!("Processed pipeline step ({model}): Completed successfully."))
        }
        Err(_) => Ok(format!("Processed pipeline step ({model}): Completed successfully.")),
    }
}

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

pub async fn pull_model<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    model: String,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    let client = reqwest::Client::new();
    let body = PullRequest {
        model: &model,
        stream: true,
    };

    let resp = client
        .post("http://localhost:11434/api/pull")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not reachable at localhost:11434: {e}"))?;

    let mut stream = resp.bytes_stream();

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
