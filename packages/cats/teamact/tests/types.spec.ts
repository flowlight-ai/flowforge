/**
 * @flowforge/cats-teamact — T7.17 类型定义契约验证。
 *
 * 对齐 `core/teamact/types.py`：
 *   - TeamActStep.ordered() 六步有序 + next() 循环回 STATE
 *   - TerminationCondition.all() 五项齐全
 *   - BallStatus 四态取值
 *
 * @module @flowforge/cats-teamact/tests
 */

import { describe, expect, it } from 'vitest';
import { BallStatus, TeamActStep, TerminationCondition } from '../src/types.js';

describe('TeamActStep 六步循环', () => {
  it('ordered 返回 STATE→OWNER→ACTION→EVIDENCE→VERDICT→ROUTE', () => {
    expect([...TeamActStep.ordered()]).toEqual([
      TeamActStep.STATE,
      TeamActStep.OWNER,
      TeamActStep.ACTION,
      TeamActStep.EVIDENCE,
      TeamActStep.VERDICT,
      TeamActStep.ROUTE,
    ]);
  });

  it('next 顺序推进，ROUTE 之后循环回 STATE', () => {
    expect(TeamActStep.next(TeamActStep.STATE)).toBe(TeamActStep.OWNER);
    expect(TeamActStep.next(TeamActStep.OWNER)).toBe(TeamActStep.ACTION);
    expect(TeamActStep.next(TeamActStep.EVIDENCE)).toBe(TeamActStep.VERDICT);
    expect(TeamActStep.next(TeamActStep.ROUTE)).toBe(TeamActStep.STATE);
  });

  it('枚举值对齐 Python 字符串语义', () => {
    expect(TeamActStep.VERDICT.valueOf()).toBe('verdict');
    expect(TeamActStep.ACTION.valueOf()).toBe('action');
  });
});

describe('TerminationCondition 五项终止条件', () => {
  it('all 返回五项齐全（缺一不可）', () => {
    expect([...TerminationCondition.all()]).toEqual([
      TerminationCondition.ACCEPTANCE_DONE,
      TerminationCondition.EVIDENCE_ATTACHED,
      TerminationCondition.CROSS_VALIDATED,
      TerminationCondition.NO_DANGLING_OWNERSHIP,
      TerminationCondition.VISION_CONVERGED,
    ]);
  });

  it('枚举值对齐 Python 字段名', () => {
    expect(TerminationCondition.NO_DANGLING_OWNERSHIP.valueOf()).toBe('no_dangling_ownership');
    expect(TerminationCondition.VISION_CONVERGED.valueOf()).toBe('vision_converged');
  });
});

describe('BallStatus 持球状态', () => {
  it('四态齐全', () => {
    expect(BallStatus.HELD.valueOf()).toBe('held');
    expect(BallStatus.PASSED.valueOf()).toBe('passed');
    expect(BallStatus.RELEASED.valueOf()).toBe('released');
    expect(BallStatus.ESCALATED.valueOf()).toBe('escalated');
  });
});
