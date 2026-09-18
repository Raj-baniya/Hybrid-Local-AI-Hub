import React from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { NodeInspector } from '../NodeInspector';
import { useWorkflowStore } from '../../store/workflowStore';
import { CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react';

interface CustomNodeWrapperProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  headerColor: string;
  selected?: boolean;
  hasTargetHandle?: boolean;
  hasSourceHandle?: boolean;
  sourceHandles?: Array<{ id: string; label: string; position?: Position }>;
  children: React.ReactNode;
}

export const CustomNodeWrapper: React.FC<CustomNodeWrapperProps> = ({
  id,
  title,
  icon,
  headerColor,
  selected = false,
  hasTargetHandle = true,
  hasSourceHandle = true,
  sourceHandles,
  children,
}) => {
  const status = useWorkflowStore((s) => s.nodeStatusMap[id]);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);

  const getStatusBadge = () => {
    if (!status || status.status === 'idle') return null;

    switch (status.status) {
      case 'running':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-cyan)', fontSize: 11 }}>
            <Loader2 size={12} className="spinning" />
            Running
          </span>
        );
      case 'success':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-emerald)', fontSize: 11 }}>
            <CheckCircle size={12} />
            {status.durationMs ? `${status.durationMs}ms` : 'Success'}
          </span>
        );
      case 'failed':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-rose)', fontSize: 11 }}>
            <AlertCircle size={12} />
            Error
          </span>
        );
      case 'skipped':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: 11 }}>
            <Clock size={12} />
            Skipped
          </span>
        );
    }
  };

  return (
    <>
      <NodeToolbar isVisible={selected && selectedNodeId === id} position={Position.Bottom} offset={15}>
        <NodeInspector />
      </NodeToolbar>
      <div
      className="custom-node-card"
      onClick={() => setSelectedNodeId(id)}
      style={{
        width: 280,
        borderRadius: 12,
        background: 'var(--bg-secondary)',
        border: `1.5px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
        boxShadow: selected
          ? 'var(--shadow-glow)'
          : status?.status === 'running'
          ? '0 0 20px rgba(6, 182, 212, 0.5)'
          : 'var(--shadow-md)',
        transition: 'all 0.15s ease',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      {/* Target Handle */}
      {hasTargetHandle && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ left: -6 }}
        />
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: `linear-gradient(135deg, ${headerColor}22 0%, var(--bg-card) 100%)`,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ color: headerColor }}>{icon}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{id}</div>
          </div>
        </div>
        <div>{getStatusBadge()}</div>
      </div>

      {/* Body Content */}
      <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
        {children}
      </div>

      {/* Source Handles */}
      {hasSourceHandle && !sourceHandles && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ right: -6 }}
        />
      )}

      {/* Multi Source Handles (e.g. ConditionalRouter) */}
      {sourceHandles?.map((h) => (
        <div key={h.id}>
          <Handle
            type="source"
            position={h.position || Position.Right}
            id={h.id}
            style={{
              right: -6,
              top: h.id === 'true' ? '35%' : '65%',
              background: h.id === 'true' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
            }}
          />
        </div>
      ))}
    </div>
    </>
  );
};
