/**
 * @flowforge/forgekin-forging — 锻造阶段定义（6 阶段流水线枚举 + 结果模型）
 *
 * TS 移植自 `forgemind/forging/stages.py`。按 FM-006 定义 6 阶段：
 *
 *   1. 形态定义（species_definition）— 确定 ForgekinSpecies species
 *   2. 能力注入（capability_injection）— 加载 CapabilityProfile
 *   3. 记忆初始化（memory_seeding）— 初始化 EchoStore
 *   4. 价值观对齐（value_alignment）— 注入价值锚点
 *   5. 能力验证（capability_verification）— Eval 验证（min_quality_score=0.85）
 *   6. 觉醒晋升（awakening_promotion）— 初始觉醒阶 E1
 *
 * 每个阶段都有 required / timeout_seconds / retry 配置项，
 * 配置驱动（详见 `config/forging.yaml`）。
 *
 * @module @flowforge/forgekin-forging/forging-stages
 */

/** Forge Nurturing 锻造阶段枚举 — 6 阶段流水线（顺序固定，不可调换） */
export enum ForgingStage {
  SPECIES_DEFINITION = 'species_definition',
  CAPABILITY_INJECTION = 'capability_injection',
  MEMORY_SEEDING = 'memory_seeding',
  VALUE_ALIGNMENT = 'value_alignment',
  CAPABILITY_VERIFICATION = 'capability_verification',
  AWAKENING_PROMOTION = 'awakening_promotion',
}

export namespace ForgingStage {
  /** 返回按流水线顺序排列的阶段列表 */
  export function ordered(): ForgingStage[] {
    return [
      ForgingStage.SPECIES_DEFINITION,
      ForgingStage.CAPABILITY_INJECTION,
      ForgingStage.MEMORY_SEEDING,
      ForgingStage.VALUE_ALIGNMENT,
      ForgingStage.CAPABILITY_VERIFICATION,
      ForgingStage.AWAKENING_PROMOTION,
    ];
  }

  /** 返回该阶段的中文名 */
  export function chineseName(stage: ForgingStage): string {
    return STAGE_CHINESE_NAMES[stage];
  }

  /** 返回该阶段的描述（用于日志 / UI 展示） */
  export function description(stage: ForgingStage): string {
    return STAGE_DESCRIPTIONS[stage];
  }

  /** 字符串解析（未知值抛错） */
  export function fromString(value: string): ForgingStage {
    const normalized = value.trim().toLowerCase();
    for (const stage of Object.values(ForgingStage)) {
      if (stage === normalized) {
        return stage;
      }
    }
    throw new Error(`未知的锻造阶段: ${JSON.stringify(value)}——必须是 FM-006 六阶段之一。`);
  }
}

const STAGE_CHINESE_NAMES: Record<ForgingStage, string> = {
  [ForgingStage.SPECIES_DEFINITION]: '形态定义',
  [ForgingStage.CAPABILITY_INJECTION]: '能力注入',
  [ForgingStage.MEMORY_SEEDING]: '记忆初始化',
  [ForgingStage.VALUE_ALIGNMENT]: '价值观对齐',
  [ForgingStage.CAPABILITY_VERIFICATION]: '能力验证',
  [ForgingStage.AWAKENING_PROMOTION]: '觉醒晋升',
};

const STAGE_DESCRIPTIONS: Record<ForgingStage, string> = {
  [ForgingStage.SPECIES_DEFINITION]: '确定ForgekinSpecies species（bio/org/obj/virtual/hybrid）',
  [ForgingStage.CAPABILITY_INJECTION]: '加载能力画像 CapabilityProfile',
  [ForgingStage.MEMORY_SEEDING]: '初始化EchoStore EchoStore 种子记忆',
  [ForgingStage.VALUE_ALIGNMENT]: '注入价值锚点（VISION §7 + 15 条红线）',
  [ForgingStage.CAPABILITY_VERIFICATION]: 'Eval 验证（min_quality_score=0.85）',
  [ForgingStage.AWAKENING_PROMOTION]: '确认初始觉醒阶 E1（全导阶）',
};

/** 单个锻造阶段的执行结果（用于流水线状态追踪和审计） */
export interface ForgingStageResult {
  /** 阶段枚举值 */
  readonly stage: ForgingStage;
  /** 是否通过（false 表示阶段失败，流水线应中止） */
  readonly passed: boolean;
  /** 质量评分（0-1，仅 capability_verification 阶段强制 ≥ 0.85） */
  readonly quality_score: number | null;
  /** 阶段输出数据（结构由各阶段约定） */
  readonly output: Record<string, unknown>;
  /** 失败时的错误信息（passed=true 时为 null） */
  readonly error: string | null;
  /** 阶段执行耗时（秒） */
  readonly duration_seconds: number;
}

/** 创建阶段结果 */
export function makeForgingStageResult(
  init: Partial<ForgingStageResult> & { stage: ForgingStage; passed: boolean },
): ForgingStageResult {
  const qualityScore = init.quality_score ?? null;
  if (qualityScore !== null && (qualityScore < 0 || qualityScore > 1)) {
    throw new Error(`quality_score 必须在 0-1 区间，得到: ${qualityScore}`);
  }
  const duration = init.duration_seconds ?? 0;
  if (duration < 0) {
    throw new Error(`duration_seconds 不能为负，得到: ${duration}`);
  }
  return {
    stage: init.stage,
    passed: init.passed,
    quality_score: qualityScore,
    output: { ...(init.output ?? {}) },
    error: init.error ?? null,
    duration_seconds: duration,
  };
}
