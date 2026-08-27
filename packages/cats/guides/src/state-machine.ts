/**
 * @flowforge/cats-guides — GuideStateMachine（F155，clowder 直译）。
 *
 * 5 状态 forward-only DAG：
 *   offered → [awaiting_choice, active, cancelled]
 *   awaiting_choice → [active, cancelled]
 *   active → [completed, cancelled]
 *   completed / cancelled → []（终态）
 *
 * 纯函数，无 IO；状态读写由 GuideSessionRepository/GuideLifecycleService 负责。
 *
 * @module @flowforge/cats-guides/state-machine
 */

import type { GuideStateV1, GuideStatus } from './models.js';

/** 状态转移表：state → 合法后继状态集合（clowder VALID_TRANSITIONS）。 */
export const VALID_TRANSITIONS: Record<GuideStatus, readonly GuideStatus[]> = {
  offered: ['awaiting_choice', 'active', 'cancelled'],
  awaiting_choice: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** 校验转移是否合法（含自环禁止：completed→completed 非法）。 */
export function isValidTransition(from: GuideStatus, to: GuideStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/** 是否终态（completed / cancelled）。 */
export function isTerminal(status: GuideStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/** 某状态的合法后继（供错误响应 `validTransitions` 字段）。 */
export function validTransitionsFrom(status: GuideStatus): readonly GuideStatus[] {
  return VALID_TRANSITIONS[status];
}

/** 创建 offered 初始状态。 */
export function createOfferedState(params: { guideId: string; userId: string; offeredBy?: string }): GuideStateV1 {
  return {
    v: 1,
    guideId: params.guideId,
    status: 'offered',
    userId: params.userId,
    offeredAt: Date.now(),
    ...(params.offeredBy ? { offeredBy: params.offeredBy } : {}),
  };
}

/** offered → active。 */
export function transitionToActive(state: GuideStateV1): GuideStateV1 {
  return { ...state, status: 'active', ...(!state.startedAt ? { startedAt: Date.now() } : {}) };
}

/** offered → awaiting_choice。 */
export function transitionToAwaitingChoice(state: GuideStateV1): GuideStateV1 {
  return { ...state, status: 'awaiting_choice' };
}

/** 任意非终态 → cancelled。 */
export function transitionToCancelled(state: GuideStateV1): GuideStateV1 {
  return { ...state, status: 'cancelled' };
}

/** active → completed。 */
export function transitionToCompleted(state: GuideStateV1): GuideStateV1 {
  return { ...state, status: 'completed', ...(!state.completedAt ? { completedAt: Date.now() } : {}) };
}

/**
 * 通用转移（clowder applyTransition）。
 * @throws Error 非法转移（调用方应先 isValidTransition 校验）。
 */
export function applyTransition(state: GuideStateV1, to: GuideStatus, currentStep?: number): GuideStateV1 {
  if (!isValidTransition(state.status, to)) {
    throw new Error(`Invalid guide transition: ${state.status} → ${to}`);
  }
  const base: GuideStateV1 = { ...state, status: to };
  if (currentStep !== undefined) base.currentStep = currentStep;
  if (to === 'active' && !base.startedAt) base.startedAt = Date.now();
  if (to === 'completed' && !base.completedAt) base.completedAt = Date.now();
  return base;
}
