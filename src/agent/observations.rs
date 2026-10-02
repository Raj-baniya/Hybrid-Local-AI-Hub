use crate::agent::tools::ToolCall;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub step: u32,
    pub call: ToolCall,
    pub result: String,
    pub summary: Option<String>, // Used when compacted
}

pub fn truncate(obs: &str, limit: usize) -> String {
    if obs.len() <= limit {
        return obs.to_string();
    }
    let half = limit / 2;
    let mut head_idx = half;
    while head_idx > 0 && !obs.is_char_boundary(head_idx) { head_idx -= 1; }
    let mut tail_idx = obs.len() - half;
    while tail_idx < obs.len() && !obs.is_char_boundary(tail_idx) { tail_idx += 1; }
    let head = &obs[..head_idx];
    let tail = &obs[tail_idx..];
    format!("{}\n\n[... {} bytes omitted ...]\n\n{}", head, tail_idx - head_idx, tail)
}

pub struct AgentState {
    pub steps: VecDeque<Observation>,
    pub feedback: Vec<String>,
    pub obs_limit: usize,
    pub context_budget: usize,
}

impl AgentState {
    pub fn new(obs_limit: usize, context_budget: usize) -> Self {
        Self {
            steps: VecDeque::new(),
            feedback: Vec::new(),
            obs_limit,
            context_budget,
        }
    }

    pub fn push_step(&mut self, step: u32, call: ToolCall, obs: String) {
        self.steps.push_back(Observation {
            step,
            call,
            result: truncate(&obs, self.obs_limit),
            summary: None,
        });
        self.compact_if_needed();
    }

    pub fn push_feedback(&mut self, fb: String) {
        self.feedback.push(fb);
    }

    fn estimate_tokens(&self) -> usize {
        // Rough estimation: 1 token ~= 4 chars
        let mut chars = 0;
        for s in &self.steps {
            chars += format!("{:?}", s.call).len();
            if let Some(sum) = &s.summary {
                chars += sum.len();
            } else {
                chars += s.result.len();
            }
        }
        for f in &self.feedback {
            chars += f.len();
        }
        chars / 4
    }

    fn compact_if_needed(&mut self) {
        let threshold = (self.context_budget as f32 * 0.7) as usize;
        while self.estimate_tokens() > threshold && self.steps.len() > 3 {
            // Find the oldest uncompacted step, ignoring the last 3
            let limit_idx = self.steps.len().saturating_sub(3);
            let mut found = false;
            for i in 0..limit_idx {
                if self.steps[i].summary.is_none() {
                    let cmd_name = &self.steps[i].call.name;
                    self.steps[i].summary = Some(format!("Executed {}, output truncated to save context.", cmd_name));
                    self.steps[i].result.clear();
                    found = true;
                    break;
                }
            }
            if !found {
                break; // all non-recent steps are already compacted
            }
        }
    }

    pub fn render_prompt(&self, goal: &str, criteria: &str) -> String {
        let mut prompt = String::new();
        prompt.push_str("GOAL:\n");
        prompt.push_str(goal);
        prompt.push_str("\n\nCRITERIA:\n");
        prompt.push_str(criteria);
        prompt.push_str("\n\nHISTORY:\n");
        for step in &self.steps {
            prompt.push_str(&format!("Step {}: {:?}\n", step.step, step.call));
            if let Some(sum) = &step.summary {
                prompt.push_str(&format!("Result: {}\n", sum));
            } else {
                prompt.push_str(&format!("Result: {}\n", step.result));
            }
        }
        if !self.feedback.is_empty() {
            prompt.push_str("\nFEEDBACK:\n");
            for f in &self.feedback {
                prompt.push_str(&format!("- {}\n", f));
            }
        }
        prompt
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_agent_observations_truncate() {
        let long_obs = "A".repeat(3000);
        let trunc = truncate(&long_obs, 2000);
        assert!(trunc.contains("[... 1000 chars omitted ...]"));
        assert!(trunc.starts_with(&"A".repeat(1000)));
        assert!(trunc.ends_with(&"A".repeat(1000)));
    }

    #[test]
    fn test_agent_observations_compaction() {
        // very small context budget
        let mut state = AgentState::new(2000, 100); 
        for i in 1..=5 {
            let mut p = HashMap::new();
            p.insert("cmd".to_string(), "ls".to_string());
            let call = ToolCall { name: "run_command".to_string(), parameters: p };
            // push large result to trigger compaction
            state.push_step(i, call, "X".repeat(500));
        }

        // first 2 should be compacted, last 3 untouched
        assert!(state.steps[0].summary.is_some());
        assert!(state.steps[1].summary.is_some());
        assert!(state.steps[2].summary.is_none());
        assert!(state.steps[3].summary.is_none());
        assert!(state.steps[4].summary.is_none());
    }
}
