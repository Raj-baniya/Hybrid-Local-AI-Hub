import React from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { ScrollText, CheckCircle, AlertCircle, Clock, X, Copy } from 'lucide-react';

export const LogPanel: React.FC = () => {
  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);
  const executionRecord = useWorkflowStore((s) => s.executionRecord);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <span style={{ color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <CheckCircle size={12} /> Success
          </span>
        );
      case 'failed':
      case 'partialfailure':
        return (
          <span style={{ color: '#f43f5e', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <AlertCircle size={12} /> {status === 'partialfailure' ? 'Partial Failure' : 'Failed'}
          </span>
        );
      case 'running':
        return (
          <span style={{ color: '#3b82f6', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <Clock size={12} /> Running
          </span>
        );
      default:
        return (
          <span style={{ color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Clock size={12} /> {status === 'pending' ? 'Pending' : status}
          </span>
        );
    }
  };

  const copyRecordJson = () => {
    if (executionRecord) {
      navigator.clipboard.writeText(JSON.stringify(executionRecord, null, 2));
    }
  };

  return (
    <div
      style={{
        width: 440,
        background: 'rgba(15, 23, 42, 0.95)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScrollText size={18} style={{ color: '#38bdf8' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>Execution Logs</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {executionRecord && (
            <button
              onClick={copyRecordJson}
              title="Copy JSON Record"
              style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}
            >
              <Copy size={16} />
            </button>
          )}
          <button
            onClick={() => setActivePanel('none')}
            style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!executionRecord ? (
          <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
            No execution logs yet. Run the active workflow to view per-node execution telemetry.
          </div>
        ) : (
          <>
            <div
              style={{
                padding: 14,
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 8,
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Execution ID:</span>
                <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>{executionRecord.execution_id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Status:</span>
                <span>{getStatusBadge(executionRecord.overall_status)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Trigger Source:</span>
                <span style={{ color: '#cbd5e1' }}>{executionRecord.trigger_source}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Started:</span>
                <span style={{ color: '#cbd5e1' }}>{new Date(executionRecord.started_at).toLocaleTimeString()}</span>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
              Node Execution Details ({executionRecord.nodes.length})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {executionRecord.nodes.map((node) => (
                <div
                  key={node.node_id}
                  style={{
                    padding: 12,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{node.node_type}</span>
                      <span style={{ marginLeft: 6, color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>
                        ({node.node_id})
                      </span>
                    </div>
                    <div>{getStatusBadge(node.status)}</div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 11 }}>
                    <span>Duration:</span>
                    <span>{node.duration_ms ? `${node.duration_ms} ms` : '—'}</span>
                  </div>

                  {node.output_preview && (
                    <div style={{ marginTop: 6, background: 'rgba(0, 0, 0, 0.3)', padding: '6px 8px', borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>Output Preview:</div>
                      <pre style={{ margin: 0, fontSize: 11, color: '#38bdf8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {node.output_preview}
                      </pre>
                    </div>
                  )}

                  {node.error && (
                    <div style={{ marginTop: 6, background: 'rgba(244, 63, 94, 0.15)', padding: '6px 8px', borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: '#f43f5e', marginBottom: 2 }}>Error:</div>
                      <pre style={{ margin: 0, fontSize: 11, color: '#fca5a5', whiteSpace: 'pre-wrap' }}>
                        {node.error}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
