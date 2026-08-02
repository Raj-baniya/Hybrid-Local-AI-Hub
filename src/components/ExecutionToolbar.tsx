import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGraphStore } from "../lib/useGraphStore";
import { useExecutionStore } from "../lib/useExecutionStore";

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__));
}

export default function ExecutionToolbar(): React.JSX.Element {
  const graph = useGraphStore((s) => s.graph);
  const { isRunning, startExecution, finishExecution, updateNodeStatus, addLog, resetExecution } =
    useExecutionStore();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  return (
    <div className="h-12 bg-white border-b-2 border-slate-900 px-4 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-bold text-slate-900">
          {graph.meta?.title || "Local AI Automation Pipeline"}
        </h1>
        <span className="text-xs text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded border-2 border-slate-900 font-bold">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>
      </div>

      <div className="flex items-center gap-3">
        {errorMsg && (
          <span className="text-xs text-rose-700 bg-rose-50 border-2 border-rose-800 px-2.5 py-1 rounded max-w-md truncate font-medium">
            {errorMsg}
          </span>
        )}

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
