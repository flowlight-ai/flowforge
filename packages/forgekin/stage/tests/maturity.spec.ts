/**
 * KnowledgeMaturityLadder — T7.6 五级知识成熟度阶梯验证。
 *
 * 覆盖：
 * - 阶梯导航（next/prev，L0 无 prev、L4 无 next）
 * - 晋升全阈值：L0→L1（episode 双条件 + 一次性特例 + 人类要求）、L1→L2（smoke/promotion 双门）、
 *   L2→L3（uses/agents/rate/breach）、L3→L4（12 uses + 最近10次90% + 批准 + longTail 停 L3）
 * - 降级：L2 最近3次 <50%、L3 最近5次 <60%、窗口不足不降、L0/L1/L4 不降
 * - 冻结：仅 L4 + 高风险越界
 *
 * @module @flowforge/forgekin-stage/tests
 */

import { describe, expect, it } from 'vitest';
import { KnowledgeMaturityLadder, MaturityLevel } from '../src/maturity.js';

describe('KnowledgeMaturityLadder 阶梯导航', () => {
  const ladder = new KnowledgeMaturityLadder();

  it('nextLevel：L0→L1→L2→L3→L4，L4 → null', () => {
    expect(ladder.nextLevel('L0')).toBe('L1');
    expect(ladder.nextLevel('L1')).toBe('L2');
    expect(ladder.nextLevel('L2')).toBe('L3');
    expect(ladder.nextLevel('L3')).toBe('L4');
    expect(ladder.nextLevel('L4')).toBeNull();
  });

  it('prevLevel：L1→L0，L0 → null', () => {
    expect(ladder.prevLevel('L1')).toBe('L0');
    expect(ladder.prevLevel('L2')).toBe('L1');
    expect(ladder.prevLevel('L0')).toBeNull();
  });
});

describe('L0→L1 晋升', () => {
  const ladder = new KnowledgeMaturityLadder();

  it('≥2 个相似 episode（180 天内）+ 5Q ≥ 7 → L1', () => {
    expect(ladder.checkPromotion('k1', 'L0', {
      episodesCount: 2, episodeWindowDays: 90, fiveQScore: 8,
    })).toBe('L1');
  });

  it('一次性特例 → 拒绝（即使其他条件满足）', () => {
    expect(ladder.checkPromotion('k1', 'L0', {
      episodesCount: 3, episodeWindowDays: 30, fiveQScore: 9, isOneOff: true,
    })).toBeNull();
  });

  it('人类要求 → 直接晋升', () => {
    expect(ladder.checkPromotion('k1', 'L0', { humanRequested: true })).toBe('L1');
  });

  it('episode 不足 / 窗口超期 / 5Q 不足 → 拒绝', () => {
    expect(ladder.checkPromotion('k1', 'L0', { episodesCount: 1, episodeWindowDays: 30, fiveQScore: 9 })).toBeNull();
    expect(ladder.checkPromotion('k1', 'L0', { episodesCount: 2, episodeWindowDays: 181, fiveQScore: 9 })).toBeNull();
    expect(ladder.checkPromotion('k1', 'L0', { episodesCount: 2, episodeWindowDays: 30, fiveQScore: 6 })).toBeNull();
  });
});

describe('L1→L2 晋升（双门）', () => {
  const ladder = new KnowledgeMaturityLadder();

  it('smoke 3 案 ≥2 过 + promo 5 案 ≥3 过 + 3 类覆盖 → L2', () => {
    expect(ladder.checkPromotion('k2', 'L1', {
      smokeCases: 3, smokePassed: 2, promotionCases: 5, promotionPassed: 3, promotionCategories: 3,
    })).toBe('L2');
  });

  it('smoke 门不过 → 拒绝', () => {
    expect(ladder.checkPromotion('k2', 'L1', {
      smokeCases: 3, smokePassed: 1, promotionCases: 5, promotionPassed: 3, promotionCategories: 3,
    })).toBeNull();
  });

  it('promotion 门不过 / 类覆盖不足 → 拒绝', () => {
    expect(ladder.checkPromotion('k2', 'L1', {
      smokeCases: 3, smokePassed: 3, promotionCases: 5, promotionPassed: 2, promotionCategories: 3,
    })).toBeNull();
    expect(ladder.checkPromotion('k2', 'L1', {
      smokeCases: 3, smokePassed: 3, promotionCases: 5, promotionPassed: 4, promotionCategories: 2,
    })).toBeNull();
  });
});

describe('L2→L3 晋升', () => {
  const ladder = new KnowledgeMaturityLadder();

  it('≥6 uses + ≥2 agents + ≥80% + 无 critical breach → L3', () => {
    expect(ladder.checkPromotion('k3', 'L2', {
      usesCount: 6, agentsCount: 2, successRate: 0.85,
    })).toBe('L3');
  });

  it('uses / agents / successRate 任一不足 → 拒绝', () => {
    expect(ladder.checkPromotion('k3', 'L2', { usesCount: 5, agentsCount: 2, successRate: 0.9 })).toBeNull();
    expect(ladder.checkPromotion('k3', 'L2', { usesCount: 6, agentsCount: 1, successRate: 0.9 })).toBeNull();
    expect(ladder.checkPromotion('k3', 'L2', { usesCount: 6, agentsCount: 2, successRate: 0.79 })).toBeNull();
  });

  it('有 critical breach → 拒绝', () => {
    expect(ladder.checkPromotion('k3', 'L2', {
      usesCount: 8, agentsCount: 3, successRate: 0.95, hasCriticalBreach: true,
    })).toBeNull();
  });
});

describe('L3→L4 晋升', () => {
  const ladder = new KnowledgeMaturityLadder();

  it('≥12 uses + 最近 10 次 ≥90% + 用户批准 → L4', () => {
    expect(ladder.checkPromotion('k4', 'L3', {
      usesCount: 12, recentSuccessCount: 9, recentTotal: 10, userApproved: true,
    })).toBe('L4');
  });

  it('uses 不足 / 最近窗口不足 / 成功率不足 / 未批准 → 拒绝', () => {
    expect(ladder.checkPromotion('k4', 'L3', { usesCount: 11, recentSuccessCount: 10, recentTotal: 10, userApproved: true })).toBeNull();
    expect(ladder.checkPromotion('k4', 'L3', { usesCount: 12, recentSuccessCount: 9, recentTotal: 9, userApproved: true })).toBeNull();
    expect(ladder.checkPromotion('k4', 'L3', { usesCount: 12, recentSuccessCount: 8, recentTotal: 10, userApproved: true })).toBeNull();
    expect(ladder.checkPromotion('k4', 'L3', { usesCount: 12, recentSuccessCount: 10, recentTotal: 10, userApproved: false })).toBeNull();
  });

  it('long_tail 允许停 L3（高风险/低频域）', () => {
    expect(ladder.checkPromotion('k4', 'L3', {
      usesCount: 15, recentSuccessCount: 10, recentTotal: 10, userApproved: true, longTail: true,
    })).toBeNull();
  });
});

describe('降级规则', () => {
  const ladder = new KnowledgeMaturityLadder();

  it('L2 最近 3 次成功率 <50% → 退 L1', () => {
    expect(ladder.checkDemotion('k5', 'L2', [true, false, false])).toBe('L1');
  });

  it('L2 最近 3 次 ≥50% → 不降级', () => {
    expect(ladder.checkDemotion('k5', 'L2', [true, true, false])).toBeNull();
  });

  it('L2 窗口不足（<3 次）→ 不降级', () => {
    expect(ladder.checkDemotion('k5', 'L2', [false, false])).toBeNull();
  });

  it('L3 最近 5 次成功率 <60% → 退 L2', () => {
    expect(ladder.checkDemotion('k5', 'L3', [true, false, false, false, false])).toBe('L2');
  });

  it('L3 最近 5 次 ≥60% → 不降级', () => {
    expect(ladder.checkDemotion('k5', 'L3', [true, true, true, false, false])).toBeNull();
  });

  it('L0 / L1 / L4 不降级', () => {
    expect(ladder.checkDemotion('k5', 'L0', [false])).toBeNull();
    expect(ladder.checkDemotion('k5', 'L1', [false])).toBeNull();
    expect(ladder.checkDemotion('k5', 'L4', [false, false, false, false, false])).toBeNull();
  });
});

describe('冻结规则', () => {
  const ladder = new KnowledgeMaturityLadder();

  it('L4 + 1 次高风险越界 → freeze', () => {
    expect(ladder.checkFreeze('k6', 'L4', true)).toBe(true);
  });

  it('L4 无越界 → 不冻结；非 L4 越界 → 不冻结', () => {
    expect(ladder.checkFreeze('k6', 'L4', false)).toBe(false);
    expect(ladder.checkFreeze('k6', 'L3', true)).toBe(false);
    expect(ladder.checkFreeze('k6', 'L2', true)).toBe(false);
  });
});

describe('边界：未知 level 输入', () => {
  const ladder = new KnowledgeMaturityLadder();

  it('未知 level 导航返回 null 且不抛错', () => {
    expect(ladder.nextLevel('L9' as MaturityLevel)).toBeNull();
    expect(ladder.prevLevel('L9' as MaturityLevel)).toBeNull();
  });
});
