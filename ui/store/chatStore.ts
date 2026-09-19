import { useSettingsStore } from './settingsStore';
import { create } from "zustand";
import { Graph } from "../schema/graphSchema";
import { invoke } from "@tauri-apps/api/core";
import { useWorkflowStore } from "./workflowStore";

export type ChatGenerationStatus = "idle" | "generating" | "success" | "error";

export interface ChatHistoryEntry {
  id: string;
  timestamp: string;
  instruction: string;
  model: string;
  graph: Graph;
}

interface ChatState {
  status: ChatGenerationStatus;
  messages: { role: 'user' | 'assistant', content: string }[];
  instruction: string;
  model: string;
  isEditMode: boolean;
  resultGraph: Graph | null;
  resultMode: boolean | null;
  resultPrompt: string | null;
  errorMessage: string | null;
  history: ChatHistoryEntry[];
  setInstruction: (val: string) => void;
  setModel: (val: string) => void;
  setIsEditMode: (val: boolean) => void;
  addMessage: (msg: { role: 'user' | 'assistant', content: string }) => void;
  startGeneration: (mode: boolean, prompt: string) => void;
  setSuccess: (graph: Graph) => void;
  setError: (message: string) => void;
  reset: () => void;
  clearHistory: () => void;
  fetchHistory: () => Promise<void>;
  deleteHistoryItem: (id: string) => Promise<void>;
  loadHistoryItem: (id: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  status: "idle",
  messages: [],
  instruction: "",
  model: "",
  isEditMode: false,
  resultGraph: null,
  resultMode: null,
  resultPrompt: null,
  errorMessage: null,
  history: [],
  setInstruction: (val) => set({ instruction: val }),
  setModel: (val) => set({ model: val }),
  setIsEditMode: (val) => set({ isEditMode: val }),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  startGeneration: (mode, prompt) =>
    // Keep the previous resultGraph so buttons remain visible during re-generation.
    // Only clear errorMessage and update mode/prompt.
    set({ status: "generating", errorMessage: null, resultMode: mode, resultPrompt: prompt }),
  setSuccess: (graph) => set({ status: "success", resultGraph: graph }),
  setError: (message) => set({ status: "error", errorMessage: message }),
  reset: () => set({ status: "idle", resultGraph: null, errorMessage: null, instruction: "", resultMode: null, resultPrompt: null }),
  // clearHistory wipes the full session including any loaded graph.
  clearHistory: () => set({ messages: [], instruction: "", status: "idle", resultGraph: null, errorMessage: null, resultMode: null, resultPrompt: null }),
  
  fetchHistory: async () => {
    try {
      const history = await invoke('list_chat_history', { offlineMode: useSettingsStore.getState().isOfflineMode });
      set({ history });
    } catch (e) {
      console.error("Failed to load chat history", e);
    }
  },
  
  deleteHistoryItem: async (id: string) => {
    try {
      await invoke('delete_chat_history', { offlineMode: useSettingsStore.getState().isOfflineMode,  id });
      set((state) => ({ history: state.history.filter((h) => h.id !== id) }));
    } catch (e) {
      console.error("Failed to delete chat history item", e);
    }
  },

  loadHistoryItem: (id: string) => {
    const item = get().history.find((h) => h.id === id);
    if (!item) return;
    
    set({
      messages: [{ role: 'user', content: item.instruction }, { role: 'assistant', content: `Loaded graph: ${item.graph.name || 'Untitled'}` }],
      instruction: "",
      model: item.model,
      isEditMode: true,
      resultGraph: item.graph,
      status: "idle",
      errorMessage: null,
      resultMode: true,
      resultPrompt: item.instruction,
    });
    
  }
}));
