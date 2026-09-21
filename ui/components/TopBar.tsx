import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save, open } from '@tauri-apps/plugin-dialog';
import { useWorkflowStore, ExecutionRecord } from '../store/workflowStore';
import type { Graph } from '../store/workflowStore';
import { useSettingsStore } from '../store/settingsStore';
import {
  Play,
  LayoutGrid,
  Save,
  FolderOpen,
  Plus,
  X,
  Loader2,
  Square,
  RotateCcw,
} from 'lucide-react';
import { PreRunDialog } from './PreRunDialog';

export const TopBar: React.FC = () => {
  const tabs = useWorkflowStore((s) => s.tabs);
  const activeTabId = useWorkflowStore((s) => s.activeTabId);
  const switchTab = useWorkflowStore((s) => s.switchTab);
  const requestCloseTab = useWorkflowStore((s) => s.requestCloseTab);
  const createTab = useWorkflowStore((s) => s.createTab);
  const setTabFilePath = useWorkflowStore((s) => s.setTabFilePath);

  const isOfflineMode = useSettingsStore((s) => s.isOfflineMode);

  const getActiveGraph = useWorkflowStore((s) => s.getActiveGraph);
  const loadGraphIntoActiveTab = useWorkflowStore((s) => s.loadGraphIntoActiveTab);
  const autoLayout = useWorkflowStore((s) => s.autoLayout);

  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);

  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const setIsExecuting = useWorkflowStore((s) => s.setIsExecuting);
  const setNodeStatus = useWorkflowStore((s) => s.setNodeStatus);
  const clearNodeStatuses = useWorkflowStore((s) => s.clearNodeStatuses);
  const setExecutionRecord = useWorkflowStore((s) => s.setExecutionRecord);

  const isPreRunDialogOpen = useWorkflowStore((s) => s.isPreRunDialogOpen);
  const setPreRunDialogOpen = useWorkflowStore((s) => s.setPreRunDialogOpen);

  const [preflightStatus, setPreflightStatus] = React.useState<string | null>(null);
  const [executionModalOutput, setExecutionModalOutput] = React.useState<string | null>(null);

  // Scheduled execution state
  const [scheduledTaskId, setScheduledTaskId] = useState<string | null>(null);
  const [isScheduledRunning, setIsScheduledRunning] = useState(false);

  // Check if graph has ScheduleNode
  const hasScheduleNode = (graph: Graph): boolean => {
    return graph.nodes.some(n => n.data.type === 'ScheduleNode');
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
        offlineMode: isOfflineMode,
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

    try {
      // 1. Scan graph for required models
      const requiredModels = new Set<string>();
      graph.nodes.forEach(n => {
        if (n.data.type === 'OllamaSelectorNode') {
          const m = n.data.model || 'llama3.2';
          if (!m.startsWith('API|')) {
            requiredModels.add(m);
          }
        }
      });

      // 2. Check installed models
      const status = await invoke<any>('cmd_check_ollama');
      if (status.state === 'Ready' || status.state === 'NoModels') {
        const installed = (status.models || []).map((m: any) => m.name);
        for (const m of requiredModels) {
          if (!installed.includes(m)) {
            // 3. Auto-pull missing model
            setPreflightStatus(`Pulling required model '${m}'...`);
            const unlisten = await listen<any>('pull-progress', (event) => {
              if (event.payload.model === m) {
                 if (event.payload.total && event.payload.completed) {
                   const percent = ((event.payload.completed / event.payload.total) * 100).toFixed(1);
                   setPreflightStatus(`Pulling '${m}': ${event.payload.status} (${percent}%)`);
                 } else {
                   setPreflightStatus(`Pulling '${m}': ${event.payload.status}`);
                 }
              }
            });
            try {
              await invoke('pull_model', { modelName: m });
            } finally {
              unlisten();
            }
          }
        }
      }

      setPreflightStatus(null);
      // 4. Run!
      const record = await invoke<ExecutionRecord>('run_graph', {
        graph,
        config: {
          continueOnFailure: false,
          defaultTimeoutSecs: 15,
          llmTimeoutSecs: 600,
        },
        offlineMode: isOfflineMode,
      });
      setExecutionRecord(record);

      let finalOutput = "No output generated.";

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
        
        if (rawStatus === 'success' && nr.output_preview) {
           finalOutput = nr.output_preview; // Capture the last successful node's output
        }
      });

      if (finalOutput && finalOutput !== "No output generated." && record.overall_status === 'success') {
         // Auto-save the output internally
         const activeTab = useWorkflowStore.getState().tabs.find(t => t.id === useWorkflowStore.getState().activeTabId);
         if (activeTab && activeTab.title) {
            try {
               await invoke('save_agent_output', { offlineMode: isOfflineMode,  name: activeTab.title, output: finalOutput });
            } catch (err) {
               console.warn("Could not auto-save output, tab name might be invalid:", err);
            }
         }
      }

      if (record.overall_status !== 'success') {
        setActivePanel('logs');
      } else {
        setExecutionModalOutput(finalOutput);
      }
    } catch (err: any) {
      console.error("Execution failed:", err);
      setActivePanel('logs');
    } finally {
      setIsExecuting(false);
      setPreflightStatus(null);
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

  return (
    <div
      style={{
        height: 48,
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        gap: 16,
        userSelect: 'none',
        zIndex: 20,
      }}
    >
      {isPreRunDialogOpen && ReactDOM.createPortal(
        <PreRunDialog 
          onConfirm={handleRunConfirm}
          onCancel={() => setPreRunDialogOpen(false)} 
        />,
        document.body
      )}

      {preflightStatus && ReactDOM.createPortal(
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{ background: 'var(--bg-panel)', padding: 24, borderRadius: 12, border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Loader2 className="spinning" size={24} color="var(--accent-cyan)" />
              <div style={{ fontSize: 16 }}>{preflightStatus}</div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {executionModalOutput !== null && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-panel)',
            width: 700,
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 12,
            border: '1px solid var(--border-medium)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-medium)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-secondary)'
            }}>
              <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 16 }}>Execution Completed</h3>
              <button 
                onClick={() => setExecutionModalOutput(null)}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: 20
                }}
              >×</button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto', flex: 1, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', fontSize: 14, fontFamily: 'monospace' }}>
              {executionModalOutput}
            </div>
            <div style={{ padding: 16, borderTop: '1px solid var(--border-medium)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-secondary)' }}>
              <button
                onClick={() => setExecutionModalOutput(null)}
                style={{
                  padding: '8px 16px',
                  background: 'var(--accent-cyan)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >Close</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Left: Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: '100%', paddingTop: 8, overflowX: 'auto', flex: 1 }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderTopLeftRadius: 8,
                  borderTopRightRadius: 8,
                  background: isActive ? 'var(--bg-secondary)' : 'transparent',
                  borderTop: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                  borderLeft: isActive ? '1px solid var(--border-medium)' : '1px solid transparent',
                  borderRight: isActive ? '1px solid var(--border-medium)' : '1px solid transparent',
                  cursor: 'pointer',
                  flexShrink: 0,
                  fontSize: 13,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.1s ease',
                  position: 'relative',
                  top: 1, // cover the bottom border
                }}
              >
                <span>
                  {tab.title}
                  {tab.isDirty ? <span style={{ color: 'var(--accent-cyan)' }}> *</span> : ''}
                </span>
                {tabs.length > 1 && (
                  <div
                    className="tab-close-btn"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      marginLeft: 4,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestCloseTab(tab.id);
                    }}
                  >
                    <X size={12} />
                  </div>
                )}
              </div>
            );
          })}
          <button
            onClick={() => createTab()}
            title="New Workflow Tab"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Center: Canvas Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => autoLayout('LR')} title="Organize Layout">
          <LayoutGrid size={14} />
          Auto Layout
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-secondary btn-icon" onClick={handleLoad} title="Open Workflow JSON">
          <FolderOpen size={16} />
        </button>
        <button className="btn btn-secondary btn-icon" onClick={handleSave} title="Save Workflow JSON">
          <Save size={16} />
        </button>
      </div>
    </div>
  );
};
