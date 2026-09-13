import { Edge, Node } from '@xyflow/react';

/**
 * Checks if adding candidate edge (source -> target) would introduce a cycle.
 * Uses DFS with 3-color marking (0: unvisited, 1: currently visiting in recursion stack, 2: fully explored).
 */
export function wouldCreateCycle(
  nodes: Node[],
  edges: Edge[],
  candidate: { source: string; target: string }
): boolean {
  if (candidate.source === candidate.target) return true;

  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
  }

  for (const e of edges) {
    const list = adj.get(e.source) || [];
    list.push(e.target);
    adj.set(e.source, list);
  }

  // Add candidate edge
  const candidateList = adj.get(candidate.source) || [];
  candidateList.push(candidate.target);
  adj.set(candidate.source, candidateList);

  // Colors: 0 = unvisited, 1 = visiting, 2 = visited
  const color = new Map<string, number>();
  for (const n of nodes) {
    color.set(n.id, 0);
  }

  function dfs(u: string): boolean {
    color.set(u, 1);
    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      const c = color.get(v) ?? 0;
      if (c === 1) return true; // back-edge detected -> cycle!
      if (c === 0 && dfs(v)) return true;
    }
    color.set(u, 2);
    return false;
  }

  for (const n of nodes) {
    if (color.get(n.id) === 0) {
      if (dfs(n.id)) return true;
    }
  }

  return false;
}
