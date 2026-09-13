import dagre from 'dagre';
import { Node, Edge, Position } from '@xyflow/react';

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction = 'LR'
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 50,
    ranksep: 90,
  });

  nodes.forEach((node) => {
    // Default card dimension
    dagreGraph.setNode(node.id, { width: 280, height: 160 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - 140,
        y: nodeWithPosition.y - 80,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
