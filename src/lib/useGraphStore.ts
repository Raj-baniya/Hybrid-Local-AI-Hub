import { create } from "zustand";
import type { GraphState } from "./graphSchema";

const defaultInitialGraph: GraphState = {
  version: 1,
  nodes: [
    { id: "n1", type: "file_watcher", label: "Watch Inbox", position: { x: 50, y: 100 }, data: { watch_path: "/sample/inbox" } },
    { id: "n2", type: "local_embedder", label: "Embed Text", position: { x: 300, y: 100 }, data: { model: "nomic-embed-text" } },
    { id: "n3", type: "chromadb_store", label: "Store Vector", position: { x: 550, y: 100 }, data: { collection_name: "inbox_docs", mode: "write" } },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2" },
    { id: "e2", source: "n2", target: "n3" },
  ],
  meta: {
    title: "Text Embedding Pipeline",
  },
};

type GraphStore = {
  graphs: GraphState[];
  activeGraphIndex: number;
  isBuildingGraph: boolean;
  buildingMessage: string;
  graph: GraphState;
  setBuildingGraph: (val: boolean, msg?: string) => void;
  setGraph: (g: GraphState) => void;
  addNewGraphTab: (g: GraphState) => void;
  createBlankTab: () => void;
  switchTab: (idx: number) => void;
  closeTab: (idx: number) => void;
  updateNodePosition: (id: string, x: number, y: number) => void;
};

export const useGraphStore = create<GraphStore>((set) => ({
  graphs: [defaultInitialGraph],
  activeGraphIndex: 0,
  graph: defaultInitialGraph,
  isBuildingGraph: false,
  buildingMessage: "",

  setBuildingGraph: (val, msg = "") =>
    set({ isBuildingGraph: val, buildingMessage: msg }),

  setGraph: (g) =>
    set((state) => {
      const updatedGraphs = [...state.graphs];
      const cloned = {
        ...g,
        nodes: [...(g.nodes || [])],
        edges: [...(g.edges || [])],
      };
      updatedGraphs[state.activeGraphIndex] = cloned;
      return {
        graphs: updatedGraphs,
        graph: cloned,
      };
    }),

  addNewGraphTab: (g) =>
    set((state) => {
      const cloned = {
        ...g,
        nodes: [...(g.nodes || [])],
        edges: [...(g.edges || [])],
      };
      const updatedGraphs = [...state.graphs, cloned];
      const newIndex = updatedGraphs.length - 1;
      return {
        graphs: updatedGraphs,
        activeGraphIndex: newIndex,
        graph: cloned,
      };
    }),

  createBlankTab: () =>
    set((state) => {
      const newBlankGraph: GraphState = {
        version: 1,
        nodes: [],
        edges: [],
        meta: {
          title: `New Pipeline ${state.graphs.length + 1}`,
        },
      };
      const updatedGraphs = [...state.graphs, newBlankGraph];
      const newIndex = updatedGraphs.length - 1;
      return {
        graphs: updatedGraphs,
        activeGraphIndex: newIndex,
        graph: newBlankGraph,
      };
    }),

  switchTab: (idx) =>
    set((state) => {
      if (idx < 0 || idx >= state.graphs.length) return state;
      return {
        activeGraphIndex: idx,
        graph: state.graphs[idx],
      };
    }),

  closeTab: (idx) =>
    set((state) => {
      if (state.graphs.length <= 1) return state;
      const updatedGraphs = state.graphs.filter((_, i) => i !== idx);
      const newIdx = Math.min(state.activeGraphIndex, updatedGraphs.length - 1);
      return {
        graphs: updatedGraphs,
        activeGraphIndex: newIdx,
        graph: updatedGraphs[newIdx],
      };
    }),

  updateNodePosition: (id, x, y) =>
    set((s) => {
      const currentGraph = s.graphs[s.activeGraphIndex];
      const updatedNodes = currentGraph.nodes.map((n) =>
        n.id === id ? { ...n, position: { x, y } } : n
      );
      const updatedGraph = { ...currentGraph, nodes: updatedNodes };
      const updatedGraphs = [...s.graphs];
      updatedGraphs[s.activeGraphIndex] = updatedGraph;
      return {
        graphs: updatedGraphs,
        graph: updatedGraph,
      };
    }),
}));
