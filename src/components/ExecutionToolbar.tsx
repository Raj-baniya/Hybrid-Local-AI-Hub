import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useGraphStore } from "../lib/useGraphStore";
import { useExecutionStore } from "../lib/useExecutionStore";

interface NodeStatusPayload {
  node_id: string;
  status: "running" | "success" | "error";
  message?: string;
}

interface FileWatcherTriggerPayload {
  node_id: string;
  file_path: string;
}

export default function ExecutionToolbar(): React.JSX.Element {
  const graph = useGraphStore((s) => s.graph);
  const { isExecuting, setIsExecuting, updateNodeStatus, clearLogs } = useExecutionStore();

  useEffect(() => {
    let unlistenStatus: (() => void) | undefined;
    let unlistenWatcher: (() => void) | undefined;

    listen<NodeStatusPayload>("node-status", (event) => {
      const { node_id, status, message } = event.payload;
      updateNodeStatus(node_id, status, message);
    }).then((fn) => {
      unlistenStatus = fn;
    });

    listen<FileWatcherTriggerPayload>("file-watcher-triggered", (event) => {
      const { node_id, file_path } = event.payload;
      updateNodeStatus(node_id, "running", `File watcher triggered by ${file_path}`);
      invoke("execute_graph", { graph }).catch((err) => {
        updateNodeStatus(node_id, "error", String(err));
      });
    }).then((fn) => {
      unlistenWatcher = fn;
    });

    return () => {
      if (unlistenStatus) unlistenStatus();
      if (unlistenWatcher) unlistenWatcher();
    };
  }, [graph, updateNodeStatus]);

  const handleExecute = async () => {
    if (graph.nodes.length === 0 || isExecuting) return;

    clearLogs();
    setIsExecuting(true);

    try {
      await invoke("execute_graph", { graph });
    } catch (err) {
      updateNodeStatus("system", "error", String(err));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="h-12 bg-neutral-900 border-b border-neutral-800 px-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-neutral-200">
          {graph.meta?.title || "Pipeline Canvas"}
        </span>
        <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded font-mono">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={clearLogs}
          disabled={isExecuting}
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 text-xs rounded border border-neutral-700 transition-colors"
        >
          Reset Logs
        </button>

        <button
          type="button"
          onClick={handleExecute}
          disabled={isExecuting || graph.nodes.length === 0}
          className={`px-4 py-1.5 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors ${
            isExecuting
              ? "bg-amber-600 text-white cursor-not-allowed animate-pulse"
              : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
          }`}
        >
          <span>{isExecuting ? "⏳ Running Pipeline..." : "▶ Execute Pipeline"}</span>
        </button>
      </div>
    </div>
  );
}
