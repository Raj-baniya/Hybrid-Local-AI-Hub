import { useSettingsStore } from '../store/settingsStore';
import React, { useState } from 'react';
import { useWorkflowStore, canvasToGraph } from '../store/workflowStore';
import { invoke } from '@tauri-apps/api/core';

export const SavePromptModal: React.FC = () => {
  const { tabs, tabToClose, isSavePromptOpen, confirmCloseTab, cancelCloseTab, markTabClean } = useWorkflowStore();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSavePromptOpen || !tabToClose) return null;

  const tab = tabs.find(t => t.id === tabToClose);
  if (!tab) return null;

  const handleSaveAndClose = async () => {
    let nameToSave = tab.title;
    if (nameToSave.startsWith('Untitled')) {
      const userInput = window.prompt("Enter a name for your agent:");
      if (!userInput || userInput.trim() === '') {
        return; // User cancelled the save
      }
      nameToSave = userInput.trim();
    }

    setIsSaving(true);
    setError(null);
    try {
      const graph = canvasToGraph(tab.nodes, tab.edges);
      await invoke('save_agent', { offlineMode: useSettingsStore.getState().isOfflineMode,  name: nameToSave, graph });
      markTabClean(tab.id);
      confirmCloseTab();
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="wizard-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="glass-panel" style={{
        width: 400,
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
      }}>
        <div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '1.25rem', color: 'var(--text-primary)' }}>Save Changes?</h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Do you want to save the changes you made to <strong>{tab.title}</strong>? <br/>
            Your changes will be lost if you don't save them.
          </p>
        </div>

        {error && (
          <div style={{ color: 'var(--accent-red)', fontSize: '0.85rem', background: 'rgba(239,68,68,0.1)', padding: '8px', borderRadius: '4px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
          <button 
            className="btn btn-secondary" 
            onClick={cancelCloseTab}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button 
            className="btn btn-danger" 
            style={{ background: 'var(--accent-red)', color: 'white', border: 'none' }}
            onClick={confirmCloseTab}
            disabled={isSaving}
          >
            Don't Save
          </button>
          <button 
            className="btn btn-primary" 
            onClick={handleSaveAndClose}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
