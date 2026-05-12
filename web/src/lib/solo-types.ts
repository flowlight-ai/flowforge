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
  | "solo.token.stats";

export interface SoloWSEvent {
  type: SoloEventType;
  payload: Record<string, any>;
  timestamp: string;
  seq: number;
}

export interface StreamEntry {
  id: string;
  type: string;
  data: Record<string, any>;
  timestamp: string;
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
  | "rejected";
