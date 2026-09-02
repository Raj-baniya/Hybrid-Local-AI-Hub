/**
 * dynamicGraphSynthesizer.ts
 * Real-Time Dynamic NLP Graph Synthesizer for Hybrid Local AI Hub.
 * Analyzes ANY user prompt in real-time and constructs tailored node graphs
 * with valid DAG topology — featuring rich specialized agent nodes.
 */

import type { GraphState } from "./graphSchema";

export function synthesizeDynamicGraph(prompt: string): GraphState {
  const lower = prompt ? prompt.toLowerCase() : "";

  // Dynamic Title generation
  const words = prompt.trim().split(/\s+/).slice(0, 6).join(" ");
  const title = words ? `${words.charAt(0).toUpperCase() + words.slice(1)} Pipeline` : "Custom AI Agent Pipeline";

  const nodes: GraphState["nodes"] = [];
  const edges: GraphState["edges"] = [];

  let nodeCounter = 1;
  const nextId = () => `n${nodeCounter++}`;

  // Domain Detection Flags
  const isCoding = lower.includes("code") || lower.includes("script") || lower.includes("python") || lower.includes("rust") || lower.includes("refactor") || lower.includes("bug") || lower.includes("developer");
  const isWeb = lower.includes("web") || lower.includes("scrape") || lower.includes("crawl") || lower.includes("site") || lower.includes("url") || lower.includes("browser") || lower.includes("price");
  const isOrchestrated = lower.includes("multi") || lower.includes("team") || lower.includes("orchestrat") || lower.includes("coordinate") || lower.includes("complex") || lower.includes("workflow");
  const isRAG = lower.includes("pdf") || lower.includes("search") || lower.includes("embed") || lower.includes("chroma") || lower.includes("doc") || lower.includes("rag") || lower.includes("policy") || lower.includes("knowledge");
  const isVision = lower.includes("image") || lower.includes("photo") || lower.includes("picture") || lower.includes("vision") || lower.includes("camera") || lower.includes("inspect");
  const isRouter = lower.includes("if") || lower.includes("filter") || lower.includes("urgent") || lower.includes("check") || lower.includes("branch");

  // 1. Inputs
  const inputId = nextId();
  if (isVision) {
    nodes.push({
      id: inputId,
      type: "image_input",
      label: "Image / Photo Input",
      position: { x: 0, y: 0 },
      data: {},
    });
  } else if (isRAG || lower.includes("file") || lower.includes("folder")) {
    nodes.push({
      id: inputId,
      type: "file_watcher",
      label: "Document / File Ingest",
      position: { x: 0, y: 0 },
      data: { watch_path: "" },
    });
  } else {
    nodes.push({
      id: inputId,
      type: "text_input",
      label: "User Prompt Input",
      position: { x: 0, y: 0 },
      data: { default_text: prompt },
    });
  }

  let currentX = 250;
  let lastNodeId = inputId;

  // 2. Multi-Agent Orchestrator if requested or complex
  if (isOrchestrated || (isCoding && isWeb)) {
    const orchId = nextId();
    nodes.push({
      id: orchId,
      type: "orchestrator_agent",
      label: "Orchestrator Agent",
      position: { x: currentX, y: 0 },
      data: { task: prompt },
    });
    edges.push({ id: `e_${lastNodeId}_${orchId}`, source: lastNodeId, target: orchId });
    lastNodeId = orchId;
    currentX += 250;
  }

  // 3. Domain Specific Sub-Agents & Processing
  if (isCoding) {
    const codeId = nextId();
    nodes.push({
      id: codeId,
      type: "coding_agent",
      label: "Python / Code Executor",
      position: { x: currentX, y: 0 },
      data: { task: "Write & test code locally" },
    });
    edges.push({ id: `e_${lastNodeId}_${codeId}`, source: lastNodeId, target: codeId });
    lastNodeId = codeId;
    currentX += 250;

    const optId = nextId();
    nodes.push({
      id: optId,
      type: "evaluator_optimizer",
      label: "Code Evaluator & Optimizer",
      position: { x: currentX, y: 0 },
      data: {},
    });
    edges.push({ id: `e_${lastNodeId}_${optId}`, source: lastNodeId, target: optId });
    lastNodeId = optId;
    currentX += 250;
  } else if (isWeb) {
    const webId = nextId();
    nodes.push({
      id: webId,
      type: "web_surfer_agent",
      label: "Web Scraper / Surfer Agent",
      position: { x: currentX, y: 0 },
      data: {},
    });
    edges.push({ id: `e_${lastNodeId}_${webId}`, source: lastNodeId, target: webId });
    lastNodeId = webId;
    currentX += 250;
  } else if (isRAG) {
    const embedId = nextId();
    nodes.push({
      id: embedId,
      type: "local_embedder",
      label: "Local Embedder (nomic-embed)",
      position: { x: currentX, y: 0 },
      data: { model: "nomic-embed-text" },
    });
    edges.push({ id: `e_${lastNodeId}_${embedId}`, source: lastNodeId, target: embedId });
    currentX += 250;

    const chromaId = nextId();
    nodes.push({
      id: chromaId,
      type: "chromadb_store",
      label: "ChromaDB Knowledge Store",
      position: { x: currentX, y: 0 },
      data: { collection_name: "kb", mode: "read" },
    });
    edges.push({ id: `e_${embedId}_${chromaId}`, source: embedId, target: chromaId });
    lastNodeId = chromaId;
    currentX += 250;
  }

  // 4. Conditional Router
  let routerId: string | null = null;
  if (isRouter) {
    routerId = nextId();
    nodes.push({
      id: routerId,
      type: "conditional_router",
      label: "Condition Filter Router",
      position: { x: currentX, y: 0 },
      data: { condition_type: "has_text" },
    });
    edges.push({ id: `e_${lastNodeId}_${routerId}`, source: lastNodeId, target: routerId });
    lastNodeId = routerId;
    currentX += 250;
  }

  // 5. Primary Ollama LLM Inference Node
  const llmId = nextId();
  const modelToUse = isVision ? "llama3.2-vision" : "llama3.2";
  nodes.push({
    id: llmId,
    type: "ollama_selector",
    label: isVision ? "Vision AI Model (llama3.2-vision)" : "Local AI Inference (llama3.2)",
    position: { x: currentX, y: routerId ? -75 : 0 },
    data: { model: modelToUse },
  });

  if (routerId) {
    edges.push({ id: `e_${routerId}_${llmId}`, source: routerId, target: llmId, condition: "true" });
  } else {
    edges.push({ id: `e_${lastNodeId}_${llmId}`, source: lastNodeId, target: llmId });
  }
  lastNodeId = llmId;
  currentX += 250;

  // 6. Outputs (Log Terminal & File Writer)
  if (routerId) {
    const logId = nextId();
    nodes.push({
      id: logId,
      type: "log_terminal",
      label: "Log Alert Terminal",
      position: { x: currentX, y: 75 },
      data: {},
    });
    edges.push({ id: `e_${routerId}_${logId}`, source: routerId, target: logId, condition: "false" });
  }

  const writerId = nextId();
  nodes.push({
    id: writerId,
    type: "local_file_writer",
    label: "Save Report / Artifact",
    position: { x: currentX, y: routerId ? -75 : 0 },
    data: { output_path: "", format: "md" },
  });
  edges.push({ id: `e_${llmId}_${writerId}`, source: llmId, target: writerId });

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
