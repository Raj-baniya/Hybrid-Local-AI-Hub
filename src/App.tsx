import { useState } from "react";
import "./App.css";
import ChatPanel from "./components/ChatPanel";
import NodePalette from "./components/NodePalette";
import GraphCanvas from "./components/GraphCanvas";

export default function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"chat" | "palette">("chat");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <aside className="w-[340px] shrink-0 border-r border-neutral-800 bg-neutral-900 flex flex-col">
        {/* Navigation Tabs */}
        <div className="flex border-b border-neutral-800 bg-neutral-950 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`flex-1 py-2.5 text-center transition-colors border-b-2 ${
              activeTab === "chat"
                ? "border-violet-500 text-violet-300 bg-neutral-900 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Chat Assistant (AI)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("palette")}
            className={`flex-1 py-2.5 text-center transition-colors border-b-2 ${
              activeTab === "palette"
                ? "border-sky-500 text-sky-300 bg-neutral-900 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Node Palette (Manual)
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "chat" ? <ChatPanel /> : <NodePalette />}
        </div>
      </aside>

      <main className="flex-1 relative bg-neutral-950">
        <GraphCanvas />
      </main>
    </div>
  );
}
