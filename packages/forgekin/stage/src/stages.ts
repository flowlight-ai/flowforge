/**
 * 进化阶 / 觉醒阶 — Forgekin 两条独立进阶轴（对齐 Python `forgemind/stages.py`）。
 *
 * 进化阶（Evolution Stage）：能力成熟度 6 级（E1-E6），借鉴 CMMI 5 级 + OpenAI Autonomy Levels。
 * 觉醒阶（Awakening Stage）：自主性 6 级（E1-E6），借鉴 SAE 自动驾驶 5 级 + Constitutional AI。
 *
 * 协同规则：
 * - E3→E4 是关键转折点，需 operator 显式批准 + 另一条轴同步 ≥ E3/E4
 * - Magic Words 逃生舱始终可触发（任何阶都不能绕过）
 */

/** 进化阶（能力成熟度，对齐 stages.py EvolutionStage） */
export enum EvolutionStage {
  E1 = 'E1', // 萌芽阶 Sprout — Initial / Ad-hoc
  E2 = 'E2', // 萌芽阶·稳 Sprout-Stable — Repeatable
  E3 = 'E3', // 成长阶 Growth — Defined / Domain-Aware
  E4 = 'E4', // 成长阶·深 Growth-Deep — Managed / Cross-Domain
  E5 = 'E5', // 觉醒阶 Awakened — Optimizing / Self-Evolving
  E6 = 'E6', // ForgeMind阶 ForgeMind — Master / Forge Master
}

/** 觉醒阶（自主性，对齐 stages.py AwakeningStage） */
export enum AwakeningStage {
  E1 = 'E1', // 全导阶 Full-Human — L0 Full Human Control
  E2 = 'E2', // 建议阶 Suggest — L1 Suggestion / Assisted
  E3 = 'E3', // 受限自主阶 Bounded-Autonomous — L2 Bounded Autonomous
  E4 = 'E4', // Evolving 阶 Evolving — L3 Evolving / Self-Improving
  E5 = 'E5', // 共创阶 Co-Creative — L4 Co-Creative / Peer
  E6 = 'E6', // ForgeMind主导阶 ForgeMind-Led — L5 ForgeMind-Led / Master
}

// ── 进化阶元数据表 ────────────────────────────────────────────────
const EVOLUTION_CHINESE_NAMES: Record<EvolutionStage, string> = {
  [EvolutionStage.E1]: '萌芽阶',
  [EvolutionStage.E2]: '萌芽阶·稳',
  [EvolutionStage.E3]: '成长阶',
  [EvolutionStage.E4]: '成长阶·深',
  [EvolutionStage.E5]: '觉醒阶',
  [EvolutionStage.E6]: 'ForgeMind阶',
};

const EVOLUTION_ENGLISH_NAMES: Record<EvolutionStage, string> = {
  [EvolutionStage.E1]: 'Sprout',
  [EvolutionStage.E2]: 'Sprout-Stable',
  [EvolutionStage.E3]: 'Growth',
  [EvolutionStage.E4]: 'Growth-Deep',
  [EvolutionStage.E5]: 'Awakened',
  [EvolutionStage.E6]: 'ForgeMind',
};

const EVOLUTION_AI_CONCEPTS: Record<EvolutionStage, string> = {
  [EvolutionStage.E1]: 'Initial / Ad-hoc（初始级 / 临时级）',
  [EvolutionStage.E2]: 'Repeatable（可重复级）',
  [EvolutionStage.E3]: 'Defined / Domain-Aware（已定义级 / 领域感知）',
  [EvolutionStage.E4]: 'Managed / Cross-Domain（已管理级 / 跨域）',
  [EvolutionStage.E5]: 'Optimizing / Self-Evolving（优化级 / 自进化）',
  [EvolutionStage.E6]: 'Master / Forge Master（大师级 / 锻造大师）',
};

// ── 觉醒阶元数据表 ────────────────────────────────────────────────
const AWAKENING_CHINESE_NAMES: Record<AwakeningStage, string> = {
  [AwakeningStage.E1]: '全导阶',
  [AwakeningStage.E2]: '建议阶',
  [AwakeningStage.E3]: '受限自主阶',
  [AwakeningStage.E4]: 'Evolving 阶',
  [AwakeningStage.E5]: '共创阶',
  [AwakeningStage.E6]: 'ForgeMind主导阶',
};

const AWAKENING_ENGLISH_NAMES: Record<AwakeningStage, string> = {
  [AwakeningStage.E1]: 'Full-Human',
  [AwakeningStage.E2]: 'Suggest',
  [AwakeningStage.E3]: 'Bounded-Autonomous',
  [AwakeningStage.E4]: 'Evolving',
  [AwakeningStage.E5]: 'Co-Creative',
  [AwakeningStage.E6]: 'ForgeMind-Led',
};

const AWAKENING_AI_CONCEPTS: Record<AwakeningStage, string> = {
  [AwakeningStage.E1]: 'L0 Full Human Control / Manual（全人工）',
  [AwakeningStage.E2]: 'L1 Suggestion / Assisted（建议级 / 辅助）',
  [AwakeningStage.E3]: 'L2 Bounded Autonomous / Conditional（受限自主 / 条件自主）',
  [AwakeningStage.E4]: 'L3 Evolving / Self-Improving（自进化 / 自改进）',
  [AwakeningStage.E5]: 'L4 Co-Creative / Peer（共创级 / 平级协作）',
  [AwakeningStage.E6]: 'L5 ForgeMind-Led / Master（ForgeMind主导级 / 大师级）',
};

const STAGE_LEVELS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'] as const;

const parseStage = <T extends EvolutionStage | AwakeningStage>(cls: Record<string, T>, value: string, axisName: string): T => {
  const normalized = value.trim().toUpperCase();
  for (const key of STAGE_LEVELS) {
    if (cls[key]?.valueOf() === normalized) {
      return cls[key] as T;
    }
  }
  const valid = STAGE_LEVELS.join(', ');
  throw new Error(`未知的${axisName}: ${JSON.stringify(value)}（合法值: ${valid}）。详见 [doc:design/naming-contract.md]`);
};

export namespace EvolutionStage {
  /** 从字符串解析进化阶枚举，大小写不敏感 */
  export function fromString(value: string): EvolutionStage {
    return parseStage(EvolutionStage as unknown as Record<string, EvolutionStage>, value, '进化阶');
  }
  /** 该进化阶的中文名 */
  export function chineseName(stage: EvolutionStage): string {
    return EVOLUTION_CHINESE_NAMES[stage];
  }
  /** 该进化阶的英文名 */
  export function englishName(stage: EvolutionStage): string {
    return EVOLUTION_ENGLISH_NAMES[stage];
  }
  /** 该进化阶对应的 AI 业界概念 */
  export function aiConcept(stage: EvolutionStage): string {
    return EVOLUTION_AI_CONCEPTS[stage];
  }
  /** 该进化阶的整数等级（1-6），便于比较 */
  export function level(stage: EvolutionStage): number {
    return Number(stage[1]);
  }
  /** ≥ E4 Growth-Deep 具备跨 ForgekinSpecies 协作能力 */
  export function canCrossSpecies(stage: EvolutionStage): boolean {
    return level(stage) >= level(EvolutionStage.E4);
  }
  /** ≥ E5 Awakened 可主动发起 MindCouncil */
  export function canInitiateCouncil(stage: EvolutionStage): boolean {
    return level(stage) >= level(EvolutionStage.E5);
  }
  /** 仅 E6 ForgeMind 可锻造新 Forgekin（operator 直接授权的"造 agent"能力） */
  export function canForgeNewForgekin(stage: EvolutionStage): boolean {
    return stage === EvolutionStage.E6;
  }
}

export namespace AwakeningStage {
  /** 从字符串解析觉醒阶枚举，大小写不敏感 */
  export function fromString(value: string): AwakeningStage {
    return parseStage(AwakeningStage as unknown as Record<string, AwakeningStage>, value, '觉醒阶');
  }
  /** 该觉醒阶的中文名 */
  export function chineseName(stage: AwakeningStage): string {
    return AWAKENING_CHINESE_NAMES[stage];
  }
  /** 该觉醒阶的英文名 */
  export function englishName(stage: AwakeningStage): string {
    return AWAKENING_ENGLISH_NAMES[stage];
  }
  /** 该觉醒阶对应的 AI 业界概念 */
  export function aiConcept(stage: AwakeningStage): string {
    return AWAKENING_AI_CONCEPTS[stage];
  }
  /** 该觉醒阶的整数等级（1-6），便于比较 */
  export function level(stage: AwakeningStage): number {
    return Number(stage[1]);
  }
  /** ≥ E4 Evolving 可自我进化（可自主优化自身能力，但不可修改 VISION §7） */
  export function canSelfEvolve(stage: AwakeningStage): boolean {
    return level(stage) >= level(AwakeningStage.E4);
  }
  /** 仅 E1 全人工（每步操作都需要 operator 介入） */
  export function isFullHumanControl(stage: AwakeningStage): boolean {
    return stage === AwakeningStage.E1;
  }
}
