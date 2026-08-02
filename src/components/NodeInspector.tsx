import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGraphStore } from "../lib/useGraphStore";

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__));
}

interface NodeInspectorProps {
  selectedNodeId: string | null;
  onClose: () => void;
}

export default function NodeInspector({ selectedNodeId, onClose }: NodeInspectorProps): React.JSX.Element | null {
  const graph = useGraphStore((s) => s.graph);
  const setGraph = useGraphStore((s) => s.setGraph);

  const [ollamaModels, setOllamaModels] = useState<string[]>(["llama3.2", "llama3.2-vision", "qwen2.5", "nomic-embed-text"]);

  useEffect(() => {
    if (isTauriAvailable()) {
      invoke<string[]>("list_ollama_models")
        .then((models) => {
          if (models && models.length > 0) setOllamaModels(models);
        })
        .catch(() => {});
    }
  }, []);

  if (!selectedNodeId) return null;

  const node = graph.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const updateDataField = (key: string, val: unknown) => {
    const updatedNodes = graph.nodes.map((n) =>
      n.id === selectedNodeId ? { ...n, data: { ...n.data, [key]: val } } : n
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
    if (!isTauriAvailable()) return;
    try {
      const path = await invoke<string>("pick_folder");
      updateDataField("watch_path", path);
    } catch {}
  };

  const handlePickImage = async () => {
    if (!isTauriAvailable()) return;
    try {
      const path = await invoke<string>("pick_image");
      updateDataField("image_path", path);
    } catch {}
  };

  return (
    <div className="w-80 border-l-2 border-slate-900 bg-white p-4 flex flex-col h-full shadow-lg z-20 text-slate-900">
      <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3 mb-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Node Inspector</h2>
          <p className="text-[11px] text-slate-600 font-mono font-bold">{node.id}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-900 text-xl font-bold leading-none cursor-pointer"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 text-xs font-medium">
        <div>
          <label className="block text-slate-700 mb-1 font-bold">Node Type</label>
          <div className="bg-slate-100 p-2 rounded text-slate-900 font-mono border-2 border-slate-900 font-bold">
            {node.type}
          </div>
        </div>

        <div>
          <label className="block text-slate-700 mb-1 font-bold">Label</label>
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
            <label className="block text-slate-700 mb-1 font-bold">Watch Path</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={(node.data.watch_path as string) || ""}
                onChange={(e) => updateDataField("watch_path", e.target.value)}
                placeholder="/path/to/folder"
                className="flex-1 bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-medium"
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
            <label className="block text-slate-700 mb-1 font-bold">Image File</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={(node.data.image_path as string) || ""}
                onChange={(e) => updateDataField("image_path", e.target.value)}
                placeholder="/path/to/image.png"
                className="flex-1 bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-medium"
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
            <label className="block text-slate-700 mb-1 font-bold">Default Text</label>
            <textarea
              value={(node.data.default_text as string) || ""}
              onChange={(e) => updateDataField("default_text", e.target.value)}
              placeholder="Enter text..."
              className="w-full h-24 bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white resize-none font-medium"
            />
          </div>
        )}

        {(node.type === "ollama_selector" || node.type === "local_embedder") && (
          <div>
            <label className="block text-slate-700 mb-1 font-bold">Model</label>
            <select
              value={(node.data.model as string) || ollamaModels[0]}
              onChange={(e) => updateDataField("model", e.target.value)}
              className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-bold"
            >
              {ollamaModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}

        {node.type === "chromadb_store" && (
          <>
            <div>
              <label className="block text-slate-700 mb-1 font-bold">Collection Name</label>
              <input
                type="text"
                value={(node.data.collection_name as string) || "my_collection"}
                onChange={(e) => updateDataField("collection_name", e.target.value)}
                className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-bold"
              />
            </div>
            <div>
              <label className="block text-slate-700 mb-1 font-bold">Mode</label>
              <select
                value={(node.data.mode as string) || "write"}
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
                value={(node.data.condition_type as string) || "has_image"}
                onChange={(e) => updateDataField("condition_type", e.target.value)}
                className="w-full bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-bold"
              >
                <option value="has_image">Has Image File</option>
                <option value="has_text">Has Text</option>
                <option value="custom">Custom Expression</option>
              </select>
            </div>
            {node.data.condition_type === "custom" && (
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Expression</label>
                <input
                  type="text"
                  value={(node.data.expression as string) || ""}
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
                  value={(node.data.output_path as string) || ""}
                  onChange={(e) => updateDataField("output_path", e.target.value)}
                  placeholder="/output/dir"
                  className="flex-1 bg-slate-50 border-2 border-slate-900 rounded p-2 text-slate-900 focus:outline-none focus:border-violet-600 focus:bg-white font-medium"
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
                value={(node.data.format as string) || "md"}
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

      <div className="pt-4 border-t-2 border-slate-900 mt-auto">
        <button
          type="button"
          onClick={handleDeleteNode}
          className="w-full py-2 bg-rose-100 hover:bg-rose-200 text-rose-900 border-2 border-slate-900 rounded text-xs font-bold transition-colors cursor-pointer"
        >
          Delete Node
        </button>
      </div>
    </div>
  );
}
