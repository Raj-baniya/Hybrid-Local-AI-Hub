// lib/useGraphStore.ts
import { create } from "zustand";
import type { GraphState } from "./graphSchema";

type GraphStore = {
  graph: GraphState;
  setGraph: (g: GraphState) => void;
  updateNodePosition: (id: string, x: number, y: number) => void;
};

export const useGraphStore = create<GraphStore>((set) => ({
  graph: { nodes: [], edges: [] },
  setGraph: (g) => set({ graph: g }),
  updateNodePosition: (id, x, y) =>
    set((s) => ({
      graph: {
        ...s.graph,
        nodes: s.graph.nodes.map((n) =>
          n.id === id ? { ...n, position: { x, y } } : n
        ),
      },
    })),
}));
