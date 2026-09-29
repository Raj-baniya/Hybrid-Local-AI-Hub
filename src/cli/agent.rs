use clap::Args;
use std::path::PathBuf;
use hybrid_local_ai_hub::agent::runner::{run_agent, AgentConfig, LlmProvider, ToolBox};
use hybrid_local_ai_hub::agent::hooks::Hooks;
use hybrid_local_ai_hub::schema::Goal;

#[derive(Args, Debug)]
pub struct AgentArgs {
    /// Path to a workflow JSON file
    pub workflow: Option<PathBuf>,

    /// Direct task string to run
    #[arg(long)]
    pub task: Option<String>,

    /// Auto-approve dangerous commands (Ask -> Allow)
    #[arg(long)]
    pub yes: bool,

    /// Max steps before stopping
    #[arg(long, default_value_t = 15)]
    pub max_steps: u32,

    /// Timeout in seconds
    #[arg(long, default_value_t = 600)]
    pub timeout: u64,

    /// Output JSON report at the end
    #[arg(long)]
    pub json: bool,
}

// Dummy LlmProvider for CLI
struct CliLlm;
#[async_trait::async_trait]
impl LlmProvider for CliLlm {
    async fn generate(&self, _prompt: &str, _system: Option<&str>) -> Result<String, String> {
        // Here we would wire it up to `ollama::generate` or the cloud providers.
        // Returning a mock response for now to get it compiling.
        Ok("<function=case_not_resolved><parameter=reason>LLM not fully wired in CLI yet.</parameter></function>".to_string())
    }
}

pub async fn run(args: AgentArgs) {
    println!("Starting Goal-Driven Terminal Agent...");
    
    let mut goal: Option<Goal> = None;
    if let Some(wf_path) = args.workflow {
        if let Ok(content) = std::fs::read_to_string(&wf_path) {
            if let Ok(graph) = serde_json::from_str::<hybrid_local_ai_hub::schema::Graph>(&content) {
                goal = graph.goal;
            }
        }
    }

    let cfg = AgentConfig {
        task: args.task.clone(),
        goal,
    };

    let llm = CliLlm;
    let tools = ToolBox::new();
    let hooks = Hooks::new(".", args.yes);

    match run_agent(cfg, &llm, &tools, &hooks).await {
        Ok(report) => {
            println!("\n=== AGENT REPORT ===");
            println!("Stop Reason: {:?}", report.reason);
            println!("Steps Used: {}", report.steps_used);
            if let Some(v) = report.verify_result {
                println!("Verification: {}/{} passed", v.passed_count(), v.results.len());
            }
            std::process::exit(match report.reason {
                hybrid_local_ai_hub::agent::runner::StopReason::Success => 0,
                hybrid_local_ai_hub::agent::runner::StopReason::UserInterrupt => 130,
                _ => 2,
            });
        }
        Err(e) => {
            eprintln!("Agent failed to start: {}", e);
            std::process::exit(1);
        }
    }
}
