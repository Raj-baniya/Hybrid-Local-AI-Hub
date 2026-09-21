import { z } from 'zod';

export const FileWatcherConfigSchema = z.object({
  type: z.literal('FileWatcherNode'),
  watchPath: z.string().min(1, 'Watch path is required'),
  pattern: z.string().optional().nullable(),
  recursive: z.boolean().default(false),
});

export const TextInputConfigSchema = z.object({
  type: z.literal('TextInputNode'),
  text: z.string(),
});

export const ImageInputConfigSchema = z.object({
  type: z.literal('ImageInputNode'),
  imagePath: z.string().min(1, 'Image path is required'),
});

export const OllamaSelectorConfigSchema = z.object({
  type: z.literal('OllamaSelectorNode'),
  model: z.string().min(1, 'Model name is required'),
  promptTemplate: z.string().min(1, 'Prompt template is required'),
  jsonMode: z.boolean().default(false),
});

export const LocalEmbedderConfigSchema = z.object({
  type: z.literal('LocalEmbedderNode'),
  model: z.string().min(1, 'Embedding model is required'),
});

export const PDFExtractorConfigSchema = z.object({
  type: z.literal('PDFExtractorNode'),
  pageRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional().nullable(),
});

export const ChromaDbStoreConfigSchema = z.object({
  type: z.literal('ChromaDbStoreNode'),
  collectionName: z.string().min(1, 'Collection name is required'),
  chromaUrl: z.string().default('http://localhost:8000'),
  inputMap: z.record(z.string()).optional().nullable(),
});

export const ConditionalRouterConfigSchema = z.object({
  type: z.literal('ConditionalRouterNode'),
  condition: z.string().min(1, 'Condition expression is required'),
  trueTarget: z.string().min(1, 'True target node ID is required'),
  falseTarget: z.string().min(1, 'False target node ID is required'),
});

export const LocalFileWriterConfigSchema = z.object({
  type: z.literal('LocalFileWriterNode'),
  outputPath: z.string().min(1, 'Output path is required'),
  append: z.boolean().default(false),
});

export const WebScraperConfigSchema = z.object({
  type: z.literal('WebScraperNode'),
  url: z.string().url('A valid URL is required'),
});

export const ShellCommandConfigSchema = z.object({
  type: z.literal('ShellCommandNode'),
  command: z.string(),
  unsafeRawShell: z.boolean().optional(),
});

export const RegexExtractorConfigSchema = z.object({
  type: z.literal('RegexExtractorNode'),
  pattern: z.string().min(1, 'Pattern is required'),
  group: z.number().int().nonnegative().default(0),
});

export const ScheduleConfigSchema = z.object({
  type: z.literal('ScheduleNode'),
  cronExpression: z.string().min(1, 'Cron expression is required')
    .regex(/^(\S+\s){4,5}\S+$/, 'Cron expression must have 5 or 6 fields'),
});

export const SourceFileConfigSchema = z.object({
  type: z.literal('SourceFileNode'),
  path: z.string().min(1, 'Path is required'),
  connector: z.string().default('auto'),
});

export const DatasetProfileConfigSchema = z.object({
  type: z.literal('DatasetProfileNode'),
  mode: z.string().default('auto'),
});

export const TransformAggregateConfigSchema = z.object({
  type: z.literal('TransformAggregateNode'),
  groupBy: z.array(z.string()).default([]),
  aggregations: z.array(z.string()).default([]),
});

export const AnalysisStatsHypothesisTestConfigSchema = z.object({
  type: z.literal('AnalysisStatsHypothesisTestNode'),
  test: z.string().default('t-test'),
  groupColumn: z.string().default(''),
  valueColumn: z.string().default(''),
});

export const AiInterpretConfigSchema = z.object({
  type: z.literal('AiInterpretNode'),
  requiresFacts: z.array(z.string()).default([]),
  maxClaims: z.number().int().nonnegative().default(5),
  model: z.string().optional(),
});

export const NotifyDesktopConfigSchema = z.object({
  type: z.literal('NotifyDesktopNode'),
  title: z.string().default(''),
  body: z.string().default(''),
});

export const NotifyWebhookConfigSchema = z.object({
  type: z.literal('NotifyWebhookNode'),
  url: z.string().default(''),
  payload: z.string().default(''),
});

export const ClipboardTriggerConfigSchema = z.object({
  type: z.literal('ClipboardTriggerNode'),
  onlyText: z.boolean().default(true),
});

export const CsvReaderConfigSchema = z.object({
  type: z.literal('CsvReaderNode'),
  filePath: z.string().default(''),
  hasHeaderRow: z.boolean().default(true),
});

export const DelayConfigSchema = z.object({
  type: z.literal('DelayNode'),
  durationSeconds: z.number().int().nonnegative().default(5),
});

export const TemplateFormatterConfigSchema = z.object({
  type: z.literal('TemplateFormatterNode'),
  template: z.string().default(''),
});

export const MergeConfigSchema = z.object({
  type: z.literal('MergeNode'),
  _dummy: z.boolean().default(false),
});

export const AiPlanConfigSchema = z.object({
  type: z.literal('AiPlanNode'),
  objective: z.string().default(''),
  modelRole: z.string().default('planner'),
  model: z.string().optional(),
});

export const NodeTypeSchema = z.discriminatedUnion('type', [
  FileWatcherConfigSchema,
  TextInputConfigSchema,
  ImageInputConfigSchema,
  OllamaSelectorConfigSchema,
  LocalEmbedderConfigSchema,
  PDFExtractorConfigSchema,
  ChromaDbStoreConfigSchema,
  ConditionalRouterConfigSchema,
  LocalFileWriterConfigSchema,
  WebScraperConfigSchema,
  ShellCommandConfigSchema,
  RegexExtractorConfigSchema,
  ScheduleConfigSchema,
  SourceFileConfigSchema,
  DatasetProfileConfigSchema,
  TransformAggregateConfigSchema,
  AnalysisStatsHypothesisTestConfigSchema,
  AiInterpretConfigSchema,
  AiPlanConfigSchema,
  NotifyDesktopConfigSchema,
  NotifyWebhookConfigSchema,
  ClipboardTriggerConfigSchema,
  CsvReaderConfigSchema,
  DelayConfigSchema,
  TemplateFormatterConfigSchema,
  MergeConfigSchema,
]);

export const GraphNodeSchema = z.object({
  id: z.string(),
  position: z.tuple([z.number(), z.number()]).optional().nullable(),
  data: NodeTypeSchema,
});

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string().optional().nullable(),
  target: z.string(),
  targetHandle: z.string().optional().nullable(),
});

export const GraphSchema = z.object({
  version: z.number().default(1),
  name: z.string().optional().nullable(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});



export type FileWatcherConfig = z.infer<typeof FileWatcherConfigSchema>;
export type TextInputConfig = z.infer<typeof TextInputConfigSchema>;
export type ImageInputConfig = z.infer<typeof ImageInputConfigSchema>;
export type OllamaSelectorConfig = z.infer<typeof OllamaSelectorConfigSchema>;
export type LocalEmbedderConfig = z.infer<typeof LocalEmbedderConfigSchema>;
export type PDFExtractorConfig = z.infer<typeof PDFExtractorConfigSchema>;
export type ChromaDbStoreConfig = z.infer<typeof ChromaDbStoreConfigSchema>;
export type ConditionalRouterConfig = z.infer<typeof ConditionalRouterConfigSchema>;
export type LocalFileWriterConfig = z.infer<typeof LocalFileWriterConfigSchema>;
export type WebScraperConfig = z.infer<typeof WebScraperConfigSchema>;
export type ShellCommandConfig = z.infer<typeof ShellCommandConfigSchema>;
export type RegexExtractorConfig = z.infer<typeof RegexExtractorConfigSchema>;
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;
export type SourceFileConfig = z.infer<typeof SourceFileConfigSchema>;
export type DatasetProfileConfig = z.infer<typeof DatasetProfileConfigSchema>;
export type TransformAggregateConfig = z.infer<typeof TransformAggregateConfigSchema>;
export type AnalysisStatsHypothesisTestConfig = z.infer<typeof AnalysisStatsHypothesisTestConfigSchema>;
export type AiInterpretConfig = z.infer<typeof AiInterpretConfigSchema>;
export type AiPlanConfig = z.infer<typeof AiPlanConfigSchema>;

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type Graph = z.infer<typeof GraphSchema>;
