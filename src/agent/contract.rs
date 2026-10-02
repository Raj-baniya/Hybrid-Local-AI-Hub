use crate::schema::Goal;

// We will mock this out for now until the LLM provider is fully wired in the runner
pub async fn plan_or_load_contract(
    task: Option<&str>,
    goal: Option<&Goal>,
    // llm: &dyn LlmProvider
) -> Result<Goal, String> {
    if let Some(g) = goal {
        return Ok(g.clone());
    }
    
    if let Some(t) = task {
        let cwd = std::env::current_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| ".".to_string());
        return Ok(Goal {
            task: t.to_string(),
            working_dir: cwd,
            limits: crate::schema::GoalLimits {
                max_steps: 15,
                timeout_secs: 600,
                patience: 6,
                max_false_claims: 2,
            },
            success_criteria: vec![
                crate::schema::GoalCriterion {
                    id: "c1".to_string(),
                    description: "The task has been completed and the result confirmed.".to_string(),
                    check: crate::schema::GoalCheck::LlmJudge {
                        question: "Has the agent successfully completed the task and shown its output?".to_string()
                    }
                }
            ],
        });
    }

    Err("No workflow goal and no task provided. Cannot start agent.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_agent_contract_fallback() {
        let res = plan_or_load_contract(Some("do something"), None).await.unwrap();
        assert_eq!(res.task, "do something");
        assert!(!res.success_criteria.is_empty());
    }
}
