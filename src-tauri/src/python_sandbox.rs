use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Represents the result of executing a Python script in the local sandbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Runs a Python script string in the local sandbox (cross-platform: Windows, macOS, Linux).
/// Uses the system Python interpreter — no Docker required.
pub async fn run_python_script(code: &str, working_dir: Option<&str>) -> Result<SandboxResult, String> {
    // Write code to a temp file
    let tmp_dir = std::env::temp_dir();
    let script_path = tmp_dir.join(format!("hlah_sandbox_{}.py", uuid::Uuid::new_v4()));

    tokio::fs::write(&script_path, code)
        .await
        .map_err(|e| format!("Failed to write sandbox script: {e}"))?;

    let python_cmd = find_python_executable();

    let mut cmd = Command::new(&python_cmd);
    cmd.arg(script_path.to_str().unwrap_or("script.py"));

    if let Some(dir) = working_dir {
        if Path::new(dir).is_dir() {
            cmd.current_dir(dir);
        }
    }

    // Capture stdout and stderr
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let result = cmd.output().await;

    // Cleanup temp file
    let _ = tokio::fs::remove_file(&script_path).await;

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            Ok(SandboxResult {
                success: output.status.success(),
                stdout,
                stderr,
                exit_code,
            })
        }
        Err(e) => {
            // Python not available — return a descriptive error result
            Ok(SandboxResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Python execution unavailable ({python_cmd}): {e}. Install Python 3.x for full sandbox support."),
                exit_code: -1,
            })
        }
    }
}

/// Reads a file from the local filesystem as text.
pub async fn read_local_file(path: &str) -> Result<String, String> {
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Failed to read file '{path}': {e}"))
}

/// Lists files and directories within a given directory path (recursive optional).
pub async fn list_directory(path: &str) -> Result<Vec<String>, String> {
    list_directory_recursive(path.to_string(), 0, 2).await
}

/// Recursive directory listing up to max_depth — uses Box::pin for async recursion.
fn list_directory_recursive(
    path: String,
    depth: usize,
    max_depth: usize,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<String>, String>> + Send>> {
    Box::pin(async move {
        let mut entries = tokio::fs::read_dir(&path)
            .await
            .map_err(|e| format!("Failed to list directory '{path}': {e}"))?;

        let mut result = Vec::new();
        let indent = "  ".repeat(depth);

        while let Ok(Some(entry)) = entries.next_entry().await {
            let entry_path = entry.path();
            let name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            let metadata = tokio::fs::metadata(&entry_path).await;
            let is_dir = metadata.map(|m| m.is_dir()).unwrap_or(false);

            if is_dir {
                result.push(format!("{indent}[DIR] {name}/"));
                if depth < max_depth {
                    if let Ok(sub_entries) = list_directory_recursive(
                        entry_path.to_string_lossy().to_string(),
                        depth + 1,
                        max_depth,
                    ).await {
                        result.extend(sub_entries);
                    }
                }
            } else {
                let size = tokio::fs::metadata(&entry_path)
                    .await
                    .map(|m| m.len())
                    .unwrap_or(0);
                result.push(format!("{indent}{name} ({} bytes)", size));
            }
        }
        Ok(result)
    })
}

/// Searches for text in a file (simple grep-like).
pub async fn search_in_file(path: &str, query: &str) -> Result<Vec<String>, String> {
    let content = read_local_file(path).await?;
    let matches: Vec<String> = content
        .lines()
        .enumerate()
        .filter(|(_, line)| line.to_lowercase().contains(&query.to_lowercase()))
        .map(|(i, line)| format!("L{}: {}", i + 1, line))
        .collect();
    Ok(matches)
}

/// Writes a file to the local filesystem.
pub async fn write_local_file(path: &str, content: &str) -> Result<(), String> {
    // Create parent directories if needed
    if let Some(parent) = PathBuf::from(path).parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create directories for '{path}': {e}"))?;
        }
    }
    tokio::fs::write(path, content)
        .await
        .map_err(|e| format!("Failed to write file '{path}': {e}"))
}

/// Appends content to a file (creates if not exists).
pub async fn append_local_file(path: &str, content: &str) -> Result<(), String> {
    use tokio::fs::OpenOptions;
    use tokio::io::AsyncWriteExt;

    if let Some(parent) = PathBuf::from(path).parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create directories for '{path}': {e}"))?;
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .map_err(|e| format!("Failed to open file '{path}' for append: {e}"))?;

    file.write_all(content.as_bytes())
        .await
        .map_err(|e| format!("Failed to append to '{path}': {e}"))
}

/// Copies a file from src to dst.
pub async fn copy_file(src: &str, dst: &str) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(dst).parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create dst directories: {e}"))?;
        }
    }
    tokio::fs::copy(src, dst)
        .await
        .map(|_| ())
        .map_err(|e| format!("Failed to copy '{src}' to '{dst}': {e}"))
}

/// Deletes a file.
pub async fn delete_file(path: &str) -> Result<(), String> {
    tokio::fs::remove_file(path)
        .await
        .map_err(|e| format!("Failed to delete '{path}': {e}"))
}

/// Gets file metadata: size, last modified.
pub async fn get_file_info(path: &str) -> Result<String, String> {
    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|e| format!("Failed to get info for '{path}': {e}"))?;

    let size = meta.len();
    let is_dir = meta.is_dir();
    let modified = meta.modified()
        .ok()
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH).ok()
        })
        .map(|d| format!("{}", d.as_secs()))
        .unwrap_or_else(|| "unknown".to_string());

    Ok(format!(
        "Path: {path}\nType: {}\nSize: {} bytes\nModified (unix): {modified}",
        if is_dir { "directory" } else { "file" },
        size
    ))
}

/// Runs a shell command (cross-platform).
/// Returns stdout+stderr combined.
pub async fn run_shell_command(command: &str, working_dir: Option<&str>) -> Result<SandboxResult, String> {
    #[cfg(target_os = "windows")]
    let (shell, flag) = ("cmd", "/C");
    #[cfg(not(target_os = "windows"))]
    let (shell, flag) = ("sh", "-c");

    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(command);

    if let Some(dir) = working_dir {
        if Path::new(dir).is_dir() {
            cmd.current_dir(dir);
        }
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    match cmd.output().await {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            Ok(SandboxResult {
                success: output.status.success(),
                stdout,
                stderr,
                exit_code,
            })
        }
        Err(e) => Ok(SandboxResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Shell command failed: {e}"),
            exit_code: -1,
        }),
    }
}

/// Detects the correct Python executable for the current platform.
pub fn find_python_executable() -> String {
    #[cfg(target_os = "windows")]
    {
        "python".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        "python3".to_string()
    }
}

/// Registers a Python tool to the user_tools directory so it is available to agents.
pub async fn register_tool(
    tool_name: &str,
    tool_code: &str,
    user_tools_dir: &str,
) -> Result<String, String> {
    let tools_dir = PathBuf::from(user_tools_dir);
    tokio::fs::create_dir_all(&tools_dir)
        .await
        .map_err(|e| format!("Failed to create user_tools dir: {e}"))?;

    let tool_file = tools_dir.join(format!("{tool_name}.py"));
    tokio::fs::write(&tool_file, tool_code)
        .await
        .map_err(|e| format!("Failed to write tool file: {e}"))?;

    Ok(format!("Tool '{tool_name}' registered at {}", tool_file.display()))
}

/// Lists all registered tools in the user_tools directory.
pub async fn list_registered_tools(user_tools_dir: &str) -> Result<Vec<String>, String> {
    list_directory(user_tools_dir).await.or(Ok(vec![]))
}

/// Writes a complete, runnable generated agent to disk.
/// Creates: generated_agents/<agent_name>/agent.py  + run.sh / run.bat
pub async fn write_agent_to_disk(
    agent_name: &str,
    agent_instructions: &str,
    tools: &[String],
    model: &str,
) -> Result<String, String> {
    let safe_name = agent_name.to_lowercase().replace(' ', "_");
    let agent_dir = PathBuf::from(format!("./generated_agents/{safe_name}"));
    tokio::fs::create_dir_all(&agent_dir)
        .await
        .map_err(|e| format!("Failed to create agent directory: {e}"))?;

    let tools_list: Vec<String> = tools.iter().map(|t| format!("\"{}\"", t)).collect();
    let tools_str = tools_list.join(", ");

    let agent_py = format!(
        r#"#!/usr/bin/env python3
"""
{agent_name} — Generated by Hybrid Local AI Hub
Model: {model}

Instructions:
{agent_instructions}

Tools: {tools_str}
"""

import os
import sys
import json
import subprocess
import urllib.request
import urllib.error

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "{model}"
TOOLS = [{tools_str}]

SYSTEM_PROMPT = """{agent_instructions}

Available tools (use XML format):
<function=read_file><parameter=path>filepath</parameter></function>
<function=write_file><parameter=path>filepath</parameter><parameter=content>text</parameter></function>
<function=list_files><parameter=path>directory</parameter></function>
<function=run_python><parameter=code>python code</parameter></function>
<function=final_answer><parameter=answer>your final answer</parameter></function>
"""

def call_ollama(prompt, system=None):
    payload = {{
        "model": MODEL,
        "prompt": prompt,
        "system": system or SYSTEM_PROMPT,
        "stream": False
    }}
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        OLLAMA_URL,
        data=data,
        headers={{"Content-Type": "application/json"}}
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            return result.get("response", "")
    except Exception as e:
        return f"LLM error: {{e}}"

def execute_tool(tool_name, params):
    if tool_name == "read_file":
        path = params.get("path", "")
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()[:4000]
        except Exception as e:
            return f"Error reading {{path}}: {{e}}"

    elif tool_name == "write_file":
        path = params.get("path", "")
        content = params.get("content", "")
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"Written to {{path}}"
        except Exception as e:
            return f"Error writing {{path}}: {{e}}"

    elif tool_name == "list_files":
        path = params.get("path", ".")
        try:
            result = []
            for item in os.listdir(path):
                full = os.path.join(path, item)
                result.append(f"[DIR] {{item}}/" if os.path.isdir(full) else item)
            return "\n".join(result)
        except Exception as e:
            return f"Error listing {{path}}: {{e}}"

    elif tool_name == "run_python":
        code = params.get("code", "")
        try:
            # Write to temp file and execute
            import tempfile
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as tf:
                tf.write(code)
                tf_name = tf.name
            proc = subprocess.run(
                [sys.executable, tf_name],
                capture_output=True, text=True, timeout=30
            )
            os.unlink(tf_name)
            status = "SUCCESS" if proc.returncode == 0 else "FAILED"
            return f"[{{status}}] exit={{proc.returncode}}:\n{{proc.stdout}}\n{{proc.stderr}}"
        except Exception as e:
            return f"Error running Python: {{e}}"

    elif tool_name == "final_answer":
        return f"FINAL: {{params.get('answer', '')}}"

    else:
        return f"Unknown tool: {{tool_name}}"

def parse_xml_tools(text):
    """Parse <function=X><parameter=Y>V</parameter></function> format."""
    calls = []
    i = 0
    while True:
        fn_start = text.find("<function=", i)
        if fn_start == -1:
            break
        name_end = text.find(">", fn_start)
        if name_end == -1:
            break
        tool_name = text[fn_start + len("<function="):name_end].strip()
        fn_end = text.find("</function>", name_end)
        if fn_end == -1:
            break
        inner = text[name_end + 1:fn_end]
        params = {{}}
        j = 0
        while True:
            p_start = inner.find("<parameter=", j)
            if p_start == -1:
                break
            p_name_end = inner.find(">", p_start)
            if p_name_end == -1:
                break
            p_name = inner[p_start + len("<parameter="):p_name_end].strip()
            p_val_end = inner.find("</parameter>", p_name_end)
            if p_val_end == -1:
                break
            p_val = inner[p_name_end + 1:p_val_end].strip()
            params[p_name] = p_val
            j = p_val_end + len("</parameter>")
        calls.append((tool_name, params))
        i = fn_end + len("</function>")
    return calls

def run_agent(task, max_rounds=10):
    conversation = [f"System:\n{{SYSTEM_PROMPT}}\n\nUser Task:\n{{task}}"]
    print(f"\\n🤖 {{MODEL}} Agent starting task...\\n")

    for round_num in range(max_rounds):
        prompt = "\n\n".join(conversation)
        response = call_ollama(prompt)
        print(f"[Round {{round_num + 1}}] Agent: {{response[:200]}}...")

        # Parse and execute tools
        tool_calls = parse_xml_tools(response)
        tool_results = []
        for tool_name, params in tool_calls:
            print(f"  → Tool: {{tool_name}}({{list(params.keys())}})")
            result = execute_tool(tool_name, params)
            tool_results.append(f"[{{tool_name}} result]: {{result[:500]}}")
            if tool_name == "final_answer":
                print(f"\\n✅ Final Answer: {{params.get('answer', result)}}")
                return params.get("answer", result)

        msg = f"[Agent Round {{round_num + 1}}]:\n{{response}}"
        if tool_results:
            msg += f"\n\nTool Results:\n{{chr(10).join(tool_results)}}"
        conversation.append(msg)

    return conversation[-1]

if __name__ == "__main__":
    task = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else input("Enter task: ")
    result = run_agent(task)
    print(f"\nResult: {{result}}")
"#
    );

    // Write agent.py
    let agent_file = agent_dir.join("agent.py");
    tokio::fs::write(&agent_file, &agent_py)
        .await
        .map_err(|e| format!("Failed to write agent.py: {e}"))?;

    // Write run.bat (Windows)
    let run_bat = format!(
        "@echo off\necho Running {agent_name}...\npython \"%~dp0agent.py\" %*\n"
    );
    tokio::fs::write(agent_dir.join("run.bat"), run_bat)
        .await
        .ok();

    // Write run.sh (Unix)
    let run_sh = format!(
        "#!/bin/bash\necho 'Running {agent_name}...'\npython3 \"$(dirname \"$0\")/agent.py\" \"$@\"\n"
    );
    tokio::fs::write(agent_dir.join("run.sh"), run_sh)
        .await
        .ok();

    // Write README.md for the agent
    let readme = format!(
        "# {agent_name}\n\nGenerated by Hybrid Local AI Hub\n\n## Usage\n\n```bash\n# Windows\nrun.bat \"your task here\"\n\n# macOS/Linux\nbash run.sh \"your task here\"\n\n# Direct Python\npython agent.py \"your task here\"\n```\n\n## Model\n`{model}`\n\n## Tools\n{}\n\n## Instructions\n\n{agent_instructions}\n",
        tools.iter().map(|t| format!("- `{t}`")).collect::<Vec<_>>().join("\n"),
    );
    tokio::fs::write(agent_dir.join("README.md"), readme)
        .await
        .ok();

    Ok(format!(
        "Agent '{agent_name}' written to {}/\nFiles: agent.py, run.bat, run.sh, README.md",
        agent_dir.display()
    ))
}
