import { useState, useEffect } from "react";
import { safeInvoke } from "../lib/tauriBridge";
import { useGraphStore } from "../lib/useGraphStore";

interface NodeInspectorProps {
  selectedNodeId: string | null;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Knowledge Base & Documentation Catalog
// ─────────────────────────────────────────────────────────────────────────────

interface NodeDoc {
  icon: string;
  title: string;
  category: "Input" | "LLM & AI" | "Vector & RAG" | "Agent" | "Logic & Control" | "Output & Storage";
  desc: string;
  processes: string[];
  inputs: string;
  outputs: string;
}

const NODE_CATALOG: Record<string, NodeDoc> = {
  file_watcher: {
    icon: "📂",
    title: "File System Watcher",
    category: "Input",
    desc: "Continuously monitors a local directory in real-time for file creation, modification, or deletion. Automatically triggers downstream workflow execution.",
    processes: [
      "Real-time OS directory file system monitoring",
      "File extension filtering (.csv, .pdf, .txt, .json)",
      "Automatic change detection & event payload generation",
      "Debounced event forwarding to downstream nodes",
    ],
    inputs: "Local folder path configuration",
    outputs: "file_path, file_content, event_type ('created' | 'modified')",
  },

  image_input: {
    icon: "🖼️",
    title: "Multimodal Image Loader",
    category: "Input",
    desc: "Loads local image files (PNG, JPG, WebP) and converts them into Base64 format for multimodal LLMs (like qwen2.5vl:7b or llama3.2-vision).",
    processes: [
      "Local image file selection & validation",
      "Auto-conversion to Base64 data strings",
      "Image dimensions & format metadata extraction",
      "Direct feed into Vision-Language LLM nodes",
    ],
    inputs: "Image file path (via file picker)",
    outputs: "image_base64, image_path",
  },

  text_input: {
    icon: "📝",
    title: "Text & Prompt Input",
    category: "Input",
    desc: "Supplies custom text prompts, raw data, or task instructions into the AI pipeline.",
    processes: [
      "Multi-line static text & template prompt storage",
      "Variable injection & string formatting",
      "System prompt seeding for downstream LLMs",
    ],
    inputs: "User typed text or imported document text",
    outputs: "text_content",
  },

  local_embedder: {
    icon: "🧠",
    title: "Local Vector Embedder",
    category: "Vector & RAG",
    desc: "Generates high-dimensional vector embeddings locally using models like nomic-embed-text. Zero cloud dependency.",
    processes: [
      "Dense vector embedding generation (768-dim floats)",
      "Text chunking & token normalization",
      "Batch vector computation for documents",
      "Direct feed into ChromaDB vector store",
    ],
    inputs: "text_content",
    outputs: "embedding_vector (Array of floats)",
  },

  chromadb_store: {
    icon: "🗄️",
    title: "ChromaDB Local Vector Database",
    category: "Vector & RAG",
    desc: "Embedded local vector store for saving and querying document vectors to enable Retrieval-Augmented Generation (RAG).",
    processes: [
      "Vector upserting (storing text + embeddings + metadata)",
      "Cosine & Euclidean semantic similarity search",
      "RAG document retrieval for context expansion",
      "Collection creation, querying, and management",
    ],
    inputs: "text_content, embedding_vector, query",
    outputs: "retrieved_documents, similarity_scores",
  },

  ollama_selector: {
    icon: "🤖",
    title: "Ollama LLM Engine",
    category: "LLM & AI",
    desc: "Runs local LLM inference (qwen2.5vl:7b, llama3.2, deepseek-r1, phi4) for text generation, vision reasoning, and XML tool execution.",
    processes: [
      "Zero-cloud text generation & logical reasoning",
      "Multimodal image analysis & OCR reading",
      "XML function call parsing & system prompt execution",
      "Custom system prompt injection & parameter tuning",
    ],
    inputs: "prompt, system_prompt, image_base64, context",
    outputs: "response_text, parsed_tool_calls",
  },

  conditional_router: {
    icon: "⑂",
    title: "If-Else Branch Router",
    category: "Logic & Control",
    desc: "Evaluates incoming data conditions (e.g. checking for image files, keywords, or expressions) and routes output to True or False branches.",
    processes: [
      "Dynamic payload condition evaluation",
      "File type routing (Image vs Document vs Code)",
      "Regex & string pattern matching",
      "Dual-path workflow execution branching",
    ],
    inputs: "data payload",
    outputs: "true_branch (Path A), false_branch (Path B)",
  },

  local_file_writer: {
    icon: "💾",
    title: "Local File System Writer",
    category: "Output & Storage",
    desc: "Saves generated text, reports, code, or structured JSON directly to specified folders on your machine.",
    processes: [
      "File creation in Markdown (.md), Text (.txt), or JSON (.json)",
      "Automatic parent directory creation",
      "Overwrite or append file content modes",
    ],
    inputs: "content, output_path, format",
    outputs: "saved_file_path, write_status",
  },

  log_terminal: {
    icon: "🖥️",
    title: "Log Terminal Streamer",
    category: "Output & Storage",
    desc: "Captures and displays real-time execution logs, tool calls, trajectory steps, and output messages.",
    processes: [
      "Live log streaming with colorized severity highlights",
      "Step history recording & timestamping",
      "Error traceback capture & formatting",
    ],
    inputs: "Any string log message or agent payload",
    outputs: "Formatted terminal view",
  },

  orchestrator_agent: {
    icon: "🎯",
    title: "Master Orchestrator",
    category: "Agent",
    desc: "Master supervisor agent that analyzes high-level user tasks, creates sub-task execution plans, and coordinates worker agents.",
    processes: [
      "Task breakdown & strategy synthesis",
      "Worker agent delegation (Coding Agent, File Agent)",
      "Multi-round trajectory evaluation",
      "Final synthesis report generation",
    ],
    inputs: "user_task specification",
    outputs: "final_synthesis_report, agent_trajectory",
  },

  local_file_agent: {
    icon: "📁",
    title: "Local File System Agent",
    category: "Agent",
    desc: "Autonomous worker agent specialized in exploring local directories, reading files, writing documents, and listing file metadata.",
    processes: [
      "File reading (read_file) & writing (write_file)",
      "Directory listing (list_files) & file info inspection",
      "Document summarization & data extraction",
    ],
    inputs: "File operation task prompt",
    outputs: "file_data, operation_result",
  },

  coding_agent: {
    icon: "💻",
    title: "Python Coding & Self-Play Agent",
    category: "Agent",
    desc: "Writes Python code, executes it in a local sandbox, detects runtime errors from stderr, and fixes bugs automatically via self-play retries.",
    processes: [
      "Automated Python code generation",
      "Sandboxed local process execution",
      "Stderr error detection & self-play auto-debugging (up to 5 retries)",
      "Data calculations, statistics, & file processing",
    ],
    inputs: "Coding task specification",
    outputs: "python_code, execution_output, generated_files",
  },

  web_surfer_agent: {
    icon: "🌐",
    title: "Web & Document Surfer Agent",
    category: "Agent",
    desc: "Inspects local HTML pages, documentation, markdown notes, and structured web data offline.",
    processes: [
      "Offline HTML to Markdown parsing",
      "Documentation context extraction",
      "Key point summarization",
    ],
    inputs: "url or local HTML file path",
    outputs: "parsed_markdown, summary",
  },

  vote_aggregator: {
    icon: "⧖",
    title: "Majority Vote Aggregator",
    category: "Logic & Control",
    desc: "Executes multiple LLM agents concurrently on the same task and tallies their answers to select the consensus best result.",
    processes: [
      "Parallel agent response collection",
      "Majority voting & frequency scoring",
      "Consensus selection & tie-breaker evaluation",
    ],
    inputs: "Multiple agent outputs",
    outputs: "consensus_answer, vote_breakdown",
  },

  evaluator_optimizer: {
    icon: "↺",
    title: "Evaluator-Optimizer Loop",
    category: "Logic & Control",
    desc: "Iterative feedback loop where a Generator Agent produces content and an Evaluator Agent critiques it until quality criteria are met.",
    processes: [
      "Generator output quality evaluation against rubrics",
      "Targeted improvement feedback prompt generation",
      "Iterative refinement loop control (up to max iterations)",
    ],
    inputs: "initial_task, quality_criteria",
    outputs: "optimized_result, refinement_history",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Node Inspector Component
// ─────────────────────────────────────────────────────────────────────────────

export default function NodeInspector({ selectedNodeId, onClose }: NodeInspectorProps): React.JSX.Element | null {
  const graph = useGraphStore((s) => s.graph);
  const setGraph = useGraphStore((s) => s.setGraph);

  const [activeTab, setActiveTab] = useState<"config" | "details">("details");
  const [ollamaModels, setOllamaModels] = useState<string[]>([
    "qwen2.5vl:7b",
    "qwen2.5:latest",
    "llama3.2:latest",
    "llama3.2-vision:latest",
    "nomic-embed-text:latest",
    "deepseek-r1:7b",
    "phi4",
  ]);

  useEffect(() => {
    safeInvoke<string[]>("list_ollama_models")
      .then((models) => {
        if (models && models.length > 0) setOllamaModels(models);
      })
      .catch(() => {});
  }, []);

  if (!selectedNodeId) return null;

  const node = graph.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const nodeData = node.data ?? {};
  const doc = NODE_CATALOG[node.type] ?? {
    icon: "⚙️",
    title: node.label || node.type,
    category: "LLM & AI" as const,
    desc: "Custom node in the Hybrid Local AI Hub workflow graph.",
    processes: ["Process pipeline input data", "Execute configured parameters", "Forward results to connected nodes"],
    inputs: "Connected node output payload",
    outputs: "Processed data payload",
  };

  const updateDataField = (key: string, val: unknown) => {
    const updatedNodes = graph.nodes.map((n) =>
      n.id === selectedNodeId ? { ...n, data: { ...(n.data ?? {}), [key]: val } } : n
    );
    setGraph({ ...graph, nodes: updatedNodes });
  };

  const updateLabel = (newLabel: string) => {
    const updatedNodes = graph.nodes.map((n) =>
      n.id === selectedNodeId ? { ...n, label: newLabel } : n
    );
    setGraph({ ...graph, nodes: updatedNodes });
  };

  const handleDeleteNode = () => {
    const updatedNodes = graph.nodes.filter((n) => n.id !== selectedNodeId);
    const updatedEdges = graph.edges.filter(
      (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
    );
    setGraph({ ...graph, nodes: updatedNodes, edges: updatedEdges });
    onClose();
  };

  const handlePickFolder = async () => {
    try {
      const path = await safeInvoke<string>("pick_folder");
      updateDataField("watch_path", path);
      updateDataField("output_path", path);
    } catch {}
  };

  const handlePickImage = async () => {
    try {
      const path = await safeInvoke<string>("pick_image");
      updateDataField("image_path", path);
    } catch {}
  };

  return (
    <div className="w-80 border-l-2 border-slate-900 bg-white p-4 flex flex-col h-full shadow-lg z-20 text-slate-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3 mb-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">{doc.icon}</span>
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-slate-900 truncate">{node.label || doc.title}</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-violet-100 text-violet-900 border border-violet-300">
                {doc.category}
              </span>
              <span className="text-[9px] font-mono text-slate-400 truncate">{node.id}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-900 text-xl font-bold leading-none cursor-pointer shrink-0 ml-1"
        >
          ×
        </button>
      </div>

      {/* Mode Tabs: Details vs Config */}
      <div className="flex border-b-2 border-slate-900 bg-slate-100 p-0.5 mb-3 rounded shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab("details")}
          className={`flex-1 py-1 text-[10px] font-bold rounded transition-colors cursor-pointer ${
            activeTab === "details"
              ? "bg-white text-violet-900 border-2 border-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          📖 Process Details
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("config")}
          className={`flex-1 py-1 text-[10px] font-bold rounded transition-colors cursor-pointer ${
            activeTab === "config"
              ? "bg-white text-violet-900 border-2 border-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          ⚙️ Settings
        </button>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto space-y-3 text-xs font-medium pr-1">

        {activeTab === "details" ? (
          /* ── Tab 1: Detailed Node Documentation & Processes ── */
          <div className="space-y-3">
            {/* Overview */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
              <h4 className="text-[11px] font-bold text-slate-800 mb-1 flex items-center gap-1">
                <span>ℹ️</span> Overview
              </h4>
              <p className="text-[10px] text-slate-600 leading-relaxed">{doc.desc}</p>
            </div>

            {/* Processes It Performs */}
            <div className="bg-violet-50/60 border border-violet-200 rounded-lg p-2.5">
              <h4 className="text-[11px] font-bold text-violet-900 mb-1.5 flex items-center gap-1">
                <span>⚡</span> Processes It Performs
              </h4>
              <ul className="space-y-1">
                {doc.processes.map((p, i) => (
                  <li key={i} className="text-[10px] text-slate-700 flex items-start gap-1.5">
                    <span className="text-violet-600 font-bold font-mono">▸</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Data Flow (Inputs & Outputs) */}
            <div className="grid grid-cols-1 gap-2">
              <div className="bg-sky-50/60 border border-sky-200 rounded-lg p-2">
                <div className="text-[10px] font-bold text-sky-900 mb-0.5 flex items-center gap-1">
                  <span>📥</span> Expected Input
                </div>
                <div className="text-[9px] text-sky-800 font-mono leading-tight">{doc.inputs}</div>
              </div>
              <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-2">
                <div className="text-[10px] font-bold text-emerald-900 mb-0.5 flex items-center gap-1">
                  <span>📤</span> Output Produced
                </div>
                <div className="text-[9px] text-emerald-800 font-mono leading-tight">{doc.outputs}</div>
              </div>
            </div>
          </div>
        ) : (
          /* ── Tab 2: Settings & Configuration ── */
          <div className="space-y-3">
            <div>
              <label className="block text-slate-700 mb-1 font-bold">Node Label</label>
              <input
                type="text"
                value={node.label || ""}
                onChange={(e) => updateLabel(e.target.value)}
                className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-bold"
              />
            </div>

            {/* Dynamic Config Fields based on Node Type */}
            {node.type === "file_watcher" && (
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Watch Directory Path</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={(nodeData.watch_path as string) || ""}
                    onChange={(e) => updateDataField("watch_path", e.target.value)}
                    placeholder="/path/to/folder"
                    className="flex-1 bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-medium text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-900 border-2 border-slate-900 px-2.5 py-1 rounded text-xs font-bold cursor-pointer"
                  >
                    Browse...
                  </button>
                </div>
              </div>
            )}

            {node.type === "image_input" && (
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Image File Path</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={(nodeData.image_path as string) || ""}
                    onChange={(e) => updateDataField("image_path", e.target.value)}
                    placeholder="/path/to/image.png"
                    className="flex-1 bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-medium text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={handlePickImage}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-900 border-2 border-slate-900 px-2.5 py-1 rounded text-xs font-bold cursor-pointer"
                  >
                    Browse...
                  </button>
                </div>
              </div>
            )}

            {node.type === "text_input" && (
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Default Text / Prompt</label>
                <textarea
                  value={(nodeData.default_text as string) || ""}
                  onChange={(e) => updateDataField("default_text", e.target.value)}
                  placeholder="Enter custom prompt text..."
                  className="w-full h-24 bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white resize-none font-medium text-[11px]"
                />
              </div>
            )}

            {(node.type === "ollama_selector" || node.type === "local_embedder" || node.type === "orchestrator_agent" || node.type === "coding_agent" || node.type === "local_file_agent" || node.type === "web_surfer_agent") && (
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Ollama Model</label>
                <select
                  value={(nodeData.model as string) || "qwen2.5vl:7b"}
                  onChange={(e) => updateDataField("model", e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-bold text-[11px]"
                >
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(node.type === "ollama_selector" || node.type.includes("agent")) && (
              <div>
                <label className="block text-slate-700 mb-1 font-bold">System Prompt Override</label>
                <textarea
                  value={(nodeData.system_prompt as string) || ""}
                  onChange={(e) => updateDataField("system_prompt", e.target.value)}
                  placeholder="Optional custom instructions for this LLM node..."
                  className="w-full h-20 bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white resize-none font-mono text-[10px]"
                />
              </div>
            )}

            {node.type === "chromadb_store" && (
              <>
                <div>
                  <label className="block text-slate-700 mb-1 font-bold">Collection Name</label>
                  <input
                    type="text"
                    value={(nodeData.collection_name as string) || "my_collection"}
                    onChange={(e) => updateDataField("collection_name", e.target.value)}
                    className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-bold">Mode</label>
                  <select
                    value={(nodeData.mode as string) || "write"}
                    onChange={(e) => updateDataField("mode", e.target.value)}
                    className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-bold"
                  >
                    <option value="read">Read (RAG Query)</option>
                    <option value="write">Write (Upsert Vectors)</option>
                  </select>
                </div>
              </>
            )}

            {node.type === "conditional_router" && (
              <>
                <div>
                  <label className="block text-slate-700 mb-1 font-bold">Condition Type</label>
                  <select
                    value={(nodeData.condition_type as string) || "has_image"}
                    onChange={(e) => updateDataField("condition_type", e.target.value)}
                    className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-bold"
                  >
                    <option value="has_image">Has Image File</option>
                    <option value="has_text">Has Text</option>
                    <option value="custom">Custom Expression</option>
                  </select>
                </div>
                {nodeData.condition_type === "custom" && (
                  <div>
                    <label className="block text-slate-700 mb-1 font-bold">Expression</label>
                    <input
                      type="text"
                      value={(nodeData.expression as string) || ""}
                      onChange={(e) => updateDataField("expression", e.target.value)}
                      placeholder="e.g. text.includes('urgent')"
                      className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-medium"
                    />
                  </div>
                )}
              </>
            )}

            {node.type === "local_file_writer" && (
              <>
                <div>
                  <label className="block text-slate-700 mb-1 font-bold">Output Directory</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={(nodeData.output_path as string) || ""}
                      onChange={(e) => updateDataField("output_path", e.target.value)}
                      placeholder="/output/dir"
                      className="flex-1 bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-medium text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={handlePickFolder}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-900 border-2 border-slate-900 px-2.5 py-1 rounded text-xs font-bold cursor-pointer"
                    >
                      Browse...
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-bold">Format</label>
                  <select
                    value={(nodeData.format as string) || "md"}
                    onChange={(e) => updateDataField("format", e.target.value)}
                    className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-bold"
                  >
                    <option value="md">Markdown (.md)</option>
                    <option value="txt">Plain Text (.txt)</option>
                    <option value="json">JSON (.json)</option>
                  </select>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer Delete Button */}
      <div className="pt-3 border-t-2 border-slate-900 mt-auto shrink-0">
        <button
          type="button"
          onClick={handleDeleteNode}
          className="w-full py-2 bg-rose-100 hover:bg-rose-200 text-rose-900 border-2 border-slate-900 rounded text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1"
        >
          🗑 Delete Node
        </button>
      </div>
    </div>
  );
}
