import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkflowStore } from '../store/workflowStore';
import { LifeBuoy, X, Send, Loader2, Bot, User } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  images?: string[]; // base64 data urls
  modelName?: string;
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
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<OllamaStatus>('cmd_check_ollama').then((s) => {
      if (s.state === 'Ready' && s.models.length > 0) {
        setModels(s.models);
        
        // Try to select a vision model if available, else default to the first
        const visionModel = s.models.find(m => m.name.includes('vision') || m.name.includes('llava'));
        if (visionModel) {
          setSelectedModels([visionModel.name]);
        } else {
          setSelectedModels([s.models[0].name]);
        }
      }
    });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              // Extract base64 part (remove data:image/png;base64,)
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

  const handleStop = async () => {
    try {
      await Promise.all(taskIds.map(id => invoke('cancel_llm_task', { taskId: id })));
    } catch (e) {
      console.error(e);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() && attachedImages.length === 0) return;
    if (selectedModels.length === 0) {
      alert("Please select at least one model.");
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

    const generatedIds = selectedModels.map(() => crypto.randomUUID());
    setTaskIds(generatedIds);

    try {
      const graph = getActiveGraph();
      let contextStr = undefined;
      if (graph && graph.nodes.length > 0) {
        contextStr = JSON.stringify(graph, null, 2);
      }

      const promises = selectedModels.map((model, idx) => 
        invoke<string>('help_agent_ask', {
          prompt: newMsg.text,
          images: newMsg.images || [],
          model: model,
          url: "http://127.0.0.1:11434",
          workflowContext: contextStr,
          taskId: generatedIds[idx]
        }).then(response => {
          setMessages(prev => [...prev, { role: 'assistant', text: response, modelName: model }]);
        }).catch(err => {
          setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err}`, modelName: model }]);
        })
      );

      await Promise.all(promises);
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
        background: 'var(--bg-card)',
        display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LifeBuoy size={18} color="var(--accent-emerald)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>AI Help & Debug</span>
        </div>
        <button onClick={() => setActivePanel('none')} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>

      {/* Model Selector */}
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Select Assistant Models (Multiple allowed):</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 80, overflowY: 'auto' }}>
          {models.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No models installed</div>}
          {models.map(m => (
            <label key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-primary)', background: 'var(--bg-card)', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-medium)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selectedModels.includes(m.name)}
                onChange={(e) => {
                  if (e.target.checked) setSelectedModels(prev => [...prev, m.name]);
                  else setSelectedModels(prev => prev.filter(n => n !== m.name));
                }}
              />
              {m.name}
            </label>
          ))}
        </div>
        {attachedImages.length > 0 && !selectedModels.some(m => m.includes('vision') || m.includes('llava')) && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--accent-amber)' }}>
            ⚠️ You attached an image. Ensure you select a vision model (e.g., llava or llama3.2-vision).
          </div>
        )}
      </div>

      {/* Chat Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 40 }}>
            <LifeBuoy size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p>Paste your terminal errors here, or press <strong>Ctrl+V</strong> to paste a screenshot.</p>
            <p style={{ marginTop: 8 }}>The AI will analyze your current workflow and the error to provide a fix.</p>
          </div>
        )}

        {messages.map((m, idx) => (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 11 }}>
              {m.role === 'user' ? <User size={12} /> : <Bot size={12} color="var(--accent-emerald)" />}
              {m.role === 'user' ? 'You' : `Help Agent (${m.modelName || 'Unknown'})`}
            </div>
            
            <div style={{
              background: m.role === 'user' ? 'rgba(56, 189, 248, 0.1)' : 'var(--bg-secondary)',
              border: m.role === 'user' ? '1px solid rgba(56, 189, 248, 0.2)' : '1px solid var(--border-subtle)',
              padding: '10px 14px',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: 13,
              maxWidth: '90%',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {m.text}
              
              {m.images && m.images.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {m.images.map((img, i) => (
                    <img key={i} src={`data:image/png;base64,${img}`} alt="Attached" style={{ height: 60, borderRadius: 4, border: '1px solid var(--border-medium)' }} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <Loader2 size={14} className="spinning" /> Agent is thinking...
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div style={{ padding: 18, borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        {attachedImages.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={`data:image/png;base64,${img}`} alt="Preview" style={{ height: 40, borderRadius: 4, border: '1px solid var(--border-medium)' }} />
                <button
                  onClick={() => setAttachedImages(prev => prev.filter((_, index) => index !== i))}
                  style={{ position: 'absolute', top: -6, right: -6, background: 'var(--accent-rose)', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            rows={3}
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
              padding: '10px 12px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-medium)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
              resize: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {loading ? (
              <button
                className="btn btn-secondary"
                onClick={handleStop}
                style={{ padding: '8px', color: 'var(--accent-red)' }}
                title="Stop Generation"
              >
                <X size={18} />
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleSend}
                disabled={(!inputText.trim() && attachedImages.length === 0)}
                style={{ padding: '8px' }}
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
