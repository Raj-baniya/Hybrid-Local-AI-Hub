import { useState } from "react";
import "./App.css";
import ChatPanel from "./components/ChatPanel";
import NodePalette from "./components/NodePalette";
import GraphCanvas from "./components/GraphCanvas";
import ExecutionToolbar from "./components/ExecutionToolbar";
import LogTerminal from "./components/LogTerminal";

export default function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"chat" | "palette">("chat");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans select-none">
      <aside className="w-[340px] shrink-0 border-r-2 border-slate-900 bg-white flex flex-col z-20">
        {/* Sidebar Header / Tabs - Perfectly aligned at h-12 */}
        <div className="h-12 flex items-center border-b-2 border-slate-900 bg-slate-100 text-xs font-bold p-1 gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`flex-1 py-1.5 text-center rounded transition-colors cursor-pointer ${
              activeTab === "chat"
                ? "bg-white text-violet-800 font-bold border-2 border-slate-900 shadow-xs"
                : "text-slate-700 hover:text-slate-900"
            }`}
          >
            Chat Assistant (AI)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("palette")}
            className={`flex-1 py-1.5 text-center rounded transition-colors cursor-pointer ${
              activeTab === "palette"
                ? "bg-white text-sky-800 font-bold border-2 border-slate-900 shadow-xs"
                : "text-slate-700 hover:text-slate-900"
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

      <main className="flex-1 flex flex-col relative bg-white overflow-hidden">
        <ExecutionToolbar />
        <div className="flex-1 relative overflow-hidden flex flex-col">
          <GraphCanvas />
        </div>
        <LogTerminal />
      </main>
    </div>
  );
}
