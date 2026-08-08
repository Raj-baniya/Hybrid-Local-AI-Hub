// graphSchema.ts
import { z } from "zod";

export const NodeTypeEnum = z.enum([
  "file_watcher",
  "image_input",
  "text_input",
  "local_embedder",
  "chromadb_store",
  "ollama_selector",
  "conditional_router",
  "local_file_writer",
  "log_terminal",
  "orchestrator_agent",
  "local_file_agent",
  "coding_agent",
  "web_surfer_agent",
  "vote_aggregator",
  "evaluator_optimizer",
]);

export type NodeType = z.infer<typeof NodeTypeEnum>;

// Per-node-type data schemas
export const FileWatcherDataSchema = z.object({
  watch_path: z.string().optional().default(""),
});

export const TextInputDataSchema = z.object({
  default_text: z.string().optional().default(""),
});

export const ImageInputDataSchema = z.object({
  image_path: z.string().optional(),
});

export const LocalEmbedderDataSchema = z.object({
  model: z.string().optional().default("nomic-embed-text"),
});

export const ChromaDbStoreDataSchema = z.object({
  collection_name: z.string().optional().default("default_collection"),
  mode: z.enum(["read", "write"]).optional().default("write"),
});

export const OllamaSelectorDataSchema = z.object({
  model: z.string().optional().default("llama3.2"),
  temperature: z.number().optional().default(0.7),
  system_prompt: z.string().optional(),
});

export const ConditionalRouterDataSchema = z.object({
  condition_type: z.enum(["has_image", "has_text", "custom"]).optional().default("has_text"),
  expression: z.string().optional().default(""),
});

export const LocalFileWriterDataSchema = z.object({
  output_path: z.string().optional().default(""),
  format: z.enum(["md", "txt", "json"]).optional().default("md"),
});

export const LogTerminalDataSchema = z.object({});

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeEnum,
  label: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()).optional(), // node-specific config
});

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  condition: z.string().optional(), // for conditional_router branches, e.g. "true" / "false"
});

export const GraphStateSchema = z.object({
  version: z.number().default(1),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  meta: z.object({
    title: z.string(),
    generated_from_prompt: z.string().optional(), // present only if AI-generated
  }).optional(),
});

export type GraphState = z.infer<typeof GraphStateSchema>;

