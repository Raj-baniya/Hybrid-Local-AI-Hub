import React from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { NodeType } from '../schema/graphSchema';
import { Trash2, X } from 'lucide-react';

export const NodeInspector: React.FC = () => {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  const activeTabId = useWorkflowStore((s) => s.activeTabId);
  const tabs = useWorkflowStore((s) => s.tabs);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const deleteNode = useWorkflowStore((s) => s.deleteNode);

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

  if (!selectedNode) {
    return (
      <div
        style={{
          width: 320,
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border-subtle)',
          padding: 20,
          color: 'var(--text-muted)',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        Select a node to inspect and configure parameters.
      </div>
    );
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
            <textarea
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
              {models.filter(m => m.name !== 'llama3.2').map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
            <label style={labelStyle}>Temperature ({data.temperature})</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={data.temperature}
              onChange={(e) => updateNodeData(selectedNode.id, { temperature: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
            />
            <label style={labelStyle}>Prompt Template</label>
            <textarea
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
    }
  };

  return (
    <div
      className="animate-slide-in-right"
      style={{
        width: 320,
        background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border-subtle)',
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
          onClick={() => setSelectedNodeId(null)}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {renderFields()}
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--border-subtle)' }}>
        <button
          className="btn btn-danger"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => deleteNode(selectedNode.id)}
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
