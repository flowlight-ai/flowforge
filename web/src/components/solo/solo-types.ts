export interface ChatMessage {
  id: string;
  role: "ai" | "system" | "tool" | "stage" | "gate" | "review" | "user" | "approval";
  content: string;
  timestamp: string;
  data?: Record<string, any>;
  collapsed?: boolean;
}

export interface StepGroupData {
  id: string;
  stepNumber: number;
  stepLabel: string;
  stageKey: string;
  status: "running" | "completed" | "error";
  durationMs: number | null;
  entries: ChatMessage[];
  startTime: string;
}

export interface TaskHistoryItem {
  taskId: string;
  persona: string;
  intent: string;
  phase: import("../../lib/solo-types").SoloTaskPhase;
  timestamp: number;
}

export interface DynNode {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "error";
  type: string;
  agent?: string;
  mode?: string;
  iteration?: number;
  summary?: string;
  durationMs?: number;
  parentId?: string;
}

export interface DynEdge {
  from: string;
  to: string;
}
