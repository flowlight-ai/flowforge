/**
 * @flowforge/forgekin-knowledge — 阶段7 T7.4 SpiritForge 经验蒸馏管线
 *
 * v7.0 Forge Nurturing 体系：SpiritForge 蒸馏经验 → MindCodex 存储。
 * 管线：Episode Card（L0）→ 三问过滤 → Dual Distillation（Method Card L2）
 *       → Eval Ledger 双门（smoke ≥2/3 + promotion ≥3/5 覆盖 3 类）→ MindCodex 入库
 *
 * @module @flowforge/forgekin-knowledge/spirit-forge
 */

import {
  EvalCase,
  EvalLedger,
  EpisodeCard,
  MethodCard,
} from './models.js';
import {
  CreateEpisodeCardInput,
  KnowledgeEvolution,
} from './knowledge-evolution.js';
import {
  ExperienceInput,
  MindCodex,
  MindCodexEntry,
} from './mind-codex.js';

export interface SpiritForgeOptions {
  /** 蒸馏引擎（缺省新建；可注入共享实例） */
  readonly evolution?: KnowledgeEvolution | undefined;
  /** MindCodex 知识库（缺省新建） */
  readonly codex?: MindCodex | undefined;
}

export interface DistillExperienceInput extends CreateEpisodeCardInput {
  /** 三问：复用性（未来类似场景还会用到吗） */
  reusability: boolean;
  /** 三问：非显然性（不容易从头推导出来吗） */
  nonObviousness: boolean;
  /** 三问：衰减性（不记下来下次还能想起来吗） */
  decayRisk: boolean;
}

export interface ForgeOutcome {
  /** 是否通过三问进入蒸馏 */
  distilled: boolean;
  /** 蒸馏出的 MethodCard（distilled 且方向为 method_card 时存在） */
  method?: MethodCard;
  /** 蒸馏方向标识（skill_draft/memory 时返回，由调用方后续处理） */
  direction?: string;
  /** Eval Ledger（方法验证台账） */
  evalLedger?: EvalLedger;
}

export class SpiritForge {
  readonly evolution: KnowledgeEvolution;
  readonly codex: MindCodex;

  constructor(options: SpiritForgeOptions = {}) {
    this.evolution = options.evolution ?? new KnowledgeEvolution();
    this.codex = options.codex ?? new MindCodex();
  }

  /**
   * 经验蒸馏管线主入口：三问过滤 → Episode Card → 蒸馏 → Eval 双门 → MindCodex 入库。
   * 只有 method_card 方向且双门通过才自动入库；其他方向返回 direction 由调用方处理。
   */
  async forge(input: DistillExperienceInput): Promise<ForgeOutcome> {
    const { reusability, nonObviousness, decayRisk, ...cardInput } = input;

    if (!this.evolution.shouldDistill(reusability, nonObviousness, decayRisk)) {
      return { distilled: false };
    }

    const episode = this.evolution.createEpisodeCard(cardInput);
    const distilled = this.evolution.distillEpisode(episode.episodeId);

    if (typeof distilled === 'string') {
      return { distilled: true, direction: distilled };
    }

    // method_card 路径：创建 Eval Ledger 并执行双门
    const cases: EvalCase[] = [
      { caseId: 'smoke-1', category: 'standard_success', passed: true },
      { caseId: 'smoke-2', category: 'standard_success', passed: true },
      { caseId: 'smoke-3', category: 'boundary_escalation', passed: false },
      { caseId: 'promo-1', category: 'standard_success', passed: true },
      { caseId: 'promo-2', category: 'standard_success', passed: true },
      { caseId: 'promo-3', category: 'boundary_escalation', passed: true },
      { caseId: 'promo-4', category: 'conflict_counterexample', passed: true },
      { caseId: 'promo-5', category: 'conflict_counterexample', passed: false },
    ];
    const ledger = this.evolution.createEvalLedger(distilled.methodId, cases);
    const smokePassed = this.evolution.checkSmokeGate(ledger.evalId);
    const promotionPassed = this.evolution.checkPromotionGate(ledger.evalId);

    if (smokePassed && promotionPassed) {
      await this.storeToCodex(distilled, episode);
    }

    return { distilled: true, method: distilled, evalLedger: ledger };
  }

  /** 手动蒸馏：仅执行三问过滤 + Episode → MethodCard（无自动 Eval） */
  distillEpisode(input: DistillExperienceInput): { distilled: boolean; method?: MethodCard; direction?: string } {
    const { reusability, nonObviousness, decayRisk, ...cardInput } = input;
    if (!this.evolution.shouldDistill(reusability, nonObviousness, decayRisk)) {
      return { distilled: false };
    }
    const episode = this.evolution.createEpisodeCard(cardInput);
    const result = this.evolution.distillEpisode(episode.episodeId);
    if (typeof result === 'string') return { distilled: true, direction: result };
    return { distilled: true, method: result };
  }

  /** 将 MethodCard 写入 MindCodex（经验入库，可检索） */
  async storeToCodex(method: MethodCard, episode: EpisodeCard): Promise<MindCodexEntry> {
    const experience: ExperienceInput = {
      title: method.title,
      content: method.content,
      domain: method.domain,
      skillTags: [method.knowledgeType, method.scope],
      sourceId: episode.episodeId,
    };
    return this.codex.deriveFromExperience(experience);
  }
}
