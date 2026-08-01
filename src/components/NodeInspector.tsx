import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGraphStore } from "../lib/useGraphStore";

interface NodeInspectorProps {
  selectedNodeId: string | null;
  onClose: () => void;
}

export default function NodeInspector({ selectedNodeId, onClose }: NodeInspectorProps): React.JSX.Element | null {
  const graph = useGraphStore((s) => s.graph);
  const setGraph = useGraphStore((s) => s.setGraph);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId);

  useEffect(() => {
    if (selectedNode?.type === "ollama_selector") {
      setIsLoadingModels(true);
      invoke<string[]>("list_ollama_models")
        .then((models) => {
          setOllamaModels(models);
          setIsLoadingModels(false);
        })
        .catch(() => {
          setOllamaModels(["llama3.2:latest", "llama3.2-vision:latest", "qwen2.5:latest"]);
          setIsLoadingModels(false);
        });
    }
  }, [selectedNode?.type]);

  if (!selectedNode) return null;

  const updateNodeLabel = (label: string) => {
    setGraph({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === selectedNode.id ? { ...n, label } : n)),
    });
  };

  const updateNodeData = (key: string, value: unknown) => {
    setGraph({
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === selectedNode.id
          ? {
              ...n,
              data: { ...n.data, [key]: value },
            }
          : n
      ),
    });
  };

  const handlePickFolder = async (dataKey: string) => {
    try {
      const folderPath = await invoke<string>("pick_folder");
      updateNodeData(dataKey, folderPath);
    } catch {
      // User cancelled picker
    }
  };

  const handlePickImage = async () => {
    try {
      const imagePath = await invoke<string>("pick_image");
      updateNodeData("image_path", imagePath);
    } catch {
      // User cancelled picker
    }
  };

  const renderTypeFields = () => {
    const data = selectedNode.data || {};

    switch (selectedNode.type) {
      case "file_watcher":
        return (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-neutral-300">Watch Path</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={(data.watch_path as string) || ""}
                onChange={(e) => updateNodeData("watch_path", e.target.value)}
                placeholder="/path/to/watch/folder"
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-600"
              />
              <button
                type="button"
                onClick={() => handlePickFolder("watch_path")}
                className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 rounded border border-neutral-700 shrink-0"
              >
                Browse
              </button>
            </div>
          </div>
        );

      case "image_input":
        return (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-neutral-300">Runtime Image File</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={(data.image_path as string) || ""}
                placeholder="No image selected"
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handlePickImage}
                className="px-2.5 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-700 text-xs text-emerald-300 rounded shrink-0"
              >
                Select Image
              </button>
            </div>
          </div>
        );

      case "text_input":
        return (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-neutral-300">Default Input Text</label>
            <textarea
              value={(data.default_text as string) || ""}
              onChange={(e) => updateNodeData("default_text", e.target.value)}
              placeholder="Enter input text payload..."
              className="w-full h-24 bg-neutral-950 border border-neutral-800 rounded p-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-600 resize-none"
            />
          </div>
        );

      case "local_embedder":
        return (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-neutral-300">Embedding Model</label>
            <input
              type="text"
              readOnly
              value={(data.model as string) || "nomic-embed-text"}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-sky-300 font-mono"
            />
          </div>
        );

      case "chromadb_store":
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">Collection Name</label>
              <input
                type="text"
                value={(data.collection_name as string) || ""}
                onChange={(e) => updateNodeData("collection_name", e.target.value)}
                placeholder="e.g. spec_sheets"
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-sky-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">Mode</label>
              <select
                value={(data.mode as string) || "write"}
                onChange={(e) => updateNodeData("mode", e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-600"
              >
                <option value="write">Write (Upsert Vectors)</option>
                <option value="read">Read (Similarity Lookup)</option>
              </select>
            </div>
          </div>
        );

      case "ollama_selector":
        return (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-neutral-300">Ollama Model</label>
            <select
              value={(data.model as string) || "llama3.2"}
              onChange={(e) => updateNodeData("model", e.target.value)}
              disabled={isLoadingModels}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-violet-300 focus:outline-none focus:border-violet-600"
            >
              {ollamaModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        );

      case "conditional_router":
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">Condition Type</label>
              <select
                value={(data.condition_type as string) || "has_image"}
                onChange={(e) => updateNodeData("condition_type", e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-violet-600"
              >
                <option value="has_image">Has Image? (Image Input Check)</option>
                <option value="has_text">Has Text? (Text Input Check)</option>
                <option value="custom">Custom Expression</option>
              </select>
            </div>
            {data.condition_type === "custom" && (
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">JavaScript Expression</label>
                <input
                  type="text"
                  value={(data.expression as string) || ""}
                  onChange={(e) => updateNodeData("expression", e.target.value)}
                  placeholder="e.g. text.includes('urgent')"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-violet-600 font-mono"
                />
              </div>
            )}
          </div>
        );

      case "local_file_writer":
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">Output Folder</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={(data.output_path as string) || ""}
                  onChange={(e) => updateNodeData("output_path", e.target.value)}
                  placeholder="/output/directory/path"
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-600"
                />
                <button
                  type="button"
                  onClick={() => handlePickFolder("output_path")}
                  className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 rounded border border-neutral-700 shrink-0"
                >
                  Browse
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">Format</label>
              <select
                value={(data.format as string) || "md"}
                onChange={(e) => updateNodeData("format", e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-600"
              >
                <option value="md">Markdown (.md)</option>
                <option value="txt">Plain Text (.txt)</option>
                <option value="json">JSON (.json)</option>
              </select>
            </div>
          </div>
        );

      case "log_terminal":
        return (
          <div className="text-xs text-amber-300/80 bg-amber-950/40 p-2.5 rounded border border-amber-800/60">
            Log Terminal is a passive sink node. It streams runtime execution status and output logs live during graph runs.
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="w-[300px] shrink-0 bg-neutral-900 border-l border-neutral-800 p-4 flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
        <span className="text-sm font-semibold text-neutral-200">Node Inspector</span>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-neutral-800"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4 flex-1">
        <div>
          <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Node ID</label>
          <div className="text-xs text-neutral-500 font-mono bg-neutral-950 px-2.5 py-1.5 rounded border border-neutral-800">
            {selectedNode.id}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Node Label</label>
          <input
            type="text"
            value={selectedNode.label}
            onChange={(e) => updateNodeLabel(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-neutral-600"
          />
        </div>

        <div className="border-t border-neutral-800 pt-3">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-3">
            {selectedNode.type.replace("_", " ")} Configuration
          </div>
          {renderTypeFields()}
        </div>
      </div>
    </div>
  );
}
