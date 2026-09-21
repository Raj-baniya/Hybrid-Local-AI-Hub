use anyhow::Result;
use clap::Args;
use std::path::PathBuf;

use crossterm::style::{Color, ResetColor, SetForegroundColor};
use hybrid_local_ai_hub::execution_record::NodeStatus;
use hybrid_local_ai_hub::executor::{run_graph, ExecutorConfig, FailurePolicy};
use hybrid_local_ai_hub::schema::{Graph, NodeType};
use hybrid_local_ai_hub::validate::validate_graph;
use hybrid_local_ai_hub::watcher::FileWatcher;

#[derive(Args, Debug)]
pub struct RunArgs {
    /// Path to the workflow JSON file.
    pub path: PathBuf,

    /// Keep running and re-trigger on file-system events (FileWatcherNode graphs).
    #[arg(long)]
    pub watch: bool,

    /// Output execution results as JSON (machine-readable).
    #[arg(long)]
    pub json: bool,

    /// Continue executing independent branches when a node fails.
    #[arg(long)]
    pub continue_on_failure: bool,

    /// Ollama base URL.
    #[arg(long, default_value = "http://127.0.0.1:11434")]
    pub ollama_url: String,

    /// ChromaDB base URL.
    #[arg(long, default_value = "http://localhost:8000")]
    pub chroma_url: String,
}

pub async fn run(args: RunArgs) -> Result<()> {
    let json_str = std::fs::read_to_string(&args.path).map_err(|e| {
        anyhow::anyhow!("Cannot read workflow file '{}': {e}", args.path.display())
    })?;

    let graph: Graph = serde_json::from_str(&json_str).map_err(|e| {
        anyhow::anyhow!("Invalid workflow JSON in '{}': {e}", args.path.display())
    })?;

    // Validate before running.
    if let Err(errs) = validate_graph(&graph) {
        eprintln!("Workflow validation failed:");
        for err in errs {
            eprintln!("  â€¢ {}", err);
        }
        std::process::exit(1);
    }

    let config = ExecutorConfig {
        ollama_url: args.ollama_url.clone(),
        chroma_url: args.chroma_url.clone(),
        failure_policy: if args.continue_on_failure {
            FailurePolicy::ContinueIndependentBranches
        } else {
            FailurePolicy::HaltOnFailure
        },
        ..Default::default()
    };

    if args.watch {
        // Pre-validate triggers before initial execution
        let mut watcher_opt = None;
        let mut schedule_opt = None;
        let mut watch_path_display = String::new();
        
        if let Some(watcher_node) = graph.nodes.iter().find(|n| matches!(n.data, NodeType::FileWatcherNode(_))) {
            if let NodeType::FileWatcherNode(ref cfg) = watcher_node.data {
                watcher_opt = Some(FileWatcher::new(&cfg.watch_path, cfg.recursive)?);
                watch_path_display = cfg.watch_path.clone();
            }
        } else if let Some(schedule_node) = graph.nodes.iter().find(|n| matches!(n.data, NodeType::ScheduleNode(_))) {
            if let NodeType::ScheduleNode(ref cfg) = schedule_node.data {
                use std::str::FromStr;
                let schedule = cron::Schedule::from_str(&cfg.cron_expression)?;
                schedule_opt = Some((schedule, cfg.cron_expression.clone()));
            }
        }

        // In watch mode, run once immediately, then re-run on events.
        let trigger_source = format!("file:{}", args.path.display());
        execute_and_print(&graph, config.clone(), &trigger_source, args.json).await?;

        if let Some(mut watcher) = watcher_opt {
            println!("\nWatching '{}' for changes (Ctrl+C to stop)...", watch_path_display);
            loop {
                match watcher.rx.recv().await {
                    Some(Ok(path)) => {
                        let trigger = format!("watch:{}", path.display());
                        println!("\n▶  File event: {}", path.display());
                        execute_and_print(&graph, config.clone(), &trigger, args.json).await?;
                    }
                    Some(Err(e)) => eprintln!("Watch error: {e}"),
                    None => break,
                }
            }
        } else if let Some((schedule, cron_expr)) = schedule_opt {
            println!("\nScheduled to run on cron: '{}' (Ctrl+C to stop)...", cron_expr);
            for datetime in schedule.upcoming(chrono::Utc) {
                let now = chrono::Utc::now();
                if let Ok(duration) = (datetime - now).to_std() {
                    println!("\n⏳ Next run scheduled at: {} (in {:?})", datetime, duration);
                    tokio::time::sleep(duration).await;
                    let trigger = format!("cron:{}", datetime);
                    println!("\n▶  Cron event triggered");
                    execute_and_print(&graph, config.clone(), &trigger, args.json).await?;
                }
            }
        } else {
            println!("\nWarning: --watch flag provided but no FileWatcherNode or ScheduleNode found in graph.");
        }
    } else {
        let trigger_source = format!("cli:{}", args.path.display());
        execute_and_print(&graph, config, &trigger_source, args.json).await?;
    }

    Ok(())
}

async fn execute_and_print(
    graph: &Graph,
    config: ExecutorConfig,
    trigger_source: &str,
    json_output: bool,
) -> Result<()> {
    let record = run_graph(graph, None, config, trigger_source, None, None).await?;

    if json_output {
        println!("{}", serde_json::to_string_pretty(&record)?);
        return Ok(());
    }

    // Pretty-print node results.
    let mut stdout = std::io::stdout();
    println!();
    println!("  Execution: {}", record.execution_id);
    println!();

    for node_rec in &record.nodes {
        let (icon, color) = match node_rec.status {
            NodeStatus::Success => ("âœ“", Color::Green),
            NodeStatus::Failed  => ("âœ—", Color::Red),
            NodeStatus::Skipped => ("â€“", Color::DarkGrey),
            NodeStatus::Running => ("âŸ³", Color::Yellow),
            NodeStatus::Pending => ("Â·", Color::DarkGrey),
        };

        let duration_str = node_rec
            .duration_ms
            .map(|d| format!(" ({:.1}s)", d as f64 / 1000.0))
            .unwrap_or_default();

        crossterm::execute!(stdout, SetForegroundColor(color)).ok();
        print!("  {} ", icon);
        crossterm::execute!(stdout, ResetColor).ok();
        print!("{:<20} {:>10}", node_rec.node_id, node_rec.node_type);
        println!("{}", duration_str);

        if let Some(ref preview) = node_rec.output_preview {
            let truncated = if preview.len() > 80 {
                format!("{}â€¦", &preview[..77])
            } else {
                preview.clone()
            };
            println!("      â†³ {}", truncated);
        }
        if let Some(ref err) = node_rec.error {
            crossterm::execute!(stdout, SetForegroundColor(Color::Red)).ok();
            println!("      âœ— {}", err);
            crossterm::execute!(stdout, ResetColor).ok();
        }
    }

    println!();
    let status_str = format!("{:?}", record.overall_status);
    let status_color = if status_str == "Success" { Color::Green } else { Color::Red };
    crossterm::execute!(stdout, SetForegroundColor(status_color)).ok();
    println!("  Status: {}", status_str);
    crossterm::execute!(stdout, ResetColor).ok();
    println!("  Log:    ~/.hybrid-hub/logs/{}.json", record.execution_id);
    println!();

    Ok(())
}

