import { create } from "zustand";

export type NodeExecutionStatus = "idle" | "running" | "success" | "error";

export interface LogEntry {
  id: string;
  timestamp: string;
  nodeId: string;
  status: NodeExecutionStatus;
  message: string;
}

interface ExecutionStore {
  isExecuting: boolean;
  nodeStatuses: Record<string, NodeExecutionStatus>;
  logs: LogEntry[];
  setIsExecuting: (val: boolean) => void;
  updateNodeStatus: (nodeId: string, status: NodeExecutionStatus, message?: string) => void;
  clearLogs: () => void;
}

export const useExecutionStore = create<ExecutionStore>((set) => ({
  isExecuting: false,
  nodeStatuses: {},
  logs: [],
  setIsExecuting: (val) => set({ isExecuting: val }),
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
  clearLogs: () => set({ nodeStatuses: {}, logs: [], isExecuting: false }),
}));
