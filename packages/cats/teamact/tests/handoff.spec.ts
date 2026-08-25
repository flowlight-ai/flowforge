/**
 * @flowforge/cats-teamact — T7.17 HandoffCapsule 交接胶囊契约验证。
 *
 * 对齐 `core/teamact/handoff.py`（roleagent.md §2.3 协议层硬要求）：
 *   - 自动生成 capsule_id（capsule-{uuid12}）
 *   - to_summary 人类可读摘要
 *   - is_valid 完整性校验（from/to 非空、summary/next_step 非空、不能自己交给自己）
 *
 * @module @flowforge/cats-teamact/tests
 */

import { describe, expect, it } from 'vitest';
import { newHandoffCapsule } from '../src/handoff.js';

function makeCapsule() {
  return newHandoffCapsule({
    fromAgent: 'architect',
    toAgent: 'developer',
    taskSummary: '完成登录模块设计',
    rationale: '采用 token 方案',
    tradeoffs: '牺牲离线可用性换安全性',
    decisionsMade: ['token 而非 session'],
    openQuestions: ['刷新令牌策略'],
    nextStep: '实现登录 API',
    contextSnapshot: { spec: 'auth-v2' },
  });
}

describe('HandoffCapsule 创建', () => {
  it('自动生成 capsule_id（capsule- 前缀 + 12 位 uuid）', () => {
    const cap = makeCapsule();
    expect(cap.capsuleId).toMatch(/^capsule-[0-9a-f]{12}$/);
  });

  it('缺省字段使用空值/空列表/当前时间', () => {
    const cap = newHandoffCapsule({
      fromAgent: 'a',
      toAgent: 'b',
      taskSummary: 's',
      nextStep: 'n',
    });
    expect(cap.rationale).toBe('');
    expect(cap.tradeoffs).toBe('');
    expect(cap.decisionsMade).toEqual([]);
    expect(cap.openQuestions).toEqual([]);
    expect(cap.contextSnapshot).toEqual({});
    expect(cap.createdAt).toBeInstanceOf(Date);
  });
});

describe('HandoffCapsule.toSummary', () => {
  it('包含 from → to 与摘要字段', () => {
    const s = makeCapsule().toSummary();
    expect(s).toContain('architect → developer');
    expect(s).toContain('summary: 完成登录模块设计');
    expect(s).toContain('decisions: [token 而非 session]');
    expect(s).toContain('open_questions: [刷新令牌策略]');
    expect(s).toContain('next_step: 实现登录 API');
  });

  it('空列表显示 (none)', () => {
    const cap = newHandoffCapsule({ fromAgent: 'a', toAgent: 'b', taskSummary: 's', nextStep: 'n' });
    expect(cap.toSummary()).toContain('decisions: [(none)]');
    expect(cap.toSummary()).toContain('open_questions: [(none)]');
  });
});

describe('HandoffCapsule.isValid', () => {
  it('完整胶囊通过校验', () => {
    expect(makeCapsule().isValid()).toBe(true);
  });

  it('from/to 缺失不通过', () => {
    const cap = newHandoffCapsule({ fromAgent: '', toAgent: 'b', taskSummary: 's', nextStep: 'n' });
    expect(cap.isValid()).toBe(false);
  });

  it('taskSummary 或 nextStep 缺失不通过', () => {
    const cap = newHandoffCapsule({ fromAgent: 'a', toAgent: 'b', taskSummary: '', nextStep: 'n' });
    expect(cap.isValid()).toBe(false);
  });

  it('自己交给自己不通过（协议层禁止）', () => {
    const cap = newHandoffCapsule({ fromAgent: 'a', toAgent: 'a', taskSummary: 's', nextStep: 'n' });
    expect(cap.isValid()).toBe(false);
  });
});
