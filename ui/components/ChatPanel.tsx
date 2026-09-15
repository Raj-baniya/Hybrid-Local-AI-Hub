import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkflowStore } from '../store/workflowStore';
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

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [installedModels, setInstalledModels] = useState<{name: string}[]>([]);

  React.useEffect(() => {
    invoke<OllamaStatus>('cmd_check_ollama').then((s) => {
      if (s.state === 'Ready' && s.models.length > 0) {
        setInstalledModels(s.models);
        setModel(s.models[0].name);
      }
    });
  }, []);
  const [temperature, setTemperature] = useState(0.2);
  const [isEditMode, setIsEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedGraph, setGeneratedGraph] = useState<Graph | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (!model) {
      setError("No model selected — install one in the Model Manager first.");
      return;
    }

    setLoading(true);
    setError(null);
    setGeneratedGraph(null);

    try {
      let result: Graph;
      if (isEditMode) {
        const currentGraph = getActiveGraph();
        result = await invoke<Graph>('chat_edit', {
          instruction: prompt,
          existingGraph: currentGraph,
          model,
          temperature,
        });
      } else {
        result = await invoke<Graph>('chat_generate', {
          instruction: prompt,
          model,
          temperature,
        });
      }
      setGeneratedGraph(result);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadOntoCanvas = (inNewTab = false) => {
    if (!generatedGraph) return;

    if (inNewTab) {
      createTab(`AI: ${prompt.slice(0, 20)}...`, generatedGraph);
    } else {
      loadGraphIntoActiveTab(generatedGraph, `AI: ${prompt.slice(0, 20)}...`);
    }
    setActivePanel('none');
  };

  return (
    <div
      style={{
        width: 380,
        background: 'rgba(15, 23, 42, 0.95)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} style={{ color: '#06b6d4' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>Chat-to-Graph Compiler</span>
        </div>
        <button
          onClick={() => setActivePanel('none')}
          style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
            Natural Language Instruction
          </label>
          <textarea
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Watch my ./gym_intake folder for PDFs, extract text, formulate a workout plan using llama3.2, and write the plan to ./output/plan.txt"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 8,
              color: '#f8fafc',
              fontSize: 13,
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
              Ollama Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 6,
                color: '#f8fafc',
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

          <div style={{ width: 100 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
              Temp ({temperature})
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#06b6d4' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="editModeToggle"
            checked={isEditMode}
            onChange={(e) => setIsEditMode(e.target.checked)}
          />
          <label htmlFor="editModeToggle" style={{ fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
            Modify existing canvas workflow (Edit mode)
          </label>
        </div>

        <button
          className="btn btn-primary"
          style={{ justifyContent: 'center', padding: '10px' }}
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="spinning" />
              Compiling & Validating...
            </>
          ) : (
            <>
              <Sparkles size={16} />
              {isEditMode ? 'Refine Canvas Workflow' : 'Synthesize Workflow Graph'}
            </>
          )}
        </button>

        {error && (
          <div
            style={{
              padding: 12,
              background: 'rgba(244, 63, 94, 0.12)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              borderRadius: 8,
              color: '#fb7185',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#34d399', fontWeight: 600, fontSize: 13 }}>
              <CheckCircle size={16} />
              Workflow Graph Validated!
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1' }}>
              Generated <b>{generatedGraph.nodes.length}</b> nodes and <b>{generatedGraph.edges.length}</b> connections.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn btn-success"
                style={{ justifyContent: 'center' }}
                onClick={() => handleLoadOntoCanvas(false)}
              >
                <ArrowRight size={14} />
                Load onto Active Canvas
              </button>
              <button
                className="btn btn-secondary"
                style={{ justifyContent: 'center' }}
                onClick={() => handleLoadOntoCanvas(true)}
              >
                <RefreshCw size={14} />
                Open in New Tab
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
