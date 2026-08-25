/**
 * harnessability — Harness 第 7 层：适配现实（Harnessability 评估）。
 *
 * 对应 harness.yaml `harnessability` 配置（roleagent.md §3.2 第七层）：
 * 评估 harness 七层工程对现实环境的适配度，低于阈值触发告警。
 *
 * 五维加权评分（overall = sum(dimension * weight)）：
 *   - durable_state_coverage   0.20（感知现实覆盖面）
 *   - tool_mediation_quality   0.20（改变现实护栏质量）
 *   - governance_completeness  0.20（约束现实规则完备度）
 *   - observability            0.15（可观测性；另保留 0.10 给 evidence 层）
 *   - recovery_capability      0.15（恢复能力）
 *   - evidence                 0.10（验证现实证据完备度）
 *
 * 注：Python 端 HarnessabilityScorer 在 v7.0 重构时被移除，
 * 本实现依据 harness.yaml 配置重建（T7.10 第七层）。
 *
 * @module @flowforge/forgekin-harness
 */

/** Harnessability 评估维度（对齐 harness.yaml weights）。 */
export enum HarnessabilityDimension {
  DURABLE_STATE_COVERAGE = 'durable_state_coverage',
  TOOL_MEDIATION_QUALITY = 'tool_mediation_quality',
  GOVERNANCE_COMPLETENESS = 'governance_completeness',
  OBSERVABILITY = 'observability',
  RECOVERY_CAPABILITY = 'recovery_capability',
  EVIDENCE = 'evidence',
}

/** 默认五维权重（对齐 harness.yaml harnessability.weights）。 */
export const DEFAULT_HARNESSABILITY_WEIGHTS: Readonly<
  Record<HarnessabilityDimension, number>
> = {
  [HarnessabilityDimension.DURABLE_STATE_COVERAGE]: 0.2,
  [HarnessabilityDimension.TOOL_MEDIATION_QUALITY]: 0.2,
  [HarnessabilityDimension.GOVERNANCE_COMPLETENESS]: 0.2,
  [HarnessabilityDimension.OBSERVABILITY]: 0.15,
  [HarnessabilityDimension.RECOVERY_CAPABILITY]: 0.15,
  [HarnessabilityDimension.EVIDENCE]: 0.1,
};

/** 单维度得分（0-1）。 */
export interface DimensionScore {
  readonly dimension: HarnessabilityDimension;
  /** 得分（0-1）。 */
  readonly score: number;
  /** 证据说明（该维度为什么得这个分）。 */
  readonly rationale: string;
}

/** 一次 harnessability 评估结果。 */
export interface HarnessabilityReport {
  /** 各维度得分。 */
  readonly dimensions: readonly DimensionScore[];
  /** 加权总分（0-1）。 */
  readonly overall: number;
  /** 是否低于阈值（需要告警）。 */
  readonly below_threshold: boolean;
  /** 评估阈值。 */
  readonly threshold: number;
  /** 评估时间 ISO 8601。 */
  readonly assessed_at: string;
}

/** Harnessability 评估器 —— 适配现实（第七层）。 */
export class HarnessabilityScorer {
  /** 评估阈值（低于此值告警，默认 0.85）。 */
  readonly assessmentThreshold: number;
  /** 各维度权重（默认对齐 harness.yaml）。 */
  readonly weights: Readonly<Record<HarnessabilityDimension, number>>;
  /** 评估周期（小时，默认 24）。 */
  readonly assessmentIntervalHours: number;
  /** 是否自动触发 review（默认 true）。 */
  readonly autoTriggerReview: boolean;

  constructor(options: {
    assessmentThreshold?: number | undefined;
    weights?: Partial<Record<HarnessabilityDimension, number>> | undefined;
    assessmentIntervalHours?: number | undefined;
    autoTriggerReview?: boolean | undefined;
  } = {}) {
    this.assessmentThreshold = options.assessmentThreshold ?? 0.85;
    this.weights = {
      ...DEFAULT_HARNESSABILITY_WEIGHTS,
      ...(options.weights ?? {}),
    };
    this.assessmentIntervalHours = options.assessmentIntervalHours ?? 24;
    this.autoTriggerReview = options.autoTriggerReview ?? true;
  }

  /** 校验权重和（应为 1.0，允许 ±0.01 容差）。 */
  private validateWeights(): void {
    const total = Object.values(this.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1.0) > 0.01) {
      throw new Error(
        `harnessability weights must sum to 1.0, got ${total.toFixed(3)}`,
      );
    }
  }

  /**
   * 执行评估：各维度打分 → 加权求和 → 阈值判定。
   *
   * @param dimensionScores 各维度得分（0-1）+ 说明。
   */
  assess(
    dimensionScores: readonly DimensionScore[],
    now: string = new Date().toISOString(),
  ): HarnessabilityReport {
    this.validateWeights();

    const scored = new Map<HarnessabilityDimension, DimensionScore>();
    for (const d of dimensionScores) {
      scored.set(d.dimension, d);
    }

    const dimensions: DimensionScore[] = [];
    let overall = 0;
    for (const dimension of Object.values(HarnessabilityDimension)) {
      const entry = scored.get(dimension);
      const score = entry?.score ?? 0;
      dimensions.push(
        entry ?? {
          dimension,
          score: 0,
          rationale: 'missing dimension score; treated as 0',
        },
      );
      overall += score * (this.weights[dimension] ?? 0);
    }

    return {
      dimensions,
      overall: Math.round(overall * 1000) / 1000,
      below_threshold: overall < this.assessmentThreshold,
      threshold: this.assessmentThreshold,
      assessed_at: now,
    };
  }

  /** 检查是否到评估周期（供定时任务调用）。 */
  isDue(lastAssessedAt: number | undefined, now = Date.now()): boolean {
    if (lastAssessedAt === undefined) {
      return true;
    }
    return now - lastAssessedAt >= this.assessmentIntervalHours * 3_600_000;
  }
}
