/**
 * @flowforge/forgekin-knowledge — 阶段7 T7.4 知识进化域 Cordis 插件
 *
 * 挂载 `ctx.forgeKnowledge`：MindCodex 程序记忆库（检索三入口 + 消费加权排名，F38）
 * + KnowledgeEvolution 蒸馏引擎（三问/双门）+ SpiritForge 经验蒸馏管线。
 * 对齐 Python `evolution/knowledge_evolution.py` + `core/memory_federation/mind_codex.py`。
 */
import { Context, Service } from '@flowforge/cordis';
import {
  KnowledgeEvolution,
} from './knowledge-evolution.js';
import {
  MindCodex,
  MindCodexEntry,
  MindCodexOptions,
} from './mind-codex.js';
import {
  DistillExperienceInput,
  ForgeOutcome,
  SpiritForge,
} from './spirit-forge.js';
import {
  EvalCase,
  EvalLedger,
  EpisodeCard,
  MethodCard,
} from './models.js';

export * from './models.js';
export * from './knowledge-evolution.js';
export * from './mind-codex.js';
export * from './spirit-forge.js';

export interface KnowledgeServiceOptions extends MindCodexOptions {
  /** 蒸馏引擎（缺省新建） */
  readonly evolution?: KnowledgeEvolution | undefined;
  /** MindCodex 知识库（缺省新建） */
  readonly codex?: MindCodex | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 知识进化域：MindCodex 检索 + 蒸馏管线 + Eval 双门 */
    forgeKnowledge: KnowledgeService;
  }
}

export class KnowledgeService extends Service {
  readonly codex: MindCodex;
  readonly evolution: KnowledgeEvolution;
  readonly spiritForge: SpiritForge;

  constructor(ctx: Context, options: KnowledgeServiceOptions = {}) {
    super(ctx, 'forgeKnowledge');
    this.codex = options.codex ?? new MindCodex({
      llmClient: options.llmClient,
      distillPromptTemplate: options.distillPromptTemplate,
    });
    this.evolution = options.evolution ?? new KnowledgeEvolution();
    this.spiritForge = new SpiritForge({ evolution: this.evolution, codex: this.codex });
  }

  // ── MindCodex 检索（T7.23 F38：三入口 + 消费加权） ─────────────────────

  /** 入口一：关键字检索（标题/内容/标签子串 + 关键词重叠评分） */
  search(query: string, topK = 5): Promise<MindCodexEntry[]> {
    return this.codex.search(query, topK);
  }

  /** 入口二：按领域列出（领域索引） */
  async listByDomain(domain: string): Promise<MindCodexEntry[]> {
    return this.codex.listEntries().filter((e) => e.domain === domain);
  }

  /** 入口三：按技能标签检索（标签索引） */
  async listByTag(tag: string): Promise<MindCodexEntry[]> {
    return this.codex.listEntries().filter((e) => e.skillTags.includes(tag));
  }

  /** 消费记录（提升排名权重） */
  recordConsumption(codexId: string): Promise<void> {
    return this.codex.recordConsumption(codexId);
  }

  /** 全部条目（trace/调试） */
  listEntries(): MindCodexEntry[] {
    return this.codex.listEntries();
  }

  /** 从经验直接蒸馏入库 */
  deriveFromExperience(experience: Parameters<MindCodex['deriveFromExperience']>[0]): Promise<MindCodexEntry> {
    return this.codex.deriveFromExperience(experience);
  }

  // ── 蒸馏引擎（KnowledgeEvolution 语义） ────────────────────────────────

  /** 三问判断（≥2 才沉淀） */
  shouldDistill(reusability: boolean, nonObviousness: boolean, decayRisk: boolean): boolean {
    return this.evolution.shouldDistill(reusability, nonObviousness, decayRisk);
  }

  /** 创建 Episode Card（L0） */
  createEpisodeCard(input: Parameters<KnowledgeEvolution['createEpisodeCard']>[0]): EpisodeCard {
    return this.evolution.createEpisodeCard(input);
  }

  /** Dual Distillation（Episode → MethodCard / 方向标识） */
  distillEpisode(episodeId: string): MethodCard | string {
    return this.evolution.distillEpisode(episodeId);
  }

  /** 创建 Eval Ledger */
  createEvalLedger(methodId: string, cases: EvalCase[]): EvalLedger {
    return this.evolution.createEvalLedger(methodId, cases);
  }

  /** Smoke gate: 3 cases ≥2/3 */
  checkSmokeGate(evalId: string): boolean {
    return this.evolution.checkSmokeGate(evalId);
  }

  /** Promotion gate: 5 cases ≥3/5 + 3 类覆盖 */
  checkPromotionGate(evalId: string): boolean {
    return this.evolution.checkPromotionGate(evalId);
  }

  // ── SpiritForge 管线 ──────────────────────────────────────────────────

  /** 完整蒸馏管线（三问 → Episode → 蒸馏 → 双门 → 入库） */
  forge(input: DistillExperienceInput): Promise<ForgeOutcome> {
    return this.spiritForge.forge(input);
  }

  /** 手动蒸馏（无自动 Eval） */
  distillExperience(input: DistillExperienceInput): { distilled: boolean; method?: MethodCard; direction?: string } {
    return this.spiritForge.distillEpisode(input);
  }

  /** 蒸馏产物快照（trace 日志） */
  snapshot(): { episodes: number; methods: number; evals: number; codexEntries: number } {
    return {
      episodes: this.evolution.getEpisodes().length,
      methods: this.evolution.getMethods().length,
      evals: this.evolution.getEvals().length,
      codexEntries: this.codex.listEntries().length,
    };
  }
}

export default function Plugin(ctx: Context, options?: KnowledgeServiceOptions) {
  return ctx.plugin(KnowledgeService, options);
}
