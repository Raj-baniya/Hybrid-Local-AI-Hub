/**
 * dynamicGraphSynthesizer.ts
 * Real-Time Dynamic NLP Graph Synthesizer for Hybrid Local AI Hub.
 * Analyzes ANY user prompt in real-time and constructs tailored node graphs
 * with valid DAG topology — eliminating hardcoded sample template dependencies.
 */

import type { GraphState } from "./graphSchema";

export function synthesizeDynamicGraph(prompt: string): GraphState {
  const lower = prompt ? prompt.toLowerCase() : "";

  // Title generation
  const words = prompt.trim().split(/\s+/).slice(0, 6).join(" ");
  const title = words ? `${words.charAt(0).toUpperCase() + words.slice(1)} Pipeline` : "Custom Automation Pipeline";

  const nodes: GraphState["nodes"] = [];
  const edges: GraphState["edges"] = [];

  let nodeCounter = 1;
  const nextId = () => `n${nodeCounter++}`;

  // 1. Detect Inputs
  const hasImage = lower.includes("image") || lower.includes("photo") || lower.includes("picture") || lower.includes("vision");
  const hasFile = lower.includes("file") || lower.includes("folder") || lower.includes("watch") || lower.includes("pdf") || lower.includes("doc") || lower.includes("csv");
  const hasRAG = lower.includes("embed") || lower.includes("vector") || lower.includes("chroma") || lower.includes("search") || lower.includes("lookup") || lower.includes("rag") || lower.includes("policy") || lower.includes("knowledge");
  const hasCondition = lower.includes("if") || lower.includes("filter") || lower.includes("check") || lower.includes("urgent") || lower.includes("route") || lower.includes("branch");
  const hasLog = lower.includes("log") || lower.includes("terminal font") || lower.includes("console") || lower.includes("alert");
  const hasWriter = lower.includes("save") || lower.includes("write") || lower.includes("report") || lower.includes("output") || lower.includes("receipt") || lower.includes("file") || !hasLog;

  let primaryInputId: string;
  let secondaryInputId: string | null = null;

  if (hasImage && hasFile) {
    primaryInputId = nextId();
    nodes.push({
      id: primaryInputId,
      type: "image_input",
      label: "Image / Visual Input",
      position: { x: 0, y: 0 },
      data: {},
    });
    secondaryInputId = nextId();
    nodes.push({
      id: secondaryInputId,
      type: "file_watcher",
      label: "Document / File Input",
      position: { x: 0, y: 150 },
      data: { watch_path: "" },
    });
  } else if (hasImage) {
    primaryInputId = nextId();
    nodes.push({
      id: primaryInputId,
      type: "image_input",
      label: "Image / Photo Input",
      position: { x: 0, y: 0 },
      data: {},
    });
  } else if (hasFile) {
    primaryInputId = nextId();
    nodes.push({
      id: primaryInputId,
      type: "file_watcher",
      label: "Watch Files / Folder",
      position: { x: 0, y: 0 },
      data: { watch_path: "" },
    });
  } else {
    primaryInputId = nextId();
    nodes.push({
      id: primaryInputId,
      type: "text_input",
      label: "User Text Input",
      position: { x: 0, y: 0 },
      data: { default_text: prompt },
    });
  }

  let lastNodeId = primaryInputId;
  let currentX = 250;

  // 2. RAG & Vector Storage Branch
  let ragStoreNodeId: string | null = null;
  if (hasRAG || secondaryInputId) {
    const ragInput = secondaryInputId || primaryInputId;
    const embedderId = nextId();
    nodes.push({
      id: embedderId,
      type: "local_embedder",
      label: "Embed Text (nomic-embed)",
      position: { x: currentX, y: secondaryInputId ? 150 : 0 },
      data: { model: "nomic-embed-text" },
    });
    edges.push({
      id: `e_${ragInput}_${embedderId}`,
      source: ragInput,
      target: embedderId,
    });

    ragStoreNodeId = nextId();
    const isReadMode = lower.includes("search") || lower.includes("lookup") || lower.includes("query") || lower.includes("rag") || lower.includes("check");
    nodes.push({
      id: ragStoreNodeId,
      type: "chromadb_store",
      label: isReadMode ? "ChromaDB Lookup (RAG)" : "ChromaDB Vector Store",
      position: { x: currentX + 250, y: secondaryInputId ? 150 : 0 },
      data: { collection_name: "local_knowledge_base", mode: isReadMode ? "read" : "write" },
    });
    edges.push({
      id: `e_${embedderId}_${ragStoreNodeId}`,
      source: embedderId,
      target: ragStoreNodeId,
    });

    if (!secondaryInputId) {
      lastNodeId = ragStoreNodeId;
      currentX += 500;
    }
  }

  // 3. Conditional Router Branch
  let routerId: string | null = null;
  if (hasCondition) {
    routerId = nextId();
    const expr = lower.includes("urgent") ? "urgent" : lower.includes("image") ? "has_image" : "has_text";
    nodes.push({
      id: routerId,
      type: "conditional_router",
      label: "Conditional Filter",
      position: { x: currentX, y: 0 },
      data: { condition_type: expr === "has_image" ? "has_image" : "custom", expression: expr },
    });
    edges.push({
      id: `e_${primaryInputId}_${routerId}`,
      source: primaryInputId,
      target: routerId,
    });
    lastNodeId = routerId;
    currentX += 250;
  }

  // 4. LLM Selector Node
  const llmNodeId = nextId();
  const modelToUse = hasImage ? "llama3.2-vision" : lower.includes("qwen") ? "qwen2.5" : "llama3.2";
  const llmLabel = hasImage
    ? "Vision AI Check (Llama3.2-Vision)"
    : lower.includes("summary") || lower.includes("summarize")
    ? "AI Summarizer (Llama3.2)"
    : lower.includes("analyze") || lower.includes("analysis")
    ? "AI Analyst (Llama3.2)"
    : "Local AI Generator";

  nodes.push({
    id: llmNodeId,
    type: "ollama_selector",
    label: llmLabel,
    position: { x: currentX, y: routerId ? -75 : 0 },
    data: { model: modelToUse },
  });

  if (routerId) {
    edges.push({
      id: `e_${routerId}_${llmNodeId}`,
      source: routerId,
      target: llmNodeId,
      condition: "true",
    });
  } else if (lastNodeId !== primaryInputId) {
    edges.push({
      id: `e_${lastNodeId}_${llmNodeId}`,
      source: lastNodeId,
      target: llmNodeId,
    });
  } else {
    edges.push({
      id: `e_${primaryInputId}_${llmNodeId}`,
      source: primaryInputId,
      target: llmNodeId,
    });
  }

  if (ragStoreNodeId && secondaryInputId) {
    edges.push({
      id: `e_${ragStoreNodeId}_${llmNodeId}`,
      source: ragStoreNodeId,
      target: llmNodeId,
    });
  }

  lastNodeId = llmNodeId;
  currentX += 250;

  // 5. Output Log Terminal / Branching
  if (hasLog && routerId) {
    const logId = nextId();
    nodes.push({
      id: logId,
      type: "log_terminal",
      label: "Log Alert Terminal",
      position: { x: currentX, y: 75 },
      data: {},
    });
    edges.push({
      id: `e_${routerId}_${logId}`,
      source: routerId,
      target: logId,
      condition: "false",
    });
  } else if (hasLog) {
    const logId = nextId();
    nodes.push({
      id: logId,
      type: "log_terminal",
      label: "Log Terminal Output",
      position: { x: currentX, y: 75 },
      data: {},
    });
    edges.push({
      id: `e_${llmNodeId}_${logId}`,
      source: llmNodeId,
      target: logId,
    });
  }

  // 6. File Writer Output
  if (hasWriter) {
    const writerId = nextId();
    const format = lower.includes("json") ? "json" : lower.includes("txt") ? "txt" : "md";
    nodes.push({
      id: writerId,
      type: "local_file_writer",
      label: `Write Result (${format.toUpperCase()})`,
      position: { x: currentX, y: routerId ? -75 : 0 },
      data: { output_path: "", format },
    });
    edges.push({
      id: `e_${llmNodeId}_${writerId}`,
      source: llmNodeId,
      target: writerId,
    });
  }

  return {
    version: 1,
    nodes,
    edges,
    meta: {
      title,
      generated_from_prompt: prompt,
    },
  };
}
