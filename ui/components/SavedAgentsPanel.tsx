import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkflowStore } from '../store/workflowStore';
import { Bot, Terminal, Edit3, X, Loader2, RefreshCw } from 'lucide-react';
import { Graph } from '../schema/graphSchema';

export const SavedAgentsPanel: React.FC = () => {
  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);
  const createTab = useWorkflowStore((s) => s.createTab);

  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    }
  };

  const handleRunInTerminal = async (name: string) => {
    try {
      await invoke('launch_agent_terminal', { name });
    } catch (err: any) {
      setError(`Failed to launch terminal: ${err}`);
    }
  };

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
              <div key={agent} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
                  {agent}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleOpenInCanvas(agent)}>
                    <Edit3 size={14} /> Open in Canvas
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleRunInTerminal(agent)}>
                    <Terminal size={14} /> Run in Terminal
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
