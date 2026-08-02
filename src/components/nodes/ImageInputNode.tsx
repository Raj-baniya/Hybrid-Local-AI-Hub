import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";
import { useExecutionStore } from "../../lib/useExecutionStore";

export default function ImageInputNode({ id, data, selected }: HubNodeProps) {
  const status = useExecutionStore((s) => s.nodeStatuses[id]);

  let statusRing = "";
  if (status === "running") statusRing = "ring-2 ring-amber-400 animate-pulse";
  if (status === "success") statusRing = "ring-2 ring-emerald-500";
  if (status === "error") statusRing = "ring-2 ring-red-500";

  return (
    <div className={`rounded-lg border px-3 py-2 bg-emerald-950 border-emerald-700 min-w-[160px] ${selected ? "ring-2 ring-emerald-400" : statusRing}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">Ingestion</div>
      <div className="text-xs font-medium text-white">{data.label || "Image Input"}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
