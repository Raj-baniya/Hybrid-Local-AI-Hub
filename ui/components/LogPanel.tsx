import { useSettingsStore } from '../store/settingsStore';
import React, { useEffect, useState } from 'react';
import { useWorkflowStore, ExecutionRecord } from '../store/workflowStore';
import { ScrollText, CheckCircle, AlertCircle, Clock, X, Copy, History } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export const LogPanel: React.FC = () => {
  const isOfflineMode = useSettingsStore(s => s.isOfflineMode);

  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);
  const globalExecutionRecord = useWorkflowStore((s) => s.executionRecord);

  const [history, setHistory] = useState<ExecutionRecord[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  useEffect(() => {
    let superseded = false;
    const requestedMode = isOfflineMode;
    invoke('list_execution_logs', { offlineMode: requestedMode })
      .then((res: any) => {
        if (!superseded && requestedMode === useSettingsStore.getState().isOfflineMode) {
          setHistory(res);
        }
      })
      .catch(console.error);
    return () => { superseded = true; };
  }, [isOfflineMode]);

  useEffect(() => {
    if (globalExecutionRecord && (globalExecutionRecord.overall_status === 'success' || globalExecutionRecord.overall_status === 'failed' || globalExecutionRecord.overall_status === 'partialfailure')) {
      setHistory(prev => {
        const exists = prev.some(r => r.execution_id === globalExecutionRecord.execution_id);
        if (exists) {
          return prev.map(r => r.execution_id === globalExecutionRecord.execution_id ? globalExecutionRecord : r);
        } else {
          return [globalExecutionRecord, ...prev];
        }
      });
    }
  }, [globalExecutionRecord]);

  const executionRecord = selectedLogId 
    ? history.find(r => r.execution_id === selectedLogId) || globalExecutionRecord
    : globalExecutionRecord;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <span style={{ color: 'var(--accent-emerald)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <CheckCircle size={12} /> Success
          </span>
        );
      case 'failed':
      case 'partialfailure':
        return (
          <span style={{ color: 'var(--accent-rose)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <AlertCircle size={12} /> {status === 'partialfailure' ? 'Partial Failure' : 'Failed'}
          </span>
        );
      case 'running':
        return (
          <span style={{ color: 'var(--accent-cyan)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <Clock size={12} /> Running
          </span>
        );
      default:
        return (
          <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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
      className="animate-slide-in-right"
      style={{
        width: '100%',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScrollText size={18} style={{ color: 'var(--accent-cyan)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Execution Logs</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {executionRecord && (
            <button
              onClick={copyRecordJson}
              title="Copy JSON Record"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <Copy size={16} />
            </button>
          )}
          <button
            onClick={() => setActivePanel('none')}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* History Dropdown */}
        {history.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-medium)' }}>
            <History size={14} style={{ color: 'var(--text-muted)' }} />
            <select
              value={selectedLogId || ""}
              onChange={(e) => setSelectedLogId(e.target.value === "" ? null : e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: 12,
                outline: 'none',
                flex: 1,
                cursor: 'pointer'
              }}
            >
              <option value="">Live / Current Session</option>
              {history.map(record => (
                <option key={record.execution_id} value={record.execution_id}>
                  {new Date(record.started_at).toLocaleString()} - {record.overall_status.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        )}

        {!executionRecord ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
            No execution logs yet. Run the active workflow to view per-node execution telemetry.
          </div>
        ) : (
          <>
            <div
              style={{
                padding: 14,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 8,
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Execution ID:</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--accent-cyan)' }}>{executionRecord.execution_id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                <span>{getStatusBadge(executionRecord.overall_status)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Trigger Source:</span>
                <span style={{ color: 'var(--text-secondary)' }}>{executionRecord.trigger_source}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Started:</span>
                <span style={{ color: 'var(--text-secondary)' }}>{new Date(executionRecord.started_at).toLocaleTimeString()}</span>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Node Execution Details ({executionRecord.nodes.length})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {executionRecord.nodes.map((node) => (
                <div
                  key={node.node_id}
                  style={{
                    padding: 12,
                    background: 'var(--bg-glass)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{node.node_type}</span>
                      <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                        ({node.node_id})
                      </span>
                    </div>
                    <div>{getStatusBadge(node.status)}</div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 11 }}>
                    <span>Duration:</span>
                    <span>{node.duration_ms ? `${node.duration_ms} ms` : '—'}</span>
                  </div>

                  {node.output_preview && (
                    <div style={{ marginTop: 6, background: 'var(--bg-secondary)', padding: '6px 8px', borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Output Preview:</div>
                      <pre style={{ margin: 0, fontSize: 11, color: 'var(--accent-cyan)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {node.output_preview}
                      </pre>
                    </div>
                  )}

                  {node.error && (
                    <div style={{ marginTop: 6, background: 'rgba(244, 63, 94, 0.15)', padding: '6px 8px', borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: 'var(--accent-rose)', marginBottom: 2 }}>Error:</div>
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
