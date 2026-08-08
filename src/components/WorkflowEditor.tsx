/**
 * WorkflowEditor.tsx
 * Workflow Editor — Hybrid Local AI Hub.
 * Real execution only — NO simulation fallbacks.
 * 100% offline via local Ollama + Tauri backend.
 */
import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAgentStore, type TrajectoryStep } from "../lib/useAgentStore";
import { parseWorkflowSpec } from "../lib/xmlParser";
import { useGraphStore } from "../lib/useGraphStore";
import { autoLayout } from "../lib/autoLayout";

// ─────────────────────────────────────────────────────────────────────────────
// Pattern definitions
// ─────────────────────────────────────────────────────────────────────────────

const PATTERNS = [
  {
    id: "sequential",
    icon: "→",
    label: "Sequential",
    desc: "Events run one after another, each feeding its output to the next.",
    color: "border-sky-400 bg-sky-50 text-sky-900",
    badge: "bg-sky-100 text-sky-800 border-sky-400",
  },
  {
    id: "if_else",
    icon: "⑂",
    label: "If-Else Branch",
    desc: "First event evaluates a condition, then routes to the matching branch.",
    color: "border-amber-400 bg-amber-50 text-amber-900",
    badge: "bg-amber-100 text-amber-800 border-amber-400",
  },
  {
    id: "parallelization",
    icon: "⧖",
    label: "Parallel + Voting",
    desc: "All agents run concurrently on the same input, then vote on the best answer.",
    color: "border-violet-400 bg-violet-50 text-violet-900",
    badge: "bg-violet-100 text-violet-800 border-violet-400",
  },
  {
    id: "evaluator_optimizer",
    icon: "↺",
    label: "Evaluator-Optimizer",
    desc: "Generator + Evaluator loop — iterates until the answer meets quality criteria.",
    color: "border-emerald-400 bg-emerald-50 text-emerald-900",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-400",
  },
] as const;

type PatternId = (typeof PATTERNS)[number]["id"];

const SAMPLE_REQUIREMENTS: Record<PatternId, { label: string; req: string }[]> = {
  sequential: [
    { label: "Document Translation Pipeline", req: "Create a sequential workflow: read a document, translate it to Spanish, proofread the translation, and save the final result to a file." },
    { label: "Data Processing Pipeline", req: "Sequential pipeline: ingest raw data text, clean and normalize it, extract key entities, then format and write a structured JSON report." },
  ],
  if_else: [
    { label: "Sentiment Router", req: "Analyze text sentiment. If positive, write an encouraging reply. If negative, escalate to a detailed problem-resolution response. Save both to separate files." },
    { label: "Code Review Router", req: "Review code quality. If it passes standards, generate documentation. If it fails, generate a detailed bug report with fix suggestions." },
  ],
  parallelization: [
    { label: "Majority Voting QA", req: "Create a math reasoning workflow where 3 separate agents independently solve the same math problem, then vote to select the most common correct answer." },
    { label: "Multi-Perspective Analysis", req: "Have 3 agents independently analyze a business strategy from different perspectives (financial, technical, market), then aggregate into a consensus report." },
  ],
  evaluator_optimizer: [
    { label: "Essay Writer + Reviewer", req: "Write an essay on artificial intelligence. Have an evaluator critique it for quality, clarity, and depth. Iterate up to 3 times until the evaluator approves it as high quality." },
    { label: "Code Generator + Tester", req: "Generate Python code to solve a given problem. Have a code reviewer evaluate correctness and efficiency. Iterate until the code passes review." },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Step Card
// ─────────────────────────────────────────────────────────────────────────────

function WorkflowStepCard({ step, index }: { step: TrajectoryStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = step.content.length > 200;

  const actionColor = () => {
    const a = step.action.toLowerCase();
    if (a.includes("vote") || a.includes("parallel")) return "bg-violet-100 text-violet-900 border-violet-400";
    if (a.includes("condition") || a.includes("branch")) return "bg-amber-100 text-amber-900 border-amber-400";
    if (a.includes("generate") || a.includes("iter")) return "bg-sky-100 text-sky-900 border-sky-400";
    if (a.includes("evaluat")) return "bg-orange-100 text-orange-900 border-orange-400";
    if (a.includes("result")) return "bg-emerald-100 text-emerald-900 border-emerald-500";
    if (a.includes("error")) return "bg-rose-100 text-rose-900 border-rose-400";
    return "bg-slate-100 text-slate-700 border-slate-300";
  };

  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm overflow-hidden">
      <div
        className={`flex items-start gap-3 p-3 ${isLong ? "cursor-pointer hover:bg-slate-50" : ""}`}
        onClick={() => isLong && setExpanded((e) => !e)}
      >
        <div className="shrink-0 w-6 h-6 rounded-full bg-slate-100 border-2 border-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-600">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-bold text-slate-900">{step.agent_name}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${actionColor()}`}>
              {step.action.toUpperCase().replace(/_/g, " ")}
            </span>
            {step.tool_name && (
              <span className="text-[9px] font-mono text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200">
                🔧 {step.tool_name}
              </span>
            )}
          </div>
          <p className={`text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap ${!expanded && isLong ? "line-clamp-3" : ""}`}>
            {step.content}
          </p>
          {step.tool_result && expanded && (
            <div className="mt-2 bg-slate-900 text-green-400 rounded p-2 text-[10px] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
              {step.tool_result}
            </div>
          )}
          {isLong && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="mt-1 text-[10px] text-violet-600 hover:text-violet-800 font-bold cursor-pointer">
              {expanded ? "▲ Collapse" : "▼ Show more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function WorkflowEditor(): React.JSX.Element {
  const {
    workflowRequirement, setWorkflowRequirement,
    workflowSpecXml, setWorkflowSpecXml,
    parsedWorkflowSpec, setParsedWorkflowSpec,
    workflowInput, setWorkflowInput,
    workflowResult, setWorkflowResult,
    workflowTrajectory, appendWorkflowStep, clearWorkflowTrajectory,
    isWorkflowRunning, setIsWorkflowRunning,
    selectedModel,
  } = useAgentStore();

  const { addNewGraphTab } = useGraphStore();
  const trajectoryEndRef = useRef<HTMLDivElement>(null);

  const [selectedPattern, setSelectedPattern] = useState<PatternId>("sequential");
  const [showXmlEditor, setShowXmlEditor] = useState(false);
  const [editedXml, setEditedXml] = useState("");
  const [isProfileRunning, setIsProfileRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "ok" | "err" | "info" } | null>(null);
  const [phase, setPhase] = useState<"configure" | "execute">("configure");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  useEffect(() => {
    trajectoryEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [workflowTrajectory.length]);

  // Listen for real-time trajectory events from Rust backend
  useEffect(() => {
    const unlisten = listen<{ step: TrajectoryStep; is_final: boolean }>(
      "agent-trajectory-step",
      (event) => {
        appendWorkflowStep(event.payload.step);
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [appendWorkflowStep]);

  // ── Profile Workflow ─────────────────────────────────────────────────────

  const handleProfileWorkflow = async () => {
    if (!workflowRequirement.trim() || isProfileRunning) return;
    setIsProfileRunning(true);
    setStatusMsg({ text: "🔍 Generating workflow specification with " + selectedModel + "...", type: "info" });
    setErrorDetail(null);

    try {
      const xml = await invoke<string>("profile_workflow_requirement", {
        requirement: workflowRequirement,
        model: selectedModel,
      });

      setWorkflowSpecXml(xml);
      const parsed = parseWorkflowSpec(xml);
      setParsedWorkflowSpec(parsed);
      setEditedXml(xml);
      const patternLabel = PATTERNS.find((p) => p.id === parsed.pattern)?.label ?? parsed.pattern;
      setStatusMsg({ text: `✅ Workflow profiled: "${parsed.title}" · ${patternLabel} · ${parsed.events.length} steps`, type: "ok" });
    } catch (err) {
      const msg = String(err);
      setStatusMsg({ text: "❌ Failed to generate workflow spec", type: "err" });
      setErrorDetail(msg);
    } finally {
      setIsProfileRunning(false);
    }
  };

  // ── Execute Workflow ─────────────────────────────────────────────────────

  const handleExecuteWorkflow = async () => {
    if (isWorkflowRunning || !workflowSpecXml) return;
    clearWorkflowTrajectory();
    setIsWorkflowRunning(true);
    setPhase("execute");
    setStatusMsg({ text: "⚡ Executing workflow with " + selectedModel + "...", type: "info" });
    setErrorDetail(null);

    try {
      const xmlToSend = showXmlEditor ? editedXml : workflowSpecXml;
      const result = await invoke<{
        success: boolean;
        final_answer: string;
        trajectory: TrajectoryStep[];
        error?: string;
      }>("execute_xml_workflow", {
        workflowXml: xmlToSend,
        input: workflowInput.trim() || workflowRequirement,
        model: selectedModel,
      });

      setWorkflowResult(result);
      if (result.success) {
        setStatusMsg({ text: `✅ Workflow completed — ${result.trajectory.length} steps`, type: "ok" });
      } else {
        setStatusMsg({ text: `❌ Workflow error: ${result.error ?? "Unknown error"}`, type: "err" });
        setErrorDetail(result.error ?? null);
      }
    } catch (err) {
      const msg = String(err);
      setStatusMsg({ text: "❌ Execution failed — is Ollama running?", type: "err" });
      setErrorDetail(msg + "\n\nMake sure: ollama serve is running, and model '" + selectedModel + "' is installed (ollama pull " + selectedModel + ")");
    } finally {
      setIsWorkflowRunning(false);
    }
  };

  // ── Load to Canvas ────────────────────────────────────────────────────────

  const handleLoadToCanvas = () => {
    if (!parsedWorkflowSpec) return;

    const inputId = `wf_in_${Date.now()}`;
    const writerId = `wf_out_${Date.now()}`;

    const nodes = [
      {
        id: inputId,
        type: "text_input" as const,
        label: "Workflow Task Input",
        position: { x: 0, y: 100 },
        data: { default_text: workflowInput || workflowRequirement },
      },
      ...parsedWorkflowSpec.events.map((e, i) => ({
        id: `wf_${i}`,
        type: "ollama_selector" as const,
        label: `${e.agent}: ${e.name}`,
        position: { x: (i + 1) * 280, y: 100 },
        data: { label: `${e.agent}: ${e.name}`, model: selectedModel, system_prompt: e.action },
      })),
      {
        id: writerId,
        type: "local_file_writer" as const,
        label: "Final Workflow Writer",
        position: { x: (parsedWorkflowSpec.events.length + 1) * 280, y: 100 },
        data: { output_path: "./workflow_outputs", format: "md" },
      },
    ];

    const edges = nodes.slice(0, -1).map((n, i) => ({
      id: `wf_e_${i}`,
      source: n.id,
      target: nodes[i + 1].id,
    }));

    const layoutedNodes = autoLayout(nodes, edges);
    addNewGraphTab({
      version: 1,
      nodes: layoutedNodes,
      edges,
      meta: { title: parsedWorkflowSpec.title },
    });
    useAgentStore.getState().setActiveMode("canvas");
  };

  const patternInfo = PATTERNS.find((p) => p.id === (parsedWorkflowSpec?.pattern ?? selectedPattern));
  const statusColors = {
    ok: "bg-emerald-50 text-emerald-800 border-emerald-300",
    err: "bg-rose-50 text-rose-800 border-rose-300",
    info: "bg-amber-50 text-amber-800 border-amber-300",
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-3 border-b-2 border-slate-900">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            ⚡ Workflow Editor
            <span className="text-[10px] bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded font-bold">
              Real Execution
            </span>
          </h2>
          {parsedWorkflowSpec && (
            <div className="flex gap-1.5">
              <button type="button" onClick={handleLoadToCanvas}
                className="text-[10px] font-bold px-2 py-1 bg-sky-50 text-sky-800 border border-sky-500 rounded hover:bg-sky-100 cursor-pointer">
                📊 Canvas
              </button>
              <button type="button" onClick={() => {
                clearWorkflowTrajectory();
                setPhase("configure");
                setStatusMsg(null);
                setErrorDetail(null);
                setWorkflowResult(null as any);
                setParsedWorkflowSpec(null as any);
                setWorkflowSpecXml("");
              }}
                className="text-[10px] font-bold px-2 py-1 bg-slate-100 text-slate-700 border border-slate-400 rounded hover:bg-slate-200 cursor-pointer">
                🗑 Clear
              </button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          Multi-agent workflows with real Ollama LLM — Sequential, If-Else, Parallel, Evaluator-Optimizer
        </p>

        {statusMsg && (
          <div className={`mt-2 text-[10px] font-bold px-2 py-1.5 rounded border ${statusColors[statusMsg.type]}`}>
            {statusMsg.text}
          </div>
        )}
        {errorDetail && (
          <div className="mt-1 bg-rose-900 text-rose-100 text-[10px] font-mono px-2 py-2 rounded max-h-24 overflow-y-auto whitespace-pre-wrap">
            {errorDetail}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Phase: Configure */}
        {phase === "configure" && (
          <>
            {/* Pattern Selector */}
            <div>
              <h3 className="text-xs font-bold text-slate-700 mb-2">1. Select Workflow Pattern</h3>
              <div className="grid grid-cols-2 gap-2">
                {PATTERNS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPattern(p.id)}
                    className={`p-2.5 rounded-lg border-2 text-left transition-all cursor-pointer ${
                      selectedPattern === p.id ? p.color : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="text-lg mb-1">{p.icon}</div>
                    <div className="text-[11px] font-bold text-slate-900">{p.label}</div>
                    <div className="text-[9px] text-slate-600 mt-0.5 leading-tight">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Workflow Requirement */}
            <div>
              <h3 className="text-xs font-bold text-slate-700 mb-2">2. Describe Your Workflow</h3>
              <div className="space-y-1.5 mb-2">
                {SAMPLE_REQUIREMENTS[selectedPattern].map((s, i) => (
                  <button key={i} type="button" onClick={() => setWorkflowRequirement(s.req)}
                    className="w-full text-left text-[10px] text-violet-800 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded px-2 py-1.5 font-medium cursor-pointer transition-colors">
                    {s.label}
                  </button>
                ))}
              </div>
              <textarea
                value={workflowRequirement}
                onChange={(e) => setWorkflowRequirement(e.target.value)}
                placeholder={`Describe a ${selectedPattern.replace("_", "-")} workflow...`}
                className="w-full h-20 bg-slate-50 border-2 border-slate-900 rounded p-2.5 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-600 resize-none font-medium"
                disabled={isProfileRunning}
              />
              <button
                type="button"
                onClick={handleProfileWorkflow}
                disabled={isProfileRunning || !workflowRequirement.trim()}
                className="w-full mt-2 py-2 font-bold text-xs text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 rounded border-2 border-slate-900 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                {isProfileRunning ? (
                  <>
                    <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Generating with {selectedModel}...
                  </>
                ) : (
                  "📋 Generate Workflow Spec"
                )}
              </button>
            </div>

            {/* Generated Spec */}
            {parsedWorkflowSpec && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-700">3. Generated Workflow Spec</h3>
                  <button type="button" onClick={() => setShowXmlEditor(!showXmlEditor)}
                    className="text-[10px] font-bold text-violet-700 hover:text-violet-900 cursor-pointer">
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
                    <button type="button"
                      onClick={() => {
                        const p = parseWorkflowSpec(editedXml);
                        setParsedWorkflowSpec(p);
                        setWorkflowSpecXml(editedXml);
                        setShowXmlEditor(false);
                      }}
                      className="mt-1 text-[11px] font-bold px-3 py-1 bg-violet-600 text-white border-2 border-slate-900 rounded hover:bg-violet-700 cursor-pointer">
                      Apply
                    </button>
                  </div>
                ) : (
                  <div className={`rounded-lg border-2 p-3 ${patternInfo?.color ?? ""}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{patternInfo?.icon}</span>
                      <div>
                        <div className="text-xs font-bold">{parsedWorkflowSpec.title}</div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${patternInfo?.badge}`}>
                          {patternInfo?.label} · {parsedWorkflowSpec.events.length} steps
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {parsedWorkflowSpec.events.map((e, i) => (
                        <div key={i} className="bg-white bg-opacity-70 rounded px-2.5 py-1.5 text-[10px]">
                          <div className="font-bold text-slate-900">{e.agent}</div>
                          <div className="text-slate-600 text-[9px]">{e.listen} → {e.action.slice(0, 80)}</div>
                          <div className="text-[9px] text-emerald-700 font-bold mt-0.5">→ {e.output}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Task Input */}
                <div>
                  <h3 className="text-xs font-bold text-slate-700 mb-1.5">4. Task Input</h3>
                  <textarea
                    value={workflowInput}
                    onChange={(e) => setWorkflowInput(e.target.value)}
                    placeholder="Enter the specific task or data for this workflow to process..."
                    className="w-full h-16 bg-slate-50 border-2 border-slate-900 rounded p-2.5 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-600 resize-none font-medium"
                    disabled={isWorkflowRunning}
                  />
                </div>

                <button
                  type="button"
                  onClick={handleExecuteWorkflow}
                  disabled={isWorkflowRunning || !parsedWorkflowSpec}
                  className="w-full py-2.5 font-bold text-xs text-white bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:text-slate-500 rounded border-2 border-slate-900 transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  {isWorkflowRunning ? (
                    <>
                      <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Running with {selectedModel}...
                    </>
                  ) : (
                    "▶ Execute Workflow"
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {/* Phase: Execute */}
        {phase === "execute" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-slate-700">⚡ Live Execution Trajectory</h3>
              <button type="button" onClick={() => setPhase("configure")}
                className="text-[10px] font-bold text-slate-600 hover:text-slate-900 cursor-pointer">
                ← Back to Configure
              </button>
            </div>

            {isWorkflowRunning && workflowTrajectory.length === 0 && (
              <div className="text-center py-8">
                <div className="w-10 h-10 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-600">Calling {selectedModel} via Ollama...</p>
                <p className="text-[10px] text-slate-400 mt-1">Real responses stream as each agent step completes</p>
              </div>
            )}

            {workflowTrajectory.map((step, i) => (
              <WorkflowStepCard key={`wf_step_${i}`} step={step} index={i} />
            ))}

            {workflowResult?.final_answer && !isWorkflowRunning && (
              <div className="border-2 border-emerald-600 bg-emerald-50 rounded-lg p-3">
                <div className="text-xs font-bold text-emerald-800 mb-1.5">✅ Workflow Final Output</div>
                <p className="text-[11px] text-emerald-900 whitespace-pre-wrap leading-relaxed">
                  {workflowResult.final_answer}
                </p>
                <button type="button" onClick={handleLoadToCanvas}
                  className="mt-2 text-[10px] font-bold px-2 py-1 bg-sky-100 text-sky-800 border border-sky-400 rounded hover:bg-sky-200 cursor-pointer">
                  📊 Load Workflow Graph to Canvas
                </button>
              </div>
            )}
            <div ref={trajectoryEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
