import React, { useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Connection,
  ReactFlowInstance,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import { Undo2, Redo2 } from 'lucide-react';
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
  const deleteNodes = useWorkflowStore((s) => s.deleteNodes);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const pushHistory = useWorkflowStore((s) => s.pushHistory);
  const pastCount = useWorkflowStore((s) => s.history.past.length);
  const futureCount = useWorkflowStore((s) => s.history.future.length);
  const canUndo = pastCount > 0;
  const canRedo = futureCount > 0;
  const theme = useWorkflowStore((s) => s.theme);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const [rfInstance, setRfInstance] = React.useState<ReactFlowInstance | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        if (e.shiftKey) redo();
        else undo();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
        redo();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

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

  const onDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
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
      style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--bg-primary)' }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
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
        onNodesDelete={(nodes) => deleteNodes(nodes.map((n) => n.id))}
        onNodeDragStart={() => pushHistory()}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        panOnScroll={true}
        selectionOnDrag={true}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: 'var(--text-muted)', strokeWidth: 2 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={2} color={theme === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'} />
        
        <Panel position="top-left" style={{ display: 'flex', gap: 8, margin: 16 }}>
          <button 
            onClick={undo} 
            disabled={!canUndo} 
            title="Undo (Ctrl+Z)"
            style={{ 
              background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, 
              padding: '6px', color: canUndo ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: canUndo ? 'pointer' : 'not-allowed', opacity: canUndo ? 1 : 0.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <Undo2 size={16} />
          </button>
          <button 
            onClick={redo} 
            disabled={!canRedo} 
            title="Redo (Ctrl+Y)"
            style={{ 
              background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, 
              padding: '6px', color: canRedo ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: canRedo ? 'pointer' : 'not-allowed', opacity: canRedo ? 1 : 0.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <Redo2 size={16} />
          </button>
        </Panel>

        <Controls
          style={{
            background: 'var(--bg-glass)',
            borderColor: 'var(--border-subtle)',
            fill: 'var(--text-muted)',
            borderRadius: 8,
          }}
        />
        <MiniMap
          nodeColor={() => 'var(--bg-tertiary)'}
          maskColor={theme === 'dark' ? 'rgba(9, 13, 22, 0.75)' : 'rgba(255, 255, 255, 0.75)'}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
          }}
        />
      </ReactFlow>
    </div>
  );
};
