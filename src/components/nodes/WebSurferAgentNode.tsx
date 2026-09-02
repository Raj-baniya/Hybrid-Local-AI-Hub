import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";

export default function WebSurferAgentNode({ data, selected }: HubNodeProps): React.JSX.Element {
  return (
    <div
      className={`rounded-xl border-2 px-4 py-3 bg-blue-950/90 border-blue-600 shadow-lg min-w-[200px] text-white transition-all ${
        selected ? "ring-2 ring-blue-400 shadow-blue-900/50" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-blue-400 border-2 border-slate-900" />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🌐</span>
        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-300">Web Surfer Agent</div>
      </div>
      <div className="text-xs font-bold text-white leading-snug">{data.label || "Web Surfer Agent"}</div>
      <div className="text-[10px] text-blue-200 mt-1 font-medium">Browses &amp; extracts local/cached web data</div>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-blue-400 border-2 border-slate-900" />
    </div>
  );
}
