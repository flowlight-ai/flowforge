/**
 * F139 统一调度抽象 — 类型契约（C33 scheduler 域）。
 *
 * TS 移植自 clowder-ai `infrastructure/scheduler/types.ts`。
 * 批次51：TaskRunnerV2/execute-pipeline 运行时随迁的类型补全
 * （TaskSpec_P1/ExecuteContext/DeliverOpts/FetchResult/ScheduleInvokeTrigger/
 *   ScheduleRunTiming/ScheduleTaskSummary/FirePolicy 等）。
 *
 * 插件化适配（对照 clowder 平台绑定）：
 *   - IBallCustodyIngest → 结构化端口 SchedulerBallCustodyIngest（本包自定义
 *     事件形状，消费方桥接 cats-ball-custody 事件日志，避免反向依赖）
 *   - RunLedgerRow 时间戳字段沿用本包 number 形态（stores.ts node:sqlite 基线）
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

// ─── 批次51: TaskRunnerV2/execute-pipeline 运行时类型 ───────────

/** 球权事件端口形状（对照 clowder BallCustodyEvent；消费方桥接 cats-ball-custody） */
export interface SchedulerBallCustodyEvent {
  sourceEventId: string;
  subjectKey: string;
  kind: string;
  classification: string;
  payload: Record<string, unknown>;
  at: number;
}

/** 球权事件摄入端口（结构化最小面，替代对 ball-custody 包的直接依赖） */
export interface SchedulerBallCustodyIngest {
  record(event: SchedulerBallCustodyEvent): Promise<void>;
}

/** 构建 hold 过期事件（对齐 ball-custody-events.buildHoldExpiredEvent） */
export function buildHoldExpiredEvent(input: {
  threadId: string;
  catId: string;
  fireAt: number;
  at: number;
}): SchedulerBallCustodyEvent {
  return {
    sourceEventId: `holdexp:${input.threadId}:${input.catId}:${input.fireAt}`,
    subjectKey: `ball:thread:${input.threadId}`,
    kind: 'ball.hold_expired',
    classification: 'state-changing',
    payload: { catId: input.catId, fireAt: input.fireAt },
    at: input.at,
  };
}

/** Phase 4: options for delivering a message to a thread */
export interface DeliverOpts {
  threadId: string;
  content: string;
  userId: string;
  /** Stable producer identity for retrying one exact persisted scheduler item. */
  idempotencyKey?: string;
  extra?: SchedulerMessageExtra;
}

/** Phase 4: result of fetching web content */
export interface FetchResult {
  text: string;
  title: string;
  url: string;
  method: 'server-fetch' | 'browser';
  truncated: boolean;
}

/** Minimal trigger policy for scheduled invocations */
export interface ScheduleTriggerPolicy {
  readonly priority?: 'urgent' | 'normal';
  readonly reason?: string;
  readonly sourceCategory?: string;
  readonly suggestedSkill?: string;
}

export type SchedulerLifecycleEvent =
  | 'registered'
  | 'paused'
  | 'resumed'
  | 'deleted'
  | 'succeeded'
  | 'failed'
  | 'missed_window';

export interface SchedulerToastPayload {
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
  duration: number;
  lifecycleEvent: SchedulerLifecycleEvent;
}

export interface SchedulerMessageExtra {
  scheduler?: {
    hiddenTrigger?: boolean;
    toast?: SchedulerToastPayload;
  };
}

export interface ScheduleLifecycleNotice {
  threadId: string;
  userId: string;
  toast: SchedulerToastPayload;
}

export type ScheduleLifecycleNotifier = (notice: ScheduleLifecycleNotice) => void;

export type ScheduleInvokeTriggerOutcome = 'dispatched' | 'enqueued' | 'full';

/** Async cat invocation trigger — callers may detach it, but resolution means durable wake acceptance. */
export interface ScheduleInvokeTrigger {
  trigger(
    threadId: string,
    catId: string,
    userId: string,
    message: string,
    messageId: string,
    contentBlocks?: readonly unknown[],
    policy?: ScheduleTriggerPolicy,
  ): Promise<ScheduleInvokeTriggerOutcome>;
}

/** Phase 1b+2: context passed to execute — carries actor resolution + context spec */
export interface ExecuteContext {
  /** Aborted when this work item's scheduler timeout fires. */
  signal: AbortSignal;
  /** Actor resolved by ActorResolver, or null if no actor spec / no match */
  assignedCatId: string | null;
  /** Phase 2: session × materialization context, if task declares one */
  context?: ContextSpec;
  /** Sleep/wake and wall-clock timing metadata for this scheduled fire. */
  schedule?: ScheduleRunTiming;
  /** Phase 4: deliver message to a thread */
  deliver?: (opts: DeliverOpts) => Promise<string>;
  /** Phase 4: fetch web content with browser-automation routing */
  fetchContent?: (url: string) => Promise<FetchResult>;
  /** Phase 4b: invoke a cat to handle a scheduled task (fire-and-forget) */
  invokeTrigger?: ScheduleInvokeTrigger;
  /** F233 PR3: optional ball-custody event sink for scheduler-originated events. */
  ballCustody?: SchedulerBallCustodyIngest;
  /** F167: hand a due managed-command fallback to its durable recovery receipt. */
  managedCommandWakeRecovery?: (taskId: string) => Promise<'missing' | 'pending' | 'recovered'>;
}

/**
 * F167 Phase M: pre-fire defer policy (scheduler-generic mechanism).
 * When the target thread is busy at fire time, the scheduler defers the once-task
 * fire (re-arm with a fresh fireAt) instead of executing — avoiding stale-wake
 * "history replay" while the actor is mid-work.
 */
export interface FirePolicy {
  deferWhileThreadBusy: boolean;
  /** thread whose busy state gates the fire */
  threadId: string;
  /** ms to wait before re-checking busy state before the next fire attempt (default 30_000) */
  deferIntervalMs?: number;
  /** max consecutive defers before force-firing (avoid infinite defer; default 10) */
  maxDefers?: number;
}

/**
 * Phase 1a TaskSpec — six dimensions minus Context (Phase 2).
 * Gate returns workItems[] for per-subject execute + ledger.
 */
export interface TaskSpec_P1<Signal = unknown> {
  id: string;
  profile: TaskProfile;
  trigger: TriggerSpec;
  /** F167 Phase M: optional pre-fire defer policy (busy thread → re-arm instead of fire) */
  firePolicy?: FirePolicy;
  admission: {
    gate: (ctx: GateCtx) => Promise<GateResult<Signal>>;
  };
  run: {
    overlap: 'skip';
    timeoutMs: number;
    execute: (signal: Signal, subjectKey: string, ctx: ExecuteContext) => Promise<void>;
  };
  state: {
    runLedger: 'sqlite';
  };
  outcome: {
    whenNoSignal: 'drop' | 'record';
  };
  enabled: () => boolean;
  /** Phase 1b: actor resolution — which actor capability this task needs */
  actor?: ActorSpec;
  /** Phase 2: context dimension — session × materialization */
  context?: ContextSpec;
  /** Phase 2.5: display metadata — label, category, description, subjectKind (AC-E1) */
  display?: TaskDisplayMeta;
}

/** Phase 3A: task source — builtin (code-registered) vs dynamic (user-registered) */
export type TaskSource = 'builtin' | 'dynamic';

export type TriggerKind = 'interval' | 'cron' | 'once' | 'manual';

export type CronMisfirePolicy = 'merge_late_one';

export interface ScheduleRunTiming {
  triggerKind: TriggerKind;
  scheduledAt: string | null;
  firedAt: string;
  latenessMs: number;
  missedSlots: number;
  late: boolean;
  misfirePolicy?: CronMisfirePolicy;
}

/** Schedule panel task summary (API response shape) */
export interface ScheduleTaskSummary {
  id: string;
  profile: TaskProfile;
  trigger: TriggerSpec;
  enabled: boolean;
  /** Phase 3B (AC-D1): effective enabled state considering global pause + task overrides */
  effectiveEnabled: boolean;
  actor?: ActorSpec;
  context?: ContextSpec;
  lastRun: RunLedgerRow | null;
  runStats: RunStats;
  /** Phase 2.5: display metadata from TaskSpec (AC-E2) */
  display?: TaskDisplayMeta;
  /** Phase 2.5: human-readable subject preview, computed by backend (AC-E2) */
  subjectPreview: string | null;
  /** Phase 3A: builtin vs dynamic task (AC-G4) */
  source: TaskSource;
  /** Phase 3A: dynamic_task_defs.id for CRUD (only for dynamic tasks) */
  dynamicTaskId?: string;
  registered: boolean;
}
