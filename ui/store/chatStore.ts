import { create } from "zustand";
import { Graph } from "../schema/graphSchema";

export type ChatGenerationStatus = "idle" | "generating" | "success" | "error";

interface ChatState {
  status: ChatGenerationStatus;
  instruction: string;
  model: string;
  temperature: number;
  isEditMode: boolean;
  resultGraph: Graph | null;
  errorMessage: string | null;
  setInstruction: (val: string) => void;
  setModel: (val: string) => void;
  setTemperature: (val: number) => void;
  setIsEditMode: (val: boolean) => void;
  startGeneration: () => void;
  setSuccess: (graph: Graph) => void;
  setError: (message: string) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  status: "idle",
  instruction: "",
  model: "",
  temperature: 0.2,
  isEditMode: false,
  resultGraph: null,
  errorMessage: null,
  setInstruction: (val) => set({ instruction: val }),
  setModel: (val) => set({ model: val }),
  setTemperature: (val) => set({ temperature: val }),
  setIsEditMode: (val) => set({ isEditMode: val }),
  startGeneration: () =>
    set({ status: "generating", resultGraph: null, errorMessage: null }),
  setSuccess: (graph) => set({ status: "success", resultGraph: graph }),
  setError: (message) => set({ status: "error", errorMessage: message }),
  reset: () => set({ status: "idle", resultGraph: null, errorMessage: null }),
}));
