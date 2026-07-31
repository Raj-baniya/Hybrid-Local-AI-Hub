import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";

export default function ConditionalRouterNode({ data, selected }: HubNodeProps) {
  return (
    <div className={`rounded-lg border px-3 py-2 bg-violet-950 border-violet-700 min-w-[160px] ${selected ? "ring-2 ring-violet-400" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">Inference & Logic</div>
      <div className="text-xs font-medium text-white">{data.label || "Conditional Router"}</div>
      <Handle type="source" position={Position.Right} id="true" style={{ top: "30%" }} />
      <Handle type="source" position={Position.Right} id="false" style={{ top: "70%" }} />
    </div>
  );
}
