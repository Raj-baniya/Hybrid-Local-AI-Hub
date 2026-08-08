/// agent_runner.rs
/// Multi-agent orchestration engine for Hybrid Local AI Hub.
/// Implements the multi-agent orchestration protocol: agent handoffs, XML tool-calling,
/// self-play retry loops, and multi-round agent trajectories — all 100% offline via local Ollama LLMs.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

use crate::ollama;
use crate::python_sandbox;

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

/// An agent handoff transfer call, e.g. transfer_to_coding_agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHandoff {
    pub from_agent: String,
    pub to_agent: String,
    pub task: String,
}

/// A single step in the agent trajectory log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrajectoryStep {
    pub agent_name: String,
    pub step_index: usize,
    pub action: String,           // "thinking" | "tool_call" | "handoff" | "result" | "self_play_retry"
    pub content: String,
    pub tool_name: Option<String>,
    pub tool_result: Option<String>,
}

/// Emitted to frontend for live trajectory updates.
#[derive(Debug, Clone, Serialize)]
pub struct AgentTrajectoryEvent {
    pub step: TrajectoryStep,
    pub is_final: bool,
}

/// The result of a completed multi-agent run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunResult {
    pub success: bool,
    pub final_answer: String,
    pub trajectory: Vec<TrajectoryStep>,
    pub error: Option<String>,
}

/// Workflow execution modes (from the Workflow Editor).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowPattern {
    Sequential,
    IfElse,
    Parallelization,
    EvaluatorOptimizer,
}

/// An event in an XML-defined workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEvent {
    pub name: String,
    pub agent: String,
    pub listen: String,   // trigger input name
    pub action: String,   // what to do
    pub output: String,   // output variable name
    pub goto: Option<String>,
    pub abort_on_fail: bool,
}

/// A full parsed XML workflow spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSpec {
    pub title: String,
    pub pattern: WorkflowPattern,
    pub input: String,
    pub events: Vec<WorkflowEvent>,
}

// ─────────────────────────────────────────────────────────────────────────────
// XML Tool-Call Parser (Transformed Tool-Use Paradigm)
// ─────────────────────────────────────────────────────────────────────────────

/// Parses transformed XML tool calls from local LLM output.
/// Format: <function=tool_name><parameter=key>value</parameter></function>
pub fn parse_xml_tool_calls(text: &str) -> Vec<(String, HashMap<String, String>)> {
    let mut calls: Vec<(String, HashMap<String, String>)> = Vec::new();

    // Find all <function=TOOL_NAME>...</function> blocks
    let mut search_start = 0;
    while let Some(fn_start) = text[search_start..].find("<function=") {
        let abs_start = search_start + fn_start;

        // Extract tool name from <function=TOOL_NAME>
        let after_fn = abs_start + "<function=".len();
        let name_end = match text[after_fn..].find('>') {
            Some(pos) => after_fn + pos,
            None => break,
        };
        let tool_name = text[after_fn..name_end].trim().to_string();

        // Find matching </function>
        let content_start = name_end + 1;
        let fn_end = match text[content_start..].find("</function>") {
            Some(pos) => content_start + pos,
            None => break,
        };
        let inner_content = &text[content_start..fn_end];

        // Parse <parameter=key>value</parameter> pairs
        let mut params: HashMap<String, String> = HashMap::new();
        let mut param_search = 0;
        while let Some(p_start) = inner_content[param_search..].find("<parameter=") {
            let abs_p = param_search + p_start;
            let after_p = abs_p + "<parameter=".len();
            let p_name_end = match inner_content[after_p..].find('>') {
                Some(pos) => after_p + pos,
                None => break,
            };
            let param_name = inner_content[after_p..p_name_end].trim().to_string();
            let val_start = p_name_end + 1;
            let p_end = match inner_content[val_start..].find("</parameter>") {
                Some(pos) => val_start + pos,
                None => break,
            };
            let param_value = inner_content[val_start..p_end].trim().to_string();
            params.insert(param_name, param_value);
            param_search = p_end + "</parameter>".len();
        }

        calls.push((tool_name, params));
        search_start = fn_end + "</function>".len();
    }

    calls
}

/// Extracts RESULT: ... from agent output.
pub fn extract_result(text: &str) -> Option<String> {
    if let Some(idx) = text.find("RESULT:") {
        let after = text[idx + "RESULT:".len()..].trim();
        // Take up to GOTO or ABORT
        let end = after.find('\n').unwrap_or(after.len());
        Some(after[..end].trim().to_string())
    } else {
        None
    }
}

/// Extracts GOTO target from agent output.
pub fn extract_goto(text: &str) -> Option<String> {
    if let Some(idx) = text.find("GOTO:") {
        let after = text[idx + "GOTO:".len()..].trim();
        let end = after.find('\n').unwrap_or(after.len());
        Some(after[..end].trim().to_string())
    } else {
        None
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Executor — dispatches parsed XML tool calls to the real implementations
// ─────────────────────────────────────────────────────────────────────────────

pub async fn execute_tool(
    tool_name: &str,
    params: &HashMap<String, String>,
) -> String {
    match tool_name {
        // --- File System Tools (Local File Agent) ---
        "read_file" => {
            let path = params.get("path").map(String::as_str).unwrap_or("");
            match python_sandbox::read_local_file(path).await {
                Ok(content) => {
                    // Paginate at 6000 chars to prevent context overflow
                    let truncated = if content.len() > 6000 {
                        format!("{}...\n[TRUNCATED — {} total chars, showing first 6000]", &content[..6000], content.len())
                    } else {
                        content
                    };
                    format!("[read_file OK] Content of '{path}':\n{truncated}")
                }
                Err(e) => format!("[read_file ERROR] {e}"),
            }
        }

        "list_files" => {
            let path = params.get("path").map(String::as_str).unwrap_or(".");
            match python_sandbox::list_directory(path).await {
                Ok(files) => {
                    if files.is_empty() {
                        format!("[list_files OK] Directory '{path}' is empty.")
                    } else {
                        format!("[list_files OK] Directory '{path}':\n{}", files.join("\n"))
                    }
                }
                Err(e) => format!("[list_files ERROR] {e}"),
            }
        }

        "search_file" => {
            let path = params.get("path").map(String::as_str).unwrap_or("");
            let query = params.get("query").map(String::as_str).unwrap_or("");
            match python_sandbox::search_in_file(path, query).await {
                Ok(matches) => {
                    if matches.is_empty() {
                        format!("[search_file OK] No matches for '{query}' in '{path}'")
                    } else {
                        format!("[search_file OK] {} match(es) for '{query}' in '{path}':\n{}", matches.len(), matches.join("\n"))
                    }
                }
                Err(e) => format!("[search_file ERROR] {e}"),
            }
        }

        "write_file" => {
            let path = params.get("path").map(String::as_str).unwrap_or("");
            let content = params.get("content").map(String::as_str).unwrap_or("");
            match python_sandbox::write_local_file(path, content).await {
                Ok(_) => format!("[write_file OK] Successfully wrote {} chars to '{path}'", content.len()),
                Err(e) => format!("[write_file ERROR] {e}"),
            }
        }

        "append_file" => {
            let path = params.get("path").map(String::as_str).unwrap_or("");
            let content = params.get("content").map(String::as_str).unwrap_or("");
            match python_sandbox::append_local_file(path, content).await {
                Ok(_) => format!("[append_file OK] Appended {} chars to '{path}'", content.len()),
                Err(e) => format!("[append_file ERROR] {e}"),
            }
        }

        "copy_file" => {
            let src = params.get("src").map(String::as_str).unwrap_or("");
            let dst = params.get("dst").map(String::as_str).unwrap_or("");
            match python_sandbox::copy_file(src, dst).await {
                Ok(_) => format!("[copy_file OK] Copied '{src}' → '{dst}'"),
                Err(e) => format!("[copy_file ERROR] {e}"),
            }
        }

        "delete_file" => {
            let path = params.get("path").map(String::as_str).unwrap_or("");
            match python_sandbox::delete_file(path).await {
                Ok(_) => format!("[delete_file OK] Deleted '{path}'"),
                Err(e) => format!("[delete_file ERROR] {e}"),
            }
        }

        "get_file_info" => {
            let path = params.get("path").map(String::as_str).unwrap_or("");
            match python_sandbox::get_file_info(path).await {
                Ok(info) => format!("[get_file_info OK]\n{info}"),
                Err(e) => format!("[get_file_info ERROR] {e}"),
            }
        }

        // --- Code Execution Tools (Coding Agent) ---
        "run_python" => {
            let code = params.get("code").map(String::as_str).unwrap_or("");
            let working_dir = params.get("working_dir").map(String::as_str);
            match python_sandbox::run_python_script(code, working_dir).await {
                Ok(result) => {
                    let status = if result.success { "SUCCESS" } else { "FAILED" };
                    let stdout = if result.stdout.len() > 3000 {
                        format!("{}...[TRUNCATED]", &result.stdout[..3000])
                    } else {
                        result.stdout.clone()
                    };
                    let stderr_part = if !result.stderr.is_empty() {
                        format!("\nSTDERR:\n{}", &result.stderr[..result.stderr.len().min(1000)])
                    } else {
                        String::new()
                    };
                    format!("[run_python {status}] exit_code={}\nSTDOUT:\n{stdout}{stderr_part}", result.exit_code)
                }
                Err(e) => format!("[run_python ERROR] {e}"),
            }
        }

        "run_shell" => {
            let command = params.get("command").map(String::as_str).unwrap_or("");
            let working_dir = params.get("working_dir").map(String::as_str);
            match python_sandbox::run_shell_command(command, working_dir).await {
                Ok(result) => {
                    let status = if result.success { "SUCCESS" } else { "FAILED" };
                    format!("[run_shell {status}] exit={}\n{}\n{}", result.exit_code, result.stdout, result.stderr)
                }
                Err(e) => format!("[run_shell ERROR] {e}"),
            }
        }

        "register_tool" => {
            let name = params.get("name").map(String::as_str).unwrap_or("custom_tool");
            let code = params.get("code").map(String::as_str).unwrap_or("");
            match python_sandbox::register_tool(name, code, "./user_tools").await {
                Ok(msg) => format!("[register_tool OK] {msg}"),
                Err(e) => format!("[register_tool ERROR] {e}"),
            }
        }

        // --- LLM Tool (all agents can call Ollama directly) ---
        "call_llm" => {
            let model = params.get("model").map(String::as_str).unwrap_or("qwen2.5vl:7b");
            let prompt = params.get("prompt").map(String::as_str).unwrap_or("");
            // 3rd param is image_base64 — pass None (text-only call)
            match ollama::generate(model, prompt, None).await {
                Ok(response) => format!("[call_llm OK] {model}:\n{response}"),
                Err(e) => format!("[call_llm ERROR] {e}"),
            }
        }

        // --- Agent Transfer Tools (Orchestrator) ---
        "transfer_to_coding_agent" => {
            let task = params.get("task").map(String::as_str).unwrap_or("");
            format!("[HANDOFF→CodingAgent] {task}")
        }
        "transfer_to_local_file_agent" => {
            let task = params.get("task").map(String::as_str).unwrap_or("");
            format!("[HANDOFF→FileAgent] {task}")
        }
        "transfer_to_web_surfer_agent" => {
            let task = params.get("task").map(String::as_str).unwrap_or("");
            format!("[HANDOFF→WebSurferAgent] {task}")
        }
        "transfer_back_to_orchestrator" => {
            let result = params.get("result").map(String::as_str).unwrap_or("");
            format!("[HANDOFF→Orchestrator] Result: {result}")
        }
        "final_answer" => {
            let answer = params.get("answer").map(String::as_str).unwrap_or("");
            format!("FINAL_ANSWER: {answer}")
        }

        _ => format!("[unknown_tool] Tool '{tool_name}' not recognized. Available: read_file, write_file, append_file, list_files, search_file, copy_file, delete_file, get_file_info, run_python, run_shell, call_llm, register_tool, transfer_to_coding_agent, transfer_to_local_file_agent, transfer_back_to_orchestrator, final_answer"),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-Play Python Execution (Coding Agent retry loop)
// ─────────────────────────────────────────────────────────────────────────────

/// Executes Python code with self-play retry: if execution fails, asks LLM to fix the code.
/// Returns the final execution result (success or last attempt).
async fn run_python_with_self_play(
    code: &str,
    model: &str,
    max_retries: usize,
) -> (python_sandbox::SandboxResult, Vec<String>) {
    let mut current_code = code.to_string();
    let mut attempts: Vec<String> = Vec::new();

    for attempt in 0..=max_retries {
        let result = python_sandbox::run_python_script(&current_code, None)
            .await
            .unwrap_or_else(|e| python_sandbox::SandboxResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Sandbox error: {e}"),
                exit_code: -1,
            });

        if result.success {
            attempts.push(format!("Attempt {}: SUCCESS", attempt + 1));
            return (result, attempts);
        }

        attempts.push(format!(
            "Attempt {}: FAILED (exit {})\nSTDERR: {}",
            attempt + 1,
            result.exit_code,
            &result.stderr[..result.stderr.len().min(500)]
        ));

        if attempt < max_retries {
            // Self-play: ask LLM to fix the error
            let fix_prompt = format!(
                "You are a Python debugging expert. The following code has an error. Fix it and return ONLY the corrected Python code with no explanations, no markdown fences.\n\nCode:\n```python\n{current_code}\n```\n\nError:\n{}\n\nCorrected Python code:",
                &result.stderr[..result.stderr.len().min(800)]
            );

            let fixed = ollama::generate(model, &fix_prompt, None)
                .await
                .unwrap_or_else(|_| current_code.clone());

            // Strip any markdown fences from the fix
            current_code = fixed
                .replace("```python", "")
                .replace("```py", "")
                .replace("```", "")
                .trim()
                .to_string();

            attempts.push(format!("Self-play fix #{}: LLM rewrote code.", attempt + 1));
        }
    }

    // All retries exhausted — return last failed result
    let final_result = python_sandbox::run_python_script(&current_code, None)
        .await
        .unwrap_or_else(|e| python_sandbox::SandboxResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Final attempt sandbox error: {e}"),
            exit_code: -1,
        });

    (final_result, attempts)
}

// ─────────────────────────────────────────────────────────────────────────────
// Single Agent Step — calls Ollama, parses tool calls, executes them
// ─────────────────────────────────────────────────────────────────────────────

pub async fn run_agent_step(
    agent_name: &str,
    model: &str,
    system_prompt: &str,
    conversation: &mut Vec<String>,
    step_index: usize,
) -> Result<(String, Vec<TrajectoryStep>), String> {
    // Build full context: system prompt + entire conversation
    let history = conversation.join("\n\n---\n\n");
    let full_prompt = format!("System Instructions:\n{system_prompt}\n\n=== Conversation History ===\n{history}\n\n=== Your Turn ===\n[{agent_name}]: ");

    // Call local Ollama model
    let raw_response = ollama::generate(model, &full_prompt, None)
        .await
        .unwrap_or_else(|e| format!("LLM error: {e}"));

    let mut trajectory_steps: Vec<TrajectoryStep> = Vec::new();

    // Record thinking step
    trajectory_steps.push(TrajectoryStep {
        agent_name: agent_name.to_string(),
        step_index,
        action: "thinking".to_string(),
        content: raw_response.clone(),
        tool_name: None,
        tool_result: None,
    });

    // Parse XML tool calls
    let tool_calls = parse_xml_tool_calls(&raw_response);
    let mut tool_results: Vec<String> = Vec::new();

    for (tool_name, params) in &tool_calls {
        // Record tool call step
        trajectory_steps.push(TrajectoryStep {
            agent_name: agent_name.to_string(),
            step_index,
            action: "tool_call".to_string(),
            content: format!("Calling tool: {tool_name} with params: {:?}", params.keys().collect::<Vec<_>>()),
            tool_name: Some(tool_name.clone()),
            tool_result: None,
        });

        // Self-play for run_python: retry on failure up to 5 times
        let result = if tool_name == "run_python" {
            let code = params.get("code").map(String::as_str).unwrap_or("");
            let (sandbox_result, attempts) = run_python_with_self_play(code, model, 5).await;

            // Emit self-play steps if there were retries
            if attempts.len() > 1 {
                for (i, attempt_msg) in attempts.iter().enumerate() {
                    trajectory_steps.push(TrajectoryStep {
                        agent_name: agent_name.to_string(),
                        step_index,
                        action: format!("self_play_retry_{i}"),
                        content: attempt_msg.clone(),
                        tool_name: Some("run_python".to_string()),
                        tool_result: None,
                    });
                }
            }

            let status = if sandbox_result.success { "SUCCESS" } else { "FAILED after 5 retries" };
            format!(
                "[run_python {status}] exit={}\nSTDOUT:\n{}\nSTDERR:\n{}",
                sandbox_result.exit_code,
                &sandbox_result.stdout[..sandbox_result.stdout.len().min(3000)],
                &sandbox_result.stderr[..sandbox_result.stderr.len().min(1000)]
            )
        } else {
            execute_tool(tool_name, params).await
        };

        // Record tool result
        trajectory_steps.push(TrajectoryStep {
            agent_name: agent_name.to_string(),
            step_index,
            action: "tool_result".to_string(),
            content: result.clone(),
            tool_name: Some(tool_name.clone()),
            tool_result: Some(result.clone()),
        });

        tool_results.push(format!("[{tool_name}] → {result}"));
    }

    // Build the new conversation message with tool results appended
    let mut agent_message = format!("[{agent_name}]:\n{raw_response}");
    if !tool_results.is_empty() {
        agent_message.push_str(&format!("\n\n=== Tool Results ===\n{}", tool_results.join("\n---\n")));
    }
    conversation.push(agent_message.clone());

    Ok((agent_message, trajectory_steps))
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Agent Orchestrator Run (User Mode / Deep Research)
// ─────────────────────────────────────────────────────────────────────────────

pub async fn run_user_mode_task<R: tauri::Runtime>(
    app: AppHandle<R>,
    task: String,
    model: String,
    orchestrator_prompt: String,
    coding_agent_prompt: String,
    file_agent_prompt: String,
    max_rounds: usize,
) -> AgentRunResult {
    let mut trajectory: Vec<TrajectoryStep> = Vec::new();
    let mut conversation: Vec<String> = Vec::new();

    // Seed the conversation with the task
    conversation.push(format!("User Task:\n{task}"));

    let mut current_agent = "Orchestrator";
    let mut step_index = 0;
    let mut final_answer = String::new();

    for _round in 0..max_rounds {
        step_index += 1;

        let system_prompt = match current_agent {
            "Coding Agent" => coding_agent_prompt.as_str(),
            "Local File Agent" => file_agent_prompt.as_str(),
            _ => orchestrator_prompt.as_str(),
        };

        let result = run_agent_step(
            current_agent,
            &model,
            system_prompt,
            &mut conversation,
            step_index,
        )
        .await;

        match result {
            Ok((response_text, steps)) => {
                // Emit each step to frontend for live trajectory display
                for step in &steps {
                    let _ = app.emit(
                        "agent-trajectory-step",
                        AgentTrajectoryEvent {
                            step: step.clone(),
                            is_final: false,
                        },
                    );
                    trajectory.push(step.clone());
                }

                // Check for FINAL_ANSWER
                if response_text.contains("FINAL_ANSWER:") {
                    if let Some(idx) = response_text.find("FINAL_ANSWER:") {
                        final_answer = response_text[idx + "FINAL_ANSWER:".len()..]
                            .trim()
                            .to_string();
                    }
                    break;
                }

                // Handle handoffs — detect from tool_calls in the raw response
                let tool_calls = parse_xml_tool_calls(&response_text);
                let mut handoff_target: Option<&str> = None;

                for (tool_name, _) in &tool_calls {
                    match tool_name.as_str() {
                        "transfer_to_coding_agent" => handoff_target = Some("Coding Agent"),
                        "transfer_to_local_file_agent" => handoff_target = Some("Local File Agent"),
                        "transfer_to_web_surfer_agent" => handoff_target = Some("Web Surfer Agent"),
                        "transfer_back_to_orchestrator" => handoff_target = Some("Orchestrator"),
                        _ => {}
                    }
                }

                if let Some(target) = handoff_target {
                    let handoff_step = TrajectoryStep {
                        agent_name: current_agent.to_string(),
                        step_index,
                        action: "handoff".to_string(),
                        content: format!("Transferring control to {target}"),
                        tool_name: None,
                        tool_result: None,
                    };
                    let _ = app.emit(
                        "agent-trajectory-step",
                        AgentTrajectoryEvent {
                            step: handoff_step.clone(),
                            is_final: false,
                        },
                    );
                    trajectory.push(handoff_step);
                    current_agent = target;
                }
            }
            Err(e) => {
                let err_step = TrajectoryStep {
                    agent_name: current_agent.to_string(),
                    step_index,
                    action: "error".to_string(),
                    content: format!("Agent error: {e}"),
                    tool_name: None,
                    tool_result: None,
                };
                trajectory.push(err_step);
                return AgentRunResult {
                    success: false,
                    final_answer: String::new(),
                    trajectory,
                    error: Some(e),
                };
            }
        }
    }

    if final_answer.is_empty() {
        // Extract the last meaningful response as the answer
        final_answer = conversation
            .last()
            .cloned()
            .unwrap_or_else(|| "Task completed. Check trajectory for details.".to_string());
    }

    // Emit final step
    let final_step = TrajectoryStep {
        agent_name: "System".to_string(),
        step_index: step_index + 1,
        action: "result".to_string(),
        content: final_answer.clone(),
        tool_name: None,
        tool_result: None,
    };
    let _ = app.emit(
        "agent-trajectory-step",
        AgentTrajectoryEvent {
            step: final_step.clone(),
            is_final: true,
        },
    );

    AgentRunResult {
        success: true,
        final_answer,
        trajectory,
        error: None,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Agent Runner — runs a dynamically generated agent spec
// ─────────────────────────────────────────────────────────────────────────────

/// Runs a custom agent defined by a name + instructions + tool list.
/// Supports full tool execution and self-play error correction.
pub async fn run_custom_agent<R: tauri::Runtime>(
    app: AppHandle<R>,
    agent_name: String,
    instructions: String,
    task: String,
    tools: Vec<String>,
    model: String,
    max_rounds: usize,
) -> AgentRunResult {
    // Build dynamic system prompt for the custom agent
    let tool_schemas: Vec<String> = tools.iter().map(|t| build_tool_schema(t)).collect();

    let system_prompt = format!(
        "You are {agent_name}.\n\n{instructions}\n\n\
=== Available Tools ===\nUse this XML format to call any tool:\n\
<function=tool_name><parameter=param_name>value</parameter></function>\n\n\
{}\n\n\
IMPORTANT: After completing your task, always call:\n\
<function=final_answer><parameter=answer>your complete answer here</parameter></function>",
        tool_schemas.join("\n\n")
    );

    run_user_mode_task(
        app,
        task,
        model,
        system_prompt.clone(),
        system_prompt.clone(),
        system_prompt,
        max_rounds,
    ).await
}

/// Builds an XML tool schema description for a given tool name.
fn build_tool_schema(tool_name: &str) -> String {
    match tool_name {
        "read_file" => "<function=read_file><parameter=path>/path/to/file</parameter></function>\n  → Read a file's content".to_string(),
        "write_file" => "<function=write_file><parameter=path>/path/to/file</parameter><parameter=content>text content</parameter></function>\n  → Write content to a file (creates directories)".to_string(),
        "append_file" => "<function=append_file><parameter=path>/path/to/file</parameter><parameter=content>text to append</parameter></function>\n  → Append content to a file".to_string(),
        "list_files" => "<function=list_files><parameter=path>/path/to/directory</parameter></function>\n  → List files in a directory (recursive, 2 levels)".to_string(),
        "search_file" => "<function=search_file><parameter=path>/path/to/file</parameter><parameter=query>search term</parameter></function>\n  → Search for text in a file (returns matching lines)".to_string(),
        "copy_file" => "<function=copy_file><parameter=src>/source/path</parameter><parameter=dst>/dest/path</parameter></function>\n  → Copy a file".to_string(),
        "delete_file" => "<function=delete_file><parameter=path>/path/to/file</parameter></function>\n  → Delete a file".to_string(),
        "get_file_info" => "<function=get_file_info><parameter=path>/path/to/file</parameter></function>\n  → Get file size, type, and modification time".to_string(),
        "run_python" => "<function=run_python><parameter=code>print('hello')</parameter></function>\n  → Execute Python code (auto-fixes errors via self-play, up to 5 retries)".to_string(),
        "run_shell" => "<function=run_shell><parameter=command>ls -la</parameter></function>\n  → Run a shell command (cross-platform)".to_string(),
        "call_llm" => "<function=call_llm><parameter=model>llama3.2</parameter><parameter=prompt>your prompt</parameter></function>\n  → Call a local Ollama LLM model".to_string(),
        "register_tool" => "<function=register_tool><parameter=name>tool_name</parameter><parameter=code>python code</parameter></function>\n  → Register a custom Python tool".to_string(),
        "final_answer" => "<function=final_answer><parameter=answer>your answer</parameter></function>\n  → Submit your final answer and end the task".to_string(),
        _ => format!("<function={tool_name}>...</function>"),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// XML Workflow Executor (Workflow Editor)
// ─────────────────────────────────────────────────────────────────────────────

/// Executes a parsed WorkflowSpec.
/// Supports: Sequential, IfElse, Parallelization (Majority Voting), EvaluatorOptimizer.
pub async fn execute_xml_workflow<R: tauri::Runtime>(
    app: AppHandle<R>,
    spec: WorkflowSpec,
    input: String,
    model: String,
) -> AgentRunResult {
    let mut trajectory: Vec<TrajectoryStep> = Vec::new();
    let mut context: HashMap<String, String> = HashMap::new();
    context.insert("input".to_string(), input.clone());

    let mut step_index = 0;

    match spec.pattern {
        WorkflowPattern::Sequential => {
            // Execute events in order, passing outputs to next event via context
            for event in &spec.events {
                step_index += 1;
                let listen_value = context
                    .get(&event.listen)
                    .cloned()
                    .unwrap_or_else(|| input.clone());

                let prompt = format!("{}\n\nInput: {listen_value}", event.action);
                let result = ollama::generate(&model, &prompt, None)
                    .await
                    .unwrap_or_else(|e| format!("LLM error: {e}"));

                context.insert(event.output.clone(), result.clone());

                let step = TrajectoryStep {
                    agent_name: event.agent.clone(),
                    step_index,
                    action: "sequential_step".to_string(),
                    content: result,
                    tool_name: None,
                    tool_result: None,
                };
                let _ = app.emit("agent-trajectory-step", AgentTrajectoryEvent {
                    step: step.clone(),
                    is_final: false,
                });
                trajectory.push(step);
            }
        }

        WorkflowPattern::Parallelization => {
            // Run all events in parallel and aggregate responses (Majority Voting)
            let mut handles = Vec::new();
            for event in &spec.events {
                let listen_value = context
                    .get(&event.listen)
                    .cloned()
                    .unwrap_or_else(|| input.clone());
                let action = event.action.clone();
                let model_clone = model.clone();
                let agent_name = event.agent.clone();

                let prompt = format!("{action}\n\nInput: {listen_value}");
                let handle = tokio::spawn(async move {
                    let result = ollama::generate(&model_clone, &prompt, None)
                        .await
                        .unwrap_or_else(|e| format!("LLM error: {e}"));
                    (agent_name, result)
                });
                handles.push(handle);
            }

            let mut responses: Vec<String> = Vec::new();
            for handle in handles {
                step_index += 1;
                if let Ok((agent_name, result)) = handle.await {
                    responses.push(result.clone());
                    let step = TrajectoryStep {
                        agent_name,
                        step_index,
                        action: "parallel_vote".to_string(),
                        content: result,
                        tool_name: None,
                        tool_result: None,
                    };
                    let _ = app.emit("agent-trajectory-step", AgentTrajectoryEvent {
                        step: step.clone(),
                        is_final: false,
                    });
                    trajectory.push(step);
                }
            }

            // Majority voting aggregation
            if !responses.is_empty() {
                let vote_prompt = format!(
                    "You are a voting aggregator. Given these {} responses to the same question, determine the majority/best answer:\n\n{}\n\nQuestion/Task: {input}\n\nVote Result:",
                    responses.len(),
                    responses.iter().enumerate().map(|(i, r)| format!("Response {}: {r}", i + 1)).collect::<Vec<_>>().join("\n\n")
                );
                let aggregated = ollama::generate(&model, &vote_prompt, None)
                    .await
                    .unwrap_or_else(|_| responses[0].clone());
                context.insert("vote_result".to_string(), aggregated);
            }
        }

        WorkflowPattern::IfElse => {
            // First event evaluates condition; route to true or false branch
            if spec.events.len() >= 1 {
                step_index += 1;
                let condition_event = &spec.events[0];
                let prompt = format!("{}\n\nInput: {input}\n\nAnswer with only 'true' or 'false':", condition_event.action);
                let condition_result = ollama::generate(&model, &prompt, None)
                    .await
                    .unwrap_or("false".to_string());

                let branch = if condition_result.to_lowercase().contains("true") {
                    "true"
                } else {
                    "false"
                };

                let step = TrajectoryStep {
                    agent_name: condition_event.agent.clone(),
                    step_index,
                    action: "condition_evaluate".to_string(),
                    content: format!("Condition result: {branch}"),
                    tool_name: None,
                    tool_result: None,
                };
                let _ = app.emit("agent-trajectory-step", AgentTrajectoryEvent {
                    step: step.clone(),
                    is_final: false,
                });
                trajectory.push(step);
                context.insert("condition".to_string(), branch.to_string());

                // Execute matching branch event
                for event in spec.events.iter().skip(1) {
                    if event.listen == branch {
                        step_index += 1;
                        let branch_prompt = format!("{}\n\nInput: {input}", event.action);
                        let branch_result = ollama::generate(&model, &branch_prompt, None)
                            .await
                            .unwrap_or_default();
                        context.insert(event.output.clone(), branch_result.clone());
                        let branch_step = TrajectoryStep {
                            agent_name: event.agent.clone(),
                            step_index,
                            action: "branch_executed".to_string(),
                            content: branch_result,
                            tool_name: None,
                            tool_result: None,
                        };
                        let _ = app.emit("agent-trajectory-step", AgentTrajectoryEvent {
                            step: branch_step.clone(),
                            is_final: false,
                        });
                        trajectory.push(branch_step);
                        break;
                    }
                }
            }
        }

        WorkflowPattern::EvaluatorOptimizer => {
            // Run generator then evaluator in a loop (up to 3 iterations)
            let max_iters = 3;
            let mut current_answer = input.clone();
            let evaluator_idx = spec.events.iter().position(|e| e.agent.to_lowercase().contains("evaluat")).unwrap_or(1);

            for iteration in 0..max_iters {
                step_index += 1;

                // Generator step
                if let Some(generator) = spec.events.first() {
                    let gen_prompt = format!("{}\n\nInput: {current_answer}", generator.action);
                    let generated = ollama::generate(&model, &gen_prompt, None)
                        .await
                        .unwrap_or_default();
                    current_answer = generated.clone();

                    let gen_step = TrajectoryStep {
                        agent_name: generator.agent.clone(),
                        step_index,
                        action: format!("generate_iter_{iteration}"),
                        content: generated,
                        tool_name: None,
                        tool_result: None,
                    };
                    let _ = app.emit("agent-trajectory-step", AgentTrajectoryEvent {
                        step: gen_step.clone(),
                        is_final: false,
                    });
                    trajectory.push(gen_step);
                }

                step_index += 1;

                // Evaluator step
                if let Some(evaluator) = spec.events.get(evaluator_idx) {
                    let eval_prompt = format!(
                        "{}\n\nOriginal Task: {input}\n\nCandidate Answer: {current_answer}\n\nIs this answer acceptable? Reply with PASS if acceptable, or IMPROVE:<feedback> if improvements needed.",
                        evaluator.action
                    );
                    let eval_result = ollama::generate(&model, &eval_prompt, None)
                        .await
                        .unwrap_or("PASS".to_string());

                    let is_pass = eval_result.to_uppercase().contains("PASS");

                    let eval_step = TrajectoryStep {
                        agent_name: evaluator.agent.clone(),
                        step_index,
                        action: format!("evaluate_iter_{iteration}"),
                        content: eval_result.clone(),
                        tool_name: None,
                        tool_result: None,
                    };
                    let _ = app.emit("agent-trajectory-step", AgentTrajectoryEvent {
                        step: eval_step.clone(),
                        is_final: false,
                    });
                    trajectory.push(eval_step);

                    if is_pass {
                        break;
                    } else {
                        // Feed evaluation feedback back to generator
                        if let Some(feedback) = eval_result.find("IMPROVE:").map(|i| &eval_result[i + 8..]) {
                            current_answer = format!("Previous attempt was insufficient. Feedback: {feedback}\n\nRevise your answer for: {input}");
                        }
                    }
                }
            }
        }
    }

    // Collect the final output from context
    let final_answer = context
        .get("output")
        .or_else(|| context.get("vote_result"))
        .or_else(|| context.get("result"))
        .or_else(|| context.get("generated"))
        .cloned()
        .unwrap_or_else(|| {
            trajectory
                .last()
                .map(|s| s.content.clone())
                .unwrap_or_else(|| "Workflow completed.".to_string())
        });

    let final_step = TrajectoryStep {
        agent_name: "System".to_string(),
        step_index: step_index + 1,
        action: "result".to_string(),
        content: final_answer.clone(),
        tool_name: None,
        tool_result: None,
    };
    let _ = app.emit("agent-trajectory-step", AgentTrajectoryEvent {
        step: final_step.clone(),
        is_final: true,
    });

    AgentRunResult {
        success: true,
        final_answer,
        trajectory,
        error: None,
    }
}
