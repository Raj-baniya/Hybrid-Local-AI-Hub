use anyhow::{anyhow, Result};
use clap::Args;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::PathBuf;

use hybrid_local_ai_hub::schema::{Graph, NodeType};
use hybrid_local_ai_hub::validate::validate_graph;

#[derive(Args, Debug)]
pub struct ExportArgs {
    /// Path to the workflow JSON to export.
    pub workflow: PathBuf,

    /// Output bundle path (.zip).
    #[arg(short = 'o', long)]
    pub output: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BundleManifest {
    pub tool_version: String,
    pub graph_version: u32,
    pub required_ollama_models: Vec<String>,
    pub required_chroma_collections: Vec<String>,
    pub machine_specific_paths: Vec<MachineSpecificPath>,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MachineSpecificPath {
    pub node_id: String,
    pub field: String,
    pub value: String,
}

pub async fn export(args: ExportArgs) -> Result<()> {
    // Read + parse workflow.
    let json_str = std::fs::read_to_string(&args.workflow)
        .map_err(|e| anyhow!("Cannot read '{}': {e}", args.workflow.display()))?;
    let graph: Graph = serde_json::from_str(&json_str)
        .map_err(|e| anyhow!("Invalid JSON in '{}': {e}", args.workflow.display()))?;

    // Validate before exporting.
    validate_graph(&graph)
        .map_err(|errs| anyhow!("Workflow has errors â€” fix before exporting:\n{}", errs.join("\n")))?;

    // Build the manifest.
    let manifest = build_manifest(&graph);
    let manifest_json = serde_json::to_string_pretty(&manifest)?;

    // Build the auto-generated README.
    let readme = build_readme(&graph, &manifest, &args.workflow);

    // Write the zip bundle.
    let file = std::fs::File::create(&args.output)
        .map_err(|e| anyhow!("Cannot create '{}': {e}", args.output.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let workflow_name = args
        .workflow
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("workflow.json");

    zip.start_file(workflow_name, options)?;
    zip.write_all(json_str.as_bytes())?;

    zip.start_file("manifest.json", options)?;
    zip.write_all(manifest_json.as_bytes())?;

    zip.start_file("README.md", options)?;
    zip.write_all(readme.as_bytes())?;

    zip.finish()?;

    println!("  âœ“ Exported to: {}", args.output.display());
    println!("    Contains: {}, manifest.json, README.md", workflow_name);
    println!();
    if !manifest.required_ollama_models.is_empty() {
        println!("  Required Ollama models: {}", manifest.required_ollama_models.join(", "));
    }
    if !manifest.machine_specific_paths.is_empty() {
        println!("  âš   {} machine-specific path(s) flagged in manifest â€” recipients must review.",
            manifest.machine_specific_paths.len());
    }

    Ok(())
}

// â”€â”€â”€ Import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Args, Debug)]
pub struct ImportArgs {
    /// Path to the bundle .zip file.
    pub bundle: PathBuf,

    /// Where to write the extracted workflow JSON.
    #[arg(short = 'o', long)]
    pub output: Option<PathBuf>,

    /// Ollama URL (for pulling missing models).
    #[arg(long, default_value = "http://127.0.0.1:11434")]
    pub ollama_url: String,

    /// Pull missing models without prompting.
    #[arg(long)]
    pub yes: bool,
}

pub async fn import(args: ImportArgs) -> Result<()> {
    let file = std::fs::File::open(&args.bundle)
        .map_err(|e| anyhow!("Cannot open '{}': {e}", args.bundle.display()))?;
    let mut zip = zip::ZipArchive::new(file)?;

    // Find workflow and manifest in the zip.
    let mut workflow_json = String::new();
    let mut manifest_json = String::new();

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        if name.ends_with(".json") && name != "manifest.json" {
            entry.read_to_string(&mut workflow_json)?;
        } else if name == "manifest.json" {
            entry.read_to_string(&mut manifest_json)?;
        }
    }

    if workflow_json.is_empty() {
        anyhow::bail!("Bundle contains no workflow JSON file");
    }

    let graph: Graph = serde_json::from_str(&workflow_json)
        .map_err(|e| anyhow!("Workflow JSON in bundle is invalid: {e}"))?;

    let manifest: BundleManifest = if manifest_json.is_empty() {
        build_manifest(&graph) // fallback if manifest missing
    } else {
        serde_json::from_str(&manifest_json)
            .map_err(|e| anyhow!("manifest.json is invalid: {e}"))?
    };

    println!();
    println!("  Bundle contents:");
    println!("    Tool version:  {}", manifest.tool_version);
    println!("    Graph version: {}", manifest.graph_version);
    println!("    Nodes: {}", graph.nodes.len());
    println!("    Edges: {}", graph.edges.len());
    println!();

    // Show required models + pull status.
    if !manifest.required_ollama_models.is_empty() {
        let ollama = hybrid_local_ai_hub::ollama::OllamaClient::new(&args.ollama_url);
        let installed = if ollama.is_reachable().await {
            ollama
                .list_models()
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|m| m.name)
                .collect::<HashSet<_>>()
        } else {
            HashSet::new()
        };

        println!("  Required Ollama models:");
        let mut missing_models: Vec<String> = Vec::new();
        for model in &manifest.required_ollama_models {
            let is_installed = installed.iter().any(|m| m.contains(model.as_str()));
            if is_installed {
                println!("    âœ“ {} (installed)", model);
            } else {
                println!("    âœ— {} (NOT installed)", model);
                missing_models.push(model.clone());
            }
        }
        println!();

        if !missing_models.is_empty() {
            let should_pull = args.yes || {
                print!("  Pull {} missing model(s) now? [Y/n] ", missing_models.len());
                std::io::stdout().flush()?;
                let mut line = String::new();
                std::io::stdin().read_line(&mut line)?;
                !line.trim().eq_ignore_ascii_case("n")
            };

            if should_pull {
                if ollama.is_reachable().await {
                    for model in &missing_models {
                        println!("  Pulling '{}'...", model);
                        ollama
                            .pull_model(model, None, |progress| print!("\r    {}", progress.status))
                            .await?;
                        println!("\r  âœ“ '{}' ready                   ", model);
                    }
                } else {
                    println!("  âš   Ollama is not reachable â€” skipping model pull");
                    println!("     Run 'hybrid-hub init' first");
                }
            }
        }
    }

    // Warn about machine-specific paths.
    if !manifest.machine_specific_paths.is_empty() {
        println!("  âš   Machine-specific paths that need review before running:");
        for p in &manifest.machine_specific_paths {
            println!("    Node '{}', field '{}': {}", p.node_id, p.field, p.value);
        }
        println!();
        println!("  Edit the workflow JSON to update these paths for your machine.");
        println!();
    }

    // Write workflow.
    validate_graph(&graph)
        .map_err(|errs| anyhow!("Imported workflow has errors:\n{}", errs.join("\n")))?;

    let out_path = args.output.unwrap_or_else(|| PathBuf::from("imported_workflow.json"));
    std::fs::write(&out_path, &workflow_json)
        .map_err(|e| anyhow!("Cannot write to '{}': {e}", out_path.display()))?;

    println!("  âœ“ Workflow written to: {}", out_path.display());
    if !manifest.machine_specific_paths.is_empty() {
        println!("  Review and update the machine-specific paths above before running.");
    } else {
        println!("  Ready to run: hybrid-hub run {}", out_path.display());
    }
    println!();

    Ok(())
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

fn build_manifest(graph: &Graph) -> BundleManifest {
    let mut models: HashSet<String> = HashSet::new();
    let mut collections: HashSet<String> = HashSet::new();
    let mut machine_paths: Vec<MachineSpecificPath> = Vec::new();

    for node in &graph.nodes {
        match &node.data {
            NodeType::OllamaSelectorNode(cfg) => {
                models.insert(cfg.model.clone());
            }
            NodeType::LocalEmbedderNode(cfg) => {
                models.insert(cfg.model.clone());
            }
            NodeType::AiPlanNode(cfg) => {
                models.insert(cfg.model.clone().unwrap_or_else(|| "llama3.2".to_string()));
            }
            NodeType::AiInterpretNode(cfg) => {
                models.insert(cfg.model.clone().unwrap_or_else(|| "llama3.2".to_string()));
            }
            NodeType::SourceFileNode(cfg) => {
                machine_paths.push(MachineSpecificPath {
                    node_id: node.id.clone(),
                    field: "path".to_string(),
                    value: cfg.path.clone(),
                });
            }
            NodeType::ChromaDbStoreNode(cfg) => {
                collections.insert(cfg.collection_name.clone());
            }
            NodeType::FileWatcherNode(cfg) => {
                machine_paths.push(MachineSpecificPath {
                    node_id: node.id.clone(),
                    field: "watchPath".to_string(),
                    value: cfg.watch_path.clone(),
                });
            }
            NodeType::LocalFileWriterNode(cfg) => {
                machine_paths.push(MachineSpecificPath {
                    node_id: node.id.clone(),
                    field: "outputPath".to_string(),
                    value: cfg.output_path.clone(),
                });
            }
            _ => {}
        }
    }

    BundleManifest {
        tool_version: env!("CARGO_PKG_VERSION").to_string(),
        graph_version: graph.version,
        required_ollama_models: models.into_iter().collect(),
        required_chroma_collections: collections.into_iter().collect(),
        machine_specific_paths: machine_paths,
        notes: "Review machine-specific paths before running on a different machine.".to_string(),
    }
}

fn build_readme(graph: &Graph, manifest: &BundleManifest, source_path: &std::path::Path) -> String {
    let node_list: String = graph
        .nodes
        .iter()
        .map(|n| {
            let type_name = match &n.data {
                NodeType::FileWatcherNode(_) => "FileWatcherNode",
                NodeType::TextInputNode(_) => "TextInputNode",
                NodeType::ImageInputNode(_) => "ImageInputNode",
                NodeType::OllamaSelectorNode(_) => "OllamaSelectorNode",
                NodeType::LocalEmbedderNode(_) => "LocalEmbedderNode",
                NodeType::PDFExtractorNode(_) => "PDFExtractorNode",
                NodeType::ChromaDbStoreNode(_) => "ChromaDbStoreNode",
                NodeType::ConditionalRouterNode(_) => "ConditionalRouterNode",
                NodeType::LocalFileWriterNode(_) => "LocalFileWriterNode",
                NodeType::WebScraperNode(_) => "WebScraperNode",
                NodeType::ShellCommandNode(_) => "ShellCommandNode",
                NodeType::RegexExtractorNode(_) => "RegexExtractorNode",
                NodeType::ScheduleNode(_) => "ScheduleNode",
                NodeType::SourceFileNode(_) => "SourceFileNode",
                NodeType::DatasetProfileNode(_) => "DatasetProfileNode",
                NodeType::TransformAggregateNode(_) => "TransformAggregateNode",
                NodeType::AnalysisStatsHypothesisTestNode(_) => "AnalysisStatsHypothesisTestNode",
                NodeType::AiInterpretNode(_) => "AiInterpretNode",
                NodeType::AiPlanNode(_) => "AiPlanNode",
                NodeType::ClipboardTriggerNode(_) => "ClipboardTriggerNode",
                NodeType::CsvReaderNode(_) => "CsvReaderNode",
                NodeType::DelayNode(_) => "DelayNode",
                NodeType::TemplateFormatterNode(_) => "TemplateFormatterNode",
                NodeType::MergeNode(_) => "MergeNode",
                NodeType::NotifyDesktopNode(_) => "NotifyDesktopNode",
                NodeType::NotifyWebhookNode(_) => "NotifyWebhookNode",

            };
            format!("- **{}** ({})", n.id, type_name)
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"# Hybrid Local AI Hub Workflow Bundle

Exported from: `{}`
Tool version: {}

## Workflow Structure

{} nodes, {} edges:

{}

## Requirements

### Ollama Models
{}

### ChromaDB Collections
{}

## Machine-Specific Paths

The following paths reference the original machine's filesystem.
**Review and update these before running:**

{}

## Quick Start

1. Import this bundle: `hybrid-hub import <this_bundle.zip> -o workflow.json`
2. Edit any machine-specific paths listed above
3. Validate: `hybrid-hub validate workflow.json`
4. Run: `hybrid-hub run workflow.json`
"#,
        source_path.display(),
        manifest.tool_version,
        graph.nodes.len(),
        graph.edges.len(),
        node_list,
        if manifest.required_ollama_models.is_empty() {
            "None".to_string()
        } else {
            manifest.required_ollama_models.join("\n")
        },
        if manifest.required_chroma_collections.is_empty() {
            "None".to_string()
        } else {
            manifest.required_chroma_collections.join("\n")
        },
        if manifest.machine_specific_paths.is_empty() {
            "None â€” this workflow has no machine-specific paths.".to_string()
        } else {
            manifest
                .machine_specific_paths
                .iter()
                .map(|p| format!("- `{}`.`{}` = `{}`", p.node_id, p.field, p.value))
                .collect::<Vec<_>>()
                .join("\n")
        }
    )
}
