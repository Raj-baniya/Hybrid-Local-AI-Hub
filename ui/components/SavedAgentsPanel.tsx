import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkflowStore } from '../store/workflowStore';
import { Graph } from '../schema/graphSchema';
import { Bot, X, Download, Play, RefreshCw, Loader2, Edit3, Terminal, Copy } from 'lucide-react';

export const SavedAgentsPanel: React.FC = () => {
  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);
  const createTab = useWorkflowStore((s) => s.createTab);

  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingOutput, setViewingOutput] = useState<{name: string, text: string, isPlaceholder?: boolean} | null>(null);
  const [cliCommand, setCliCommand] = useState<string | null>(null);

  const fetchAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<string[]>('list_agents');
      setAgents(list);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to list agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleOpenInCanvas = async (name: string) => {
    try {
      const graph = await invoke<Graph>('load_agent', { name });
      createTab(name, graph);
      setActivePanel('none');
    } catch (err: any) {
      setError(`Failed to open agent: ${err}`);
      throw err;
    }
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
      const output = await invoke<string>('get_agent_output', { name });
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

  const handleRenameAgent = async (oldName: string) => {
    const newName = window.prompt(`Rename agent '${oldName}' to:`, oldName);
    if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
    
    setLoading(true);
    try {
      await invoke('rename_agent', { oldName, newName: newName.trim() });
      await fetchAgents();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to rename agent');
      setLoading(false);
    }
  };

  const handleShowCliCommand = async (name: string) => {
    try {
      const path = await invoke<string>('get_agent_path', { name });
      const command = await invoke<string>('get_cli_command', { agentPath: path });
      setCliCommand(command);
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
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bot size={18} color="var(--accent-cyan)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Saved Agents</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={fetchAgents} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} title="Refresh">
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
          <button onClick={() => setActivePanel('none')} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {agents.map((agent) => (
              <div key={agent} style={{ background: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ padding: 8, background: 'rgba(56,189,248,0.1)', borderRadius: 8, color: 'var(--accent-cyan)' }}>
                      <Bot size={16} />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: 1.3 }}>
                      {agent}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={() => handleShowCliCommand(agent)} title="Show CLI Command" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                      <Terminal size={14} />
                    </button>
                    <button onClick={() => handleRenameAgent(agent)} title="Rename Agent" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                      <Edit3 size={14} />
                    </button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <button className="btn btn-secondary" style={{ fontSize: 11, padding: '6px 0', justifyContent: 'center' }} onClick={() => handleOpenInCanvas(agent)}>
                    <Edit3 size={12} /> Open
                  </button>
                  <button className="btn btn-primary" style={{ fontSize: 11, padding: '6px 0', justifyContent: 'center' }} onClick={() => handleRunAgent(agent)}>
                    <Play size={12} /> Run
                  </button>
                  <button className="btn btn-secondary" style={{ fontSize: 11, padding: '6px 0', justifyContent: 'center' }} onClick={() => handleViewOutput(agent)}>
                    Output
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CLI Command Modal */}
      {cliCommand && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--bg-panel)', padding: 24, borderRadius: 12, width: 500, border: '1px solid var(--border-medium)' }}>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)' }}>Run via Terminal</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
              You can run this agent autonomously from your terminal without opening the GUI.<br/><br/>
              <span style={{ color: 'var(--text-muted)' }}>We have auto-generated the exact command you need to run, pointing directly to the compiled executable and your saved agent file:</span>
            </p>
            <div style={{ background: 'var(--bg-card)', padding: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent-cyan)', wordBreak: 'break-all', marginBottom: 16 }}>
              {cliCommand}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-secondary" onClick={() => setCliCommand(null)}>Close</button>
              <button className="btn btn-primary" onClick={async () => { 
                try {
                  await navigator.clipboard.writeText(cliCommand); 
                  setCliCommand(null);
                } catch (err) {
                  alert("Failed to copy to clipboard.");
                }
              }}>
                <Copy size={14}/> Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
