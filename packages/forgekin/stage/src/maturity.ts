/**
 * KnowledgeMaturityLadder — 五级知识成熟度阶梯（对齐 Python `evolution/maturity.py`）。
 *
 * | Level | 形态 | 晋升条件 | 降级/冻结 |
 * |-------|------|----------|-----------|
 * | L0 Episode | 原始记录 | 模板完整，已分离可迁移/不可迁移 | 不降级 |
 * | L1 Pattern | 草稿 | ≥2 个相似 episode（180天内），或人类要求；5Q ≥ 7/10 | 一次性特例 → rejected |
 * | L2 Draft | Method Card / Skill Draft | smoke gate ≥3 cases（≥2/3 通过）；promotion gate ≥5 cases（≥3/5 通过，覆盖 3 类） | 最近 3 次 <50% → 退 L1 |
 * | L3 Validated | 正式 method/skill | ≥6 uses，≥2 agents，≥80%，无 critical breach | 最近 5 次 <60% → 退 L2 |
 * | L4 Standard | 团队标准 | ≥12 uses，最近 10 次 ≥90%，用户批准 | 1 次高风险越界 → freeze |
 *
 * 双车道：long_tail=true 允许长期停 L2/L3（高风险/低频域）。
 * 所有检查均为纯函数式判定，不直接修改知识对象，返回新 level 或 null。
 */

/** 知识成熟度等级（对齐 Python KnowledgeMaturityLevel / forgekin-knowledge 'L0'-'L4'） */
export type MaturityLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export const MATURITY_ORDER: MaturityLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4'];

// ── 晋升条件阈值 ──────────────────────────────────────────────────
const L1_PROMOTION_MIN_EPISODES = 2;
const L1_EPISODE_WINDOW_DAYS = 180;
const L1_FIVE_Q_THRESHOLD = 7;

const L2_SMOKE_CASES = 3;
const L2_SMOKE_PASS_THRESHOLD = 2;
const L2_PROMOTION_CASES = 5;
const L2_PROMOTION_PASS_THRESHOLD = 3;
const L2_PROMOTION_CATEGORY_COVERAGE = 3;

const L3_MIN_USES = 6;
const L3_MIN_AGENTS = 2;
const L3_MIN_SUCCESS_RATE = 0.8;

const L4_MIN_USES = 12;
const L4_RECENT_WINDOW = 10;
const L4_RECENT_SUCCESS_RATE = 0.9;

// ── 降级条件阈值 ──────────────────────────────────────────────────
const L2_DEMOTION_WINDOW = 3;
const L2_DEMOTION_SUCCESS_RATE = 0.5;
const L3_DEMOTION_WINDOW = 5;
const L3_DEMOTION_SUCCESS_RATE = 0.6;

/**
 * 晋升使用数据（按 level 需要）：
 * - L0→L1: episodesCount, episodeWindowDays, fiveQScore, isOneOff, humanRequested
 * - L1→L2: smokeCases, smokePassed, promotionCases, promotionPassed, promotionCategories
 * - L2→L3: usesCount, agentsCount, successRate, hasCriticalBreach
 * - L3→L4: usesCount, recentSuccessCount, recentTotal, userApproved, longTail
 */
export interface PromotionUsageData {
  readonly episodesCount?: number | undefined;
  readonly episodeWindowDays?: number | undefined;
  readonly fiveQScore?: number | undefined;
  readonly isOneOff?: boolean | undefined;
  readonly humanRequested?: boolean | undefined;
  readonly smokeCases?: number | undefined;
  readonly smokePassed?: number | undefined;
  readonly promotionCases?: number | undefined;
  readonly promotionPassed?: number | undefined;
  readonly promotionCategories?: number | undefined;
  readonly usesCount?: number | undefined;
  readonly agentsCount?: number | undefined;
  readonly successRate?: number | undefined;
  readonly hasCriticalBreach?: boolean | undefined;
  readonly recentSuccessCount?: number | undefined;
  readonly recentTotal?: number | undefined;
  readonly userApproved?: boolean | undefined;
  readonly longTail?: boolean | undefined;
}

export class KnowledgeMaturityLadder {
  /**
   * 检查是否可以晋升。返回新 level 或 null（不可晋升）。
   */
  checkPromotion(_knowledgeId: string, currentLevel: MaturityLevel, usageData: PromotionUsageData): MaturityLevel | null {
    const nextLevel = this.nextLevel(currentLevel);
    if (nextLevel === null) {
      return null;
    }
    const promoted = this.checkPromotionRules(currentLevel, usageData);
    if (promoted) {
      return nextLevel;
    }
    return null;
  }

  /**
   * 检查是否应该降级。返回新 level 或 null（不应降级）。
   * recentPerformance: 最近 N 次使用是否成功（true/false），按时间顺序。
   * - L2: 最近 3 次 <50% → 退 L1
   * - L3: 最近 5 次 <60% → 退 L2
   * - L4: 1 次高风险越界 → freeze（由 checkFreeze 单独处理，此处不降级）
   * - L0/L1: 不降级
   */
  checkDemotion(_knowledgeId: string, currentLevel: MaturityLevel, recentPerformance: boolean[]): MaturityLevel | null {
    const prevLevel = this.prevLevel(currentLevel);
    if (prevLevel === null) {
      return null;
    }
    const demoted = this.checkDemotionRules(currentLevel, recentPerformance);
    return demoted ? prevLevel : null;
  }

  /**
   * 检查 L4 是否应冻结（1 次高风险越界 → freeze）。仅 L4 适用。
   */
  checkFreeze(_knowledgeId: string, currentLevel: MaturityLevel, highRiskBreach: boolean): boolean {
    if (currentLevel !== 'L4') {
      return false;
    }
    return highRiskBreach;
  }

  // ── 晋升规则 ────────────────────────────────────────────────────

  checkPromotionRules(current: MaturityLevel, data: PromotionUsageData): boolean {
    switch (current) {
      case 'L0':
        return this.checkL0ToL1(data);
      case 'L1':
        return this.checkL1ToL2(data);
      case 'L2':
        return this.checkL2ToL3(data);
      case 'L3':
        return this.checkL3ToL4(data);
      default:
        return false;
    }
  }

  /** L0→L1: ≥2 个相似 episode（180天内），或人类要求；5Q ≥ 7/10。一次性特例 → rejected。 */
  checkL0ToL1(data: PromotionUsageData): boolean {
    if (data.isOneOff === true) {
      return false;
    }
    if (data.humanRequested === true) {
      return true;
    }
    const episodes = data.episodesCount ?? 0;
    const window = data.episodeWindowDays ?? 0;
    const fiveQ = data.fiveQScore ?? 0;
    return episodes >= L1_PROMOTION_MIN_EPISODES && window <= L1_EPISODE_WINDOW_DAYS && fiveQ >= L1_FIVE_Q_THRESHOLD;
  }

  /** L1→L2: smoke gate ≥3 cases（≥2/3 通过）；promotion gate ≥5 cases（≥3/5 通过，覆盖 3 类）。 */
  checkL1ToL2(data: PromotionUsageData): boolean {
    const smokeCases = data.smokeCases ?? 0;
    const smokePassed = data.smokePassed ?? 0;
    const promoCases = data.promotionCases ?? 0;
    const promoPassed = data.promotionPassed ?? 0;
    const promoCategories = data.promotionCategories ?? 0;
    return smokeCases >= L2_SMOKE_CASES
      && smokePassed >= L2_SMOKE_PASS_THRESHOLD
      && promoCases >= L2_PROMOTION_CASES
      && promoPassed >= L2_PROMOTION_PASS_THRESHOLD
      && promoCategories >= L2_PROMOTION_CATEGORY_COVERAGE;
  }

  /** L2→L3: ≥6 uses，≥2 agents，≥80%，无 critical breach。 */
  checkL2ToL3(data: PromotionUsageData): boolean {
    const uses = data.usesCount ?? 0;
    const agents = data.agentsCount ?? 0;
    const successRate = data.successRate ?? 0;
    return uses >= L3_MIN_USES && agents >= L3_MIN_AGENTS && successRate >= L3_MIN_SUCCESS_RATE && data.hasCriticalBreach !== true;
  }

  /** L3→L4: ≥12 uses，最近 10 次 ≥90%，用户批准。long_tail 允许停 L3。 */
  checkL3ToL4(data: PromotionUsageData): boolean {
    if (data.longTail === true) {
      return false;
    }
    const uses = data.usesCount ?? 0;
    const recentSuccess = data.recentSuccessCount ?? 0;
    const recentTotal = data.recentTotal ?? 0;
    const recentRate = recentTotal > 0 ? recentSuccess / recentTotal : 0;
    return uses >= L4_MIN_USES
      && recentTotal >= L4_RECENT_WINDOW
      && recentRate >= L4_RECENT_SUCCESS_RATE
      && data.userApproved === true;
  }

  // ── 降级规则 ────────────────────────────────────────────────────

  checkDemotionRules(current: MaturityLevel, recentPerformance: boolean[]): boolean {
    switch (current) {
      case 'L2':
        return this.checkL2Demotion(recentPerformance);
      case 'L3':
        return this.checkL3Demotion(recentPerformance);
      default:
        // L4 不走降级（走 freeze），L0/L1 不降级
        return false;
    }
  }

  /** L2: 最近 3 次 <50% → 退 L1。 */
  checkL2Demotion(recent: boolean[]): boolean {
    const window = recent.slice(-L2_DEMOTION_WINDOW);
    if (window.length < L2_DEMOTION_WINDOW) {
      return false;
    }
    const successRate = window.filter(Boolean).length / window.length;
    return successRate < L2_DEMOTION_SUCCESS_RATE;
  }

  /** L3: 最近 5 次 <60% → 退 L2。 */
  checkL3Demotion(recent: boolean[]): boolean {
    const window = recent.slice(-L3_DEMOTION_WINDOW);
    if (window.length < L3_DEMOTION_WINDOW) {
      return false;
    }
    const successRate = window.filter(Boolean).length / window.length;
    return successRate < L3_DEMOTION_SUCCESS_RATE;
  }

  // ── 阶梯导航 ────────────────────────────────────────────────────

  nextLevel(level: MaturityLevel): MaturityLevel | null {
    const idx = MATURITY_ORDER.indexOf(level);
    if (idx < 0 || idx + 1 >= MATURITY_ORDER.length) {
      return null;
    }
    return MATURITY_ORDER[idx + 1] ?? null;
  }

  prevLevel(level: MaturityLevel): MaturityLevel | null {
    const idx = MATURITY_ORDER.indexOf(level);
    if (idx <= 0) {
      return null;
    }
    return MATURITY_ORDER[idx - 1] ?? null;
  }
}
