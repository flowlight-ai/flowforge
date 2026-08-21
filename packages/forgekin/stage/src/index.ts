/**
 * @flowforge/forgekin-stage — 阶段7 T7.6 阶段与成熟度域 Cordis 插件
 *
 * 挂载 `ctx.forgeStage`：EvolutionStage/AwakeningStage 双轴 E1-E6（能力成熟度 × 自主性，
 * 对齐 Python `forgemind/stages.py`）+ KnowledgeMaturityLadder 五级知识成熟度阶梯
 * （晋升/降级/冻结纯函数判定，对齐 Python `evolution/maturity.py`）。
 */
import { Context, Service } from '@flowforge/cordis';
import {
  AwakeningStage,
  EvolutionStage,
} from './stages.js';
import {
  KnowledgeMaturityLadder,
  MaturityLevel,
  PromotionUsageData,
} from './maturity.js';

export * from './stages.js';
export * from './maturity.js';

export interface StageServiceOptions {
  /** 成熟度阶梯（缺省新建） */
  readonly ladder?: KnowledgeMaturityLadder | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 阶段与成熟度域：双轴阶位 + 知识成熟度阶梯 */
    forgeStage: StageService;
  }
}

export class StageService extends Service {
  readonly ladder: KnowledgeMaturityLadder;

  constructor(ctx: Context, options: StageServiceOptions = {}) {
    super(ctx, 'forgeStage');
    this.ladder = options.ladder ?? new KnowledgeMaturityLadder();
  }

  // ── 进化阶（能力成熟度轴） ──────────────────────────────────────

  parseEvolutionStage(value: string): EvolutionStage {
    return EvolutionStage.fromString(value);
  }

  evolutionChineseName(stage: EvolutionStage): string {
    return EvolutionStage.chineseName(stage);
  }

  evolutionEnglishName(stage: EvolutionStage): string {
    return EvolutionStage.englishName(stage);
  }

  evolutionAiConcept(stage: EvolutionStage): string {
    return EvolutionStage.aiConcept(stage);
  }

  evolutionLevel(stage: EvolutionStage): number {
    return EvolutionStage.level(stage);
  }

  /** ≥ E4 具备跨 ForgekinSpecies 协作能力 */
  canCrossSpecies(stage: EvolutionStage): boolean {
    return EvolutionStage.canCrossSpecies(stage);
  }

  /** ≥ E5 可主动发起 MindCouncil */
  canInitiateCouncil(stage: EvolutionStage): boolean {
    return EvolutionStage.canInitiateCouncil(stage);
  }

  /** 仅 E6 可锻造新 Forgekin */
  canForgeNewForgekin(stage: EvolutionStage): boolean {
    return EvolutionStage.canForgeNewForgekin(stage);
  }

  // ── 觉醒阶（自主性轴） ──────────────────────────────────────────

  parseAwakeningStage(value: string): AwakeningStage {
    return AwakeningStage.fromString(value);
  }

  awakeningChineseName(stage: AwakeningStage): string {
    return AwakeningStage.chineseName(stage);
  }

  awakeningEnglishName(stage: AwakeningStage): string {
    return AwakeningStage.englishName(stage);
  }

  awakeningAiConcept(stage: AwakeningStage): string {
    return AwakeningStage.aiConcept(stage);
  }

  awakeningLevel(stage: AwakeningStage): number {
    return AwakeningStage.level(stage);
  }

  /** ≥ E4 Evolving 可自我进化 */
  canSelfEvolve(stage: AwakeningStage): boolean {
    return AwakeningStage.canSelfEvolve(stage);
  }

  /** 仅 E1 全人工 */
  isFullHumanControl(stage: AwakeningStage): boolean {
    return AwakeningStage.isFullHumanControl(stage);
  }

  // ── 知识成熟度阶梯 ──────────────────────────────────────────────

  /** 检查是否可以晋升。返回新 level 或 null。 */
  checkPromotion(knowledgeId: string, currentLevel: MaturityLevel, usageData: PromotionUsageData): MaturityLevel | null {
    return this.ladder.checkPromotion(knowledgeId, currentLevel, usageData);
  }

  /** 检查是否应该降级。返回新 level 或 null。 */
  checkDemotion(knowledgeId: string, currentLevel: MaturityLevel, recentPerformance: boolean[]): MaturityLevel | null {
    return this.ladder.checkDemotion(knowledgeId, currentLevel, recentPerformance);
  }

  /** 检查 L4 是否应冻结（1 次高风险越界 → freeze）。 */
  checkFreeze(knowledgeId: string, currentLevel: MaturityLevel, highRiskBreach: boolean): boolean {
    return this.ladder.checkFreeze(knowledgeId, currentLevel, highRiskBreach);
  }
}

export default function Plugin(ctx: Context, options?: StageServiceOptions) {
  return ctx.plugin(StageService, options);
}
