export type SoloEventType =
  | "solo.stage.enter"
  | "solo.tool.start"
  | "solo.tool.end"
  | "solo.llm.start"
  | "solo.llm.reasoning"
  | "solo.llm.stream"
  | "solo.llm.end"
  | "solo.draft.update"
  | "solo.step.intermediate"
  | "solo.review.ready"
  | "solo.review.submitted"
  | "solo.task.paused"
  | "solo.task.resumed"
  | "solo.task.completed"
  | "solo.task.error"
  | "solo.token.stats"
  | "solo.gate.verdict"
  | "solo.agent.timeout"
  | "solo.circuit_breaker.open"
  | "solo.circuit_breaker.half_open"
  | "solo.circuit_breaker.closed";

export interface SoloWSEvent {
  type: SoloEventType | string;
  payload: Record<string, any>;
  task_id?: string;
  timestamp: string;
  seq: number;
}

export type StreamEntryType =
  | "stage"
  | "tool-call"
  | "thinking"
  | "llm-stream"
  | "intermediate"
  | "draft-update"
  | "draft-file"
  | "review"
  | "gate"
  | "system";

export interface StreamEntry {
  id: string;
  type: StreamEntryType;
  timestamp: number | string;  // numeric Date.now() or ISO string
  _serverTs?: string;          // server timestamp for display
  data: Record<string, any>;
}

export type SoloTaskPhase =
  | "idle"
  | "creating"
  | "connecting"
  | "running"
  | "paused"
  | "waiting_review"
  | "completed"
  | "error"
  | "rejected"
  | "interrupted";

export interface SoloTaskState {
  taskId: string | null;
  phase: SoloTaskPhase;
  persona: string;
  intent: string;
  entries: StreamEntry[];
  draftContent: string;
  editorContent: string;
  currentStage: string | null;
  stageProgress: { current: number; total: number };
  tokenStats: { total: number; cost: number };
  startTime: number | null;
  elapsedMs: number;
}

export interface SoloWSOptions {
  onStageEnter?: (stage: string, label: string, order: number) => void;
  onToolCall?: (type: "start" | "end", data: Record<string, any>) => void;
  onLLMStream?: (agent: string, delta: string) => void;
  onLLMReasoning?: (agent: string, delta: string) => void;
  onDraftUpdate?: (content: string, isPartial: boolean) => void;
  onReviewReady?: (summary: string) => void;
  onGateVerdict?: (verdict: Record<string, any>) => void;
  onError?: (step: string, msg: string) => void;
  onCompleted?: (data: Record<string, any>) => void;
  onTokenStats?: (tokens: number, cost: number) => void;
}
