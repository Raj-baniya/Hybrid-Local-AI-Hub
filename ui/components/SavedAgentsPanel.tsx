import { useSettingsStore } from '../store/settingsStore';
import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkflowStore } from '../store/workflowStore';
import type { Graph } from '../schema/graphSchema';
import { Bot, X, Download, Play, RefreshCw, Loader2, Edit3, Terminal, Copy, Trash2, Clock, Rocket } from 'lucide-react';

export const SavedAgentsPanel: React.FC = () => {
  const isOfflineMode = useSettingsStore(s => s.isOfflineMode);

  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);
  const createTab = useWorkflowStore((s) => s.createTab);

  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [renamingAgent, setRenamingAgent] = useState<{oldName: string, newName: string} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingOutput, setViewingOutput] = useState<{name: string, text: string, isPlaceholder?: boolean} | null>(null);
  const [cliCommand, setCliCommand] = useState<{name: string, command: string} | null>(null);
  const [scheduleDialog, setScheduleDialog] = useState<{name: string} | null>(null);
  const [schedTime, setSchedTime] = useState('21:00');
  const [automationMsg, setAutomationMsg] = useState<{name: string, msg: string} | null>(null);
  const { agentTriggers, setAgentTrigger } = useSettingsStore();

  const fetchAgents = async (currentMode: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<string[]>('list_agents', { offlineMode: currentMode });
      if (currentMode === useSettingsStore.getState().isOfflineMode) {
        setAgents(list);
      }
    } catch (err: any) {
      if (currentMode === useSettingsStore.getState().isOfflineMode) {
        setError(typeof err === 'string' ? err : err.message || 'Failed to list agents');
      }
    } finally {
      if (currentMode === useSettingsStore.getState().isOfflineMode) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchAgents(isOfflineMode);
  }, [isOfflineMode]);

  const handleOpenInCanvas = async (name: string) => {
    try {
      const graph = await invoke<Graph>('load_agent', { offlineMode: useSettingsStore.getState().isOfflineMode,  name });
      createTab(name, graph);
      setActivePanel('none');
    } catch (err: any) {
      setError(`Failed to open agent: ${err}`);
      throw err;
    }
  };

  const handleRemoveStartup = async (name: string) => {
    try {
      const msg = await invoke<string>('remove_startup_agent', { agentName: name });
      setAutomationMsg({ name, msg: `✅ ${msg}` });
    } catch (e) {
      setAutomationMsg({ name, msg: `❌ ${String(e)}` });
    }
    setTimeout(() => setAutomationMsg(null), 4000);
  };

  const handleRemoveSchedule = async (name: string) => {
    try {
      const msg = await invoke<string>('remove_scheduled_agent', { agentName: name });
      setAutomationMsg({ name, msg: `✅ ${msg}` });
    } catch (e) {
      setAutomationMsg({ name, msg: `❌ ${String(e)}` });
    }
    setTimeout(() => setAutomationMsg(null), 4000);
  };

  const handleRegisterStartup = async (name: string) => {
    try {
      const msg = await invoke<string>('register_startup_agent', { agentName: name });
      setAutomationMsg({ name, msg: `✅ ${msg}` });
    } catch (e) {
      setAutomationMsg({ name, msg: `❌ ${String(e)}` });
    }
    setTimeout(() => setAutomationMsg(null), 4000);
  };

  const handleRegisterSchedule = async (name: string) => {
    try {
      const msg = await invoke<string>('register_scheduled_agent', { agentName: name, time: schedTime });
      setAutomationMsg({ name, msg: `✅ ${msg}` });
      setScheduleDialog(null);
    } catch (e) {
      setAutomationMsg({ name, msg: `❌ ${String(e)}` });
    }
    setTimeout(() => setAutomationMsg(null), 4000);
  };

  const handleRunAgent = async (name: string) => {
    try {
      await handleOpenInCanvas(name);
      useWorkflowStore.getState().setPreRunDialogOpen(true);
    } catch (err: any) {
      // Error already set by handleOpenInCanvas
    }
  };

  const handleViewOutput = async (name: string) => {
    try {
      setLoading(true);
      const output = await invoke<string>('get_agent_output', { offlineMode: useSettingsStore.getState().isOfflineMode,  name });
      setViewingOutput({ name, text: output });
    } catch (err: any) {
      const errStr = typeof err === 'string' ? err : err.message || '';
      if (errStr.includes("No saved output found")) {
        setViewingOutput({ name, text: "Execute to get output", isPlaceholder: true });
      } else {
        setError(`Failed to load output: ${errStr}`);
      }
    } finally {
      setLoading(false);
    }
  };

  
  const isValidHotkey = (key: string) => {
    if (!key || key.trim() === '') return true;
    const parts = key.toLowerCase().split('+');
    if (parts.length < 2) return false;
    const modifiers = ['ctrl', 'alt', 'shift', 'meta', 'win', 'cmd'];
    return parts.some(p => modifiers.includes(p.trim()));
  };
  const isValidWakeWord = (word: string) => {
    if (!word || word.trim() === '') return true;
    return word.trim().length >= 3;
  };

  const handleRenameAgent = async (oldName: string) => {
    const newName = window.prompt(`Rename agent '${oldName}' to:`, oldName);
    if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
    
    setLoading(true);
    try {
      await invoke('rename_agent', { offlineMode: useSettingsStore.getState().isOfflineMode,  oldName, newName: newName.trim() });
      await fetchAgents(useSettingsStore.getState().isOfflineMode);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to rename agent');
      setLoading(false);
    }
  };

  const handleDeleteAgent = async (name: string) => {
    if (!window.confirm(`Are you sure you want to delete '${name}'? This cannot be undone.`)) return;
    
    setLoading(true);
    try {
      await invoke('delete_agent', { offlineMode: useSettingsStore.getState().isOfflineMode,  name });
      await fetchAgents(useSettingsStore.getState().isOfflineMode);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to delete agent');
      setLoading(false);
    }
  };

  const handleShowCliCommand = async (name: string) => {
    try {
      const path = await invoke('get_agent_path', { offlineMode: useSettingsStore.getState().isOfflineMode,  name });
      const command = await invoke<string>('get_cli_command', { agentPath: path });
      setCliCommand({ name, command });
    } catch (err: any) {
      setError("Failed to get CLI path");
    }
  };

  const handleDownloadOutput = async () => {
    if (!viewingOutput || viewingOutput.isPlaceholder) return;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const outputPath = await save({
        title: `Save output for ${viewingOutput.name}`,
        filters: [{ name: 'Text File', extensions: ['txt', 'md'] }],
        defaultPath: `${viewingOutput.name}_output.txt`,
      });
      if (outputPath) {
        await invoke('save_text_file', { path: outputPath, text: viewingOutput.text });
      }
    } catch (err: any) {
      alert(typeof err === 'string' ? err : "Failed to download output: " + err.message);
    }
  };

  if (viewingOutput) {
    return (
      <div className="animate-slide-in-right" style={{ width: '100%', height: '100%', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--neo-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={18} color="var(--accent-cyan)" />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Output: {viewingOutput.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button 
              onClick={handleDownloadOutput} 
              style={{ background: 'transparent', border: 'none', color: viewingOutput.isPlaceholder ? 'var(--text-disabled)' : 'var(--text-muted)', cursor: viewingOutput.isPlaceholder ? 'not-allowed' : 'pointer' }} 
              title="Download Output"
              disabled={viewingOutput.isPlaceholder}
            >
              <Download size={16} />
            </button>
            <button onClick={() => setViewingOutput(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, background: 'var(--bg-body)' }}>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>
            {viewingOutput.text}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div
      className="animate-slide-in-right"
      style={{
        width: '100%',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 18px', marginTop: 16 }}>
        <button className="btn btn-secondary" onClick={() => fetchAgents(isOfflineMode)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          Refresh Agents
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ background: 'rgba(244, 63, 94, 0.1)', color: '#fb7185', padding: 12, borderRadius: 8, fontSize: 12 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
            <Loader2 size={20} className="spinning" color="var(--text-muted)" />
          </div>
        ) : agents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
            No agents saved yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 24 }}>
            {agents.map((agent) => (
              <div 
                key={agent} 
                className="group"
                style={{ 
                  background: 'var(--bg-card)', 
                  border: '1px solid var(--neo-border)', 
                  borderRadius: 16, 
                  padding: 20, 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 16, 
                  boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  overflow: 'hidden'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.1)';
                  e.currentTarget.style.border = '1px solid var(--border-medium)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
                  e.currentTarget.style.border = '1px solid var(--neo-border)';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ padding: 10, background: 'rgba(6, 182, 212, 0.15)', borderRadius: 12, color: 'var(--accent-cyan)' }}>
                      <Bot size={20} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: 1.3 }}>
                      {agent}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '8px 0', fontSize: 13 }} onClick={() => handleRunAgent(agent)}>
                    <Play size={14} /> Run
                  </button>
                  <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center', padding: '8px 0', fontSize: 13 }} onClick={() => handleOpenInCanvas(agent)}>
                    <Edit3 size={14} /> Edit
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1, justifyContent: 'center', fontSize: 12, padding: '5px 0', gap: 4 }}
                    title="Schedule this agent to run daily at a set time"
                    onClick={() => { setScheduleDialog({ name: agent }); setSchedTime('21:00'); }}
                  >
                    <Clock size={12} /> Schedule
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1, justifyContent: 'center', fontSize: 12, padding: '5px 0', gap: 4 }}
                    title="Run this agent every time Windows starts"
                    onClick={() => handleRegisterStartup(agent)}
                  >
                    <Rocket size={12} /> Startup
                  </button>
                </div>
                {automationMsg?.name === agent && (
                  <div style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, marginTop: 2,
                    background: automationMsg.msg.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
                    color: automationMsg.msg.startsWith('✅') ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                    {automationMsg.msg}
                  </div>
                )}

                
                {/* Per-Agent Triggers */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 60 }}>Wake:</span>
                    <input
                      type="text"
                      id={`wake-${agent}`}
                      placeholder="e.g. Hey Jarvis"
                      defaultValue={agentTriggers[agent]?.wakeWord || ''}
                      style={{ flex: 1, background: 'transparent', border: '1px solid var(--neo-border)', borderBottom: '1px solid var(--accent-cyan)', fontSize: 12, color: 'var(--text-primary)', padding: '4px 6px', outline: 'none' }}
                    />
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11, minWidth: 40 }} onClick={() => {
                      const val = (document.getElementById(`wake-${agent}`) as HTMLInputElement).value.trim();
                      if (val && val.length < 3) return alert('Wake word must be at least 3 characters long.');
                      if (val && Object.entries(agentTriggers).some(([k, v]) => k !== agent && v.wakeWord?.toLowerCase() === val.toLowerCase())) return alert(`Wake word "${val}" is already used!`);
                      setAgentTrigger(agent, { wakeWord: val });
                      alert('Wake word saved!');
                    }}>Save</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 60 }}>Hotkey:</span>
                    <input
                      type="text"
                      id={`hotkey-${agent}`}
                      placeholder="e.g. Ctrl+Alt+1"
                      defaultValue={agentTriggers[agent]?.hotkey || ''}
                      style={{ flex: 1, background: 'transparent', border: '1px solid var(--neo-border)', borderBottom: '1px solid var(--accent-cyan)', fontSize: 12, color: 'var(--text-primary)', padding: '4px 6px', outline: 'none' }}
                    />
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11, minWidth: 40 }} onClick={() => {
                      const val = (document.getElementById(`hotkey-${agent}`) as HTMLInputElement).value.trim();
                      if (val) {
                        const parts = val.toLowerCase().split('+');
                        const modifiers = ['ctrl', 'alt', 'shift', 'meta', 'win', 'cmd'];
                        if (parts.length < 2 || !parts.some(p => modifiers.includes(p.trim()))) {
                          return alert('Invalid hotkey. Please use modifiers like Ctrl+Alt+1. Avoid single keys.');
                        }
                        if (val.toLowerCase().includes('win') && val.toLowerCase().includes('shift') && val.toLowerCase().includes('s')) {
                          return alert("Cannot use Win+Shift+S (System Screenshot shortcut)!");
                        }
                      }
                      if (val && Object.entries(agentTriggers).some(([k, v]) => k !== agent && v.hotkey?.toLowerCase() === val.toLowerCase())) return alert(`Hotkey "${val}" is already used!`);
                      setAgentTrigger(agent, { hotkey: val });
                      alert('Hotkey saved!');
                    }}>Save</button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 16, borderTop: '1px solid var(--neo-border)' }}>
                  <button onClick={() => handleViewOutput(agent)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.2s' }} onMouseOver={e => e.currentTarget.style.color='var(--text-primary)'} onMouseOut={e => e.currentTarget.style.color='var(--text-secondary)'}>
                    <Terminal size={14} /> Output
                  </button>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => handleShowCliCommand(agent)} title="CLI Command" className="btn btn-icon" style={{ width: 28, height: 28 }}>
                      <Terminal size={14} />
                    </button>
                    <button onClick={() => handleRenameAgent(agent)} title="Rename" className="btn btn-icon" style={{ width: 28, height: 28 }}>
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => handleDeleteAgent(agent)} title="Delete" className="btn btn-icon" style={{ width: 28, height: 28, color: 'var(--accent-rose)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schedule Dialog */}
      {scheduleDialog && (
        <div className="modal-overlay" onClick={(e) => { if(e.target === e.currentTarget) setScheduleDialog(null); }}>
          <div className="modal-box" style={{ width: 380 }}>
            <button className="modal-close-btn" onClick={() => setScheduleDialog(null)} title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <h3 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)', fontSize: 16, fontWeight: 700 }}>
              ⏰ Schedule Daily Run
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              Run <strong>{scheduleDialog.name}</strong> every day at a specific time, even if this app is closed.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Time:</span>
              <input
                type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                style={{ flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--neo-border)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: 8, fontSize: 14 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setScheduleDialog(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
              <button className="btn btn-primary" onClick={() => handleRegisterSchedule(scheduleDialog.name)} style={{ flex: 1, justifyContent: 'center' }}>
                <Clock size={13} /> Register Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      
      {/* Rename Modal */}
      {renamingAgent && (
        <div className="modal-overlay" onClick={(e) => { if(e.target === e.currentTarget) setRenamingAgent(null); }}>
          <div className="modal-box" style={{ width: 400 }}>
            <button className="modal-close-btn" onClick={() => setRenamingAgent(null)} title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)', fontSize: 18, fontWeight: 700 }}>Rename Agent</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              Enter a new name for <strong>{renamingAgent.oldName}</strong>:
            </p>
            <input
              type="text"
              className="nodrag"
              value={renamingAgent.newName}
              onChange={(e) => setRenamingAgent({ ...renamingAgent, newName: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') setRenamingAgent(null);
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid var(--neo-border)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                outline: 'none',
                marginBottom: 20
              }}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-secondary" onClick={() => setRenamingAgent(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitRename}>Rename</button>
            </div>
          </div>
        </div>
      )}

      {/* CLI Command Modal */}
      {cliCommand && (
        <div className="modal-overlay" onClick={(e) => { if(e.target === e.currentTarget) setCliCommand(null); }}>
          <div className="modal-box" style={{ width: 520 }}>
            <button className="modal-close-btn" onClick={() => setCliCommand(null)} title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)', fontSize: 18, fontWeight: 700 }}>Run via terminal</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
              You can run this agent autonomously from your terminal without opening the GUI.<br/><br/>
              <span style={{ color: 'var(--text-muted)' }}>We have auto-generated the exact command you need to run, pointing directly to the compiled executable and your saved agent file:</span>
            </p>
            <div style={{ background: 'var(--bg-card)', padding: 12, borderRadius: 6, border: '1px solid var(--neo-border)', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent-cyan)', wordBreak: 'break-all', marginBottom: 16 }}>
              {cliCommand.command}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-secondary" onClick={() => setCliCommand(null)}>Close</button>
              <button className="btn btn-secondary" onClick={async () => {
                try {
                  const path = await invoke<string>('get_agent_path', { offlineMode: useSettingsStore.getState().isOfflineMode, name: cliCommand.name });
                  // Try external terminal first, fallback to in-app terminal panel
                  try {
                    await invoke('cmd_load_in_terminal', { agentPath: path });
                  } catch (_extErr) {
                    const { useWorkflowStore } = await import('../store/workflowStore');
                    useWorkflowStore.getState().setActivePanel('terminalAgent');
                  }
                  setCliCommand(null);
                } catch (err: any) {
                  alert(typeof err === 'string' ? err : "Failed to launch terminal: " + err.message);
                }
              }}>
                <Play size={14}/> Load in terminal
              </button>
              <button className="btn btn-primary" onClick={async () => { 
                try {
                  await navigator.clipboard.writeText(cliCommand.command); 
                  setCliCommand(null);
                } catch (err) {
                  alert("Failed to copy to clipboard.");
                }
              }}>
                <Copy size={14}/> Copy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
