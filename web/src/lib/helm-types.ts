export type HelmEventType =
  | "helm.stage.enter"
  | "helm.tool.start"
  | "helm.tool.end"
  | "helm.llm.start"
  | "helm.llm.reasoning"
  | "helm.llm.stream"
  | "helm.llm.end"
  | "helm.draft.update"
  | "helm.step.intermediate"
  | "helm.review.ready"
  | "helm.review.submitted"
  | "helm.task.paused"
  | "helm.task.resumed"
  | "helm.task.completed"
  | "helm.task.error"
  | "helm.token.stats"
  | "helm.gate.verdict"
  | "helm.agent.timeout"
  | "helm.circuit_breaker.open"
  | "helm.circuit_breaker.half_open"
  | "helm.circuit_breaker.closed";

export interface HelmWSEvent {
  type: HelmEventType | string;
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
  | "llm-call"
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

export type HelmTaskPhase =
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

export interface HelmTaskState {
  taskId: string | null;
  phase: HelmTaskPhase;
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

export interface HelmWSOptions {
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
