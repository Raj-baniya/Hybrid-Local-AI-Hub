import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection,
  type Edge,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";

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

const NODE_TYPES_MAP = {
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

const VALID_NODE_TYPES = new Set([
  "file_watcher",
  "image_input",
  "text_input",
  "local_embedder",
  "chromadb_store",
  "ollama_selector",
  "conditional_router",
  "local_file_writer",
  "log_terminal",
]);

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

function CanvasContent(): React.JSX.Element {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const {
    graphs,
    activeGraphIndex,
    graph,
    setGraph,
    switchTab,
    closeTab,
    createBlankTab,
    isBuildingGraph,
    buildingMessage,
  } = useGraphStore();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cycleError, setCycleError] = useState<string | null>(null);

  const memoizedNodeTypes = useMemo(() => NODE_TYPES_MAP, []);

  // Auto-center view whenever nodes count changes
  useEffect(() => {
    if (graph?.nodes && graph.nodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.25, duration: 300 });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [graph?.nodes?.length, activeGraphIndex, fitView]);

  const flowNodes = (graph?.nodes || []).map((n) => ({
    id: n.id,
    type: VALID_NODE_TYPES.has(n.type) ? n.type : "text_input",
    position: n.position && typeof n.position.x === "number" ? n.position : { x: 50, y: 50 },
    selected: n.id === selectedNodeId,
    data: { label: n.label || n.id, ...n.data },
  }));

  const flowEdges = (graph?.edges || []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.condition,
  }));

  const handleNodesChange: OnNodesChange = (changes) => {
    const hasDragChanges = changes.some(
      (c) => (c.type === "position" && c.dragging) || c.type === "remove"
    );

    if (!hasDragChanges) return;

    const currentGraph = useGraphStore.getState().graph;
    const updatedFlowNodes = applyNodeChanges(changes, flowNodes);

    const newNodes = currentGraph.nodes
      .filter((origNode) => updatedFlowNodes.some((fn) => fn.id === origNode.id))
      .map((origNode) => {
        const matched = updatedFlowNodes.find((fn) => fn.id === origNode.id);
        if (matched && matched.position) {
          return {
            ...origNode,
            position: matched.position,
          };
        }
        return origNode;
      });

    setGraph({
      ...currentGraph,
      nodes: newNodes,
    });
  };

  const handleEdgesChange: OnEdgesChange = (changes) => {
    const hasRemove = changes.some((c) => c.type === "remove");
    if (!hasRemove) return;

    const currentGraph = useGraphStore.getState().graph;
    const updatedFlowEdges = applyEdgeChanges(changes, flowEdges);
    setGraph({
      ...currentGraph,
      edges: updatedFlowEdges.map((e: Edge) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        targetHandle: e.targetHandle || undefined,
        condition: typeof e.label === "string" ? e.label : undefined,
      })),
    });
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      const currentGraph = useGraphStore.getState().graph;
      const proposed = { source: connection.source, target: connection.target };

      if (wouldCreateCycle(currentGraph.nodes, currentGraph.edges, proposed)) {
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
        ...currentGraph,
        edges: [...currentGraph.edges, newEdge],
      });
    },
    [setGraph]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = (
        event.dataTransfer.getData("application/reactflow/type") ||
        event.dataTransfer.getData("text/plain") ||
        (window as any).__DRAGGED_NODE_TYPE__
      ) as NodeType;

      const label = (
        event.dataTransfer.getData("application/reactflow/label") ||
        (window as any).__DRAGGED_NODE_LABEL__ ||
        type
      );

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

      const currentGraph = useGraphStore.getState().graph;
      setGraph({
        ...currentGraph,
        nodes: [...currentGraph.nodes, newNode],
      });
      setSelectedNodeId(newNodeId);
    },
    [screenToFlowPosition, setGraph]
  );

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden bg-white">
      {/* Chrome-Style Pipeline Tabs Bar */}
      <div className="flex items-center bg-slate-100 border-b-2 border-slate-900 px-2 pt-1.5 overflow-x-auto shrink-0 gap-1 h-9">
        {graphs.map((g, idx) => (
          <div
            key={idx}
            onClick={() => switchTab(idx)}
            className={`flex items-center gap-2 px-3 py-1 text-xs font-bold rounded-t border-t-2 border-x-2 cursor-pointer transition-colors ${
              idx === activeGraphIndex
                ? "bg-white text-slate-900 border-slate-900 shadow-xs"
                : "bg-slate-200 text-slate-600 border-slate-400 hover:bg-slate-300"
            }`}
          >
            <span className="truncate max-w-[180px]">{g.meta?.title || `Pipeline ${idx + 1}`}</span>
            {graphs.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(idx);
                }}
                className="text-slate-500 hover:text-slate-900 font-bold ml-1"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {/* Chrome-style + Add New Tab Button */}
        <button
          type="button"
          onClick={() => createBlankTab()}
          className="ml-1 px-2.5 py-0.5 text-xs font-bold text-slate-900 bg-white hover:bg-slate-200 rounded border-2 border-slate-900 transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
          title="Create New Blank Pipeline Tab"
        >
          + New Tab
        </button>
      </div>

      {/* Main Canvas + Inspector Flex Row */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Building Loader Modal Overlay */}
        {isBuildingGraph && (
          <div className="absolute inset-0 z-50 bg-white/85 backdrop-blur-xs flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="w-12 h-12 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
            <div className="text-base font-bold text-slate-900">
              {buildingMessage || "Building your pipeline graph..."}
            </div>
            <p className="text-xs text-slate-600 max-w-sm font-medium">
              AI is analyzing your prompt, compiling nodes, wiring edges, and calculating auto-layout...
            </p>
          </div>
        )}

        {cycleError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900 border border-red-700 text-red-100 text-xs px-4 py-2 rounded shadow-lg flex items-center gap-2">
            <span>⚠️</span>
            <span>{cycleError}</span>
          </div>
        )}

        <div className="flex-1 h-full w-full relative min-h-[300px]" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={memoizedNodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            deleteKeyCode={["Delete", "Backspace"]}
            minZoom={0.1}
            maxZoom={2}
            style={{ width: "100%", height: "100%" }}
          >
            <Background variant={BackgroundVariant.Lines} color="#e2e8f0" gap={24} size={1} />
            <Controls />
          </ReactFlow>
        </div>

        <NodeInspector selectedNodeId={selectedNodeId} onClose={() => setSelectedNodeId(null)} />
      </div>
    </div>
  );
}

export default function GraphCanvas(): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasContent />
    </ReactFlowProvider>
  );
}
