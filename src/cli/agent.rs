use clap::Args;
use std::path::PathBuf;
use hybrid_local_ai_hub::agent::runner::{run_agent, AgentConfig, LlmProvider, ToolBox};
use hybrid_local_ai_hub::agent::hooks::Hooks;
use hybrid_local_ai_hub::schema::Goal;
use hybrid_local_ai_hub::ollama::OllamaClient;

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

    /// Ollama base URL
    #[arg(long, default_value = "http://localhost:11434")]
    pub ollama_url: String,

    /// Ollama model to use
    #[arg(long, default_value = "llama3.2")]
    pub model: String,
}

// CLI LlmProvider wired to Ollama
struct CliLlm {
    client: OllamaClient,
    model: String,
}
#[async_trait::async_trait]
impl LlmProvider for CliLlm {
    async fn generate(&self, prompt: &str, system: Option<&str>) -> Result<String, String> {
        // Use /api/chat for proper system prompt support (much better than /api/generate)
        let sys = system.unwrap_or("You are a helpful agent.");
        self.client.chat(&self.model, sys, prompt).await.map_err(|e| e.to_string())
    }
}

/// Check the prompt for obvious impossibility and return an error message if found.
fn validate_task(task: &str) -> Option<String> {
    let t = task.trim().to_lowercase();

    if t.is_empty() {
        return Some("Task is empty. Please provide a goal, e.g. --task \"List the files in my current directory\"".into());
    }
    if t.len() < 5 {
        return Some(format!(
            "Task \"{}\" is too short to be meaningful. Please be more specific.",
            task.trim()
        ));
    }
    // Detect system-destructive instructions
    let dangerous = ["delete everything", "format c:", "rm -rf /", "wipe disk", "drop database", "delete all files"];
    for d in dangerous {
        if t.contains(d) {
            return Some(format!(
                "Task contains a dangerous destructive pattern (\"{d}\"). This agent will not execute it.\nIf you really need this, use the --yes flag with extreme caution and rewrite the task more specifically."
            ));
        }
    }
    // Detect requests for impossible things (network without network node, etc.)
    let impossible = ["hack", "crack password", "bypass auth", "jailbreak", "root the server"];
    for imp in impossible {
        if t.contains(imp) {
            return Some(format!(
                "Task \"{imp}\" is not something this agent can or will do."
            ));
        }
    }
    None
}

/// Expand a vague task into a richer, more actionable goal description.
fn enhance_task(task: &str) -> String {
    let t = task.trim();
    // Add working directory context if task mentions "current directory" or "here"
    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| ".".to_string());

    let mut enhanced = t.to_string();

    // Inject cwd if the task refers to it vaguely
    if t.to_lowercase().contains("current directory") || t.to_lowercase().contains("this folder") || t.to_lowercase().contains("here") {
        enhanced = enhanced.replace("current directory", &format!("current directory ({})", cwd));
        enhanced = enhanced.replace("this folder", &format!("this folder ({})", cwd));
    }

    // If the task is very short (one action), add what a successful result looks like
    let word_count = t.split_whitespace().count();
    if word_count <= 6 {
        enhanced = format!(
            "{} — provide a clear, complete output. After running the command, confirm what you found and call case_resolved with a summary.",
            enhanced
        );
    }

    enhanced
}

pub async fn run(args: AgentArgs) {
    // ── Step 1: validate task before doing anything ──────────────────────────
    if let Some(task) = &args.task {
        if let Some(err_msg) = validate_task(task) {
            eprintln!("\n[Agent] Cannot run task: {}", err_msg);
            std::process::exit(1);
        }
    }
    if args.task.is_none() && args.workflow.is_none() {
        eprintln!("\n[Agent] Error: You must provide either --task \"your goal here\" or a workflow JSON file.");
        eprintln!("Example: hybrid-hub agent --task \"List the files in my current directory\"");
        std::process::exit(1);
    }

    // ── Step 2: enhance the task prompt ─────────────────────────────────────
    let enhanced_task = args.task.as_deref().map(enhance_task);
    if let Some(orig) = &args.task {
        if let Some(enh) = &enhanced_task {
            if enh != orig {
                println!("[Agent] Enhanced task: {}", enh);
            }
        }
    }

    println!("Starting Goal-Driven Terminal Agent...");

    // ── Step 3: check Ollama is reachable before spending time compiling ─────
    let ollama = OllamaClient::new(&args.ollama_url);
    if !ollama.is_reachable().await {
        eprintln!(
            "\n[Agent] Error: Ollama is not reachable at '{}'.\nMake sure Ollama is running: ollama serve\nOr specify a different URL with: --ollama-url http://your-host:11434",
            args.ollama_url
        );
        std::process::exit(1);
    }

    let mut goal: Option<Goal> = None;
    let mut working_dir = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| ".".to_string());

    if let Some(wf_path) = args.workflow {
        match std::fs::read_to_string(&wf_path) {
            Ok(content) => match serde_json::from_str::<hybrid_local_ai_hub::schema::Graph>(&content) {
                Ok(graph) => {
                    goal = graph.goal;
                }
                Err(e) => {
                    eprintln!("[Agent] Failed to parse workflow file: {}", e);
                    eprintln!("Make sure the JSON file is a valid workflow graph.");
                    std::process::exit(1);
                }
            },
            Err(e) => {
                eprintln!("[Agent] Failed to read workflow file: {}", e);
                std::process::exit(1);
            }
        }
    }

    let mut contract = hybrid_local_ai_hub::agent::contract::plan_or_load_contract(enhanced_task.or(args.task.clone()).as_deref(), goal.as_ref()).await.unwrap();
    contract.limits.max_steps = args.max_steps;
    contract.limits.timeout_secs = args.timeout;
    working_dir = contract.working_dir.clone();

    let cfg = AgentConfig {
        task: None,
        goal: Some(contract),
    };

    let llm = CliLlm {
        client: OllamaClient::new(&args.ollama_url),
        model: args.model.clone(),
    };
    let tools = ToolBox::new(std::path::PathBuf::from(&working_dir));
    let hooks = Hooks::new(&working_dir, args.yes);

    match run_agent(cfg, &llm, &tools, &hooks).await {
        Ok(report) => {
            println!("\n=== AGENT REPORT ===");
            let reason_str = match &report.reason {
                hybrid_local_ai_hub::agent::runner::StopReason::Success         => "✅ Success".to_string(),
                hybrid_local_ai_hub::agent::runner::StopReason::NotResolved(r)  => format!("❌ Not Resolved: {}", r),
                hybrid_local_ai_hub::agent::runner::StopReason::MaxSteps        => format!("⏹  Max steps ({}) reached", args.max_steps),
                hybrid_local_ai_hub::agent::runner::StopReason::Stalled         => "⚠️  Stalled: agent made no progress (LLM may not support this format — try a different model with --model)".to_string(),
                hybrid_local_ai_hub::agent::runner::StopReason::FalseClaimLimit => "⚠️  False claim limit reached: agent kept claiming success without evidence".to_string(),
                hybrid_local_ai_hub::agent::runner::StopReason::Timeout         => format!("⏱  Timed out after {}s", args.timeout),
                hybrid_local_ai_hub::agent::runner::StopReason::BudgetExceeded  => "💸 Budget exceeded".to_string(),
                hybrid_local_ai_hub::agent::runner::StopReason::UserInterrupt   => "🛑 Interrupted by user".to_string(),
            };
            println!("Stop Reason: {}", reason_str);
            println!("Steps Used:  {}", report.steps_used);
            if let Some(v) = report.verify_result {
                println!("Verification: {}/{} criteria passed", v.passed_count(), v.results.len());
            }
            let exit_code = match report.reason {
                hybrid_local_ai_hub::agent::runner::StopReason::Success       => 0,
                hybrid_local_ai_hub::agent::runner::StopReason::UserInterrupt => 130,
                _                                                               => 2,
            };
            std::process::exit(exit_code);
        }
        Err(e) => {
            eprintln!("\n[Agent] Failed to start: {}", e);
            if e.contains("No workflow goal and no task") {
                eprintln!("Hint: Use --task \"your goal\" to specify what you want the agent to do.");
            }
            std::process::exit(1);
        }
    }
}
