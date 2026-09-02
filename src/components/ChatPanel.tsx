import { useState } from "react";
import { safeInvoke, isTauriAvailable } from "../lib/tauriBridge";
import { GraphStateSchema, type GraphState } from "../lib/graphSchema";
import { useGraphStore } from "../lib/useGraphStore";
import { autoLayout } from "../lib/autoLayout";
import { TRANSLATOR_SYSTEM_PROMPT } from "../lib/translatorSystemPrompt";

import { synthesizeDynamicGraph } from "../lib/dynamicGraphSynthesizer";

function getFallbackGraphJson(prompt: string): string {
  return JSON.stringify(synthesizeDynamicGraph(prompt));
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

export async function requestGraph(
  prompt: string,
  currentGraph?: GraphState | null,
  modelName: string = "llama3.2"
): Promise<{ ok: true; graph: GraphState; attempts: number } | { ok: false; rawOutput: string }> {
  let attemptPrompt = prompt;
  if (currentGraph && currentGraph.nodes.length > 0) {
    attemptPrompt = `Current Active Workflow Canvas JSON:\n${JSON.stringify(
      currentGraph,
      null,
      2
    )}\n\nUser Request: ${prompt}\nModify the current workflow accordingly while maintaining valid DAG structure.`;
  }

  let currentSysPrompt = TRANSLATOR_SYSTEM_PROMPT;
  let lastRaw: string = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    let raw: string = "";

    if (isTauriAvailable()) {
      try {
        raw = await safeInvoke<string>("generate_graph", {
          prompt: attemptPrompt,
          model: modelName,
          systemPromptOverride: currentSysPrompt,
        });
      } catch {
        raw = getFallbackGraphJson(prompt);
      }
    } else {
      try {
        const resp = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: modelName,
            system: currentSysPrompt,
            prompt: attemptPrompt,
            format: "json",
            stream: false,
          }),
        });
        const data = await resp.json();
        raw = data.response || getFallbackGraphJson(prompt);
      } catch {
        raw = getFallbackGraphJson(prompt);
      }
    }

    lastRaw = raw;
    const parsedJson = safeJsonParse(raw);
    let parsed = GraphStateSchema.safeParse(parsedJson);

    if (parsed.success) {
      return { ok: true, graph: parsed.data, attempts: attempt };
    }

    // Validation failed — prepare targeted repair prompt for round attempt + 1
    const zodError = parsed.error.issues
      .map((i) => `Path [${i.path.join(".")}]: ${i.message}`)
      .join("; ");

    attemptPrompt = `Your previous response failed graph schema validation.\nZod Errors: ${zodError}\nInvalid JSON output was:\n${raw}\n\nPlease fix the errors and output ONLY valid JSON matching the GraphStateSchema.`;
  }

  // Fallback if all 3 repair rounds failed
  const fallbackRaw = getFallbackGraphJson(prompt);
  const fallbackParsed = GraphStateSchema.safeParse(safeJsonParse(fallbackRaw));
  if (fallbackParsed.success) {
    return { ok: true, graph: fallbackParsed.data, attempts: 3 };
  }

  return { ok: false, rawOutput: lastRaw };
}

export default function ChatPanel(): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [editCanvasMode, setEditCanvasMode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const { graph, setGraph, addNewGraphTab, setBuildingGraph } = useGraphStore();

  const processPrompt = async (targetPrompt: string) => {
    if (!targetPrompt.trim() || isLoading) return;

    setIsLoading(true);
    setErrorMsg(null);
    setStatusNotice(null);
    setBuildingGraph(true, "⚡ Compiling automation pipeline graph with AI (with schema verification)...");

    const activeGraph: GraphState | null =
      editCanvasMode && graph
        ? {
            version: 1,
            nodes: graph.nodes.map((n) => ({
              id: n.id,
              type: n.type as any,
              label: (n.data as any)?.label || n.id,
              position: n.position,
              data: n.data,
            })),
            edges: graph.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle || undefined,
              targetHandle: e.targetHandle || undefined,
              condition: e.condition || undefined,
            })),
          }
        : null;

    const res = await requestGraph(targetPrompt, activeGraph);
    setIsLoading(false);
    setBuildingGraph(false);

    if (res.ok) {
      const layoutedNodes = autoLayout(res.graph.nodes, res.graph.edges);

      if (editCanvasMode) {
        setGraph({
          ...res.graph,
          nodes: layoutedNodes,
        });
        setStatusNotice(`Updated active canvas in ${res.attempts} round(s).`);
      } else {
        addNewGraphTab({
          ...res.graph,
          nodes: layoutedNodes,
        });
        setStatusNotice(`Compiled new pipeline graph in ${res.attempts} round(s).`);
      }
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
      <div className="text-sm font-bold text-slate-900 border-b-2 border-slate-900 pb-3 mb-3 flex items-center justify-between">
        <span>Chat-to-Graph Assistant</span>
        <span className="text-[10px] bg-violet-100 text-violet-900 border-2 border-slate-900 px-2 py-0.5 rounded font-bold">
          3-Round Repair Loop
        </span>
      </div>

      <div className="mb-3 flex items-center justify-between bg-slate-50 p-2 border-2 border-slate-900 rounded">
        <label htmlFor="editCanvasToggle" className="text-xs font-bold text-slate-800 cursor-pointer flex items-center gap-2 select-none">
          <input
            id="editCanvasToggle"
            type="checkbox"
            checked={editCanvasMode}
            onChange={(e) => setEditCanvasMode(e.target.checked)}
            className="w-3.5 h-3.5 accent-violet-700 cursor-pointer"
          />
          Chat with Active Canvas (Edit Graph)
        </label>
      </div>

      <div className="flex-1 overflow-y-auto mb-3 text-xs text-slate-700 space-y-2">
        <p className="bg-slate-50 p-2.5 rounded border-2 border-slate-900 font-medium text-[11px]">
          Describe an automation pipeline or ask to edit the active canvas:
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
          🏨 Hotel Concierge: Guest Check-in & Policy Lookup RAG
        </button>

        <button
          type="button"
          onClick={() =>
            handleSampleClick(
              "Create an automated product quality assurance pipeline. Inspect uploaded product photos, query spec sheets in ChromaDB, pass image and spec data to llama3.2-vision, and save the markdown report."
            )
          }
          className="w-full text-left bg-slate-50 hover:bg-slate-100 p-2.5 rounded border-2 border-slate-900 text-[11px] text-sky-800 font-bold transition-colors cursor-pointer"
        >
          📷 Vision QA: Product Photo vs PDF Spec Checker
        </button>

        <button
          type="button"
          onClick={() =>
            handleSampleClick(
              "Take user text input. If the message contains the word 'urgent', route it to the log terminal; otherwise save it to disk."
            )
          }
          className="w-full text-left bg-slate-50 hover:bg-slate-100 p-2.5 rounded border-2 border-slate-900 text-[11px] text-emerald-800 font-bold transition-colors cursor-pointer"
        >
          ⚡ Message Router: Conditional Urgent Filter & Writer
        </button>
      </div>

      {statusNotice && (
        <div className="mb-2 p-2 bg-emerald-50 border-2 border-slate-900 rounded text-emerald-800 text-xs font-bold">
          ✓ {statusNotice}
        </div>
      )}

      {errorMsg && (
        <div className="mb-2 p-2.5 bg-rose-50 border-2 border-slate-900 rounded text-rose-800 text-xs max-h-28 overflow-y-auto whitespace-pre-wrap font-medium">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            editCanvasMode
              ? "Describe modifications to the current canvas (e.g. add a local file writer after the LLM)..."
              : "Describe your automation pipeline..."
          }
          className="w-full h-20 bg-slate-50 border-2 border-slate-900 rounded p-2.5 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-violet-600 focus:bg-white resize-none font-medium"
        />
        <button
          type="submit"
          disabled={isLoading || !prompt.trim()}
          className="w-full py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold text-xs rounded border-2 border-slate-900 transition-colors cursor-pointer"
        >
          {isLoading ? "Compiling Graph..." : editCanvasMode ? "Update Active Canvas" : "Generate Graph"}
        </button>
      </form>
    </div>
  );
}
