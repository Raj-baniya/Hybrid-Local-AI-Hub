import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";

export type NodeExecutionStatus = "idle" | "running" | "success" | "error";

export interface LogEntry {
  id: string;
  timestamp: string;
  nodeId: string;
  status: NodeExecutionStatus;
  message: string;
}

interface NodeStatusEventPayload {
  node_id: string;
  status: NodeExecutionStatus;
  message?: string;
}

const MAX_LOG_ENTRIES = 500;

interface ExecutionStore {
  isRunning: boolean;
  nodeStatuses: Record<string, NodeExecutionStatus>;
  logs: LogEntry[];
  startExecution: () => void;
  finishExecution: () => void;
  updateNodeStatus: (nodeId: string, status: NodeExecutionStatus, message?: string) => void;
  addLog: (nodeId: string, message: string, status?: NodeExecutionStatus) => void;
  resetExecution: () => void;
}

// Hold the cleanup function so we can call it if needed (HMR, tests, etc.)
let _unlistenNodeStatus: (() => void) | null = null;

export const useExecutionStore = create<ExecutionStore>((set) => {
  // Register Tauri node-status event listener once, store unlisten for cleanup
  if (typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__)) {
    listen<NodeStatusEventPayload>("node-status", (event) => {
      const { node_id, status, message } = event.payload;
      const now = new Date().toLocaleTimeString();
      const newEntry: LogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: now,
        nodeId: node_id,
        status: status || "running",
        message: message || `Node ${node_id}: ${status}`,
      };

      set((state) => ({
        nodeStatuses: {
          ...state.nodeStatuses,
          [node_id]: status,
        },
        // Cap at MAX_LOG_ENTRIES to prevent unbounded memory growth
        logs: [newEntry, ...state.logs].slice(0, MAX_LOG_ENTRIES),
      }));
    }).then((unlisten) => {
      _unlistenNodeStatus = unlisten;
    }).catch(() => {
      // Tauri not ready yet — harmless in browser/dev mode
    });
  }

  return {
    isRunning: false,
    nodeStatuses: {},
    logs: [],
    startExecution: () => set({ isRunning: true }),
    finishExecution: () => set({ isRunning: false }),
    updateNodeStatus: (nodeId, status, message) =>
      set((state) => {
        const now = new Date().toLocaleTimeString();
        const newEntry: LogEntry = {
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          timestamp: now,
          nodeId,
          status,
          message: message || `Node ${nodeId}: ${status}`,
        };

        return {
          nodeStatuses: {
            ...state.nodeStatuses,
            [nodeId]: status,
          },
          logs: [newEntry, ...state.logs].slice(0, MAX_LOG_ENTRIES),
        };
      }),
    addLog: (nodeId, message, status = "running") =>
      set((state) => {
        const now = new Date().toLocaleTimeString();
        const newEntry: LogEntry = {
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          timestamp: now,
          nodeId,
          status,
          message,
        };
        return { logs: [newEntry, ...state.logs].slice(0, MAX_LOG_ENTRIES) };
      }),
    resetExecution: () => set({ nodeStatuses: {}, logs: [], isRunning: false }),
  };
});

/** Call this to clean up the Tauri event listener (e.g. in tests or HMR). */
export function cleanupExecutionStore() {
  if (_unlistenNodeStatus) {
    _unlistenNodeStatus();
    _unlistenNodeStatus = null;
  }
}
