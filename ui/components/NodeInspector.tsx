import React from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { NodeType } from '../schema/graphSchema';
import { Trash2, X, Activity, CheckCircle, AlertCircle, Clock } from 'lucide-react';

const nodeDescriptions: Record<string, string> = {
  FileWatcherNode: "Monitors a directory for file changes (create, modify, delete) matching a specific pattern. Often used to trigger workflows when a new file arrives.",
  TextInputNode: "Provides a static text block or a template. You can reference previous node outputs using {{node_id.output}}.",
  ImageInputNode: "Loads an image from the local filesystem for processing by AI models.",
  ScheduleNode: "Triggers the workflow repeatedly based on a Cron expression (e.g., '*/5 * * * *' for every 5 minutes).",
  LLMNode: "Passes input text to the Local AI model to generate text or analyze content.",
  SystemCommandNode: "Executes a shell command or script on your local operating system.",
  ExtractRegexNode: "Extracts specific pieces of text using Regular Expressions.",
  WebScraperNode: "Scrapes the content of a target URL and returns it as plain text.",
  NotifyWebhookNode: "Sends a POST request to an external URL to notify other systems.",
  WriteFileNode: "Writes the input content into a specified file on your local disk.",
  TextCombineNode: "Combines inputs from multiple preceding nodes into a single text string.",
  PythonScriptNode: "Executes a custom Python script locally.",
  DelayNode: "Pauses the workflow execution for a specified number of seconds.",
  ConditionNode: "Evaluates a logical condition based on inputs and routes the flow accordingly.",
};

const AutoResizeTextarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = Math.min(ref.current.scrollHeight, 250) + 'px';
    }
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
};

export const NodeInspector: React.FC = () => {

  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  const activeTabId = useWorkflowStore((s) => s.activeTabId);
  const tabs = useWorkflowStore((s) => s.tabs);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const deleteNodes = useWorkflowStore((s) => s.deleteNodes);
  const nodeStatusMap = useWorkflowStore((s) => s.nodeStatusMap);

  const [models, setModels] = React.useState<{ name: string }[]>([]);

  React.useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<any>('cmd_check_ollama').then((s) => {
        if (s.state === 'Ready' && s.models.length > 0) {
          setModels(s.models);
        }
      }).catch(console.error);
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const selectedNode = activeTab?.nodes.find((n) => n.id === selectedNodeId);
  const selectedNodeStatus = selectedNode ? nodeStatusMap[selectedNode.id] : null;

  if (!selectedNode) {
    return null;
  }

  const data = selectedNode.data as NodeType;

  const renderFields = () => {
    switch (data.type) {
      case 'FileWatcherNode':
        return (
          <>
            <label style={labelStyle}>Watch Directory</label>
            <input
              type="text"
              value={data.watchPath}
              onChange={(e) => updateNodeData(selectedNode.id, { watchPath: e.target.value })}
              style={inputStyle}
            />
            <label style={labelStyle}>File Glob Pattern (optional)</label>
            <input
              type="text"
              value={data.pattern || ''}
              placeholder="*.pdf"
              onChange={(e) => updateNodeData(selectedNode.id, { pattern: e.target.value || null })}
              style={inputStyle}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={data.recursive}
                onChange={(e) => updateNodeData(selectedNode.id, { recursive: e.target.checked })}
              />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Watch subdirectories recursively</span>
            </div>
          </>
        );

      case 'TextInputNode':
        return (
          <>
            <label style={labelStyle}>Text Content / Template</label>
            <AutoResizeTextarea
              rows={6}
              value={data.text}
              onChange={(e) => updateNodeData(selectedNode.id, { text: e.target.value })}
              style={textareaStyle}
              placeholder="Use {{node_id.output}} or static text..."
            />
          </>
        );

      case 'ImageInputNode':
        return (
          <>
            <label style={labelStyle}>Image File Path</label>
            <input
              type="text"
              value={data.imagePath}
              onChange={(e) => updateNodeData(selectedNode.id, { imagePath: e.target.value })}
              style={inputStyle}
            />
          </>
        );

      case 'ScheduleNode':
        return (
          <>
            <label style={labelStyle}>Cron Expression</label>
            <input
              type="text"
              value={data.cronExpression}
              onChange={(e) => updateNodeData(selectedNode.id, { cronExpression: e.target.value })}
              style={inputStyle}
              placeholder="*/2 * * * *"
            />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              5-field cron (min hour day month weekday) or 6-field with seconds.
              Examples: "*/2 * * * *" every 2 minutes, "0 * * * *" every hour.
            </p>
          </>
        );

      case 'OllamaSelectorNode':
        return (
          <>
            <label style={labelStyle}>Ollama Model</label>
            <select
              value={data.model}
              onChange={(e) => updateNodeData(selectedNode.id, { model: e.target.value })}
              style={{ ...inputStyle, appearance: 'auto', paddingRight: 24 }}
            >
              <option value="llama3.2">llama3.2 (default)</option>
              {data.model && data.model !== 'llama3.2' && !models.find(m => m.name === data.model) && (
                <option value={data.model}>{data.model} (missing)</option>
              )}
              {models.filter(m => m.name !== 'llama3.2').map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
            <label style={labelStyle}>Prompt Template</label>
            <AutoResizeTextarea
              rows={6}
              value={data.promptTemplate}
              onChange={(e) => updateNodeData(selectedNode.id, { promptTemplate: e.target.value })}
              style={textareaStyle}
              placeholder="Use {{input}} or {{node_id.output}}..."
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={data.jsonMode}
                onChange={(e) => updateNodeData(selectedNode.id, { jsonMode: e.target.checked })}
              />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>JSON output mode</span>
            </div>
          </>
        );

      case 'LocalEmbedderNode':
        return (
          <>
            <label style={labelStyle}>Embedding Model</label>
            <input
              type="text"
              value={data.model}
              onChange={(e) => updateNodeData(selectedNode.id, { model: e.target.value })}
              style={inputStyle}
            />
          </>
        );

      case 'PDFExtractorNode':
        return (
          <>
            <label style={labelStyle}>Page Range (e.g. 1, 5)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                placeholder="Start"
                value={data.pageRange ? data.pageRange[0] : ''}
                onChange={(e) => {
                  const start = parseInt(e.target.value, 10);
                  const end = data.pageRange ? data.pageRange[1] : 1;
                  updateNodeData(selectedNode.id, { pageRange: isNaN(start) ? null : [start, end] });
                }}
                style={inputStyle}
              />
              <input
                type="number"
                placeholder="End"
                value={data.pageRange ? data.pageRange[1] : ''}
                onChange={(e) => {
                  const end = parseInt(e.target.value, 10);
                  const start = data.pageRange ? data.pageRange[0] : 1;
                  updateNodeData(selectedNode.id, { pageRange: isNaN(end) ? null : [start, end] });
                }}
                style={inputStyle}
              />
            </div>
          </>
        );

      case 'ChromaDbStoreNode':
        return (
          <>
            <label style={labelStyle}>Collection Name</label>
            <input
              type="text"
              value={data.collectionName}
              onChange={(e) => updateNodeData(selectedNode.id, { collectionName: e.target.value })}
              style={inputStyle}
            />
            <label style={labelStyle}>ChromaDB URL</label>
            <input
              type="text"
              value={data.chromaUrl}
              onChange={(e) => updateNodeData(selectedNode.id, { chromaUrl: e.target.value })}
              style={inputStyle}
            />
          </>
        );

      case 'ConditionalRouterNode':
        return (
          <>
            <label style={labelStyle}>Condition Expression</label>
            <input
              type="text"
              value={data.condition}
              placeholder="output.contains('keyword')"
              onChange={(e) => updateNodeData(selectedNode.id, { condition: e.target.value })}
              style={inputStyle}
            />
            <label style={labelStyle}>True Target Node ID</label>
            <input
              type="text"
              value={data.trueTarget}
              onChange={(e) => updateNodeData(selectedNode.id, { trueTarget: e.target.value })}
              style={inputStyle}
            />
            <label style={labelStyle}>False Target Node ID</label>
            <input
              type="text"
              value={data.falseTarget}
              onChange={(e) => updateNodeData(selectedNode.id, { falseTarget: e.target.value })}
              style={inputStyle}
            />
          </>
        );

      case 'LocalFileWriterNode':
        return (
          <>
            <label style={labelStyle}>Output File Path</label>
            <input
              type="text"
              value={data.outputPath}
              onChange={(e) => updateNodeData(selectedNode.id, { outputPath: e.target.value })}
              style={inputStyle}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={data.append}
                onChange={(e) => updateNodeData(selectedNode.id, { append: e.target.checked })}
              />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Append mode (instead of overwrite)</span>
            </div>
          </>
        );
      case 'WebScraperNode':
        return (
          <>
            <label style={labelStyle}>URL (online mode only)</label>
            <input type="url" value={data.url || ''} onChange={(e) => updateNodeData(selectedNode.id, { url: e.target.value })} style={inputStyle} placeholder="https://example.com" />
          </>
        );

      case 'ShellCommandNode':
        return (
          <>
            <label style={labelStyle}>Command</label>
            <input
              type="text"
              value={data.command}
              onChange={(e) => updateNodeData(selectedNode.id, { command: e.target.value })}
              style={inputStyle}
              placeholder="echo {{input}}"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={data.unsafeRawShell || false}
                onChange={(e) => updateNodeData(selectedNode.id, { unsafeRawShell: e.target.checked })}
              />
              <span style={{ fontSize: 12, color: 'var(--accent-rose)' }}>Unsafe raw shell (allows injection)</span>
            </div>
          </>
        );

      case 'RegexExtractorNode':
        return (
          <>
            <label style={labelStyle}>Regex Pattern</label>
            <input
              type="text"
              value={data.pattern}
              onChange={(e) => updateNodeData(selectedNode.id, { pattern: e.target.value })}
              style={inputStyle}
              placeholder="(?i)Total: \$([0-9.]+)"
            />
            <label style={labelStyle}>Capture Group (0 = full match)</label>
            <input
              type="number"
              value={data.group}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                updateNodeData(selectedNode.id, { group: isNaN(val) ? 0 : val });
              }}
              style={inputStyle}
            />
          </>
        );

      case 'NotifyDesktopNode':
        return (
          <>
            <label style={labelStyle}>Title</label>
            <input type="text" value={data.title || ''} onChange={(e) => updateNodeData(selectedNode.id, { title: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>Body</label>
            <input type="text" value={data.body || ''} onChange={(e) => updateNodeData(selectedNode.id, { body: e.target.value })} style={inputStyle} />
          </>
        );

      case 'NotifyWebhookNode':
        return (
          <>
            <label style={labelStyle}>Webhook URL</label>
            <input type="text" value={data.url || ''} onChange={(e) => updateNodeData(selectedNode.id, { url: e.target.value })} style={inputStyle} placeholder="https://hooks.example.com/..." />
            <label style={labelStyle}>Payload Template</label>
            <AutoResizeTextarea rows={3} value={data.payload || ''} onChange={(e) => updateNodeData(selectedNode.id, { payload: e.target.value })} style={textareaStyle} placeholder='{"text": "{{input}}"}' />
          </>
        );

      case 'ClipboardTriggerNode':
        return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Reads text from the system clipboard. No configuration required.</p>;

      case 'CsvReaderNode':
        return (
          <>
            <label style={labelStyle}>CSV File Path</label>
            <input type="text" value={data.filePath || ''} onChange={(e) => updateNodeData(selectedNode.id, { filePath: e.target.value })} style={inputStyle} placeholder="./data.csv" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input type="checkbox" checked={data.hasHeaderRow ?? true} onChange={(e) => updateNodeData(selectedNode.id, { hasHeaderRow: e.target.checked })} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>First row is header</span>
            </div>
          </>
        );

      case 'DelayNode':
        return (
          <>
            <label style={labelStyle}>Duration (seconds)</label>
            <input type="number" min={0} value={data.durationSeconds ?? 5} onChange={(e) => updateNodeData(selectedNode.id, { durationSeconds: parseInt(e.target.value, 10) || 0 })} style={inputStyle} />
          </>
        );

      case 'TemplateFormatterNode':
        return (
          <>
            <label style={labelStyle}>Template</label>
            <AutoResizeTextarea rows={4} value={data.template || ''} onChange={(e) => updateNodeData(selectedNode.id, { template: e.target.value })} style={textareaStyle} placeholder="Result: {{node_id.output}}" />
          </>
        );

      case 'MergeNode':
        return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Merges all incoming node outputs into a JSON object. No configuration required.</p>;

      case 'SourceFileNode':
        return (
          <>
            <label style={labelStyle}>File Path</label>
            <input type="text" value={data.path || ''} onChange={(e) => updateNodeData(selectedNode.id, { path: e.target.value })} style={inputStyle} placeholder="./dataset.csv" />
            <label style={labelStyle}>Connector</label>
            <input type="text" value={data.connector || 'auto'} onChange={(e) => updateNodeData(selectedNode.id, { connector: e.target.value })} style={inputStyle} placeholder="auto" />
          </>
        );

      case 'DatasetProfileNode':
        return (
          <>
            <label style={labelStyle}>Profile Mode</label>
            <input type="text" value={data.mode || 'auto'} onChange={(e) => updateNodeData(selectedNode.id, { mode: e.target.value })} style={inputStyle} placeholder="auto" />
          </>
        );

      case 'TransformAggregateNode':
        return (
          <>
            <label style={labelStyle}>Group By (comma-separated columns)</label>
            <input type="text" value={(data.groupBy || []).join(',')} onChange={(e) => updateNodeData(selectedNode.id, { groupBy: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} style={inputStyle} />
            <label style={labelStyle}>Aggregations (comma-separated)</label>
            <input type="text" value={(data.aggregations || []).join(',')} onChange={(e) => updateNodeData(selectedNode.id, { aggregations: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} style={inputStyle} />
          </>
        );

      case 'AnalysisStatsHypothesisTestNode':
        return (
          <>
            <label style={labelStyle}>Statistical Test</label>
            <input type="text" value={data.test || 't-test'} onChange={(e) => updateNodeData(selectedNode.id, { test: e.target.value })} style={inputStyle} placeholder="t-test" />
            <label style={labelStyle}>Group Column</label>
            <input type="text" value={data.groupColumn || ''} onChange={(e) => updateNodeData(selectedNode.id, { groupColumn: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>Value Column</label>
            <input type="text" value={data.valueColumn || ''} onChange={(e) => updateNodeData(selectedNode.id, { valueColumn: e.target.value })} style={inputStyle} />
          </>
        );

      case 'AiInterpretNode':
        return (
          <>
            <label style={labelStyle}>Required Facts (one per line)</label>
            <AutoResizeTextarea rows={3} value={(data.requiresFacts || []).join('\n')} onChange={(e) => updateNodeData(selectedNode.id, { requiresFacts: e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean) })} style={textareaStyle} />
            <label style={labelStyle}>Max Claims</label>
            <input type="number" min={0} value={data.maxClaims ?? 5} onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              updateNodeData(selectedNode.id, { maxClaims: isNaN(val) ? 5 : val });
            }} style={inputStyle} />
          </>
        );

      case 'AiPlanNode':
        return (
          <>
            <label style={labelStyle}>Objective</label>
            <AutoResizeTextarea rows={3} value={data.objective || ''} onChange={(e) => updateNodeData(selectedNode.id, { objective: e.target.value })} style={textareaStyle} />
            <label style={labelStyle}>Model Role</label>
            <input type="text" value={data.modelRole || 'planner'} onChange={(e) => updateNodeData(selectedNode.id, { modelRole: e.target.value })} style={inputStyle} />
          </>
        );
      case 'DocumentQaRAGNode':
        return (
          <>
            <label style={labelStyle}>Query (optional)</label>
            <input type="text" value={data.query || ''} onChange={(e) => updateNodeData(selectedNode.id, { query: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>Collection Name</label>
            <input type="text" value={data.collectionName || 'local_docs'} onChange={(e) => updateNodeData(selectedNode.id, { collectionName: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>Results count</label>
            <input type="number" value={data.nResults ?? 3} onChange={(e) => { const val = parseInt(e.target.value, 10); updateNodeData(selectedNode.id, { nResults: isNaN(val) ? undefined : val }); }} style={inputStyle} />
          </>
        );
      case 'LocalVisionInterpreterNode':
        return (
          <>
            <label style={labelStyle}>Image Path</label>
            <input type="text" value={data.imagePath || ''} onChange={(e) => updateNodeData(selectedNode.id, { imagePath: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>Prompt</label>
            <input type="text" value={data.prompt || ''} onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })} style={inputStyle} />
          </>
        );
      case 'KillProcessNode':
        return (
          <>
            <label style={labelStyle}>Process Name</label>
            <input type="text" value={data.processName || ''} onChange={(e) => updateNodeData(selectedNode.id, { processName: e.target.value })} style={inputStyle} />
          </>
        );
      case 'ScreenCaptureNode':
        return (
          <>
            <label style={labelStyle}>Output Path</label>
            <input type="text" value={data.outputPath || ''} onChange={(e) => updateNodeData(selectedNode.id, { outputPath: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>Specific Window Title (optional)</label>
            <input type="text" value={data.specificWindowTitle || ''} onChange={(e) => updateNodeData(selectedNode.id, { specificWindowTitle: e.target.value })} style={inputStyle} />
          </>
        );
      case 'MouseKeyboardSimNode':
        return (
          <>
            <label style={labelStyle}>Action Type (click, type, move)</label>
            <input type="text" value={data.actionType || 'click'} onChange={(e) => updateNodeData(selectedNode.id, { actionType: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>X Coordinate</label>
            <input type="number" value={data.x || 0} onChange={(e) => updateNodeData(selectedNode.id, { x: parseInt(e.target.value) || 0 })} style={inputStyle} />
            <label style={labelStyle}>Y Coordinate</label>
            <input type="number" value={data.y || 0} onChange={(e) => updateNodeData(selectedNode.id, { y: parseInt(e.target.value) || 0 })} style={inputStyle} />
            <label style={labelStyle}>Payload (for typing)</label>
            <input type="text" value={data.payload || ''} onChange={(e) => updateNodeData(selectedNode.id, { payload: e.target.value })} style={inputStyle} />
          </>
        );
      case 'LocalOCRNode':
        return (
          <>
            <label style={labelStyle}>Image Path</label>
            <input type="text" value={data.imagePath || ''} onChange={(e) => updateNodeData(selectedNode.id, { imagePath: e.target.value })} style={inputStyle} />
          </>
        );
      case 'DuckDbQueryNode':
        return (
          <>
            <label style={labelStyle}>DuckDB SQL Query</label>
            <AutoResizeTextarea rows={3} value={data.query || ''} onChange={(e) => updateNodeData(selectedNode.id, { query: e.target.value })} style={textareaStyle} />
            <label style={labelStyle}>Database Path (optional)</label>
            <input type="text" value={data.dbPath || ''} onChange={(e) => updateNodeData(selectedNode.id, { dbPath: e.target.value })} style={inputStyle} />
          </>
        );
      case 'WasmSandboxNode':
        return (
          <>
            <label style={labelStyle}>WASM Module Path</label>
            <input type="text" value={data.wasmModulePath || ''} onChange={(e) => updateNodeData(selectedNode.id, { wasmModulePath: e.target.value })} style={inputStyle} />
            <label style={labelStyle}>Input Data (JSON/Text)</label>
            <input type="text" value={data.inputData || ''} onChange={(e) => updateNodeData(selectedNode.id, { inputData: e.target.value })} style={inputStyle} />
          </>
        );
      case 'UIActionNode':
        return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Configured via code.</p>;
      case 'NativeWindowControlNode':
      case 'CallAgentNode':
        return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Configured via code.</p>;
    }
  };

  return (
    <div
      className="nowheel nodrag nopan glass-panel"
      style={{
        width: 340,
        maxHeight: 450,
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'text',
        cursor: 'auto',
        padding: 0, // Reset padding from spotlight card default
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--neo-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{data.type}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>ID: {selectedNode.id}</div>
        </div>
        <button
          onClick={() => {
            setSelectedNodeId(null);
            useWorkflowStore.getState().onNodesChange([{ id: selectedNode.id, type: 'select', selected: false }]);
          }}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5, padding: "12px", background: "var(--bg-secondary)", borderRadius: 8, border: "1px solid var(--neo-border)" }}>
          {nodeDescriptions[data.type] || "A custom workflow node."}
        </div>
        {renderFields()}

        {selectedNodeStatus && selectedNodeStatus.status !== 'idle' && (
          <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'var(--text-primary)', fontWeight: 600, fontSize: 12 }}>
              <Activity size={14} style={{ color: 'var(--accent-cyan)' }} />
              Live Telemetry
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
              <span style={{ color: 'var(--text-muted)' }}>Status:</span>
              <span style={{ 
                color: selectedNodeStatus.status === 'success' ? 'var(--accent-emerald)' 
                     : selectedNodeStatus.status === 'failed' ? 'var(--accent-rose)' 
                     : selectedNodeStatus.status === 'running' ? 'var(--accent-cyan)' 
                     : 'var(--text-secondary)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}>
                {selectedNodeStatus.status === 'success' && <CheckCircle size={10} />}
                {selectedNodeStatus.status === 'failed' && <AlertCircle size={10} />}
                {selectedNodeStatus.status === 'running' && <Clock size={10} />}
                <span>
                  {selectedNodeStatus.status.charAt(0).toUpperCase() + selectedNodeStatus.status.slice(1)}
                </span>
              </span>
            </div>
            
            {selectedNodeStatus.durationMs && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)' }}>Duration:</span>
                <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{selectedNodeStatus.durationMs} ms</span>
              </div>
            )}
            
            {selectedNodeStatus.outputPreview && (
              <div style={{ marginTop: 8 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Output:</span>
                <div style={{ 
                  marginTop: 4, 
                  padding: 8, 
                  background: 'var(--bg-secondary)', 
                  borderRadius: 4, 
                  fontSize: 11, 
                  fontFamily: 'monospace', 
                  color: 'var(--text-primary)',
                  maxHeight: 120,
                  overflowY: 'auto',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap'
                }}>
                  {selectedNodeStatus.outputPreview}
                </div>
              </div>
            )}
            
            {selectedNodeStatus.error && (
              <div style={{ marginTop: 8 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Error:</span>
                <div style={{ 
                  marginTop: 4, 
                  padding: 8, 
                  background: 'rgba(244, 63, 94, 0.1)', 
                  border: '1px solid rgba(244, 63, 94, 0.2)',
                  borderRadius: 4, 
                  fontSize: 11, 
                  fontFamily: 'monospace', 
                  color: 'var(--accent-rose)',
                  maxHeight: 80,
                  overflowY: 'auto'
                }}>
                  {selectedNodeStatus.error}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--neo-border)' }}>
        <button
          className="btn btn-danger"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => deleteNodes([selectedNode.id])}
        >
          <Trash2 size={14} />
          Delete Node
        </button>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  marginBottom: 4,
  display: 'block',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-medium)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: 12,
  fontFamily: 'monospace',
  outline: 'none',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-medium)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: 12,
  fontFamily: 'monospace',
  outline: 'none',
  resize: 'vertical',
};
