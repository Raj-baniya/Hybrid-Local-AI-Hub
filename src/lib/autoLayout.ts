// lib/autoLayout.ts
import dagre from "dagre";
import type { GraphNodeSchema } from "./graphSchema";
import { z } from "zod";

type GNode = z.infer<typeof GraphNodeSchema>;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;

export function autoLayout<T extends GNode>(
  nodes: T[],
  edges: { source: string; target: string }[]
): T[] {
  if (!nodes || nodes.length === 0) return [];

  try {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
    g.setDefaultEdgeLabel(() => ({}));

    nodes.forEach((n) => {
      g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    });

    edges.forEach((e) => {
      if (nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target)) {
        g.setEdge(e.source, e.target);
      }
    });

    dagre.layout(g);

    return nodes.map((n, idx) => {
      const pos = g.node(n.id);
      const x = pos && typeof pos.x === "number" && !isNaN(pos.x) ? pos.x : (n.position?.x ?? idx * 250);
      const y = pos && typeof pos.y === "number" && !isNaN(pos.y) ? pos.y : (n.position?.y ?? 0);
      return { ...n, position: { x, y } };
    });
  } catch {
    // Fallback simple grid layout if dagre throws
    return nodes.map((n, idx) => ({
      ...n,
      position: n.position && typeof n.position.x === "number" && !isNaN(n.position.x)
        ? n.position
        : { x: idx * 250, y: 0 },
    }));
  }
}
