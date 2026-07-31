import "./App.css";
import GraphCanvas from "./components/GraphCanvas";

export default function App(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <aside className="w-[340px] shrink-0 border-r border-neutral-800 bg-neutral-900 flex flex-col">
        {/* ChatPanel mounted here in Step 8 */}
        <div className="p-4 text-xs text-neutral-400 font-semibold border-b border-neutral-800">
          CHAT PANEL
        </div>
      </aside>
      <main className="flex-1 relative bg-neutral-950">
        <GraphCanvas />
      </main>
    </div>
  );
}
