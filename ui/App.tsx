import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Navbar } from './components/Navbar';
import { NodePalette } from './components/NodePalette';
import { GraphCanvas } from './components/GraphCanvas';
import { NodeInspector } from './components/NodeInspector';
import { ChatPanel } from './components/ChatPanel';
import { LogPanel } from './components/LogPanel';
import { ModelManager } from './components/ModelManager';
import { useWorkflowStore } from './store/workflowStore';

export const App: React.FC = () => {
  const activePanel = useWorkflowStore((s) => s.activePanel);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);

  const renderSidePanel = () => {
    switch (activePanel) {
      case 'chat':
        return <ChatPanel />;
      case 'logs':
        return <LogPanel />;
      case 'models':
        return <ModelManager />;
      case 'inspector':
        return <NodeInspector />;
      default:
        return selectedNodeId ? <NodeInspector /> : null;
    }
  };

  return (
    <ReactFlowProvider>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <Navbar />
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
          <NodePalette />
          <div style={{ flex: 1, position: 'relative' }}>
            <GraphCanvas />
          </div>
          {renderSidePanel()}
        </div>
      </div>
    </ReactFlowProvider>
  );
};
