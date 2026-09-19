import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkflowStore } from '../store/workflowStore';
import { useChatStore } from '../store/chatStore';
import { useSettingsStore } from '../store/settingsStore';
import { Graph } from '../schema/graphSchema';
import { Sparkles, ArrowRight, CheckCircle, AlertCircle, Loader2, RefreshCw, X, Send, Bot, User, StopCircle } from 'lucide-react';
import { ChatHistorySidebar } from './ChatHistorySidebar';

type OllamaStatus =
  | { state: "NotRunning" }
  | { state: "NoModels" }
  | { state: "Ready"; models: { name: string }[] };

export const ChatPanel: React.FC = () => {
  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);
  const getActiveGraph = useWorkflowStore((s) => s.getActiveGraph);
  const loadGraphIntoActiveTab = useWorkflowStore((s) => s.loadGraphIntoActiveTab);
  const createTab = useWorkflowStore((s) => s.createTab);

  const {
    status,
    messages, addMessage, clearHistory,
    instruction: prompt, setInstruction: setPrompt,
    model, setModel,
    isEditMode, setIsEditMode,
    resultGraph: generatedGraph,
    resultMode, resultPrompt,
    errorMessage: error,
    startGeneration, setSuccess, setError, reset
  } = useChatStore();

  const isOfflineMode = useSettingsStore((s) => s.isOfflineMode);
  const loading = status === "generating";

  const [installedModels, setInstalledModels] = useState<{ name: string }[]>([]);
  const [providers, setProviders] = useState<{ name: string, model: string }[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<string>('');
  
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, generationProgress, error, generatedGraph]);

  useEffect(() => {
    invoke<OllamaStatus>('cmd_check_ollama').then((s) => {
      if (s.state === 'Ready' && s.models.length > 0) {
        setInstalledModels(s.models);
        if (!useChatStore.getState().model) {
          setModel(s.models[0].name);
        }
      }
    });

    invoke<{name: string, model: string}[]>('get_providers')
      .then(res => setProviders(res))
      .catch(console.error);
  }, [setModel]);

  useEffect(() => {
    if (isOfflineMode) {
      if (installedModels.length > 0) setModel(installedModels[0].name);
    } else {
      if (providers.length > 0) setModel(`API|${providers[0].name}|${providers[0].model}`);
    }
  }, [isOfflineMode, installedModels, providers, setModel]);

  const taskIdRef = useRef(taskId);
  useEffect(() => {
    taskIdRef.current = taskId;
  }, [taskId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    
    listen<{ taskId: string, message: string }>('generation-progress', (event) => {
      if (event.payload.taskId !== taskIdRef.current) return;
      // Append streaming text smoothly instead of flashing
      setGenerationProgress(event.payload.message);
    }).then(u => {
      if (disposed) {
        u();
      } else {
        unlisten = u;
      }
    });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const handleStop = async () => {
    if (taskId) {
      try {
        await invoke('cancel_llm_task', { taskId });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (!model) {
      setError("No model selected — install one in the Model Manager first.");
      return;
    }

    addMessage({ role: 'user', content: prompt });
    const userPrompt = prompt;
    setPrompt(""); 

    startGeneration(isEditMode, userPrompt);
    const newTaskId = crypto.randomUUID();
    setTaskId(newTaskId);
    setGenerationProgress('');

    const isEdit = isEditMode;
    const currentGraph = isEditMode ? getActiveGraph() : null;
    
    const payloadMessages = [...messages, { role: 'user', content: userPrompt }];

    invoke<Graph>(isEdit ? 'chat_edit' : 'chat_generate', isEdit ? {
      messages: payloadMessages,
      existingGraph: currentGraph,
      model,
      taskId: newTaskId,
      offlineMode: isOfflineMode,
    } : {
      messages: payloadMessages,
      model,
      taskId: newTaskId,
      offlineMode: isOfflineMode,
    })
      .then((result) => {
        addMessage({ role: 'assistant', content: `Generated graph: ${result.name || 'Untitled'} (${result.nodes.length} nodes)` });
        setSuccess(result);
        
        const entry = {
          id: newTaskId,
          timestamp: new Date().toISOString(),
          instruction: userPrompt,
          model,
          graph: result
        };
        invoke('save_chat_history', { offlineMode: useSettingsStore.getState().isOfflineMode,  entry }).then(() => {
          useChatStore.getState().fetchHistory();
        }).catch(err => console.error("Failed to save history", err));
      })
      .catch((err: any) => {
        setError(typeof err === 'string' ? err : err.message || 'Generation failed');
      })
      .finally(() => {
        setTaskId(null);
        setGenerationProgress('');
      });
  };

  const handleLoadOntoCanvas = async (inNewTab = false) => {
    if (!generatedGraph) return;

    const fallbackSource = resultPrompt || (messages.length > 0 ? messages[messages.length - 1].content : "");
    const safePrompt = fallbackSource.slice(0, 20).replace(/[<>:"/\\|?*]/g, '').trim();
    const uniqueId = Math.random().toString(36).substring(2, 6);
    
    let agentName = generatedGraph.name || `AI - ${safePrompt} - ${uniqueId}`;
    
    if (resultMode) {
      const activeTab = useWorkflowStore.getState().tabs.find(t => t.id === useWorkflowStore.getState().activeTabId);
      if (activeTab) {
        agentName = activeTab.title;
      }
    }

    try {
      await invoke('save_agent', { offlineMode: useSettingsStore.getState().isOfflineMode,  name: agentName, graph: generatedGraph });
    } catch (err) {
      console.error("Failed to auto-save generated agent:", err);
    }

    if (inNewTab) {
      createTab(agentName, generatedGraph);
    } else {
      loadGraphIntoActiveTab(generatedGraph, agentName);
    }
    setActivePanel('none');
    reset();
  };

  return (
    <div
      className="animate-slide-in-right"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      <ChatHistorySidebar />
      <div style={{
        flex: 1,
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ padding: 8, background: 'rgba(6, 182, 212, 0.15)', borderRadius: 10 }}>
              <Sparkles size={20} style={{ color: 'var(--accent-cyan)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Chat-to-Graph Compiler</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    fontWeight: 600,
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {isOfflineMode ? (
                    installedModels.length === 0 ? (
                      <option value="">No local models</option>
                    ) : (
                      installedModels.map((m) => (
                        <option key={m.name} value={m.name}>{m.name}</option>
                      ))
                    )
                  ) : (
                    providers.length === 0 ? (
                      <option value="">No API models configured</option>
                    ) : (
                      providers.map((p) => (
                        <option key={`api-${p.name}`} value={`API|${p.name}|${p.model}`}>
                          {p.name} ({p.model})
                        </option>
                      ))
                    )
                  )}
                </select>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={isEditMode}
                    onChange={(e) => setIsEditMode(e.target.checked)}
                    style={{ cursor: 'pointer', accentColor: 'var(--accent-cyan)' }}
                  />
                  Edit Mode
                </label>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {messages.length > 0 && (
              <button 
                className="btn btn-secondary"
                onClick={() => {
                  if (loading) return;
                  clearHistory();
                }}
                disabled={loading}
                style={{ padding: '6px 12px', fontSize: 12 }}
              >
                Clear History
              </button>
            )}
            <button
              className="btn btn-icon"
              onClick={() => {
                if (taskId) {
                  handleStop();
                }
                setActivePanel('none');
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Chat Area */}
        <div 
          ref={scrollRef}
          style={{ 
            flex: 1, 
            overflowY: 'auto', 
            padding: '24px', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: 20 
          }}
        >
          {messages.length === 0 && !loading && !error && !generatedGraph ? (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', maxWidth: 400 }}>
              <Sparkles size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
              <h3 style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>How can I help you?</h3>
              <p style={{ fontSize: 13, lineHeight: 1.5 }}>
                Describe a workflow you want to build, and I will generate the nodes and connections for you.
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div 
                key={idx} 
                style={{ 
                  display: 'flex',
                  gap: 12,
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row'
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: msg.role === 'user' ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  color: msg.role === 'user' ? '#fff' : 'var(--text-primary)'
                }}>
                  {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                </div>
                <div style={{ 
                  padding: '12px 16px', 
                  borderRadius: 16,
                  borderTopRightRadius: msg.role === 'user' ? 4 : 16,
                  borderTopLeftRadius: msg.role === 'user' ? 16 : 4,
                  fontSize: 14, 
                  background: msg.role === 'user' ? 'rgba(6, 182, 212, 0.1)' : 'var(--bg-card)',
                  border: msg.role === 'user' ? '1px solid rgba(6, 182, 212, 0.2)' : '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  lineHeight: 1.5,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                }}>
                  {msg.content}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div style={{ display: 'flex', gap: 12, maxWidth: '85%' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'var(--bg-tertiary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                color: 'var(--text-primary)'
              }}>
                <Bot size={18} />
              </div>
              <div style={{ 
                padding: '12px 16px', 
                borderRadius: 16,
                borderTopLeftRadius: 4,
                fontSize: 14, 
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                lineHeight: 1.5,
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', marginBottom: generationProgress ? 8 : 0 }}>
                  <Loader2 size={14} className="spinning" />
                  <span style={{ fontSize: 13 }}>Thinking...</span>
                </div>
                {generationProgress && (
                  <div style={{ color: 'var(--text-primary)', opacity: 0.9, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 8 }}>
                    {generationProgress}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div style={{
                padding: 16,
                background: 'rgba(244, 63, 94, 0.1)',
                border: '1px solid rgba(244, 63, 94, 0.2)',
                borderRadius: 12,
                color: 'var(--accent-rose)',
                alignSelf: 'center',
                width: '100%',
                maxWidth: 600
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 8 }}>
                <AlertCircle size={16} /> Error
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, fontFamily: 'monospace', opacity: 0.9 }}>{error}</pre>
            </div>
          )}

          {generatedGraph && (
            <div style={{
                padding: 20,
                background: loading ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.1)',
                border: `1px solid ${loading ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.2)'}`,
                borderRadius: 16,
                alignSelf: 'center',
                width: '100%',
                maxWidth: 600,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                opacity: loading ? 0.7 : 1,
                transition: 'all 0.3s ease',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-emerald)', fontWeight: 600, fontSize: 15 }}>
                <CheckCircle size={18} />
                {loading ? 'Previous Workflow (new one generating…)' : 'Workflow Generated Successfully'}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                Contains <b>{generatedGraph.nodes.length}</b> nodes and <b>{generatedGraph.edges.length}</b> connections.
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                {resultMode ? (
                  <>
                    <button className="btn btn-success" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleLoadOntoCanvas(false)} disabled={loading}>
                      <ArrowRight size={16} /> Update Current Canvas
                    </button>
                    <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleLoadOntoCanvas(true)} disabled={loading}>
                      <RefreshCw size={16} /> Open as New Tab
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-success" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleLoadOntoCanvas(true)} disabled={loading}>
                      <ArrowRight size={16} /> Open in New Tab
                    </button>
                    <button className="btn btn-danger" style={{ flex: 1, justifyContent: 'center', background: 'transparent', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)' }} onClick={() => handleLoadOntoCanvas(false)} disabled={loading}>
                      <RefreshCw size={16} /> Overwrite Current
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div style={{ padding: '20px 24px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-subtle)', zIndex: 10 }}>
          
          {/* Text Area Row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <textarea
              rows={Math.min(5, prompt.split('\n').length || 1)}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the workflow you want to build..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (loading) return;
                  handleGenerate();
                }
              }}
              style={{
                flex: 1,
                padding: '14px 16px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 16,
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none',
                resize: 'none',
                lineHeight: 1.5,
                maxHeight: 150
              }}
              disabled={loading}
            />
            {loading ? (
              <button
                className="btn btn-secondary"
                onClick={handleStop}
                style={{ height: 50, width: 50, borderRadius: '50%', justifyContent: 'center', padding: 0, color: 'var(--accent-rose)' }}
                title="Stop Generation"
              >
                <StopCircle size={24} />
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={!prompt.trim() || !model}
                style={{ height: 50, width: 50, borderRadius: '50%', justifyContent: 'center', padding: 0 }}
                title="Send Request"
              >
                <Send size={20} />
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
