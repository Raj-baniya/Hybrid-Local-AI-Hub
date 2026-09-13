import React from 'react';
import { Handle, Position } from '@xyflow/react';
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
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);

  const getStatusBadge = () => {
    if (!status || status.status === 'idle') return null;

    switch (status.status) {
      case 'running':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#38bdf8', fontSize: 11 }}>
            <Loader2 size={12} className="spinning" />
            Running
          </span>
        );
      case 'success':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#10b981', fontSize: 11 }}>
            <CheckCircle size={12} />
            {status.durationMs ? `${status.durationMs}ms` : 'Success'}
          </span>
        );
      case 'failed':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#f43f5e', fontSize: 11 }}>
            <AlertCircle size={12} />
            Error
          </span>
        );
      case 'skipped':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#94a3b8', fontSize: 11 }}>
            <Clock size={12} />
            Skipped
          </span>
        );
    }
  };

  return (
    <div
      onClick={() => setSelectedNodeId(id)}
      style={{
        width: 280,
        borderRadius: 12,
        background: '#0f172a',
        border: `1.5px solid ${selected ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'}`,
        boxShadow: selected
          ? '0 0 16px rgba(56, 189, 248, 0.35)'
          : status?.status === 'running'
          ? '0 0 20px rgba(6, 182, 212, 0.5)'
          : '0 4px 16px rgba(0, 0, 0, 0.4)',
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
          background: `linear-gradient(135deg, ${headerColor}22 0%, rgba(15, 23, 42, 0.8) 100%)`,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ color: headerColor }}>{icon}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>{title}</div>
            <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{id}</div>
          </div>
        </div>
        <div>{getStatusBadge()}</div>
      </div>

      {/* Body Content */}
      <div style={{ padding: '10px 14px', fontSize: 12, color: '#cbd5e1' }}>
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
              background: h.id === 'true' ? '#10b981' : '#f43f5e',
            }}
          />
        </div>
      ))}
    </div>
  );
};
