import React, { useEffect, useRef, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Loader2, Copy, Check, Terminal, SquareTerminal, Info, Square, Pause, PlayCircle } from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkflowStore } from '../store/workflowStore';

export const TerminalAgentPanel: React.FC = () => {
  const activeTabId = useWorkflowStore(s => s.activeTabId);
  const tabs = useWorkflowStore(s => s.tabs);
  const activeTab = tabs.find(t => t.id === activeTabId);
  const activeGraph = activeTab ? {
    version: 1,
    name: activeTab.title,
    nodes: activeTab.nodes.map(n => ({ id: n.id, position: n.position, data: n.data })),
    edges: activeTab.edges.map(e => ({ id: e.id, source: e.source, source_handle: e.sourceHandle || null, target: e.target, target_handle: e.targetHandle || null }))
  } : undefined;
  const running = useWorkflowStore(s => s.terminalRunning);
  const setRunning = useWorkflowStore(s => s.setTerminalRunning);
  const logs = useWorkflowStore(s => s.terminalLogs);
  const setLogs = useWorkflowStore(s => s.setTerminalLogs);
  const appendLog = useWorkflowStore(s => s.appendTerminalLog);
  const isOfflineMode = useSettingsStore(s => s.isOfflineMode);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const model = useSettingsStore(s => s.ollamaModel);
  const [isPaused, setIsPaused] = useState(false);
  const [terminalInput, setTerminalInput] = useState('');

  const handleStop = async () => {
    try {
      await invoke('cancel_manual_graph');
      appendLog(`\n[SYSTEM] Stopping execution...`);
      setRunning(false);
      setIsPaused(false);
    } catch (e: any) {
      appendLog(`\n[ERROR] Failed to stop: ${e}`);
    }
  };

  const handlePause = async () => {
    try {
      if (isPaused) {
        await invoke('resume_manual_graph');
        appendLog(`\n[SYSTEM] Resuming execution...`);
        setIsPaused(false);
      } else {
        await invoke('pause_manual_graph');
        appendLog(`\n[SYSTEM] Execution paused.`);
        setIsPaused(true);
      }
    } catch (e: any) {
      appendLog(`\n[ERROR] Failed to pause/resume: ${e}`);
    }
  };

  useEffect(() => {
    // Clear logs when mounting to avoid confusion from past runs
    if (!running) {
      setLogs([`> System initialized. Ready to execute active agent.`]);
    }

    const unlistenNode = listen<any>('node-progress', (e) => {
      const nr = e.payload;
      const statusText = nr.status === 'Running' ? '[EXECUTING]' : nr.status === 'Success' ? '[SUCCESS]' : '[FAILED]';
      const outputPreview = nr.output_preview || nr.error || '';
      appendLog(`[${new Date().toLocaleTimeString()}] ${statusText} Node ${nr.node_id}\n${outputPreview ? `\n${outputPreview}\n` : ''}`);
    });

    const unlistenGraph = listen<any>('graph-execution-progress', (e) => {
      appendLog(`[SYSTEM] ${e.payload.message}`);
    });

    return () => { 
      unlistenNode.then(f => f()); 
      unlistenGraph.then(f => f());
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleRunGraph = async () => {
    if ((!activeGraph || !activeGraph.nodes || activeGraph.nodes.length === 0)) {
      appendLog(`[ERROR] No active agent found on the canvas.`);
      return;
    }
    setRunning(true);
    setLogs([`> Executing Agent: ${activeGraph.name || 'Untitled Agent'}`, `> Model: ${model || 'default'}`, '---------------------------------------------------']);
    
    try {
      // Sanitize the graph to ensure all nodes have 'data' (ReactFlow can sometimes inject edge cases)
      const sanitizedGraph = {
        ...activeGraph,
        nodes: activeGraph.nodes.filter(n => n && n.data && n.data.type)
      };

      const record = await invoke<any>('run_graph', {
        graph: sanitizedGraph,
        config: {
          continueOnFailure: false,
          defaultTimeoutSecs: 15,
          llmTimeoutSecs: 600,
        },
        offlineMode: isOfflineMode,
      });
      appendLog(`\n[SYSTEM] Agent execution completed in ${record.duration_ms}ms.`);
    } catch (e: any) {
      appendLog(`\n[ERROR] Agent execution failed: ${e}`);
    } finally {
      setRunning(false);
    }
  };

  // Clean output for the right sidebar
  const cleanOutput = useMemo(() => {
    // Extract non-system lines and filter out file paths
    const lines = logs.filter(l => 
      !l.startsWith('[SYSTEM]') && 
      !l.startsWith('[EXECUTING]') && 
      !l.includes('Executing Agent:') &&
      !l.match(/^[a-zA-Z]:\\/) && 
      !l.startsWith('/')
    );
    return lines.join('\n').trim();
  }, [logs]);

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', height: '100%', width: '100%', background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>
      
      {/* Main Terminal Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e293b' }}>
        
        {/* Header */}
        <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1e293b', borderBottom: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SquareTerminal size={20} color="#38bdf8" />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#f8fafc', letterSpacing: 0.5 }}>Terminal Execution</h2>
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', display: 'flex', gap: 16, alignItems: 'center' }}>
            <span>Target Agent: <strong style={{ color: '#38bdf8' }}>{activeGraph?.name || 'None'}</strong></span>
            <span>Status: <strong style={{ color: running ? (isPaused ? '#f59e0b' : '#10b981') : '#64748b' }}>{running ? (isPaused ? 'Paused' : 'Running') : 'Standby'}</strong></span>
            
            {running && (
              <div style={{ display: 'flex', gap: 8, marginLeft: 16 }}>
                <button
                  onClick={handlePause}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px',
                    background: isPaused ? '#10b981' : '#f59e0b',
                    border: 'none',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {isPaused ? <PlayCircle size={14} /> : <Pause size={14} />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  onClick={handleStop}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px',
                    background: '#ef4444',
                    border: 'none',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Square size={14} fill="currentColor" />
                  Stop
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Terminal Logs */}
        <div 
          ref={scrollRef}
          style={{ 
            flex: 1, 
            padding: '24px', 
            overflowY: 'auto',
            fontFamily: '"Fira Code", "Cascadia Code", monospace',
            fontSize: 13,
            lineHeight: 1.6,
            color: '#cbd5e1'
          }}
        >
          {logs.map((log, i) => (
            <div key={i} style={{ 
              marginBottom: 8, 
              color: log.includes('[ERROR]') ? '#ef4444' 
                   : log.includes('[SUCCESS]') ? '#10b981'
                   : log.includes('[SYSTEM]') ? '#94a3b8'
                   : '#e2e8f0',
              whiteSpace: 'pre-wrap'
            }}>
              {log}
            </div>
          ))}
          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8', marginTop: 16, animation: 'pulse 2s infinite' }}>
              <Loader2 size={14} className="animate-spin" />
              Agent is processing...
            </div>
          )}
        </div>

        {/* Input/Control Area */}
        <div style={{ padding: '20px 24px', background: '#1e293b', borderTop: '1px solid #334155' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              id="terminal-run-btn"
              onClick={handleRunGraph}
              disabled={running || (!activeGraph || !activeGraph.nodes || activeGraph.nodes.length === 0)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 24px',
                background: running || (!activeGraph || !activeGraph.nodes || activeGraph.nodes.length === 0) ? '#334155' : '#0284c7',
                color: running || (!activeGraph || !activeGraph.nodes || activeGraph.nodes.length === 0) ? '#94a3b8' : 'white',
                border: 'none',
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 600,
                cursor: running || (!activeGraph || !activeGraph.nodes || activeGraph.nodes.length === 0) ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
                flexShrink: 0
              }}
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {running ? 'Executing Agent...' : 'Execute Agent in Terminal'}
            </button>
            
            {running && (
              <form 
                style={{ flex: 1, display: 'flex', gap: 8 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!terminalInput.trim()) return;
                  appendLog(`\n> ${terminalInput}`);
                  try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    await invoke('send_manual_input', { input: terminalInput });
                  } catch (err) {
                    appendLog(`\n[ERROR] Failed to send input: ${err}`);
                  }
                  setTerminalInput('');
                }}
              >
                <input
                  type="text"
                  placeholder="Type a message to the agent..."
                  value={terminalInput}
                  onChange={e => setTerminalInput(e.target.value)}
                  style={{
                    flex: 1,
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: 4,
                    padding: '10px 16px',
                    color: '#fff',
                    fontFamily: '"Fira Code", monospace',
                    fontSize: 13,
                    outline: 'none'
                  }}
                  autoFocus
                />
                <button 
                  type="submit"
                  style={{
                    background: '#38bdf8',
                    color: '#0f172a',
                    border: 'none',
                    borderRadius: 4,
                    padding: '0 16px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Send
                </button>
              </form>
            )}

            {(!activeGraph || !activeGraph.nodes || activeGraph.nodes.length === 0) && (
               <div style={{ display: 'flex', alignItems: 'center', color: '#ef4444', fontSize: 13 }}>
                  No agent is currently loaded. Go to the canvas or library to load an agent.
               </div>
            )}
            
            {(activeGraph && activeGraph.nodes && activeGraph.nodes.length > 0) && !running && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginLeft: 12 }}>
                <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 4 }}>Agent Actions:</span>
                {Array.from(new Set(activeGraph.nodes.map(n => n.data?.label || n.type))).slice(0, 5).map((actionName: any, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      appendLog(`\n> Triggering action: ${actionName}...`);
                    }}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #38bdf8',
                      color: '#38bdf8',
                      padding: '4px 12px',
                      borderRadius: 16,
                      fontSize: 12,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'}
                    onMouseOut={e => e.currentTarget.style.background = '#1e293b'}
                  >
                    {actionName}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Sidebar - Clean Output */}
      <div style={{ width: 400, display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc', fontWeight: 600, fontSize: 13 }}>
            <Terminal size={16} color="#10b981" />
            FINAL AGENT OUTPUT
          </div>
          <button
            onClick={handleCopy}
            disabled={!cleanOutput.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid #334155',
              borderRadius: 4,
              color: '#94a3b8',
              fontSize: 12,
              cursor: !cleanOutput.trim() ? 'not-allowed' : 'pointer'
            }}
          >
            {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        
        <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
          {cleanOutput.trim() ? (
            <div style={{ 
              fontFamily: '"Fira Code", "Cascadia Code", monospace', 
              fontSize: 13, 
              color: '#f8fafc',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6
            }}>
              {cleanOutput}
            </div>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#475569', gap: 12, textAlign: 'center' }}>
              <Info size={32} />
              <div style={{ fontSize: 13, maxWidth: 200 }}>
                The agent's outputs will appear here dynamically as nodes succeed.
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
