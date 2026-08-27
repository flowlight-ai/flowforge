/**
 * @flowforge/cats-ball-custody — C24 BallCustodyProjector（事件溯源投影）
 *
 * TS 移植自 clowder-ai `packages/api/src/domains/ball-custody/BallCustodyProjector.ts`
 * （F233 Phase B）。apply(event) = read projection → transition() → 字段 effect + save；
 * rebuild = delete + replay。
 *
 * **零外部副作用**：projector 只做纯状态投影 + store.save，绝不做唤醒投递等外部副作用
 * （那些在 ProbeScheduler/WakeSender 的实时 tick 路径，rebuild 不重发）。
 *
 * Invariants:
 *  - 事件永不从 log 删除（事件 facts immutable）。
 *  - rejected transition 记 lastRejectedEvent（仅 state-changing），不改 state。
 *  - informational reject（ball.wake_sent 非 blocked）不记 lastRejectedEvent（不污染 observability）。
 *  - rebuild(replay) 得逐字段相同 projection（INV-2，无漂移）。
 *
 * 内存 EventLog / ProjectionStore 随包提供（无外部依赖），生产可替换为 Redis 等持久实现
 * （接口与 clowder Redis 版 1:1）。
 *
 * @module @flowforge/cats-ball-custody/projector
 */

import type { BallCustodyEvent, BallCustodyProjection, BallIntent, BallResolveMode } from './models.js';
import { transition } from './state-machine.js';

// ─── 存储抽象（与 clowder Redis 实现接口 1:1）────────────────────────────

/** append-only 事件日志（幂等 append：sourceEventId 已存在 → {appended:false, sequence:-1}）。 */
export interface IBallCustodyEventLog {
  append(event: BallCustodyEvent): Promise<{ appended: boolean; sequence: number }>;
  /** 按插入序读 subject 事件。fromSequence = 0-based 起点（默认 0 = 全部）。 */
  read(subjectKey: string, fromSequence?: number): Promise<BallCustodyEvent[]>;
  /** 列出所有至少有一条事件的 subjectKey。 */
  listSubjects(): Promise<string[]>;
}

/** 投影存储（get/save/listSubjectKeys/delete）。 */
export interface IBallCustodyProjectionStore {
  get(subjectKey: string): Promise<BallCustodyProjection | null>;
  save(projection: BallCustodyProjection): Promise<void>;
  listSubjectKeys(): Promise<string[]>;
  delete(subjectKey: string): Promise<void>;
}

/** 内存事件日志（测试与默认插件实例用；生产可换 Redis 持久实现）。 */
export class InMemoryBallCustodyEventLog implements IBallCustodyEventLog {
  private readonly _log = new Map<string, BallCustodyEvent[]>();
  private readonly _seen = new Set<string>();

  async append(event: BallCustodyEvent): Promise<{ appended: boolean; sequence: number }> {
    if (this._seen.has(event.sourceEventId)) {
      return { appended: false, sequence: -1 };
    }
    this._seen.add(event.sourceEventId);
    const list = this._log.get(event.subjectKey) ?? [];
    list.push(event);
    this._log.set(event.subjectKey, list);
    return { appended: true, sequence: list.length - 1 };
  }

  async read(subjectKey: string, fromSequence = 0): Promise<BallCustodyEvent[]> {
    return (this._log.get(subjectKey) ?? []).slice(fromSequence);
  }

  async listSubjects(): Promise<string[]> {
    return [...this._log.keys()];
  }
}

/** 内存投影存储（测试与默认插件实例用）。 */
export class InMemoryBallCustodyProjectionStore implements IBallCustodyProjectionStore {
  private readonly _store = new Map<string, BallCustodyProjection>();

  async get(subjectKey: string): Promise<BallCustodyProjection | null> {
    return this._store.get(subjectKey) ?? null;
  }

  async save(projection: BallCustodyProjection): Promise<void> {
    this._store.set(projection.subjectKey, { ...projection });
  }

  async listSubjectKeys(): Promise<string[]> {
    return [...this._store.keys()];
  }

  async delete(subjectKey: string): Promise<void> {
    this._store.delete(subjectKey);
  }
}

// ─── 投影器 ──────────────────────────────────────────────────────────────

const VALID_INTENTS: readonly BallIntent[] = ['handoff', 'fyi', 'done_notify'];
const VALID_RESOLVE_MODES: readonly BallResolveMode[] = ['bounces_back', 'completes'];

function createInitialProjection(subjectKey: string, now: number): BallCustodyProjection {
  return {
    subjectKey,
    state: 'new',
    holder: null,
    intent: null,
    resolveMode: null,
    heldUntil: null,
    blockedSinceAt: null,
    lastWakeAt: null,
    lastScanAt: null,
    lastStateChangeAt: now,
    lastEventAt: now,
    appliedEventCount: 0,
    lastRejectedEvent: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** accepted transition 后应用字段 effect（mutate proj）。 */
function applyFieldEffects(proj: BallCustodyProjection, event: BallCustodyEvent, now: number): void {
  const p = event.payload;
  switch (event.kind) {
    case 'ball.handed':
      if (typeof p.toCatId === 'string') proj.holder = p.toCatId;
      break;
    case 'ball.handed_cvo':
      if (typeof p.intent === 'string' && VALID_INTENTS.includes(p.intent as BallIntent)) {
        proj.intent = p.intent as BallIntent;
      }
      if (proj.state === 'parked') proj.holder = 'cvo';
      break;
    case 'ball.held':
      if (typeof p.catId === 'string') proj.holder = p.catId;
      if (typeof p.fireAt === 'number') proj.heldUntil = p.fireAt;
      break;
    case 'task.blocked':
      // 新 blocked episode：blockedSinceAt 记 episode identity，清 lastWakeAt（去重锚重置）
      proj.blockedSinceAt = now;
      proj.lastWakeAt = null;
      proj.resolveMode =
        typeof p.resolveMode === 'string' && VALID_RESOLVE_MODES.includes(p.resolveMode as BallResolveMode)
          ? (p.resolveMode as BallResolveMode)
          : null;
      break;
    case 'ball.wake_sent':
      // best-effort 唤醒已发的记录（仅 blocked 接受，见 transition）
      proj.lastWakeAt = now;
      break;
    case 'invocation.died':
      proj.lastScanAt = typeof p.lastScanAt === 'number' ? p.lastScanAt : now;
      break;
    default:
      break;
  }
}

/**
 * 清 stale transient state fields。每个 transient field 只属于特定 state，
 * 球离开该 state 旧值就 stale，必须清，否则后续判定误用 stale 值：
 *   - heldUntil 绑 active(held)：换 holder（ball.handed）或离开 active 清
 *   - blockedSinceAt/lastWakeAt 绑 blocked episode：离开 blocked 清
 *   - intent 绑 parked(cvo)：离开 parked 清
 * 进入态的 setter 在 applyFieldEffects，与本函数「离开清」互补。
 */
function clearStaleTransientFields(proj: BallCustodyProjection, event: BallCustodyEvent): void {
  if (event.kind === 'ball.handed' || proj.state !== 'active') {
    proj.heldUntil = null;
  }
  if (proj.state !== 'blocked') {
    proj.blockedSinceAt = null;
    proj.lastWakeAt = null;
    proj.resolveMode = null;
  }
  if (proj.state !== 'parked') {
    proj.intent = null;
  }
}

/** 球权投影器：消费事件 → transition → 写 projection（C24，事件纯投影）。 */
export class BallCustodyProjector {
  constructor(
    private readonly eventLog: IBallCustodyEventLog,
    private readonly store: IBallCustodyProjectionStore,
  ) {}

  /** 应用单事件到 projection。事件须已在 event log（append first）。 */
  async apply(event: BallCustodyEvent): Promise<void> {
    const now = event.at;
    const existing = await this.store.get(event.subjectKey);
    const proj = existing ?? createInitialProjection(event.subjectKey, now);

    const result = transition(proj.state, event, {
      heldUntil: proj.heldUntil,
      lastStateChangeAt: proj.lastStateChangeAt,
    });

    if (!result.ok) {
      // rejected：不改 state。state-changing 记 lastRejectedEvent（observability）；
      // informational（ball.wake_sent 非 blocked）不记（不污染）。
      const rejected: BallCustodyProjection = {
        ...proj,
        lastEventAt: now,
        updatedAt: now,
        lastRejectedEvent: event.classification === 'state-changing' ? event : proj.lastRejectedEvent,
      };
      await this.store.save(rejected);
      return;
    }

    const stateChanged = result.next !== proj.state;
    const updated: BallCustodyProjection = {
      ...proj,
      state: result.next,
      appliedEventCount: proj.appliedEventCount + 1,
      lastRejectedEvent: null,
      lastEventAt: now,
      updatedAt: now,
      lastStateChangeAt: stateChanged ? now : proj.lastStateChangeAt,
    };
    applyFieldEffects(updated, event, now);
    clearStaleTransientFields(updated, event);
    await this.store.save(updated);
  }

  /** 重建单 subject projection：删除现有 → replay 全部事件（无漂移）。 */
  async rebuild(subjectKey: string): Promise<void> {
    await this.store.delete(subjectKey);
    const events = await this.eventLog.read(subjectKey);
    for (const event of events) {
      await this.apply(event);
    }
  }

  /** 重建所有 subject projection。 */
  async rebuildAll(): Promise<void> {
    const subjects = await this.eventLog.listSubjects();
    for (const subjectKey of subjects) {
      await this.rebuild(subjectKey);
    }
  }
}
