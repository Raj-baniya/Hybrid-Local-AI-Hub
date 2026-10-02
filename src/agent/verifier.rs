use crate::schema::{GoalCriterion, GoalCheck};
use crate::agent::observations::AgentState;
use crate::agent::hooks::{Hooks, HookDecision};
use crate::agent::tools::ToolCall;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;

pub struct CriterionResult {
    pub id: String,
    pub passed: bool,
    pub detail: String,
}

pub struct VerifyResult {
    pub all_passed: bool,
    pub has_criteria: bool,
    pub results: Vec<CriterionResult>,
}

impl VerifyResult {
    pub fn passed_count(&self) -> usize {
        self.results.iter().filter(|r| r.passed).count()
    }
    
    pub fn failure_feedback(&self, claim_summary: &str) -> String {
        let mut fb = format!("You claimed success: '{}', but the following criteria failed:\n", claim_summary);
        for r in &self.results {
            if !r.passed {
                fb.push_str(&format!("- [{}]: {}\n", r.id, r.detail));
            }
        }
        fb
    }
}

pub async fn verify_deterministic(
    criteria: &[GoalCriterion],
    state: &AgentState,
    hooks: &Hooks,
) -> VerifyResult {
    let mut results = Vec::new();
    let mut all_passed = true;
    let has_criteria = !criteria.is_empty();

    for c in criteria {
        match &c.check {
            GoalCheck::FileExists { path } => {
                let p = Path::new(path);
                if p.exists() && p.is_file() {
                    results.push(CriterionResult { id: c.id.clone(), passed: true, detail: "File exists.".into() });
                } else {
                    all_passed = false;
                    results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "File does not exist or is not a file.".into() });
                }
            }
            GoalCheck::DirExists { path } => {
                let p = Path::new(path);
                if p.exists() && p.is_dir() {
                    results.push(CriterionResult { id: c.id.clone(), passed: true, detail: "Directory exists.".into() });
                } else {
                    all_passed = false;
                    results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "Directory does not exist.".into() });
                }
            }
            GoalCheck::FileContains { path, text, regex } => {
                let p = Path::new(path);
                if p.exists() && p.is_file() {
                    if let Ok(content) = tokio::fs::read_to_string(p).await {
                        let mut passed = false;
                        if let Some(t) = text {
                            if content.contains(t) { passed = true; }
                        }
                        if let Some(r) = regex {
                            // simplistic regex check using regex crate
                            if let Ok(re) = regex::Regex::new(r) {
                                if re.is_match(&content) { passed = true; }
                            }
                        }
                        if passed {
                            results.push(CriterionResult { id: c.id.clone(), passed: true, detail: "File contains required content.".into() });
                        } else {
                            all_passed = false;
                            results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "File does not contain required content.".into() });
                        }
                    } else {
                        all_passed = false;
                        results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "File could not be read (maybe binary).".into() });
                    }
                } else {
                    all_passed = false;
                    results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "File does not exist.".into() });
                }
            }
            GoalCheck::CommandExitZero { command } => {
                let mut params = HashMap::new();
                params.insert("command".to_string(), command.clone());
                let tc = ToolCall { name: "run_command".to_string(), parameters: params };
                
                let decision = hooks.pre(&tc).await;
                if matches!(decision, HookDecision::Ask) && !hooks.auto_approve {
                    all_passed = false;
                    results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "Command requires approval.".into() });
                    continue;
                }
                if matches!(decision, HookDecision::Deny(_)) {
                    all_passed = false;
                    results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "Command denied by safety hooks.".into() });
                    continue;
                }
                // Mock execution for verify since we're writing a system component
                // We'd use a robust timeout wrapper here.
                let mut is_ok = false;
                #[cfg(target_os = "windows")]
                {
                    if let Ok(mut child) = tokio::process::Command::new("cmd")
                        .args(&["/C", command])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .kill_on_drop(true)
                        .spawn()
                    {
                        if let Ok(Ok(status)) = tokio::time::timeout(std::time::Duration::from_secs(10), child.wait()).await {
                            is_ok = status.success();
                        }
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    if let Ok(mut child) = tokio::process::Command::new("sh")
                        .args(&["-c", command])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .kill_on_drop(true)
                        .spawn()
                    {
                        if let Ok(Ok(status)) = tokio::time::timeout(std::time::Duration::from_secs(10), child.wait()).await {
                            is_ok = status.success();
                        }
                    }
                }
                
                if is_ok {
                    results.push(CriterionResult { id: c.id.clone(), passed: true, detail: "Command exited with 0.".into() });
                } else {
                    all_passed = false;
                    results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "Command failed (non-zero exit or timeout).".into() });
                }
            }
            GoalCheck::OutputContains { text } => {
                // Check if last output in state contains text
                if let Some(last) = state.steps.back() {
                    if last.result.contains(text) {
                        results.push(CriterionResult { id: c.id.clone(), passed: true, detail: "Output contains text.".into() });
                    } else {
                        all_passed = false;
                        results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "Last output did not contain text.".into() });
                    }
                } else {
                    all_passed = false;
                    results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "No history to check output against.".into() });
                }
            }
            GoalCheck::LlmJudge { .. } => {
                // LLM judge is skipped in deterministic pass
                all_passed = false; // it is not passed deterministically
                results.push(CriterionResult { id: c.id.clone(), passed: false, detail: "Skipped in deterministic check.".into() });
            }
        }
    }

    VerifyResult { all_passed, has_criteria, results }
}

pub async fn verify(
    criteria: &[GoalCriterion],
    state: &AgentState,
    hooks: &Hooks,
    // llm: &dyn LlmProvider would go here
) -> VerifyResult {
    // For now we just run deterministic
    verify_deterministic(criteria, state, hooks).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_agent_verifier_file_exists() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.txt");
        fs::write(&file_path, "hello").unwrap();

        let criteria = vec![GoalCriterion {
            id: "1".into(),
            description: "test".into(),
            check: GoalCheck::FileExists { path: file_path.to_string_lossy().to_string() }
        }];

        let state = AgentState::new(100, 100);
        let hooks = Hooks::new(".", false);

        let res = verify_deterministic(&criteria, &state, &hooks).await;
        assert!(res.all_passed);
    }
}
