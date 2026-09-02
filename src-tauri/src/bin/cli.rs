use tauri_app_lib::executor::{topological_sort, GraphState};
use std::env;
use std::fs;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        println!("Usage: hub run <pipeline.json>");
        std::process::exit(1);
    }

    let file_path = &args[1];
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error reading file {file_path}: {e}");
            std::process::exit(1);
        }
    };

    let graph: GraphState = match serde_json::from_str(&content) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("Error parsing JSON graph: {e}");
            std::process::exit(1);
        }
    };

    match topological_sort(&graph) {
        Ok(sorted_nodes) => {
            println!("Successfully validated graph! Topological order:");
            for (idx, node) in sorted_nodes.iter().enumerate() {
                println!("  {}. {} (type: {})", idx + 1, node.label, node.r#type);
            }
        }
        Err(e) => {
            eprintln!("Graph validation failed: {e}");
            std::process::exit(1);
        }
    }
}
