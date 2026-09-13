use anyhow::{anyhow, Result};
use clap::{Args, Subcommand};
use std::path::PathBuf;

#[derive(Args, Debug)]
pub struct TemplateArgs {
    #[command(subcommand)]
    pub command: TemplateCommand,
}

#[derive(Subcommand, Debug)]
pub enum TemplateCommand {
    /// List all available starter templates.
    List,
    /// Copy a template to a file so you can run or edit it.
    Use {
        /// Template name (from `template list`).
        name: String,
        /// Output file path.
        #[arg(short = 'o', long)]
        output: PathBuf,
    },
}

pub fn template(args: TemplateArgs) -> Result<()> {
    match args.command {
        TemplateCommand::List => list_templates(),
        TemplateCommand::Use { name, output } => use_template(&name, &output),
    }
}

struct TemplateEntry {
    name: &'static str,
    description: &'static str,
    json: &'static str,
}

fn templates() -> &'static [TemplateEntry] {
    &[
        TemplateEntry {
            name: "gym-intake",
            description: "Watch a folder for PDF intake forms, extract text, generate a personalised plan, route by goal type, embed + store in ChromaDB",
            json: include_str!("../../samples/templates/gym_intake.json"),
        },
        TemplateEntry {
            name: "summarizer",
            description: "Watch a folder for text files and summarize each one via a local LLM, writing summaries to an output folder",
            json: include_str!("../../samples/templates/summarizer.json"),
        },
        TemplateEntry {
            name: "pdf-indexer",
            description: "Watch a folder for PDFs, extract text, embed with nomic-embed-text, store in ChromaDB for semantic search",
            json: include_str!("../../samples/templates/pdf_indexer.json"),
        },
        TemplateEntry {
            name: "ticket-router",
            description: "Classify a customer support ticket and route billing vs. general tickets to separate queues",
            json: include_str!("../../samples/templates/ticket_router.json"),
        },
        TemplateEntry {
            name: "research-digest",
            description: "Accept a research question as text input, query an LLM for key points, and write a structured digest to disk",
            json: include_str!("../../samples/templates/research_digest.json"),
        },
    ]
}

fn list_templates() -> Result<()> {
    println!();
    println!("  Available starter templates:");
    println!("  (These are editable starting points — 'hybrid-hub chat' can generate anything)");
    println!();
    for t in templates() {
        println!("  {:20}  {}", t.name, t.description);
    }
    println!();
    println!("  Usage:");
    println!("    hybrid-hub template use <name> -o my_workflow.json");
    println!("    hybrid-hub validate my_workflow.json");
    println!("    hybrid-hub run my_workflow.json");
    println!();
    Ok(())
}

fn use_template(name: &str, output: &PathBuf) -> Result<()> {
    let entry = templates()
        .iter()
        .find(|t| t.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| {
            anyhow!(
                "Unknown template '{}'. Available: {}",
                name,
                templates()
                    .iter()
                    .map(|t| t.name)
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;

    std::fs::write(output, entry.json).map_err(|e| {
        anyhow!("Cannot write to '{}': {e}", output.display())
    })?;

    println!("  ✓ Template '{}' written to: {}", name, output.display());
    println!("    {}", entry.description);
    println!();
    println!("  Next steps:");
    println!("    hybrid-hub validate {}   # check it", output.display());
    println!("    hybrid-hub run {}        # run it", output.display());
    println!(
        "    hybrid-hub chat \"modify it to also ...\" --edit {} -o {}",
        output.display(),
        output.display()
    );
    println!();
    println!("  Note: templates are starting points. 'hybrid-hub chat' can generate");
    println!("  entirely new workflows for any automation idea.");
    println!();
    Ok(())
}
