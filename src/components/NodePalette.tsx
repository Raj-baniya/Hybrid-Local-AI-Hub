import type { NodeTypeEnum } from "../lib/graphSchema";
import { z } from "zod";

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
    colorClass: "border-emerald-700 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/60",
    items: [
      { type: "file_watcher", label: "File Watcher" },
      { type: "image_input", label: "Image Input" },
      { type: "text_input", label: "Text Input" },
    ],
  },
  {
    name: "Processing & Vector Memory",
    colorClass: "border-sky-700 bg-sky-950/50 text-sky-300 hover:bg-sky-900/60",
    items: [
      { type: "local_embedder", label: "Local Embedder" },
      { type: "chromadb_store", label: "ChromaDB Store" },
    ],
  },
  {
    name: "Inference & Logic Routing",
    colorClass: "border-violet-700 bg-violet-950/50 text-violet-300 hover:bg-violet-900/60",
    items: [
      { type: "ollama_selector", label: "Ollama Selector" },
      { type: "conditional_router", label: "Conditional Router" },
    ],
  },
  {
    name: "Output",
    colorClass: "border-amber-700 bg-amber-950/50 text-amber-300 hover:bg-amber-900/60",
    items: [
      { type: "local_file_writer", label: "Local File Writer" },
      { type: "log_terminal", label: "Log Terminal" },
    ],
  },
];

export default function NodePalette(): React.JSX.Element {
  const onDragStart = (event: React.DragEvent, nodeType: NodeType, label: string) => {
    event.dataTransfer.setData("application/reactflow/type", nodeType);
    event.dataTransfer.setData("application/reactflow/label", label);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border-r border-neutral-800 p-4 overflow-y-auto">
      <div className="text-sm font-semibold text-neutral-200 border-b border-neutral-800 pb-3 mb-4 flex items-center justify-between">
        <span>Node Palette</span>
        <span className="text-[10px] bg-sky-950 text-sky-300 border border-sky-700 px-2 py-0.5 rounded">
          Option 2
        </span>
      </div>

      <p className="text-xs text-neutral-400 mb-4 bg-neutral-950 p-2.5 rounded border border-neutral-800">
        Drag any node card below onto the canvas to manually build your pipeline graph.
      </p>

      <div className="space-y-4">
        {PALETTE_CATEGORIES.map((category) => (
          <div key={category.name} className="space-y-2">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              {category.name}
            </div>
            <div className="space-y-1.5">
              {category.items.map((item) => (
                <div
                  key={item.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, item.type, item.label)}
                  className={`cursor-grab active:cursor-grabbing border rounded p-2.5 text-xs font-medium transition-colors ${category.colorClass}`}
                >
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
