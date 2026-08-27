/**
 * @flowforge/cats-guides — GuideSession 实体（B-4，clowder GuideSession.ts 直译）。
 *
 * 独立会话实体：`gs-{threadId 后8位}-{Date.now()}-{counter}`。
 * GuideStateBridge 负责 GuideStateV1 ↔ GuideSession 双向转换。
 *
 * @module @flowforge/cats-guides/session
 */

import type { GuideSession, GuideStateV1 } from './models.js';

let sessionCounter = 0;

/** 生成 sessionId：gs-{threadId 后8位}-{ts}-{counter}（clowder generateSessionId）。 */
export function generateSessionId(threadId: string): string {
  return `gs-${threadId.slice(-8)}-${Date.now()}-${++sessionCounter}`;
}

/** 从 GuideStateV1 创建新会话（bridge.set 首次写入路径）。 */
export function createSessionFromState(threadId: string, state: GuideStateV1): GuideSession {
  return {
    sessionId: generateSessionId(threadId),
    threadId,
    userId: state.userId ?? '',
    guideId: state.guideId,
    state: state.status,
    ...(state.currentStep !== undefined ? { currentStep: state.currentStep } : {}),
    offeredAt: state.offeredAt,
    ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
    ...(state.completedAt !== undefined ? { completedAt: state.completedAt } : {}),
    completionAcked: state.completionAcked ?? false,
    ...(state.offeredBy !== undefined ? { offeredBy: state.offeredBy } : {}),
  };
}
