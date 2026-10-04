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

export const GetCpuUsageConfigSchema = z.object({
  type: z.literal('GetCpuUsageNode'),
  averageOverSeconds: z.number().int().positive().optional().nullable(),
});

export const GetMemoryUsageConfigSchema = z.object({
  type: z.literal('GetMemoryUsageNode'),
});

export const ListProcessesConfigSchema = z.object({
  type: z.literal('ListProcessesNode'),
  sortBy: z.string().optional().nullable(),
  limit: z.number().int().positive().optional().nullable(),
});

export const DocumentQaRAGConfigSchema = z.object({
  type: z.literal('DocumentQaRAGNode'),
  query: z.string().optional().nullable(),
  collectionName: z.string().default('local_docs'),
  dbPath: z.string().optional().nullable(),
  embeddingModel: z.string().optional().nullable(),
  nResults: z.number().int().positive().optional().nullable(),
});

export const LocalVisionInterpreterConfigSchema = z.object({
  type: z.literal('LocalVisionInterpreterNode'),
  imagePath: z.string().optional().nullable(),
  visionModel: z.string().optional().nullable(),
  prompt: z.string().optional().nullable(),
});

export const UIActionConfigSchema = z.object({
  type: z.literal('UIActionNode'),
  actions: z.array(z.object({
    type: z.string(),
    x: z.number().int().optional().nullable(),
    y: z.number().int().optional().nullable(),
    text: z.string().optional().nullable(),
    key: z.string().optional().nullable(),
    duration: z.number().optional().nullable(),
    delayAfter: z.number().optional().nullable(),
  })).default([]),
});

export const KillProcessConfigSchema = z.object({
  type: z.literal('KillProcessNode'),
  processName: z.string().optional().nullable(),
});

export const CallAgentConfigSchema = z.object({
  type: z.literal('CallAgentNode'),
  agent_name: z.string().default(''),
  input_override: z.string().optional(),
});

export const NativeWindowControlConfigSchema = z.object({
  type: z.literal('NativeWindowControlNode'),
  targetProcess: z.string().optional().nullable(),
  windowTitleMatch: z.string().optional().nullable(),
  automationId: z.string().optional().nullable(),
  action: z.string().optional().nullable(),
  textPayload: z.string().optional().nullable(),
});

export const ScreenCaptureConfigSchema = z.object({
  type: z.literal('ScreenCaptureNode'),
  outputPath: z.string().default(''),
  specificWindowTitle: z.string().optional().nullable(),
});

export const MouseKeyboardSimConfigSchema = z.object({
  type: z.literal('MouseKeyboardSimNode'),
  actionType: z.string().default('click'),
  x: z.number().int().optional().nullable(),
  y: z.number().int().optional().nullable(),
  payload: z.string().optional().nullable(),
});

export const LocalOCRConfigSchema = z.object({
  type: z.literal('LocalOCRNode'),
  imagePath: z.string().default(''),
});

export const DuckDbQueryConfigSchema = z.object({
  type: z.literal('DuckDbQueryNode'),
  query: z.string().default(''),
  dbPath: z.string().optional().nullable(),
});

export const WasmSandboxConfigSchema = z.object({
  type: z.literal('WasmSandboxNode'),
  wasmModulePath: z.string().default(''),
  inputData: z.string().optional().nullable(),
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
  GetCpuUsageConfigSchema,
  GetMemoryUsageConfigSchema,
  ListProcessesConfigSchema,
  DocumentQaRAGConfigSchema,
  LocalVisionInterpreterConfigSchema,
  UIActionConfigSchema,
  KillProcessConfigSchema,
  NativeWindowControlConfigSchema,
  CallAgentConfigSchema,
  ScreenCaptureConfigSchema,
  MouseKeyboardSimConfigSchema,
  LocalOCRConfigSchema,
  DuckDbQueryConfigSchema,
  WasmSandboxConfigSchema,
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

export const GoalCheckSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file_exists'), path: z.string() }),
  z.object({ type: z.literal('dir_exists'), path: z.string() }),
  z.object({ type: z.literal('file_contains'), path: z.string(), text: z.string().optional().nullable(), regex: z.string().optional().nullable() }),
  z.object({ type: z.literal('command_exit_zero'), command: z.string() }),
  z.object({ type: z.literal('output_contains'), text: z.string() }),
  z.object({ type: z.literal('llm_judge'), question: z.string() }),
]);

export const GoalCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  check: GoalCheckSchema,
});

export const GoalLimitsSchema = z.object({
  maxSteps: z.number().int(),
  timeoutSecs: z.number().int(),
  patience: z.number().int(),
  maxFalseClaims: z.number().int(),
});

export const GoalSchema = z.object({
  task: z.string(),
  successCriteria: z.array(GoalCriterionSchema),
  limits: GoalLimitsSchema,
  workingDir: z.string(),
});

export const GraphSchema = z.object({
  version: z.number().default(1),
  name: z.string().optional().nullable(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  goal: GoalSchema.optional().nullable(),
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
export type GetCpuUsageConfig = z.infer<typeof GetCpuUsageConfigSchema>;
export type GetMemoryUsageConfig = z.infer<typeof GetMemoryUsageConfigSchema>;
export type ListProcessesConfig = z.infer<typeof ListProcessesConfigSchema>;
export type DocumentQaRAGConfig = z.infer<typeof DocumentQaRAGConfigSchema>;
export type LocalVisionInterpreterConfig = z.infer<typeof LocalVisionInterpreterConfigSchema>;
export type UIActionConfig = z.infer<typeof UIActionConfigSchema>;
export type KillProcessConfig = z.infer<typeof KillProcessConfigSchema>;
export type NativeWindowControlConfig = z.infer<typeof NativeWindowControlConfigSchema>;
export type CallAgentConfig = z.infer<typeof CallAgentConfigSchema>;
export type ScreenCaptureConfig = z.infer<typeof ScreenCaptureConfigSchema>;
export type MouseKeyboardSimConfig = z.infer<typeof MouseKeyboardSimConfigSchema>;
export type LocalOCRConfig = z.infer<typeof LocalOCRConfigSchema>;
export type DuckDbQueryConfig = z.infer<typeof DuckDbQueryConfigSchema>;
export type WasmSandboxConfig = z.infer<typeof WasmSandboxConfigSchema>;

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type Graph = z.infer<typeof GraphSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type GoalCriterion = z.infer<typeof GoalCriterionSchema>;
export type GoalCheck = z.infer<typeof GoalCheckSchema>;
export type GoalLimits = z.infer<typeof GoalLimitsSchema>;
