/**
 * C25 Guide State Machine + Session 转换测试（F155，clowder GuideStateMachine/GuideSession 直译）。
 *
 * 覆盖：
 *  - 5 态 forward-only DAG 转移表穷举（offered/awaiting_choice/active/completed/cancelled）
 *  - applyTransition 时间戳簿记（active→startedAt / completed→completedAt）与非法转移抛错
 *  - GuideSession ↔ GuideStateV1 双向转换往返一致性（bridge 存储路径）
 */

import { describe, expect, it } from 'vitest';
import type { GuideStateV1, GuideStatus } from '../src/models.js';
import {
  VALID_TRANSITIONS,
  applyTransition,
  createOfferedState,
  isTerminal,
  isValidTransition,
  transitionToActive,
  transitionToCancelled,
  transitionToCompleted,
  validTransitionsFrom,
} from '../src/state-machine.js';
import { createSessionFromState, generateSessionId } from '../src/session.js';
import {
  ackSessionCompletion,
  createOfferedSession,
  sessionToLegacyState,
  transitionSession,
} from '../src/session-repository.js';

const ALL_GUIDE_STATUSES: GuideStatus[] = ['offered', 'awaiting_choice', 'active', 'completed', 'cancelled'];

/** 构造合法 GuideStateV1 起点（offered）。 */
function offeredState(overrides: Partial<GuideStateV1> = {}): GuideStateV1 {
  return {
    v: 1,
    guideId: 'bootcamp-add-teammate',
    status: 'offered',
    userId: 'user-1',
    offeredAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ─── 转移表穷举 ────────────────────────────────────────────────────────────

describe('C25 转移表：5 态 forward-only DAG 穷举', () => {
  it('VALID_TRANSITIONS 覆盖全部 5 态且终态为空', () => {
    for (const status of ALL_GUIDE_STATUSES) {
      expect(VALID_TRANSITIONS[status], `${status} 应有定义`).toBeDefined();
    }
    expect(VALID_TRANSITIONS.completed).toEqual([]);
    expect(VALID_TRANSITIONS.cancelled).toEqual([]);
  });

  it('每格行为确定：合法转移 true / 其余 false（无抛错、无 undefined）', () => {
    for (const from of ALL_GUIDE_STATUSES) {
      for (const to of ALL_GUIDE_STATUSES) {
        const result = isValidTransition(from, to);
        expect(typeof result).toBe('boolean');
        // 自环一律禁止
        if (from === to) expect(result).toBe(false);
      }
    }
  });

  it('关键转移：offered → awaiting_choice/active/cancelled；active → completed/cancelled', () => {
    expect(isValidTransition('offered', 'awaiting_choice')).toBe(true);
    expect(isValidTransition('offered', 'active')).toBe(true);
    expect(isValidTransition('offered', 'cancelled')).toBe(true);
    expect(isValidTransition('awaiting_choice', 'active')).toBe(true);
    expect(isValidTransition('awaiting_choice', 'cancelled')).toBe(true);
    expect(isValidTransition('active', 'completed')).toBe(true);
    expect(isValidTransition('active', 'cancelled')).toBe(true);
    // 逆转移一律禁止
    expect(isValidTransition('active', 'offered')).toBe(false);
    expect(isValidTransition('completed', 'active')).toBe(false);
    expect(isValidTransition('cancelled', 'offered')).toBe(false);
  });

  it('每个非终态至少有一个后继（无死锁态），终态无后继', () => {
    for (const status of ALL_GUIDE_STATUSES) {
      const next = validTransitionsFrom(status);
      if (isTerminal(status)) {
        expect(next).toHaveLength(0);
      } else {
        expect(next.length).toBeGreaterThan(0);
      }
    }
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('offered')).toBe(false);
  });
});

// ─── applyTransition / 专用转移 ────────────────────────────────────────────

describe('C25 applyTransition：时间戳簿记 + 非法转移', () => {
  it('offered → active 记录 startedAt（仅首次）', () => {
    const first = applyTransition(offeredState(), 'active');
    expect(first.status).toBe('active');
    expect(first.startedAt).toBeDefined();
    const again = applyTransition(first, 'completed');
    expect(again.completedAt).toBeDefined();
    // 幂等簿记：已存在 startedAt/completedAt 不再覆盖
    const withStamps = applyTransition(offeredState({ startedAt: 123, completedAt: 456 }), 'active');
    expect(withStamps.startedAt).toBe(123);
    expect(withStamps.completedAt).toBe(456);
  });

  it('active → completed 记录 completedAt；completed/cancelled 非法转移抛错', () => {
    const completed = applyTransition(offeredState({ status: 'active' }), 'completed');
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
    expect(() => applyTransition(completed, 'active')).toThrow(/Invalid guide transition/);
    expect(() => applyTransition(offeredState({ status: 'cancelled' }), 'offered')).toThrow(/Invalid guide transition/);
  });

  it('currentStep 透传（仅显式提供时写入）', () => {
    const stepped = applyTransition(offeredState(), 'active', 3);
    expect(stepped.currentStep).toBe(3);
    const plain = applyTransition(offeredState(), 'active');
    expect(plain.currentStep).toBeUndefined();
  });

  it('专用转移函数：transitionToActive/ToCompleted/ToCancelled 语义一致', () => {
    const active = transitionToActive(offeredState());
    expect(active.status).toBe('active');
    expect(active.startedAt).toBeDefined();
    const completed = transitionToCompleted({ ...active });
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
    const cancelled = transitionToCancelled(offeredState());
    expect(cancelled.status).toBe('cancelled');
  });

  it('createOfferedState：offeredBy 可选且不写入 undefined', () => {
    const withOwner = createOfferedState({ guideId: 'g', userId: 'u', offeredBy: 'cat-a' });
    expect(withOwner.offeredBy).toBe('cat-a');
    expect(withOwner.status).toBe('offered');
    const withoutOwner = createOfferedState({ guideId: 'g', userId: 'u' });
    expect(withoutOwner.offeredBy).toBeUndefined();
  });
});

// ─── GuideSession ↔ GuideStateV1 双向转换 ──────────────────────────────────

describe('C25 GuideSession ↔ GuideStateV1 转换（bridge 存储路径）', () => {
  it('createOfferedSession → sessionToLegacyState 往返字段一致', () => {
    const session = createOfferedSession({ threadId: 't-1', userId: 'user-1', guideId: 'g-1', offeredBy: 'cat-a' });
    expect(session.sessionId).toMatch(/^gs-/);
    expect(session.state).toBe('offered');
    expect(session.completionAcked).toBe(false);
    expect(session.offeredBy).toBe('cat-a');

    const legacy = sessionToLegacyState(session);
    expect(legacy.v).toBe(1);
    expect(legacy.guideId).toBe('g-1');
    expect(legacy.status).toBe('offered');
    expect(legacy.offeredBy).toBe('cat-a');
    expect(legacy.currentStep).toBeUndefined();
    expect(legacy.startedAt).toBeUndefined();
    expect(legacy.completionAcked).toBeUndefined();
  });

  it('transitionSession：active 记 startedAt、completed 记 completedAt、currentStep 条件写入', () => {
    let session = createOfferedSession({ threadId: 't-1', userId: 'user-1', guideId: 'g-1' });
    session = transitionSession(session, 'active', 2);
    expect(session.state).toBe('active');
    expect(session.startedAt).toBeDefined();
    expect(session.currentStep).toBe(2);
    // 重复 active 不覆盖 startedAt
    const startedAt = session.startedAt;
    session = transitionSession(session, 'active', 3);
    expect(session.startedAt).toBe(startedAt);
    expect(session.currentStep).toBe(3);

    session = transitionSession(session, 'completed');
    expect(session.state).toBe('completed');
    expect(session.completedAt).toBeDefined();
  });

  it('ackSessionCompletion 一次性消费标记；sessionToLegacyState 透传 true', () => {
    const acked = ackSessionCompletion(createOfferedSession({ threadId: 't-1', userId: 'u', guideId: 'g' }));
    expect(acked.completionAcked).toBe(true);
    expect(sessionToLegacyState(acked).completionAcked).toBe(true);
  });

  it('createSessionFromState（bridge.set 首次写入）与 sessionToLegacyState 往返一致', () => {
    const legacy = sessionToLegacyState(
      transitionSession(createOfferedSession({ threadId: 't-9', userId: 'u', guideId: 'g', offeredBy: 'cat-b' }), 'completed'),
    );
    const session = createSessionFromState('t-9', legacy);
    expect(session.threadId).toBe('t-9');
    expect(session.state).toBe('completed');
    expect(session.offeredBy).toBe('cat-b');
    expect(session.completionAcked).toBe(false);

    const roundTrip = sessionToLegacyState(session);
    expect(roundTrip).toEqual(legacy);
  });

  it('generateSessionId：稳定前缀 + 唯一性', () => {
    const a = generateSessionId('thread-abcdef12');
    const b = generateSessionId('thread-abcdef12');
    expect(a).toMatch(/^gs-abcdef12-\d+-\d+$/);
    expect(a).not.toBe(b);
  });
});
