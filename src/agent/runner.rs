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

pub struct ToolBox;
impl ToolBox {
    pub fn new() -> Self { Self }
    pub async fn execute(&self, call: &ToolCall) -> String {
        // Mock execute, in reality this would actually dispatch to filesystem/os/docker wrappers
        format!("Mock executed: {:?}", call)
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

        let system_prompt = "Take one action per reply. When you believe every criterion is met, call `case_resolved`. If you cannot make progress, call `case_not_resolved` with the reason. Do not repeat an action that already gave the same result.";
        
        let raw = llm.generate(&state.render_prompt(&contract.task, "Criteria check pending..."), Some(system_prompt)).await?;

        let action = match parse_action(&raw) {
            Ok(a) => { parse_errors = 0; a }
            Err(e) => {
                parse_errors += 1;
                if parse_errors >= 3 { return Ok(report(StopReason::Stalled, &state, None)); }
                state.push_feedback(format!("Your last reply was invalid: {}. Reply with exactly one <function=...> block.", e));
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
                    HookDecision::Ask        => if !ask_user(&call) { state.push_feedback("User declined that command.".into()); continue; },
                    HookDecision::Allow      => {}
                }
                let obs = tools.execute(&call).await;
                
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                call.name.hash(&mut hasher);
                for (k, v) in &call.parameters {
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
