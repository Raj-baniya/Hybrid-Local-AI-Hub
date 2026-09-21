import { useSettingsStore } from './settingsStore';
import { create } from "zustand";
import { Graph } from "../schema/graphSchema";
import { invoke } from "@tauri-apps/api/core";

export type ChatGenerationStatus = "idle" | "generating" | "success" | "error";

export interface ChatHistoryEntry {
  id: string;
  timestamp: string;
  instruction: string;
  model: string;
  graph: Graph;
  messages: { role: string; content: string }[];
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
  activeChatId: string | null;
  setInstruction: (val: string) => void;
  setModel: (val: string) => void;
  setIsEditMode: (val: boolean) => void;
  addMessage: (msg: { role: 'user' | 'assistant', content: string }) => void;
  startGeneration: (mode: boolean, prompt: string) => void;
  setSuccess: (graph: Graph) => void;
  setError: (message: string) => void;
  reset: () => void;
  clearHistory: () => void;
  startNewChat: () => void;
  fetchHistory: () => Promise<void>;
  deleteHistoryItem: (id: string) => Promise<void>;
  loadHistoryItem: (id: string) => void;
  setActiveChatId: (id: string | null) => void;
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
  activeChatId: null,
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
  reset: () => set({ status: "idle", resultGraph: null, errorMessage: null, instruction: "", resultMode: null, resultPrompt: null, activeChatId: null }),
  // clearHistory wipes the full session including any loaded graph, but keeps persisted history.
  clearHistory: () => set({ messages: [], instruction: "", status: "idle", resultGraph: null, errorMessage: null, resultMode: null, resultPrompt: null, activeChatId: null, isEditMode: false }),
  // startNewChat clears the current session and starts a fresh conversation with no active ID.
  startNewChat: () => set({
    messages: [],
    instruction: '',
    status: 'idle',
    resultGraph: null,
    errorMessage: null,
    resultMode: null,
    resultPrompt: null,
    activeChatId: null,
    isEditMode: false,
  }),

  fetchHistory: async () => {
    try {
      const history = await invoke<ChatHistoryEntry[]>('list_chat_history', { offlineMode: useSettingsStore.getState().isOfflineMode });
      set({ history });
    } catch (e) {
      console.error("Failed to load chat history", e);
    }
  },

  deleteHistoryItem: async (id: string) => {
    try {
      await invoke('delete_chat_history', { offlineMode: useSettingsStore.getState().isOfflineMode, id });
      const state = get();
      set({
        history: state.history.filter((h) => h.id !== id),
        // If we deleted the active chat, clear the active ID
        ...(state.activeChatId === id ? { activeChatId: null } : {}),
      });
    } catch (e) {
      console.error("Failed to delete chat history item", e);
    }
  },

  loadHistoryItem: (id: string) => {
    const item = get().history.find((h) => h.id === id);
    if (!item) return;

    // If the history item has saved messages, restore them; otherwise reconstruct from instruction
    const restoredMessages: { role: 'user' | 'assistant', content: string }[] =
      item.messages && item.messages.length > 0
        ? item.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        : [
          { role: 'user', content: item.instruction },
          { role: 'assistant', content: `Loaded graph: ${item.graph.name || 'Untitled'}` },
        ];

    set({
      messages: restoredMessages,
      instruction: "",
      model: item.model,
      isEditMode: true,
      resultGraph: item.graph,
      status: "idle",
      errorMessage: null,
      resultMode: true,
      resultPrompt: item.instruction,
      activeChatId: item.id,
    });

  },

  setActiveChatId: (id) => set({ activeChatId: id }),
}));