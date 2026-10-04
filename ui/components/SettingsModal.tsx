import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkflowStore } from '../store/workflowStore';
import {
  X, Wifi, WifiOff, Plus, Trash2, CheckCircle2, Settings, Moon, Sun, AlertCircle, Bot, Cpu,
  Clock, Rocket, Bell, Mic, Keyboard, Info, FileText, Volume2,
  Calendar, Square, RefreshCw, Shield, Heart, Terminal
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ModelManager } from './ModelManager';
import { SavedAgentsPanel } from './SavedAgentsPanel';

interface ProviderConfig {
  key: string;
  name: string;
  model: string;
}

type TabId = 'general' | 'providers' | 'models' | 'agents' | 'automation' | 'notifications' | 'voice' | 'hotkeys' | 'about' | 'terms';

const TABS: { id: TabId; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'general',       label: 'General',       icon: <Settings size={14} />,    color: 'var(--accent-emerald)' },
  { id: 'providers',     label: 'Providers',     icon: <Wifi size={14} />,        color: 'var(--accent-cyan)' },
  { id: 'models',        label: 'Models',        icon: <Cpu size={14} />,         color: 'var(--accent-emerald)' },
  { id: 'agents',        label: 'Agents',        icon: <Bot size={14} />,         color: 'var(--accent-rose)' },
  { id: 'automation',    label: 'Automation',    icon: <Rocket size={14} />,      color: 'var(--accent-amber)' },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={14} />,        color: 'var(--accent-blue)' },
  { id: 'voice',         label: 'Voice',         icon: <Mic size={14} />,         color: 'var(--accent-violet)' },
  { id: 'hotkeys',       label: 'Hotkeys',       icon: <Keyboard size={14} />,    color: 'var(--accent-cyan)' },
  { id: 'about',         label: 'About',         icon: <Info size={14} />,        color: 'var(--accent-emerald)' },
  { id: 'terms',         label: 'Terms',         icon: <FileText size={14} />,    color: 'var(--text-muted)' },
];

// ─────────────────────────────────────────────────────────────────────
// Toggle component
// ─────────────────────────────────────────────────────────────────────
const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void; color?: string }> = ({ value, onChange, color = 'var(--accent-emerald)' }) => (
  <div
    onClick={() => onChange(!value)}
    style={{
      width: 44, height: 24, borderRadius: 12,
      background: value ? color : 'var(--neo-border)',
      cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
      flexShrink: 0,
    }}
  >
    <div style={{
      position: 'absolute', top: 3, left: value ? 23 : 3,
      width: 18, height: 18, borderRadius: '50%',
      background: 'white', transition: 'left 0.2s',
      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    }} />
  </div>
);

// ─────────────────────────────────────────────────────────────────────
// Section card
// ─────────────────────────────────────────────────────────────────────
const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{
    background: 'var(--bg-tertiary)', borderRadius: 14,
    border: '1px solid var(--neo-border)', padding: '16px 20px',
    display: 'flex', flexDirection: 'column', gap: 12, ...style,
  }}>
    {children}
  </div>
);

const Row: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...style }}>
    {children}
  </div>
);

const Label: React.FC<{ title: string; sub?: string; icon?: React.ReactNode; iconBg?: string }> = ({ title, sub, icon, iconBg }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    {icon && (
      <div style={{ padding: 8, borderRadius: 10, background: iconBg || 'var(--bg-card)', color: 'var(--text-primary)', display: 'flex' }}>
        {icon}
      </div>
    )}
    <div>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────
// HOTKEYS DATA
// ─────────────────────────────────────────────────────────────────────
const HOTKEYS = [
  { group: '🖥️ Application', keys: [
    { keys: 'Ctrl + T',            action: 'New agent tab' },
    { keys: 'Ctrl + W',            action: 'Close current tab' },
    { keys: 'Ctrl + Tab',          action: 'Switch to next tab' },
    { keys: 'Ctrl + S',            action: 'Save current agent' },
  ]},
  { group: '🤖 Agent Execution', keys: [
    { keys: 'Ctrl + Shift + R',    action: 'Run active agent' },
    { keys: 'Ctrl + Shift + S',    action: 'Stop running agent' },
    { keys: 'Ctrl + Shift + P',    action: 'Pause / Resume agent' },
    { keys: 'Ctrl + Shift + H',    action: 'Show / Hide app window' },
  ]},
  { group: '🎙️ Voice', keys: [
    { keys: 'Ctrl + Shift + V',    action: 'Start voice command (hold to record)' },
  ]},
];

// ─────────────────────────────────────────────────────────────────────
// TERMS TEXT
// ─────────────────────────────────────────────────────────────────────
const TERMS = `
Hybrid Local AI Hub Data Privacy & Security Terms

1. Data Transmission Disclosure
This application provides both online and offline capabilities. While in offline mode, core LLM interactions do not leave your device. However, you acknowledge that specific nodes (e.g., WebScraperNode, Webhooks) and online providers explicitly requested by you WILL transmit data over the network. 

2. Process Safety and Protections
The application includes safety checks to prevent accidental system damage (e.g., preventing termination of critical OS processes). However, you acknowledge that these protections are not exhaustive. The Kill Process node and ShellCommandNode run with the permissions of the user executing the app and can modify or terminate processes that are not explicitly protected. You assume all risks associated with executing automated scripts and shell commands on your system.

3. Assumption of Risk
By using this software, you assume full responsibility for any data loss, system instability, or security incidents that arise from automated actions. You agree to review generated workflows carefully before execution.
`;

// ─────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────
export const SettingsModal: React.FC = () => {
  const { isSettingsModalOpen, setSettingsModalOpen, isOfflineMode, setOfflineMode } = useSettingsStore();
  const theme = useWorkflowStore((s) => s.theme);
  const setTheme = useWorkflowStore((s) => s.setTheme);
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  const setOllamaModel = useSettingsStore((s) => s.setOllamaModel);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);
  const setOllamaUrl = useSettingsStore((s) => s.setOllamaUrl);

  const [activeTab, setActiveTab] = useState<TabId>('general');

  // Providers
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [loading, setLoading] = useState(false);

  // Automation
  const [agents, setAgents] = useState<string[]>([]);
  const [selectedStartupAgent, setSelectedStartupAgent] = useState('');
  const [schedAgent, setSchedAgent] = useState('');
  const [schedTime, setSchedTime] = useState('21:00');
  const [agentTasks, setAgentTasks] = useState<any[]>([]);
  const [automationMsg, setAutomationMsg] = useState('');
  const [runModes, setRunModes] = useState<Array<'silent' | 'notify' | 'voice'>>(['notify']);

  // Notifications
  const [notifyDesktop, setNotifyDesktop] = useState(true);
  const [notifySound, setNotifySound] = useState(true);
  const [notifyVoice, setNotifyVoice] = useState(false);
  const [voiceRate, setVoiceRate] = useState(0);
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(true);
  const [notifyOnFailure, setNotifyOnFailure] = useState(true);
  const [notifyOnNode, setNotifyOnNode] = useState(false);

  // Voice
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [alwaysListening, setAlwaysListening] = useState(false);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const [micLoading, setMicLoading] = useState(false);

  useEffect(() => {
    if (isSettingsModalOpen) {
      loadProviders();
      loadAgents();
      loadAgentTasks();
    }
  }, [isSettingsModalOpen]);

  const loadProviders = async () => {
    try { setProviders(await invoke<ProviderConfig[]>('get_providers')); } catch {}
  };

  const loadAgents = async () => {
    try { setAgents(await invoke<string[]>('list_agents', { offlineMode: true })); } catch {}
  };

  const loadAgentTasks = async () => {
    try { setAgentTasks(await invoke<any[]>('list_agent_tasks')); } catch {}
  };

  const handleAddProvider = async () => {
    if (!newLabel || !newModel || !newKey) return;
    setLoading(true);
    try {
      await invoke('save_provider', { provider: { name: newLabel, model: newModel, key: newKey } });
      setNewLabel(''); setNewModel(''); setNewKey('');
      await loadProviders();
    } catch (e) { alert('Failed to save provider: ' + String(e)); }
    finally { setLoading(false); }
  };

  const handleDeleteProvider = async (name: string) => {
    if (!window.confirm(`Delete provider ${name}?`)) return;
    try { await invoke('delete_provider', { name }); await loadProviders(); } catch (e) { alert(String(e)); }
  };

  const handleRegisterStartup = async () => {
    if (!selectedStartupAgent) return;
    try {
      const msg = await invoke<string>('register_startup_agent', { agentName: selectedStartupAgent });
      setAutomationMsg(`✅ ${msg}`);
      await loadAgentTasks();
    } catch (e) { setAutomationMsg(`❌ ${String(e)}`); }
  };

  const handleRegisterScheduled = async () => {
    if (!schedAgent || !schedTime) return;
    try {
      const msg = await invoke<string>('register_scheduled_agent', { agentName: schedAgent, time: schedTime });
      setAutomationMsg(`✅ ${msg}`);
      await loadAgentTasks();
    } catch (e) { setAutomationMsg(`❌ ${String(e)}`); }
  };

  const handleUnregisterTask = async (name: string, type: string) => {
    try {
      const msg = await invoke<string>('unregister_agent_task', { agentName: name, taskType: type });
      setAutomationMsg(`✅ ${msg}`);
      await loadAgentTasks();
    } catch (e) { setAutomationMsg(`❌ ${String(e)}`); }
  };

  const handleTestVoice = async () => {
    try {
      await invoke('speak_text', { text: 'Hybrid Hub is ready. Agent task completed successfully.', rate: voiceRate });
    } catch (e) { alert('TTS error: ' + String(e)); }
  };

  const handleTestMic = async () => {
    setMicLoading(true); setMicStatus(null);
    try {
      const result = await invoke<string>('test_microphone');
      setMicStatus(result);
    } catch (e) { setMicStatus('❌ ' + String(e)); }
    finally { setMicLoading(false); }
  };

  if (!isSettingsModalOpen) return null;

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-card)', border: '1px solid var(--neo-border)',
    color: 'var(--text-primary)', padding: '8px 12px',
    borderRadius: 8, fontSize: 13, width: '100%', outline: 'none',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle, cursor: 'pointer',
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} className="animate-fade-in">
      <div style={{
        width: 860, height: '85vh',
        background: 'var(--bg-secondary)', border: '1px solid var(--neo-border)',
        borderRadius: 20, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }} className="animate-scale-in">

        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid var(--neo-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--bg-card)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ padding: 8, background: 'var(--bg-tertiary)', borderRadius: 12 }}>
              <Settings size={20} color="var(--text-primary)" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Settings</h2>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Automation, Notifications, Voice, Hotkeys & More</span>
            </div>
          </div>
          <button onClick={() => setSettingsModalOpen(false)} className="btn btn-secondary btn-icon" style={{ borderRadius: '50%' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar Nav */}
          <div style={{
            width: 160, background: 'var(--bg-card)', borderRight: '1px solid var(--neo-border)',
            display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 2, flexShrink: 0,
          }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: 8, border: 'none',
                  background: activeTab === tab.id ? 'var(--bg-tertiary)' : 'transparent',
                  color: activeTab === tab.id ? tab.color : 'var(--text-muted)',
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  fontSize: 13, cursor: 'pointer', textAlign: 'left', width: '100%',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ color: activeTab === tab.id ? tab.color : 'var(--text-muted)', display: 'flex' }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── GENERAL ── */}
            {activeTab === 'general' && (<>
              <Card>
                <Row>
                  <Label title="Offline / Air-Gapped Mode" sub="Disable all internet features" icon={isOfflineMode ? <WifiOff size={18}/> : <Wifi size={18}/>} iconBg="rgba(16,185,129,0.15)" />
                  <Toggle value={isOfflineMode} onChange={setOfflineMode} color="var(--accent-emerald)" />
                </Row>
              </Card>
              <Card>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, marginBottom: 4 }}>Ollama URL</div>
                <input style={inputStyle} value={ollamaUrl} onChange={e => setOllamaUrl(e.target.value)} placeholder="http://localhost:11434" />
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, marginTop: 4 }}>Default Model</div>
                <input style={inputStyle} value={ollamaModel} onChange={e => setOllamaModel(e.target.value)} placeholder="llama3.2" />
              </Card>
              <Card>
                <Row>
                  <Label title="Application Theme" sub="Toggle Dark / Light mode" icon={theme === 'dark' ? <Moon size={18}/> : <Sun size={18}/>} iconBg="rgba(59,130,246,0.15)" />
                  <button className="btn btn-secondary" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} style={{ minWidth: 100, justifyContent: 'center' }}>
                    {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                  </button>
                </Row>
              </Card>
            </>)}

            {/* ── PROVIDERS ── */}
            {activeTab === 'providers' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, opacity: isOfflineMode ? 0.5 : 1, pointerEvents: isOfflineMode ? 'none' : 'auto' }}>
                {isOfflineMode && (
                  <div style={{ padding: 12, background: 'rgba(244,63,94,0.1)', color: 'var(--accent-rose)', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={16} /> Online providers are disabled in Air-Gapped mode.
                  </div>
                )}
                {providers.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>No providers configured yet.</div>
                ) : providers.map(p => (
                  <Card key={p.name}>
                    <Row>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.model}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ color: 'var(--accent-emerald)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={14} /> Active</span>
                        <button onClick={() => handleDeleteProvider(p.name)} className="btn btn-icon" style={{ color: 'var(--accent-rose)' }}><Trash2 size={16} /></button>
                      </div>
                    </Row>
                  </Card>
                ))}
                <Card>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>Add New Provider</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input style={{ ...inputStyle, flex: 1 }} placeholder="Provider Name" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
                    <input style={{ ...inputStyle, flex: 1 }} placeholder="Model ID" value={newModel} onChange={e => setNewModel(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="password" style={{ ...inputStyle, flex: 1 }} placeholder="API Key (sk-...)" value={newKey} onChange={e => setNewKey(e.target.value)} />
                    <button className="btn btn-primary" onClick={handleAddProvider} disabled={loading || !newLabel || !newModel || !newKey} style={{ padding: '0 20px', whiteSpace: 'nowrap' }}>
                      <Plus size={14} /> Add
                    </button>
                  </div>
                </Card>
              </div>
            )}

            {/* ── MODELS ── */}
            {activeTab === 'models' && <ModelManager />}

            {/* ── AGENTS ── */}
            {activeTab === 'agents' && <SavedAgentsPanel />}

            {/* ── AUTOMATION ── */}
            {activeTab === 'automation' && (<>
              {automationMsg && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: automationMsg.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)', color: automationMsg.startsWith('✅') ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontSize: 13 }}>
                  {automationMsg}
                </div>
              )}

              <Card>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Rocket size={16} color="var(--accent-amber)" /> Run Agent on System Startup
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  The selected agent will run automatically every time Windows starts — even without opening this app.
                </div>
                <Row>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Agent to run at startup:</div>
                  <select style={{ ...selectStyle, width: 220 }} value={selectedStartupAgent} onChange={e => setSelectedStartupAgent(e.target.value)}>
                    <option value="">-- Select Agent --</option>
                    {agents.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Row>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" onClick={handleRegisterStartup} disabled={!selectedStartupAgent} style={{ flex: 1, justifyContent: 'center' }}>
                    <Rocket size={14} /> Register Startup Agent
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleUnregisterTask(selectedStartupAgent, 'startup')} disabled={!selectedStartupAgent} style={{ flex: 1, justifyContent: 'center' }}>
                    <Square size={14} /> Remove from Startup
                  </button>
                </div>
              </Card>

              <Card>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={16} color="var(--accent-blue)" /> Schedule Agent (Daily)
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Run an agent every day at a specific time, even if the app is closed.
                </div>
                <Row>
                  <select style={{ ...selectStyle, flex: 1 }} value={schedAgent} onChange={e => setSchedAgent(e.target.value)}>
                    <option value="">-- Select Agent --</option>
                    {agents.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <span style={{ color: 'var(--text-muted)', margin: '0 8px', fontSize: 13 }}>at</span>
                  <input type="time" style={{ ...inputStyle, width: 120 }} value={schedTime} onChange={e => setSchedTime(e.target.value)} />
                </Row>
                <button className="btn btn-primary" onClick={handleRegisterScheduled} disabled={!schedAgent || !schedTime} style={{ justifyContent: 'center' }}>
                  <Calendar size={14} /> Schedule Daily Run
                </button>
              </Card>

              <Card>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Terminal size={16} color="var(--accent-violet)" /> Background Run Mode
                </div>
                {(['silent', 'notify', 'voice'] as const).map(mode => (
                  <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                    <input 
                      type="checkbox" 
                      name={`runMode_${mode}`} 
                      checked={runModes.includes(mode)} 
                      onChange={(e) => {
                        if (e.target.checked) {
                          setRunModes([...runModes, mode]);
                        } else {
                          setRunModes(runModes.filter(m => m !== mode));
                        }
                      }} 
                      style={{ accentColor: 'var(--accent-emerald)' }} 
                    />
                    {mode === 'silent' && 'Silent - no window, runs in background'}
                    {mode === 'notify' && 'With desktop notification when done'}
                    {mode === 'voice' && 'With voice announcement when done'}
                  </label>
                ))}
              </Card>

              <Card>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <RefreshCw size={16} color="var(--accent-cyan)" /> Registered Tasks
                </div>
                {agentTasks.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>No scheduled agent tasks registered yet.</div>
                ) : agentTasks.map((t: any, i) => (
                  <Row key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--neo-border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t.TaskName || t['Task Name'] || 'Unknown'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Next run: {t.NextRun || '—'}</div>
                    </div>
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(16,185,129,0.1)', color: 'var(--accent-emerald)' }}>
                      {t.Status || 'Active'}
                    </span>
                  </Row>
                ))}
              </Card>
            </>)}

            {/* ── NOTIFICATIONS ── */}
            {activeTab === 'notifications' && (<>
              <Card>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14, marginBottom: 4 }}>Notification Channels</div>
                <Row>
                  <Label title="Desktop Popup" sub="Show a Windows toast notification when agent completes" icon={<Bell size={16}/>} iconBg="rgba(59,130,246,0.12)" />
                  <Toggle value={notifyDesktop} onChange={setNotifyDesktop} color="var(--accent-blue)" />
                </Row>
                <Row>
                  <Label title="Notification Sound" sub="Play a system sound when done" icon={<Volume2 size={16}/>} iconBg="rgba(16,185,129,0.12)" />
                  <Toggle value={notifySound} onChange={setNotifySound} color="var(--accent-emerald)" />
                </Row>
              </Card>

              <Card>
                <Row>
                  <Label title="Voice Announcement (TTS)" sub="Windows SAPI — speaks result aloud when done (100% offline)" icon={<Mic size={16}/>} iconBg="rgba(139,92,246,0.12)" />
                  <Toggle value={notifyVoice} onChange={setNotifyVoice} color="var(--accent-violet)" />
                </Row>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: notifyVoice ? 1 : 0.4, pointerEvents: notifyVoice ? 'auto' : 'none' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Speed:</span>
                  <input type="range" min={-5} max={5} step={1} value={voiceRate} onChange={e => setVoiceRate(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent-violet)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 50 }}>{voiceRate === 0 ? 'Normal' : voiceRate > 0 ? `+${voiceRate} Fast` : `${voiceRate} Slow`}</span>
                  <button className="btn btn-secondary" onClick={handleTestVoice} style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    <Volume2 size={13} /> Test
                  </button>
                </div>
              </Card>

              <Card>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14, marginBottom: 4 }}>Notify On</div>
                {[
                  { key: 'success', label: 'Agent completed successfully', value: notifyOnSuccess, set: setNotifyOnSuccess },
                  { key: 'failure', label: 'Agent failed with error', value: notifyOnFailure, set: setNotifyOnFailure },
                  { key: 'node',    label: 'Each individual node completion', value: notifyOnNode,    set: setNotifyOnNode },
                ].map(item => (
                  <Row key={item.key}>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{item.label}</span>
                    <Toggle value={item.value} onChange={item.set} />
                  </Row>
                ))}
              </Card>
            </>)}

            {/* ── VOICE ── */}
            {activeTab === 'voice' && (<>
              <Card>
                <Row>
                  <Label title="Voice Commands" sub="Use Whisper.cpp — medium model (ideal for 8GB RAM). 100% offline, free." icon={<Mic size={16}/>} iconBg="rgba(139,92,246,0.12)" />
                  <Toggle value={voiceEnabled} onChange={setVoiceEnabled} color="var(--accent-violet)" />
                </Row>
              </Card>

              <Card style={{ opacity: voiceEnabled ? 1 : 0.5, pointerEvents: voiceEnabled ? 'auto' : 'none' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>Engine: Whisper.cpp</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Model: <strong>medium</strong> — ~2.6 GB RAM usage, excellent accuracy, free (MIT license)
                </div>
                <Row>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Model file path:</span>
                  <input style={{ ...inputStyle, width: 260, fontSize: 11 }} placeholder="C:\...\whisper-medium.bin" />
                </Row>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}>📥 Download Model</button>
                  <button className="btn btn-secondary" onClick={handleTestMic} disabled={micLoading} style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}>
                    {micLoading ? <RefreshCw size={13} className="animate-spin" /> : <Mic size={13} />} Test Microphone
                  </button>
                </div>
                {micStatus && (
                  <div style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, background: micStatus.startsWith('❌') ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)', color: micStatus.startsWith('❌') ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                    {micStatus}
                  </div>
                )}
              </Card>

              <Card style={{ opacity: voiceEnabled ? 1 : 0.5, pointerEvents: voiceEnabled ? 'auto' : 'none' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>Activation</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <kbd style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--neo-border)', fontFamily: 'monospace', fontSize: 12 }}>Ctrl + Shift + V</kbd>
                  Hold to record, release to process
                </div>
                <Row>
                  <Label title="Always-On Background Listening" sub='Wake word: "Hey Hub"' />
                  <Toggle value={alwaysListening} onChange={setAlwaysListening} color="var(--accent-violet)" />
                </Row>
              </Card>

              <Card style={{ opacity: voiceEnabled ? 1 : 0.5, pointerEvents: voiceEnabled ? 'auto' : 'none' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, marginBottom: 8 }}>Voice Commands Reference</div>
                {[
                  ['"Open [app name]"',   '→ Opens the specified app'],
                  ['"Close [app name]"',  '→ Closes the specified app'],
                  ['"Run [agent name]"',  '→ Runs a saved agent'],
                  ['"Stop agent"',        '→ Stops the running agent'],
                  ['"Show Hub"',          '→ Brings the app window to front'],
                ].map(([cmd, desc]) => (
                  <div key={cmd} style={{ display: 'flex', gap: 12, fontSize: 12, alignItems: 'flex-start' }}>
                    <kbd style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--neo-border)', fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>{cmd}</kbd>
                    <span style={{ color: 'var(--text-muted)', paddingTop: 2 }}>{desc}</span>
                  </div>
                ))}
              </Card>
            </>)}

            {/* ── HOTKEYS ── */}
            {activeTab === 'hotkeys' && (<>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 4px' }}>
                These shortcuts work while the app window is focused. Global shortcuts (marked 🌐) work even when the app is minimized.
              </div>
              {HOTKEYS.map(group => (
                <Card key={group.group}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>{group.group}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {group.keys.map(item => (
                      <Row key={item.keys}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.action}</span>
                        <kbd style={{ padding: '3px 10px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--neo-border)', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                          {item.keys}
                        </kbd>
                      </Row>
                    ))}
                  </div>
                </Card>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Restore Defaults</button>
              </div>
            </>)}

            {/* ── ABOUT ── */}
            {activeTab === 'about' && (<>
              <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>🤖</div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Hybrid Local AI Hub</h2>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Version 1.0.0</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 12 }}>
                  {['100% Offline', 'Privacy First', 'No Cloud'].map(tag => (
                    <span key={tag} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'rgba(16,185,129,0.1)', color: 'var(--accent-emerald)', fontWeight: 600 }}>{tag}</span>
                  ))}
                </div>
              </div>

              <Card>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>⌨️ Quick Hotkey Reference</div>
                {HOTKEYS.flatMap(g => g.keys).map(item => (
                  <Row key={item.keys} style={{ paddingBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.action}</span>
                    <kbd style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--neo-border)', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{item.keys}</kbd>
                  </Row>
                ))}
              </Card>

              <Card>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>🛡️ Built With (Open Source)</div>
                {['Tauri + Rust', 'React + TypeScript', 'Ollama (Local LLMs)', 'Whisper.cpp (Offline Speech)', 'React Flow', 'Lucide Icons', 'sysinfo crate'].map(lib => (
                  <div key={lib} style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Heart size={11} color="var(--accent-rose)" /> {lib}
                  </div>
                ))}
              </Card>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setActiveTab('terms')} style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}>
                  <FileText size={13} /> View Terms & Conditions
                </button>
              </div>
            </>)}

            {/* ── TERMS ── */}
            {activeTab === 'terms' && (
              <Card style={{ gap: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={16} color="var(--accent-emerald)" /> Terms & Conditions
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Last Updated: October 2026</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                  {TERMS}
                </div>
              </Card>
            )}

          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', background: 'var(--bg-card)', borderTop: '1px solid var(--neo-border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={() => setSettingsModalOpen(false)} style={{ minWidth: 120, justifyContent: 'center' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
