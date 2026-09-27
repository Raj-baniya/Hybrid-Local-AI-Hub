import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Terminal, XCircle, CheckCircle2, CircleDashed } from 'lucide-react';

interface NodeOutputMessage {
  nodeId: string;
  timestamp: string;
  content: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
}

export const AgentOutputPanel: React.FC = () => {
  const [messages, setMessages] = useState<NodeOutputMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlistenStarted = listen('scheduled-task-started', () => {
      // Clear logs on a new run
      setMessages([]);
    });

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
      unlistenStarted.then(fn => fn());
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
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-medium)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--bg-secondary)',
        flexShrink: 0
      }}>
        <Terminal size={16} color="var(--accent-cyan)" />
        <h3 style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>Automation Log</h3>
        
        <button 
          onClick={() => setMessages([])} 
          className="btn btn-secondary" 
          style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: 11 }}
        >
          Clear
        </button>
      </div>

      <div ref={scrollRef} style={{
        flex: 1,
        overflowY: 'auto',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}>
        {messages.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
            No output yet. Run an automation to see logs here.
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} style={{
              background: 'var(--bg-card)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '6px 12px',
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-subtle)',
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
                color: 'var(--text-secondary)',
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
  );
};
