import React from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { Plus, X } from 'lucide-react';

export const TopBar: React.FC = () => {
  const tabs = useWorkflowStore((s) => s.tabs);
  const activeTabId = useWorkflowStore((s) => s.activeTabId);
  const switchTab = useWorkflowStore((s) => s.switchTab);
  const requestCloseTab = useWorkflowStore((s) => s.requestCloseTab);
  const createTab = useWorkflowStore((s) => s.createTab);

  return (
    <div
      style={{
        height: 36,
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--neo-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '0 16px',
        gap: 16,
        userSelect: 'none',
        zIndex: 20,
      }}
    >
      {/* Left: Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%', flex: 1, minWidth: 0 }}>
        <div className="tab-bar" style={{ flex: 1, height: '100%', borderBottom: 'none' }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`tab-item${isActive ? ' active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 12px',
                  height: 36,
                  borderRight: '1px solid var(--border-medium)',
                  background: isActive ? 'var(--bg-panel)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  flexShrink: 0,
                  fontFamily: 'var(--font-sans)',
                  transition: 'background 0.15s, color 0.15s',
                  userSelect: 'none',
                }}
              >
                <span>
                  {tab.title}
                  {tab.isDirty ? <span style={{ color: 'var(--accent-cyan)' }}> *</span> : ''}
                </span>
                {tabs.length > 1 && (
                  <div
                    className="tab-close"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      marginLeft: 4,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestCloseTab(tab.id);
                    }}
                  >
                    <X size={12} />
                  </div>
                )}
              </div>
            );
          })}
          <button
            onClick={() => createTab()}
            title="New Workflow Tab"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
