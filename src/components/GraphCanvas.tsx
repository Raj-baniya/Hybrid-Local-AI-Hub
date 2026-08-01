import { useState, useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import FileWatcherNode from "./nodes/FileWatcherNode";
import ImageInputNode from "./nodes/ImageInputNode";
import TextInputNode from "./nodes/TextInputNode";
import LocalEmbedderNode from "./nodes/LocalEmbedderNode";
import ChromaDbStoreNode from "./nodes/ChromaDbStoreNode";
import OllamaSelectorNode from "./nodes/OllamaSelectorNode";
import ConditionalRouterNode from "./nodes/ConditionalRouterNode";
import LocalFileWriterNode from "./nodes/LocalFileWriterNode";
import LogTerminalNode from "./nodes/LogTerminalNode";
import NodeInspector from "./NodeInspector";
import { useGraphStore } from "../lib/useGraphStore";
import type { NodeTypeEnum } from "../lib/graphSchema";
import { z } from "zod";

type NodeType = z.infer<typeof NodeTypeEnum>;

const nodeTypes = {
  file_watcher: FileWatcherNode,
  image_input: ImageInputNode,
  text_input: TextInputNode,
  local_embedder: LocalEmbedderNode,
  chromadb_store: ChromaDbStoreNode,
  ollama_selector: OllamaSelectorNode,
  conditional_router: ConditionalRouterNode,
  local_file_writer: LocalFileWriterNode,
  log_terminal: LogTerminalNode,
};

function getDefaultDataForType(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "file_watcher":
      return { watch_path: "" };
    case "image_input":
      return {};
    case "text_input":
      return { default_text: "" };
    case "local_embedder":
      return { model: "nomic-embed-text" };
    case "chromadb_store":
      return { collection_name: "my_collection", mode: "write" };
    case "ollama_selector":
      return { model: "llama3.2" };
    case "conditional_router":
      return { condition_type: "has_image" };
    case "local_file_writer":
      return { output_path: "", format: "md" };
    case "log_terminal":
      return {};
    default:
      return {};
  }
}

function wouldCreateCycle(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
  newEdge: { source: string; target: string }
): boolean {
  if (newEdge.source === newEdge.target) return true;

  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => {
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
  });
  if (adj.has(newEdge.source)) {
    adj.get(newEdge.source)!.push(newEdge.target);
  }

  const visited = new Set<string>();
  const queue: string[] = [newEdge.target];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === newEdge.source) return true;
    if (!visited.has(current)) {
      visited.add(current);
      const neighbors = adj.get(current) || [];
      for (const n of neighbors) {
        if (!visited.has(n)) queue.push(n);
      }
    }
  }

  return false;
}

function InnerGraphCanvas(): React.JSX.Element {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const graph = useGraphStore((s) => s.graph);
  const setGraph = useGraphStore((s) => s.setGraph);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cycleError, setCycleError] = useState<string | null>(null);

  const flowNodes = graph.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    selected: n.id === selectedNodeId,
    data: { label: n.label, ...n.data },
  }));

  const flowEdges = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.condition,
  }));

  const handleNodesChange: OnNodesChange = (changes) => {
    const updatedNodes = applyNodeChanges(changes, flowNodes);
    setGraph({
      ...graph,
      nodes: updatedNodes.map((n) => ({
        id: n.id,
        type: (n.type as NodeType) || "text_input",
        label: (n.data?.label as string) || n.id,
        position: n.position,
        data: n.data as Record<string, unknown>,
      })),
    });
  };

  const handleEdgesChange: OnEdgesChange = (changes) => {
    const updatedEdges = applyEdgeChanges(changes, flowEdges);
    setGraph({
      ...graph,
      edges: updatedEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        targetHandle: e.targetHandle || undefined,
        condition: (e.label as string) || undefined,
      })),
    });
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      const proposed = { source: connection.source, target: connection.target };

      if (wouldCreateCycle(graph.nodes, graph.edges, proposed)) {
        setCycleError(`Wiring rejected: Connection from '${connection.source}' to '${connection.target}' would create a cycle.`);
        setTimeout(() => setCycleError(null), 4000);
        return;
      }

      const newEdge = {
        id: `e_${connection.source}_${connection.target}_${Date.now()}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle || undefined,
        targetHandle: connection.targetHandle || undefined,
        condition: connection.sourceHandle || undefined,
      };

      setGraph({
        ...graph,
        edges: [...graph.edges, newEdge],
      });
    },
    [graph, setGraph]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow/type") as NodeType;
      const label = event.dataTransfer.getData("application/reactflow/label");

      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNodeId = `node_${Date.now()}`;
      const defaultData = getDefaultDataForType(type);

      const newNode = {
        id: newNodeId,
        type,
        label: label || type,
        position,
        data: defaultData,
      };

      setGraph({
        ...graph,
        nodes: [...graph.nodes, newNode],
      });
      setSelectedNodeId(newNodeId);
    },
    [screenToFlowPosition, graph, setGraph]
  );

  return (
    <div className="flex h-full w-full relative">
      {cycleError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-950 border border-red-700 text-red-200 text-xs px-4 py-2 rounded shadow-lg flex items-center gap-2">
          <span>⚠️</span>
          <span>{cycleError}</span>
        </div>
      )}

      <div className="flex-1 h-full" ref={reactFlowWrapper} onDragOver={onDragOver} onDrop={onDrop}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          deleteKeyCode={["Delete", "Backspace"]}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <NodeInspector selectedNodeId={selectedNodeId} onClose={() => setSelectedNodeId(null)} />
    </div>
  );
}

export default function GraphCanvas(): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <InnerGraphCanvas />
    </ReactFlowProvider>
  );
}
