import { useState, useEffect } from "react";
import { safeInvoke, safeListen } from "../lib/tauriBridge";

const RECOMMENDED_MODELS = [
  { name: "llama3.2", note: "Fast general-purpose pipeline translator" },
  { name: "qwen2.5", note: "Strong JSON-following alternative model" },
  { name: "qwen2.5vl:7b", note: "Vision-language — supports vision & image prompts" },
  { name: "llama3.2-vision", note: "Vision model for Ollama Selector nodes" },
  { name: "nomic-embed-text", note: "Required for local text embeddings & RAG" },
];

export default function ModelManagerPanel(): React.JSX.Element {
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [progressStatus, setProgressStatus] = useState<string>("");

  const refreshModels = async () => {
    try {
      const models = await safeInvoke<string[]>("list_ollama_models");
      setInstalledModels(models || []);
    } catch {
      setInstalledModels(["llama3.2:latest", "qwen2.5vl:7b"]);
    }
  };

  useEffect(() => {
    refreshModels();
  }, []);

  const handlePullModel = async (modelName: string) => {
    if (pullingModel) return;
    setPullingModel(modelName);
    setProgressStatus("Starting download...");

    const unlisten = await safeListen<[string, { status: string; completed?: number; total?: number }]>(
      "model-pull-progress",
      (payload) => {
        const [targetModel, progress] = payload;
        if (targetModel === modelName) {
          if (progress.total && progress.completed) {
            const pct = Math.round((progress.completed / progress.total) * 100);
            setProgressStatus(`${progress.status} (${pct}%)`);
          } else {
            setProgressStatus(progress.status);
          }
        }
      }
    );

    try {
      await safeInvoke("pull_model", { model: modelName });
      setProgressStatus("Successfully pulled model!");
      await refreshModels();
    } catch (err) {
      setProgressStatus(`Error: ${String(err)}`);
    } finally {
      unlisten();
      setTimeout(() => {
        setPullingModel(null);
        setProgressStatus("");
      }, 3000);
    }
  };

  return (
    <div className="p-4 bg-white text-slate-900 h-full overflow-y-auto">
      <h2 className="text-sm font-bold border-b-2 border-slate-900 pb-2 mb-4 flex items-center justify-between">
        <span>Ollama Model Manager</span>
        <button
          type="button"
          onClick={refreshModels}
          className="text-xs px-2 py-0.5 border-2 border-slate-900 bg-slate-100 hover:bg-slate-200 rounded font-bold cursor-pointer"
        >
          ↻ Refresh
        </button>
      </h2>

      <div className="space-y-3">
        {RECOMMENDED_MODELS.map((rec) => {
          const isInstalled = installedModels.some(
            (m) => m === rec.name || m.startsWith(`${rec.name}:`)
          );
          const isCurrentPulling = pullingModel === rec.name;

          return (
            <div
              key={rec.name}
              className="p-3 border-2 border-slate-900 rounded bg-slate-50 flex items-center justify-between gap-2"
            >
              <div>
                <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <span>{rec.name}</span>
                  {isInstalled ? (
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 border-2 border-slate-900 px-1.5 py-0.2 rounded font-bold">
                      ✓ Installed
                    </span>
                  ) : (
                    <span className="text-[10px] bg-amber-100 text-amber-900 border-2 border-slate-900 px-1.5 py-0.2 rounded font-bold">
                      Available
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-600 mt-0.5">{rec.note}</div>
                {isCurrentPulling && (
                  <div className="text-[10px] font-bold text-violet-700 mt-1 animate-pulse">
                    {progressStatus}
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={isInstalled || isCurrentPulling}
                onClick={() => handlePullModel(rec.name)}
                className="text-xs px-3 py-1 bg-violet-600 text-white font-bold border-2 border-slate-900 rounded disabled:bg-slate-300 disabled:text-slate-500 hover:bg-violet-700 transition-colors cursor-pointer shrink-0"
              >
                {isInstalled ? "Installed" : isCurrentPulling ? "Pulling..." : "Download"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
