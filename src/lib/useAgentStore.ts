/**
 * useAgentStore.ts
 * Zustand store for AutoAgent modes in Hybrid Local AI Hub.
 * Manages agent trajectories, workflow specs, and created agent/tool state.
 */
import { create } from "zustand";
import type { ParsedAgentSpec, ParsedWorkflowSpec } from "./xmlParser";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TrajectoryStep {
  agent_name: string;
  step_index: number;
  action: string;
  content: string;
  tool_name?: string | null;
  tool_result?: string | null;
}

export interface AgentRunResult {
  success: boolean;
  final_answer: string;
  trajectory: TrajectoryStep[];
  error?: string | null;
}

export interface CreatedTool {
  toolName: string;
  generatedCode: string;
  testStdout: string;
  testStderr: string;
  testSuccess: boolean;
  exitCode: number;
  registerMessage: string;
  timestamp: string;
}

export type AgentMode = "user_mode" | "agent_editor" | "workflow_editor" | "canvas";

interface AgentStore {
  // Current active mode
  activeMode: AgentMode;
  setActiveMode: (mode: AgentMode) => void;

  // User Mode (Deep Research) state
  userModeTask: string;
  setUserModeTask: (task: string) => void;
  userModeResult: AgentRunResult | null;
  setUserModeResult: (result: AgentRunResult | null) => void;
  userModeTrajectory: TrajectoryStep[];
  appendTrajectoryStep: (step: TrajectoryStep) => void;
  clearTrajectory: () => void;
  isUserModeRunning: boolean;
  setIsUserModeRunning: (val: boolean) => void;

  // Agent Editor state
  agentRequirement: string;
  setAgentRequirement: (req: string) => void;
  agentSpecXml: string;
  setAgentSpecXml: (xml: string) => void;
  parsedAgentSpec: ParsedAgentSpec | null;
  setParsedAgentSpec: (spec: ParsedAgentSpec | null) => void;
  createdTools: CreatedTool[];
  addCreatedTool: (tool: CreatedTool) => void;
  removeCreatedTool: (toolName: string) => void;
  isAgentEditorRunning: boolean;
  setIsAgentEditorRunning: (val: boolean) => void;
  agentEditorStep: "requirement" | "profiling" | "tools" | "agent" | "done";
  setAgentEditorStep: (step: AgentStore["agentEditorStep"]) => void;

  // Workflow Editor state
  workflowRequirement: string;
  setWorkflowRequirement: (req: string) => void;
  workflowSpecXml: string;
  setWorkflowSpecXml: (xml: string) => void;
  parsedWorkflowSpec: ParsedWorkflowSpec | null;
  setParsedWorkflowSpec: (spec: ParsedWorkflowSpec | null) => void;
  workflowInput: string;
  setWorkflowInput: (val: string) => void;
  workflowResult: AgentRunResult | null;
  setWorkflowResult: (result: AgentRunResult | null) => void;
  workflowTrajectory: TrajectoryStep[];
  appendWorkflowStep: (step: TrajectoryStep) => void;
  clearWorkflowTrajectory: () => void;
  isWorkflowRunning: boolean;
  setIsWorkflowRunning: (val: boolean) => void;

  // Selected Ollama model for all modes
  selectedModel: string;
  setSelectedModel: (model: string) => void;

  // Reset everything
  resetAll: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useAgentStore = create<AgentStore>((set) => ({
  // Mode
  activeMode: "user_mode",
  setActiveMode: (mode) => set({ activeMode: mode }),

  // User Mode
  userModeTask: "",
  setUserModeTask: (task) => set({ userModeTask: task }),
  userModeResult: null,
  setUserModeResult: (result) => set({ userModeResult: result }),
  userModeTrajectory: [],
  appendTrajectoryStep: (step) =>
    set((state) => ({
      userModeTrajectory: [...state.userModeTrajectory, step],
    })),
  clearTrajectory: () => set({ userModeTrajectory: [], userModeResult: null }),
  isUserModeRunning: false,
  setIsUserModeRunning: (val) => set({ isUserModeRunning: val }),

  // Agent Editor
  agentRequirement: "",
  setAgentRequirement: (req) => set({ agentRequirement: req }),
  agentSpecXml: "",
  setAgentSpecXml: (xml) => set({ agentSpecXml: xml }),
  parsedAgentSpec: null,
  setParsedAgentSpec: (spec) => set({ parsedAgentSpec: spec }),
  createdTools: [],
  addCreatedTool: (tool) =>
    set((state) => ({
      createdTools: [tool, ...state.createdTools.filter((t) => t.toolName !== tool.toolName)],
    })),
  removeCreatedTool: (toolName) =>
    set((state) => ({
      createdTools: state.createdTools.filter((t) => t.toolName !== toolName),
    })),
  isAgentEditorRunning: false,
  setIsAgentEditorRunning: (val) => set({ isAgentEditorRunning: val }),
  agentEditorStep: "requirement",
  setAgentEditorStep: (step) => set({ agentEditorStep: step }),

  // Workflow Editor
  workflowRequirement: "",
  setWorkflowRequirement: (req) => set({ workflowRequirement: req }),
  workflowSpecXml: "",
  setWorkflowSpecXml: (xml) => set({ workflowSpecXml: xml }),
  parsedWorkflowSpec: null,
  setParsedWorkflowSpec: (spec) => set({ parsedWorkflowSpec: spec }),
  workflowInput: "",
  setWorkflowInput: (val) => set({ workflowInput: val }),
  workflowResult: null,
  setWorkflowResult: (result) => set({ workflowResult: result }),
  workflowTrajectory: [],
  appendWorkflowStep: (step) =>
    set((state) => ({
      workflowTrajectory: [...state.workflowTrajectory, step],
    })),
  clearWorkflowTrajectory: () => set({ workflowTrajectory: [], workflowResult: null }),
  isWorkflowRunning: false,
  setIsWorkflowRunning: (val) => set({ isWorkflowRunning: val }),

  // Model
  selectedModel: "qwen2.5vl:7b",
  setSelectedModel: (model) => set({ selectedModel: model }),

  // Reset
  resetAll: () =>
    set({
      userModeTask: "",
      userModeResult: null,
      userModeTrajectory: [],
      isUserModeRunning: false,
      agentRequirement: "",
      agentSpecXml: "",
      parsedAgentSpec: null,
      createdTools: [],
      isAgentEditorRunning: false,
      agentEditorStep: "requirement",
      workflowRequirement: "",
      workflowSpecXml: "",
      parsedWorkflowSpec: null,
      workflowInput: "",
      workflowResult: null,
      workflowTrajectory: [],
      isWorkflowRunning: false,
    }),
}));
