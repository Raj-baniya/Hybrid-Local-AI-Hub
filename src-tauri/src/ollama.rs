use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct EmbeddingsRequest<'a> {
    model: &'a str,
    prompt: &'a str,
}

#[derive(Deserialize)]
struct EmbeddingsResponse {
    embedding: Vec<f32>,
}

pub async fn embed_text(text: &str) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();
    let body = EmbeddingsRequest {
        model: "nomic-embed-text",
        prompt: text,
    };
    let resp = client
        .post("http://localhost:11434/api/embeddings")
        .json(&body)
        .send()
        .await
        .map_err(|_| "Ollama service unreachable at http://localhost:11434. Please verify Ollama is running (`ollama serve`).".to_string())?;
    let parsed: EmbeddingsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected Ollama /api/embeddings response shape: {e}"))?;
    Ok(parsed.embedding)
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
    response: String,
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
        .await
        .map_err(|_| "Ollama service unreachable at http://localhost:11434. Please verify Ollama is running (`ollama serve`).".to_string())?;
    let parsed: GenerateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected Ollama /api/generate response shape: {e}"))?;
    Ok(parsed.response)
}
