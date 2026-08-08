/**
 * AutoAgentAgentEditor.tsx
 * Agent Editor (Zero-Code Agent & Tool Creation) for Hybrid Local AI Hub.
 * Inspired by AutoAgent (HKUDS): Agent Profiling → Tool Creation → Live Execution & JSON/XML Export.
 * 100% offline via local Ollama LLMs. Real execution only — no mocks.
 */
import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAgentStore, type CreatedTool, type TrajectoryStep, type AgentRunResult } from "../lib/useAgentStore";
import { parseAgentSpec, agentSpecToXml } from "../lib/xmlParser";
import { useGraphStore } from "../lib/useGraphStore";
import { autoLayout } from "../lib/autoLayout";

const STEP_LABELS = ["1. Requirement", "2. Profiling & Tools", "3. Test & Export"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Requirement Input
// ─────────────────────────────────────────────────────────────────────────────

function StepRequirement(): React.JSX.Element {
  const {
    agentRequirement, setAgentRequirement, setAgentEditorStep, setAgentSpecXml,
    setParsedAgentSpec, isAgentEditorRunning, setIsAgentEditorRunning, selectedModel
  } = useAgentStore();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const SAMPLE_REQUIREMENTS = [
    "Create a financial analysis agent that reads CSV files, computes key financial metrics, and generates markdown reports",
    "Build a code review agent that reads Python source files, identifies bugs, style issues, and suggests improvements",
    "Create a document search agent that indexes local PDF and text files and answers questions using RAG",
    "Build a data pipeline agent that monitors a folder for new CSV files, processes them, and writes results to a database",
  ];

  const handleProfile = async () => {
    if (!agentRequirement.trim() || isAgentEditorRunning) return;
    setIsAgentEditorRunning(true);
    setErrorMsg(null);
    setAgentEditorStep("profiling");

    try {
      const xmlResponse = await invoke<string>("profile_agent_requirement", {
        requirement: agentRequirement,
        model: selectedModel,
      });

      setAgentSpecXml(xmlResponse);
      const parsed = parseAgentSpec(xmlResponse);
      setParsedAgentSpec(parsed);
      setAgentEditorStep("tools");
    } catch (err) {
      setErrorMsg(`Failed to profile agent requirement: ${String(err)}. Make sure Ollama is running ('ollama serve').`);
    } finally {
      setIsAgentEditorRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-slate-50 border-2 border-slate-200 rounded-lg p-3">
        <h3 className="text-xs font-bold text-slate-700 mb-2">💡 What agent do you want to create?</h3>
        <textarea
          value={agentRequirement}
          onChange={(e) => setAgentRequirement(e.target.value)}
          placeholder="Describe the agent you want to create in plain English..."
          className="w-full h-24 bg-white border-2 border-slate-900 rounded p-2.5 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-600 resize-none font-medium"
          disabled={isAgentEditorRunning}
        />
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] font-bold text-slate-500">Quick start examples:</p>
          {SAMPLE_REQUIREMENTS.map((req, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setAgentRequirement(req)}
              className="w-full text-left text-[10px] text-violet-800 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded px-2 py-1.5 font-medium transition-colors cursor-pointer"
            >
              {req}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-50 border-2 border-rose-300 text-rose-800 rounded p-2.5 text-[10px] font-bold">
          {errorMsg}
        </div>
      )}

      <button
        type="button"
        onClick={handleProfile}
        disabled={isAgentEditorRunning || !agentRequirement.trim()}
        className="w-full py-2.5 font-bold text-xs text-white bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:text-slate-500 rounded border-2 border-slate-900 transition-colors cursor-pointer flex items-center justify-center gap-2"
      >
        {isAgentEditorRunning ? (
          <>
            <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
            Profiling Agent with {selectedModel}...
          </>
        ) : (
          "🤖 Profile Agent Requirement"
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2/3: Agent Profiling Result + Tool Creation + Execution
// ─────────────────────────────────────────────────────────────────────────────

function StepToolsAndAgent(): React.JSX.Element {
  const {
    parsedAgentSpec, agentSpecXml, setAgentSpecXml, setParsedAgentSpec,
    createdTools, addCreatedTool, removeCreatedTool,
    isAgentEditorRunning, setIsAgentEditorRunning, setAgentEditorStep,
    selectedModel,
  } = useAgentStore();

  const [toolName, setToolName] = useState("");
  const [toolDesc, setToolDesc] = useState("");
  const [selectedToolResult, setSelectedToolResult] = useState<CreatedTool | null>(null);
  const [showXmlEditor, setShowXmlEditor] = useState(false);
  const [editedXml, setEditedXml] = useState(agentSpecXml);
  const [toolErrorMsg, setToolErrorMsg] = useState<string | null>(null);

  const handleCreateTool = async () => {
    if (!toolName.trim() || isAgentEditorRunning) return;
    setIsAgentEditorRunning(true);
    setToolErrorMsg(null);

    try {
      const raw = await invoke<{
        tool_name: string;
        generated_code: string;
        test_stdout: string;
        test_stderr: string;
        test_success: boolean;
        exit_code: number;
        register_message: string;
      }>("create_and_test_tool", {
        toolName: toolName.trim(),
        toolDescription: toolDesc.trim() || `Tool: ${toolName}`,
        model: selectedModel,
      });

      const result: CreatedTool = {
        toolName: raw.tool_name,
        generatedCode: raw.generated_code,
        testStdout: raw.test_stdout,
        testStderr: raw.test_stderr,
        testSuccess: raw.test_success,
        exitCode: raw.exit_code,
        registerMessage: raw.register_message,
        timestamp: new Date().toLocaleTimeString(),
      };

      addCreatedTool(result);
      setSelectedToolResult(result);
      setToolName("");
      setToolDesc("");
    } catch (err) {
      setToolErrorMsg(`Failed to create tool: ${String(err)}`);
    } finally {
      setIsAgentEditorRunning(false);
    }
  };

  const handleUpdateXml = () => {
    try {
      setAgentSpecXml(editedXml);
      const parsed = parseAgentSpec(editedXml);
      setParsedAgentSpec(parsed);
      setShowXmlEditor(false);
    } catch {
      // keep editor open on parse error
    }
  };

  return (
    <div className="space-y-4">
      {/* Agent Profile Card */}
      {parsedAgentSpec && parsedAgentSpec.agents.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-700">🤖 Generated Agent Profile</h3>
            <button
              type="button"
              onClick={() => { setShowXmlEditor(!showXmlEditor); setEditedXml(agentSpecXml); }}
              className="text-[10px] font-bold text-violet-700 hover:text-violet-900 cursor-pointer"
            >
              {showXmlEditor ? "▲ Hide XML" : "✏️ Edit XML"}
            </button>
          </div>

          {showXmlEditor ? (
            <div>
              <textarea
                value={editedXml}
                onChange={(e) => setEditedXml(e.target.value)}
                className="w-full h-48 font-mono text-[10px] bg-slate-900 text-green-400 border-2 border-slate-700 rounded p-2 resize-none focus:outline-none focus:border-violet-500"
              />
              <button
                type="button"
                onClick={handleUpdateXml}
                className="mt-1 text-[11px] font-bold px-3 py-1 bg-violet-600 text-white border-2 border-slate-900 rounded hover:bg-violet-700 cursor-pointer"
              >
                Apply Changes
              </button>
            </div>
          ) : (
            parsedAgentSpec.agents.map((agent, i) => (
              <div key={i} className="bg-violet-50 border-2 border-violet-300 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">🤖</span>
                  <div>
                    <div className="text-xs font-bold text-violet-900">{agent.name}</div>
                    <div className="text-[10px] text-violet-700">{agent.description}</div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-700 bg-white border border-slate-200 rounded p-2 max-h-20 overflow-y-auto">
                  {agent.instruction}
                </div>
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map((t) => (
                    <span key={t} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white border border-violet-300 text-violet-800">
                      🔧 {t}
                    </span>
                  ))}
                </div>
                <div className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                  <span className="font-bold">Output:</span> {agent.output}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tool Creation */}
      <div className="bg-slate-50 border-2 border-slate-200 rounded-lg p-3">
        <h3 className="text-xs font-bold text-slate-700 mb-2">🔧 Create Python Tool for Agent</h3>
        <input
          type="text"
          value={toolName}
          onChange={(e) => setToolName(e.target.value)}
          placeholder="Tool name (e.g. calculate_metrics)"
          className="w-full bg-white border-2 border-slate-900 rounded px-2.5 py-1.5 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-600 font-medium mb-2"
          disabled={isAgentEditorRunning}
        />
        <input
          type="text"
          value={toolDesc}
          onChange={(e) => setToolDesc(e.target.value)}
          placeholder="Tool description (e.g. Calculates statistical metrics from numbers)"
          className="w-full bg-white border-2 border-slate-900 rounded px-2.5 py-1.5 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-600 font-medium mb-2"
          disabled={isAgentEditorRunning}
        />

        {toolErrorMsg && (
          <div className="mb-2 text-[10px] bg-rose-50 border border-rose-300 text-rose-800 font-bold p-1.5 rounded">
            {toolErrorMsg}
          </div>
        )}

        <button
          type="button"
          onClick={handleCreateTool}
          disabled={isAgentEditorRunning || !toolName.trim()}
          className="w-full py-2 font-bold text-xs text-white bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 disabled:text-slate-500 rounded border-2 border-slate-900 transition-colors cursor-pointer flex items-center justify-center gap-2"
        >
          {isAgentEditorRunning ? (
            <>
              <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Generating & Testing Tool...
            </>
          ) : (
            "⚡ Generate & Test Tool"
          )}
        </button>
      </div>

      {/* Created Tools List */}
      {createdTools.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-700">📦 Created Tools ({createdTools.length})</h3>
          {createdTools.map((tool) => (
            <div
              key={tool.toolName}
              className={`border-2 rounded-lg p-2.5 cursor-pointer transition-colors ${
                selectedToolResult?.toolName === tool.toolName
                  ? "border-sky-500 bg-sky-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
              onClick={() => setSelectedToolResult(tool)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    tool.testSuccess
                      ? "bg-emerald-50 text-emerald-800 border-emerald-400"
                      : "bg-rose-50 text-rose-800 border-rose-400"
                  }`}>
                    {tool.testSuccess ? "✓ PASS" : "✗ FAIL"}
                  </span>
                  <span className="text-xs font-bold text-slate-900">{tool.toolName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">{tool.timestamp}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCreatedTool(tool.toolName);
                      if (selectedToolResult?.toolName === tool.toolName) setSelectedToolResult(null);
                    }}
                    className="text-slate-400 hover:text-rose-600 text-sm cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              </div>
              {selectedToolResult?.toolName === tool.toolName && (
                <div className="mt-2 space-y-1.5">
                  <pre className="text-[9px] font-mono bg-slate-900 text-green-400 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {tool.generatedCode}
                  </pre>
                  {tool.testStdout && (
                    <div className="text-[10px] bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                      <span className="font-bold text-emerald-800">stdout:</span>
                      <span className="text-emerald-700 ml-1">{tool.testStdout}</span>
                    </div>
                  )}
                  {tool.testStderr && (
                    <div className="text-[10px] bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      <span className="font-bold text-amber-800">stderr:</span>
                      <span className="text-amber-700 ml-1 whitespace-pre-wrap">{tool.testStderr}</span>
                    </div>
                  )}
                  <div className="text-[10px] text-slate-500">{tool.registerMessage}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setAgentEditorStep("done")}
        className="w-full py-2.5 font-bold text-xs text-white bg-emerald-600 hover:bg-emerald-700 rounded border-2 border-slate-900 transition-colors cursor-pointer"
      >
        ✅ Finish Agent &amp; Test/Export
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Test, Execute & Export (JSON / XML / Canvas)
// ─────────────────────────────────────────────────────────────────────────────

function StepDone(): React.JSX.Element {
  const { parsedAgentSpec, agentRequirement, createdTools, setAgentEditorStep, selectedModel } = useAgentStore();
  const { addNewGraphTab } = useGraphStore();

  const [taskInput, setTaskInput] = useState("");
  const [trajectory, setTrajectory] = useState<TrajectoryStep[]>([]);
  const [runResult, setRunResult] = useState<AgentRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "ok" | "err" | "info" } | null>(null);
  const trajectoryEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    trajectoryEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trajectory.length]);

  // Listen for real-time trajectory events from Rust backend
  useEffect(() => {
    const unlisten = listen<{ step: TrajectoryStep; is_final: boolean }>(
      "agent-trajectory-step",
      (event) => {
        setTrajectory((prev) => [...prev, event.payload.step]);
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const primaryAgent = parsedAgentSpec?.agents[0];

  // ── Run Custom Agent Task ────────────────────────────────────────────────
  const handleRunAgent = async () => {
    if (!taskInput.trim() || isRunning || !primaryAgent) return;
    setTrajectory([]);
    setRunResult(null);
    setIsRunning(true);
    setStatusMsg({ text: `🤖 Running ${primaryAgent.name} with ${selectedModel}...`, type: "info" });

    try {
      const result = await invoke<AgentRunResult>("run_custom_agent", {
        agentName: primaryAgent.name,
        instructions: primaryAgent.instruction,
        tools: primaryAgent.tools,
        task: taskInput,
        model: selectedModel,
      });

      setRunResult(result);
      if (result.success) {
        setStatusMsg({ text: `✅ Execution completed — ${result.trajectory.length} steps`, type: "ok" });
      } else {
        setStatusMsg({ text: `❌ Run failed: ${result.error ?? "Unknown error"}`, type: "err" });
      }
    } catch (err) {
      setStatusMsg({ text: `❌ Execution failed: ${String(err)}`, type: "err" });
    } finally {
      setIsRunning(false);
    }
  };

  // ── Export JSON ──────────────────────────────────────────────────────────
  const handleExportJson = async () => {
    if (!primaryAgent) return;
    const exportData = {
      version: 1,
      type: "custom_agent",
      created_at: new Date().toISOString(),
      agent: primaryAgent,
      all_agents: parsedAgentSpec?.agents ?? [],
      custom_tools: createdTools.map((t) => ({
        name: t.toolName,
        code: t.generatedCode,
        test_success: t.testSuccess,
      })),
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const cleanName = primaryAgent.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const defaultFilename = `${cleanName}.json`;

    try {
      const path = await invoke<string>("save_agent_file", {
        defaultFilename,
        content: jsonStr,
      });
      setStatusMsg({ text: `✅ Saved agent JSON to: ${path}`, type: "ok" });
    } catch {
      // Browser fallback download
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultFilename;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg({ text: `📥 Downloaded ${defaultFilename}`, type: "ok" });
    }
  };

  // ── Export XML ───────────────────────────────────────────────────────────
  const handleExportXml = async () => {
    if (!parsedAgentSpec) return;
    const xmlStr = agentSpecToXml(parsedAgentSpec);
    const agentName = primaryAgent?.name ?? "agent";
    const cleanName = agentName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const defaultFilename = `${cleanName}.xml`;

    try {
      const path = await invoke<string>("save_agent_file", {
        defaultFilename,
        content: xmlStr,
      });
      setStatusMsg({ text: `✅ Saved agent XML to: ${path}`, type: "ok" });
    } catch {
      const blob = new Blob([xmlStr], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultFilename;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg({ text: `📥 Downloaded ${defaultFilename}`, type: "ok" });
    }
  };

  // ── Load Agent to Canvas ────────────────────────────────────────────────
  const handleLoadToCanvas = () => {
    if (!primaryAgent) return;

    const inputId = `ag_in_${Date.now()}`;
    const agentNodeId = `ag_llm_${Date.now()}`;
    const writerId = `ag_out_${Date.now()}`;

    const nodes = [
      {
        id: inputId,
        type: "text_input" as const,
        label: "Agent Task Input",
        position: { x: 50, y: 100 },
        data: { default_text: agentRequirement || "Task for " + primaryAgent.name },
      },
      {
        id: agentNodeId,
        type: "ollama_selector" as const,
        label: primaryAgent.name,
        position: { x: 340, y: 100 },
        data: {
          label: primaryAgent.name,
          model: selectedModel,
          system_prompt: primaryAgent.instruction,
        },
      },
      {
        id: writerId,
        type: "local_file_writer" as const,
        label: "Result Output Writer",
        position: { x: 630, y: 100 },
        data: { output_path: "./agent_outputs", format: "md" },
      },
    ];

    const edges = [
      { id: `e1_${inputId}_${agentNodeId}`, source: inputId, target: agentNodeId },
      { id: `e2_${agentNodeId}_${writerId}`, source: agentNodeId, target: writerId },
    ];

    const layouted = autoLayout(nodes, edges);
    addNewGraphTab({
      version: 1,
      nodes: layouted,
      edges,
      meta: { title: primaryAgent.name },
    });
    useAgentStore.getState().setActiveMode("canvas");
  };

  const statusColors = {
    ok: "bg-emerald-50 text-emerald-800 border-emerald-300",
    err: "bg-rose-50 text-rose-800 border-rose-300",
    info: "bg-amber-50 text-amber-800 border-amber-300",
  };

  return (
    <div className="space-y-4">
      {/* Created Banner */}
      <div className="bg-emerald-50 border-2 border-emerald-600 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎉</span>
          <div>
            <h3 className="text-xs font-bold text-emerald-900">
              {primaryAgent?.name ?? "Custom Agent"} Ready!
            </h3>
            <p className="text-[10px] text-emerald-700">
              Execute tasks with this agent or export to JSON/XML
            </p>
          </div>
        </div>
      </div>

      {statusMsg && (
        <div className={`text-[10px] font-bold px-2.5 py-1.5 rounded border ${statusColors[statusMsg.type]}`}>
          {statusMsg.text}
        </div>
      )}

      {/* Export & Action Buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={handleExportJson}
          className="py-2 px-1 font-bold text-[11px] text-slate-900 bg-slate-100 hover:bg-slate-200 border-2 border-slate-900 rounded transition-colors cursor-pointer flex items-center justify-center gap-1"
          title="Save Agent as JSON file"
        >
          📥 Save JSON
        </button>
        <button
          type="button"
          onClick={handleExportXml}
          className="py-2 px-1 font-bold text-[11px] text-slate-900 bg-slate-100 hover:bg-slate-200 border-2 border-slate-900 rounded transition-colors cursor-pointer flex items-center justify-center gap-1"
          title="Save Agent as XML file"
        >
          📄 Save XML
        </button>
        <button
          type="button"
          onClick={handleLoadToCanvas}
          className="py-2 px-1 font-bold text-[11px] text-sky-900 bg-sky-50 hover:bg-sky-100 border-2 border-sky-600 rounded transition-colors cursor-pointer flex items-center justify-center gap-1"
          title="Load Agent node onto Canvas"
        >
          📊 Canvas
        </button>
      </div>

      {/* Test / Execute Created Agent */}
      <div className="bg-violet-50 border-2 border-violet-300 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-bold text-violet-900 flex items-center gap-1.5">
          <span>▶</span> Test &amp; Execute {primaryAgent?.name ?? "Agent"}
        </h3>
        <textarea
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          placeholder={`Enter a specific task for ${primaryAgent?.name ?? "this agent"} to perform...`}
          className="w-full h-16 bg-white border-2 border-slate-900 rounded p-2 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-600 resize-none font-medium"
          disabled={isRunning}
        />
        <button
          type="button"
          onClick={handleRunAgent}
          disabled={isRunning || !taskInput.trim() || !primaryAgent}
          className="w-full py-2 font-bold text-xs text-white bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:text-slate-500 rounded border-2 border-slate-900 transition-colors cursor-pointer flex items-center justify-center gap-2"
        >
          {isRunning ? (
            <>
              <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Running Agent...
            </>
          ) : (
            `▶ Execute Agent Task`
          )}
        </button>
      </div>

      {/* Live Execution Trajectory */}
      {(trajectory.length > 0 || isRunning) && (
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-700">⚡ Live Agent Trajectory</h4>
          {isRunning && trajectory.length === 0 && (
            <div className="text-center py-6">
              <div className="w-8 h-8 border-3 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-600">Calling {selectedModel} via Ollama...</p>
            </div>
          )}
          {trajectory.map((step, i) => (
            <div key={i} className="border border-slate-200 rounded bg-white p-2.5 text-[11px]">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-slate-900">{step.agent_name}</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 border border-violet-300">
                  {step.action}
                </span>
              </div>
              <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{step.content}</p>
              {step.tool_name && (
                <div className="mt-1 text-[10px] font-mono text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200">
                  🔧 {step.tool_name}
                </div>
              )}
              {step.tool_result && (
                <pre className="mt-1 bg-slate-900 text-green-400 p-2 rounded text-[9px] font-mono whitespace-pre-wrap max-h-28 overflow-y-auto">
                  {step.tool_result}
                </pre>
              )}
            </div>
          ))}

          {runResult?.final_answer && !isRunning && (
            <div className="border-2 border-emerald-600 bg-emerald-50 rounded-lg p-3">
              <div className="text-xs font-bold text-emerald-800 mb-1">✅ Final Agent Answer</div>
              <p className="text-[11px] text-emerald-900 whitespace-pre-wrap leading-relaxed">
                {runResult.final_answer}
              </p>
            </div>
          )}
          <div ref={trajectoryEndRef} />
        </div>
      )}

      {/* Re-edit / Create New */}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => setAgentEditorStep("tools")}
          className="flex-1 py-1.5 font-bold text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-400 rounded transition-colors cursor-pointer"
        >
          ← Edit Tools
        </button>
        <button
          type="button"
          onClick={() => setAgentEditorStep("requirement")}
          className="flex-1 py-1.5 font-bold text-xs text-violet-800 bg-violet-50 hover:bg-violet-100 border border-violet-300 rounded transition-colors cursor-pointer"
        >
          + Create Another Agent
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function AutoAgentAgentEditor(): React.JSX.Element {
  const { agentEditorStep } = useAgentStore();

  const stepIndex = ["requirement", "profiling", "tools", "done"].indexOf(agentEditorStep);
  const displayIndex = stepIndex <= 1 ? 0 : stepIndex === 2 ? 1 : 2;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b-2 border-slate-900">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          🛠️ Agent Editor{" "}
          <span className="text-[10px] bg-sky-100 text-sky-900 border border-sky-300 px-2 py-0.5 rounded font-bold">
            Zero-Code Agent Creation
          </span>
        </h2>
        <p className="text-[11px] text-slate-500 mt-0.5">Create, test, execute, and export custom AI agents</p>

        {/* Step progress bar */}
        <div className="mt-3 flex items-center gap-1">
          {STEP_LABELS.map((_, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <div
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  i <= displayIndex ? "bg-violet-600" : "bg-slate-200"
                }`}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 text-[10px] font-bold text-violet-700">
          {STEP_LABELS[Math.min(displayIndex, STEP_LABELS.length - 1)]}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {(agentEditorStep === "requirement" || agentEditorStep === "profiling") && <StepRequirement />}
        {(agentEditorStep === "tools" || agentEditorStep === "agent") && <StepToolsAndAgent />}
        {agentEditorStep === "done" && <StepDone />}
      </div>
    </div>
  );
}
