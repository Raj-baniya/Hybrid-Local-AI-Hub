import type { NodeTypeEnum } from "../lib/graphSchema";
import { z } from "zod";
import { useGraphStore } from "../lib/useGraphStore";

type NodeType = z.infer<typeof NodeTypeEnum>;

interface PaletteItem {
  type: NodeType;
  label: string;
}

interface PaletteCategory {
  name: string;
  colorClass: string;
  items: PaletteItem[];
}

const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    name: "Ingestion",
    colorClass: "border-2 border-slate-900 bg-emerald-100 text-emerald-950 hover:bg-emerald-200",
    items: [
      { type: "file_watcher", label: "File Watcher" },
      { type: "image_input", label: "Image Input" },
      { type: "text_input", label: "Text Input" },
    ],
  },
  {
    name: "Processing & Vector Memory",
    colorClass: "border-2 border-slate-900 bg-sky-100 text-sky-950 hover:bg-sky-200",
    items: [
      { type: "local_embedder", label: "Local Embedder" },
      { type: "chromadb_store", label: "ChromaDB Store" },
    ],
  },
  {
    name: "Inference & Logic Routing",
    colorClass: "border-2 border-slate-900 bg-violet-100 text-violet-950 hover:bg-violet-200",
    items: [
      { type: "ollama_selector", label: "Ollama Selector" },
      { type: "conditional_router", label: "Conditional Router" },
    ],
  },
  {
    name: "Output",
    colorClass: "border-2 border-slate-900 bg-amber-100 text-amber-950 hover:bg-amber-200",
    items: [
      { type: "local_file_writer", label: "Local File Writer" },
      { type: "log_terminal", label: "Log Terminal" },
    ],
  },
];

function getDefaultDataForType(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "file_watcher":
      return { watch_path: "" };
    case "image_input":
      return {};
    case "text_input":
      return { default_text: "" };
    case "local_embedder":
      return { model: "nomic-embed-text" };
    case "chromadb_store":
      return { collection_name: "my_collection", mode: "write" };
    case "ollama_selector":
      return { model: "llama3.2" };
    case "conditional_router":
      return { condition_type: "has_image" };
    case "local_file_writer":
      return { output_path: "", format: "md" };
    case "log_terminal":
      return {};
    default:
      return {};
  }
}

export default function NodePalette(): React.JSX.Element {
  const setGraph = useGraphStore((s) => s.setGraph);

  const onDragStart = (event: React.DragEvent, nodeType: NodeType, label: string) => {
    event.dataTransfer.setData("text/plain", nodeType);
    event.dataTransfer.setData("application/reactflow/type", nodeType);
    event.dataTransfer.setData("application/reactflow/label", label);
    event.dataTransfer.effectAllowed = "move";

    (window as any).__DRAGGED_NODE_TYPE__ = nodeType;
    (window as any).__DRAGGED_NODE_LABEL__ = label;
  };

  const handleAddNode = (type: NodeType, label: string) => {
    const currentGraph = useGraphStore.getState().graph;
    const count = currentGraph.nodes.length;
    const newNode = {
      id: `node_${Date.now()}`,
      type,
      label,
      position: { x: 100 + (count % 3) * 220, y: 100 + Math.floor(count / 3) * 120 },
      data: getDefaultDataForType(type),
    };

    setGraph({
      ...currentGraph,
      nodes: [...currentGraph.nodes, newNode],
    });
  };

  return (
    <div className="flex flex-col h-full bg-white p-4 overflow-y-auto">
      <div className="text-sm font-bold text-slate-900 border-b-2 border-slate-900 pb-3 mb-4 flex items-center justify-between">
        <span>Node Palette</span>
        <span className="text-[10px] bg-sky-100 text-sky-900 border-2 border-slate-900 px-2 py-0.5 rounded font-bold">
          Option 2
        </span>
      </div>

      <p className="text-xs text-slate-800 mb-4 bg-slate-50 p-2.5 rounded border-2 border-slate-900 font-medium">
        Drag or click <strong>+ Add</strong> on any node below to place it onto the canvas.
      </p>

      <div className="space-y-4">
        {PALETTE_CATEGORIES.map((category) => (
          <div key={category.name} className="space-y-2">
            <div className="text-[11px] font-bold text-slate-900 uppercase tracking-wider">
              {category.name}
            </div>
            <div className="space-y-1.5">
              {category.items.map((item) => (
                <div
                  key={item.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, item.type, item.label)}
                  className={`cursor-grab active:cursor-grabbing rounded p-2.5 text-xs font-bold transition-colors flex items-center justify-between ${category.colorClass}`}
                >
                  <span>{item.label}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddNode(item.type, item.label);
                    }}
                    className="ml-2 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-900 text-[11px] font-bold rounded border-2 border-slate-900 shrink-0 cursor-pointer"
                  >
                    + Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
