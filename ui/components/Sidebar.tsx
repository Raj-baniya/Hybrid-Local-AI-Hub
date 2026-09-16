import React from 'react';
import { Network, Bot, Sparkles, Terminal, Box, LifeBuoy, Settings } from 'lucide-react';
import { useWorkflowStore } from '../store/workflowStore';

export const Sidebar: React.FC = () => {
  const { activePanel, setActivePanel } = useWorkflowStore();

  const togglePanel = (panel: 'nodes' | 'chat' | 'logs' | 'models' | 'agents' | 'help') => {
    setActivePanel(activePanel === panel ? 'none' : panel);
  };

  const navItems = [
    { id: 'nodes', icon: Network, title: 'Node Palette' },
    { id: 'agents', icon: Bot, title: 'Library' },
    { id: 'chat', icon: Sparkles, title: 'Chat AI' },
    { id: 'logs', icon: Terminal, title: 'Execution Logs' },
    { id: 'models', icon: Box, title: 'Local Models' },
    { id: 'help', icon: LifeBuoy, title: 'Help Agent' },
  ] as const;

  return (
    <div
      style={{
        width: 56,
        height: '100%',
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 0',
        gap: 16,
        zIndex: 20,
      }}
    >
      {navItems.map((item) => {
        const isActive = activePanel === item.id;
        const Icon = item.icon;
        
        return (
          <button
            key={item.id}
            className={`btn btn-icon ${isActive ? 'active-sidebar-item' : ''}`}
            onClick={() => togglePanel(item.id)}
            title={item.title}
            style={{
              width: 40,
              height: 40,
              padding: 0,
              justifyContent: 'center',
              borderRadius: 12,
              background: isActive ? 'var(--bg-tertiary)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              border: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
              transition: 'all 0.2s ease',
            }}
          >
            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
          </button>
        );
      })}

      <div style={{ flex: 1 }} />

      <button
        className="btn btn-icon"
        title="Settings (Coming soon)"
        style={{
          width: 40,
          height: 40,
          padding: 0,
          justifyContent: 'center',
          borderRadius: 12,
          background: 'transparent',
          color: 'var(--text-muted)',
          border: '1px solid transparent',
          transition: 'all 0.2s ease',
        }}
      >
        <Settings size={20} />
      </button>
    </div>
  );
};
