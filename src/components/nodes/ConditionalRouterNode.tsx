import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";
import { useExecutionStore } from "../../lib/useExecutionStore";

export default function ConditionalRouterNode({ id, data, selected }: HubNodeProps) {
  const status = useExecutionStore((s) => s.nodeStatuses[id]);

  let statusRing = "";
  if (status === "running") statusRing = "ring-4 ring-amber-400 animate-pulse";
  if (status === "success") statusRing = "ring-4 ring-emerald-500";
  if (status === "error") statusRing = "ring-4 ring-rose-500";

  return (
    <div className={`rounded-lg border-2 border-slate-900 px-4 py-3 bg-violet-600 min-w-[180px] shadow-sm text-white relative ${selected ? "ring-4 ring-slate-900" : statusRing}`}>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3.5 !h-3.5 !bg-slate-900 !border-2 !border-white hover:!scale-125 transition-transform"
      />
      <div className="text-[10px] font-bold uppercase tracking-wider text-violet-100">Logic Router</div>
      <div className="text-xs font-bold text-white mb-2">{data.label || "Conditional Router"}</div>
      
      <div className="flex justify-between items-center text-[10px] font-bold border-t-2 border-slate-900 pt-1.5 mt-1">
        <span className="text-emerald-200">TRUE ▶</span>
        <span className="text-rose-200">FALSE ▶</span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: "65%" }}
        className="!w-3.5 !h-3.5 !bg-emerald-400 !border-2 !border-slate-900 hover:!scale-125 transition-transform"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{ top: "85%" }}
        className="!w-3.5 !h-3.5 !bg-rose-400 !border-2 !border-slate-900 hover:!scale-125 transition-transform"
      />
    </div>
  );
}
