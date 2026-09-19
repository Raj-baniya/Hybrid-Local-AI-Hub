import { useSettingsStore } from '../store/settingsStore';
import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkflowStore } from '../store/workflowStore';
import { LifeBuoy, X, Send, Loader2, Bot, User, StopCircle } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  images?: string[]; 
  modelName?: string;
  isStreaming?: boolean;
}

type OllamaStatus =
  | { state: "NotRunning" }
  | { state: "NoModels" }
  | { state: "Ready"; models: { name: string }[] };

export const HelpAgentPanel: React.FC = () => {
  const setActivePanel = useWorkflowStore((s) => s.setActivePanel);
  const getActiveGraph = useWorkflowStore((s) => s.getActiveGraph);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<{ name: string }[]>([]);
  const [providers, setProviders] = useState<{ name: string; model: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [streamProgress, setStreamProgress] = useState<Record<string, string>>({});
  const isOfflineMode = useSettingsStore((s) => s.isOfflineMode);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<OllamaStatus>('cmd_check_ollama').then((s) => {
      if (s.state === 'Ready' && s.models.length > 0) {
        setModels(s.models);
        
        const visionModel = s.models.find(m => m.name.includes('vision') || m.name.includes('llava'));
        if (visionModel) {
          setSelectedModel(visionModel.name);
        } else {
          setSelectedModel(s.models[0].name);
        }
      }
    });

    invoke<{name: string, model: string}[]>('get_providers')
      .then(res => setProviders(res))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (isOfflineMode) {
      if (models.length > 0) {
        const visionModel = models.find(m => m.name.includes('vision') || m.name.includes('llava'));
        setSelectedModel(visionModel ? visionModel.name : models[0].name);
      } else {
        setSelectedModel('');
      }
    } else {
      if (providers.length > 0) {
        setSelectedModel(`API|${providers[0].name}|${providers[0].model}`);
      } else {
        setSelectedModel('');
      }
    }
  }, [isOfflineMode, models, providers]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    
    listen<{ taskId: string, message: string }>('generation-progress', (event) => {
      if (taskIdsRef.current.includes(event.payload.taskId)) {
        setStreamProgress(prev => ({
          ...prev,
          [event.payload.taskId]: event.payload.message
        }));
      }
    }).then(u => {
      if (disposed) u();
      else unlisten = u;
    });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollTop = chatEndRef.current.scrollHeight;
    }
  }, [messages, loading, streamProgress]);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              const base64str = (event.target.result as string).split(',')[1];
              setAttachedImages(prev => [...prev, base64str]);
            }
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const [taskIds, setTaskIds] = useState<string[]>([]);
  const taskIdsRef = useRef<string[]>([]);

  useEffect(() => {
    taskIdsRef.current = taskIds;
  }, [taskIds]);

  const handleStop = async () => {
    try {
      await Promise.all(taskIds.map(id => invoke('cancel_llm_task', { taskId: id })));
      setLoading(false);
      setTaskIds([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() && attachedImages.length === 0) return;
    if (!selectedModel) {
      alert("Please select a model.");
      return;
    }

    const newMsg: ChatMessage = {
      role: 'user',
      text: inputText,
      images: attachedImages.length > 0 ? [...attachedImages] : undefined
    };

    setMessages(prev => [...prev, newMsg]);
    setInputText('');
    setAttachedImages([]);
    setLoading(true);

    const newTaskId = crypto.randomUUID();
    setTaskIds([newTaskId]);

    try {
      const graph = getActiveGraph();
      let contextStr = undefined;
      if (graph && graph.nodes.length > 0) {
        contextStr = JSON.stringify(graph, null, 2);
      }
      await invoke<string>('help_agent_ask', {
        prompt: newMsg.text,
        images: newMsg.images || [],
        model: selectedModel,
        url: "http://127.0.0.1:11434",
        workflowContext: contextStr,
        taskId: newTaskId
      }).then(response => {
        setMessages(prev => [...prev, { role: 'assistant', text: response, modelName: selectedModel }]);
      }).catch(err => {
        setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err}`, modelName: selectedModel }]);
      }).finally(() => {
        setStreamProgress(prev => {
          const next = { ...prev };
          delete next[newTaskId];
          return next;
        });
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setTaskIds([]);
    }
  };

  return (
    <div
      className="animate-slide-in-right"
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--bg-secondary)',
        display: 'flex', flexDirection: 'column' }}>
      
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
          <div style={{ padding: 8, background: 'rgba(16, 185, 129, 0.15)', borderRadius: 10 }}>
            <LifeBuoy size={20} style={{ color: 'var(--accent-emerald)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>AI Help & Debug</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
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
                  models.length === 0 ? (
                    <option value="">No local models</option>
                  ) : (
                    models.map((m) => (
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
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {messages.length > 0 && (
            <button 
              className="btn btn-secondary"
              onClick={() => {
                if (loading) return;
                setMessages([]);
              }}
              disabled={loading}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              Clear
            </button>
          )}
          <button
            className="btn btn-icon"
            onClick={() => {
              if (taskIds.length > 0) {
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
      <div ref={chatEndRef} style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {messages.length === 0 && !loading && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', maxWidth: 400 }}>
            <LifeBuoy size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>Need Help?</h3>
            <p style={{ fontSize: 13, lineHeight: 1.5 }}>
              Paste your terminal errors here, or press <strong>Ctrl+V</strong> to paste a screenshot. The AI will analyze your workflow and the error to provide a fix.
            </p>
          </div>
        )}

        {messages.map((m, idx) => (
          <div key={idx} style={{ 
            display: 'flex',
            gap: 12,
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            flexDirection: m.role === 'user' ? 'row-reverse' : 'row'
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: m.role === 'user' ? 'var(--accent-emerald)' : 'var(--bg-tertiary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              color: m.role === 'user' ? '#fff' : 'var(--text-primary)'
            }}>
              {m.role === 'user' ? <User size={18} /> : <Bot size={18} />}
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {m.role === 'assistant' && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
                  {m.modelName || 'Assistant'}
                </div>
              )}
              <div style={{
                background: m.role === 'user' ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-card)',
                border: m.role === 'user' ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid var(--border-subtle)',
                padding: '12px 16px',
                borderRadius: 16,
                borderTopRightRadius: m.role === 'user' ? 4 : 16,
                borderTopLeftRadius: m.role === 'user' ? 16 : 4,
                color: 'var(--text-primary)',
                fontSize: 14,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.5,
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}>
                {m.text}
                
                {m.images && m.images.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    {m.images.map((img, i) => (
                      <img key={i} src={`data:image/png;base64,${img}`} alt="Attached" style={{ height: 80, borderRadius: 8, border: '1px solid var(--border-medium)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {loading && taskIds.map(taskId => (
          <div key={taskId} style={{ display: 'flex', gap: 12, maxWidth: '85%' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', marginBottom: streamProgress[taskId] ? 8 : 0 }}>
                <Loader2 size={14} className="spinning" />
                <span style={{ fontSize: 13 }}>Thinking...</span>
              </div>
              {streamProgress[taskId] && (
                <div style={{ color: 'var(--text-primary)', opacity: 0.9, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 8 }}>
                  {streamProgress[taskId]}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input Area */}
      <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-card)', zIndex: 10 }}>
        {attachedImages.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={`data:image/png;base64,${img}`} alt="Preview" style={{ height: 48, borderRadius: 8, border: '1px solid var(--border-medium)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} />
                <button
                  onClick={() => setAttachedImages(prev => prev.filter((_, index) => index !== i))}
                  style={{ position: 'absolute', top: -8, right: -8, background: 'var(--accent-rose)', color: 'white', border: 'none', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <textarea
            rows={Math.min(5, inputText.split('\n').length || 1)}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Describe the error or paste a screenshot (Ctrl+V)..."
            disabled={loading}
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
          />
          <div style={{ display: 'flex', gap: 8 }}>
            {loading ? (
              <button
                className="btn btn-secondary"
                onClick={handleStop}
                style={{ height: 50, width: 50, borderRadius: '50%', padding: 0, justifyContent: 'center', color: 'var(--accent-rose)' }}
                title="Stop Generation"
              >
                <StopCircle size={24} />
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleSend}
                disabled={(!inputText.trim() && attachedImages.length === 0)}
                style={{ height: 50, width: 50, borderRadius: '50%', padding: 0, justifyContent: 'center' }}
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
