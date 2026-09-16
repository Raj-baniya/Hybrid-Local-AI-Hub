import React, { useState, useEffect } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { X, Play, Edit3 } from 'lucide-react';
import { NodeType } from '../schema/graphSchema';

export const PreRunDialog: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
  const activeTabId = useWorkflowStore((s) => s.activeTabId);
  const tabs = useWorkflowStore((s) => s.tabs);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  
  const inputNodes = activeTab?.nodes.filter(
    (n) => (n.data as NodeType).type === 'TextInputNode'
  ) || [];

  const [localValues, setLocalValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const initVals: Record<string, string> = {};
    inputNodes.forEach((n) => {
      initVals[n.id] = (n.data as any).text || '';
    });
    setLocalValues(initVals);
  }, [activeTabId]);

  const handleProceed = () => {
    // Commit local values back to store
    Object.keys(localValues).forEach((nodeId) => {
      const node = inputNodes.find((n) => n.id === nodeId);
      if (node && localValues[nodeId] !== (node.data as any).text) {
        updateNodeData(nodeId, { text: localValues[nodeId] });
      }
    });
    onConfirm();
  };

  if (inputNodes.length === 0) {
    return (
      <div style={overlayStyle}>
        <div className="wizard-card" style={cardStyle}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>Run Workflow</h2>
            <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 14 }}>
              This workflow has no text input nodes to configure.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            <button className="btn btn-primary" onClick={handleProceed}><Play size={14}/> Run Now</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div className="wizard-card" style={{...cardStyle, width: 450, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Edit3 color="var(--accent-cyan)" />
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>Review Agent Inputs</h2>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, paddingRight: 8, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {inputNodes.map((node) => (
            <div key={node.id} style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Input Node: <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{node.id}</span>
              </label>
              <textarea
                value={localValues[node.id] !== undefined ? localValues[node.id] : (node.data as any).text}
                onChange={(e) => setLocalValues({ ...localValues, [node.id]: e.target.value })}
                style={{
                  width: '100%',
                  minHeight: 80,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 6,
                  color: 'var(--text-primary)',
                  padding: 10,
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  resize: 'vertical',
                  outline: 'none'
                }}
                placeholder="Enter input text for this agent..."
              />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleProceed}><Play size={14}/> Confirm & Run</button>
        </div>
      </div>
    </div>
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-medium)',
  borderRadius: 12,
  padding: 24,
  width: 350,
  boxShadow: 'var(--shadow-lg)',
};
