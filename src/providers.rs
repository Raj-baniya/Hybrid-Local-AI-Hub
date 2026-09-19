use anyhow::Result;
use crate::ollama::OllamaClient;

#[derive(Debug, Clone)]
pub struct ApiKeyConfig {
    pub key: String,
    pub name: String,
    pub model: String,
}

#[derive(Clone)]
pub struct ProviderManager {
    ollama: OllamaClient,
    online_keys: Vec<ApiKeyConfig>,
    is_offline: bool,
    client: reqwest::Client,
}

impl ProviderManager {
    pub fn new(ollama_url: &str, is_offline: bool, online_keys: Vec<ApiKeyConfig>) -> Self {
        let ollama = OllamaClient::new(ollama_url);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
            
        Self { ollama, online_keys, is_offline, client }
    }

    pub fn is_offline(&self) -> bool {
        self.is_offline
    }

    pub async fn generate(
        &self,
        model_selection: &str,
        prompt: &str,
        images: Vec<String>,
        json_mode: bool,
    ) -> Result<String> {
        if self.is_offline {
            // Strict offline mode, fallback directly to local Ollama
            return self.ollama.generate(model_selection, prompt, images, json_mode).await;
        }

        if model_selection.starts_with("API|") {
            let parts: Vec<&str> = model_selection.split('|').collect();
            if parts.len() >= 3 {
                let provider_name = parts[1];
                let api_model = parts[2];
                
                if let Some(config) = self.online_keys.iter().find(|k| k.name == provider_name) {
                    if !images.is_empty() {
                        return Err(anyhow::anyhow!("Online provider {} does not currently support image inputs in ProviderManager.", config.name));
                    }

                    let url = match provider_name.to_lowercase().as_str() {
                        "groq" => "https://api.groq.com/openai/v1/chat/completions",
                        "nvidia" => "https://integrate.api.nvidia.com/v1/chat/completions",
                        _ => "https://api.openai.com/v1/chat/completions" // Default to OpenAI
                    };

                    let mut request_body = serde_json::json!({
                        "model": api_model,
                        "messages": [{ "role": "user", "content": prompt }],
                        "max_tokens": 1024,
                        "temperature": 0.2
                    });

                    if json_mode {
                        request_body["response_format"] = serde_json::json!({ "type": "json_object" });
                    }

                    let res = self.client.post(url)
                        .header("Authorization", format!("Bearer {}", config.key))
                        .header("Content-Type", "application/json")
                        .json(&request_body)
                        .send()
                        .await;

                    match res {
                        Ok(response) if response.status().is_success() => {
                            if let Ok(json) = response.json::<serde_json::Value>().await {
                                if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
                                    return Ok(content.to_string());
                                }
                            }
                            return Err(anyhow::anyhow!("Invalid JSON response from provider"));
                        }
                        Ok(response) => {
                            let status = response.status();
                            let text = response.text().await.unwrap_or_default();
                            return Err(anyhow::anyhow!("API Error {}: {}", status, text));
                        }
                        Err(e) => {
                            return Err(anyhow::anyhow!("Request failed: {}", e));
                        }
                    }
                }
            }
            return Err(anyhow::anyhow!("Selected API provider not found or invalid format"));
        }

        // If not API|, it's a local model
        self.ollama.generate(model_selection, prompt, images, json_mode).await
    }

    pub async fn embed(&self, local_model: &str, prompt: &str) -> Result<Vec<f32>> {
        if self.is_offline || self.online_keys.is_empty() {
            return self.ollama.embeddings(local_model, prompt).await;
        }
        // Online embedding not yet implemented in ProviderManager, so fallback to local if online but not available
        self.ollama.embeddings(local_model, prompt).await
            .map_err(|e| anyhow::anyhow!("Provider fallback for embeddings not yet implemented. Local fallback failed: {}", e))
    }
}
