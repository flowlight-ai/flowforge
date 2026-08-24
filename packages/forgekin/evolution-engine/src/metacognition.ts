/**
 * 元认知路由 (Metacognition Router) — 三信号路由 + Mode C 反思。
 * TS 重写自 Python `evolution/metacognition.py`。
 *
 * 三信号：
 * 1. domain_reliability: 滚动域内可靠度 (successes+1)/(trials+2) + Wilson 下界
 * 2. evidence_completeness: 证据覆盖度评估
 * 3. self_reported_confidence: 自报置信度（参考但不依赖）
 *
 * CL-006 三模式（Mode A/B/C）：
 * - Mode A "proceed": action_confidence ≥ 0.85 → 直接执行
 * - Mode B "structured_analysis_only" / "escalate": action_confidence < 0.85 → 拒绝/升级
 * - Mode C "reflective_review": 执行后回顾决策质量，更新元认知信号
 */

/** 高风险域动作置信度阈值。 */
export const HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD = 0.85;

/** 信号权重（domain_reliability 主导，self_reported 仅参考）。 */
export const WEIGHT_DOMAIN_RELIABILITY = 0.5;
export const WEIGHT_EVIDENCE_COMPLETENESS = 0.35;
export const WEIGHT_SELF_REPORTED = 0.15;

/** 路由结果。 */
export type ConfidenceRoute = 'proceed' | 'structured_analysis_only' | 'escalate';

export interface RouteConfidenceInput {
  domainReliability: number;
  evidenceCompleteness: number;
  selfReported: number;
  isHighRisk?: boolean;
}

export interface RouteConfidenceResult {
  readonly actionConfidence: number;
  readonly route: ConfidenceRoute;
  readonly reason: string;
  readonly signals: {
    readonly domainReliability: number;
    readonly evidenceCompleteness: number;
    readonly selfReportedConfidence: number;
    readonly isHighRisk: boolean;
  };
}

function clamp01(value: number): number {
  return Math.max(0.0, Math.min(1.0, value));
}

/** 元认知路由 — 基于三信号的动作决策。高风险域采用更保守的 Wilson 下界。 */
export class MetacognitionRouter {
  /**
   * 计算滚动域内可靠度 (successes+1)/(trials+2)。
   * Laplace 平滑：避免 0/trials 或 successes/successes 的极端值。
   */
  computeDomainReliability(successes: number, trials: number): number {
    if (trials < 0) {
      throw new Error(`trials must be >= 0, got ${trials}`);
    }
    if (successes < 0 || successes > trials) {
      throw new Error(`successes ${successes} out of range [0, ${trials}]`);
    }
    return (successes + 1) / (trials + 2);
  }

  /**
   * 计算 Wilson 下界（95% 置信区间下界，z=1.96）。
   *
   * Wilson score interval lower bound:
   * p_hat = s/n; center = (p_hat + z²/(2n)) / (1 + z²/n);
   * margin = (z / (1 + z²/n)) * sqrt(p_hat*(1-p_hat)/n + z²/(4n²));
   * lower = center - margin（数值钳制到 [0, 1]）。
   */
  computeWilsonLowerBound(successes: number, trials: number, z = 1.96): number {
    if (trials <= 0) {
      return 0.0;
    }
    if (successes < 0 || successes > trials) {
      throw new Error(`successes ${successes} out of range [0, ${trials}]`);
    }
    if (z <= 0) {
      throw new Error(`z must be > 0, got ${z}`);
    }

    const n = trials;
    const pHat = successes / n;
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const center = (pHat + z2 / (2 * n)) / denominator;
    const margin =
      (z / denominator) * Math.sqrt(pHat * (1 - pHat) / n + z2 / (4 * n * n));
    const lower = center - margin;
    return clamp01(lower);
  }

  /**
   * 路由决策。
   *
   * 高风险域：domain_reliability 由调用方通过 Wilson 下界传入，
   * self_reported 权重降为 0（更保守）；action_confidence < 0.85 → escalate。
   * 普通域：action_confidence < 0.85 → structured_analysis_only。
   */
  routeConfidence(input: RouteConfidenceInput): RouteConfidenceResult {
    const isHighRisk = input.isHighRisk ?? false;
    const dr = clamp01(input.domainReliability);
    const ec = clamp01(input.evidenceCompleteness);
    const sr = clamp01(input.selfReported);

    let weightDr: number;
    let weightEc: number;
    let weightSr: number;
    if (isHighRisk) {
      weightDr = WEIGHT_DOMAIN_RELIABILITY + WEIGHT_SELF_REPORTED / 2;
      weightEc = WEIGHT_EVIDENCE_COMPLETENESS + WEIGHT_SELF_REPORTED / 2;
      weightSr = 0.0;
    } else {
      weightDr = WEIGHT_DOMAIN_RELIABILITY;
      weightEc = WEIGHT_EVIDENCE_COMPLETENESS;
      weightSr = WEIGHT_SELF_REPORTED;
    }

    const actionConfidence = dr * weightDr + ec * weightEc + sr * weightSr;

    let route: ConfidenceRoute;
    let reason: string;
    if (isHighRisk && actionConfidence < HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD) {
      route = 'escalate';
      reason =
        `high-risk domain action_confidence=${actionConfidence.toFixed(4)} `
        + `< threshold ${HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD} → 只做结构化分析 + 明确升级`;
    } else if (actionConfidence < HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD) {
      route = 'structured_analysis_only';
      reason =
        `action_confidence=${actionConfidence.toFixed(4)} `
        + `< threshold ${HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD} → 仅结构化分析`;
    } else {
      route = 'proceed';
      reason = `action_confidence=${actionConfidence.toFixed(4)} >= threshold → 可执行`;
    }

    return {
      actionConfidence: Math.round(actionConfidence * 10000) / 10000,
      route,
      reason,
      signals: {
        domainReliability: Math.round(dr * 10000) / 10000,
        evidenceCompleteness: Math.round(ec * 10000) / 10000,
        selfReportedConfidence: Math.round(sr * 10000) / 10000,
        isHighRisk,
      },
    };
  }
}

// ════════════════════════════════════════════════════════════════════
// §2 CL-006 Mode C 反思模式（reflective_review）
// ════════════════════════════════════════════════════════════════════

/** Mode C 反思结果类型。 */
export const REFLECTION_OUTCOMES = [
  'confirmed',
  'corrected',
  'rejected',
  'escalated',
] as const;

export type ReflectionOutcome = (typeof REFLECTION_OUTCOMES)[number];

/** CL-006 Mode C 元认知反思记录。 */
export interface MetacognitionReflection {
  readonly reflectionId: string;
  /** 关联的决策 ID（route_confidence 调用记录） */
  readonly decisionId: string;
  readonly domain: string;
  readonly outcome: ReflectionOutcome;
  /** 预测的 action_confidence（事前） */
  readonly predictedConfidence: number;
  readonly actualSuccess: boolean;
  /** 实际质量分 0.0~1.0（如有） */
  readonly actualQualityScore: number;
  readonly reflectionNotes: string;
  /** 信号更新建议（如 { domain_reliability_delta: -0.05 }） */
  readonly signalUpdates: Record<string, number>;
  readonly createdAt: string;
}

export interface ReflectOnDecisionInput {
  decisionId: string;
  domain: string;
  outcome: ReflectionOutcome;
  predictedConfidence?: number;
  actualSuccess?: boolean;
  actualQualityScore?: number;
  reflectionNotes?: string;
}

/**
 * CL-006 Mode C 反思执行器 — 事后回顾决策质量。
 *
 * 反思规则（反思结果 → domain_reliability 更新建议）：
 * - confirmed: 预测准确 → +0.02
 * - corrected: 预测偏差但纠正 → 0.0
 * - rejected: 预测错误 → -0.10
 * - escalated: 升级 → -0.05
 */
export class MetacognitionReflector {
  static readonly OUTCOME_TO_DELTA: Record<ReflectionOutcome, number> = {
    confirmed: 0.02,
    corrected: 0.0,
    rejected: -0.10,
    escalated: -0.05,
  };

  private readonly reflections: MetacognitionReflection[] = [];

  /** 记录一次决策反思（含 signal_updates 建议）。 */
  reflectOnDecision(input: ReflectOnDecisionInput): MetacognitionReflection {
    const reflectionId = `reflect-${input.decisionId}-${String(this.reflections.length).padStart(4, '0')}`;
    const delta = MetacognitionReflector.OUTCOME_TO_DELTA[input.outcome] ?? 0.0;

    const reflection: MetacognitionReflection = {
      reflectionId,
      decisionId: input.decisionId,
      domain: input.domain,
      outcome: input.outcome,
      predictedConfidence: input.predictedConfidence ?? 0.0,
      actualSuccess: input.actualSuccess ?? false,
      actualQualityScore: input.actualQualityScore ?? 0.0,
      reflectionNotes: input.reflectionNotes ?? '',
      signalUpdates: { domain_reliability_delta: delta },
      createdAt: new Date().toISOString(),
    };

    this.reflections.push(reflection);
    return reflection;
  }

  /** 按领域查询反思记录。 */
  getReflectionsByDomain(domain: string): MetacognitionReflection[] {
    return this.reflections.filter((r) => r.domain === domain);
  }

  /**
   * 计算指定领域的累积 domain_reliability 调整量。
   * 用于在下次 route_confidence 调用时调整 domain_reliability 输入。
   */
  computeReliabilityAdjustment(domain: string): number {
    const domainReflections = this.getReflectionsByDomain(domain);
    if (domainReflections.length === 0) {
      return 0.0;
    }
    return domainReflections.reduce(
      (sum, r) => sum + (r.signalUpdates['domain_reliability_delta'] ?? 0.0),
      0.0,
    );
  }

  /**
   * 计算校准分数（calibration score）— 预测准确度。
   * 校准分数 = (confirmed + corrected) / total；无记录返回 0.0。
   */
  computeCalibrationScore(domain?: string): number {
    const reflections = domain
      ? this.getReflectionsByDomain(domain)
      : this.reflections;
    if (reflections.length === 0) {
      return 0.0;
    }
    const accurate = reflections.filter(
      (r) => r.outcome === 'confirmed' || r.outcome === 'corrected',
    ).length;
    return accurate / reflections.length;
  }

  /** 总反思记录数。 */
  get totalReflections(): number {
    return this.reflections.length;
  }

  /** 导出反思记录为可序列化列表（供 EchoStore 持久化，CL-006）。 */
  exportToEchoStore(): MetacognitionReflection[] {
    return this.reflections.map((r) => ({ ...r }));
  }
}
