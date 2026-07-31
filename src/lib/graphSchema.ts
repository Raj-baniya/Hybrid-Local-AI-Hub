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
]);

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
  condition: z.string().optional(), // for conditional_router branches, e.g. "if_image"
});

export const GraphStateSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  meta: z.object({
    title: z.string(),
    generated_from_prompt: z.string().optional(), // present only if AI-generated
  }).optional(),
});

export type GraphState = z.infer<typeof GraphStateSchema>;
