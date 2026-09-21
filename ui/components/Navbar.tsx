import { useSettingsStore } from '../store/settingsStore';
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save, open } from '@tauri-apps/plugin-dialog';
import { useWorkflowStore, ExecutionRecord } from '../store/workflowStore';
import type { Graph } from '../store/workflowStore';
import {
  Play,
  CheckCircle,
  LayoutGrid,
  Save,
  FolderOpen,
  Sparkles,
  ScrollText,
  Plus,
  X,
  Loader2,
  LifeBuoy,
  Square,
  RotateCcw,
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

  const isPreRunDialogOpen = useWorkflowStore((s) => s.isPreRunDialogOpen);
  const setPreRunDialogOpen = useWorkflowStore((s) => s.setPreRunDialogOpen);

  // Scheduled execution state
  const [scheduledTaskId, setScheduledTaskId] = useState<string | null>(null);
  const [isScheduledRunning, setIsScheduledRunning] = useState(false);

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

  // Scheduled task event listeners
  useEffect(() => {
    const unlistenStarted = listen('scheduled-task-started', (event) => {
      setIsScheduledRunning(true);
      setScheduledTaskId(event.payload as string);
    });

    const unlistenExecution = listen<any>('scheduled-task-execution', (event) => {
      const payload = event.payload;
      setExecutionRecord(payload.record);
    });

    const unlistenError = listen<any>('scheduled-task-error', (event) => {
      console.error('Scheduled task error:', event.payload.error);
    });

    const unlistenStopped = listen('scheduled-task-stopped', (event) => {
      if (event.payload === scheduledTaskId) {
        setIsScheduledRunning(false);
        setScheduledTaskId(null);
      }
    });

    return () => {
      unlistenStarted.then((fn) => fn());
      unlistenExecution.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenStopped.then((fn) => fn());
    };
  }, [scheduledTaskId, setExecutionRecord]);

  // Check if graph has ScheduleNode
  const hasScheduleNode = (graph: Graph): boolean => {
    return graph.nodes.some(n => n.data.type === 'ScheduleNode');
  };

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
        await invoke('save_execution_log', { offlineMode: useSettingsStore.getState().isOfflineMode, record });
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

  // Scheduled execution handlers
  const handleStartScheduled = async () => {
    const graph = getActiveGraph();
    if (!hasScheduleNode(graph)) {
      alert('Graph must contain a ScheduleNode for automated execution.');
      return;
    }

    const taskId = `scheduled-${Date.now()}`;
    setIsScheduledRunning(true);
    setScheduledTaskId(taskId);

    try {
      await invoke('run_graph_scheduled', {
        taskId,
        graph,
        config: {
          continueOnFailure: false,
          defaultTimeoutSecs: 15,
          llmTimeoutSecs: 600,
        },
        offlineMode: useSettingsStore.getState().isOfflineMode,
      });
    } catch (err: any) {
      const errorMsg = typeof err === 'string' ? err : err.message;
      alert(`Failed to start scheduled execution:\n${errorMsg}`);
      setIsScheduledRunning(false);
      setScheduledTaskId(null);
    }
  };

  const handleStopScheduled = async () => {
    if (!scheduledTaskId) return;

    try {
      await invoke('stop_scheduled_graph', { taskId: scheduledTaskId });
      setIsScheduledRunning(false);
      setScheduledTaskId(null);
    } catch (err: any) {
      const errorMsg = typeof err === 'string' ? err : err.message;
      alert(`Failed to stop scheduled execution:\n${errorMsg}`);
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

        {(() => {
          const graph = getActiveGraph();
          const hasSchedule = hasScheduleNode(graph);

          if (hasSchedule && isScheduledRunning) {
            return (
              <button
                className="btn"
                onClick={handleStopScheduled}
                style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}
                title="Stop automated scheduled execution"
              >
                <Square size={14} />
                Stop Auto-Run
              </button>
            );
          }

          if (hasSchedule && !isScheduledRunning) {
            return (
              <button
                className="btn"
                onClick={handleStartScheduled}
                disabled={isExecuting}
                style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                title="Start automated scheduled execution (runs continuously on cron schedule)"
              >
                <RotateCcw size={14} />
                Start Auto-Run
              </button>
            );
          }

          return (
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
          );
        })()}
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
