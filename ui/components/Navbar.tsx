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
} from 'lucide-react';

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
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setNodeStatus]);

  const handleRun = async () => {
    const graph = getActiveGraph();
    if (graph.nodes.length === 0) {
      alert('Graph is empty. Add nodes before running.');
      return;
    }

    setIsExecuting(true);
    clearNodeStatuses();

    try {
      const record = await invoke<ExecutionRecord>('run_graph', { graph });
      setExecutionRecord(record);

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
      alert(`Execution failed:\n${typeof err === 'string' ? err : err.message}`);
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
        await invoke('save_workflow', { path: selected, graph });
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

  const togglePanel = (panel: 'chat' | 'logs' | 'models') => {
    setActivePanel(activePanel === panel ? 'none' : panel);
  };

  return (
    <div
      style={{
        height: 56,
        background: 'rgba(15, 23, 42, 0.95)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        userSelect: 'none',
        zIndex: 20,
      }}
    >
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
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: -0.3, color: '#f8fafc' }}>
            Hybrid Local <span style={{ color: '#38bdf8' }}>AI Hub</span>
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
                  background: isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                  border: isActive ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: isActive ? '#f8fafc' : '#94a3b8',
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
                    style={{ color: '#64748b' }}
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
              border: '1px dashed rgba(255, 255, 255, 0.15)',
              borderRadius: 6,
              padding: '5px 8px',
              color: '#94a3b8',
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
          onClick={handleRun}
          disabled={isExecuting}
          style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' }}
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

        <div style={{ width: 1, height: 20, background: 'rgba(255, 255, 255, 0.1)', margin: '0 4px' }} />

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

        <button
          className={`btn ${activePanel === 'models' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => togglePanel('models')}
        >
          <Cpu size={14} />
          Models
        </button>
      </div>
    </div>
  );
};
