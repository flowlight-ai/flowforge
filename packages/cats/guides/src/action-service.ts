/**
 * @flowforge/cats-guides — GuideActionService（B-1/B-4，clowder GuideActionService.ts 直译）。
 *
 * 前端面向的 guide 生命周期动作：start / cancel / preview / complete。
 * 含 self-heal：非共享线程上 offered 状态缺失时自动补齐（直接建 active/awaiting_choice）。
 *
 * 插件化改造：socket.emitToUser → GuideEmitFn 注入；guideTransitions → TelemetryFn 注入。
 *
 * @module @flowforge/cats-guides/action-service
 */

import type { GuideStateV1 } from './models.js';
import type { GuideEmitFn, TelemetryFn } from './ports.js';
import type { GuideLifecycleDeps, LifecycleResult } from './lifecycle-service.js';
import type { GuideStateBridge } from './session-repository.js';
import {
  createOfferedState,
  isTerminal,
  transitionToActive,
  transitionToAwaitingChoice,
  transitionToCancelled,
  transitionToCompleted,
} from './state-machine.js';
import { canAccessGuideState, canAccessThread, isSharedDefaultThread } from './state-access.js';
import type { IGuideDismissTracker } from './dismiss-tracker.js';

export class GuideActionService {
  private readonly store: GuideLifecycleDeps['threadStore'];
  private readonly guideStore: GuideStateBridge;
  private readonly emit: GuideEmitFn;
  private readonly telemetry: TelemetryFn;
  private readonly log: NonNullable<GuideLifecycleDeps['log']>;
  private readonly loadGuideFlow: (id: string) => unknown;
  private readonly dismissTracker: IGuideDismissTracker | undefined;

  constructor(deps: GuideLifecycleDeps) {
    this.store = deps.threadStore;
    this.guideStore = deps.guideStore;
    this.emit = deps.emit ?? (() => {});
    this.telemetry = deps.telemetry ?? (() => {});
    this.log = deps.log ?? { info: () => {}, warn: () => {} };
    this.loadGuideFlow = deps.loadGuideFlow;
    this.dismissTracker = deps.dismissTracker;
  }

  // ── start（with self-heal）──

  async startGuideAction(params: { threadId: string; guideId: string; userId: string }): Promise<LifecycleResult> {
    const { threadId, guideId, userId } = params;

    const thread = await this.store.get(threadId);
    if (!thread) return { ok: false, code: 404, error: 'Thread not found' };
    if (!canAccessThread(thread, userId)) return { ok: false, code: 403, error: 'Thread access denied' };

    try {
      this.loadGuideFlow(guideId);
    } catch (err) {
      this.log.warn({ guideId, threadId, err }, '[F155] start rejected — flow not loadable');
      return { ok: false, code: 400, error: 'guide_flow_invalid', message: (err as Error).message };
    }

    const createActiveState = (): GuideStateV1 =>
      transitionToActive(
        createOfferedState({
          guideId,
          userId,
        }),
      );

    const gs = await this.guideStore.get(threadId);
    if (!gs) {
      if (isSharedDefaultThread(thread)) {
        return { ok: false, code: 409, error: 'guide_not_offered', message: 'No guide offered on shared thread' };
      }
      const created = createActiveState();
      await this.guideStore.set(threadId, created);
      this.emit(userId, 'guide_start', { guideId, threadId, timestamp: Date.now() });
      this.telemetry('guide_start', 'success');
      this.log.info({ guideId, threadId, userId }, '[F155] guide started (self-healed missing offered state)');
      return { ok: true, guideState: created };
    }

    if (gs.guideId !== guideId) {
      if (!canAccessGuideState(thread, gs, userId)) {
        return { ok: false, code: 403, error: 'Guide access denied' };
      }
      if (isTerminal(gs.status)) {
        const replaced = createActiveState();
        await this.guideStore.set(threadId, replaced);
        this.emit(userId, 'guide_start', { guideId, threadId, timestamp: Date.now() });
        this.telemetry('guide_start', 'success');
        this.log.info(
          { guideId, threadId, userId, replacedGuideId: gs.guideId },
          '[F155] guide started (replaced terminal guide state)',
        );
        return { ok: true, guideState: replaced };
      }
      return {
        ok: false,
        code: 400,
        error: 'guide_not_offered',
        message: `Guide "${guideId}" not offered in this thread`,
      };
    }
    if (!canAccessGuideState(thread, gs, userId)) {
      return { ok: false, code: 403, error: 'Guide access denied' };
    }
    if (gs.status !== 'offered' && gs.status !== 'awaiting_choice') {
      return { ok: false, code: 400, error: `Cannot start guide in status "${gs.status}"` };
    }

    const updated = transitionToActive(gs);
    await this.guideStore.set(threadId, updated);
    this.emit(userId, 'guide_start', { guideId, threadId, timestamp: Date.now() });
    this.telemetry('guide_start', 'success');
    this.log.info({ guideId, threadId, userId }, '[F155] guide started via frontend action');
    return { ok: true, guideState: updated };
  }

  // ── cancel ──

  async cancelGuideAction(params: { threadId: string; guideId: string; userId: string }): Promise<LifecycleResult> {
    const { threadId, guideId, userId } = params;

    const thread = await this.store.get(threadId);
    if (!thread) return { ok: false, code: 404, error: 'Thread not found' };
    if (!canAccessThread(thread, userId)) return { ok: false, code: 403, error: 'Thread access denied' };

    const gs = await this.guideStore.get(threadId);
    if (!gs || gs.guideId !== guideId) {
      return { ok: true, guideState: null as unknown as GuideStateV1 };
    }
    if (!canAccessGuideState(thread, gs, userId)) {
      return { ok: false, code: 403, error: 'Guide access denied' };
    }
    if (isTerminal(gs.status)) {
      return { ok: true, guideState: gs };
    }

    const wasOfferStage = gs.status === 'offered' || gs.status === 'awaiting_choice';
    const updated = transitionToCancelled(gs);
    await this.guideStore.set(threadId, updated);
    this.emit(userId, 'guide_control', { action: 'exit', guideId, threadId, timestamp: Date.now() });
    this.telemetry('guide_cancel', 'success');
    this.log.info({ guideId, threadId, userId }, '[F155] guide cancelled via frontend action');

    // B-6: Track dismissal only for offer-stage cancels (not active guide exits)
    if (wasOfferStage) {
      this.dismissTracker?.incrementDismiss(userId, guideId).catch(() => {});
    }

    return { ok: true, guideState: updated };
  }

  // ── preview（offered → awaiting_choice, with self-heal）──

  async previewGuideAction(params: { threadId: string; guideId: string; userId: string }): Promise<LifecycleResult> {
    const { threadId, guideId, userId } = params;

    const thread = await this.store.get(threadId);
    if (!thread) return { ok: false, code: 404, error: 'Thread not found' };
    if (!canAccessThread(thread, userId)) return { ok: false, code: 403, error: 'Thread access denied' };

    let flow: unknown;
    try {
      flow = this.loadGuideFlow(guideId);
    } catch {
      return { ok: false, code: 400, error: 'guide_flow_invalid', message: `Guide flow "${guideId}" not found` };
    }

    const gs = await this.guideStore.get(threadId);
    if (!gs) {
      if (isSharedDefaultThread(thread)) {
        return { ok: false, code: 409, error: 'guide_not_offered', message: 'No guide offered on shared thread' };
      }
      const created: GuideStateV1 = {
        v: 1,
        guideId,
        status: 'awaiting_choice',
        userId,
        offeredAt: Date.now(),
      };
      await this.guideStore.set(threadId, created);
      this.telemetry('guide_preview', 'success');
      this.log.info({ guideId, threadId, userId }, '[F155] guide preview (self-healed to awaiting_choice)');
      return { ok: true, guideState: created, flow };
    }

    if (gs.guideId !== guideId) {
      return {
        ok: false,
        code: 400,
        error: 'guide_not_offered',
        message: `Guide "${guideId}" not offered in this thread`,
      };
    }
    if (!canAccessGuideState(thread, gs, userId)) {
      return { ok: false, code: 403, error: 'Guide access denied' };
    }

    if (gs.status === 'offered') {
      const updated = transitionToAwaitingChoice(gs);
      await this.guideStore.set(threadId, updated);
      this.telemetry('guide_preview', 'success');
      this.log.info({ guideId, threadId, userId }, '[F155] guide preview (offered → awaiting_choice)');
      return { ok: true, guideState: updated, flow };
    }

    return { ok: true, guideState: gs, flow };
  }

  // ── complete（active → completed）──

  async completeGuideAction(params: { threadId: string; guideId: string; userId: string }): Promise<LifecycleResult> {
    const { threadId, guideId, userId } = params;

    const thread = await this.store.get(threadId);
    if (!thread) return { ok: false, code: 404, error: 'Thread not found' };
    if (!canAccessThread(thread, userId)) return { ok: false, code: 403, error: 'Thread access denied' };

    const gs = await this.guideStore.get(threadId);
    if (!gs || gs.guideId !== guideId) {
      return {
        ok: false,
        code: 400,
        error: 'guide_not_active',
        message: `Guide "${guideId}" not active in this thread`,
      };
    }
    if (!canAccessGuideState(thread, gs, userId)) {
      return { ok: false, code: 403, error: 'Guide access denied' };
    }
    if (gs.status === 'completed') {
      return { ok: true, guideState: gs };
    }
    if (gs.status !== 'active') {
      return { ok: false, code: 400, error: `Cannot complete guide in status "${gs.status}"` };
    }

    const updated = transitionToCompleted(gs);
    await this.guideStore.set(threadId, updated);
    this.emit(userId, 'guide_complete', { guideId, threadId, timestamp: Date.now() });
    this.telemetry('guide_complete', 'success');
    this.log.info({ guideId, threadId, userId }, '[F155] guide completed via frontend action');
    return { ok: true, guideState: updated };
  }
}
