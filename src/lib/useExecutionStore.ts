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

export const useExecutionStore = create<ExecutionStore>((set) => {
  // Listen for Tauri backend node execution events
  if (typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__)) {
    listen<NodeStatusEventPayload>("node-status", (event) => {
      const { node_id, status, message } = event.payload;
      const now = new Date().toLocaleTimeString();
      const newEntry: LogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: now,
        nodeId: node_id,
        status: status || "running",
        message: message || `Node ${node_id} status: ${status}`,
      };

      set((state) => ({
        nodeStatuses: {
          ...state.nodeStatuses,
          [node_id]: status,
        },
        logs: [newEntry, ...state.logs],
      }));
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
          message: message || `Node ${nodeId} status: ${status}`,
        };

        return {
          nodeStatuses: {
            ...state.nodeStatuses,
            [nodeId]: status,
          },
          logs: [newEntry, ...state.logs],
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
        return { logs: [newEntry, ...state.logs] };
      }),
    resetExecution: () => set({ nodeStatuses: {}, logs: [], isRunning: false }),
  };
});
