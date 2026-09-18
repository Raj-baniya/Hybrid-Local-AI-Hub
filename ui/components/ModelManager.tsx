import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkflowStore } from '../store/workflowStore';
import { Cpu, Download, CheckCircle, AlertCircle, Loader2, RefreshCw, X, StopCircle, Trash2 } from 'lucide-react';

type OllamaStatus =
  | { state: "NotRunning" }
  | { state: "NoModels" }
  | { state: "Ready"; models: ModelInfo[] };

interface ModelInfo {
  name: string;
  size?: number;
}

interface PullProgressPayload {
  model: string;
  status: string;
  completed?: number;
  total?: number;
}

const RECOMMENDED_MODELS = [
  { name: 'llama3.2', desc: 'Default versatile all-rounder (3B Q4, ~2GB VRAM)', tag: 'Recommended' },
  { name: 'phi4-mini', desc: 'Fastest generation (~28 tok/s, 3.8B parameters)', tag: 'Fastest' },
  { name: 'qwen3:4b', desc: 'Best reasoning quality for complex graph translation', tag: 'Best Reasoning' },
  { name: 'nomic-embed-text', desc: 'High-performance local embeddings for ChromaDB (~270MB)', tag: 'Embeddings' },
  { name: 'gemma2:2b', desc: 'Ultra-lightweight fallback for constrained systems', tag: 'Lightest' },
];

export const ModelManager: React.FC = () => {
  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);

  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullStatus, setPullStatus] = useState<string>('');
  const [pullProgress, setPullProgress] = useState<{ completed: number; total: number } | null>(null);
  const [customModel, setCustomModel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await invoke<OllamaStatus>('cmd_check_ollama', {});
      setStatus(s);
      if (s.state === 'Ready') {
        setModels(s.models);
      } else {
        setModels([]);
      }
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to list Ollama models');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();

    const unlisten = listen<PullProgressPayload>('pull-progress', (event) => {
      const { status, completed, total } = event.payload;
      setPullStatus(status);
      if (completed !== undefined && total !== undefined && total > 0) {
        setPullProgress({ completed, total });
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handlePull = async (modelName: string) => {
    if (!modelName.trim()) return;
    setPullingModel(modelName);
    setPullStatus('Starting download...');
    setPullProgress(null);
    setError(null);
    try {
      await invoke('pull_model', { modelName: modelName });
      setPullStatus('Model successfully pulled!');
      await fetchModels();
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err.message || 'Failed to pull model';
      if (!msg.includes('cancelled')) setError(msg);
    } finally {
      setPullingModel(null);
      setPullProgress(null);
    }
  };

  const handleCancel = async () => {
    if (!pullingModel) return;
    try { await invoke('cancel_pull', { modelName: pullingModel }); } catch (_) {}
  };

  const handleDelete = async (modelName: string) => {
    if (!confirm(`Are you sure you want to delete the model '${modelName}' from your device?`)) return;
    setLoading(true);
    try {
      await invoke('delete_model', { modelName });
      await fetchModels();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to delete model');
    } finally {
      setLoading(false);
    }
  };

  const isInstalled = (name: string) => models.some((m) => m.name.startsWith(name) || m.name === name);
  const formatSize = (bytes?: number) => {
    if (!bytes) return '—';
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };
  const formatBytes = (n: number) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
    return `${(n / 1e3).toFixed(0)} KB`;
  };

  const progressPercent = pullProgress
    ? Math.min(100, Math.round((pullProgress.completed / pullProgress.total) * 100))
    : null;

  return (
    <div
      className="animate-slide-in-right"
      style={{
        width: '100%',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >  {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Cpu size={18} style={{ color: 'var(--accent-emerald)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Local Model Manager</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={fetchModels} title="Refresh" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          </button>
          <button onClick={() => setActivePanel('none')} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {status?.state === 'NotRunning' && (
          <div style={{ padding: 14, background: 'rgba(244,63,94,0.07)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fb7185', fontWeight: 600 }}>
              <AlertCircle size={16} /> Ollama is not running
            </div>
            <div>
              <ol style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <li>Install it from <a href="https://ollama.com/download" target="_blank" style={{ color: 'var(--accent-cyan)' }}>ollama.com/download</a></li>
                <li>Run <code style={{ background: 'var(--bg-secondary)', padding: '2px 4px', borderRadius: 4 }}>ollama serve</code> in a terminal</li>
              </ol>
            </div>
          </div>
        )}

        {status?.state === 'NoModels' && (
          <div style={{ padding: 14, background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#facc15', fontWeight: 600 }}>
              <AlertCircle size={16} /> No models installed
            </div>
            <div>Ollama is running, but no models are installed. Please pull one from the recommendations below to begin.</div>
          </div>
        )}

        {error && (
          <div style={{ padding: 10, background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 6, color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={14} />{error}
          </div>
        )}

        {/* Pull progress */}
        {pullingModel && (
          <div style={{ padding: 14, background: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8', fontWeight: 600, fontSize: 12 }}>
                <Loader2 size={14} className="spinning" />
                Pulling {pullingModel}
              </div>
              <button onClick={handleCancel} title="Cancel download" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 5, color: '#f87171', fontSize: 11, fontWeight: 600, padding: '3px 8px', cursor: 'pointer' }}>
                <StopCircle size={12} /> Cancel
              </button>
            </div>
            {/* Progress bar */}
            <div style={{ height: 6, background: 'var(--border-subtle)', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
              {progressPercent !== null ? (
                <div style={{ height: '100%', width: `${progressPercent}%`, background: 'var(--accent-cyan)', borderRadius: 99, transition: 'width 0.3s ease' }} />
              ) : (
                <div className="progress-bar-shimmer" style={{ height: '100%', borderRadius: 99 }} />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: 11 }}>
              <span>{pullStatus}</span>
              {pullProgress && <span>{formatBytes(pullProgress.completed)} / {formatBytes(pullProgress.total)}{progressPercent !== null && ` (${progressPercent}%)`}</span>}
            </div>
          </div>
        )}

        {/* Installed */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Installed in Ollama ({models.length})</div>
          {models.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>No models detected. Pull one from below.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {models.map((m) => (
                <div key={m.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{m.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{formatSize(m.size)}</span>
                    <button 
                      onClick={() => handleDelete(m.name)} 
                      title="Delete Model"
                      style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', display: 'flex' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recommended */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Recommended for 8GB RAM</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {RECOMMENDED_MODELS.map((rec) => {
              const installed = isInstalled(rec.name);
              return (
                <div key={rec.name} style={{ padding: '10px 12px', background: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ maxWidth: 260 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace' }}>{rec.name}</span>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(56,189,248,0.15)', color: 'var(--accent-cyan)' }}>{rec.tag}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{rec.desc}</div>
                  </div>
                  {installed ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-emerald)', fontSize: 11, fontWeight: 600 }}><CheckCircle size={14} /> Ready</span>
                  ) : (
                    <button className="btn btn-secondary" style={{ padding: '5px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => handlePull(rec.name)} disabled={!!pullingModel}>
                      <Download size={12} /> Pull
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Custom */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Pull Custom Model</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" placeholder="e.g. mistral:7b" value={customModel} onChange={(e) => setCustomModel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handlePull(customModel)}
              style={{ flex: 1, padding: '7px 10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f8fafc', fontSize: 12 }} />
            <button className="btn btn-primary" onClick={() => handlePull(customModel)} disabled={!customModel.trim() || !!pullingModel}>Pull</button>
          </div>
        </div>
      </div>
    </div>
  );
};

