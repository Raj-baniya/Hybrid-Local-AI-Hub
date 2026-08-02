import { useExecutionStore } from "../lib/useExecutionStore";

export default function LogTerminal(): React.JSX.Element {
  const { logs } = useExecutionStore();

  return (
    <div className="h-44 bg-neutral-950 border-t border-neutral-800 flex flex-col font-mono text-xs">
      <div className="bg-neutral-900 border-b border-neutral-800 px-3 py-1.5 flex items-center justify-between text-[11px] text-neutral-400 font-sans">
        <span className="font-medium text-neutral-300">Log Terminal</span>
        <span>{logs.length} events</span>
      </div>

      <div className="flex-1 p-3 overflow-y-auto space-y-1">
        {logs.length === 0 ? (
          <div className="text-neutral-600 italic">No execution events yet. Click &quot;Execute Pipeline&quot; to start.</div>
        ) : (
          logs.map((log) => {
            let color = "text-neutral-300";
            if (log.status === "running") color = "text-amber-400";
            if (log.status === "success") color = "text-emerald-400";
            if (log.status === "error") color = "text-red-400 font-semibold";

            return (
              <div key={log.id} className="flex gap-2">
                <span className="text-neutral-500 shrink-0">[{log.timestamp}]</span>
                <span className="text-neutral-400 font-semibold shrink-0">[{log.nodeId}]</span>
                <span className={color}>{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
