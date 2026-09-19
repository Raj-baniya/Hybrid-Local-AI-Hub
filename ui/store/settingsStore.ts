import { create } from 'zustand';

interface SettingsState {
  isOfflineMode: boolean;
  setOfflineMode: (offline: boolean) => void;
  openAiKey: string;
  setOpenAiKey: (key: string) => void;
  isSettingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOfflineMode: true,
  setOfflineMode: (offline) => set({ isOfflineMode: offline }),
  openAiKey: '',
  setOpenAiKey: (key) => set({ openAiKey: key }),
  isSettingsModalOpen: false,
  setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
}));
