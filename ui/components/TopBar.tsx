import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Pause,
  PlayCircle,
  Terminal,
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
  const showOutputPanel = useWorkflowStore((s) => s.showOutputPanel);
  const setShowOutputPanel = useWorkflowStore((s) => s.setShowOutputPanel);

  const [preflightStatus, setPreflightStatus] = React.useState<string | null>(null);


  const [scheduledTaskId, setScheduledTaskId] = useState<string | null>(null);
  const [isScheduledRunning, setIsScheduledRunning] = useState(false);
  const [isScheduledPaused, setIsScheduledPaused] = useState(false);
  const [nextRunLabel, setNextRunLabel] = useState<string | null>(null);

  const hasScheduleNode = (graph: Graph): boolean => {
    return graph.nodes.some(n => n.data?.type === 'ScheduleNode');
  };

  const applyRecordToCanvas = (record: ExecutionRecord) => {
    setExecutionRecord(record);
    record.nodes?.forEach((nr) => {
      const rawStatus = (nr.status ?? '').toLowerCase();
      setNodeStatus(nr.node_id, {
        status: rawStatus === 'success' ? 'success'
          : rawStatus === 'failed' ? 'failed'
          : rawStatus === 'skipped' ? 'skipped'
          : rawStatus === 'running' ? 'running'
          : 'idle',
        durationMs: nr.duration_ms,
        outputPreview: nr.output_preview,
        error: nr.error,
      });
    });
  };

  const handleStartScheduled = async () => {
    const graph = getActiveGraph();
    if (!hasScheduleNode(graph)) {
      alert('Graph must contain a ScheduleNode for automated execution.');
      return;
    }

    const activeTab = tabs.find(t => t.id === activeTabId);
    const namedGraph = {
      ...graph,
      name: graph.name || activeTab?.title || 'scheduled-agent',
    };

    const taskId = `scheduled-${Date.now()}`;
    setIsScheduledRunning(true);
    setIsScheduledPaused(false);
    setScheduledTaskId(taskId);
    clearNodeStatuses();

    try {
      await invoke('run_graph_scheduled', {
        taskId,
        graph: namedGraph,
        config: {
          continueOnFailure: false,
          defaultTimeoutSecs: 15,
          llmTimeoutSecs: 600,
        },
        offlineMode: isOfflineMode,
      });
    } catch (err: any) {
      const errorMsg = typeof err === 'string' ? err : err.message;
      alert(`Failed to start automation:\n${errorMsg}`);
      setIsScheduledRunning(false);
      setIsScheduledPaused(false);
      setScheduledTaskId(null);
      setNextRunLabel(null);
    }
  };

  const handleStopScheduled = async () => {
    if (!scheduledTaskId) return;
    try {
      await invoke('stop_scheduled_graph', { taskId: scheduledTaskId });
      setIsScheduledRunning(false);
      setIsScheduledPaused(false);
      setScheduledTaskId(null);
      setNextRunLabel(null);
    } catch (err: any) {
      const errorMsg = typeof err === 'string' ? err : err.message;
      alert(`Failed to stop automation:\n${errorMsg}`);
    }
  };

  const handlePauseScheduled = async () => {
    if (!scheduledTaskId) return;
    try {
      await invoke('pause_scheduled_graph', { taskId: scheduledTaskId });
      setIsScheduledPaused(true);
    } catch (err: any) {
      const errorMsg = typeof err === 'string' ? err : err.message;
      alert(`Failed to pause automation:\n${errorMsg}`);
    }
  };

  const handleResumeScheduled = async () => {
    if (!scheduledTaskId) return;
    try {
      await invoke('resume_scheduled_graph', { taskId: scheduledTaskId });
      setIsScheduledPaused(false);
    } catch (err: any) {
      const errorMsg = typeof err === 'string' ? err : err.message;
      alert(`Failed to resume automation:\n${errorMsg}`);
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
      setShowOutputPanel(true);
    });

    const unlistenExecution = listen<any>('scheduled-task-execution', (event) => {
      const payload = event.payload;
      if (payload?.record) applyRecordToCanvas(payload.record);
    });

    const unlistenError = listen<any>('scheduled-task-error', (event) => {
      const errorMsg = event.payload?.error || 'Scheduled task error';
      console.error('Scheduled task error:', errorMsg);
      alert(`Automation error:\n${errorMsg}`);
    });

    const unlistenNext = listen<any>('scheduled-task-next-run', (event) => {
      const secs = Number(event.payload?.in ?? 0);
      if (secs > 0) {
        const mins = Math.floor(secs / 60);
        const rem = Math.round(secs % 60);
        setNextRunLabel(mins > 0 ? `Next run in ${mins}m ${rem}s` : `Next run in ${rem}s`);
      }
    });

    const unlistenStopped = listen('scheduled-task-stopped', (event) => {
      if (event.payload === scheduledTaskId) {
        setIsScheduledRunning(false);
        setIsScheduledPaused(false);
        setScheduledTaskId(null);
        setNextRunLabel(null);
      }
    });

    return () => {
      unlistenStarted.then((fn) => fn());
      unlistenExecution.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenNext.then((fn) => fn());
      unlistenStopped.then((fn) => fn());
    };
  }, [scheduledTaskId, setExecutionRecord, setNodeStatus]);

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
      setShowOutputPanel(true);
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
console.log(finalOutput);

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

      if (record.overall_status !== 'success') {
        setActivePanel('logs');
      } else {
        setShowOutputPanel(true);
      }
    } catch (err: any) {
      console.error("Execution failed:", err);
      setActivePanel('logs');
    } finally {
      setIsExecuting(false);
      setPreflightStatus(null);
    }
  };

  const handleStopManual = async () => {
    try {
      await invoke('cancel_manual_graph');
    } catch (err: any) {
      console.error("Failed to cancel manual graph", err);
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
      {isPreRunDialogOpen && createPortal(
        <PreRunDialog 
          onConfirm={handleRunConfirm}
          onCancel={() => setPreRunDialogOpen(false)} 
        />,
        document.body
      )}

      {preflightStatus && createPortal(
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
        <button
          className="btn btn-secondary btn-icon"
          onClick={() => setShowOutputPanel(!showOutputPanel)}
          title={showOutputPanel ? "Hide Output Panel" : "Show Output Panel"}
        >
          <Terminal size={14} color={showOutputPanel ? "var(--accent-cyan)" : "currentColor"} />
        </button>

        <button className="btn btn-secondary" onClick={() => autoLayout('LR')} title="Organize Layout">
          <LayoutGrid size={14} />
          Auto Layout
        </button>

        {(() => {
          const graph = getActiveGraph();
          const hasSchedule = hasScheduleNode(graph);

          if (isScheduledRunning) {
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {nextRunLabel && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {isScheduledPaused ? 'Paused' : nextRunLabel}
                  </span>
                )}
                {isScheduledPaused ? (
                  <button
                    className="btn"
                    onClick={handleResumeScheduled}
                    style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                    title="Resume automation"
                  >
                    <PlayCircle size={14} />
                    Resume
                  </button>
                ) : (
                  <button
                    className="btn"
                    onClick={handlePauseScheduled}
                    style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                    title="Pause automation"
                  >
                    <Pause size={14} />
                    Pause
                  </button>
                )}
                <button
                  className="btn"
                  onClick={handleStopScheduled}
                  style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}
                  title="Stop automation"
                >
                  <Square size={14} />
                  Stop
                </button>
              </div>
            );
          }

          if (hasSchedule && !isScheduledRunning) {
            return (
              <button
                className="btn"
                onClick={handleStartScheduled}
                disabled={isExecuting}
                style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                title="Start continuous automation on the Schedule node's cron"
              >
                <PlayCircle size={14} />
                Start Automation
              </button>
            );
          }

          return isExecuting ? (
            <button
              className="btn"
              onClick={handleStopManual}
              style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color: 'white' }}
              title="Stop manual execution"
            >
              <Square size={14} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleRunRequest}
              style={{ background: 'linear-gradient(135deg, var(--accent-emerald) 0%, #10b981 100%)' }}
            >
              <Play size={14} />
              Run Pipeline
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
