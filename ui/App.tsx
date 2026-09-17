import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { NodePalette } from './components/NodePalette';
import { GraphCanvas } from './components/GraphCanvas';
import { NodeInspector } from './components/NodeInspector';
import { ChatPanel } from './components/ChatPanel';
import { LogPanel } from './components/LogPanel';
import { ModelManager } from './components/ModelManager';
import { SavedAgentsPanel } from './components/SavedAgentsPanel';
import { HelpAgentPanel } from './components/HelpAgentPanel';
import { SetupWizard } from './components/SetupWizard';
import { SavePromptModal } from './components/SavePromptModal';
import { useWorkflowStore } from './store/workflowStore';

type OllamaStatus =
  | { state: "NotRunning" }
  | { state: "NoModels" }
  | { state: "Ready"; models: { name: string }[] };

export const App: React.FC = () => {
  const activePanel = useWorkflowStore((s) => s.activePanel);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const [showWizard, setShowWizard] = useState<boolean | null>(null);
  const theme = useWorkflowStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  useEffect(() => {
    const completed = localStorage.getItem('onboarding_complete');
    if (completed === 'true') {
      invoke<OllamaStatus>('cmd_check_ollama', {}).then(s => {
        setShowWizard(s.state === 'NotRunning');
      }).catch(() => {
        setShowWizard(true);
      });
    } else {
      setShowWizard(true);
    }
  }, []);

  // Global Keyboard Shortcuts for Tab Management
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement || 
        target instanceof HTMLTextAreaElement || 
        target.isContentEditable
      ) {
        return;
      }

      if (e.ctrlKey) {
        const key = e.key.toLowerCase();
        
        if (key === 't') {
          e.preventDefault();
          useWorkflowStore.getState().createTab();
        } 
        else if (key === 'w') {
          e.preventDefault();
          const state = useWorkflowStore.getState();
          if (state.activeTabId) {
            state.requestCloseTab(state.activeTabId);
          }
        }
        else if (key === 'tab') {
          e.preventDefault();
          const state = useWorkflowStore.getState();
          const currentIdx = state.tabs.findIndex(t => t.id === state.activeTabId);
          if (currentIdx !== -1 && state.tabs.length > 1) {
            const nextIdx = e.shiftKey ? 
              (currentIdx - 1 + state.tabs.length) % state.tabs.length : 
              (currentIdx + 1) % state.tabs.length;
            state.switchTab(state.tabs[nextIdx].id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (showWizard === null) {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 50%, var(--bg-secondary) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: 14,
      }}>
        Loading...
      </div>
    );
  }

  if (showWizard) {
    return <SetupWizard onComplete={() => setShowWizard(false)} />;
  }

  return (
    <ReactFlowProvider>
      <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <Sidebar />
        
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <TopBar />
          
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
            
            {/* Active Side Panel */}
            {activePanel !== 'none' && (
              <div style={{ width: 360, height: '100%', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: activePanel === 'nodes' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
                  <NodePalette />
                </div>
                <div style={{ display: activePanel === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
                  <ChatPanel />
                </div>
                <div style={{ display: activePanel === 'logs' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
                  <LogPanel />
                </div>
                <div style={{ display: activePanel === 'models' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
                  <ModelManager />
                </div>
                <div style={{ display: activePanel === 'agents' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
                  <SavedAgentsPanel />
                </div>
                <div style={{ display: activePanel === 'help' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
                  <HelpAgentPanel />
                </div>
              </div>
            )}

            {/* Main Canvas */}
            <div style={{ flex: 1, position: 'relative' }}>
              <GraphCanvas />
            </div>

            {/* Floating Inspector (Right Side) */}
            <div style={{ 
              display: (activePanel === 'inspector' || (!activePanel && selectedNodeId)) ? 'block' : 'none', 
              position: 'absolute', 
              right: 16, 
              top: 16, 
              bottom: 16, 
              width: 320, 
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)', 
              borderRadius: 12, 
              overflow: 'hidden',
              zIndex: 10 
            }}>
              <NodeInspector />
            </div>
          </div>
        </div>
      </div>
      <SavePromptModal />
    </ReactFlowProvider>
  );
};
