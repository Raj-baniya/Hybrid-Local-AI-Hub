import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";

export default function ConditionalRouterNode({ data, selected }: HubNodeProps) {
  return (
    <div className={`rounded-lg border px-3 py-2 bg-violet-950 border-violet-700 min-w-[170px] relative ${selected ? "ring-2 ring-violet-400" : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-violet-400 w-2.5 h-2.5" />
      <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">Inference & Logic</div>
      <div className="text-xs font-medium text-white mb-1">{data.label || "Conditional Router"}</div>
      <div className="text-[10px] text-violet-300/80 font-mono">
        Condition: {String(data.condition_type || "has_image")}
      </div>

      {/* Named Output Handles */}
      <div className="absolute right-2 top-[28%] text-[9px] font-semibold text-emerald-400 pointer-events-none">
        TRUE
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: "32%" }}
        className="!bg-emerald-400 w-2.5 h-2.5"
      />

      <div className="absolute right-2 top-[68%] text-[9px] font-semibold text-rose-400 pointer-events-none">
        FALSE
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{ top: "72%" }}
        className="!bg-rose-400 w-2.5 h-2.5"
      />
    </div>
  );
}
