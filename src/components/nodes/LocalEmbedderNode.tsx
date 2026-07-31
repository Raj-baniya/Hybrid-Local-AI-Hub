import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";

export default function LocalEmbedderNode({ data, selected }: HubNodeProps) {
  return (
    <div className={`rounded-lg border px-3 py-2 bg-sky-950 border-sky-700 min-w-[160px] ${selected ? "ring-2 ring-sky-400" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">Processing & Vector</div>
      <div className="text-xs font-medium text-white">{data.label || "Local Embedder"}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
