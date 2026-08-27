/**
 * @flowforge/cats-guides — GuideSessionRepository（B-4，clowder GuideSessionRepository.ts 直译）。
 *
 * Guide 状态独立存储（运行期仅内存，重启即清空）：
 *   - IGuideSessionStore port + InMemoryGuideSessionStore
 *   - createOfferedSession / transitionSession / ackSessionCompletion 转换助手
 *   - GuideStateBridge 适配器：对既有服务暴露 GuideStateV1 接口，底层持久化 GuideSession
 *
 * @module @flowforge/cats-guides/session-repository
 */

import type { GuideSession, GuideStateV1, GuideStatus } from './models.js';
import { createSessionFromState, generateSessionId } from './session.js';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface IGuideSessionStore {
  getByThread(threadId: string): Promise<GuideSession | null>;
  save(session: GuideSession): Promise<void>;
  delete(threadId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-Memory Implementation（guide state is runtime-only）
// ---------------------------------------------------------------------------

export class InMemoryGuideSessionStore implements IGuideSessionStore {
  private readonly sessions = new Map<string, GuideSession>();

  async getByThread(threadId: string): Promise<GuideSession | null> {
    return this.sessions.get(threadId) ?? null;
  }

  async save(session: GuideSession): Promise<void> {
    this.sessions.set(session.threadId, session);
  }

  async delete(threadId: string): Promise<void> {
    this.sessions.delete(threadId);
  }
}

// ---------------------------------------------------------------------------
// Conversion helpers（服务层用这些更新会话）
// ---------------------------------------------------------------------------

/** 创建 offered 会话。 */
export function createOfferedSession(params: {
  threadId: string;
  userId: string;
  guideId: string;
  offeredBy?: string;
}): GuideSession {
  return {
    sessionId: generateSessionId(params.threadId),
    threadId: params.threadId,
    userId: params.userId,
    guideId: params.guideId,
    state: 'offered',
    offeredAt: Date.now(),
    completionAcked: false,
    ...(params.offeredBy !== undefined ? { offeredBy: params.offeredBy } : {}),
  };
}

/** 会话状态转移（时间戳簿记：active→startedAt / completed→completedAt）。 */
export function transitionSession(session: GuideSession, newState: GuideStatus, currentStep?: number): GuideSession {
  return {
    ...session,
    state: newState,
    ...(currentStep !== undefined ? { currentStep } : {}),
    ...(newState === 'active' && !session.startedAt ? { startedAt: Date.now() } : {}),
    ...(newState === 'completed' ? { completedAt: Date.now() } : {}),
  };
}

/** 确认完成（一次性消费标记）。 */
export function ackSessionCompletion(session: GuideSession): GuideSession {
  return { ...session, completionAcked: true };
}

// ---------------------------------------------------------------------------
// Legacy adapter（GuideSession ↔ GuideStateV1）
// ---------------------------------------------------------------------------

/** GuideSession → GuideStateV1。 */
export function sessionToLegacyState(session: GuideSession): GuideStateV1 {
  return {
    v: 1,
    guideId: session.guideId,
    status: session.state,
    userId: session.userId,
    ...(session.currentStep !== undefined ? { currentStep: session.currentStep } : {}),
    offeredAt: session.offeredAt,
    ...(session.startedAt !== undefined ? { startedAt: session.startedAt } : {}),
    ...(session.completedAt !== undefined ? { completedAt: session.completedAt } : {}),
    ...(session.completionAcked ? { completionAcked: true } : {}),
    ...(session.offeredBy !== undefined ? { offeredBy: session.offeredBy } : {}),
  };
}

/** GuideStateV1 → 既有会话（保留 sessionId/threadId 身份）。 */
function updateSessionFromState(existing: GuideSession, state: GuideStateV1): GuideSession {
  return {
    ...existing,
    guideId: state.guideId,
    state: state.status,
    userId: state.userId ?? existing.userId,
    ...(state.currentStep !== undefined ? { currentStep: state.currentStep } : {}),
    offeredAt: state.offeredAt,
    ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
    ...(state.completedAt !== undefined ? { completedAt: state.completedAt } : {}),
    completionAcked: state.completionAcked ?? false,
    ...(state.offeredBy !== undefined ? { offeredBy: state.offeredBy } : {}),
  };
}

// ---------------------------------------------------------------------------
// Bridge：对服务暴露 GuideStateV1，底层持久化 GuideSession
// ---------------------------------------------------------------------------

/**
 * 适配器：既有服务调 bridge.get/set（GuideStateV1 接口），
 * 底层通过独立 session store 持久化 GuideSession 实体。
 */
export class GuideStateBridge {
  constructor(private readonly store: IGuideSessionStore) {}

  async get(threadId: string): Promise<GuideStateV1 | undefined> {
    const session = await this.store.getByThread(threadId);
    return session ? sessionToLegacyState(session) : undefined;
  }

  async set(threadId: string, state: GuideStateV1): Promise<void> {
    const existing = await this.store.getByThread(threadId);
    const session = existing ? updateSessionFromState(existing, state) : createSessionFromState(threadId, state);
    await this.store.save(session);
  }

  async delete(threadId: string): Promise<void> {
    await this.store.delete(threadId);
  }
}

/** 创建 GuideStateBridge（独立 session store）。 */
export function createGuideStoreBridge(store: IGuideSessionStore): GuideStateBridge {
  return new GuideStateBridge(store);
}
