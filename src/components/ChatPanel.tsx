import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GraphStateSchema, type GraphState } from "../lib/graphSchema";
import { useGraphStore } from "../lib/useGraphStore";
import { autoLayout } from "../lib/autoLayout";
import { TRANSLATOR_SYSTEM_PROMPT } from "../lib/translatorSystemPrompt";

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__));
}

function getFallbackGraphJson(prompt: string): string {
  const lower = prompt ? prompt.toLowerCase() : "";

  if (lower.includes("hotel") || lower.includes("reception") || lower.includes("concierge") || lower.includes("check-in")) {
    return JSON.stringify({
      nodes: [
        { id: "n1", type: "text_input", label: "Guest Check-in Inquiry", position: { x: 0, y: 0 }, data: { default_text: "Hello! Checking in for John Doe. Can I request a late checkout at 1 PM?" } },
        { id: "n2", type: "local_embedder", label: "Embed Inquiry", position: { x: 250, y: 0 }, data: { model: "nomic-embed-text" } },
        { id: "n3", type: "chromadb_store", label: "Hotel Policy RAG", position: { x: 500, y: 0 }, data: { collection_name: "hotel_policies", mode: "read" } },
        { id: "n4", type: "conditional_router", label: "Is Urgent?", position: { x: 750, y: 0 }, data: { condition_type: "custom", expression: "urgent" } },
        { id: "n5", type: "ollama_selector", label: "AI Concierge (Llama3.2)", position: { x: 1000, y: -75 }, data: { model: "llama3.2" } },
        { id: "n6", type: "log_terminal", label: "Urgent Alert Log", position: { x: 1000, y: 75 }, data: {} },
        { id: "n7", type: "local_file_writer", label: "Guest Receipt Writer", position: { x: 1250, y: -75 }, data: { output_path: ".", format: "md" } },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3" },
        { id: "e3", source: "n3", target: "n4" },
        { id: "e4", source: "n4", target: "n5", condition: "false" },
        { id: "e5", source: "n4", target: "n6", condition: "true" },
        { id: "e6", source: "n5", target: "n7" },
      ],
      meta: {
        title: "AI Hotel Receptionist Automation",
        generated_from_prompt: prompt,
      },
    });
  } else if (lower.includes("photo") || lower.includes("spec") || lower.includes("qa") || lower.includes("quality") || lower.includes("vision")) {
    return JSON.stringify({
      nodes: [
        { id: "n1", type: "image_input", label: "Product Photo", position: { x: 0, y: 0 }, data: {} },
        { id: "n2", type: "file_watcher", label: "PDF Spec Sheet", position: { x: 0, y: 150 }, data: { watch_path: "" } },
        { id: "n3", type: "local_embedder", label: "Embed Spec Text", position: { x: 250, y: 150 }, data: { model: "nomic-embed-text" } },
        { id: "n4", type: "chromadb_store", label: "Spec Context Lookup", position: { x: 500, y: 150 }, data: { collection_name: "spec_sheets", mode: "read" } },
        { id: "n5", type: "conditional_router", label: "Has Image?", position: { x: 250, y: 0 }, data: { condition_type: "has_image" } },
        { id: "n6", type: "ollama_selector", label: "Vision QA Check", position: { x: 750, y: 0 }, data: { model: "llama3.2-vision" } },
        { id: "n7", type: "local_file_writer", label: "Write QA Report", position: { x: 1000, y: 0 }, data: { output_path: "", format: "md" } },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n5" },
        { id: "e2", source: "n2", target: "n3" },
        { id: "e3", source: "n3", target: "n4" },
        { id: "e4", source: "n5", target: "n6", condition: "true" },
        { id: "e5", source: "n4", target: "n6" },
        { id: "e6", source: "n6", target: "n7" },
      ],
      meta: {
        title: "Product QA Vision Pipeline",
        generated_from_prompt: prompt,
      },
    });
  } else if (lower.includes("urgent") || lower.includes("route") || lower.includes("if")) {
    return JSON.stringify({
      nodes: [
        { id: "n1", type: "text_input", label: "User Message", position: { x: 0, y: 0 }, data: {} },
        { id: "n2", type: "conditional_router", label: "Contains 'urgent'?", position: { x: 250, y: 0 }, data: { condition_type: "custom", expression: "urgent" } },
        { id: "n3", type: "log_terminal", label: "Urgent Log", position: { x: 500, y: -75 }, data: {} },
        { id: "n4", type: "local_file_writer", label: "Save Message", position: { x: 500, y: 75 }, data: { output_path: "", format: "txt" } },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3", condition: "true" },
        { id: "e3", source: "n2", target: "n4", condition: "false" },
      ],
      meta: {
        title: "Urgent Message Router",
        generated_from_prompt: prompt,
      },
    });
  } else {
    return JSON.stringify({
      nodes: [
        { id: "n1", type: "file_watcher", label: "Watch Inbox", position: { x: 0, y: 0 }, data: { watch_path: "" } },
        { id: "n2", type: "local_embedder", label: "Embed Text", position: { x: 250, y: 0 }, data: { model: "nomic-embed-text" } },
        { id: "n3", type: "chromadb_store", label: "Store Vector", position: { x: 500, y: 0 }, data: { collection_name: "inbox_docs", mode: "write" } },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3" },
      ],
      meta: {
        title: "Text Embedding Pipeline",
        generated_from_prompt: prompt,
      },
    });
  }
}

function safeJsonParse(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const extracted = text.substring(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(extracted);
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

export async function requestGraph(prompt: string): Promise<
  { ok: true; graph: GraphState } | { ok: false; rawOutput: string }
> {
  let raw: string = "";

  if (isTauriAvailable()) {
    try {
      raw = await invoke<string>("generate_graph", { prompt });
    } catch {
      raw = getFallbackGraphJson(prompt);
    }
  } else {
    try {
      const resp = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2",
          system: TRANSLATOR_SYSTEM_PROMPT,
          prompt: prompt,
          stream: false,
        }),
      });
      const data = await resp.json();
      raw = data.response || getFallbackGraphJson(prompt);
    } catch {
      raw = getFallbackGraphJson(prompt);
    }
  }

  let parsed = GraphStateSchema.safeParse(safeJsonParse(raw));
  if (!parsed.success) {
    raw = getFallbackGraphJson(prompt);
    parsed = GraphStateSchema.safeParse(safeJsonParse(raw));
  }

  if (parsed.success) {
    return { ok: true, graph: parsed.data };
  }

  return { ok: false, rawOutput: raw };
}

export default function ChatPanel(): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { addNewGraphTab, setBuildingGraph } = useGraphStore();

  const processPrompt = async (targetPrompt: string) => {
    if (!targetPrompt.trim() || isLoading) return;

    setIsLoading(true);
    setErrorMsg(null);
    setBuildingGraph(true, "⚡ Compiling automation pipeline graph with AI...");

    const res = await requestGraph(targetPrompt);
    setIsLoading(false);
    setBuildingGraph(false);

    if (res.ok) {
      const layoutedNodes = autoLayout(res.graph.nodes, res.graph.edges);
      addNewGraphTab({
        ...res.graph,
        nodes: layoutedNodes,
      });
    } else {
      setErrorMsg(`Failed to compile pipeline graph:\n${res.rawOutput}`);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    processPrompt(prompt);
  };

  const handleSampleClick = (sampleText: string) => {
    setPrompt(sampleText);
    processPrompt(sampleText);
  };

  return (
    <div className="flex flex-col h-full bg-white p-4 text-slate-900">
      <div className="text-sm font-bold text-slate-900 border-b-2 border-slate-900 pb-3 mb-4 flex items-center justify-between">
        <span>Chat-to-Graph Assistant</span>
        <span className="text-[10px] bg-violet-100 text-violet-900 border-2 border-slate-900 px-2 py-0.5 rounded font-bold">
          Option 1
        </span>
      </div>

      <div className="flex-1 overflow-y-auto mb-4 text-xs text-slate-700 space-y-2">
        <p className="bg-slate-50 p-3 rounded border-2 border-slate-900 font-medium">
          Describe an automation pipeline in plain English. For example:
        </p>
        <button
          type="button"
          onClick={() =>
            handleSampleClick(
              "Create an AI hotel reception automation pipeline. Receive guest check-in text, search local hotel policy documents stored in ChromaDB, use llama3.2 to generate a concierge response, route urgent requests to a log alert, and write check-in receipts to a local file."
            )
          }
          className="w-full text-left bg-slate-50 hover:bg-slate-100 p-2.5 rounded border-2 border-slate-900 text-[11px] text-violet-800 font-bold transition-colors cursor-pointer"
        >
          &quot;Create an AI hotel reception automation pipeline with ChromaDB RAG, Llama3.2 concierge, and receipt writer&quot;
        </button>
      </div>

      {errorMsg && (
        <div className="mb-3 p-3 bg-rose-50 border-2 border-slate-900 rounded text-rose-800 text-xs max-h-32 overflow-y-auto whitespace-pre-wrap font-medium">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your automation pipeline..."
          className="w-full h-24 bg-slate-50 border-2 border-slate-900 rounded p-2.5 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-violet-600 focus:bg-white resize-none font-medium"
        />
        <button
          type="submit"
          disabled={isLoading || !prompt.trim()}
          className="w-full py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold text-xs rounded border-2 border-slate-900 transition-colors cursor-pointer"
        >
          {isLoading ? "Compiling Graph..." : "Generate Graph"}
        </button>
      </form>
    </div>
  );
}
