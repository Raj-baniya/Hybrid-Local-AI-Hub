import type { NodeProps } from "@xyflow/react";

export type HubNodeData = { label: string; [key: string]: unknown };
export type HubNodeProps = NodeProps & { data: HubNodeData };
