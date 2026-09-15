use anyhow::Result;
use clap::Args;
use std::path::PathBuf;

use crossterm::style::{Color, ResetColor, SetForegroundColor};
use hybrid_local_ai_hub::schema::Graph;
use hybrid_local_ai_hub::validate::validate_graph;

#[derive(Args, Debug)]
pub struct ValidateArgs {
    /// Path to the workflow JSON file to validate.
    pub path: PathBuf,

    /// Output errors as JSON.
    #[arg(long)]
    pub json: bool,
}

pub fn validate(args: ValidateArgs) -> Result<()> {
    let json_str = std::fs::read_to_string(&args.path).map_err(|e| {
        anyhow::anyhow!("Cannot read file '{}': {e}", args.path.display())
    })?;

    let graph: Graph = match serde_json::from_str(&json_str) {
        Ok(g) => g,
        Err(e) => {
            if args.json {
                println!(
                    "{}",
                    serde_json::json!({ "valid": false, "errors": [format!("JSON parse error: {e}")] })
                );
            } else {
                let mut stdout = std::io::stdout();
                crossterm::execute!(stdout, SetForegroundColor(Color::Red)).ok();
                eprintln!("âœ— JSON parse error: {e}");
                crossterm::execute!(stdout, ResetColor).ok();
            }
            std::process::exit(1);
        }
    };

    match validate_graph(&graph) {
        Ok(()) => {
            if args.json {
                println!("{}", serde_json::json!({ "valid": true, "errors": [] }));
            } else {
                let mut stdout = std::io::stdout();
                crossterm::execute!(stdout, SetForegroundColor(Color::Green)).ok();
                println!("âœ“ Workflow is valid ({} nodes, {} edges)",
                    graph.nodes.len(), graph.edges.len());
                crossterm::execute!(stdout, ResetColor).ok();
            }
        }
        Err(errs) => {
            if args.json {
                println!("{}", serde_json::json!({ "valid": false, "errors": errs }));
            } else {
                let mut stdout = std::io::stdout();
                crossterm::execute!(stdout, SetForegroundColor(Color::Red)).ok();
                eprintln!("âœ— Workflow has {} error(s):", errs.len());
                crossterm::execute!(stdout, ResetColor).ok();
                for err in &errs {
                    eprintln!("  â€¢ {}", err);
                }
            }
            std::process::exit(1);
        }
    }

    Ok(())
}
