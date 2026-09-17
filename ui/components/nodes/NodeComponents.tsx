import React from 'react';
import { NodeProps } from '@xyflow/react';
import { useWorkflowStore } from '../../store/workflowStore';
import { CustomNodeWrapper } from './CustomNodeWrapper';
import {
  FolderSearch,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Binary,
  FileSpreadsheet,
  Database,
  GitFork,
  HardDrive,
} from 'lucide-react';
import {
  FileWatcherConfig,
  TextInputConfig,
  ImageInputConfig,
  OllamaSelectorConfig,
  LocalEmbedderConfig,
  PDFExtractorConfig,
  ChromaDbStoreConfig,
  ConditionalRouterConfig,
  LocalFileWriterConfig,
} from '../../schema/graphSchema';

export const FileWatcherNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as FileWatcherConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="File Watcher"
      icon={<FolderSearch size={16} />}
      headerColor="#06b6d4"
      selected={selected}
      hasTargetHandle={false}
      hasSourceHandle={true}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>
          <span style={{ color: '#64748b' }}>Path: </span>
          <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>{cfg.watchPath}</span>
        </div>
        {cfg.pattern && (
          <div>
            <span style={{ color: '#64748b' }}>Pattern: </span>
            <span style={{ fontFamily: 'monospace' }}>{cfg.pattern}</span>
          </div>
        )}
      </div>
    </CustomNodeWrapper>
  );
};

export const TextInputNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as TextInputConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Text Input"
      icon={<FileText size={16} />}
      headerColor="#3b82f6"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis', color: '#94a3b8' }}>
        {cfg.text || '(empty)'}
      </div>
    </CustomNodeWrapper>
  );
};

export const ImageInputNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as ImageInputConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Image Input"
      icon={<ImageIcon size={16} />}
      headerColor="#a855f7"
      selected={selected}
      hasTargetHandle={false}
      hasSourceHandle={true}
    >
      <div style={{ fontFamily: 'monospace', color: '#c084fc', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {cfg.imagePath}
      </div>
    </CustomNodeWrapper>
  );
};

export const OllamaSelectorNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as OllamaSelectorConfig;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
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

  return (
    <CustomNodeWrapper
      id={id}
      title="Ollama LLM"
      icon={<Sparkles size={16} />}
      headerColor="#f59e0b"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <select
            value={cfg.model}
            onChange={(e) => updateNodeData(id, { model: e.target.value })}
            className="nodrag"
            style={{
              background: 'var(--bg-panel)',
              color: '#f59e0b',
              border: '1px solid var(--border-medium)',
              borderRadius: 4,
              padding: '2px 4px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              maxWidth: 120,
              textOverflow: 'ellipsis',
              appearance: 'none',
              outline: 'none'
            }}
          >
            <option value="llama3.2">llama3.2 (default)</option>
            {cfg.model && cfg.model !== 'llama3.2' && !models.find(m => m.name === cfg.model) && (
              <option value={cfg.model}>{cfg.model} (missing)</option>
            )}
            {models.filter(m => m.name !== 'llama3.2').map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <span style={{ color: '#64748b', fontSize: 11 }}>T={cfg.temperature}</span>
        </div>
        <div style={{ maxHeight: 40, overflow: 'hidden', textOverflow: 'ellipsis', color: '#94a3b8', fontSize: 11 }}>
          {cfg.promptTemplate}
        </div>
      </div>
    </CustomNodeWrapper>
  );
};

export const LocalEmbedderNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as LocalEmbedderConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Embedder"
      icon={<Binary size={16} />}
      headerColor="#10b981"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ color: '#10b981', fontWeight: 500 }}>{cfg.model}</div>
    </CustomNodeWrapper>
  );
};

export const PDFExtractorNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as PDFExtractorConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="PDF Extractor"
      icon={<FileSpreadsheet size={16} />}
      headerColor="#ef4444"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ color: '#94a3b8' }}>
        {cfg.pageRange ? `Pages ${cfg.pageRange[0]}–${cfg.pageRange[1]}` : 'Extract all pages'}
      </div>
    </CustomNodeWrapper>
  );
};

export const ChromaDbStoreNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as ChromaDbStoreConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="ChromaDB Store"
      icon={<Database size={16} />}
      headerColor="#6366f1"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div>
          <span style={{ color: '#64748b' }}>Coll: </span>
          <span style={{ color: '#818cf8', fontWeight: 500 }}>{cfg.collectionName}</span>
        </div>
        {cfg.inputMap && (
          <div style={{ fontSize: 10, color: '#64748b' }}>
            Bindings: {Object.keys(cfg.inputMap).join(', ')}
          </div>
        )}
      </div>
    </CustomNodeWrapper>
  );
};

export const ConditionalRouterNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as ConditionalRouterConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Conditional Router"
      icon={<GitFork size={16} />}
      headerColor="#ec4899"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={false}
      sourceHandles={[
        { id: 'true', label: 'True' },
        { id: 'false', label: 'False' },
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontFamily: 'monospace', color: '#f472b6', fontSize: 11 }}>
          {cfg.condition}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
          <span style={{ color: '#10b981' }}>● True: {cfg.trueTarget || 'not bound'}</span>
          <span style={{ color: '#f43f5e' }}>● False: {cfg.falseTarget || 'not bound'}</span>
        </div>
      </div>
    </CustomNodeWrapper>
  );
};

export const LocalFileWriterNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as LocalFileWriterConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="File Writer"
      icon={<HardDrive size={16} />}
      headerColor="#14b8a6"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontFamily: 'monospace', color: '#2dd4bf', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {cfg.outputPath}
        </div>
        <div style={{ fontSize: 10, color: '#64748b' }}>
          {cfg.append ? 'Append mode' : 'Overwrite mode'}
        </div>
      </div>
    </CustomNodeWrapper>
  );
};

export const customNodeTypes = {
  FileWatcherNode: FileWatcherNodeComponent,
  TextInputNode: TextInputNodeComponent,
  ImageInputNode: ImageInputNodeComponent,
  OllamaSelectorNode: OllamaSelectorNodeComponent,
  LocalEmbedderNode: LocalEmbedderNodeComponent,
  PDFExtractorNode: PDFExtractorNodeComponent,
  ChromaDbStoreNode: ChromaDbStoreNodeComponent,
  ConditionalRouterNode: ConditionalRouterNodeComponent,
  LocalFileWriterNode: LocalFileWriterNodeComponent,
};
