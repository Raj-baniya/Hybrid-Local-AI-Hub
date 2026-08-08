use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

use notify::RecommendedWatcher;

pub struct WatcherState {
    pub watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph Compiler (Chat-to-Graph Mode)
// ─────────────────────────────────────────────────────────────────────────────

const TRANSLATOR_SYSTEM_PROMPT: &str = r#"You are a graph-compiler assistant. You convert a plain-English description of
an automation pipeline into a single JSON object describing a node graph. You
must follow these rules exactly:

1. Output ONLY raw JSON. No markdown code fences, no prose before or after,
   no explanation. The first character of your output must be `{` and the
   last character must be `}`.
2. The JSON must conform to this shape:
   {
     "nodes": [
       { "id": string, "type": one of the 9 types listed below, "label": string,
         "position": { "x": number, "y": number }, "data": object (optional) }
     ],
     "edges": [
       { "id": string, "source": node id, "target": node id,
         "condition": string (optional, only on edges leaving a
         conditional_router node) }
     ],
     "meta": { "title": string, "generated_from_prompt": string }
   }
3. The ONLY valid values for "type" are exactly these 9 strings — never invent,
   rename, or abbreviate a type:
   file_watcher, image_input, text_input, local_embedder, chromadb_store,
   ollama_selector, conditional_router, local_file_writer, log_terminal
4. Populate each node's "data" field using exactly these per-type shapes and
   no other fields:
   - file_watcher: { "watch_path": string }
   - image_input: {}
   - text_input: { "default_text": string (optional) }
   - local_embedder: { "model": "nomic-embed-text" }
   - chromadb_store: { "collection_name": string, "mode": "read" | "write" }
   - ollama_selector: { "model": string }
   - conditional_router: { "condition_type": "has_image" | "has_text" | "custom",
     "expression": string (optional, only when condition_type is "custom") }
   - local_file_writer: { "output_path": string, "format": "md" | "txt" | "json" }
   - log_terminal: {}
5. Position values are rough left-to-right sequence hints only — set "x" to
   roughly (stage_index * 250) and "y" to 0 for a simple chain, spreading
   parallel branches vertically by 150 per branch. Exact final placement is
   recalculated by auto-layout after parsing, so precision here does not
   matter — sequence order does.
6. Every node must be reachable from at least one input node (file_watcher,
   image_input, or text_input) and the graph must be a DAG — never produce a
   cycle.
7. For a conditional_router node, create one edge per branch leaving it, each
   with a "condition" field matching one of that router's possible outcomes
   (e.g. "true" / "false" for has_image or has_text, or the router's
   "expression" value for a custom condition).
"#;

#[derive(Serialize)]
struct OllamaGenerateRequest<'a> {
    model: &'a str,
    system: &'a str,
    prompt: &'a str,
    stream: bool,
    format: &'a str,
}

#[derive(Deserialize)]
struct OllamaGenerateResponse {
    response: String,
    #[allow(dead_code)]
    done: bool,
    #[serde(default)]
    #[allow(dead_code)]
    model: Option<String>,
}

fn fallback_graph_compiler(prompt: &str) -> String {
    let lower = prompt.to_lowercase();
    let title = if prompt.trim().is_empty() {
        "Custom Automation Pipeline".to_string()
    } else {
        let first_words: Vec<&str> = prompt.trim().split_whitespace().take(6).collect();
        format!("{} Pipeline", first_words.join(" "))
    };

    let has_image = lower.contains("image") || lower.contains("photo") || lower.contains("picture") || lower.contains("vision");
    let has_file = lower.contains("file") || lower.contains("folder") || lower.contains("watch") || lower.contains("pdf") || lower.contains("doc") || lower.contains("csv");
    let has_rag = lower.contains("embed") || lower.contains("vector") || lower.contains("chroma") || lower.contains("search") || lower.contains("lookup") || lower.contains("rag") || lower.contains("policy");
    let has_condition = lower.contains("if") || lower.contains("filter") || lower.contains("check") || lower.contains("urgent") || lower.contains("route");
    let has_log = lower.contains("log") || lower.contains("terminal") || lower.contains("console") || lower.contains("alert");
    let has_writer = lower.contains("save") || lower.contains("write") || lower.contains("report") || lower.contains("output") || !has_log;

    let mut nodes: Vec<serde_json::Value> = Vec::new();
    let mut edges: Vec<serde_json::Value> = Vec::new();

    let mut node_count = 1;
    let mut next_id = || {
        let id = format!("n{node_count}");
        node_count += 1;
        id
    };

    let primary_input = if has_image && has_file {
        let img_id = next_id();
        nodes.push(serde_json::json!({ "id": img_id, "type": "image_input", "label": "Image Input", "position": { "x": 0, "y": 0 }, "data": {} }));
        let file_id = next_id();
        nodes.push(serde_json::json!({ "id": file_id, "type": "file_watcher", "label": "Document Input", "position": { "x": 0, "y": 150 }, "data": { "watch_path": "" } }));
        img_id
    } else if has_image {
        let id = next_id();
        nodes.push(serde_json::json!({ "id": id, "type": "image_input", "label": "Image Input", "position": { "x": 0, "y": 0 }, "data": {} }));
        id
    } else if has_file {
        let id = next_id();
        nodes.push(serde_json::json!({ "id": id, "type": "file_watcher", "label": "Watch Folder / Files", "position": { "x": 0, "y": 0 }, "data": { "watch_path": "" } }));
        id
    } else {
        let id = next_id();
        nodes.push(serde_json::json!({ "id": id, "type": "text_input", "label": "User Input", "position": { "x": 0, "y": 0 }, "data": { "default_text": prompt } }));
        id
    };

    let mut current_x = 250;
    let mut last_node_id = primary_input.clone();

    // RAG step
    let mut rag_store_id: Option<String> = None;
    if has_rag {
        let emb_id = next_id();
        nodes.push(serde_json::json!({ "id": emb_id, "type": "local_embedder", "label": "Embed Text (nomic-embed)", "position": { "x": current_x, "y": 0 }, "data": { "model": "nomic-embed-text" } }));
        edges.push(serde_json::json!({ "id": format!("e_{}_{}", primary_input, emb_id), "source": primary_input, "target": emb_id }));

        let store_id = next_id();
        let mode = if lower.contains("search") || lower.contains("lookup") || lower.contains("read") { "read" } else { "write" };
        nodes.push(serde_json::json!({ "id": store_id, "type": "chromadb_store", "label": "ChromaDB Knowledge Base", "position": { "x": current_x + 250, "y": 0 }, "data": { "collection_name": "local_kb", "mode": mode } }));
        edges.push(serde_json::json!({ "id": format!("e_{}_{}", emb_id, store_id), "source": emb_id, "target": store_id }));

        rag_store_id = Some(store_id.clone());
        last_node_id = store_id;
        current_x += 500;
    }

    // Router step
    let mut router_id: Option<String> = None;
    if has_condition {
        let r_id = next_id();
        let expr = if lower.contains("urgent") { "urgent" } else { "has_text" };
        nodes.push(serde_json::json!({ "id": r_id, "type": "conditional_router", "label": "Condition Filter", "position": { "x": current_x, "y": 0 }, "data": { "condition_type": "custom", "expression": expr } }));
        edges.push(serde_json::json!({ "id": format!("e_{}_{}", last_node_id, r_id), "source": last_node_id, "target": r_id }));
        router_id = Some(r_id.clone());
        last_node_id = r_id;
        current_x += 250;
    }

    // LLM step
    let llm_id = next_id();
    let model = if has_image { "llama3.2-vision" } else { "llama3.2" };
    let label = if has_image { "Vision AI Check" } else if lower.contains("summary") { "AI Summarizer" } else { "Local AI Generator" };
    nodes.push(serde_json::json!({ "id": llm_id, "type": "ollama_selector", "label": label, "position": { "x": current_x, "y": if router_id.is_some() { -75 } else { 0 } }, "data": { "model": model } }));

    if let Some(ref r_id) = router_id {
        edges.push(serde_json::json!({ "id": format!("e_{}_{}", r_id, llm_id), "source": r_id, "target": llm_id, "condition": "true" }));
    } else {
        edges.push(serde_json::json!({ "id": format!("e_{}_{}", last_node_id, llm_id), "source": last_node_id, "target": llm_id }));
    }

    if let Some(ref store_id) = rag_store_id {
        if primary_input != last_node_id {
            edges.push(serde_json::json!({ "id": format!("e_{}_{}", store_id, llm_id), "source": store_id, "target": llm_id }));
        }
    }

    // Logger branch
    if has_log {
        let log_id = next_id();
        nodes.push(serde_json::json!({ "id": log_id, "type": "log_terminal", "label": "Log Alert Terminal", "position": { "x": current_x + 250, "y": 75 }, "data": {} }));
        if let Some(ref r_id) = router_id {
            edges.push(serde_json::json!({ "id": format!("e_{}_{}", r_id, log_id), "source": r_id, "target": log_id, "condition": "false" }));
        } else {
            edges.push(serde_json::json!({ "id": format!("e_{}_{}", llm_id, log_id), "source": llm_id, "target": log_id }));
        }
    }

    // Writer output
    if has_writer {
        let writer_id = next_id();
        let fmt = if lower.contains("json") { "json" } else if lower.contains("txt") { "txt" } else { "md" };
        nodes.push(serde_json::json!({ "id": writer_id, "type": "local_file_writer", "label": "Write Output File", "position": { "x": current_x + 250, "y": 0 }, "data": { "output_path": "", "format": fmt } }));
        edges.push(serde_json::json!({ "id": format!("e_{}_{}", llm_id, writer_id), "source": llm_id, "target": writer_id }));
    }

    serde_json::json!({
        "version": 1,
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "title": title,
            "generated_from_prompt": prompt
        }
    }).to_string()
}

#[tauri::command]
pub async fn generate_graph(
    prompt: String,
    model: Option<String>,
    system_prompt_override: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model_to_use = model.as_deref().unwrap_or("qwen2.5vl:7b");
    let system_to_use = system_prompt_override.as_deref().unwrap_or(TRANSLATOR_SYSTEM_PROMPT);

    let body = OllamaGenerateRequest {
        model: model_to_use,
        system: system_to_use,
        prompt: &prompt,
        stream: false,
        format: "json",
    };

    let resp = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await;

    match resp {
        Ok(res) => {
            if let Ok(parsed) = res.json::<OllamaGenerateResponse>().await {
                Ok(parsed.response)
            } else {
                Ok(fallback_graph_compiler(&prompt))
            }
        }
        Err(_) => Ok(fallback_graph_compiler(&prompt)),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Existing Pipeline Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_ollama_models() -> Result<Vec<String>, String> {
    crate::ollama::list_ollama_models().await.or_else(|_| {
        Ok(vec![
            "qwen2.5vl:7b".to_string(),
            "qwen2.5:latest".to_string(),
            "llama3.2:latest".to_string(),
            "llama3.2-vision:latest".to_string(),
            "qwen2.5:latest".to_string(),
            "nomic-embed-text:latest".to_string(),
        ])
    })
}

#[tauri::command]
pub async fn pull_model<R: tauri::Runtime>(app: tauri::AppHandle<R>, model: String) -> Result<(), String> {
    crate::ollama::pull_model(app, model).await
}

#[tauri::command]
pub async fn save_agent_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    default_filename: String,
    content: String,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .set_file_name(&default_filename)
        .add_filter("JSON Agent Pipeline", &["json"])
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            std::fs::write(&path_str, content)
                .map_err(|e| format!("Failed to save agent file: {e}"))?;
            Ok(path_str)
        }
        None => Err("Save cancelled".to_string()),
    }
}

#[tauri::command]
pub async fn pick_folder<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    match folder {
        Some(path) => Ok(path.to_string()),
        None => Err("No folder selected".to_string()),
    }
}

#[tauri::command]
pub async fn pick_image<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app
        .dialog()
        .file()
        .add_filter("Image", &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file();
    match file {
        Some(path) => Ok(path.to_string()),
        None => Err("No image selected".to_string()),
    }
}

#[tauri::command]
pub async fn execute_graph<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    graph: crate::executor::GraphState,
) -> Result<(), String> {
    crate::executor::execute_graph_pipeline(app, graph).await
}

#[tauri::command]
pub async fn start_file_watch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, WatcherState>,
    path: String,
    node_id: String,
) -> Result<(), String> {
    let watcher = crate::watcher::start_watching(app, node_id.clone(), path)?;
    let mut map = state
        .watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    map.insert(node_id, watcher);
    Ok(())
}

#[tauri::command]
pub async fn stop_file_watch(
    state: tauri::State<'_, WatcherState>,
    node_id: String,
) -> Result<(), String> {
    let mut map = state
        .watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    map.remove(&node_id);
    Ok(())
}

#[tauri::command]
pub async fn write_output(
    path: String,
    content: String,
    format: String,
) -> Result<(), String> {
    let target_file = format!("{}/output.{}", path.trim_end_matches('/'), format);
    std::fs::write(&target_file, content)
        .map_err(|e| format!("Failed to write output to {target_file}: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn load_agent_file<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app
        .dialog()
        .file()
        .add_filter("JSON Agent Pipeline", &["json"])
        .blocking_pick_file();

    match file {
        Some(path) => {
            let path_str = path.to_string();
            std::fs::read_to_string(&path_str)
                .map_err(|e| format!("Failed to read agent file: {e}"))
        }
        None => Err("No file selected".to_string()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AutoAgent Mode Commands — Hybrid Local AI Hub Zero-Code Agent Framework
// ─────────────────────────────────────────────────────────────────────────────

/// User Mode (Deep Research): Runs a multi-agent task with Orchestrator + Sub-agents.
#[tauri::command]
pub async fn run_autoagent_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    task: String,
    model: Option<String>,
) -> Result<crate::agent_runner::AgentRunResult, String> {
    let model_name = model.unwrap_or_else(|| "qwen2.5vl:7b".to_string());

    let orchestrator_prompt = r#"You are the Orchestrator Agent of Hybrid Local AI Hub — a fully autonomous, zero-code, offline AI system inspired by AutoAgent.
Your role: analyze the user's task, break it down, and coordinate specialized sub-agents to complete it.

Sub-Agents you can delegate to:
- Local File Agent: reads, writes, searches, copies, deletes local files and directories
- Coding Agent: writes Python code, executes it (with auto-error-fixing), saves results to files

Tool Calling Format (MANDATORY — always use this exact XML):
<function=tool_name><parameter=param_name>value</parameter></function>

Handoff Tools:
<function=transfer_to_coding_agent><parameter=task>specific coding task</parameter></function>
<function=transfer_to_local_file_agent><parameter=task>specific file task</parameter></function>
<function=transfer_back_to_orchestrator><parameter=result>sub-agent's result summary</parameter></function>
<function=final_answer><parameter=answer>your complete, comprehensive final answer</parameter></function>

Direct Tools (use without handoff when appropriate):
<function=call_llm><parameter=model>llama3.2</parameter><parameter=prompt>your prompt</parameter></function>

Strategy:
1. Analyze the task thoroughly
2. If it requires file I/O → delegate to Local File Agent
3. If it requires computation, data processing, or code → delegate to Coding Agent
4. Collect sub-agent results via transfer_back_to_orchestrator
5. Synthesize all results into a comprehensive final answer
6. ALWAYS end with <function=final_answer> when done

Never leave a task incomplete. Always produce a final answer."#.to_string();

    let coding_agent_prompt = r#"You are the Coding Agent of Hybrid Local AI Hub.
Your role: write Python code, execute it, see the output, fix errors (automatically retried up to 5x), and save results.

Available Tools:
<function=run_python><parameter=code>python code</parameter></function>
  → Executes Python. On error, the system auto-fixes and retries up to 5 times.
<function=write_file><parameter=path>output/path.ext</parameter><parameter=content>file content</parameter></function>
  → Write any file to disk (creates parent directories automatically)
<function=append_file><parameter=path>output/path.ext</parameter><parameter=content>text to append</parameter></function>
  → Append to an existing file
<function=read_file><parameter=path>filepath</parameter></function>
  → Read a file's content
<function=list_files><parameter=path>directory</parameter></function>
  → List directory contents
<function=run_shell><parameter=command>shell command</parameter></function>
  → Run cross-platform shell commands (Windows: cmd, Linux/Mac: bash)
<function=call_llm><parameter=model>llama3.2</parameter><parameter=prompt>prompt</parameter></function>
  → Call another LLM for analysis
<function=transfer_back_to_orchestrator><parameter=result>what you accomplished</parameter></function>
  → Return results to the Orchestrator

Best Practices:
- Always import necessary libraries at the top of your code
- Use try/except for error handling
- Print results so you can see the output
- Save important results to files using write_file
- When code runs successfully, report back with transfer_back_to_orchestrator"#.to_string();

    let file_agent_prompt = r#"You are the Local File Agent of Hybrid Local AI Hub.
Your role: read, write, search, organize, and manage local files and directories.

Available Tools:
<function=read_file><parameter=path>filepath</parameter></function>
  → Read file content (up to 6000 chars, truncated if larger)
<function=write_file><parameter=path>filepath</parameter><parameter=content>content</parameter></function>
  → Write content to a file (auto-creates parent directories)
<function=append_file><parameter=path>filepath</parameter><parameter=content>text to append</parameter></function>
  → Append to a file
<function=list_files><parameter=path>directory</parameter></function>
  → List directory with file sizes (2-level recursive)
<function=search_file><parameter=path>filepath</parameter><parameter=query>search term</parameter></function>
  → Search for text in a file, returns matching lines with line numbers
<function=copy_file><parameter=src>source</parameter><parameter=dst>destination</parameter></function>
  → Copy a file
<function=delete_file><parameter=path>filepath</parameter></function>
  → Delete a file
<function=get_file_info><parameter=path>filepath</parameter></function>
  → Get file metadata (size, type, modification time)
<function=transfer_back_to_orchestrator><parameter=result>what you found/did</parameter></function>
  → Return results to the Orchestrator

Best Practices:
- Always list_files first to understand the directory structure
- Read relevant files before writing new ones
- Include file paths in your result summary
- When writing output files, confirm success and report the path"#.to_string();

    let result = crate::agent_runner::run_user_mode_task(
        app,
        task,
        model_name,
        orchestrator_prompt,
        coding_agent_prompt,
        file_agent_prompt,
        15, // increased max rounds for complex tasks
    )
    .await;

    Ok(result)
}

/// Agent Editor: Profile agent requirements using natural language.
/// Returns XML agent specification + writes runnable agent.py to disk.
#[tauri::command]
pub async fn profile_agent_requirement(
    requirement: String,
    model: Option<String>,
) -> Result<String, String> {
    let model_name = model.unwrap_or_else(|| "qwen2.5vl:7b".to_string());

    let profiling_prompt = format!(
        r#"You are an Agent Profiling specialist for Hybrid Local AI Hub — an AutoAgent-inspired, fully offline, zero-code AI framework.
Your job: given a user's requirement, design a complete, executable agent specification.

Output a complete XML specification in this EXACT format (no deviations):
<agents>
  <agent>
    <name>AgentName</name>
    <description>Concise description of what this agent does</description>
    <instruction>Detailed, specific system prompt that tells the agent exactly how to behave, what to do step by step, and how to use its tools effectively</instruction>
    <tools>
      <tool>tool_name_1</tool>
      <tool>tool_name_2</tool>
    </tools>
    <output>What this agent produces (file path, console output, etc.)</output>
  </agent>
</agents>

Available tools (pick only those needed):
- read_file: Read any local file
- write_file: Write/create files  
- append_file: Append to existing files
- list_files: List directory contents
- search_file: Search text in files
- copy_file: Copy files
- delete_file: Delete files
- get_file_info: Get file metadata
- run_python: Execute Python code (auto-retries errors up to 5x)
- run_shell: Run shell commands (cross-platform)
- call_llm: Call local Ollama LLM models
- register_tool: Save a custom Python tool
- final_answer: Submit the final answer

IMPORTANT: The instruction field must be a complete, detailed system prompt that makes the agent fully functional without additional input.
Include step-by-step instructions for exactly how the agent should use its tools to accomplish the task.

User Requirement: {requirement}

Generate the complete XML agent specification:"#
    );

    // First attempt
    let mut response = crate::ollama::generate(&model_name, &profiling_prompt, None)
        .await
        .unwrap_or_default();

    // Validation loop: verify the XML has required fields, fix if not (up to 2 rounds)
    for _validation_round in 0..2 {
        let has_name = response.contains("<name>");
        let has_instruction = response.contains("<instruction>");
        let has_tools = response.contains("<tool>");
        let has_agents = response.contains("<agents>");

        if has_name && has_instruction && has_tools && has_agents {
            break; // Valid spec
        }

        // Fix incomplete spec
        let fix_prompt = format!(
            "The following agent specification is incomplete or malformed. Fix it to include all required XML fields: <agents>, <agent>, <name>, <description>, <instruction>, <tools>, <tool>, <output>.

Incomplete spec:
{response}

Original requirement: {requirement}

Output only the corrected complete XML spec:"
        );
        response = crate::ollama::generate(&model_name, &fix_prompt, None)
            .await
            .unwrap_or_else(|_| response.clone());
    }

    // Fallback if still empty/invalid
    if !response.contains("<agent>") {
        let safe_name = requirement.split_whitespace().take(3).collect::<Vec<_>>().join("_");
        response = format!(
            r#"<agents>
  <agent>
    <name>{safe_name}Agent</name>
    <description>Agent for: {requirement}</description>
    <instruction>You are a specialized AI agent for: {requirement}.

Step 1: Use list_files or read_file to understand what data is available.
Step 2: Use run_python to process data or perform computations as needed.
Step 3: Use write_file to save your results.
Step 4: Use final_answer to report your findings.

Always use tools to accomplish real work. Do not just describe what you would do — actually do it.</instruction>
    <tools>
      <tool>read_file</tool>
      <tool>list_files</tool>
      <tool>write_file</tool>
      <tool>run_python</tool>
      <tool>call_llm</tool>
      <tool>final_answer</tool>
    </tools>
    <output>Results written to output file and reported via final_answer</output>
  </agent>
</agents>"#
        );
    }

    // Write the generated agent to disk as a runnable Python file
    let agent_name = extract_xml_field(&response, "name")
        .unwrap_or_else(|| "GeneratedAgent".to_string());
    let instructions = extract_xml_field(&response, "instruction")
        .unwrap_or_else(|| "You are a helpful AI agent.".to_string());
    let tools: Vec<String> = extract_all_xml_fields(&response, "tool");

    let _ = crate::python_sandbox::write_agent_to_disk(
        &agent_name,
        &instructions,
        &tools,
        &model_name,
    ).await;

    Ok(response)
}

/// Extracts all occurrences of a tag (for multi-value fields like <tool>).
fn extract_all_xml_fields(xml: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut result = Vec::new();
    let mut search = 0;
    while let Some(start) = xml[search..].find(&open) {
        let abs_start = search + start + open.len();
        if let Some(end) = xml[abs_start..].find(&close) {
            result.push(xml[abs_start..abs_start + end].trim().to_string());
            search = abs_start + end + close.len();
        } else {
            break;
        }
    }
    result
}

/// Agent Editor: Creates and tests a Python tool with self-play retry loop.
/// Registers it in user_tools/ on success.
#[tauri::command]
pub async fn create_and_test_tool(
    tool_name: String,
    tool_description: String,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    let model_name = model.unwrap_or_else(|| "qwen2.5vl:7b".to_string());

    let gen_prompt = format!(
        r#"Write a complete, working Python function for Hybrid Local AI Hub.

Tool Name: {tool_name}
Description: {tool_description}

Requirements:
1. Create a Python function with clear type-annotated parameters and return value
2. Add a detailed docstring explaining what the tool does, its parameters, and return value
3. Include the decorator comment: # @register_plugin_tool
4. Handle ALL errors gracefully with try/except — never let the tool raise an unhandled exception
5. Add a __main__ block with a realistic test that prints meaningful output
6. Use only Python standard library (no third-party packages unless absolutely necessary)
7. Output ONLY the Python code. No markdown code fences, no explanations.

Python code:"#
    );

    let initial_code = crate::ollama::generate(&model_name, &gen_prompt, None)
        .await
        .unwrap_or_else(|_| format!(
            r#"# @register_plugin_tool
def {tool_name}(input_text: str) -> str:
    """
    {tool_description}
    
    Args:
        input_text: The input text to process
    Returns:
        Processed result as string
    """
    try:
        result = f"Processed by {tool_name}: {{input_text}}"
        return result
    except Exception as e:
        return f"Error in {tool_name}: {{e}}"

if __name__ == '__main__':
    test_result = {tool_name}("test input")
    print(f"Test passed: {{test_result}}")
"#
        ));

    let mut clean_code = initial_code
        .replace("```python", "")
        .replace("```py", "")
        .replace("```", "")
        .trim()
        .to_string();

    // Self-play retry loop: test the code, fix errors up to 3 times
    let mut final_test_result = crate::python_sandbox::SandboxResult {
        success: false,
        stdout: String::new(),
        stderr: "Not executed yet".to_string(),
        exit_code: -1,
    };

    for attempt in 0..=3 {
        let test_result = crate::python_sandbox::run_python_script(&clean_code, None)
            .await
            .unwrap_or_else(|e| crate::python_sandbox::SandboxResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Python unavailable: {e}"),
                exit_code: -1,
            });

        final_test_result = test_result.clone();

        if test_result.success {
            break; // Tool works!
        }

        if attempt < 3 {
            // Self-play: ask LLM to fix the error
            let fix_prompt = format!(
                "Fix this Python tool. Return ONLY corrected Python code, no markdown fences.\n\nTool: {tool_name}\nDescription: {tool_description}\n\nBroken Code:\n{clean_code}\n\nError:\n{}\n\nFixed Python code:",
                &test_result.stderr[..test_result.stderr.len().min(600)]
            );
            let fixed = crate::ollama::generate(&model_name, &fix_prompt, None)
                .await
                .unwrap_or_else(|_| clean_code.clone());
            clean_code = fixed
                .replace("```python", "")
                .replace("```py", "")
                .replace("```", "")
                .trim()
                .to_string();
        }
    }

    // Register tool regardless of test result (user can still use it)
    let register_msg = crate::python_sandbox::register_tool(&tool_name, &clean_code, "./user_tools")
        .await
        .unwrap_or_else(|e| format!("Registration note: {e}"));

    Ok(serde_json::json!({
        "tool_name": tool_name,
        "generated_code": clean_code,
        "test_stdout": final_test_result.stdout,
        "test_stderr": final_test_result.stderr,
        "test_success": final_test_result.success,
        "exit_code": final_test_result.exit_code,
        "register_message": register_msg
    }))
}

/// Run a custom-defined agent (from Agent Editor) on a specific task.
#[tauri::command]
pub async fn run_custom_agent<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    agent_name: String,
    instructions: String,
    tools: Vec<String>,
    task: String,
    model: Option<String>,
) -> Result<crate::agent_runner::AgentRunResult, String> {
    let model_name = model.unwrap_or_else(|| "qwen2.5vl:7b".to_string());
    let result = crate::agent_runner::run_custom_agent(
        app,
        agent_name,
        instructions,
        task,
        tools,
        model_name,
        15,
    ).await;
    Ok(result)
}

/// Returns list of all generated agent directories with their README content.
#[tauri::command]
pub async fn get_generated_agents() -> Result<Vec<serde_json::Value>, String> {
    let agents_dir = std::path::Path::new("./generated_agents");
    if !agents_dir.exists() {
        return Ok(vec![]);
    }

    let mut agents = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(agents_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                let agent_py = path.join("agent.py");
                let readme = path.join("README.md");
                let name = path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                let has_agent_py = agent_py.exists();
                let readme_content = tokio::fs::read_to_string(&readme)
                    .await
                    .unwrap_or_default();
                let agent_code_preview = if has_agent_py {
                    tokio::fs::read_to_string(&agent_py)
                        .await
                        .map(|c| c[..c.len().min(500)].to_string())
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                agents.push(serde_json::json!({
                    "name": name,
                    "path": path.to_string_lossy(),
                    "has_agent_py": has_agent_py,
                    "readme": readme_content,
                    "code_preview": agent_code_preview,
                }));
            }
        }
    }
    Ok(agents)
}

/// Workflow Editor: Profiles workflow requirements and generates XML workflow spec.
#[tauri::command]
pub async fn profile_workflow_requirement(
    requirement: String,
    model: Option<String>,
) -> Result<String, String> {
    let model_name = model.unwrap_or_else(|| "qwen2.5vl:7b".to_string());

    let profiling_prompt = format!(
        r#"You are a Workflow Profiling specialist for Hybrid Local AI Hub.
Given a workflow requirement, generate a structured XML workflow specification.

Output in this exact XML format:
<workflow>
  <title>Workflow Title</title>
  <pattern>sequential|if_else|parallelization|evaluator_optimizer</pattern>
  <input>input_variable_name</input>
  <events>
    <event>
      <name>event_name</name>
      <agent>Agent Name</agent>
      <listen>input_variable</listen>
      <action>What this agent does with the input</action>
      <output>output_variable_name</output>
      <goto>next_event_name (optional)</goto>
    </event>
  </events>
</workflow>

Pattern guidelines:
- sequential: events run one after another, output feeds next
- if_else: first event evaluates condition, routes to true/false branch
- parallelization: all events run concurrently and vote on best answer
- evaluator_optimizer: generator + evaluator loop with GOTO for iteration

User Requirement: {requirement}

Generate the complete XML workflow specification:"#
    );

    let response = crate::ollama::generate(&model_name, &profiling_prompt, None)
        .await
        .unwrap_or_else(|_| format!(
            r#"<workflow>
  <title>Custom Workflow</title>
  <pattern>sequential</pattern>
  <input>user_input</input>
  <events>
    <event>
      <name>process</name>
      <agent>AI Agent</agent>
      <listen>user_input</listen>
      <action>Process the input and generate a comprehensive response for: {requirement}</action>
      <output>result</output>
    </event>
  </events>
</workflow>"#
        ));

    Ok(response)
}

/// Workflow Editor: Parses XML spec and executes the workflow.
#[tauri::command]
pub async fn execute_xml_workflow<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    workflow_xml: String,
    input: String,
    model: Option<String>,
) -> Result<crate::agent_runner::AgentRunResult, String> {
    let model_name = model.unwrap_or_else(|| "qwen2.5vl:7b".to_string());
    let spec = parse_workflow_xml(&workflow_xml, &input)?;
    let result = crate::agent_runner::execute_xml_workflow(app, spec, input, model_name).await;
    Ok(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// XML Workflow Parsing Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn parse_workflow_xml(xml: &str, default_input: &str) -> Result<crate::agent_runner::WorkflowSpec, String> {
    use crate::agent_runner::{WorkflowEvent, WorkflowPattern, WorkflowSpec};

    let title = extract_xml_field(xml, "title")
        .unwrap_or_else(|| "Untitled Workflow".to_string());

    let pattern_str = extract_xml_field(xml, "pattern")
        .unwrap_or_else(|| "sequential".to_string());
    let pattern = match pattern_str.trim().to_lowercase().as_str() {
        "if_else" | "ifelse" | "if-else" => WorkflowPattern::IfElse,
        "parallelization" | "parallel" | "voting" => WorkflowPattern::Parallelization,
        "evaluator_optimizer" | "evaluator-optimizer" | "eval_opt" => WorkflowPattern::EvaluatorOptimizer,
        _ => WorkflowPattern::Sequential,
    };

    let input = extract_xml_field(xml, "input")
        .unwrap_or_else(|| default_input.to_string());

    let mut events: Vec<WorkflowEvent> = Vec::new();
    let events_section = extract_xml_field(xml, "events").unwrap_or_default();

    let mut event_search = 0;
    while let Some(ev_start) = events_section[event_search..].find("<event>") {
        let abs_ev_start = event_search + ev_start;
        let ev_end = match events_section[abs_ev_start..].find("</event>") {
            Some(pos) => abs_ev_start + pos,
            None => break,
        };
        let event_xml = &events_section[abs_ev_start..ev_end + "</event>".len()];

        events.push(WorkflowEvent {
            name: extract_xml_field(event_xml, "name")
                .unwrap_or_else(|| format!("event_{}", events.len() + 1)),
            agent: extract_xml_field(event_xml, "agent")
                .unwrap_or_else(|| "AI Agent".to_string()),
            listen: extract_xml_field(event_xml, "listen")
                .unwrap_or_else(|| "input".to_string()),
            action: extract_xml_field(event_xml, "action")
                .unwrap_or_else(|| "Process the input".to_string()),
            output: extract_xml_field(event_xml, "output")
                .unwrap_or_else(|| "result".to_string()),
            goto: extract_xml_field(event_xml, "goto"),
            abort_on_fail: false,
        });
        event_search = ev_end + "</event>".len();
    }

    if events.is_empty() {
        events.push(WorkflowEvent {
            name: "default_step".to_string(),
            agent: "AI Agent".to_string(),
            listen: "input".to_string(),
            action: "Process the given input and provide a comprehensive response".to_string(),
            output: "result".to_string(),
            goto: None,
            abort_on_fail: false,
        });
    }

    Ok(WorkflowSpec { title, pattern, input, events })
}

fn extract_xml_field(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close).map(|pos| start + pos)?;
    Some(xml[start..end].trim().to_string())
}
