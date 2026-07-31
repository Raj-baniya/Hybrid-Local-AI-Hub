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
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return { ...n, position: { x, y } };
  });
}
