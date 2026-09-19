import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkflowStore } from '../store/workflowStore';
import { X, Wifi, WifiOff, Plus, Trash2, CheckCircle2, Settings, Moon, Sun, AlertCircle, Bot, Cpu } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ModelManager } from './ModelManager';
import { SavedAgentsPanel } from './SavedAgentsPanel';

interface ProviderConfig {
  key: string;
  name: string;
  model: string;
}

export const SettingsModal: React.FC = () => {
  const {
    isSettingsModalOpen,
    setSettingsModalOpen,
    isOfflineMode,
    setOfflineMode,
  } = useSettingsStore();
  
  const theme = useWorkflowStore((s) => s.theme);
  const setTheme = useWorkflowStore((s) => s.setTheme);

  const [activeTab, setActiveTab] = useState<'general' | 'providers' | 'models' | 'agents'>('general');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isSettingsModalOpen) {
      loadProviders();
    }
  }, [isSettingsModalOpen]);

  const loadProviders = async () => {
    try {
      const result = await invoke<ProviderConfig[]>('get_providers');
      setProviders(result);
    } catch (e) {
      console.error('Failed to load providers', e);
    }
  };

  const handleAddProvider = async () => {
    if (!newLabel || !newModel || !newKey) return;
    setLoading(true);
    try {
      await invoke('save_provider', {
        provider: { name: newLabel, model: newModel, key: newKey },
      });
      setNewLabel('');
      setNewModel('');
      setNewKey('');
      await loadProviders();
    } catch (e) {
      console.error(e);
      alert('Failed to save provider: ' + String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProvider = async (name: string) => {
    if (!window.confirm(`Delete provider ${name}?`)) return;
    try {
      await invoke('delete_provider', { name });
      await loadProviders();
    } catch (e) {
      console.error(e);
      alert('Failed to delete provider: ' + String(e));
    }
  };

  if (!isSettingsModalOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      className="animate-fade-in"
    >
      <div
        style={{
          width: 800,
          height: '80vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 20,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        className="animate-scale-in"
      >
        {/* Header */}
        <div
          style={{
            padding: '24px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ padding: 8, background: 'var(--bg-tertiary)', borderRadius: 12 }}>
              <Settings size={20} color="var(--text-primary)" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>Settings</h2>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Configure app preferences and API providers</span>
            </div>
          </div>
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="btn btn-secondary btn-icon"
            style={{ borderRadius: '50%' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
          <button
            onClick={() => setActiveTab('general')}
            style={{
              flex: 1,
              padding: '16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'general' ? '2px solid var(--accent-emerald)' : '2px solid transparent',
              color: activeTab === 'general' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('providers')}
            style={{
              flex: 1,
              padding: '16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'providers' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              color: activeTab === 'providers' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            AI Providers
          </button>
          <button
            onClick={() => setActiveTab('models')}
            style={{
              flex: 1,
              padding: '16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'models' ? '2px solid var(--accent-emerald)' : '2px solid transparent',
              color: activeTab === 'models' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
            }}
          >
            <Cpu size={16} /> Models
          </button>
          <button
            onClick={() => setActiveTab('agents')}
            style={{
              flex: 1,
              padding: '16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'agents' ? '2px solid var(--accent-rose)' : '2px solid transparent',
              color: activeTab === 'agents' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
            }}
          >
            <Bot size={16} /> Agents
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 32, flex: 1, minHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              
              {/* Air-Gap Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 20,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 16,
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      background: isOfflineMode ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                      color: isOfflineMode ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                      transition: 'all 0.3s ease',
                    }}
                  >
                    {isOfflineMode ? <WifiOff size={24} /> : <Wifi size={24} />}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15, marginBottom: 4 }}>
                      Network Mode
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {isOfflineMode
                        ? 'Air-Gapped: Strict offline mode. External APIs are blocked.'
                        : 'Online: External APIs and online AI providers are permitted.'}
                    </div>
                  </div>
                </div>

                <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24 }}>
                  <input
                    type="checkbox"
                    checked={isOfflineMode}
                    onChange={(e) => setOfflineMode(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: isOfflineMode ? 'var(--accent-emerald)' : 'var(--bg-modifier-hover)',
                      transition: '.3s',
                      borderRadius: 24,
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        content: '""',
                        height: 16,
                        width: 16,
                        left: isOfflineMode ? 22 : 3,
                        bottom: 3,
                        backgroundColor: isOfflineMode ? 'white' : 'var(--text-muted)',
                        transition: '.3s',
                        borderRadius: '50%',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                      }}
                    />
                  </span>
                </label>
              </div>

              {/* Theme Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 20,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 16,
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: 'var(--accent-blue)',
                    }}
                  >
                    {theme === 'dark' ? <Moon size={24} /> : <Sun size={24} />}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15, marginBottom: 4 }}>
                      Application Theme
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      Toggle between Dark and Light mode.
                    </div>
                  </div>
                </div>

                <button
                  className="btn btn-secondary"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  style={{ minWidth: 100, justifyContent: 'center' }}
                >
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </button>
              </div>

            </div>
          )}

          {activeTab === 'providers' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 24,
                opacity: isOfflineMode ? 0.5 : 1,
                pointerEvents: isOfflineMode ? 'none' : 'auto',
                transition: 'all 0.3s ease',
              }}
            >
              {isOfflineMode && (
                <div style={{ padding: 12, background: 'rgba(244, 63, 94, 0.1)', color: 'var(--accent-rose)', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={16} /> Online providers are disabled in Air-Gapped mode.
                </div>
              )}
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)', fontWeight: 600 }}>Configured Providers</h3>
                {providers.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px', background: 'var(--bg-tertiary)', borderRadius: 12, textAlign: 'center', border: '1px dashed var(--border-subtle)' }}>
                    No providers configured yet.
                  </div>
                ) : (
                  providers.map((p) => (
                    <div key={p.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'var(--bg-tertiary)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>{p.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.model}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-emerald)', fontSize: 12, fontWeight: 500 }}>
                          <CheckCircle2 size={16} /> Active
                        </div>
                        <button onClick={() => handleDeleteProvider(p.name)} className="btn btn-icon" style={{ color: 'var(--accent-rose)' }} title="Delete Provider">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
                <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)', fontWeight: 600 }}>Add New Provider</h3>
                <div style={{ display: 'flex', gap: 12 }}>
                  <input
                    type="text"
                    placeholder="Provider Name (e.g. Nemotron)"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    className="input-field"
                    style={{ flex: 1, background: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                  <input
                    type="text"
                    placeholder="Model ID (e.g. nvidia/nemotron)"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    className="input-field"
                    style={{ flex: 1, background: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <input
                    type="password"
                    placeholder="API Key (sk-...)"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className="input-field"
                    style={{ flex: 1, background: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleAddProvider}
                    disabled={loading || !newLabel || !newModel || !newKey}
                    style={{ padding: '0 24px' }}
                  >
                    <Plus size={16} /> Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'models' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
               <ModelManager />
            </div>
          )}

          {activeTab === 'agents' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
               <SavedAgentsPanel />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            background: 'var(--bg-card)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            className="btn btn-primary"
            onClick={() => setSettingsModalOpen(false)}
            style={{ minWidth: 120, justifyContent: 'center' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
