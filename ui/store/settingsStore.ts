import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
  
  agentTriggers: Record<string, { wakeWord?: string, hotkey?: string }>;
  setAgentTrigger: (agentName: string, triggers: { wakeWord?: string, hotkey?: string }) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
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

      agentTriggers: {},
      setAgentTrigger: (agentName, triggers) => set((state) => {
        const newTriggers = { ...state.agentTriggers, [agentName]: { ...state.agentTriggers[agentName], ...triggers } };
        return { agentTriggers: newTriggers };
      }),
    }),
    {
      name: 'settings-storage', // name of the item in the storage (must be unique)
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
      partialize: (state) => ({ 
        isOfflineMode: state.isOfflineMode,
        openAiKey: state.openAiKey,
        ollamaModel: state.ollamaModel,
        ollamaUrl: state.ollamaUrl,
        autoSaveAgents: state.autoSaveAgents,
        agentTriggers: state.agentTriggers 
        // We do NOT persist isSettingsModalOpen because we want it closed on reload
      }),
    }
  )
);
