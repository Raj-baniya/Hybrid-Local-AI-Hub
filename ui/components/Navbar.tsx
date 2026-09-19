import { useSettingsStore } from '../store/settingsStore';
import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save, open } from '@tauri-apps/plugin-dialog';
import { useWorkflowStore, ExecutionRecord } from '../store/workflowStore';
import { Graph } from '../schema/graphSchema';
import {
  Play,
  CheckCircle,
  LayoutGrid,
  Save,
  FolderOpen,
  Sparkles,
  ScrollText,
  Cpu,
  Plus,
  X,
  Loader2,
  Moon,
  Sun,
  Bot,
  LifeBuoy,
} from 'lucide-react';
import { PreRunDialog } from './PreRunDialog';

export const Navbar: React.FC = () => {
  const tabs = useWorkflowStore((s) => s.tabs);
  const activeTabId = useWorkflowStore((s) => s.activeTabId);
  const switchTab = useWorkflowStore((s) => s.switchTab);
  const closeTab = useWorkflowStore((s) => s.closeTab);
  const createTab = useWorkflowStore((s) => s.createTab);
  const setTabFilePath = useWorkflowStore((s) => s.setTabFilePath);

  const getActiveGraph = useWorkflowStore((s) => s.getActiveGraph);
  const loadGraphIntoActiveTab = useWorkflowStore((s) => s.loadGraphIntoActiveTab);
  const autoLayout = useWorkflowStore((s) => s.autoLayout);

  const activePanel = useWorkflowStore((s) => s.activePanel);
  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);

  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const setIsExecuting = useWorkflowStore((s) => s.setIsExecuting);
  const setNodeStatus = useWorkflowStore((s) => s.setNodeStatus);
  const clearNodeStatuses = useWorkflowStore((s) => s.clearNodeStatuses);
  const setExecutionRecord = useWorkflowStore((s) => s.setExecutionRecord);
  const theme = useWorkflowStore((s) => s.theme);
  const setTheme = useWorkflowStore((s) => s.setTheme);

  const isPreRunDialogOpen = useWorkflowStore((s) => s.isPreRunDialogOpen);
  const setPreRunDialogOpen = useWorkflowStore((s) => s.setPreRunDialogOpen);

  // Real-time per-node progress listener
  useEffect(() => {
    const unlisten = listen<any>('node-progress', (event) => {
      const nr = event.payload;
      const rawStatus: string = (nr.status ?? '').toLowerCase();
      let uiStatus: 'running' | 'success' | 'failed' | 'skipped' | 'idle' = 'idle';
      if (rawStatus === 'running') uiStatus = 'running';
      else if (rawStatus === 'success') uiStatus = 'success';
      else if (rawStatus === 'failed') uiStatus = 'failed';
      else if (rawStatus === 'skipped') uiStatus = 'skipped';
      setNodeStatus(nr.node_id, {
        status: uiStatus,
        durationMs: nr.duration_ms ?? undefined,
        outputPreview: nr.output_preview ?? undefined,
        error: nr.error ?? undefined,
      });

      // Update live execution record for Log Panel streaming
      const state = useWorkflowStore.getState();
      if (state.executionRecord && state.executionRecord.overall_status === 'running') {
        const updatedNodes = state.executionRecord.nodes.map(n => {
          if (n.node_id === nr.node_id) {
            return { ...n, ...nr, status: rawStatus || n.status };
          }
          return n;
        });
        state.setExecutionRecord({ ...state.executionRecord, nodes: updatedNodes });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setNodeStatus]);

  const handleRunRequest = () => {
    const graph = getActiveGraph();
    if (graph.nodes.length === 0) {
      alert('Graph is empty. Add nodes before running.');
      return;
    }
    setPreRunDialogOpen(true);
  };

  const handleRunConfirm = async () => {
    setPreRunDialogOpen(false);
    
    const graph = getActiveGraph();
    setIsExecuting(true);
    clearNodeStatuses();

    // Initialize pending live execution record
    setExecutionRecord({
      execution_id: 'live-' + Date.now(),
      trigger_source: 'ui',
      started_at: new Date().toISOString(),
      overall_status: 'running',
      nodes: graph.nodes.map(n => ({
        node_id: n.id,
        node_type: n.data.type,
        status: 'pending'
      }))
    });

    try {
      const record = await invoke<ExecutionRecord>('run_graph', { graph });
      setExecutionRecord(record);
      
      // Persist the log
      try {
        await invoke('save_execution_log', { offlineMode: isOfflineMode,  record });
      } catch (err) {
        console.error("Failed to save execution log:", err);
      }

      // Final reconcile — ensure all final states are correct
      record.nodes.forEach((nr) => {
        const rawStatus = (nr.status ?? '').toLowerCase();
        setNodeStatus(nr.node_id, {
          status: rawStatus === 'success' ? 'success'
            : rawStatus === 'failed' ? 'failed'
            : rawStatus === 'skipped' ? 'skipped'
            : 'idle',
          durationMs: nr.duration_ms,
          outputPreview: nr.output_preview,
          error: nr.error,
        });
      });

      // Automatically open logs panel on any failure
      if (record.overall_status !== 'success') {
        setActivePanel('logs');
      }
    } catch (err: any) {
      const errorMsg = typeof err === 'string' ? err : err.message;
      alert(`Execution failed:\n${errorMsg}`);
      
      const state = useWorkflowStore.getState();
      if (state.executionRecord) {
        setExecutionRecord({
          ...state.executionRecord,
          overall_status: 'failed',
          finished_at: new Date().toISOString(),
          nodes: state.executionRecord.nodes.map((n) => 
            n.status === 'pending' ? { ...n, status: 'failed', error: errorMsg } : n
          )
        });
        
        state.executionRecord.nodes.forEach((n) => {
          if (n.status === 'pending') {
            setNodeStatus(n.node_id, {
              status: 'failed',
              error: errorMsg
            });
          }
        });
      }
      setActivePanel('logs');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleValidate = async () => {
    const graph = getActiveGraph();
    try {
      await invoke('validate_graph', { graph });
      alert('✓ Workflow validation passed! All nodes and connections are structurally sound.');
    } catch (errs: any) {
      const msg = Array.isArray(errs) ? errs.join('\n') : JSON.stringify(errs);
      alert(`Validation errors found:\n${msg}`);
    }
  };

  const handleSave = async () => {
    const graph = getActiveGraph();
    try {
      const selected = await save({
        filters: [{ name: 'Workflow JSON', extensions: ['json'] }],
        defaultPath: 'workflow.json',
      });

      if (selected) {
        // Also let's ask for the internal agent name if they want to save to the library.
        // For simplicity, we just save via standard dialog here, but we also save to the internal library.
        const name = selected.split(/[/\\]/).pop()?.replace('.json', '') || 'agent';
        await invoke('save_workflow', { path: selected, graph });
        await invoke('save_agent', { offlineMode: useSettingsStore.getState().isOfflineMode,  name, graph });
        setTabFilePath(activeTabId, selected);
      }
    } catch (err: any) {
      alert(`Failed to save workflow: ${err}`);
    }
  };

  const handleLoad = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Workflow JSON', extensions: ['json'] }],
      });

      if (selected && typeof selected === 'string') {
        const loadedGraph = await invoke<Graph>('load_workflow', { path: selected });
        const filename = selected.split(/[/\\]/).pop() || 'Loaded';
        loadGraphIntoActiveTab(loadedGraph, filename, selected);
      }
    } catch (err: any) {
      alert(`Failed to load workflow: ${err}`);
    }
  };

  const togglePanel = (panel: 'chat' | 'logs' | 'models' | 'agents' | 'help') => {
    setActivePanel(activePanel === panel ? 'none' : panel);
  };

  return (
    <div
      style={{
        height: 56,
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        userSelect: 'none',
        zIndex: 20,
      }}
    >
      {isPreRunDialogOpen && (
        <PreRunDialog 
          onConfirm={handleRunConfirm}
          onCancel={() => setPreRunDialogOpen(false)} 
        />
      )}
      {/* Left: Brand & Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            H
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: -0.3, color: 'var(--text-primary)' }}>
            Hybrid Local <span style={{ color: 'var(--accent-cyan)' }}>AI Hub</span>
          </span>
        </div>

        {/* Tab Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: isActive ? 'var(--bg-glass)' : 'transparent',
                  border: isActive ? '1px solid var(--border-medium)' : '1px solid transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.15s ease',
                }}
              >
                <span>
                  {tab.title}
                  {tab.isDirty ? ' *' : ''}
                </span>
                {tabs.length > 1 && (
                  <X
                    size={12}
                    style={{ color: 'var(--text-muted)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                  />
                )}
              </div>
            );
          })}
          <button
            onClick={() => createTab()}
            title="New Workflow Tab"
            style={{
              background: 'transparent',
              border: '1px dashed var(--border-medium)',
              borderRadius: 6,
              padding: '5px 8px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Center: Canvas Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => autoLayout('LR')} title="Organize Layout">
          <LayoutGrid size={14} />
          Auto Layout
        </button>

        <button className="btn btn-secondary" onClick={handleValidate} title="Validate DAG Structural Integrity">
          <CheckCircle size={14} />
          Validate
        </button>

        <button
          className="btn btn-primary"
          onClick={handleRunRequest}
          disabled={isExecuting}
          style={{ background: 'linear-gradient(135deg, var(--accent-emerald) 0%, #10b981 100%)' }}
        >
          {isExecuting ? (
            <>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              Executing...
            </>
          ) : (
            <>
              <Play size={14} />
              Run Pipeline
            </>
          )}
        </button>
      </div>

      {/* Right: File Ops & Panel Toggles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-secondary btn-icon" onClick={handleLoad} title="Open Workflow JSON">
          <FolderOpen size={16} />
        </button>
        <button className="btn btn-secondary btn-icon" onClick={handleSave} title="Save Workflow JSON">
          <Save size={16} />
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--border-medium)', margin: '0 4px' }} />

        <button
          className={`btn ${activePanel === 'help' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => togglePanel('help')}
          style={{ 
            background: activePanel === 'help' ? 'linear-gradient(135deg, var(--accent-emerald) 0%, #10b981 100%)' : undefined,
            color: activePanel === 'help' ? 'white' : undefined
          }}
        >
          <LifeBuoy size={14} />
          Help Agent
        </button>

        <button
          className={`btn ${activePanel === 'chat' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => togglePanel('chat')}
        >
          <Sparkles size={14} />
          Chat AI
        </button>

        <button
          className={`btn ${activePanel === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => togglePanel('logs')}
        >
          <ScrollText size={14} />
          Logs
        </button>
      </div>
    </div>
  );
};
