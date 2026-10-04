import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Connection,
  ReactFlowInstance,
  BackgroundVariant,
  Panel,
  Node,
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
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [clipboard, setClipboard] = useState<Node[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      
      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        if (e.shiftKey) redo();
        else undo();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
        redo();
        e.preventDefault();
      }

      // Copy
      else if ((e.ctrlKey || e.metaKey) && key === 'c') {
         const selected = activeTab.nodes.filter(n => n.selected);
         if (selected.length > 0) {
            setClipboard(JSON.parse(JSON.stringify(selected)));
         }
      }

      // Paste
      else if ((e.ctrlKey || e.metaKey) && key === 'v') {
         if (clipboard.length > 0) {
            pushHistory();
            const newNodes = clipboard.map((n) => {
                const nodeType = (n.data as any).type || 'unknown';
                const newId = `${nodeType.toLowerCase().replace('node', '')}_${crypto.randomUUID().slice(0, 8)}`;
                return {
                   ...n,
                   id: newId,
                   position: { x: n.position.x + 30, y: n.position.y + 30 },
                   selected: true,
                };
            });
            // Deselect old nodes
            onNodesChange(activeTab.nodes.map(n => ({ id: n.id, type: 'select', selected: false } as any)));
            
            const addChanges = newNodes.map(n => ({ type: 'add', item: n }));
            onNodesChange(addChanges as any);
         }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, activeTab.nodes, pushHistory, deleteNodes, clipboard, onNodesChange]);

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

      const type = event.dataTransfer.getData('application/reactflow') as NodeType['type'] || event.dataTransfer.getData('text/plain') as NodeType['type'];
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
        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
        onNodesDelete={(nodes) => { pushHistory(); deleteNodes(nodes.map((n) => n.id)); }}
        onNodeDragStart={() => pushHistory()}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        panOnScroll={true}
        zoomOnScroll={false}
        zoomOnPinch={true}
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
            title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
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
              background: 'var(--bg-card)', 
              border: '1px solid var(--border-medium)', 
              borderRadius: 8,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              overflow: 'hidden'
           }} 
        />

      </ReactFlow>
    </div>
  );
};
