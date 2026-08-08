/**
 * AutoAgentUserMode.tsx
 * User Mode (Deep Research Agents) for Hybrid Local AI Hub.
 * Implements multi-agent orchestration: Orchestrator → Local File Agent / Coding Agent.
 * 100% offline via local Ollama LLMs. Inspired by AutoAgent (HKUDS).
 */
import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAgentStore, type TrajectoryStep } from "../lib/useAgentStore";
import { useGraphStore } from "../lib/useGraphStore";
import { autoLayout } from "../lib/autoLayout";

function AgentIcon({ agentName }: { agentName: string }) {
  const lower = agentName.toLowerCase();
  if (lower.includes("coding") || lower.includes("code")) return <span>💻</span>;
  if (lower.includes("file")) return <span>📁</span>;
  if (lower.includes("web") || lower.includes("surf")) return <span>🌐</span>;
  if (lower.includes("orchestrat")) return <span>🎯</span>;
  if (lower.includes("system")) return <span>✅</span>;
  return <span>🤖</span>;
}

function ActionBadge({ action }: { action: string }) {
  const lower = action.toLowerCase();
  if (lower.includes("handoff") || lower.includes("transfer")) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-400">
        HANDOFF
      </span>
    );
  }
  if (lower.includes("tool")) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-400">
        TOOL CALL
      </span>
    );
  }
  if (lower.includes("result") || lower.includes("final")) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-500">
        RESULT
      </span>
    );
  }
  if (lower.includes("error")) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-400">
        ERROR
      </span>
    );
  }
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 border border-violet-400">
      THINKING
    </span>
  );
}

function TrajectoryStepCard({ step, index }: { step: TrajectoryStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = step.content.length > 200;

  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm overflow-hidden">
      <div
        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => isLong && setExpanded((e) => !e)}
      >
        <div className="shrink-0 w-7 h-7 rounded-full bg-violet-50 border-2 border-violet-300 flex items-center justify-center text-sm">
          <AgentIcon agentName={step.agent_name} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-bold text-slate-900">{step.agent_name}</span>
            <ActionBadge action={step.action} />
            <span className="text-[10px] text-slate-400 ml-auto">#{index + 1}</span>
          </div>
          {step.tool_name && (
            <div className="text-[10px] font-mono text-violet-700 bg-violet-50 px-2 py-0.5 rounded mb-1 border border-violet-200">
              🔧 {step.tool_name}
            </div>
          )}
          <p className={`text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap ${!expanded && isLong ? "line-clamp-3" : ""}`}>
            {step.content}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="mt-1 text-[10px] text-violet-600 hover:text-violet-800 font-bold cursor-pointer"
            >
              {expanded ? "▲ Collapse" : "▼ Show more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const SAMPLE_TASKS = [
  {
    emoji: "📊",
    label: "Financial Analysis Report",
    task: "Analyze local financial data files in the current directory. Write Python code to calculate key statistics (mean, median, standard deviation) and generate a comprehensive markdown financial analysis report saved to ./reports/analysis.md",
  },
  {
    emoji: "🔍",
    label: "Code Base Explorer",
    task: "List and read the source code files in the current project directory. Identify the main components, programming patterns, and dependencies. Write a comprehensive technical architecture summary as a markdown report.",
  },
  {
    emoji: "📝",
    label: "Document Summarizer",
    task: "Find any text documents or markdown files in the current directory. Read their contents and create a comprehensive summary report highlighting key points, themes, and actionable insights. Save the report to ./summary_report.md",
  },
  {
    emoji: "🐍",
    label: "Python Data Pipeline",
    task: "Write Python code that reads a CSV file named 'data.csv' (if it exists), performs exploratory data analysis, calculates descriptive statistics, and outputs a JSON summary to 'data_summary.json'. Handle the case where the file doesn't exist gracefully.",
  },
];

export default function AutoAgentUserMode(): React.JSX.Element {
  const {
    userModeTask,
    setUserModeTask,
    userModeResult,
    setUserModeResult,
    userModeTrajectory,
    appendTrajectoryStep,
    clearTrajectory,
    isUserModeRunning,
    setIsUserModeRunning,
    selectedModel,
  } = useAgentStore();

  const { addNewGraphTab } = useGraphStore();
  const trajectoryEndRef = useRef<HTMLDivElement>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Auto-scroll trajectory to bottom
  useEffect(() => {
    trajectoryEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [userModeTrajectory.length]);

  // Listen for live trajectory events from Tauri backend
  useEffect(() => {
    const unlisten = listen<{ step: TrajectoryStep; is_final: boolean }>(
      "agent-trajectory-step",
      (event) => {
        appendTrajectoryStep(event.payload.step);
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [appendTrajectoryStep]);

  const handleRun = async () => {
    if (!userModeTask.trim() || isUserModeRunning) return;
    clearTrajectory();
    setIsUserModeRunning(true);
    setStatusMsg("🎯 Orchestrator analyzing task with " + selectedModel + "...");

    try {
      const result = await invoke<{
        success: boolean;
        final_answer: string;
        trajectory: TrajectoryStep[];
        error?: string;
      }>("run_autoagent_task", {
        task: userModeTask,
        model: selectedModel,
      });
      setUserModeResult(result);
      setStatusMsg(
        result.success
          ? `✅ Task completed — ${result.trajectory.length} agent steps`
          : `❌ Error: ${result.error}`
      );
    } catch (err) {
      const msg = String(err);
      setStatusMsg(`❌ Failed — is Ollama running? (ollama serve)`);
      appendTrajectoryStep({
        agent_name: "System",
        step_index: 0,
        action: "error",
        content: `Connection to Tauri backend failed:\n${msg}\n\nTroubleshooting:\n1. Make sure Ollama is running: ollama serve\n2. Make sure model is installed: ollama pull ${selectedModel}\n3. Restart the app`,
        tool_name: null,
        tool_result: null,
      });
    } finally {
      setIsUserModeRunning(false);
    }
  };

  const handleLoadToCanvas = () => {
    if (!userModeResult) return;
    // Convert the trajectory into a visual graph
    const nodes = userModeResult.trajectory
      .filter((s) => s.action === "thinking" || s.action === "result")
      .map((s, i) => ({
        id: `agent_${i}`,
        type: "log_terminal" as const,
        label: `${s.agent_name}: ${s.action}`,
        position: { x: i * 280, y: 0 },
        data: { label: `${s.agent_name}: ${s.action}`, content: s.content },
      }));

    const edges = nodes.slice(1).map((_, i) => ({
      id: `e_${i}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
    }));

    const layoutedNodes = autoLayout(nodes, edges);
    addNewGraphTab({
      version: 1,
      nodes: layoutedNodes,
      edges,
      meta: { title: `User Mode: ${userModeTask.slice(0, 40)}...` },
    });
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b-2 border-slate-900">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              💬 User Mode <span className="text-[10px] bg-violet-100 text-violet-900 border border-violet-300 px-2 py-0.5 rounded font-bold">Deep Research Agents</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Multi-agent orchestration — 100% local, zero cloud</p>
          </div>
          {userModeTrajectory.length > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleLoadToCanvas}
                className="text-[11px] font-bold px-2.5 py-1 bg-sky-50 text-sky-800 border-2 border-sky-800 rounded hover:bg-sky-100 transition-colors cursor-pointer"
              >
                📊 Load to Canvas
              </button>
              <button
                type="button"
                onClick={() => { clearTrajectory(); setStatusMsg(null); }}
                className="text-[11px] font-bold px-2.5 py-1 bg-slate-100 text-slate-700 border-2 border-slate-900 rounded hover:bg-slate-200 transition-colors cursor-pointer"
              >
                🗑 Clear
              </button>
            </div>
          )}
        </div>

        {/* Task Input */}
        <div className="flex flex-col gap-2">
          <textarea
            value={userModeTask}
            onChange={(e) => setUserModeTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey) handleRun();
            }}
            placeholder="Describe a complex task for the multi-agent system... (Ctrl+Enter to run)"
            className="w-full h-16 bg-slate-50 border-2 border-slate-900 rounded p-2.5 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-600 resize-none font-medium"
            disabled={isUserModeRunning}
          />

          {/* Sample tasks */}
          <div className="flex gap-1.5 flex-wrap">
            {SAMPLE_TASKS.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => {
                  setUserModeTask(sample.task);
                }}
                className="text-[10px] font-bold px-2 py-1 bg-slate-50 border border-slate-300 hover:border-violet-500 hover:bg-violet-50 text-slate-700 hover:text-violet-800 rounded transition-colors cursor-pointer"
              >
                {sample.emoji} {sample.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleRun}
            disabled={isUserModeRunning || !userModeTask.trim()}
            className="w-full py-2 font-bold text-xs text-white bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:text-slate-500 rounded border-2 border-slate-900 transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            {isUserModeRunning ? (
              <>
                <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Agents Running...
              </>
            ) : (
              "▶ Run Multi-Agent Task"
            )}
          </button>
        </div>

        {statusMsg && (
          <div className={`mt-2 text-[11px] font-bold px-2.5 py-1.5 rounded border ${
            statusMsg.startsWith("✅")
              ? "bg-emerald-50 text-emerald-800 border-emerald-300"
              : statusMsg.startsWith("❌")
              ? "bg-rose-50 text-rose-800 border-rose-300"
              : "bg-amber-50 text-amber-800 border-amber-300"
          }`}>
            {statusMsg}
          </div>
        )}
      </div>

      {/* Agent Trajectory */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {userModeTrajectory.length === 0 && !isUserModeRunning && (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-3">🤖</div>
            <p className="text-sm font-bold text-slate-500">Ready for multi-agent task execution</p>
            <p className="text-[11px] text-slate-400 mt-1">
              The Orchestrator will coordinate Local File Agent, Coding Agent,<br />
              and Web Surfer Agent to solve complex tasks — all offline.
            </p>
          </div>
        )}

        {isUserModeRunning && userModeTrajectory.length === 0 && (
          <div className="text-center py-8">
            <div className="w-10 h-10 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-600">Calling {selectedModel} via Ollama...</p>
            <p className="text-[10px] text-slate-400 mt-1">Real agent steps stream as they complete</p>
          </div>
        )}

        {userModeTrajectory.map((step, i) => (
          <TrajectoryStepCard key={`${step.agent_name}-${i}`} step={step} index={i} />
        ))}

        {/* Final answer highlight */}
        {userModeResult?.final_answer && !isUserModeRunning && (
          <div className="border-2 border-emerald-600 bg-emerald-50 rounded-lg p-3">
            <div className="text-xs font-bold text-emerald-800 mb-1.5 flex items-center gap-1">
              ✅ Final Answer
            </div>
            <p className="text-[11px] text-emerald-900 whitespace-pre-wrap leading-relaxed">
              {userModeResult.final_answer}
            </p>
          </div>
        )}

        <div ref={trajectoryEndRef} />
      </div>
    </div>
  );
}
