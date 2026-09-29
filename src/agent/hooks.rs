use crate::agent::tools::ToolCall;
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq)]
pub enum HookDecision {
    Allow,
    Ask,
    Deny(String),
}

pub struct Hooks {
    pub auto_approve: bool,
    pub working_dir: PathBuf,
}

impl Hooks {
    pub fn new(working_dir: &str, auto_approve: bool) -> Self {
        Self {
            working_dir: PathBuf::from(working_dir).canonicalize().unwrap_or_else(|_| PathBuf::from(working_dir)),
            auto_approve,
        }
    }

    pub async fn pre(&self, call: &ToolCall) -> HookDecision {
        match call.name.as_str() {
            "run_command" => {
                let cmd = call.parameters.get("command").cloned().unwrap_or_default();
                let lower_cmd = cmd.to_lowercase();
                
                // 1. Deny patterns
                if lower_cmd.contains("rm -rf /") || lower_cmd.contains("del /s /q c:\\") 
                    || lower_cmd.contains("format ") || lower_cmd.contains("diskpart")
                    || lower_cmd.contains("reg add") || lower_cmd.contains("reg delete")
                    || (lower_cmd.contains("curl") && lower_cmd.contains("|") && (lower_cmd.contains("sh") || lower_cmd.contains("bash")))
                    || (lower_cmd.contains("wget") && lower_cmd.contains("|") && (lower_cmd.contains("sh") || lower_cmd.contains("bash")))
                {
                    return HookDecision::Deny("Blocked dangerous pattern detected.".to_string());
                }

                // Try to detect writes outside working_dir in command? This is hard to do robustly with shell commands,
                // but we will do our best or just Ask for commands.
                // For 'run_command', any rm, del, mv, move, cp, copy, apt-get, choco, install is Ask.
                if lower_cmd.contains("rm ") || lower_cmd.contains("del ") 
                    || lower_cmd.contains("mv ") || lower_cmd.contains("move ") 
                    || lower_cmd.contains("cp ") || lower_cmd.contains("copy ")
                    || lower_cmd.contains("install ") || lower_cmd.contains("apt-get ") 
                    || lower_cmd.contains("npm i") || lower_cmd.contains("pip install")
                    || lower_cmd.contains(">") || lower_cmd.contains(">>")
                {
                    return HookDecision::Ask;
                }

                HookDecision::Allow
            }
            "write_file" => {
                let path_str = call.parameters.get("path").cloned().unwrap_or_default();
                if self.is_outside_working_dir(&path_str) {
                    return HookDecision::Deny(format!("Writing outside working_dir is blocked: {}", path_str));
                }
                HookDecision::Ask
            }
            "read_file" | "list_dir" => {
                let path_str = call.parameters.get("path").cloned().unwrap_or_default();
                if self.is_outside_working_dir(&path_str) {
                    return HookDecision::Deny(format!("Reading outside working_dir is blocked: {}", path_str));
                }
                HookDecision::Allow
            }
            "run_graph" => {
                HookDecision::Ask
            }
            _ => HookDecision::Allow,
        }
    }

    fn is_outside_working_dir(&self, target_path: &str) -> bool {
        let path = Path::new(target_path);
        
        // If it's absolute, check if it starts with working_dir
        if path.is_absolute() {
            !path.starts_with(&self.working_dir)
        } else {
            // It's relative, assume it's relative to working_dir, so it's inside unless it contains '..'
            // Note: A full canonicalize would be better but target might not exist yet.
            path.components().any(|c| matches!(c, std::path::Component::ParentDir))
        }
    }
}

pub fn ask_user(call: &ToolCall) -> bool {
    // In a real CLI, this would prompt standard input.
    // We will implement this for the CLI runner later.
    // For tests, we mock it or default to false.
    println!("DANGEROUS ACTION DETECTED: {:?}", call);
    println!("Do you want to allow this? (y/N)");
    // default false for now unless overridden in tests
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_cmd(cmd: &str) -> ToolCall {
        let mut p = HashMap::new();
        p.insert("command".to_string(), cmd.to_string());
        ToolCall { name: "run_command".to_string(), parameters: p }
    }

    fn make_write(path: &str) -> ToolCall {
        let mut p = HashMap::new();
        p.insert("path".to_string(), path.to_string());
        ToolCall { name: "write_file".to_string(), parameters: p }
    }

    #[tokio::test]
    async fn test_agent_hooks_rm_rf_root() {
        let hooks = Hooks::new(".", false);
        let decision = hooks.pre(&make_cmd("rm -rf /")).await;
        assert!(matches!(decision, HookDecision::Deny(_)));
    }

    #[tokio::test]
    async fn test_agent_hooks_del_c() {
        let hooks = Hooks::new(".", false);
        let decision = hooks.pre(&make_cmd("del /s /q c:\\")).await;
        assert!(matches!(decision, HookDecision::Deny(_)));
    }

    #[tokio::test]
    async fn test_agent_hooks_write_outside() {
        let hooks = Hooks::new("/home/user/workspace", false);
        let decision = hooks.pre(&make_write("/etc/passwd")).await;
        assert!(matches!(decision, HookDecision::Deny(_)));
    }

    #[tokio::test]
    async fn test_agent_hooks_normal_dir() {
        let hooks = Hooks::new(".", false);
        let decision = hooks.pre(&make_cmd("dir")).await;
        assert_eq!(decision, HookDecision::Allow);
    }

    #[tokio::test]
    async fn test_agent_hooks_file_move() {
        let hooks = Hooks::new(".", false);
        let decision = hooks.pre(&make_cmd("mv a.txt b.txt")).await;
        assert_eq!(decision, HookDecision::Ask);
    }
}
