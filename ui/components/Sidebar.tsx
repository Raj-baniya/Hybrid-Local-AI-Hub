import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save, open } from '@tauri-apps/plugin-dialog';
import { tempDir, join } from '@tauri-apps/api/path';
import { Network, Sparkles, Terminal, LifeBuoy, Settings, TerminalSquare, Play, Square, Pause, FolderOpen, Save, Loader2, MonitorPlay, Bot, PlayCircle } from 'lucide-react';
import { useWorkflowStore, ExecutionRecord, Graph } from '../store/workflowStore';
import { useSettingsStore } from '../store/settingsStore';
import { PreRunDialog } from './PreRunDialog';

export const Sidebar: React.FC = () => {
  const { activePanel, setActivePanel } = useWorkflowStore();
  const setSettingsModalOpen = useSettingsStore((s) => s.setSettingsModalOpen);

  const tabs = useWorkflowStore((s) => s.tabs);
  const activeTabId = useWorkflowStore((s) => s.activeTabId);
  const setTabFilePath = useWorkflowStore((s) => s.setTabFilePath);
  const isOfflineMode = useSettingsStore((s) => s.isOfflineMode);
  const getActiveGraph = useWorkflowStore((s) => s.getActiveGraph);
  const loadGraphIntoActiveTab = useWorkflowStore((s) => s.loadGraphIntoActiveTab);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const setIsExecuting = useWorkflowStore((s) => s.setIsExecuting);
  const setNodeStatus = useWorkflowStore((s) => s.setNodeStatus);
  const clearNodeStatuses = useWorkflowStore((s) => s.clearNodeStatuses);
  const setExecutionRecord = useWorkflowStore((s) => s.setExecutionRecord);
  const isPreRunDialogOpen = useWorkflowStore((s) => s.isPreRunDialogOpen);
  const setPreRunDialogOpen = useWorkflowStore((s) => s.setPreRunDialogOpen);
  const showOutputPanel = useWorkflowStore((s) => s.showOutputPanel);
  const setShowOutputPanel = useWorkflowStore((s) => s.setShowOutputPanel);

  const [preflightStatus, setPreflightStatus] = useState<string | null>(null);
  const [scheduledTaskId, setScheduledTaskId] = useState<string | null>(null);
  const [isScheduledRunning, setIsScheduledRunning] = useState(false);
  const [isScheduledPaused, setIsScheduledPaused] = useState(false);
  const [nextRunLabel, setNextRunLabel] = useState<string | null>(null);

  const togglePanel = (panel: 'nodes' | 'chat' | 'logs' | 'models' | 'inspector' | 'agents' | 'help' | 'terminalAgent') => {
    setActivePanel(activePanel === panel ? 'none' : panel);
  };

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
    const namedGraph = { ...graph, name: graph.name || activeTab?.title || 'scheduled-agent' };
    const taskId = `scheduled-${Date.now()}`;
    setIsScheduledRunning(true);
    setIsScheduledPaused(false);
    setScheduledTaskId(taskId);
    clearNodeStatuses();
    try {
      await invoke('run_graph_scheduled', {
        taskId, graph: namedGraph, config: { continueOnFailure: false, defaultTimeoutSecs: 15, llmTimeoutSecs: 600 }, offlineMode: isOfflineMode,
      });
    } catch (err: any) {
      alert(`Failed to start automation:\n${typeof err === 'string' ? err : err.message}`);
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
    } catch (err: any) { alert(`Failed to stop automation:\n${typeof err === 'string' ? err : err.message}`); }
  };

  const handlePauseScheduled = async () => {
    if (!scheduledTaskId) return;
    try {
      await invoke('pause_scheduled_graph', { taskId: scheduledTaskId });
      setIsScheduledPaused(true);
    } catch (err: any) { alert(`Failed to pause automation:\n${typeof err === 'string' ? err : err.message}`); }
  };

  const handleResumeScheduled = async () => {
    if (!scheduledTaskId) return;
    try {
      await invoke('resume_scheduled_graph', { taskId: scheduledTaskId });
      setIsScheduledPaused(false);
    } catch (err: any) { alert(`Failed to resume automation:\n${typeof err === 'string' ? err : err.message}`); }
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
        status: uiStatus, durationMs: nr.duration_ms ?? undefined, outputPreview: nr.output_preview ?? undefined, error: nr.error ?? undefined,
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setNodeStatus]);

  const currentScheduledTaskId = useRef(scheduledTaskId);
  useEffect(() => { currentScheduledTaskId.current = scheduledTaskId; }, [scheduledTaskId]);

  useEffect(() => {
    const unlistenStarted = listen('scheduled-task-started', (event) => {
      setIsScheduledRunning(true);
      setScheduledTaskId(event.payload as string);
      setShowOutputPanel(true);
    });
    const unlistenExecution = listen<any>('scheduled-task-execution', (event) => {
      if (event.payload?.record) applyRecordToCanvas(event.payload.record);
    });
    const unlistenError = listen<any>('scheduled-task-error', (event) => {
      console.error('Scheduled task error:', event.payload?.error);
      alert(`Automation error:\n${event.payload?.error || 'Scheduled task error'}`);
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
      if (event.payload === currentScheduledTaskId.current) {
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
  }, [setExecutionRecord, setNodeStatus]);

  const handleRunRequest = () => {
    const graph = getActiveGraph();
    if (graph.nodes.length === 0) { alert('Graph is empty. Add nodes before running.'); return; }
    setPreRunDialogOpen(true);
  };

  const handleRunConfirm = async () => {
    setPreRunDialogOpen(false);
    const graph = getActiveGraph();
    setIsExecuting(true);
    clearNodeStatuses();
    try {
      const requiredModels = new Set<string>();
      graph.nodes.forEach(n => {
        if (n.data.type === 'OllamaSelectorNode') {
          const m = n.data.model || 'llama3.2';
          if (!m.startsWith('API|')) requiredModels.add(m);
        }
      });
      const status = await invoke<any>('cmd_check_ollama');
      if (status.state === 'Ready' || status.state === 'NoModels') {
        const installed = (status.models || []).map((m: any) => m.name);
        for (const m of requiredModels) {
          if (!installed.includes(m)) {
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
            try { await invoke('pull_model', { modelName: m }); } finally { unlisten(); }
          }
        }
      }
      setPreflightStatus(null);
      setShowOutputPanel(true);
      const record = await invoke<ExecutionRecord>('run_graph', {
        graph, config: { continueOnFailure: false, defaultTimeoutSecs: 15, llmTimeoutSecs: 600 }, offlineMode: isOfflineMode,
      });
      setExecutionRecord(record);
      record.nodes.forEach((nr) => {
        const rawStatus = (nr.status ?? '').toLowerCase();
        setNodeStatus(nr.node_id, {
          status: rawStatus === 'success' ? 'success' : rawStatus === 'failed' ? 'failed' : rawStatus === 'skipped' ? 'skipped' : 'idle',
          durationMs: nr.duration_ms, outputPreview: nr.output_preview, error: nr.error,
        });
      });
      if (record.overall_status !== 'success') setActivePanel('logs');
      else setShowOutputPanel(true);
    } catch (err: any) {
      console.error("Execution failed:", err);
      alert(`Execution failed:\n${typeof err === 'string' ? err : err.message}`);
      setActivePanel('logs');
    } finally {
      setIsExecuting(false);
      setPreflightStatus(null);
    }
  };

  const handleStopManual = async () => {
    try { await invoke('cancel_manual_graph'); } catch (err: any) { console.error("Failed to cancel manual graph", err); }
  };

  const handleSave = async () => {
    const graph = getActiveGraph();
    try {
      const selected = await save({ filters: [{ name: 'Workflow JSON', extensions: ['json'] }], defaultPath: 'workflow.json' });
      if (selected) {
        const name = selected.split(/[\\/]/).pop()?.replace('.json', '') || 'agent';
        await invoke('save_workflow', { path: selected, graph });
        await invoke('save_agent', { offlineMode: useSettingsStore.getState().isOfflineMode, name, graph });
        setTabFilePath(activeTabId, selected);
      }
    } catch (err: any) { alert(`Failed to save workflow: ${err}`); }
  };

  const handleLoad = async () => {
    try {
      const selected = await open({ multiple: false, filters: [{ name: 'Workflow JSON', extensions: ['json'] }] });
      if (selected && typeof selected === 'string') {
        const loadedGraph = await invoke<Graph>('load_workflow', { path: selected });
        const filename = selected.split(/[\\/]/).pop() || 'Loaded';
        loadGraphIntoActiveTab(loadedGraph, filename, selected);
      }
    } catch (err: any) { alert(`Failed to load workflow: ${err}`); }
  };

  

  const navItems = [
    { id: 'nodes', icon: Network, title: 'Node palette' },
    { id: 'chat', icon: Sparkles, title: 'Chat AI' },
    { id: 'agents', icon: Bot, title: 'Saved agents' },
    { id: 'terminalAgent', icon: TerminalSquare, title: 'Terminal agent' },
    { id: 'logs', icon: Terminal, title: 'Execution logs' },
    { id: 'help', icon: LifeBuoy, title: 'Help agent' },
  ] as const;

  return (
    <div
      style={{
        width: 56,
        height: '100%',
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--neo-border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 0',
        gap: 16,
        zIndex: 20,
      }}
    >
      {isPreRunDialogOpen && createPortal(
        <PreRunDialog onConfirm={handleRunConfirm} onCancel={() => setPreRunDialogOpen(false)} />,
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

      {navItems.map((item) => {
        const isActive = activePanel === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={`btn btn-icon ${isActive ? 'active-sidebar-item' : ''}`}
            onClick={() => togglePanel(item.id)}
            title={item.title}
            style={{
              width: 40,
              height: 40,
              padding: 0,
              justifyContent: 'center',
              borderRadius: 12,
              background: isActive ? 'var(--bg-tertiary)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              border: isActive ? '1px solid var(--neo-border)' : '1px solid transparent',
              transition: 'all 0.2s ease',
            }}
          >
            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
          </button>
        );
      })}

      <div style={{ width: '32px', height: '1px', background: 'var(--neo-border)', margin: '4px 0' }} />
      {/* Execution Actions */}
      {(() => {
        const graph = getActiveGraph();
        const hasSchedule = hasScheduleNode(graph);

        if (isScheduledRunning) {
          return (
            <>
              {isScheduledPaused ? (
                <button className="btn btn-icon" onClick={handleResumeScheduled} title="Resume automation"
                  style={{ width: 40, height: 40, padding: 0, justifyContent: 'center', borderRadius: 12, color: '#10b981', background: 'rgba(16, 185, 129, 0.1)' }}>
                  <PlayCircle size={20} />
                </button>
              ) : (
                <button className="btn btn-icon" onClick={handlePauseScheduled} title="Pause automation"
                  style={{ width: 40, height: 40, padding: 0, justifyContent: 'center', borderRadius: 12, color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)' }}>
                  <Pause size={20} />
                </button>
              )}
              <button className="btn btn-icon" onClick={handleStopScheduled} title="Stop automation"
                style={{ width: 40, height: 40, padding: 0, justifyContent: 'center', borderRadius: 12, color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)' }}>
                <Square size={20} />
              </button>
            </>
          );
        }

        if (hasSchedule && !isScheduledRunning) {
          return (
            <button className="btn btn-icon" onClick={handleStartScheduled} disabled={isExecuting} title="Start continuous automation"
              style={{ width: 40, height: 40, padding: 0, justifyContent: 'center', borderRadius: 12, color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)' }}>
              <PlayCircle size={20} />
            </button>
          );
        }

        return isExecuting ? (
          <button className="btn btn-icon" onClick={handleStopManual} title="Stop manual execution"
            style={{ width: 40, height: 40, padding: 0, justifyContent: 'center', borderRadius: 12, color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)' }}>
            <Square size={20} fill="currentColor" />
          </button>
        ) : (
          <button className="btn btn-icon" onClick={handleRunRequest} title="Start Automation"
            style={{ width: 40, height: 40, padding: 0, justifyContent: 'center', borderRadius: 12, color: 'var(--accent-emerald)', background: 'rgba(16, 185, 129, 0.1)' }}>
            <Play size={20} />
          </button>
        );
      })()}

      <button className="btn btn-icon" onClick={() => setShowOutputPanel(!showOutputPanel)} title="Toggle Output Panel"
        style={{ width: 40, height: 40, padding: 0, justifyContent: 'center', borderRadius: 12, color: showOutputPanel ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
        <MonitorPlay size={20} />
      </button>

      <div style={{ width: '32px', height: '1px', background: 'var(--neo-border)', margin: '4px 0' }} />

      <button className="btn btn-icon" onClick={handleLoad} title="Open Workflow JSON"
        style={{ width: 40, height: 40, padding: 0, justifyContent: 'center', borderRadius: 12, color: 'var(--text-muted)' }}>
        <FolderOpen size={20} />
      </button>
      <button className="btn btn-icon" onClick={handleSave} title="Save Workflow JSON"
        style={{ width: 40, height: 40, padding: 0, justifyContent: 'center', borderRadius: 12, color: 'var(--text-muted)' }}>
        <Save size={20} />
      </button>

      <div style={{ flex: 1 }} />

      <button
        className="btn btn-icon"
        title="Settings"
        onClick={() => setSettingsModalOpen(true)}
        style={{
          width: 40,
          height: 40,
          padding: 0,
          justifyContent: 'center',
          borderRadius: 12,
          background: 'transparent',
          color: 'var(--text-muted)',
          border: '1px solid transparent',
          transition: 'all 0.2s ease',
        }}
      >
        <Settings size={20} />
      </button>
    </div>
  );
};

