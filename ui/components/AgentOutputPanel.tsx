import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Terminal, XCircle, CheckCircle2, CircleDashed, Download, X } from 'lucide-react';
import { useWorkflowStore } from '../store/workflowStore';

interface NodeOutputMessage {
  nodeId: string;
  timestamp: string;
  content: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
}

export const AgentOutputPanel: React.FC = () => {
  const [messages, setMessages] = useState<NodeOutputMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeTabId = useWorkflowStore(s => s.activeTabId);
  const storageKey = `agent-chat-${activeTabId}`;

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {}
    } else {
      setMessages([]);
    }
  }, [activeTabId]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, storageKey]);

  useEffect(() => {
    const unlistenProgress = listen<any>('node-progress', (event) => {
      const nr = event.payload;
      setMessages(prev => {
        // If a message for this node exists from the same run loop, update it, otherwise append.
        // For simplicity, just append everything to create a chat-like scrolling log.
        const msg: NodeOutputMessage = {
          nodeId: nr.node_id,
          timestamp: new Date().toLocaleTimeString(),
          content: nr.output_preview || nr.error || (nr.status === 'Running' ? 'Executing...' : 'No output'),
          status: nr.status.toLowerCase() as any,
        };
        return [...prev, msg];
      });
    });

    return () => {
      unlistenProgress.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const getStatusIcon = (status: NodeOutputMessage['status']) => {
    switch (status) {
      case 'success': return <CheckCircle2 size={14} style={{ color: 'var(--accent-cyan)' }} />;
      case 'failed': return <XCircle size={14} style={{ color: 'var(--accent-rose)' }} />;
      case 'skipped': return <CircleDashed size={14} style={{ color: 'var(--text-muted)' }} />;
      case 'running': return <Terminal size={14} style={{ color: 'var(--text-secondary)' }} />;
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--bg-panel)',
      borderLeft: '1px solid var(--border-medium)',
      width: '100%'
    }}>
      <div style={{
        padding: '10px 14px',
        borderBottom: '3px solid var(--neo-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--bg-card)',
        flexShrink: 0
      }}>
        <Terminal size={16} color="var(--accent-cyan)" />
        <h3 style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', fontWeight: 700 }}>Automation log</h3>
        
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <button
            onClick={async () => {
              if (messages.length === 0) return;
              try {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const { invoke } = await import('@tauri-apps/api/core');
                const outputPath = await save({
                  title: 'Save automation log',
                  filters: [{ name: 'Text', extensions: ['txt'] }],
                  defaultPath: 'automation_log.txt',
                });
                if (outputPath) {
                  const text = messages.map(m => `[${m.timestamp}] [${m.status.toUpperCase()}] ${m.nodeId}\n${m.content}`).join('\n\n');
                  await invoke('save_text_file', { path: outputPath, text });
                }
              } catch (e) { console.error(e); }
            }}
            title="Download log"
            style={{ background: 'transparent', border: 'none', cursor: messages.length > 0 ? 'pointer' : 'not-allowed', color: messages.length > 0 ? 'var(--text-secondary)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4, transition: 'color 0.15s' }}
            disabled={messages.length === 0}
          >
            <Download size={14} />
          </button>
          <button
            onClick={() => { setMessages([]); localStorage.removeItem(storageKey); }}
            title="Clear log"
            className="btn btn-secondary"
            style={{ padding: '3px 8px', fontSize: 11 }}
          >
            Clear
          </button>
          <button
            onClick={() => useWorkflowStore.getState().setShowOutputPanel(false)}
            title="Close panel"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4, transition: 'color 0.15s' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={scrollRef} style={{
          position: 'absolute',
          inset: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1,
        }}>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
              No output yet. Run an automation to see logs here.
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} style={{
                background: 'var(--bg-card)',
                borderRadius: 8,
                border: '1px solid var(--neo-border)',
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '6px 12px',
                  background: 'var(--bg-secondary)',
                  borderBottom: '1px solid var(--neo-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {getStatusIcon(msg.status)}
                    {msg.nodeId}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{msg.timestamp}</div>
                </div>
                <div style={{
                  padding: 12,
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--accent-cyan)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 300,
                  overflowY: 'auto'
                }}>
                  {msg.content}
                </div>
              </div>
            ))
          )}
          </div>
        </div>
      </div>
    </div>
  );
};
