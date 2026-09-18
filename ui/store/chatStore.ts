import { create } from "zustand";
import { Graph } from "../schema/graphSchema";

export type ChatGenerationStatus = "idle" | "generating" | "success" | "error";

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
  setInstruction: (val: string) => void;
  setModel: (val: string) => void;
  setIsEditMode: (val: boolean) => void;
  addMessage: (msg: { role: 'user' | 'assistant', content: string }) => void;
  startGeneration: (mode: boolean, prompt: string) => void;
  setSuccess: (graph: Graph) => void;
  setError: (message: string) => void;
  reset: () => void;
  clearHistory: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  status: "idle",
  messages: [],
  instruction: "",
  model: "",
  isEditMode: false,
  resultGraph: null,
  resultMode: null,
  resultPrompt: null,
  errorMessage: null,
  setInstruction: (val) => set({ instruction: val }),
  setModel: (val) => set({ model: val }),
  setIsEditMode: (val) => set({ isEditMode: val }),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  startGeneration: (mode, prompt) =>
    set({ status: "generating", resultGraph: null, errorMessage: null, resultMode: mode, resultPrompt: prompt }),
  setSuccess: (graph) => set({ status: "success", resultGraph: graph }),
  setError: (message) => set({ status: "error", errorMessage: message }),
  reset: () => set({ status: "idle", resultGraph: null, errorMessage: null, instruction: "", resultMode: null, resultPrompt: null }),
  clearHistory: () => set({ messages: [], instruction: "", status: "idle", resultGraph: null, errorMessage: null, resultMode: null, resultPrompt: null }),
}));
