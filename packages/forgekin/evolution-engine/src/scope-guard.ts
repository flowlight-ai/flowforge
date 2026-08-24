/**
 * Mode A: Scope Guard — 当讨论偏离当前 feat 愿景时温柔提醒。
 * TS 重写自 Python `evolution/scope_guard.py`。
 *
 * 触发信号（满足 2 个普通信号或 1 个强信号）：
 * - 新想法不直接服务当前愿景（普通 NOT_SERVING_VISION）
 * - 新想法引入新的用户旅程/新页面/新子系统（强 NEW_JOURNEY）
 * - 新想法需要新的外部依赖/API/数据模型（强 NEW_DEPENDENCY）
 * - 新想法导致"这次怎么验收"说不清了（强 UNCLEAR_VERIFICATION）
 *
 * 行为：
 * - 同一 phase 最多两次提醒（第一次温柔，第二次明确建议碰头）
 * - ≥3 次同一 feat 触发 → 建议拆 feat
 *
 * 启发式实现（无 LLM 调用）：关键词匹配 + 愿景 token 重叠度。
 */

import {
  makeScopeGuardLog,
  ScopeGuardLog,
  ScopeGuardSignal,
} from './models.js';

/** 强信号关键词集合（启发式匹配，无 LLM 调用）。 */
export const NEW_JOURNEY_KEYWORDS = [
  '新页面', '新旅程', '新子系统', '新模块', '新入口',
  'new page', 'new journey', 'new subsystem', 'new module', 'new screen',
  '新增页面', '新增入口', '新增流程',
] as const;

export const NEW_DEPENDENCY_KEYWORDS = [
  '新依赖', '新api', '新接口', '新数据模型', '新表', '新sdk', '新库',
  'new dependency', 'new api', 'new table', 'new sdk', 'new library',
  '接入', '集成第三方', '外部服务',
] as const;

export const AC_AMBIGUITY_KEYWORDS = [
  '再说', '看情况', '差不多', '到时候', '先这样', '可能', '或许',
  'maybe', 'later', 'todo', 'tbd', '待定',
] as const;

/** 愿景 token 重叠度过低阈值（低于此值视为 NOT_SERVING_VISION）。 */
export const VISION_OVERLAP_THRESHOLD = 0.15;

function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().split(/[\s,，。.;；、]+/);
  return new Set(tokens.filter((t) => t.length >= 2));
}

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/** Mode A: Scope Guard — 偏离检测与温柔提醒。 */
export class ScopeGuard {
  /** 同一 phase 最多提醒次数。 */
  static readonly MAX_REMINDS_PER_PHASE = 2;
  /** ≥3 次同一 feat 触发 → 建议拆 feat。 */
  static readonly DIVERGENCE_THRESHOLD = 3;

  private readonly logs: ScopeGuardLog[] = [];
  private readonly phaseTriggerCounts = new Map<string, number>();

  /**
   * 检测偏离信号（启发式实现，无 LLM 调用）：
   * - NOT_SERVING_VISION: 新想法与当前愿景关键词重叠度过低
   * - NEW_JOURNEY: 新想法包含新旅程/页面/子系统关键词
   * - NEW_DEPENDENCY: 新想法包含新依赖/API/数据模型关键词
   * - UNCLEAR_VERIFICATION: 验收标准为空，或新想法含模糊措辞
   */
  detectSignals(
    currentVision: string,
    newIdea: string,
    currentAc: string[],
  ): ScopeGuardSignal[] {
    const signals: ScopeGuardSignal[] = [];
    const ideaLower = newIdea.toLowerCase();
    const visionLower = currentVision.toLowerCase();

    // NOT_SERVING_VISION（普通）：关键词重叠度过低
    const visionTokens = tokenize(visionLower);
    const ideaTokens = tokenize(ideaLower);
    if (visionTokens.size > 0) {
      let overlapCount = 0;
      for (const token of visionTokens) {
        if (ideaTokens.has(token)) overlapCount += 1;
      }
      const overlap = overlapCount / visionTokens.size;
      if (overlap < VISION_OVERLAP_THRESHOLD) {
        signals.push('not_serving_vision');
      }
    }

    // NEW_JOURNEY（强）
    if (containsAny(ideaLower, NEW_JOURNEY_KEYWORDS)) {
      signals.push('new_journey');
    }

    // NEW_DEPENDENCY（强）
    if (containsAny(ideaLower, NEW_DEPENDENCY_KEYWORDS)) {
      signals.push('new_dependency');
    }

    // UNCLEAR_VERIFICATION（强）：AC 为空 或 新想法含模糊措辞
    if (currentAc.length === 0 || containsAny(ideaLower, AC_AMBIGUITY_KEYWORDS)) {
      signals.push('unclear_verification');
    }

    return signals;
  }

  /** 是否应该提醒（同一 phase 最多 MAX_REMINDS_PER_PHASE 次）。 */
  shouldRemind(featureId: string): boolean {
    return (this.phaseTriggerCounts.get(featureId) ?? 0) < ScopeGuard.MAX_REMINDS_PER_PHASE;
  }

  /**
   * 生成提醒文本：第一次温柔提醒，第二次明确建议碰头。
   * signalCount 此处复用为该 phase 已触发次数（1-based）。
   */
  generateReminder(vision: string, newDirection: string, signalCount: number): string {
    const visionExcerpt = vision.slice(0, 40);
    const directionExcerpt = newDirection.slice(0, 40);
    if (signalCount <= 1) {
      return (
        `【温柔提醒】这个新方向（${directionExcerpt}…）似乎不直接服务当前愿景`
        + `（${visionExcerpt}…）。如果属于当前 feat 范围，请补一句验收标准；`
        + `如果不属于，建议记到 backlog，避免当前 feat 膨胀。`
      );
    }
    return (
      `【明确提醒】这是本 feat 第二次出现偏离信号（当前愿景：${visionExcerpt}…）。`
      + `建议碰头确认：是拆 feat、调整愿景，还是明确新验收边界。`
      + `如确认不拆，请复述新的验收边界，后续不再追问。`
    );
  }

  /** 记录触发到 Scope Guard 日志，并递增 phase 计数。 */
  logTrigger(params: {
    featureId: string;
    signalType: string;
    action: string;
    outcome: string;
    agent: string;
  }): ScopeGuardLog {
    const entry = makeScopeGuardLog({
      featureId: params.featureId,
      signalType: params.signalType,
      actionTaken: params.action,
      outcome: params.outcome,
      agent: params.agent,
    });
    this.logs.push(entry);
    this.phaseTriggerCounts.set(
      params.featureId,
      (this.phaseTriggerCounts.get(params.featureId) ?? 0) + 1,
    );
    return entry;
  }

  /** 获取 Scope Guard 日志（副本）。 */
  getLog(): ScopeGuardLog[] {
    return [...this.logs];
  }

  /** 检查发散模式（≥DIVERGENCE_THRESHOLD 次同一 feat 触发 → 建议拆 feat）。 */
  checkDivergencePattern(featureId: string): boolean {
    const count = this.logs.filter((log) => log.featureId === featureId).length;
    return count >= ScopeGuard.DIVERGENCE_THRESHOLD;
  }

  /** 重置某个 feature 的 phase 计数（feat 拆分或结束后调用）。 */
  resetPhase(featureId: string): void {
    this.phaseTriggerCounts.delete(featureId);
  }

  /** 读取 phase 触发计数（engine._execute_scope_guard 使用）。 */
  getPhaseTriggerCount(featureId: string): number {
    return this.phaseTriggerCounts.get(featureId) ?? 0;
  }
}
