use anyhow::{anyhow, Result};
use clap::Args;
use std::path::PathBuf;

use hybrid_local_ai_hub::ollama::OllamaClient;
use hybrid_local_ai_hub::schema::{Graph, NodeType};
use hybrid_local_ai_hub::translator_prompt::build_system_prompt;
use hybrid_local_ai_hub::validate::validate_graph;

use crossterm::style::{Color, ResetColor, SetForegroundColor};

const MAX_REPAIR_ROUNDS: usize = 3;

#[derive(Args, Debug)]
pub struct ChatArgs {
    /// Natural language description of the workflow to generate.
    pub instruction: String,

    /// Output file for the generated workflow JSON.
    #[arg(short = 'o', long)]
    pub output: Option<PathBuf>,

    /// Edit an existing workflow instead of generating from scratch.
    #[arg(long)]
    pub edit: Option<PathBuf>,

    /// Ollama model to use as the compiler.
    #[arg(long, default_value = "llama3.2")]
    pub model: String,

    /// Ollama base URL.
    #[arg(long, default_value = "http://127.0.0.1:11434")]
    pub ollama_url: String,

    /// Output the raw generated JSON without the "what now" summary.
    #[arg(long)]
    pub raw: bool,
}

pub async fn chat(args: ChatArgs) -> Result<()> {
    let mut stdout = std::io::stdout();
    let client = OllamaClient::new(&args.ollama_url);

    // Check Ollama reachability.
    if !client.is_reachable().await {
        anyhow::bail!(
            "Ollama is not reachable at '{}'. Run 'hybrid-hub init' to set up.",
            args.ollama_url
        );
    }

    let system_prompt = build_system_prompt();

    // Build the user message: include existing graph if --edit.
    let user_message = if let Some(ref edit_path) = args.edit {
        let existing_json = std::fs::read_to_string(edit_path).map_err(|e| {
            anyhow!("Cannot read '{}': {e}", edit_path.display())
        })?;
        // Validate the existing graph first.
        let existing: Graph = serde_json::from_str(&existing_json).map_err(|e| {
            anyhow!("'{}' is not valid JSON: {e}", edit_path.display())
        })?;
        if let Err(errs) = validate_graph(&existing) {
            eprintln!("Warning: existing graph has validation errors:");
            for e in &errs {
                eprintln!("  â€¢ {e}");
            }
        }
        format!(
            "Existing workflow JSON:\n{}\n\nModification request: {}",
            existing_json, args.instruction
        )
    } else {
        format!("Generate a workflow graph for: {}", args.instruction)
    };

    let full_prompt = format!("{}\n\nUser: {}", system_prompt, user_message);

    // Generate + validate + repair loop.
    crossterm::execute!(stdout, SetForegroundColor(Color::Cyan)).ok();
    println!("  Generating workflow graph...");
    crossterm::execute!(stdout, ResetColor).ok();

    let mut last_json = String::new();
    let mut last_errors: Vec<String> = Vec::new();
    let mut graph: Option<Graph> = None;

    for round in 0..=MAX_REPAIR_ROUNDS {
        let prompt = if round == 0 {
            full_prompt.clone()
        } else {
            // Repair prompt: feed back the model's last attempt + validation errors.
            format!(
                "{}\n\nUser: {}\n\nYour previous attempt:\n{}\n\nValidation errors to fix:\n{}\n\nRepair the JSON to fix all errors above. Output ONLY the corrected JSON:",
                system_prompt,
                user_message,
                last_json,
                last_errors.join("\n")
            )
        };

        if round > 0 {
            crossterm::execute!(stdout, SetForegroundColor(Color::Yellow)).ok();
            println!("  Repair attempt {}/{}...", round, MAX_REPAIR_ROUNDS);
            crossterm::execute!(stdout, ResetColor).ok();
        }

        let raw_output = client
            .generate(&args.model, &prompt, vec![], false)
            .await
            .map_err(|e| anyhow!("LLM failed: {e}"))?;

        // Extract JSON from the response (model may wrap it in prose).
        let json_str = extract_json(&raw_output);
        last_json = json_str.to_string();

        // Parse.
        let parsed: Graph = match serde_json::from_str(json_str) {
            Ok(g) => g,
            Err(e) => {
                last_errors = vec![format!("JSON parse error: {e}")];
                if round == MAX_REPAIR_ROUNDS {
                    break;
                }
                continue;
            }
        };

        // Validate.
        match validate_graph(&parsed) {
            Ok(()) => {
                graph = Some(parsed);
                break;
            }
            Err(errs) => {
                last_errors = errs;
                if round == MAX_REPAIR_ROUNDS {
                    break;
                }
            }
        }
    }

    match graph {
        None => {
            crossterm::execute!(stdout, SetForegroundColor(Color::Red)).ok();
            eprintln!("  âœ— Failed to generate a valid graph after {} repair attempts.", MAX_REPAIR_ROUNDS);
            crossterm::execute!(stdout, ResetColor).ok();
            eprintln!("  Last attempt:");
            eprintln!("{}", last_json);
            eprintln!("  Validation errors:");
            for err in &last_errors {
                eprintln!("  â€¢ {err}");
            }
            std::process::exit(1);
        }
        Some(g) => {
            // Print diff if --edit mode.
            if let Some(ref edit_path) = args.edit {
                if let Ok(orig_str) = std::fs::read_to_string(edit_path) {
                    print_diff(&orig_str, &serde_json::to_string_pretty(&g)?);
                }
            }

            // Write to file or stdout.
            let json_out = serde_json::to_string_pretty(&g)?;
            let out_path = args
                .output
                .clone()
                .unwrap_or_else(|| PathBuf::from("workflow.json"));

            std::fs::write(&out_path, &json_out).map_err(|e| {
                anyhow!("Cannot write to '{}': {e}", out_path.display())
            })?;

            crossterm::execute!(stdout, SetForegroundColor(Color::Green)).ok();
            println!("  âœ“ Workflow saved to: {}", out_path.display());
            crossterm::execute!(stdout, ResetColor).ok();

            if !args.raw {
                print_what_now(&g, &out_path);
            }
        }
    }

    Ok(())
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Extract the first {...} JSON object from a potentially noisy LLM response.
fn extract_json(text: &str) -> &str {
    // Strip markdown fences if present.
    let stripped = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    // Find the outermost { ... }
    if let Some(start) = stripped.find('{') {
        let tail = &stripped[start..];
        let mut depth = 0i32;
        for (i, ch) in tail.char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return &tail[..=i];
                    }
                }
                _ => {}
            }
        }
        tail
    } else {
        stripped
    }
}

/// Print a simple structural diff between two JSON strings (node/edge counts).
fn print_diff(original: &str, updated: &str) {
    let orig_nodes = original.matches("\"id\"").count();
    let new_nodes = updated.matches("\"id\"").count();
    println!();
    println!("  Changes from existing graph:");
    if new_nodes > orig_nodes {
        println!("  + {} element(s) added", new_nodes - orig_nodes);
    } else if new_nodes < orig_nodes {
        println!("  - {} element(s) removed", orig_nodes - new_nodes);
    } else {
        println!("  ~ Same structure, fields may have changed");
    }
    println!();
}

/// Print a "what now" summary tailored to the generated graph's actual contents.
fn print_what_now(graph: &Graph, out_path: &std::path::Path) {
    let has_watcher = graph
        .nodes
        .iter()
        .any(|n| matches!(n.data, NodeType::FileWatcherNode(_)));

    println!();
    println!("  This workflow has {} node(s) and {} edge(s).", graph.nodes.len(), graph.edges.len());
    println!();
    println!("  Next steps:");
    println!(
        "    hybrid-hub validate {}   # double-check before running",
        out_path.display()
    );
    println!(
        "    hybrid-hub run {}        # run once",
        out_path.display()
    );
    if has_watcher {
        println!(
            "    hybrid-hub run {} --watch  # keep running on file events",
            out_path.display()
        );
    }
    println!(
        "    hybrid-hub export {} -o bundle.zip  # share it",
        out_path.display()
    );
    println!();
    println!("  To refine this workflow:");
    println!(
        "    hybrid-hub chat \"<modification>\" --edit {} -o {}",
        out_path.display(),
        out_path.display()
    );
    println!();
}
