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
  Globe,
  Terminal,
  Braces,
  Clock,
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
  WebScraperConfig,
  ShellCommandConfig,
  RegexExtractorConfig,
  ScheduleConfig,
  SourceFileConfig,
  DatasetProfileConfig,
  TransformAggregateConfig,
  AnalysisStatsHypothesisTestConfig,
  AiInterpretConfig,
  AiPlanConfig,
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
          <span style={{ color: 'var(--text-muted)' }}>Path: </span>
          <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>{cfg.watchPath}</span>
        </div>
        {cfg.pattern && (
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Pattern: </span>
            <span style={{ fontFamily: 'monospace' }}>{cfg.pattern}</span>
          </div>
        )}
      </div>
    </CustomNodeWrapper>
  );
};

export const ScheduleNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as ScheduleConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Schedule"
      icon={<Clock size={16} />}
      headerColor="#f59e0b"
      selected={selected}
      hasTargetHandle={false}
      hasSourceHandle={true}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Cron: </span>
          <span style={{ fontFamily: 'monospace', color: '#fbbf24' }}>{cfg.cronExpression}</span>
        </div>
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
      <div style={{ maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-secondary)' }}>
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
        </div>
        <div style={{ maxHeight: 40, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-secondary)', fontSize: 11 }}>
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
      <div style={{ color: 'var(--text-secondary)' }}>
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
          <span style={{ color: 'var(--text-muted)' }}>Coll: </span>
          <span style={{ color: '#818cf8', fontWeight: 500 }}>{cfg.collectionName}</span>
        </div>
        {cfg.inputMap && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
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
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {cfg.append ? 'Append mode' : 'Overwrite mode'}
        </div>
      </div>
    </CustomNodeWrapper>
  );
};

export const WebScraperNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as WebScraperConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Web Scraper"
      icon={<Globe size={16} />}
      headerColor="#3b82f6"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cfg.url}
        </div>
        <div style={{ fontSize: 9, alignSelf: 'flex-start', padding: '2px 6px', background: 'rgba(244, 63, 94, 0.15)', color: '#f43f5e', borderRadius: 4, fontWeight: 700, letterSpacing: 0.5 }}>
          REQUIRES INTERNET
        </div>
      </div>
    </CustomNodeWrapper>
  );
};

export const ShellCommandNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as ShellCommandConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Shell Command"
      icon={<Terminal size={16} />}
      headerColor="#ef4444"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ fontFamily: 'monospace', color: '#f87171', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {cfg.command}
      </div>
    </CustomNodeWrapper>
  );
};

export const RegexExtractorNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as RegexExtractorConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Regex Extractor"
      icon={<Braces size={16} />}
      headerColor="#10b981"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Pattern: </span>
          <span style={{ fontFamily: 'monospace', color: '#34d399' }}>{cfg.pattern}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Group: </span>
          <span>{cfg.group}</span>
        </div>
      </div>
    </CustomNodeWrapper>
  );
};

// ─── Phase 2 Nodes ─────────────────────────────────────────────────────────

export const SourceFileNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as SourceFileConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Dataset Source"
      icon={<FileSpreadsheet size={16} />}
      headerColor="#0284c7"
      selected={selected}
      hasTargetHandle={false}
      hasSourceHandle={true}
    >
      <div style={{ fontFamily: 'monospace', color: '#38bdf8', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {cfg.path}
      </div>
    </CustomNodeWrapper>
  );
};

export const DatasetProfileNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as DatasetProfileConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Data Profiler"
      icon={<Database size={16} />}
      headerColor="#0f766e"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ color: 'var(--text-secondary)' }}>Mode: {cfg.mode}</div>
    </CustomNodeWrapper>
  );
};

export const TransformAggregateNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as TransformAggregateConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Aggregate"
      icon={<GitFork size={16} />}
      headerColor="#b45309"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ color: 'var(--text-secondary)' }}>Group By: {cfg.groupBy.join(', ')}</div>
    </CustomNodeWrapper>
  );
};

export const AnalysisStatsHypothesisTestNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as AnalysisStatsHypothesisTestConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="Hypothesis Test"
      icon={<Binary size={16} />}
      headerColor="#4338ca"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ color: 'var(--text-secondary)' }}>Test: {cfg.test}</div>
    </CustomNodeWrapper>
  );
};

export const AiInterpretNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as AiInterpretConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="AI Interpreter"
      icon={<Sparkles size={16} />}
      headerColor="#a21caf"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ color: 'var(--text-secondary)' }}>Facts Required: {cfg.requiresFacts.length}</div>
    </CustomNodeWrapper>
  );
};

export const AiPlanNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const cfg = data as unknown as AiPlanConfig;
  return (
    <CustomNodeWrapper
      id={id}
      title="AI Planner"
      icon={<Sparkles size={16} />}
      headerColor="#e11d48"
      selected={selected}
      hasTargetHandle={true}
      hasSourceHandle={true}
    >
      <div style={{ color: 'var(--text-secondary)' }}>Role: {cfg.modelRole}</div>
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
  WebScraperNode: WebScraperNodeComponent,
  ShellCommandNode: ShellCommandNodeComponent,
  RegexExtractorNode: RegexExtractorNodeComponent,
  ScheduleNode: ScheduleNodeComponent,
  SourceFileNode: SourceFileNodeComponent,
  DatasetProfileNode: DatasetProfileNodeComponent,
  TransformAggregateNode: TransformAggregateNodeComponent,
  AnalysisStatsHypothesisTestNode: AnalysisStatsHypothesisTestNodeComponent,
  AiInterpretNode: AiInterpretNodeComponent,
  AiPlanNode: AiPlanNodeComponent,
};
