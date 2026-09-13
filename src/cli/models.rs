use anyhow::Result;
use clap::{Args, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};

use crossterm::style::{Color, ResetColor, SetForegroundColor};
use hybrid_local_ai_hub::ollama::OllamaClient;

#[derive(Args, Debug)]
pub struct ModelsArgs {
    #[command(subcommand)]
    pub command: ModelsCommand,
}

#[derive(Subcommand, Debug)]
pub enum ModelsCommand {
    /// List all models available on the local Ollama instance.
    List {
        #[arg(long, default_value = "http://localhost:11434")]
        ollama_url: String,
        #[arg(long)]
        json: bool,
    },
    /// Pull a model by name.
    Pull {
        /// Model name (e.g. llama3.2, phi4-mini, nomic-embed-text).
        name: String,
        #[arg(long, default_value = "http://localhost:11434")]
        ollama_url: String,
    },
}

pub async fn models(args: ModelsArgs) -> Result<()> {
    match args.command {
        ModelsCommand::List { ollama_url, json } => list_models(&ollama_url, json).await,
        ModelsCommand::Pull { name, ollama_url } => pull_model(&name, &ollama_url).await,
    }
}

async fn list_models(ollama_url: &str, json: bool) -> Result<()> {
    let client = OllamaClient::new(ollama_url);

    if !client.is_reachable().await {
        anyhow::bail!(
            "Ollama is not reachable at '{}'. Start it with: ollama serve",
            ollama_url
        );
    }

    let models = client.list_models().await?;

    if json {
        println!("{}", serde_json::to_string_pretty(&models)?);
        return Ok(());
    }

    let mut stdout = std::io::stdout();
    if models.is_empty() {
        println!("No models installed. Try: hybrid-hub models pull llama3.2");
        return Ok(());
    }

    println!();
    println!("  Installed Ollama models:");
    println!();
    for model in &models {
        let size_str = model
            .size
            .map(|s| format!("{:.1} GB", s as f64 / 1_073_741_824.0))
            .unwrap_or_else(|| "?".to_string());
        crossterm::execute!(stdout, SetForegroundColor(Color::Cyan)).ok();
        print!("  • {:<35}", model.name);
        crossterm::execute!(stdout, ResetColor).ok();
        println!("{}", size_str);
    }
    println!();
    Ok(())
}

async fn pull_model(name: &str, ollama_url: &str) -> Result<()> {
    let client = OllamaClient::new(ollama_url);

    if !client.is_reachable().await {
        anyhow::bail!(
            "Ollama is not reachable at '{}'. Start it with: ollama serve",
            ollama_url
        );
    }

    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("{spinner:.cyan} {msg}")
            .unwrap()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]),
    );
    pb.set_message(format!("Pulling '{}'...", name));
    pb.enable_steady_tick(std::time::Duration::from_millis(80));

    client
        .pull_model(name, None, |progress| {
            pb.set_message(format!("Pulling '{}': {}", name, progress.status));
        })
        .await?;

    pb.finish_with_message(format!("✓ '{}' pulled successfully", name));
    Ok(())
}
