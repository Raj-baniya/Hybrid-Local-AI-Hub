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
  temperature: z.number().min(0).max(2).default(0.7),
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

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type Graph = z.infer<typeof GraphSchema>;
