//! Chat-to-graph compiler core: shared between CLI (`chat.rs`) and GUI IPC (`commands.rs`).
//!
//! Generates a valid `Graph` from plain-English instructions using a local LLM via Ollama.
//! Employs an iterative validation and targeted-repair loop (up to 3 rounds) before returning.

use anyhow::Result;
use crate::ollama::OllamaClient;
use crate::schema::Graph;
use crate::translator_prompt::build_system_prompt;
use crate::validate::validate_graph;

pub const DEFAULT_MODEL: &str = "llama3.2";
pub const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";
pub const DEFAULT_TEMPERATURE: f32 = 0.2;
pub const MAX_REPAIR_ROUNDS: usize = 3;

/// Generate a new workflow graph from plain-English instructions.
pub async fn generate_workflow(
    instruction: &str,
    model: &str,
    ollama_url: &str,
    temperature: f32,
) -> Result<Graph, String> {
    let user_message = format!("Generate a workflow graph for: {}", instruction);
    run_compiler_loop(&user_message, model, ollama_url, temperature).await
}

/// Modify an existing workflow graph according to plain-English instructions.
pub async fn edit_workflow(
    instruction: &str,
    existing: &Graph,
    model: &str,
    ollama_url: &str,
    temperature: f32,
) -> Result<Graph, String> {
    let existing_json = serde_json::to_string_pretty(existing)
        .map_err(|e| format!("Failed to serialize existing graph: {e}"))?;
    let user_message = format!(
        "Existing workflow JSON:\n{}\n\nModification request: {}",
        existing_json, instruction
    );
    run_compiler_loop(&user_message, model, ollama_url, temperature).await
}

/// Core generation, validation, and multi-round repair loop.
async fn run_compiler_loop(
    user_message: &str,
    model: &str,
    ollama_url: &str,
    temperature: f32,
) -> Result<Graph, String> {
    let client = OllamaClient::new(ollama_url);

    if !client.is_reachable().await {
        return Err(format!(
            "Ollama is not reachable at '{}'. Please start Ollama before compiling.",
            ollama_url
        ));
    }

    let system_prompt = build_system_prompt();
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

        let raw_output = client
            .generate(model, &prompt, vec![], temperature, false)
            .await
            .map_err(|e| format!("LLM generation request failed: {e}"))?;

        let json_str = extract_json(&raw_output);
        last_json = json_str.to_string();

        let parsed: Graph = match serde_json::from_str(json_str) {
            Ok(g) => g,
            Err(e) => {
                last_errors = vec![format!("JSON syntax parse error: {e}")];
                if round == MAX_REPAIR_ROUNDS {
                    break;
                }
                continue;
            }
        };

        match validate_graph(&parsed) {
            Ok(()) => return Ok(parsed),
            Err(errs) => {
                last_errors = errs;
                if round == MAX_REPAIR_ROUNDS {
                    break;
                }
            }
        }
    }

    Err(format!(
        "Failed to generate a valid workflow after {} repair rounds.\nLast validation errors:\n{}\n\nLast model output:\n{}",
        MAX_REPAIR_ROUNDS,
        last_errors.iter().map(|e| format!(" â€¢ {e}")).collect::<Vec<_>>().join("\n"),
        last_json
    ))
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
