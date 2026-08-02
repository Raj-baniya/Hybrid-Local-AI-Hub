import { Handle, Position } from "@xyflow/react";
import type { HubNodeProps } from "./types";
import { useExecutionStore } from "../../lib/useExecutionStore";

export default function OllamaSelectorNode({ id, data, selected }: HubNodeProps) {
  const status = useExecutionStore((s) => s.nodeStatuses[id]);

  let statusRing = "";
  if (status === "running") statusRing = "ring-2 ring-amber-400 animate-pulse";
  if (status === "success") statusRing = "ring-2 ring-emerald-500";
  if (status === "error") statusRing = "ring-2 ring-red-500";

  return (
    <div className={`rounded-lg border px-3 py-2 bg-violet-950 border-violet-700 min-w-[160px] ${selected ? "ring-2 ring-violet-400" : statusRing}`}>
      <Handle type="target" position={Position.Left} />
      <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">Inference & Logic</div>
      <div className="text-xs font-medium text-white">{data.label || "Ollama Selector"}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
