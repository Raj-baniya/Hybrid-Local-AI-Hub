import React, { useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { X, Play, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export const NodeInspectorPanel: React.FC = () => {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const activeTabId = useWorkflowStore((s) => s.activeTabId);
  const tabs = useWorkflowStore((s) => s.tabs);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const node = activeTab?.nodes.find(n => n.id === selectedNodeId);

  if (!node) return null;

  const handleTestNode = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      // Call a backend function to validate/test the node
      // For now, we will call a placeholder command 'validate_node'
      const res: any = await invoke('validate_node', { node });
      setTestResult({ success: res.success, message: res.message || 'Validation passed!' });
    } catch (err: any) {
      setTestResult({ success: false, message: typeof err === 'string' ? err : err.message || 'Validation failed' });
    } finally {
      setIsTesting(false);
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
        justifyContent: 'space-between',
        background: 'var(--bg-secondary)',
        flexShrink: 0
      }}>
        <h3 style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
          Node Inspector
        </h3>
        <button 
          onClick={() => setSelectedNodeId(null)} 
          className="btn btn-secondary btn-icon" 
          style={{ width: 24, height: 24 }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: 16, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>NODE ID</div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{node.id}</div>
        </div>
        
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>TYPE</div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{String(node.data.type)}</div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>CONFIGURATION</div>
          <pre style={{ 
            background: 'var(--bg-primary)', 
            padding: 12, 
            borderRadius: 6, 
            border: '1px solid var(--border-subtle)',
            fontSize: 12,
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0
          }}>
            {JSON.stringify(node.data, null, 2)}
          </pre>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <button 
            className="btn btn-primary" 
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={handleTestNode}
            disabled={isTesting}
          >
            {isTesting ? <Loader2 size={16} className="spinning" /> : <Play size={16} />}
            Validate Node Configuration
          </button>
          
          {testResult && (
            <div style={{ 
              marginTop: 12, 
              padding: 12, 
              borderRadius: 6,
              fontSize: 12,
              background: testResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
              color: testResult.success ? 'var(--accent-emerald)' : 'var(--accent-rose)',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start'
            }}>
              {testResult.success ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <XCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
              <div>{testResult.message}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
