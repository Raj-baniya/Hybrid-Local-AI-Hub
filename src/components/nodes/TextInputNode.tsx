import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";
import { useExecutionStore } from "../../lib/useExecutionStore";

export default function TextInputNode({ id, data, selected }: HubNodeProps) {
  const status = useExecutionStore((s) => s.nodeStatuses[id]);

  let statusRing = "";
  if (status === "running") statusRing = "ring-4 ring-amber-400 animate-pulse";
  if (status === "success") statusRing = "ring-4 ring-emerald-500";
  if (status === "error") statusRing = "ring-4 ring-rose-500";

  return (
    <div className={`rounded-lg border-2 border-slate-900 px-4 py-3 bg-emerald-600 min-w-[170px] shadow-sm text-white relative ${selected ? "ring-4 ring-slate-900" : statusRing}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-100">Ingestion</div>
      <div className="text-xs font-bold text-white">{data.label || "Text Input"}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3.5 !h-3.5 !bg-slate-900 !border-2 !border-white hover:!scale-125 transition-transform"
      />
    </div>
  );
}
