import { useExecutionStore } from "../lib/useExecutionStore";

export default function LogTerminal(): React.JSX.Element {
  const { logs } = useExecutionStore();

  return (
    <div className="h-44 bg-slate-900 text-slate-100 border-t border-slate-200 flex flex-col text-xs font-mono shadow-inner">
      <div className="px-4 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-slate-400">
        <span className="font-semibold text-slate-300">Log Terminal</span>
        <span>{logs.length} events</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {logs.length === 0 ? (
          <div className="text-slate-500 italic">
            No execution events yet. Click &quot;Execute Pipeline&quot; to start.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2 items-start hover:bg-slate-800/50 p-0.5 rounded">
              <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
              <span className="text-sky-400 font-bold shrink-0">[{log.nodeId}]</span>
              <span className="text-slate-200 whitespace-pre-wrap">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
