import "./App.css";
import ChatPanel from "./components/ChatPanel";
import GraphCanvas from "./components/GraphCanvas";

export default function App(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <aside className="w-[340px] shrink-0 border-r border-neutral-800 bg-neutral-900 flex flex-col">
        <ChatPanel />
      </aside>
      <main className="flex-1 relative bg-neutral-950">
        <GraphCanvas />
      </main>
    </div>
  );
}
