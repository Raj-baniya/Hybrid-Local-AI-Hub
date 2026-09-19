//! Chat-to-graph compiler core: shared between CLI (`chat.rs`) and GUI IPC (`commands.rs`).
//!
//! Generates a valid `Graph` from plain-English instructions using a local LLM via Ollama.
//! Employs an iterative validation and targeted-repair loop (up to 3 rounds) before returning.

use crate::ollama::OllamaClient;
use crate::providers::ProviderManager;
use crate::schema::{Graph, ChatMessage};
use crate::translator_prompt::build_system_prompt;
use crate::validate::validate_graph;

pub const DEFAULT_MODEL: &str = "llama3.2";
pub const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";
pub const DEFAULT_TEMPERATURE: f32 = 0.2;
pub const MAX_REPAIR_ROUNDS: usize = 3;

/// Generate a new workflow graph from plain-English instructions.
pub async fn generate_workflow(
    messages: &[ChatMessage],
    model: &str,
    ollama_url: &str,
    is_offline: bool,
    online_keys: Vec<crate::providers::ApiKeyConfig>,
    progress_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
) -> Result<Graph, String> {
    let mut user_message = String::from("Generate a workflow graph for the following conversation:\n");
    for msg in messages {
        user_message.push_str(&format!("{}: {}\n", msg.role.to_uppercase(), msg.content));
    }
    run_compiler_loop(&user_message, model, ollama_url, is_offline, online_keys, progress_tx).await
}

/// Modify an existing workflow graph according to plain-English instructions.
pub async fn edit_workflow(
    messages: &[ChatMessage],
    existing: &Graph,
    model: &str,
    ollama_url: &str,
    is_offline: bool,
    online_keys: Vec<crate::providers::ApiKeyConfig>,
    progress_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
) -> Result<Graph, String> {
    let existing_json = serde_json::to_string_pretty(existing)
        .map_err(|e| format!("Failed to serialize existing graph: {e}"))?;
    
    let mut conversation = String::new();
    for msg in messages {
        conversation.push_str(&format!("{}: {}\n", msg.role.to_uppercase(), msg.content));
    }
    
    let user_message = format!(
        "Existing workflow JSON:\n{}\n\nModification request conversation:\n{}",
        existing_json, conversation
    );
    run_compiler_loop(&user_message, model, ollama_url, is_offline, online_keys, progress_tx).await
}

/// Core generation, validation, and multi-round repair loop.
async fn run_compiler_loop(
    user_message: &str,
    model: &str,
    ollama_url: &str,
    is_offline: bool,
    online_keys: Vec<crate::providers::ApiKeyConfig>,
    progress_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
) -> Result<Graph, String> {
    let client = ProviderManager::new(ollama_url, is_offline, online_keys);

    // Note: ProviderManager handles its own connection checking during generate

    let system_prompt = build_system_prompt(is_offline);
    let initial_prompt = format!("{}\n\nUser: {}", system_prompt, user_message);

    let mut last_json = String::new();
    let mut last_errors: Vec<String> = Vec::new();

    for round in 0..=MAX_REPAIR_ROUNDS {
        let prompt = if round == 0 {
            initial_prompt.clone()
        } else {
            format!(
                "{}\n\nUser: {}\n\nYour previous attempt:\n{}\n\nValidation errors to fix:\n{}\n\nRepair the JSON to fix all errors above. Output ONLY valid JSON matching the schema:",
                system_prompt,
                user_message,
                last_json,
                last_errors.join("\n")
            )
        };

        if let Some(tx) = &progress_tx {
            let msg = if round == 0 { "Analyzing prompt..." } else { "Refining graph..." };
            let _ = tx.send(msg.to_string());
        }

        let raw_output = client
            .generate(model, &prompt, vec![], false)
            .await
            .map_err(|e| format!("LLM generation request failed: {e}"))?;

        let json_str = extract_json(&raw_output);
        last_json = json_str.to_string();

        let parsed: Graph = match serde_json::from_str(json_str) {
            Ok(g) => g,
            Err(e) => {
                last_errors = vec![format!("JSON syntax parse error: {e}")];
                if let Some(tx) = &progress_tx {
                    let _ = tx.send("Syntax error detected. Retrying...".to_string());
                }
                if round == MAX_REPAIR_ROUNDS {
                    break;
                }
                continue;
            }
        };

        if let Some(tx) = &progress_tx {
            let _ = tx.send("Validating graph...".to_string());
        }

        match validate_graph(&parsed) {
            Ok(()) => return Ok(parsed),
            Err(errors) => {
                last_errors = errors;
                if let Some(tx) = &progress_tx {
                    let _ = tx.send("Validation failed. Instructing AI to fix...".to_string());
                }
                if round == MAX_REPAIR_ROUNDS {
                    break;
                }
            }
        }
    }

    // Step 26: Return detailed validation errors instead of generic failure
    Err(format!(
        "Failed to generate a valid workflow after {} attempts.\n\nThe AI model couldn't fix these issues:\n- {}",
        MAX_REPAIR_ROUNDS + 1,
        last_errors.join("\n- ")
    ))
}

/// Step 27: Generate a concise title for the workflow based on its actual structure.
pub async fn auto_name_graph(
    graph: &Graph,
    model: &str,
    ollama_url: &str,
) -> Result<String, String> {
    let client = OllamaClient::new(ollama_url);
    if !client.is_reachable().await {
        return Err("Ollama not reachable".to_string());
    }

    let summary: Vec<String> = graph.nodes.iter().map(|n| format!("{:?}", n.data)).collect();
    let prompt = format!(
        "You are an expert naming assistant. I have generated a workflow with the following nodes:\n{}\n\nGenerate a very short, concise, and professional title (3-5 words) for this workflow. Output ONLY the title, no quotes, no extra text.",
        summary.join(", ")
    );

    let raw_output = client
        .generate(model, &prompt, vec![], false)
        .await
        .map_err(|e| format!("Naming request failed: {e}"))?;

    let title = raw_output.trim().trim_matches('"').to_string();
    Ok(if title.is_empty() { "Untitled Workflow".to_string() } else { title })
}

/// Extract the first valid JSON object `{ ... }` from a string that may contain markdown or prose.
pub fn extract_json(text: &str) -> &str {
    let trimmed = text.trim();
    let stripped = if trimmed.starts_with("```json") {
        trimmed
            .strip_prefix("```json")
            .unwrap_or(trimmed)
            .strip_suffix("```")
            .unwrap_or(trimmed)
            .trim()
    } else if trimmed.starts_with("```") {
        trimmed
            .strip_prefix("```")
            .unwrap_or(trimmed)
            .strip_suffix("```")
            .unwrap_or(trimmed)
            .trim()
    } else {
        trimmed
    };

    if let (Some(start), Some(end)) = (stripped.find('{'), stripped.rfind('}')) {
        if start < end {
            return &stripped[start..=end];
        }
    }

    stripped
}
