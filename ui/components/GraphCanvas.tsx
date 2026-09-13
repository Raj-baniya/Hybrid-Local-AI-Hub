import React, { useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Connection,
  ReactFlowInstance,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useWorkflowStore } from '../store/workflowStore';
import { customNodeTypes } from './nodes/NodeComponents';
import { NodeType } from '../schema/graphSchema';

export const GraphCanvas: React.FC = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const activeTabId = useWorkflowStore((s) => s.activeTabId);
  const tabs = useWorkflowStore((s) => s.tabs);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const [rfInstance, setRfInstance] = React.useState<ReactFlowInstance | null>(null);

  const handleConnect = useCallback(
    (params: Connection) => {
      const success = onConnect(params);
      if (!success) {
        alert('Connection rejected: Direct cycle detected! Workflows must be Directed Acyclic Graphs (DAGs).');
      }
    },
    [onConnect]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow') as NodeType['type'];
      if (!type || !rfInstance || !reactFlowWrapper.current) return;

      const position = rfInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(type, position);
    },
    [rfInstance, addNode]
  );

  return (
    <div
      ref={reactFlowWrapper}
      style={{ width: '100%', height: '100%', position: 'relative', background: '#090d16' }}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={activeTab.nodes}
        edges={activeTab.edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        nodeTypes={customNodeTypes}
        onInit={setRfInstance}
        onPaneClick={() => setSelectedNodeId(null)}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: '#64748b', strokeWidth: 2 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255, 255, 255, 0.08)" />
        <Controls
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            fill: '#94a3b8',
            borderRadius: 8,
          }}
        />
        <MiniMap
          nodeColor={() => '#1e293b'}
          maskColor="rgba(9, 13, 22, 0.75)"
          style={{
            background: '#0f172a',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 8,
          }}
        />
      </ReactFlow>
    </div>
  );
};
