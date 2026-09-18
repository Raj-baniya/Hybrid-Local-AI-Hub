import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkflowStore } from '../store/workflowStore';
import { useChatStore } from '../store/chatStore';
import { Graph } from '../schema/graphSchema';
import { Sparkles, ArrowRight, CheckCircle, AlertCircle, Loader2, RefreshCw, X } from 'lucide-react';

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

  const loading = status === "generating";

  const [installedModels, setInstalledModels] = useState<{ name: string }[]>([]);

  React.useEffect(() => {
    invoke<OllamaStatus>('cmd_check_ollama').then((s) => {
      if (s.state === 'Ready' && s.models.length > 0) {
        setInstalledModels(s.models);
        // Only set default model if it's not already set in the global store
        if (!useChatStore.getState().model) {
          setModel(s.models[0].name);
        }
      }
    });
  }, [setModel]);

  const [taskId, setTaskId] = useState<string | null>(null);

  React.useEffect(() => {
    console.log("[DIAGNOSTIC] ChatPanel mounted");
    return () => {
      console.log("[DIAGNOSTIC] ChatPanel UNMOUNTED mid-request");
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
    setPrompt(""); // Clear input box

    startGeneration(isEditMode, userPrompt);
    const newTaskId = crypto.randomUUID();
    setTaskId(newTaskId);

    const isEdit = isEditMode;
    const currentGraph = isEditMode ? getActiveGraph() : null;
    
    // Construct the payload message history by taking existing + the new one
    const payloadMessages = [...messages, { role: 'user', content: userPrompt }];

    invoke<Graph>(isEdit ? 'chat_edit' : 'chat_generate', isEdit ? {
      messages: payloadMessages,
      existingGraph: currentGraph,
      model,
      taskId: newTaskId,
    } : {
      messages: payloadMessages,
      model,
      taskId: newTaskId,
    })
      .then((result) => {
        console.log("[DIAGNOSTIC] Generation promise RESOLVED!", result);
        addMessage({ role: 'assistant', content: `Generated graph: ${result.name || 'Untitled'} (${result.nodes.length} nodes)` });
        setSuccess(result);
      })
      .catch((err: any) => {
        setError(typeof err === 'string' ? err : err.message || 'Generation failed');
      })
      .finally(() => {
        setTaskId(null);
      });
  };

  const handleLoadOntoCanvas = async (inNewTab = false) => {
    if (!generatedGraph) return;

    // Use generated name if available, otherwise fallback
    const fallbackSource = resultPrompt || (messages.length > 0 ? messages[messages.length - 1].content : "");
    const safePrompt = fallbackSource.slice(0, 20).replace(/[<>:"/\\|?*]/g, '').trim();
    const uniqueId = Math.random().toString(36).substring(2, 6);
    
    // In edit mode, we want to overwrite the existing agent. We use the active tab's title to do this.
    // If not in edit mode, we use the LLM-provided name, or a generated string if missing.
    let agentName = generatedGraph.name || `AI - ${safePrompt} - ${uniqueId}`;
    
    if (resultMode) {
      const activeTab = useWorkflowStore.getState().tabs.find(t => t.id === useWorkflowStore.getState().activeTabId);
      if (activeTab) {
        agentName = activeTab.title;
      }
    }

    try {
      await invoke('save_agent', { name: agentName, graph: generatedGraph });
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
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} style={{ color: 'var(--accent-cyan)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Chat-to-Graph Compiler</span>
        </div>
        <button
          onClick={() => setActivePanel('none')}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* Chat History View */}
        {messages.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Conversation History</span>
              <button 
                onClick={() => {
                  if (status === 'generating' || loading) return;
                  clearHistory();
                }}
                disabled={status === 'generating' || loading}
                style={{ background: 'transparent', border: 'none', color: (status === 'generating' || loading) ? 'var(--text-disabled)' : 'var(--accent-rose)', fontSize: 11, cursor: (status === 'generating' || loading) ? 'not-allowed' : 'pointer' }}
              >
                Clear
              </button>
            </div>
            {messages.map((msg, idx) => (
              <div 
                key={idx} 
                style={{ 
                  padding: '10px 14px', 
                  borderRadius: 8, 
                  fontSize: 12, 
                  background: msg.role === 'user' ? 'rgba(56, 189, 248, 0.1)' : 'var(--bg-secondary)',
                  border: msg.role === 'user' ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid var(--border-medium)',
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '90%',
                  color: msg.role === 'user' ? 'var(--text-primary)' : 'var(--text-secondary)'
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4, color: msg.role === 'user' ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                  {msg.role === 'user' ? 'You' : 'Agent'}
                </div>
                <div>{msg.content}</div>
              </div>
            ))}
          </div>
        )}

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            {messages.length === 0 ? "Initial Instruction" : "Refinement Instruction"}
          </label>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={messages.length === 0 ? "e.g. Watch my ./gym folder for PDFs..." : "e.g. Add a node to also write to a CSV file"}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              Ollama Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                fontSize: 12,
              }}
            >
              {installedModels.length === 0 ? (
                <option value="">No models installed</option>
              ) : (
                installedModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="editModeToggle"
            checked={isEditMode}
            onChange={(e) => setIsEditMode(e.target.checked)}
          />
          <label htmlFor="editModeToggle" style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Modify existing canvas workflow (Edit mode)
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1, justifyContent: 'center', padding: '10px' }}
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="spinning" />
                Compiling...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                {isEditMode ? 'Refine' : 'Synthesize'}
              </>
            )}
          </button>
          {loading && (
            <button
              className="btn btn-secondary"
              style={{ padding: '10px', color: 'var(--accent-red)' }}
              onClick={handleStop}
              title="Stop Generation"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {error && (
          <div
            style={{
              padding: 12,
              background: 'rgba(244, 63, 94, 0.12)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              borderRadius: 8,
              color: 'var(--accent-rose)',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 4 }}>
              <AlertCircle size={14} />
              Compiler Error
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, fontFamily: 'monospace' }}>{error}</pre>
          </div>
        )}
        {generatedGraph && (
          <div
            style={{
              padding: 14,
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-emerald)', fontWeight: 600, fontSize: 13 }}>
              <CheckCircle size={16} />
              Workflow Graph Validated!
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Generated <b>{generatedGraph.nodes.length}</b> nodes and <b>{generatedGraph.edges.length}</b> connections.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {resultMode ? (
                <>
                  <button
                    className="btn btn-success"
                    style={{ justifyContent: 'center' }}
                    onClick={() => handleLoadOntoCanvas(false)}
                  >
                    <ArrowRight size={14} />
                    Update Active Canvas
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ justifyContent: 'center' }}
                    onClick={() => handleLoadOntoCanvas(true)}
                  >
                    <RefreshCw size={14} />
                    Open as New Workflow
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn btn-success"
                    style={{ justifyContent: 'center' }}
                    onClick={() => handleLoadOntoCanvas(true)}
                  >
                    <ArrowRight size={14} />
                    Open in New Tab
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ justifyContent: 'center', background: 'transparent', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)' }}
                    onClick={() => handleLoadOntoCanvas(false)}
                  >
                    <RefreshCw size={14} />
                    Overwrite Active Canvas
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
