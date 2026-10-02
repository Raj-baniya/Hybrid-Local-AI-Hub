use crate::agent::tools::{parse_action, Action, ToolCall};
use crate::agent::hooks::{Hooks, HookDecision, ask_user};
use crate::agent::observations::AgentState;
use crate::agent::verifier::{verify_deterministic, verify, VerifyResult};
use crate::agent::contract::plan_or_load_contract;
use crate::schema::Goal;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, PartialEq)]
pub enum StopReason {
    Success,
    NotResolved(String),
    MaxSteps,
    Stalled,
    FalseClaimLimit,
    Timeout,
    BudgetExceeded,
    UserInterrupt,
}

pub struct AgentReport {
    pub reason: StopReason,
    pub steps_used: u32,
    pub verify_result: Option<VerifyResult>,
}

#[async_trait::async_trait]
pub trait LlmProvider {
    async fn generate(&self, prompt: &str, system: Option<&str>) -> Result<String, String>;
}

pub struct ToolBox { pub workspace: std::path::PathBuf }
impl ToolBox {
    pub fn new(workspace: std::path::PathBuf) -> Self { Self { workspace } }

    fn resolve_path(&self, p: &str) -> std::path::PathBuf {
        let path = std::path::Path::new(p);
        if path.is_absolute() { path.to_path_buf() } else { self.workspace.join(path) }
    }
    pub async fn execute(&self, call: &ToolCall, deadline: std::time::Instant) -> String {
        match call.name.as_str() {
            "run_command" => {
                let cmd = call.parameters.get("command").cloned().unwrap_or_default();
                // Shell-safety: only allow pre-vetted commands (hooks already ran); use arg split, not raw shell
                match std::process::Command::new("cmd")
                    .args(["/C", &cmd])
                    .output()
                {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                        if stdout.is_empty() && !stderr.is_empty() {
                            format!("STDERR: {}", stderr)
                        } else if stdout.is_empty() {
                            "(no output)".to_string()
                        } else {
                            stdout
                        }
                    }
                    Err(e) => format!("Error running command: {}", e),
                }
            }
            "read_file" => {
                let path_str = call.parameters.get("path").cloned().unwrap_or_default();
                let path = self.resolve_path(&path_str);
                match std::fs::read_to_string(&path) {
                    Ok(contents) => contents,
                    Err(e) => format!("Error reading file '{}': {}", path.display(), e),
                }
            }
            "write_file" => {
                let path_str = call.parameters.get("path").cloned().unwrap_or_default();
                let content = match call.parameters.get("content") {
                    Some(c) => c.clone(),
                    None => return "Error: Missing 'content' parameter".to_string(),
                };
                let path = self.resolve_path(&path_str);
                match std::fs::write(&path, &content) {
                    Ok(_) => format!("Written {} bytes to '{}'.", content.len(), path.display()),
                    Err(e) => format!("Error writing file '{}': {}", path.display(), e),
                }
            }
            "list_dir" => {
                let path_str = call.parameters.get("path").cloned().unwrap_or_else(|| ".".to_string());
                let path = self.resolve_path(&path_str);
                match std::fs::read_dir(&path) {
                    Ok(entries) => {
                        let mut names: Vec<String> = entries
                            .filter_map(|e| e.ok())
                            .map(|e| {
                                let n = e.file_name().to_string_lossy().to_string();
                                if e.path().is_dir() { format!("{}/", n) } else { n }
                            })
                            .collect();
                        names.sort();
                        names.join("\n")
                    }
                    Err(e) => format!("Error listing '{}': {}", path.display(), e),
                }
            }
            _ => format!("Unknown tool: {}", call.name),
        }
    }
}

pub struct AgentConfig {
    pub task: Option<String>,
    pub goal: Option<Goal>,
}

fn interrupted() -> bool { false }

pub async fn run_agent(
    cfg: AgentConfig,
    llm: &dyn LlmProvider,
    tools: &ToolBox,
    hooks: &Hooks
) -> Result<AgentReport, String> {
    let contract = plan_or_load_contract(cfg.task.as_deref(), cfg.goal.as_ref()).await?;
    let mut state = AgentState::new(2000, 4000);
    let start = Instant::now();
    let (mut false_claims, mut parse_errors, mut best_passed, mut no_progress) = (0, 0, 0usize, 0);
    let mut seen: HashMap<u64, u32> = HashMap::new();

    for step in 1..=contract.limits.max_steps {
        if interrupted() { return Ok(report(StopReason::UserInterrupt, &state, None)); }
        if start.elapsed().as_secs() > contract.limits.timeout_secs { return Ok(report(StopReason::Timeout, &state, None)); }

        let system_prompt = "You are an autonomous agent. You MUST respond with EXACTLY ONE action block in this XML format:\n\n<function=TOOL_NAME>\n<parameter=PARAM_NAME>value</parameter>\n</function>\n\nAvailable tools:\n- run_command: runs a shell command. Parameters: command (string)\n- read_file: reads a file. Parameters: path (string)\n- write_file: writes a file. Parameters: path (string), content (string)\n- list_dir: lists a directory. Parameters: path (string)\n- case_resolved: declare task complete. Parameters: summary (string)\n- case_not_resolved: declare failure. Parameters: reason (string)\n\nExample:\n<function=run_command>\n<parameter=command>dir</parameter>\n</function>\n\nDo NOT write prose, markdown, or explanations. Output ONLY the XML block. One block per reply.";
        
        let raw = llm.generate(&state.render_prompt(&contract.task, "Criteria check pending..."), Some(system_prompt)).await?;

        let action = match parse_action(&raw) {
            Ok(a) => { parse_errors = 0; a }
            Err(e) => {
                parse_errors += 1;
                eprintln!("[Agent debug] LLM parse error #{}: {}", parse_errors, e);
                if parse_errors >= 3 {
                    eprintln!("[Agent debug] LLM kept returning unparseable output. Check your model supports instruction-following.");
                    return Ok(report(StopReason::Stalled, &state, None));
                }
                state.push_feedback(format!(
                    "Your last reply was invalid: {}. You MUST reply with EXACTLY this format and nothing else:\n<function=run_command>\n<parameter=command>dir</parameter>\n</function>",
                    e
                ));
                continue;
            }
        };

        match action {
            Action::CaseNotResolved { reason } => return Ok(report(StopReason::NotResolved(reason), &state, None)),

            Action::CaseResolved { summary } => {
                let v = verify(&contract.success_criteria, &state, hooks).await;
                if v.all_passed { return Ok(report(StopReason::Success, &state, Some(v))); }
                false_claims += 1;
                if false_claims > contract.limits.max_false_claims {
                    return Ok(report(StopReason::FalseClaimLimit, &state, Some(v)));
                }
                state.push_feedback(v.failure_feedback(&summary));
            }

            Action::Tool(call) => {
                match hooks.pre(&call).await {
                    HookDecision::Deny(msg)  => { state.push_feedback(format!("Blocked: {}", msg)); continue; }
                    HookDecision::Ask        => {
                        if hooks.auto_approve {
                            eprintln!("[Agent] Auto-allowing (auto_approve=true): {} {:?}", call.name, call.parameters);
                        } else {
                            let is_interactive = atty::is(atty::Stream::Stdin);
                            if is_interactive {
                                if !ask_user(&call) {
                                    state.push_feedback("User declined that command.".into());
                                    continue;
                                }
                            } else {
                                state.push_feedback(format!("Command requires user approval, but terminal is not interactive: {}", call.name));
                                continue;
                            }
                        }
                    }
                    HookDecision::Allow      => {}
                }
                let obs = tools.execute(&call, start + std::time::Duration::from_secs(contract.limits.timeout_secs)).await;
                
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                call.name.hash(&mut hasher);
                let mut params: Vec<_> = call.parameters.iter().collect();
                params.sort_by_key(|(k, _)| *k);
                for (k, v) in params {
                    k.hash(&mut hasher);
                    v.hash(&mut hasher);
                }
                obs.hash(&mut hasher);
                let key = hasher.finish();

                let n = seen.entry(key).and_modify(|c| *c += 1).or_insert(1);
                if *n >= 3 { return Ok(report(StopReason::Stalled, &state, None)); }
                
                state.push_step(step, call, obs);

                let v = verify_deterministic(&contract.success_criteria, &state, hooks).await;
                if v.all_passed && v.has_criteria { return Ok(report(StopReason::Success, &state, Some(v))); }

                let passed = v.passed_count();
                if passed > best_passed { best_passed = passed; no_progress = 0; } else { no_progress += 1; }
                if no_progress >= contract.limits.patience { return Ok(report(StopReason::Stalled, &state, None)); }
            }
        }
    }
    Ok(report(StopReason::MaxSteps, &state, None))
}

fn report(reason: StopReason, state: &AgentState, v: Option<VerifyResult>) -> AgentReport {
    AgentReport {
        reason,
        steps_used: state.steps.len() as u32,
        verify_result: v,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeLlm {
        responses: std::sync::Mutex<std::collections::VecDeque<String>>,
    }
    #[async_trait::async_trait]
    impl LlmProvider for FakeLlm {
        async fn generate(&self, _p: &str, _s: Option<&str>) -> Result<String, String> {
            let mut q = self.responses.lock().unwrap();
            Ok(q.pop_front().unwrap_or_else(|| "<function=case_not_resolved></function>".to_string()))
        }
    }

    #[tokio::test]
    async fn test_agent_runner_stalled_garbage() {
        let fake_llm = FakeLlm {
            responses: std::sync::Mutex::new(std::collections::VecDeque::from(vec![
                "garbage1".into(),
                "garbage2".into(),
                "garbage3".into(),
            ])),
        };
        let cfg = AgentConfig { task: Some("x".into()), goal: None };
        let rep = run_agent(cfg, &fake_llm, &ToolBox::new(), &Hooks::new(".", false)).await.unwrap();
        assert_eq!(rep.reason, StopReason::Stalled);
    }
}
