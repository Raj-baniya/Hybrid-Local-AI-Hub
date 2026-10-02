import { create } from 'zustand';

interface SettingsState {
  isOfflineMode: boolean;
  setOfflineMode: (offline: boolean) => void;
  openAiKey: string;
  setOpenAiKey: (key: string) => void;
  isSettingsModalOpen: boolean;
  ollamaModel: string;
  setOllamaModel: (m: string) => void;
  ollamaUrl: string;
  setOllamaUrl: (u: string) => void;
  setSettingsModalOpen: (open: boolean) => void;
  autoSaveAgents: boolean | null;
  setAutoSaveAgents: (val: boolean | null) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOfflineMode: true,
  setOfflineMode: (offline) => set({ isOfflineMode: offline }),
  openAiKey: '',
  setOpenAiKey: (key) => set({ openAiKey: key }),
  isSettingsModalOpen: false,
  setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
  ollamaModel: 'llama3.2',
  setOllamaModel: (m) => set({ ollamaModel: m }),
  ollamaUrl: 'http://localhost:11434',
  setOllamaUrl: (u) => set({ ollamaUrl: u }),
  autoSaveAgents: null,
  setAutoSaveAgents: (val) => set({ autoSaveAgents: val }),
}));
