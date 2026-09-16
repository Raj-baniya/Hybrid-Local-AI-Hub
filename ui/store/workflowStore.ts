import { create } from 'zustand';
import { Node, Edge, addEdge, Connection, applyNodeChanges, applyEdgeChanges, NodeChange, EdgeChange } from '@xyflow/react';
import { Graph, NodeType } from '../schema/graphSchema';
import { getLayoutedElements } from '../utils/autoLayout';
import { wouldCreateCycle } from '../utils/cycleCheck';

export interface TabData {
  id: string;
  title: string;
  filePath: string | null;
  nodes: Node[];
  edges: Edge[];
  isDirty: boolean;
}

export interface NodeExecutionState {
  status: 'idle' | 'running' | 'success' | 'failed' | 'skipped';
  durationMs?: number;
  outputPreview?: string;
  error?: string;
}

export interface ExecutionRecord {
  execution_id: string;
  trigger_source: string;
  graph_id?: string;
  started_at: string;
  finished_at?: string;
  overall_status: 'running' | 'success' | 'partialfailure' | 'failed';
  nodes: Array<{
    node_id: string;
    node_type: string;
    status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
    started_at?: string;
    finished_at?: string;
    duration_ms?: number;
    output_preview?: string;
    error?: string;
  }>;
}

interface WorkflowState {
  tabs: TabData[];
  activeTabId: string;
  selectedNodeId: string | null;
  activePanel: 'none' | 'nodes' | 'chat' | 'logs' | 'models' | 'inspector' | 'agents' | 'help';
  nodeStatusMap: Record<string, NodeExecutionState>;
  executionRecord: ExecutionRecord | null;
  isExecuting: boolean;
  theme: 'dark' | 'light';
  
  isPreRunDialogOpen: boolean;
  setPreRunDialogOpen: (isOpen: boolean) => void;

  // Tab management
  createTab: (title?: string, initialGraph?: Graph) => string;
  closeTab: (tabId: string) => void;
  requestCloseTab: (tabId: string) => void;
  confirmCloseTab: () => void;
  cancelCloseTab: () => void;
  markTabClean: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  setTabFilePath: (tabId: string, path: string, title?: string) => void;
  
  tabToClose: string | null;
  isSavePromptOpen: boolean;

  // Canvas Actions
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => boolean;
  addNode: (type: NodeType['type'], position?: { x: number; y: number }) => string;
  updateNodeData: (nodeId: string, data: Partial<NodeType>) => void;
  deleteNode: (nodeId: string) => void;
  autoLayout: (direction?: 'LR' | 'TB') => void;

  // Selection & UI
  setSelectedNodeId: (nodeId: string | null) => void;
  setActivePanel: (panel: 'none' | 'nodes' | 'chat' | 'logs' | 'models' | 'inspector' | 'agents' | 'help') => void;
  setTheme: (theme: 'dark' | 'light') => void;

  // Execution & Logs
  setNodeStatus: (nodeId: string, status: NodeExecutionState) => void;
  clearNodeStatuses: () => void;
  setExecutionRecord: (record: ExecutionRecord | null) => void;
  setIsExecuting: (val: boolean) => void;

  // Interop
  loadGraphIntoActiveTab: (graph: Graph, title?: string, path?: string) => void;
  getActiveGraph: () => Graph;
}

const defaultInitialGraph: Graph = {
  version: 1,
  nodes: [],
  edges: [],
};

function graphToCanvas(graph: Graph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((n, idx) => ({
    id: n.id,
    type: n.data.type,
    position: n.position
      ? { x: n.position[0], y: n.position[1] }
      : { x: 100 + idx * 300, y: 150 + (idx % 2) * 50 },
    data: n.data,
  }));

  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    animated: true,
  }));

  return { nodes, edges };
}

export function canvasToGraph(nodes: Node[], edges: Edge[]): Graph {
  return {
    version: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      position: [Math.round(n.position.x), Math.round(n.position.y)],
      data: n.data as NodeType,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  };
}

const initialCanvas = graphToCanvas(defaultInitialGraph);
const initialTabId = 'tab_default';

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  tabs: [
    {
      id: initialTabId,
      title: 'Fitness Pipeline',
      filePath: null,
      nodes: initialCanvas.nodes,
      edges: initialCanvas.edges,
      isDirty: false,
    },
  ],
  activeTabId: initialTabId,
  selectedNodeId: null,
  activePanel: 'none',
  nodeStatusMap: {},
  executionRecord: null,
  isExecuting: false,
  theme: (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  isPreRunDialogOpen: false,
  tabToClose: null,
  isSavePromptOpen: false,

  setPreRunDialogOpen: (isOpen) => set({ isPreRunDialogOpen: isOpen }),

  createTab: (title, initialGraph) => {
    const newId = `tab_${Date.now()}`;
    const graph = initialGraph ?? { version: 1, nodes: [], edges: [] };
    const canvas = graphToCanvas(graph);
    const newTab: TabData = {
      id: newId,
      title: title || 'Untitled Workflow',
      filePath: null,
      nodes: canvas.nodes,
      edges: canvas.edges,
      isDirty: false,
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newId,
      selectedNodeId: null,
      nodeStatusMap: {},
      executionRecord: null,
    }));
    return newId;
  },

  requestCloseTab: (tabId) => {
    const state = get();
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    if (tab.isDirty) {
      set({ tabToClose: tabId, isSavePromptOpen: true });
    } else {
      get().closeTab(tabId);
    }
  },

  confirmCloseTab: () => {
    const { tabToClose } = get();
    if (tabToClose) {
      get().closeTab(tabToClose);
    }
    set({ tabToClose: null, isSavePromptOpen: false });
  },

  cancelCloseTab: () => {
    set({ tabToClose: null, isSavePromptOpen: false });
  },

  markTabClean: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map(t => t.id === tabId ? { ...t, isDirty: false } : t)
    }));
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return; // Keep at least one tab
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    let nextActiveId = activeTabId;
    if (activeTabId === tabId) {
      nextActiveId = nextTabs[nextTabs.length - 1].id;
    }
    set({ tabs: nextTabs, activeTabId: nextActiveId, selectedNodeId: null });
  },

  switchTab: (tabId) => {
    set({ activeTabId: tabId, selectedNodeId: null, nodeStatusMap: {}, executionRecord: null });
  },

  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },

  setTabFilePath: (tabId, path, title) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              filePath: path,
              title: title || path.split(/[/\\]/).pop() || t.title,
              isDirty: false,
            }
          : t
      ),
    }));
  },

  onNodesChange: (changes) => {
    const { tabs, activeTabId } = get();
    set({
      tabs: tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              nodes: applyNodeChanges(changes, tab.nodes),
              isDirty: true,
            }
          : tab
      ),
    });
  },

  onEdgesChange: (changes) => {
    const { tabs, activeTabId } = get();
    set({
      tabs: tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              edges: applyEdgeChanges(changes, tab.edges),
              isDirty: true,
            }
          : tab
      ),
    });
  },

  onConnect: (connection) => {
    const { tabs, activeTabId } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab || !connection.source || !connection.target) return false;

    // Check DFS cycle rejection
    if (wouldCreateCycle(activeTab.nodes, activeTab.edges, { source: connection.source, target: connection.target })) {
      return false; // Reject cycle
    }

    const newEdges = addEdge(
      {
        ...connection,
        animated: true,
        id: `e_${connection.source}_${connection.target}_${Date.now()}`,
      },
      activeTab.edges
    );

    set({
      tabs: tabs.map((tab) =>
        tab.id === activeTabId ? { ...tab, edges: newEdges, isDirty: true } : tab
      ),
    });
    return true;
  },

  addNode: (type, position) => {
    const { tabs, activeTabId } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return '';

    const id = `${type.toLowerCase().replace('node', '')}_${Date.now().toString().slice(-4)}`;
    const pos = position || {
      x: 150 + (activeTab.nodes.length % 5) * 60,
      y: 150 + (activeTab.nodes.length % 5) * 60,
    };

    let defaultData: NodeType;
    switch (type) {
      case 'FileWatcherNode':
        defaultData = { type, watchPath: './intake', pattern: '*.pdf', recursive: false };
        break;
      case 'TextInputNode':
        defaultData = { type, text: 'Input data template' };
        break;
      case 'ImageInputNode':
        defaultData = { type, imagePath: './image.png' };
        break;
      case 'OllamaSelectorNode':
        defaultData = { type, model: 'llama3.2', temperature: 0.7, promptTemplate: 'Summarize: {{input}}', jsonMode: false };
        break;
      case 'LocalEmbedderNode':
        defaultData = { type, model: 'nomic-embed-text' };
        break;
      case 'PDFExtractorNode':
        defaultData = { type, pageRange: null };
        break;
      case 'ChromaDbStoreNode':
        defaultData = { type, collectionName: 'knowledge_base', chromaUrl: 'http://localhost:8000', inputMap: null };
        break;
      case 'ConditionalRouterNode':
        defaultData = { type, condition: 'output.contains("urgent")', trueTarget: '', falseTarget: '' };
        break;
      case 'LocalFileWriterNode':
        defaultData = { type, outputPath: './output/result.txt', append: false };
        break;
    }

    const newNode: Node = {
      id,
      type,
      position: pos,
      data: defaultData,
    };

    set({
      tabs: tabs.map((tab) =>
        tab.id === activeTabId
          ? { ...tab, nodes: [...tab.nodes, newNode], isDirty: true }
          : tab
      ),
      selectedNodeId: id,
    });

    return id;
  },

  updateNodeData: (nodeId, partialData) => {
    const { tabs, activeTabId } = get();
    set({
      tabs: tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              nodes: tab.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, ...partialData } } : n
              ),
              isDirty: true,
            }
          : tab
      ),
    });
  },

  deleteNode: (nodeId) => {
    const { tabs, activeTabId, selectedNodeId } = get();
    set({
      tabs: tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              nodes: tab.nodes.filter((n) => n.id !== nodeId),
              edges: tab.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
              isDirty: true,
            }
          : tab
      ),
      selectedNodeId: selectedNodeId === nodeId ? null : selectedNodeId,
    });
  },

  autoLayout: (direction = 'LR') => {
    const { tabs, activeTabId } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab || activeTab.nodes.length === 0) return;

    const layouted = getLayoutedElements(activeTab.nodes, activeTab.edges, direction);
    set({
      tabs: tabs.map((tab) =>
        tab.id === activeTabId
          ? { ...tab, nodes: layouted.nodes, edges: layouted.edges, isDirty: true }
          : tab
      ),
    });
  },

  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
  setActivePanel: (panel) => set({ activePanel: panel }),

  setNodeStatus: (nodeId, status) => {
    set((state) => ({
      nodeStatusMap: {
        ...state.nodeStatusMap,
        [nodeId]: status,
      },
    }));
  },

  clearNodeStatuses: () => set({ nodeStatusMap: {} }),
  setExecutionRecord: (record) => set({ executionRecord: record }),
  setIsExecuting: (val) => set({ isExecuting: val }),

  loadGraphIntoActiveTab: (graph, title, path) => {
    const { tabs, activeTabId } = get();
    const canvas = graphToCanvas(graph);
    const layouted = getLayoutedElements(canvas.nodes, canvas.edges, 'LR');

    set({
      tabs: tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              title: title || tab.title,
              filePath: path || tab.filePath,
              nodes: layouted.nodes,
              edges: layouted.edges,
              isDirty: false,
            }
          : tab
      ),
      selectedNodeId: null,
      nodeStatusMap: {},
      executionRecord: null,
    });
  },

  getActiveGraph: () => {
    const { tabs, activeTabId } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return { version: 1, nodes: [], edges: [] };
    return canvasToGraph(activeTab.nodes, activeTab.edges);
  },
}));
