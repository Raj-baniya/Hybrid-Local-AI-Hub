import { ReactFlow, Background, Controls, applyNodeChanges, type OnNodesChange } from "@xyflow/react";
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
import { useGraphStore } from "../lib/useGraphStore";

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

export default function GraphCanvas(): React.JSX.Element {
  const graph = useGraphStore((s) => s.graph);
  const setGraph = useGraphStore((s) => s.setGraph);

  const flowNodes = graph.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
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
        type: (n.type as any) || "text_input",
        label: (n.data?.label as string) || n.id,
        position: n.position,
        data: n.data as any,
      })),
    });
  };

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
