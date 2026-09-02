import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";

export default function VoteAggregatorNode({ data, selected }: HubNodeProps): React.JSX.Element {
  return (
    <div
      className={`rounded-xl border-2 px-4 py-3 bg-amber-950/90 border-amber-600 shadow-lg min-w-[200px] text-white transition-all ${
        selected ? "ring-2 ring-amber-400 shadow-amber-900/50" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-amber-400 border-2 border-slate-900" />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🗳️</span>
        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Vote Aggregator</div>
      </div>
      <div className="text-xs font-bold text-white leading-snug">{data.label || "Vote Aggregator"}</div>
      <div className="text-[10px] text-amber-200 mt-1 font-medium">Consolidates &amp; votes on multi-agent results</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-amber-400 border-2 border-slate-900" />
    </div>
  );
}
