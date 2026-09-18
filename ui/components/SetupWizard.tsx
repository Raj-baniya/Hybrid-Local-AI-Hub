import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Cpu, Download, CheckCircle, AlertCircle, Loader2, ExternalLink, Zap, Star, HardDrive, Monitor, ChevronRight, Sparkles } from 'lucide-react';

// ——— Types ———

type OllamaStatus =
  | { state: "NotRunning" }
  | { state: "NoModels" }
  | { state: "Ready"; models: { name: string; size?: number }[] };

interface SystemInfo {
  totalRamGb: number;
  gpuName: string | null;
  gpuVramGb: number | null;
  osName: string;
  cpuCores: number;
}

interface PullProgressPayload {
  model: string;
  status: string;
  completed?: number;
  total?: number;
}

interface ModelRecommendation {
  name: string;
  desc: string;
  sizeLabel: string;
  speedRating: number; // 1-5
  qualityRating: number; // 1-5
  tag: string;
  isBest: boolean;
  isEmbedding?: boolean;
}

// ——— Model recommendation logic ———

function getRecommendations(info: SystemInfo): ModelRecommendation[] {
  const hasGpu = info.gpuVramGb && info.gpuVramGb >= 4;
  const effectiveRam = hasGpu ? info.totalRamGb + (info.gpuVramGb || 0) : info.totalRamGb;

  const models: ModelRecommendation[] = [];

  if (effectiveRam <= 4) {
    models.push({ name: 'gemma2:2b', desc: 'Ultra-lightweight — the only LLM that fits in 4GB RAM', sizeLabel: '~1.6 GB', speedRating: 5, qualityRating: 2, tag: 'Only Option', isBest: true });
  } else if (effectiveRam <= 8) {
    models.push({ name: 'qwen2.5-coder:3b', desc: 'Best JSON/code quality at this size — excellent for graph generation', sizeLabel: '~2 GB', speedRating: 4, qualityRating: 4, tag: 'Best for You', isBest: true });
    models.push({ name: 'llama3.2', desc: 'Fast all-rounder, great for quick drafts', sizeLabel: '~2 GB', speedRating: 5, qualityRating: 3, tag: 'Fastest', isBest: false });
  } else if (effectiveRam <= 16) {
    models.push({ name: 'qwen2.5-coder:7b', desc: 'Premium quality — near-perfect JSON on first try', sizeLabel: '~4.7 GB', speedRating: 3, qualityRating: 5, tag: 'Best for You', isBest: true });
    models.push({ name: 'qwen2.5-coder:3b', desc: 'Faster alternative with great quality', sizeLabel: '~2 GB', speedRating: 4, qualityRating: 4, tag: 'Fast', isBest: false });
    models.push({ name: 'llama3.2', desc: 'Ultra-fast all-rounder', sizeLabel: '~2 GB', speedRating: 5, qualityRating: 3, tag: 'Fastest', isBest: false });
  } else {
    models.push({ name: 'qwen2.5-coder:14b', desc: 'Top-tier quality — handles the most complex multi-node graphs flawlessly', sizeLabel: '~9 GB', speedRating: 2, qualityRating: 5, tag: 'Best for You', isBest: true });
    models.push({ name: 'qwen2.5-coder:7b', desc: 'Excellent balance of speed and quality', sizeLabel: '~4.7 GB', speedRating: 3, qualityRating: 5, tag: 'Balanced', isBest: false });
    models.push({ name: 'llama3.2', desc: 'Ultra-fast for quick iterations', sizeLabel: '~2 GB', speedRating: 5, qualityRating: 3, tag: 'Fastest', isBest: false });
  }

  // Always recommend embedding model
  models.push({ name: 'nomic-embed-text', desc: 'Required for vector embeddings & ChromaDB pipelines', sizeLabel: '~270 MB', speedRating: 5, qualityRating: 5, tag: 'Embeddings', isBest: false, isEmbedding: true });

  return models;
}

// ——— Styles ———

const wizardOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9999,
  background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.8) 0%, rgba(30, 41, 59, 0.9) 100%)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: "'Inter', 'Segoe UI', sans-serif",
};

const wizardCard: React.CSSProperties = {
  width: 560, maxHeight: '90vh', overflowY: 'auto',
  padding: 0,
  position: 'relative', zIndex: 10,
};

const headerStyle: React.CSSProperties = {
  padding: '28px 32px 20px',
  borderBottom: '1px solid var(--border-subtle)',
};

const bodyStyle: React.CSSProperties = {
  padding: '24px 32px 28px',
  display: 'flex', flexDirection: 'column', gap: 16,
};

const stepIndicator: React.CSSProperties = {
  display: 'flex', gap: 8, marginBottom: 4,
};

// ——— Component ———

export const SetupWizard: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullStatus, setPullStatus] = useState('');
  const [pullProgress, setPullProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check Ollama status
  const checkOllama = useCallback(async () => {
    try {
      const s = await invoke<OllamaStatus>('cmd_check_ollama', {});
      setOllamaStatus(s);
      if (s.state === 'Ready') {
        setInstalledModels(s.models.map(m => m.name));
        setStep(3); // Already has models → skip to ready
      } else if (s.state === 'NoModels') {
        setInstalledModels([]);
        setStep(2); // Ollama running but no models
      }
      // If NotRunning, stay on step 1
    } catch {
      setOllamaStatus({ state: 'NotRunning' });
    }
  }, []);

  // Fetch system info
  const fetchSystemInfo = useCallback(async () => {
    try {
      const info = await invoke<SystemInfo>('cmd_system_info');
      setSystemInfo(info);
    } catch {
      // Fallback
      setSystemInfo({ totalRamGb: 8, gpuName: null, gpuVramGb: null, osName: 'Unknown', cpuCores: 4 });
    }
  }, []);

  // Initial check + system info
  useEffect(() => {
    checkOllama();
    fetchSystemInfo();
  }, [checkOllama, fetchSystemInfo]);

  // Auto-poll for Ollama every 5 seconds on step 1
  useEffect(() => {
    if (step !== 1) return;
    const interval = setInterval(checkOllama, 5000);
    return () => clearInterval(interval);
  }, [step, checkOllama]);

  // Listen for pull progress
  useEffect(() => {
    const unlisten = listen<PullProgressPayload>('pull-progress', (event) => {
      const { status, completed, total } = event.payload;
      setPullStatus(status);
      if (completed !== undefined && total !== undefined && total > 0) {
        setPullProgress({ completed, total });
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const handlePull = async (modelName: string) => {
    if (!modelName.trim()) return;
    setPullingModel(modelName);
    setPullStatus('Starting download...');
    setPullProgress(null);
    setError(null);
    try {
      await invoke('pull_model', { modelName });
      setPullStatus('Done!');
      setInstalledModels(prev => [...prev, modelName]);
      // Re-check Ollama status
      await checkOllama();
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err.message || 'Failed to pull model';
      if (!msg.includes('cancelled')) setError(msg);
    } finally {
      setPullingModel(null);
      setPullProgress(null);
    }
  };

  const isInstalled = (name: string) => installedModels.some(m => m.startsWith(name) || m === name);
  const hasAnyLlm = installedModels.some(m => !m.includes('embed'));

  const progressPercent = pullProgress
    ? Math.min(100, Math.round((pullProgress.completed / pullProgress.total) * 100))
    : null;

  const formatBytes = (n: number) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
    return `${(n / 1e3).toFixed(0)} KB`;
  };

  const recommendations = systemInfo ? getRecommendations(systemInfo) : [];

  const handleComplete = () => {
    localStorage.setItem('onboarding_complete', 'true');
    onComplete();
  };

  // ——— Step indicators ———
  const StepDots = () => (
    <div style={stepIndicator}>
      {[1, 2, 3].map(s => (
        <div key={s} style={{
          width: s === step ? 24 : 8, height: 8, borderRadius: 4,
          background: s === step ? 'var(--accent-cyan)' : s < step ? 'var(--accent-emerald)' : 'var(--border-subtle)',
          transition: 'all 0.3s ease',
        }} />
      ))}
    </div>
  );

  // ——— Rating dots ———
  const RatingDots = ({ rating, color }: { rating: number; color: string }) => (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: i <= rating ? color : 'var(--border-subtle)',
        }} />
      ))}
    </div>
  );

  return (
    <div style={wizardOverlay} className="wizard-overlay">
      {/* Background animated glows */}
      <div className="pulse-glow" style={{
        position: 'absolute', width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(6,182,212,0.15) 0%, transparent 70%)',
        top: '10%', left: '20%', filter: 'blur(80px)', animation: 'pulse 4s ease-in-out infinite',
        pointerEvents: 'none', zIndex: 0,
      }} />
      <div className="floatBlob-glow" style={{
        position: 'absolute', width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)',
        bottom: '10%', right: '20%', filter: 'blur(80px)', animation: 'floatBlob 8s ease-in-out infinite',
        pointerEvents: 'none', zIndex: 0,
      }} />

      <div style={wizardCard} className="wizard-card glass-panel animate-slide-in-right">
        {/* ——— STEP 1: Ollama Check ——— */}
        {step === 1 && (
          <>
            <div style={headerStyle}>
              <StepDots />
              <h1 style={{ margin: '12px 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
                Welcome to Hybrid Local AI Hub
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Let's get your local AI environment set up
              </p>
            </div>
            <div style={bodyStyle}>
              {ollamaStatus?.state === 'NotRunning' ? (
                <>
                  <div className="glass-card animate-stagger-1" style={{
                    padding: 16,
                    border: '1px solid rgba(234,179,8,0.25)',
                    display: 'flex', flexDirection: 'column', gap: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#facc15', fontWeight: 600, fontSize: 14 }}>
                      <AlertCircle size={18} /> Ollama is not detected
                    </div>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
                      Hybrid Local AI Hub requires <strong>Ollama</strong> to run AI models locally on your device.
                      It's free, lightweight, and takes about 2 minutes to install.
                    </p>
                    <a
                      href="https://ollama.com/download"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-wizard-download"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '10px 16px', background: 'linear-gradient(135deg, #06b6d4, #0ea5e9)',
                        color: '#fff', borderRadius: 8, textDecoration: 'none',
                        fontWeight: 600, fontSize: 13, width: 'fit-content',
                      }}
                    >
                      <Download size={16} /> Download Ollama <ExternalLink size={12} />
                    </a>
                  </div>

                  <div className="glass-card animate-stagger-2" style={{
                    padding: 14,
                  }}>
                    <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                      After installing:
                    </p>
                    <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-primary)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <li>Open a terminal / command prompt</li>
                      <li>Run <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12 }}>ollama serve</code></li>
                      <li>Come back here — this screen will update automatically</li>
                    </ol>
                  </div>

                  <div className="animate-stagger-3" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12, justifyContent: 'center' }}>
                    <Loader2 size={14} className="spinning" /> Waiting for Ollama to start...
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontSize: 14, fontWeight: 600 }}>
                  <CheckCircle size={18} /> Ollama detected! Loading...
                </div>
              )}
            </div>
          </>
        )}

        {/* ——— STEP 2: Model Setup ——— */}
        {step === 2 && (
          <>
            <div style={headerStyle}>
              <StepDots />
              <h1 style={{ margin: '12px 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
                Choose Your AI Model
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                We've analyzed your hardware and picked the best models for your device
              </p>
            </div>
            <div style={bodyStyle}>
              {/* System specs card */}
              {systemInfo && (
                <div className="glass-card animate-stagger-1" style={{
                  padding: 14,
                  display: 'flex', flexWrap: 'wrap', gap: 16,
                  border: '1px solid rgba(6,182,212,0.15)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <HardDrive size={14} style={{ color: 'var(--accent-cyan)' }} />
                    <span><strong style={{ color: 'var(--text-primary)' }}>{systemInfo.totalRamGb.toFixed(1)} GB</strong> RAM</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <Cpu size={14} style={{ color: 'var(--accent-cyan)' }} />
                    <span><strong style={{ color: 'var(--text-primary)' }}>{systemInfo.cpuCores}</strong> CPU cores</span>
                  </div>
                  {systemInfo.gpuName && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <Monitor size={14} style={{ color: 'var(--accent-cyan)' }} />
                      <span style={{ color: 'var(--text-primary)' }}>{systemInfo.gpuName}</span>
                      {systemInfo.gpuVramGb && <span>({systemInfo.gpuVramGb.toFixed(1)} GB)</span>}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span>{systemInfo.osName}</span>
                  </div>
                </div>
              )}

              {/* Pull progress */}
              {pullingModel && (
                <div className="glass-card animate-stagger-2" style={{
                  padding: 14,
                  border: '1px solid rgba(56,189,248,0.25)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8', fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
                    <Loader2 size={14} className="spinning" /> Downloading {pullingModel}...
                  </div>
                  <div style={{ height: 6, background: 'var(--border-subtle)', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
                    {progressPercent !== null ? (
                      <div style={{ height: '100%', width: `${progressPercent}%`, background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-cyan))', borderRadius: 99, transition: 'width 0.3s ease' }} />
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

              {error && (
                <div style={{ padding: 10, background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 6, color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={14} />{error}
                </div>
              )}

              {/* Model cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recommendations.map(rec => {
                  const installed = isInstalled(rec.name);
                  return (
                    <div key={rec.name} className="glass-card animate-stagger-3" style={{
                      padding: '14px 16px',
                      background: rec.isBest ? 'rgba(6,182,212,0.08)' : undefined,
                      border: rec.isBest ? '1px solid rgba(6,182,212,0.25)' : undefined,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          {rec.isBest && <Star size={14} style={{ color: 'var(--accent-amber)', fill: 'var(--accent-amber)' }} />}
                          <span style={{ fontWeight: 700, color: rec.isBest ? 'var(--accent-cyan)' : 'var(--text-primary)', fontSize: 13, fontFamily: 'monospace' }}>{rec.name}</span>
                          <span style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 4,
                            background: rec.isBest ? 'rgba(6,182,212,0.2)' : 'var(--border-subtle)',
                            color: rec.isBest ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                          }}>{rec.tag}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{rec.sizeLabel}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>{rec.desc}</div>
                        {!rec.isEmbedding && (
                          <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--text-muted)' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Zap size={10} /> Speed <RatingDots rating={rec.speedRating} color="#10b981" />
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Sparkles size={10} /> Quality <RatingDots rating={rec.qualityRating} color="#06b6d4" />
                            </span>
                          </div>
                        )}
                      </div>
                      <div style={{ marginLeft: 12, flexShrink: 0 }}>
                        {installed ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#10b981', fontSize: 12, fontWeight: 600 }}>
                            <CheckCircle size={16} /> Ready
                          </span>
                        ) : (
                          <button
                            onClick={() => handlePull(rec.name)}
                            disabled={!!pullingModel}
                            className="btn-wizard-pull"
                            style={{
                              padding: '7px 14px', fontSize: 12, fontWeight: 600,
                              background: rec.isBest ? 'linear-gradient(135deg, #06b6d4, #0ea5e9)' : 'rgba(255,255,255,0.06)',
                              color: rec.isBest ? '#fff' : '#e2e8f0',
                              border: rec.isBest ? 'none' : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: 6, cursor: pullingModel ? 'not-allowed' : 'pointer',
                              display: 'flex', alignItems: 'center', gap: 4,
                              opacity: pullingModel ? 0.5 : 1,
                            }}
                          >
                            <Download size={14} /> Pull
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Continue button */}
              <button
                onClick={() => setStep(3)}
                disabled={!hasAnyLlm}
                className={`btn-wizard-continue animate-stagger-4 ${hasAnyLlm ? 'ready' : ''}`}
                style={{
                  padding: '12px 24px', fontSize: 14, fontWeight: 600,
                  background: hasAnyLlm ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.05)',
                  color: hasAnyLlm ? '#fff' : 'var(--text-muted)',
                  border: 'none', borderRadius: 8, cursor: hasAnyLlm ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  marginTop: 4,
                  transition: 'all 0.3s ease',
                }}
              >
                {hasAnyLlm ? (
                  <>Continue <ChevronRight size={16} /></>
                ) : (
                  'Pull at least one model to continue'
                )}
              </button>
            </div>
          </>
        )}

        {/* ——— STEP 3: Ready ——— */}
        {step === 3 && (
          <>
            <div style={headerStyle}>
              <StepDots />
              <h1 style={{ margin: '12px 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
                You're All Set! 🚀
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Your local AI environment is ready to go
              </p>
            </div>
            <div style={bodyStyle}>
              <div className="glass-card animate-stagger-1" style={{
                padding: 16,
                border: '1px solid rgba(16,185,129,0.25)',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontWeight: 600, fontSize: 14 }}>
                  <CheckCircle size={18} /> Everything is configured
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
                  <strong>Installed models:</strong> {installedModels.length > 0 ? installedModels.join(', ') : 'Checked — ready'}
                </div>
              </div>

              <div className="glass-card animate-stagger-2" style={{
                padding: 14,
                color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.6,
              }}>
                <strong style={{ color: 'var(--text-primary)' }}>Quick tips:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <li>Use the <strong>Chat panel</strong> (right sidebar) to describe a workflow in plain English</li>
                  <li>Drag nodes from the <strong>Node Palette</strong> (left sidebar) to build manually</li>
                  <li>Click <strong>▶ Run</strong> in the toolbar to execute your graph</li>
                  <li>Open the <strong>Model Manager</strong> anytime to pull more models</li>
                </ul>
              </div>

              <button
                onClick={handleComplete}
                className="btn-wizard-launch animate-stagger-3"
                style={{
                  padding: '14px 28px', fontSize: 15, fontWeight: 700,
                  background: 'linear-gradient(135deg, #06b6d4, #8b5cf6, #06b6d4)',
                  color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 8,
                  marginTop: 4,
                  boxShadow: '0 8px 20px rgba(139, 92, 246, 0.4)',
                }}
              >
                <Sparkles size={18} /> Launch Workspace
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
