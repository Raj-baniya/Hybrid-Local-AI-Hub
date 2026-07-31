import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";

export default function FileWatcherNode({ data, selected }: HubNodeProps) {
  return (
    <div className={`rounded-lg border px-3 py-2 bg-emerald-950 border-emerald-700 min-w-[160px] ${selected ? "ring-2 ring-emerald-400" : ""}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">Ingestion</div>
      <div className="text-xs font-medium text-white">{data.label || "File Watcher"}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
