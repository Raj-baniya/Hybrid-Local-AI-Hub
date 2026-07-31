import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GraphStateSchema, type GraphState } from "../lib/graphSchema";
import { useGraphStore } from "../lib/useGraphStore";
import { autoLayout } from "../lib/autoLayout";

export async function requestGraph(prompt: string): Promise<
  { ok: true; graph: GraphState } | { ok: false; rawOutput: string }
> {
  try {
    const raw = await invoke<string>("generate_graph", { prompt });
    const parsed = GraphStateSchema.safeParse(safeJsonParse(raw));
    if (parsed.success) return { ok: true, graph: parsed.data };

    // repair-retry: one retry with an explicit correction instruction
    const repairPrompt =
      `Your last output was invalid JSON or failed the schema. ` +
      `Return corrected JSON only, no prose. Original request: ${prompt}`;
    const raw2 = await invoke<string>("generate_graph", { prompt: repairPrompt });
    const parsed2 = GraphStateSchema.safeParse(safeJsonParse(raw2));
    if (parsed2.success) return { ok: true, graph: parsed2.data };

    return { ok: false, rawOutput: raw2 };
  } catch (err) {
    return { ok: false, rawOutput: String(err) };
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default function ChatPanel(): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const setGraph = useGraphStore((s) => s.setGraph);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    setErrorMsg(null);

    const res = await requestGraph(prompt);
    setIsLoading(false);

    if (res.ok) {
      const layoutedNodes = autoLayout(res.graph.nodes, res.graph.edges);
      setGraph({
        ...res.graph,
        nodes: layoutedNodes,
      });
    } else {
      setErrorMsg(`Failed to compile pipeline graph:\n${res.rawOutput}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border-r border-neutral-800 p-4">
      <div className="text-sm font-semibold text-neutral-200 border-b border-neutral-800 pb-3 mb-4 flex items-center justify-between">
        <span>Chat-to-Graph Assistant</span>
        <span className="text-[10px] bg-violet-950 text-violet-300 border border-violet-700 px-2 py-0.5 rounded">
          Option 1
        </span>
      </div>

      <div className="flex-1 overflow-y-auto mb-4 text-xs text-neutral-400 space-y-2">
        <p className="bg-neutral-950 p-3 rounded border border-neutral-800">
          Describe an automation pipeline in plain English. For example:
        </p>
        <button
          type="button"
          onClick={() =>
            setPrompt(
              "Create an automated quality assurance pipeline. Upload a product photo, cross-reference it with a local PDF spec sheet using an 11B vision model, and output a markdown report."
            )
          }
          className="w-full text-left bg-neutral-950 hover:bg-neutral-800 p-2.5 rounded border border-neutral-800 text-[11px] text-violet-300 transition-colors"
        >
          &quot;Create an automated QA pipeline with product photo, PDF spec sheet, 11B vision model, and markdown report&quot;
        </button>
      </div>

      {errorMsg && (
        <div className="mb-3 p-3 bg-red-950/80 border border-red-800 rounded text-red-300 text-xs max-h-32 overflow-y-auto whitespace-pre-wrap">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your automation pipeline..."
          className="w-full h-24 bg-neutral-950 border border-neutral-800 rounded p-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-violet-600 resize-none"
        />
        <button
          type="submit"
          disabled={isLoading || !prompt.trim()}
          className="w-full py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-medium text-xs rounded transition-colors"
        >
          {isLoading ? "Compiling Graph..." : "Generate Graph"}
        </button>
      </form>
    </div>
  );
}
