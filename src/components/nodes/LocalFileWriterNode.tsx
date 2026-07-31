import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";

export default function LocalFileWriterNode({ data, selected }: HubNodeProps) {
  return (
    <div className={`rounded-lg border px-3 py-2 bg-amber-950 border-amber-700 min-w-[160px] ${selected ? "ring-2 ring-amber-400" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">Output</div>
      <div className="text-xs font-medium text-white">{data.label || "Local File Writer"}</div>
    </div>
  );
}
