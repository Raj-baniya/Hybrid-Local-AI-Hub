use std::collections::HashMap;
use serde::{Serialize, Deserialize};

#[derive(Debug, PartialEq)]
pub enum Action {
    Tool(ToolCall),
    CaseResolved { summary: String },
    CaseNotResolved { reason: String },
}

#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub parameters: HashMap<String, String>,
}

/// Parses a model response like:
/// <function=run_command>
/// <parameter=command>dir C:\Users\me\inbox</parameter>
/// </function>
pub fn parse_action(raw: &str) -> Result<Action, String> {
    let func_start = match raw.find("<function=") {
        Some(i) => i,
        None => return Err("No <function=...> block found.".to_string()),
    };

    let post_start = &raw[func_start + 10..];
    let end_bracket = match post_start.find('>') {
        Some(i) => i,
        None => return Err("Malformed <function=...>: missing closing '>'.".to_string()),
    };

    let function_name = post_start[..end_bracket].trim().to_string();

    let func_end = match post_start.find("</function>") {
        Some(i) => i,
        None => return Err("Missing </function> tag.".to_string()),
    };

    if func_end < end_bracket + 1 { return Err("Malformed function block".into()); }
    let inner = &post_start[end_bracket + 1..func_end];

    // Check if there are multiple <function= blocks
    let remainder = &post_start[func_end + 11..];
    if remainder.find("<function=").is_some() {
        // Just take the first one! Smaller LLMs repeat themselves.
        return Err("Multiple <function=...> blocks found. Reply with exactly one action.".to_string());
    }

    let mut parameters = HashMap::new();
    let mut param_search = inner;
    while let Some(p_start) = param_search.find("<parameter=") {
        let p_post = &param_search[p_start + 11..];
        let p_bracket = match p_post.find('>') {
            Some(i) => i,
            None => return Err("Malformed <parameter=...>: missing closing '>'.".to_string()),
        };
        let param_name = p_post[..p_bracket].trim().to_string();
        let param_inner = &p_post[p_bracket + 1..];
        
        let p_end = match param_inner.find("</parameter>") {
            Some(i) => i,
            None => return Err(format!("Missing </parameter> tag for parameter '{}'.", param_name)),
        };
        let param_val = param_inner[..p_end].trim().to_string();
        parameters.insert(param_name, param_val);
        
        param_search = &param_inner[p_end + 12..];
    }

    match function_name.as_str() {
        "case_resolved" => {
            let summary = parameters.get("summary").cloned().unwrap_or_default();
            Ok(Action::CaseResolved { summary })
        }
        "case_not_resolved" => {
            let reason = parameters.get("reason").cloned().unwrap_or_default();
            Ok(Action::CaseNotResolved { reason })
        }
        "run_command" | "read_file" | "write_file" | "list_dir" | "run_graph" => {
            Ok(Action::Tool(ToolCall { name: function_name, parameters }))
        }
        _ => Err(format!("Unknown function '{}'. Allowed functions: run_command, read_file, write_file, list_dir, run_graph, case_resolved, case_not_resolved.", function_name)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_parser_valid_tool() {
        let raw = "<function=run_command>\n<parameter=command>ls -la</parameter>\n</function>";
        let action = parse_action(raw).unwrap();
        if let Action::Tool(t) = action {
            assert_eq!(t.name, "run_command");
            assert_eq!(t.parameters.get("command").unwrap(), "ls -la");
        } else {
            panic!("Expected ToolCall");
        }
    }

    #[test]
    fn test_agent_parser_prose() {
        let raw = "Here is my plan.\n```\n<function=read_file>\n<parameter=path>test.txt</parameter>\n</function>\n```\nDone.";
        let action = parse_action(raw).unwrap();
        if let Action::Tool(t) = action {
            assert_eq!(t.name, "read_file");
            assert_eq!(t.parameters.get("path").unwrap(), "test.txt");
        } else {
            panic!("Expected ToolCall");
        }
    }

    #[test]
    fn test_agent_parser_two_actions() {
        let raw = "<function=read_file></function><function=list_dir></function>";
        let err = parse_action(raw).unwrap_err();
        assert!(err.contains("Multiple"));
    }

    #[test]
    fn test_agent_parser_unknown_tool() {
        let raw = "<function=delete_internet></function>";
        let err = parse_action(raw).unwrap_err();
        assert!(err.contains("Unknown function"));
    }

    #[test]
    fn test_agent_parser_missing_parameter() {
        let raw = "<function=run_command><parameter=cmd>test</function>";
        let err = parse_action(raw).unwrap_err();
        assert!(err.contains("Missing </parameter> tag"));
    }

    #[test]
    fn test_agent_parser_empty() {
        let err = parse_action("").unwrap_err();
        assert!(err.contains("No <function=...> block found."));
    }

    #[test]
    fn test_agent_parser_resolved() {
        let raw = "<function=case_resolved>\n<parameter=summary>All done.</parameter>\n</function>";
        let action = parse_action(raw).unwrap();
        if let Action::CaseResolved { summary } = action {
            assert_eq!(summary, "All done.");
        } else {
            panic!("Expected CaseResolved");
        }
    }
}
