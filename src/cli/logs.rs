use anyhow::Result;
use clap::Args;
use crossterm::style::{Color, ResetColor, SetForegroundColor};
use hybrid_local_ai_hub::execution_record::{ExecutionRecord, NodeStatus};

#[derive(Args, Debug)]
pub struct LogsArgs {
    /// Execution ID to display (from the ID printed after `hybrid-hub run`).
    pub execution_id: String,

    /// Output as JSON.
    #[arg(long)]
    pub json: bool,
}

pub async fn logs(args: LogsArgs) -> Result<()> {
    let record = ExecutionRecord::load(&args.execution_id).await.map_err(|e| {
        anyhow::anyhow!(
            "Cannot load execution log '{}'. Is that a valid execution ID? Error: {e}",
            args.execution_id
        )
    })?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&record)?);
        return Ok(());
    }

    let mut stdout = std::io::stdout();

    println!();
    println!("  Execution ID:  {}", record.execution_id);
    println!("  Trigger:       {}", record.trigger_source);
    println!("  Started:       {}", record.started_at.format("%Y-%m-%d %H:%M:%S UTC"));
    if let Some(finished) = record.finished_at {
        let duration_secs = (finished - record.started_at).num_milliseconds() as f64 / 1000.0;
        println!("  Finished:      {} ({:.1}s total)", finished.format("%Y-%m-%d %H:%M:%S UTC"), duration_secs);
    }

    let status_color = match format!("{:?}", record.overall_status).as_str() {
        "Success" => Color::Green,
        _ => Color::Red,
    };
    crossterm::execute!(stdout, SetForegroundColor(status_color)).ok();
    println!("  Status:        {:?}", record.overall_status);
    crossterm::execute!(stdout, ResetColor).ok();

    println!();
    println!("  ─── Node Results ────────────────────────────────────────────");
    println!();

    for node in &record.nodes {
        let (icon, color) = match node.status {
            NodeStatus::Success => ("✓", Color::Green),
            NodeStatus::Failed  => ("✗", Color::Red),
            NodeStatus::Skipped => ("–", Color::DarkGrey),
            NodeStatus::Running => ("⟳", Color::Yellow),
            NodeStatus::Pending => ("·", Color::DarkGrey),
        };

        let duration_str = node
            .duration_ms
            .map(|d| format!("{:.1}s", d as f64 / 1000.0))
            .unwrap_or_else(|| "—".to_string());

        crossterm::execute!(stdout, SetForegroundColor(color)).ok();
        print!("  {} ", icon);
        crossterm::execute!(stdout, ResetColor).ok();
        println!("{:<25} {:<25} {}", node.node_id, node.node_type, duration_str);

        if let Some(ref preview) = node.output_preview {
            let truncated = if preview.len() > 120 {
                format!("{}…", &preview[..117])
            } else {
                preview.clone()
            };
            println!("      Output: {}", truncated);
        }

        if let Some(ref err) = node.error {
            crossterm::execute!(stdout, SetForegroundColor(Color::Red)).ok();
            println!("      Error:  {}", err);
            crossterm::execute!(stdout, ResetColor).ok();
        }
    }

    println!();
    println!("  Full log: ~/.hybrid-hub/logs/{}.json", record.execution_id);
    println!();

    Ok(())
}
