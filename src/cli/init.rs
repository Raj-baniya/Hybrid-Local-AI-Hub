use anyhow::Result;
use clap::Args;
use indicatif::{ProgressBar, ProgressStyle};
use std::time::Duration;

use hybrid_local_ai_hub::chroma::ChromaClient;
use hybrid_local_ai_hub::ollama::OllamaClient;
use crossterm::style::{Color, ResetColor, SetForegroundColor};
use std::io::Write;

/// Recommended defaults for 8 GB RAM systems.
const DEFAULT_CHAT_MODEL: &str = "llama3.2";
const DEFAULT_EMBED_MODEL: &str = "nomic-embed-text";

#[derive(Args, Debug)]
pub struct InitArgs {
    /// Ollama base URL to check.
    #[arg(long, default_value = "http://127.0.0.1:11434")]
    pub ollama_url: String,

    /// ChromaDB base URL to check.
    #[arg(long, default_value = "http://localhost:8000")]
    pub chroma_url: String,

    /// Skip prompts and use defaults (non-interactive mode).
    #[arg(long)]
    pub yes: bool,
}

pub async fn init(args: InitArgs) -> Result<()> {
    let mut stdout = std::io::stdout();

    print_banner();

    // â”€â”€ Step 1: Check if `ollama` binary is installed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let ollama_installed = is_ollama_installed();

    if !ollama_installed {
        crossterm::execute!(stdout, SetForegroundColor(Color::Yellow)).ok();
        println!("  Ollama is not installed on this system.");
        crossterm::execute!(stdout, ResetColor).ok();

        let should_install = args.yes || prompt_yes_no("  Install it automatically now?", true)?;

        if should_install {
            install_ollama().await?;
        } else {
            println!();
            println!("  To install Ollama manually:");
            println!("    Linux/macOS: curl -fsSL https://ollama.com/install.sh | sh");
            println!("    Windows:     https://ollama.com/download/windows");
            println!();
            std::process::exit(1);
        }
    } else {
        crossterm::execute!(stdout, SetForegroundColor(Color::Green)).ok();
        println!("  âœ“ Ollama binary is installed");
        crossterm::execute!(stdout, ResetColor).ok();
    }

    // â”€â”€ Step 2: Check if the Ollama service is running â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let client = OllamaClient::new(&args.ollama_url);
    let service_running = client.is_reachable().await;

    if !service_running {
        crossterm::execute!(stdout, SetForegroundColor(Color::Yellow)).ok();
        println!("  Ollama is installed but the service is not running.");
        crossterm::execute!(stdout, ResetColor).ok();

        let should_start = args.yes || prompt_yes_no("  Start the Ollama service now?", true)?;

        if should_start {
            start_ollama_service()?;
            // Give it a moment to start up.
            println!("  Waiting for service to start...");
            for _ in 0..15 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                if client.is_reachable().await {
                    crossterm::execute!(stdout, SetForegroundColor(Color::Green)).ok();
                    println!("  âœ“ Ollama service is now running");
                    crossterm::execute!(stdout, ResetColor).ok();
                    break;
                }
            }
            if !client.is_reachable().await {
                anyhow::bail!(
                    "Ollama service did not start within 15 seconds. \
                     Start it manually with: ollama serve"
                );
            }
        } else {
            println!("  Start the service manually with: ollama serve");
            std::process::exit(1);
        }
    } else {
        crossterm::execute!(stdout, SetForegroundColor(Color::Green)).ok();
        println!("  âœ“ Ollama service is running at {}", args.ollama_url);
        crossterm::execute!(stdout, ResetColor).ok();
    }

    // â”€â”€ Step 3: RAM check for model recommendations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let ram_gb = detect_ram_gb();
    if ram_gb > 0 && ram_gb <= 8 {
        crossterm::execute!(stdout, SetForegroundColor(Color::Yellow)).ok();
        println!("  âš   Detected ~{}GB RAM â€” recommending 3â€“4B parameter models.", ram_gb);
        println!("     Models above ~4B at Q4 quantization may leave little headroom.");
        crossterm::execute!(stdout, ResetColor).ok();
    }

    // â”€â”€ Step 4: Check/pull recommended models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let models = client.list_models().await.unwrap_or_default();
    let installed: Vec<&str> = models.iter().map(|m| m.name.as_str()).collect();

    let needs_chat = !installed.iter().any(|n| n.contains("llama3.2"));
    let needs_embed = !installed.iter().any(|n| n.contains("nomic-embed-text"));

    if !needs_chat && !needs_embed {
        crossterm::execute!(stdout, SetForegroundColor(Color::Green)).ok();
        println!("  âœ“ Required models already installed (llama3.2, nomic-embed-text)");
        crossterm::execute!(stdout, ResetColor).ok();
    } else {
        if needs_chat {
            println!("  Pulling {} (default chat/generation model)...", DEFAULT_CHAT_MODEL);
            pull_with_progress(&client, DEFAULT_CHAT_MODEL).await?;
        }
        if needs_embed {
            println!("  Pulling {} (embeddings model)...", DEFAULT_EMBED_MODEL);
            pull_with_progress(&client, DEFAULT_EMBED_MODEL).await?;
        }
    }

    // â”€â”€ Step 5: ChromaDB check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let chroma = ChromaClient::new(&args.chroma_url);
    if chroma.is_reachable().await {
        crossterm::execute!(stdout, SetForegroundColor(Color::Green)).ok();
        println!("  âœ“ ChromaDB is reachable at {}", args.chroma_url);
        crossterm::execute!(stdout, ResetColor).ok();
    } else {
        crossterm::execute!(stdout, SetForegroundColor(Color::Yellow)).ok();
        println!("  âš   ChromaDB is not running at {}", args.chroma_url);
        crossterm::execute!(stdout, ResetColor).ok();
        println!("     ChromaDB is optional â€” only needed for ChromaDbStoreNode.");
        println!("     To start it:");
        println!("       pip install chromadb");
        println!("       chroma run --host localhost --port 8000");
    }

    // â”€â”€ Done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    println!();
    crossterm::execute!(stdout, SetForegroundColor(Color::Green)).ok();
    println!("  âœ“ Hybrid Local AI Hub is ready!");
    crossterm::execute!(stdout, ResetColor).ok();
    println!();
    println!("  Quick start:");
    println!("    hybrid-hub chat \"<describe your automation>\" -o workflow.json");
    println!("    hybrid-hub validate workflow.json");
    println!("    hybrid-hub run workflow.json");
    println!();
    println!("  Alternate models (pull with: hybrid-hub models pull <name>):");
    println!("    phi4-mini      â€” fastest option for 8 GB RAM (~28 tok/s)");
    println!("    qwen3:4b       â€” best reasoning quality in the 8 GB tier");
    println!("    gemma2:2b      â€” lightest fallback for very constrained machines");
    println!();

    Ok(())
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

fn print_banner() {
    println!();
    println!("  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”");
    println!("  â”‚       Hybrid Local AI Hub â€” Init        â”‚");
    println!("  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜");
    println!();
}

fn is_ollama_installed() -> bool {
    let cmd = if cfg!(target_os = "windows") {
        std::process::Command::new("where").arg("ollama").output()
    } else {
        std::process::Command::new("which").arg("ollama").output()
    };
    cmd.map(|o| o.status.success()).unwrap_or(false)
}

async fn install_ollama() -> Result<()> {
    let mut stdout = std::io::stdout();

    if cfg!(target_os = "windows") {
        // Check for winget first.
        let has_winget = std::process::Command::new("winget")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if has_winget {
            println!("  Installing Ollama via winget...");
            let status = std::process::Command::new("winget")
                .args(["install", "Ollama.Ollama", "--silent"])
                .status()?;
            if !status.success() {
                anyhow::bail!("winget install failed");
            }
        } else {
            crossterm::execute!(stdout, SetForegroundColor(Color::Yellow)).ok();
            println!("  winget is not available on this system.");
            crossterm::execute!(stdout, ResetColor).ok();
            println!("  Please install Ollama manually:");
            println!("    https://ollama.com/download/windows");
            println!("  Then press Enter to continue...");
            let mut line = String::new();
            std::io::stdin().read_line(&mut line)?;
        }
    } else {
        // Linux / macOS: use the official install script.
        println!("  Running: curl -fsSL https://ollama.com/install.sh | sh");
        let status = std::process::Command::new("sh")
            .args(["-c", "curl -fsSL https://ollama.com/install.sh | sh"])
            .status()?;
        if !status.success() {
            anyhow::bail!("Ollama install script failed");
        }
        crossterm::execute!(stdout, SetForegroundColor(Color::Green)).ok();
        println!("  âœ“ Ollama installed successfully");
        crossterm::execute!(stdout, ResetColor).ok();
    }

    Ok(())
}

fn start_ollama_service() -> Result<()> {
    // Spawn `ollama serve` in the background.
    std::process::Command::new("ollama")
        .arg("serve")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to start ollama serve: {e}"))?;
    Ok(())
}

fn detect_ram_gb() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.total_memory() / 1_073_741_824 // bytes â†’ GB
}

fn prompt_yes_no(question: &str, default_yes: bool) -> Result<bool> {
    let default_hint = if default_yes { "[Y/n]" } else { "[y/N]" };
    print!("{} {} ", question, default_hint);
    std::io::stdout().flush()?;
    let mut line = String::new();
    std::io::stdin().read_line(&mut line)?;
    let trimmed = line.trim().to_lowercase();
    Ok(match trimmed.as_str() {
        "" => default_yes,
        "y" | "yes" => true,
        "n" | "no" => false,
        _ => default_yes,
    })
}

async fn pull_with_progress(client: &OllamaClient, model: &str) -> Result<()> {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("  {spinner:.cyan} {msg}")
            .unwrap()
            .tick_strings(&["â ‹", "â ™", "â ¹", "â ¸", "â ¼", "â ´", "â ¦", "â §", "â ‡", "â "]),
    );
    pb.set_message(format!("Pulling '{}'...", model));
    pb.enable_steady_tick(Duration::from_millis(80));

    client
        .pull_model(model, None, |progress| {
            pb.set_message(format!("'{}': {}", model, progress.status));
        })
        .await?;

    pb.finish_with_message(format!("âœ“ '{}' ready", model));
    Ok(())
}
