/**
 * scope-guard — T7.20 Mode A Scope Guard 偏离检测验证。
 *
 * 覆盖：四信号启发式检测 / 触发规则（2 普通或 1 强）/
 * 每 phase 最多 2 次提醒 / 发散模式 ≥3 建议拆 feat / resetPhase。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { describe, expect, it } from 'vitest';
import { ScopeGuard } from '../src/scope-guard.js';

describe('ScopeGuard.detectSignals', () => {
  it('愿景 token 重叠度过低 → NOT_SERVING_VISION（普通）', () => {
    const guard = new ScopeGuard();
    const signals = guard.detectSignals('开发用户登录功能', '引入全新的推荐算法', []);
    expect(signals).toContain('not_serving_vision');
  });

  it('重叠度高不触发普通信号', () => {
    const guard = new ScopeGuard();
    // 空格分词使 token 重叠有意义（中文无分隔时整句单 token）
    const signals = guard.detectSignals('user login feature', 'add captcha for user login', ['AC: 登录可用']);
    expect(signals).not.toContain('not_serving_vision');
  });

  it('新旅程/新子系统关键词 → NEW_JOURNEY（强）', () => {
    const guard = new ScopeGuard();
    const signals = guard.detectSignals('v1 login', '引入新子系统', []);
    expect(signals).toContain('new_journey');
  });

  it('新依赖/新 API 关键词 → NEW_DEPENDENCY（强）', () => {
    const guard = new ScopeGuard();
    const signals = guard.detectSignals('v1 登录', '需要接入第三方支付新 API', []);
    expect(signals).toContain('new_dependency');
  });

  it('验收标准为空或含模糊措辞 → UNCLEAR_VERIFICATION（强）', () => {
    const guard = new ScopeGuard();
    const emptyAc = guard.detectSignals('v1', '优化交互', []);
    expect(emptyAc).toContain('unclear_verification');

    const vague = guard.detectSignals('v1', '这个功能先这样吧', ['AC: 可用']);
    expect(vague).toContain('unclear_verification');
  });

  it('英文关键词同样命中（new page / new api / maybe）', () => {
    const guard = new ScopeGuard();
    const signals = guard.detectSignals('login flow', 'add a new page with new api maybe', []);
    expect(signals).toContain('new_journey');
    expect(signals).toContain('new_dependency');
    expect(signals).toContain('unclear_verification');
  });
});

describe('ScopeGuard 提醒行为', () => {
  it('同一 phase 最多 2 次提醒，第 3 次 shouldRemind=false', () => {
    const guard = new ScopeGuard();
    expect(guard.shouldRemind('feat-a')).toBe(true);
    guard.logTrigger({ featureId: 'feat-a', signalType: 'x', action: 'remind', outcome: '1', agent: 'a' });
    guard.logTrigger({ featureId: 'feat-a', signalType: 'x', action: 'remind', outcome: '2', agent: 'a' });
    expect(guard.shouldRemind('feat-a')).toBe(false);
    // 不同 feature 不受影响
    expect(guard.shouldRemind('feat-b')).toBe(true);
  });

  it('第一次温柔提醒，第二次明确建议碰头', () => {
    const guard = new ScopeGuard();
    const first = guard.generateReminder('当前愿景', '新方向', 1);
    const second = guard.generateReminder('当前愿景', '新方向', 2);
    expect(first).toContain('【温柔提醒】');
    expect(second).toContain('【明确提醒】');
    expect(second).toContain('建议碰头');
  });

  it('logTrigger 递增 phase 计数并记录日志', () => {
    const guard = new ScopeGuard();
    guard.logTrigger({ featureId: 'feat-a', signalType: 'new_journey', action: 'remind', outcome: 'ok', agent: 'scope_guard' });
    expect(guard.getLog()).toHaveLength(1);
    expect(guard.getPhaseTriggerCount('feat-a')).toBe(1);
  });

  it('≥3 次同一 feat 触发 → checkDivergencePattern=true（建议拆 feat）', () => {
    const guard = new ScopeGuard();
    expect(guard.checkDivergencePattern('feat-a')).toBe(false);
    for (let i = 0; i < 3; i += 1) {
      guard.logTrigger({ featureId: 'feat-a', signalType: 'x', action: 'remind', outcome: `${i}`, agent: 'a' });
    }
    expect(guard.checkDivergencePattern('feat-a')).toBe(true);
  });

  it('resetPhase 清空计数但保留日志', () => {
    const guard = new ScopeGuard();
    guard.logTrigger({ featureId: 'feat-a', signalType: 'x', action: 'remind', outcome: '1', agent: 'a' });
    guard.resetPhase('feat-a');
    expect(guard.shouldRemind('feat-a')).toBe(true);
    expect(guard.getLog()).toHaveLength(1);
  });
});
