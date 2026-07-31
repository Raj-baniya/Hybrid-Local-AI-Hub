import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
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

const demoNodes: Node[] = [
  { id: "n1", type: "text_input", position: { x: 0, y: 0 }, data: { label: "User Input" } },
  { id: "n2", type: "ollama_selector", position: { x: 250, y: 0 }, data: { label: "LLM Model" } },
  { id: "n3", type: "log_terminal", position: { x: 500, y: 0 }, data: { label: "Log Output" } },
];
const demoEdges: Edge[] = [
  { id: "e1-2", source: "n1", target: "n2" },
  { id: "e2-3", source: "n2", target: "n3" },
];

export default function GraphCanvas(): React.JSX.Element {
  return (
    <ReactFlow nodes={demoNodes} edges={demoEdges} nodeTypes={nodeTypes} fitView>
      <Background />
      <Controls />
    </ReactFlow>
  );
}
