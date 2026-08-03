import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGraphStore } from "../lib/useGraphStore";
import { useExecutionStore } from "../lib/useExecutionStore";

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__));
}

export default function ExecutionToolbar(): React.JSX.Element {
  const graph = useGraphStore((s) => s.graph);
  const addNewGraphTab = useGraphStore((s) => s.addNewGraphTab);
  const { isRunning, startExecution, finishExecution, updateNodeStatus, addLog, resetExecution } =
    useExecutionStore();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExecute = async () => {
    if (isRunning) return;
    setErrorMsg(null);
    startExecution();
    addLog("system", `Starting pipeline execution: "${graph.meta?.title || "Untitled"}"...`);

    if (isTauriAvailable()) {
      try {
        await invoke("execute_graph", { graph });
        addLog("system", "Pipeline execution finished successfully.", "success");
      } catch (err) {
        const msg = String(err);
        setErrorMsg(msg);
        addLog("system", `Pipeline execution result: ${msg}`, "error");
      } finally {
        finishExecution();
      }
    } else {
      for (const node of graph.nodes) {
        updateNodeStatus(node.id, "running", `Executing ${node.label}...`);
        await new Promise((r) => setTimeout(r, 600));
        updateNodeStatus(node.id, "success", `Completed ${node.label}`);
      }
      addLog("system", "Pipeline execution completed simulation.", "success");
      finishExecution();
    }
  };

  const handleExportAgent = async () => {
    const jsonStr = JSON.stringify(graph, null, 2);
    const cleanTitle = (graph.meta?.title || "agent_pipeline")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_");
    const defaultFilename = `${cleanTitle}.json`;

    if (isTauriAvailable()) {
      try {
        await invoke("save_agent_file", {
          defaultFilename,
          content: jsonStr,
        });
      } catch {
        // Fallback browser download if native prompt cancelled
      }
    } else {
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultFilename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
          addNewGraphTab(parsed);
        } else {
          alert("Invalid agent JSON format.");
        }
      } catch {
        alert("Failed to parse agent JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="h-12 bg-white border-b-2 border-slate-900 px-4 flex items-center justify-between shrink-0">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        className="hidden"
      />

      <div className="flex items-center gap-3">
        <h1 className="text-sm font-bold text-slate-900 truncate max-w-xs">
          {graph.meta?.title || "Local AI Automation Pipeline"}
        </h1>
        <span className="text-xs text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded border-2 border-slate-900 font-bold shrink-0">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>
      </div>

      <div className="flex items-center gap-2">
        {errorMsg && (
          <span className="text-xs text-rose-700 bg-rose-50 border-2 border-rose-800 px-2.5 py-1 rounded max-w-md truncate font-medium">
            {errorMsg}
          </span>
        )}

        <button
          type="button"
          onClick={handleImportClick}
          className="text-xs font-bold text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded transition-colors border-2 border-slate-900 cursor-pointer flex items-center gap-1"
          title="Import Agent Pipeline JSON"
        >
          <span>📤</span> Import
        </button>

        <button
          type="button"
          onClick={handleExportAgent}
          className="text-xs font-bold text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded transition-colors border-2 border-slate-900 cursor-pointer flex items-center gap-1"
          title="Download Agent Pipeline JSON"
        >
          <span>📥</span> Download Agent
        </button>

        <button
          type="button"
          onClick={() => resetExecution()}
          disabled={isRunning}
          className="text-xs font-bold text-slate-900 hover:bg-slate-100 px-3 py-1 rounded transition-colors disabled:opacity-50 border-2 border-slate-900 cursor-pointer"
        >
          Reset Logs
        </button>

        <button
          type="button"
          onClick={handleExecute}
          disabled={isRunning || graph.nodes.length === 0}
          className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 px-3.5 py-1 rounded border-2 border-slate-900 transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
        >
          {isRunning ? (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-white animate-ping" />
              Executing...
            </>
          ) : (
            <>
              <span>▶</span> Execute Pipeline
            </>
          )}
        </button>
      </div>
    </div>
  );
}
