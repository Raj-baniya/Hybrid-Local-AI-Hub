import { useState, useEffect } from "react";
import "./App.css";
import ChatPanel from "./components/ChatPanel";
import NodePalette from "./components/NodePalette";
import ModelManagerPanel from "./components/ModelManagerPanel";
import GraphCanvas from "./components/GraphCanvas";
import ExecutionToolbar from "./components/ExecutionToolbar";
import LogTerminal from "./components/LogTerminal";
import UserMode from "./components/UserMode";
import AgentEditor from "./components/AgentEditor";
import WorkflowEditor from "./components/WorkflowEditor";
import { useAgentStore, type AgentMode } from "./lib/useAgentStore";
import { useGraphStore } from "./lib/useGraphStore";
import { invoke } from "@tauri-apps/api/core";

// ─────────────────────────────────────────────────────────────────────────────
// Mode Configuration
// ─────────────────────────────────────────────────────────────────────────────

const MODES: {
  id: AgentMode;
  icon: string;
  label: string;
  shortLabel: string;
  activeColor: string;
  desc: string;
}[] = [
  {
    id: "user_mode",
    icon: "💬",
    label: "User Mode",
    shortLabel: "User",
    activeColor: "bg-violet-600 text-white border-violet-800",
    desc: "Deep Research Agents",
  },
  {
    id: "agent_editor",
    icon: "🛠️",
    label: "Agent Editor",
    shortLabel: "Agents",
    activeColor: "bg-sky-600 text-white border-sky-800",
    desc: "Zero-Code Agent Creation",
  },
  {
    id: "workflow_editor",
    icon: "⚡",
    label: "Workflow Editor",
    shortLabel: "Workflows",
    activeColor: "bg-emerald-600 text-white border-emerald-800",
    desc: "Event-Driven Workflows",
  },
  {
    id: "canvas",
    icon: "🎨",
    label: "Canvas & Models",
    shortLabel: "Canvas",
    activeColor: "bg-amber-600 text-white border-amber-800",
    desc: "Visual Pipeline Canvas",
  },
];

const QUICK_MODELS = [
  "qwen2.5vl:7b",
  "qwen2.5:latest",
  "llama3.2",
  "llama3.2-vision",
  "nomic-embed-text",
  "deepseek-r1:7b",
  "phi4",
];

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" &&
    (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__));
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Graph Node/Edge Badge
// ─────────────────────────────────────────────────────────────────────────────

function GraphNodeBadge(): React.JSX.Element {
  const graph = useGraphStore((s) => s.graph);
  const nodeCount = graph?.nodes?.length ?? 0;
  const edgeCount = graph?.edges?.length ?? 0;
  if (nodeCount === 0) return <></>;
  return (
    <div className="absolute bottom-3 right-3 z-10 bg-slate-900/90 text-white text-[10px] font-bold px-2.5 py-1.5 rounded border border-slate-700 shadow backdrop-blur-sm flex items-center gap-2">
      <span className="text-emerald-400">●</span>
      {nodeCount} nodes · {edgeCount} edges
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas Sidebar Panel — for canvas mode
// ─────────────────────────────────────────────────────────────────────────────

function CanvasSidebarPanel(): React.JSX.Element {
  const [canvasTab, setCanvasTab] = useState<"chat" | "palette" | "models">("chat");

  return (
    <div className="flex flex-col h-full">
      <div className="h-10 flex items-center border-b-2 border-slate-900 bg-slate-100 text-xs font-bold p-1 gap-1 shrink-0">
        {(["chat", "palette", "models"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setCanvasTab(tab)}
            className={`flex-1 py-1.5 text-center rounded transition-colors cursor-pointer capitalize ${
              canvasTab === tab
                ? "bg-white font-bold border-2 border-slate-900 shadow-xs text-slate-900"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab === "chat" ? "Chat AI" : tab === "palette" ? "Palette" : "Models"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {canvasTab === "chat" ? (
          <ChatPanel />
        ) : canvasTab === "palette" ? (
          <NodePalette />
        ) : (
          <ModelManagerPanel />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Selector Row
// ─────────────────────────────────────────────────────────────────────────────

function ModelSelectorRow(): React.JSX.Element {
  const { selectedModel, setSelectedModel } = useAgentStore();
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<"ok" | "offline" | "loading">("loading");

  useEffect(() => {
    if (!isTauriAvailable()) {
      setOllamaStatus("offline");
      return;
    }
    invoke<string[]>("list_ollama_models")
      .then((models) => {
        if (models && models.length > 0) {
          setInstalledModels(models);
          setOllamaStatus("ok");
        } else {
          setOllamaStatus("offline");
        }
      })
      .catch(() => {
        setOllamaStatus("offline");
      });
  }, []);

  const modelList = installedModels.length > 0 ? installedModels : QUICK_MODELS;

  return (
    <div className="shrink-0 px-3 py-2 border-b border-slate-200 bg-slate-50 flex flex-col gap-1.5">
      {/* Ollama status badge */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border ${
            ollamaStatus === "ok"
              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
              : ollamaStatus === "loading"
              ? "bg-amber-50 text-amber-700 border-amber-300"
              : "bg-rose-50 text-rose-700 border-rose-300"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              ollamaStatus === "ok"
                ? "bg-emerald-500"
                : ollamaStatus === "loading"
                ? "bg-amber-400 animate-pulse"
                : "bg-rose-500"
            }`}
          />
          {ollamaStatus === "ok"
            ? `Ollama online · ${installedModels.length} model${installedModels.length !== 1 ? "s" : ""}`
            : ollamaStatus === "loading"
            ? "Connecting to Ollama..."
            : "Ollama offline — run: ollama serve"}
        </span>
      </div>
      {/* Model selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-slate-500 shrink-0">Model:</span>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="flex-1 text-[11px] font-bold text-slate-900 bg-white border-2 border-slate-900 rounded px-2 py-0.5 focus:outline-none focus:border-violet-600 cursor-pointer"
        >
          {modelList.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Status Bar
// ─────────────────────────────────────────────────────────────────────────────

function AgentStatusBar({ mode }: { mode: AgentMode }): React.JSX.Element {
  const { userModeTrajectory, isUserModeRunning, workflowTrajectory, isWorkflowRunning } = useAgentStore();

  const trajectory = mode === "user_mode" ? userModeTrajectory : workflowTrajectory;
  const isRunning = mode === "user_mode" ? isUserModeRunning : isWorkflowRunning;

  if (mode === "agent_editor" || mode === "canvas") return <></>;

  return (
    <div className="shrink-0 h-7 border-t border-slate-200 bg-slate-50 flex items-center px-4 gap-3 text-[10px] font-bold text-slate-600">
      {isRunning ? (
        <>
          <span className="w-2 h-2 rounded-full bg-violet-600 animate-pulse" />
          <span className="text-violet-700">Agents running...</span>
        </>
      ) : (
        <>
          <span className="text-slate-400">Steps: {trajectory.length}</span>
          {trajectory.length > 0 && <span className="text-emerald-600">✓ Completed</span>}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App Shell
// ─────────────────────────────────────────────────────────────────────────────

export default function App(): React.JSX.Element {
  const { activeMode, setActiveMode } = useAgentStore();
  const isCanvas = activeMode === "canvas";
  const currentMode = MODES.find((m) => m.id === activeMode)!;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans select-none">

      {/* ── Left Sidebar ── */}
      <aside className="w-[340px] shrink-0 border-r-2 border-slate-900 bg-white flex flex-col z-20">

        {/* App Header */}
        <div className="shrink-0 h-10 flex items-center justify-between px-3 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <span className="text-sm">🌐</span>
            <span className="text-xs font-bold tracking-tight">Hybrid Local AI Hub</span>
          </div>
          <span className="text-[9px] bg-violet-700 px-1.5 py-0.5 rounded font-bold text-violet-100">
            100% OFFLINE
          </span>
        </div>

        {/* Mode Selector Tabs */}
        <div className="shrink-0 flex border-b-2 border-slate-900 bg-slate-100 p-1 gap-1">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setActiveMode(mode.id)}
              title={mode.desc}
              className={`flex-1 py-1.5 text-[10px] font-bold text-center rounded transition-all cursor-pointer flex flex-col items-center gap-0.5 ${
                activeMode === mode.id
                  ? mode.activeColor + " border-2 shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200 border-2 border-transparent"
              }`}
            >
              <span className="text-sm leading-none">{mode.icon}</span>
              <span className="leading-none">{mode.shortLabel}</span>
            </button>
          ))}
        </div>

        {/* Model selector (agent modes only) */}
        {!isCanvas && <ModelSelectorRow />}

        {/* Sidebar Content */}
        <div className="flex-1 overflow-hidden">
          {activeMode === "user_mode" && <UserMode />}
          {activeMode === "agent_editor" && <AgentEditor />}
          {activeMode === "workflow_editor" && <WorkflowEditor />}
          {activeMode === "canvas" && <CanvasSidebarPanel />}
        </div>

        {/* Agent Status Bar */}
        <AgentStatusBar mode={activeMode} />
      </aside>

      {/* ── Main Content Area ── */}
      <main className="flex-1 flex flex-col relative bg-white overflow-hidden">
        {isCanvas ? (
          // CANVAS MODE — full pipeline editor with toolbar, canvas, log
          <>
            <ExecutionToolbar />
            <div className="flex-1 relative overflow-hidden">
              <GraphCanvas />
            </div>
            <LogTerminal />
          </>
        ) : (
          // AGENT MODES — full live graph canvas + mode badge overlay + log
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Full-size live graph canvas */}
            <div className="flex-1 relative overflow-hidden">
              <GraphCanvas />

              {/* Mode badge + Canvas shortcut — top right corner */}
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2 pointer-events-auto">
                <div className="bg-white/95 backdrop-blur-sm border-2 border-slate-900 rounded-lg px-3 py-1.5 shadow-lg flex items-center gap-2">
                  <span className="text-base">{currentMode.icon}</span>
                  <div>
                    <div className="text-[11px] font-bold text-slate-900 leading-tight">{currentMode.label}</div>
                    <div className="text-[9px] text-slate-500 leading-tight">{currentMode.desc}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveMode("canvas")}
                  title="Open full Canvas editor with Download / Export / Import"
                  className="bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-[10px] font-bold px-2.5 py-2 rounded border-2 border-slate-900 shadow cursor-pointer transition-colors flex items-center gap-1"
                >
                  🎨 Canvas &amp; Export
                </button>
              </div>

              {/* Live node count badge — bottom right */}
              <GraphNodeBadge />
            </div>

            {/* Log Terminal */}
            <LogTerminal />
          </div>
        )}
      </main>
    </div>
  );
}
