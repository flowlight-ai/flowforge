/**
 * @flowforge/cats-guides — GuideLifecycleService（B-1/B-4，clowder GuideLifecycleService.ts 直译）。
 *
 * Callback 路由编排：状态校验、持久化、socket 事件、遥测。
 * 纯状态逻辑委托 GuideStateMachine；状态读写走 GuideStateBridge（独立存储），
 * ThreadStore 仅用于线程元数据（访问控制）。
 *
 * 插件化改造（对照 clowder）：
 *   - `socketManager.emitToUser` → GuideEmitFn 回调（缺省 no-op）
 *   - `guideTransitions.add` → TelemetryFn 回调（缺省 no-op）
 *
 * @module @flowforge/cats-guides/lifecycle-service
 */

import type { GuideStateV1, GuideStatus } from './models.js';
import type { GuideThreadAccess, GuideEmitFn, TelemetryFn } from './ports.js';
import type { GuideStateBridge } from './session-repository.js';
import {
  applyTransition,
  createOfferedState,
  isTerminal,
  isValidTransition,
  transitionToActive,
  transitionToCancelled,
  validTransitionsFrom,
} from './state-machine.js';
import { canAccessGuideState } from './state-access.js';
import type { IGuideDismissTracker } from './dismiss-tracker.js';
import type { GuideRegistryLoader, OrchestrationFlow } from './registry-loader.js';
import { loadGuideFlowFrom } from './registry-loader.js';

/** Telemetry operation name mapping for generic transitions. */
const OP_NAME_MAP: Record<string, string> = {
  offered: 'guide_offer',
  awaiting_choice: 'guide_preview',
  active: 'guide_start',
  completed: 'guide_complete',
  cancelled: 'guide_cancel',
};

function telemetryName(status: string): string {
  return OP_NAME_MAP[status] ?? `guide_${status}`;
}

export interface GuideLifecycleDeps {
  /** 线程元数据存储（访问控制用；guide 状态读写走 guideStore）。 */
  threadStore: {
    get(threadId: string): GuideThreadAccess | null | Promise<GuideThreadAccess | null>;
  };
  /** 独立 guide 状态存储桥。 */
  guideStore: GuideStateBridge;
  /** socket.emitToUser 注入（缺省 no-op）。 */
  emit?: GuideEmitFn;
  /** guideTransitions telemetry 注入（缺省 no-op）。 */
  telemetry?: TelemetryFn;
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  /** guideId 注册校验（registry-loader.isValidGuideId）。 */
  isValidGuideId: (id: string) => boolean;
  /** flow 加载（registry-loader.loadGuideFlow；抛错=不可加载）。 */
  loadGuideFlow: (id: string) => OrchestrationFlow | unknown;
  /** B-6: Optional dismiss tracker for suppressing re-offers. */
  dismissTracker?: IGuideDismissTracker;
}

/** 结构化生命周期结果（路由层映射为 HTTP 响应）。 */
export type LifecycleResult =
  | { ok: true; guideState: GuideStateV1; flow?: unknown }
  | { ok: false; code: number; error: string; message?: string; validTransitions?: readonly GuideStatus[] };

/** 默认日志（无宿主时静默）。 */
function defaultLog(): { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void } {
  return {
    info: () => {},
    warn: () => {},
  };
}

export class GuideLifecycleService {
  private readonly store: GuideLifecycleDeps['threadStore'];
  private readonly guideStore: GuideStateBridge;
  private readonly emit: GuideEmitFn;
  private readonly telemetry: TelemetryFn;
  private readonly log: NonNullable<GuideLifecycleDeps['log']>;
  private readonly isValidGuideId: (id: string) => boolean;
  private readonly loadGuideFlow: (id: string) => unknown;

  constructor(deps: GuideLifecycleDeps) {
    this.store = deps.threadStore;
    this.guideStore = deps.guideStore;
    this.emit = deps.emit ?? (() => {});
    this.telemetry = deps.telemetry ?? (() => {});
    this.log = deps.log ?? defaultLog();
    this.isValidGuideId = deps.isValidGuideId;
    this.loadGuideFlow = deps.loadGuideFlow;
  }

  /** Validate guide-id mismatch when existing state has a different guide. */
  private rejectMismatchedGuide(
    existing: GuideStateV1,
    status: GuideStatus,
    existingTerminal: boolean,
  ): LifecycleResult | null {
    if (!existingTerminal) {
      return {
        ok: false,
        code: 409,
        error: 'guide_conflict',
        message: `Thread has active guide "${existing.guideId}" in status "${existing.status}" — complete or cancel it first`,
      };
    }
    if (status !== 'offered') {
      return {
        ok: false,
        code: 400,
        error: `Cannot create new guide state with status "${status}" — must start as "offered"`,
      };
    }
    return null;
  }

  /** Create, persist, and record offer state. */
  private async persistOffer(
    threadId: string,
    params: { guideId: string; userId: string; offeredBy?: string | null },
    logCtx: Record<string, unknown>,
    logMsg: string,
  ): Promise<LifecycleResult> {
    const created = createOfferedState({
      guideId: params.guideId,
      userId: params.userId,
      ...(params.offeredBy != null ? { offeredBy: params.offeredBy } : {}),
    });
    await this.guideStore.set(threadId, created);
    this.telemetry('guide_offer', 'success');
    this.log.info(logCtx, logMsg);
    return { ok: true, guideState: created };
  }

  // ── update-guide-state（通用转移）──

  async updateGuideState(params: {
    threadId: string;
    guideId: string;
    status: GuideStatus;
    currentStep?: number;
    userId: string;
    catId?: string | null;
  }): Promise<LifecycleResult> {
    const { threadId, guideId, status, currentStep, userId, catId } = params;

    const thread = await this.store.get(threadId);
    if (!thread) return { ok: false, code: 404, error: 'Thread not found' };

    if (!this.isValidGuideId(guideId)) {
      return { ok: false, code: 400, error: 'unknown_guide_id', message: `Guide "${guideId}" is not registered` };
    }

    const existing = await this.guideStore.get(threadId);
    const existingTerminal = existing ? isTerminal(existing.status) : false;

    if (existing && !existingTerminal && !canAccessGuideState(thread, existing, userId)) {
      return { ok: false, code: 403, error: 'Guide access denied' };
    }

    // First offer — no existing state
    if (!existing) {
      if (status !== 'offered') {
        return {
          ok: false,
          code: 400,
          error: `Cannot create guide state with status "${status}" — must start as "offered"`,
        };
      }
      return this.persistOffer(
        threadId,
        { guideId, userId, ...(catId != null ? { offeredBy: catId } : {}) },
        { guideId, threadId, catId },
        '[F155] guide state created: offered',
      );
    }

    // Different guide — allow new offer only if previous is terminal
    if (existing.guideId !== guideId) {
      const rejection = this.rejectMismatchedGuide(existing, status, existingTerminal);
      if (rejection) return rejection;
      return this.persistOffer(
        threadId,
        { guideId, userId, ...(catId != null ? { offeredBy: catId } : {}) },
        { guideId, threadId },
        '[F155] guide state replaced (previous was terminal)',
      );
    }

    // Same guide, terminal → fresh re-offer
    if (existingTerminal && status === 'offered') {
      return this.persistOffer(
        threadId,
        { guideId, userId, ...(catId != null ? { offeredBy: catId } : {}) },
        { guideId, threadId },
        '[F155] guide re-offered after terminal state',
      );
    }

    // Block direct → active (must use startGuide)
    if (status === 'active') {
      return {
        ok: false,
        code: 400,
        error: 'guide_start_required',
        message:
          'Use startGuide to transition a pending guide to "active" so guide_start side effects run',
      };
    }

    // Validate transition
    if (!isValidTransition(existing.status, status)) {
      return {
        ok: false,
        code: 400,
        error: `Invalid guide transition: ${existing.status} → ${status}`,
        validTransitions: validTransitionsFrom(existing.status),
      };
    }

    const updated = applyTransition(existing, status, currentStep);
    await this.guideStore.set(threadId, updated);
    this.telemetry(telemetryName(status), 'success');
    this.log.info({ guideId, threadId, transition: `${existing.status}→${status}` }, '[F155] guide state updated');
    return { ok: true, guideState: updated };
  }

  // ── start-guide（offered/awaiting_choice → active）──

  async startGuideCallback(params: { threadId: string; guideId: string; userId: string }): Promise<LifecycleResult> {
    const { threadId, guideId, userId } = params;

    if (!this.isValidGuideId(guideId)) {
      return { ok: false, code: 400, error: 'unknown_guide_id', message: `Guide "${guideId}" is not registered` };
    }

    const thread = await this.store.get(threadId);
    if (!thread || (thread as { deletedAt?: number | null }).deletedAt) {
      return { ok: false, code: 404, error: 'thread_not_found', message: `Thread "${threadId}" does not exist` };
    }
    const gs = await this.guideStore.get(threadId);
    if (!gs || gs.guideId !== guideId) {
      return {
        ok: false,
        code: 400,
        error: 'guide_not_offered',
        message: `Guide "${guideId}" has not been offered in this thread — call updateGuideState first`,
      };
    }
    if (!canAccessGuideState(thread, gs, userId)) {
      return { ok: false, code: 403, error: 'Guide access denied' };
    }
    if (gs.status !== 'offered' && gs.status !== 'awaiting_choice') {
      return {
        ok: false,
        code: 400,
        error: `Cannot start guide in status "${gs.status}" — must be "offered" or "awaiting_choice"`,
      };
    }

    try {
      this.loadGuideFlow(guideId);
    } catch (err) {
      this.log.warn({ guideId, threadId, err }, '[F155] callback start rejected — flow not loadable');
      return { ok: false, code: 400, error: 'guide_flow_invalid', message: (err as Error).message };
    }

    const updated = transitionToActive(gs);
    await this.guideStore.set(threadId, updated);
    this.emit(userId, 'guide_start', { guideId, threadId, timestamp: Date.now() });
    this.telemetry('guide_start', 'success');
    this.log.info({ guideId, threadId }, '[F155] guide started (state: active)');
    return { ok: true, guideState: updated };
  }

  // ── guide-control（active guide 的 next/skip/exit）──

  async controlGuide(params: {
    threadId: string;
    userId: string;
    action: 'next' | 'skip' | 'exit';
  }): Promise<LifecycleResult> {
    const { threadId, userId, action } = params;

    const thread = await this.store.get(threadId);
    if (!thread || (thread as { deletedAt?: number | null }).deletedAt) {
      return { ok: false, code: 404, error: 'thread_not_found', message: `Thread "${threadId}" does not exist` };
    }
    const gs = await this.guideStore.get(threadId);
    if (!gs || gs.status !== 'active') {
      return {
        ok: false,
        code: 400,
        error: 'no_active_guide',
        message: `No active guide in thread — current status: ${gs?.status ?? 'none'}`,
      };
    }
    if (!canAccessGuideState(thread, gs, userId)) {
      return { ok: false, code: 403, error: 'Guide access denied' };
    }

    // exit 落状态转移（active → cancelled）；next/skip 不改变状态
    let updated: GuideStateV1 | undefined;
    if (action === 'exit') {
      updated = transitionToCancelled(gs);
      await this.guideStore.set(threadId, updated);
    }

    // 对齐 clowder：三种 action 统一 emit + telemetry（guide_control_{action}）
    this.emit(userId, 'guide_control', { action, guideId: gs.guideId, threadId, timestamp: Date.now() });
    this.telemetry(`guide_control_${action}`, 'success');
    this.log.info({ action, guideId: gs.guideId, threadId }, '[F155] guide_control');
    return { ok: true, guideState: updated ?? gs };
  }
}

/** 从 registry loader 构造 guideId 校验 + flow 加载闭包。 */
export function registryFnsFrom(
  loader: GuideRegistryLoader,
): { isValidGuideId: (id: string) => boolean; loadGuideFlow: (id: string) => unknown } {
  return {
    isValidGuideId: (id: string) => loader.isValidGuideId(id),
    loadGuideFlow: (id: string) => loadGuideFlowFrom(loader, id),
  };
}
