import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkflowStore } from '../store/workflowStore';
import { Cpu, Download, CheckCircle, AlertCircle, Loader2, RefreshCw, X, StopCircle } from 'lucide-react';

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
      const list = await invoke<ModelInfo[]>('list_models', {});
      setModels(list);
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
      await invoke('pull_model', { modelName });
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
    <div style={{ width: 420, background: 'rgba(15, 23, 42, 0.95)', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Cpu size={18} style={{ color: '#10b981' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>Local Model Manager</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={fetchModels} title="Refresh" style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex' }}>
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          </button>
          <button onClick={() => setActivePanel('none')} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {error && (
          <div style={{ padding: 10, background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 6, color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={14} />{error}
          </div>
        )}

        {/* Pull progress */}
        {pullingModel && (
          <div style={{ padding: 14, background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: 10 }}>
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
            <div style={{ height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
              {progressPercent !== null ? (
                <div style={{ height: '100%', width: `${progressPercent}%`, background: 'linear-gradient(90deg, #0ea5e9, #38bdf8)', borderRadius: 99, transition: 'width 0.3s ease' }} />
              ) : (
                <div className="progress-bar-shimmer" style={{ height: '100%', borderRadius: 99 }} />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 11 }}>
              <span>{pullStatus}</span>
              {pullProgress && <span>{formatBytes(pullProgress.completed)} / {formatBytes(pullProgress.total)}{progressPercent !== null && ` (${progressPercent}%)`}</span>}
            </div>
          </div>
        )}

        {/* Installed */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 10 }}>Installed in Ollama ({models.length})</div>
          {models.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 12, fontStyle: 'italic' }}>No models detected. Pull one from below.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {models.map((m) => (
                <div key={m.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: '#f8fafc', fontFamily: 'monospace' }}>{m.name}</span>
                  <span style={{ color: '#64748b', fontSize: 11 }}>{formatSize(m.size)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recommended */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 10 }}>Recommended for 8GB RAM</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {RECOMMENDED_MODELS.map((rec) => {
              const installed = isInstalled(rec.name);
              return (
                <div key={rec.name} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ maxWidth: 260 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, color: '#38bdf8', fontSize: 12 }}>{rec.name}</span>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(56,189,248,0.15)', color: '#38bdf8' }}>{rec.tag}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{rec.desc}</div>
                  </div>
                  {installed ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#10b981', fontSize: 11 }}><CheckCircle size={14} /> Ready</span>
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
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 6 }}>Pull Custom Model</div>
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
