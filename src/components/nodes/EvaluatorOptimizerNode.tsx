import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";

export default function EvaluatorOptimizerNode({ data, selected }: HubNodeProps): React.JSX.Element {
  return (
    <div
      className={`rounded-xl border-2 px-4 py-3 bg-indigo-950/90 border-indigo-600 shadow-lg min-w-[200px] text-white transition-all ${
        selected ? "ring-2 ring-indigo-400 shadow-indigo-900/50" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-indigo-400 border-2 border-slate-900" />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🔄</span>
        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">Evaluator / Optimizer</div>
      </div>
      <div className="text-xs font-bold text-white leading-snug">{data.label || "Evaluator / Optimizer"}</div>
      <div className="text-[10px] text-indigo-200 mt-1 font-medium">Evaluates &amp; refines outputs iteratively</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-indigo-400 border-2 border-slate-900" />
    </div>
  );
}
