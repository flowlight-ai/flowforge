/**
 * F139 统一调度抽象 — 类型契约（C33 scheduler 域）。
 *
 * TS 移植自 clowder-ai `infrastructure/scheduler/types.ts`（自包含子集；
 * ExecuteContext/TaskSpec_P1 等深度依赖 ball-custody/invocation 的类型随
 * TaskRunnerV2 移植再补）。
 *
 * @module @flowforge/infrastructure-scheduler/types
 */

// ─── F139: Unified Schedule Abstraction ────────────────────

/** Single work item returned by gate — one per subject */
export interface WorkItem<Signal = unknown> {
  signal: Signal;
  subjectKey: string;
  dedupeKey?: string;
}

/** Typed signal gate result — replaces boolean eligibility checks */
export type GateResult<Signal = unknown> =
  | { run: false; reason: string }
  | { run: true; workItems: WorkItem<Signal>[] };

/** Gate context passed to admission gate */
export interface GateCtx {
  taskId: string;
  lastRunAt: number | null;
  tickCount: number;
}

/** Task profile presets (ADR-022 KD-1) */
export type TaskProfile = 'awareness' | 'poller';

/** Phase 2: Trigger spec — interval, cron, or once (#415) */
export type TriggerSpec =
  | { type: 'interval'; ms: number }
  | { type: 'cron'; expression: string; timezone?: string }
  | { type: 'once'; fireAt: number };

/** Phase 2: Context dimension — session × materialization */
export interface ContextSpec {
  session: 'new-thread' | 'same-thread';
  materialization: 'light' | 'full';
}

/** Run ledger outcome */
export type RunOutcome =
  | 'SKIP_NO_SIGNAL'
  | 'SKIP_DISABLED'
  | 'SKIP_OVERLAP'
  | 'SKIP_GLOBAL_PAUSE'
  | 'SKIP_TASK_OVERRIDE'
  | 'SKIP_SELF_ECHO'
  | 'SKIP_MISSED_WINDOW'
  | 'RUN_DELIVERED'
  | 'RUN_FAILED';

/** Actor capability namespace (Phase 1b) — NOT roster identity roles */
export type ActorRole = 'memory-curator' | 'repo-watcher' | 'health-monitor';

/** Cost tier hint for actor resolution */
export type CostTier = 'cheap' | 'deep';

/** Actor dimension (Phase 1b) — declares what kind of cat a task needs */
export interface ActorSpec {
  role: ActorRole;
  costTier: CostTier;
}

/** Phase 2.5: Display contract — task declares its own display metadata (KD-8) */
export type DisplayCategory = 'pr' | 'repo' | 'thread' | 'system' | 'external' | 'issue';

/** Phase 2.5: Subject kind for subjectPreview computation (KD-9) */
export type SubjectKind = 'pr' | 'repo' | 'thread' | 'external' | 'none' | 'issue';

/** Phase 2.5: Static display metadata declared by each task (AC-E1) */
export interface TaskDisplayMeta {
  label: string;
  category: DisplayCategory;
  description?: string;
  subjectKind?: SubjectKind;
}

/** Run ledger row (task_run_ledger 表) */
export interface RunLedgerRow {
  task_id: string;
  subject_key: string;
  outcome: RunOutcome;
  signal_summary: string;
  duration_ms: number;
  started_at: number;
  assigned_cat_id: string | null;
  error_summary?: string | null;
  scheduled_at?: number | null;
  fired_at?: number | null;
  lateness_ms?: number | null;
  missed_slots?: number | null;
  trigger_kind?: string | null;
  misfire_policy?: string | null;
}

/** Aggregate outcome stats for a task */
export interface RunStats {
  total: number;
  delivered: number;
  failed: number;
  skipped: number;
}

/** Persisted dynamic task definition — user config stored in SQLite */
export interface DynamicTaskDef {
  id: string;
  templateId: string;
  trigger: TriggerSpec;
  params: Record<string, unknown>;
  display: TaskDisplayMeta;
  deliveryThreadId: string | null;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
}

/** Emission suppression record (self-echo 防回声) */
export interface EmissionRecord {
  originTaskId: string;
  threadId: string;
  messageId: string;
  suppressionMs: number;
}

export interface EmissionRow {
  emissionId: string;
  originTaskId: string;
  threadId: string;
  messageId: string;
  suppressionUntil: string;
  createdAt: string;
}

/** Global scheduler control (pause/resume) */
export interface GlobalControl {
  enabled: boolean;
  reason: string | null;
  updatedBy: string;
  updatedAt: string;
}

/** Per-task enable/disable override */
export interface TaskOverride {
  taskId: string;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string;
}

/** Pack template definition (F255 pack delegate) */
export interface PackTemplateDef {
  templateId: string;
  packId: string;
  label: string;
  description: string;
  category: DisplayCategory;
  subjectKind: SubjectKind;
  defaultTrigger: TriggerSpec;
  paramSchema: Record<string, { type: string; required: boolean; description: string }>;
  builtinTemplateRef: string;
  createdAt?: string;
}
