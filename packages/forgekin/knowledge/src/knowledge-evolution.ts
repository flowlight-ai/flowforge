/**
 * @flowforge/forgekin-knowledge — 阶段7 T7.4 KnowledgeEvolution 知识进化
 *
 * 本地化自 flowforge Python `evolution/knowledge_evolution.py`（275 行）：
 * Mode C: Knowledge Evolution 三机制闭环 —— Episode Card → Dual Distillation → Eval Ledger
 * - 三问判断（复用性/非显然性/衰减性，≥2 才沉淀）
 * - Smoke gate: 3 cases, ≥2/3 pass
 * - Promotion gate: 5 cases, ≥3/5 pass, 覆盖 3 类
 *
 * @module @flowforge/forgekin-knowledge/knowledge-evolution
 */

import { randomUUID } from 'node:crypto';
import {
  EvalCase,
  EvalLedger,
  EpisodeCard,
  KnowledgeType,
  Lifecycle,
  makeEvalLedger,
  makeMethodCard,
  MethodCard,
  TrustLevel,
} from './models.js';

/** Smoke gate: 3 cases, ≥2/3 pass */
export const SMOKE_GATE_CASES = 3;
export const SMOKE_GATE_PASS_THRESHOLD = 2;

/** Promotion gate: 5 cases, ≥3/5 pass, 覆盖 3 类 */
export const PROMOTION_GATE_CASES = 5;
export const PROMOTION_GATE_PASS_THRESHOLD = 3;
/** 标准成功 / 边界应升级 / 冲突反例 */
export const PROMOTION_GATE_CATEGORY_COVERAGE = 3;

/** 三问满足数量阈值 */
export const DISTILL_MIN_CRITERIA = 2;

export const DISTILL_DIRECTIONS = ['method_card', 'skill_draft', 'memory'] as const;
export type DistillDirection = (typeof DISTILL_DIRECTIONS)[number];

/** Eval case 必需字段 */
const CASE_REQUIRED_FIELDS = ['caseId', 'category', 'passed'] as const;

export interface CreateEpisodeCardInput {
  taskSnapshot: string;
  evidenceMap: Record<string, unknown>;
  decisionTimeline: Record<string, unknown>[];
  collaborationPivots: Record<string, unknown>[];
  transferableMethod: string;
  nonTransferableFacts: string;
  safetyBoundary: string;
  distillationDirection?: DistillDirection;
}

export interface CreateMethodCardInput {
  title: string;
  domain?: string;
  knowledgeType?: KnowledgeType;
  scope?: string;
  trustLevel?: TrustLevel;
  lifecycle?: Lifecycle;
  content: string;
  sourceRefs?: string[];
  maturityLevel?: string;
}

export class KnowledgeEvolution {
  private readonly episodes: EpisodeCard[] = [];
  private readonly methods: MethodCard[] = [];
  private readonly evals: EvalLedger[] = [];

  /**
   * 三问判断（满足 ≥2 个才沉淀）：
   * reusability 复用性 / nonObviousness 非显然性 / decayRisk 衰减性
   */
  shouldDistill(reusability: boolean, nonObviousness: boolean, decayRisk: boolean): boolean {
    const score = [reusability, nonObviousness, decayRisk].filter(Boolean).length;
    return score >= DISTILL_MIN_CRITERIA;
  }

  /** 创建 Episode Card（L0 原始记录；模板完整 + 分离可迁移/不可迁移 才能晋升 L1） */
  createEpisodeCard(input: CreateEpisodeCardInput): EpisodeCard {
    const direction = input.distillationDirection ?? 'method_card';
    if (!DISTILL_DIRECTIONS.includes(direction)) {
      throw new Error(`Invalid distillation_direction '${direction}', must be one of: ${DISTILL_DIRECTIONS.join(' | ')}`);
    }
    const episode: EpisodeCard = {
      episodeId: `ep-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      taskSnapshot: input.taskSnapshot,
      evidenceMap: { ...input.evidenceMap },
      decisionTimeline: [...input.decisionTimeline],
      collaborationPivots: [...input.collaborationPivots],
      transferableMethod: input.transferableMethod,
      nonTransferableFacts: input.nonTransferableFacts,
      safetyBoundary: input.safetyBoundary,
      distillationDirection: direction,
      createdAt: new Date().toISOString(),
    };
    this.episodes.push(episode);
    return episode;
  }

  /**
   * Dual Distillation — 将 Episode 蒸馏成 Method Card 或 Skill Draft。
   * method_card → MethodCard；skill_draft/memory → 返回方向标识（调用方后续处理）。
   */
  distillEpisode(episodeId: string): MethodCard | DistillDirection {
    const episode = this.findEpisode(episodeId);
    if (!episode) throw new Error(`Episode '${episodeId}' not found`);

    if (episode.distillationDirection === 'method_card') {
      const method = makeMethodCard({
        methodId: `mc-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        title: episode.transferableMethod.slice(0, 80),
        domain: 'general',
        content: episode.transferableMethod,
        sourceRefs: [episode.episodeId],
      });
      this.methods.push(method);
      return method;
    }
    return episode.distillationDirection as DistillDirection;
  }

  /** 创建 Eval Ledger（Replay A/B 验证知识净增益） */
  createEvalLedger(methodId: string, cases: EvalCase[]): EvalLedger {
    this.validateCases(cases);
    const ledger = makeEvalLedger({
      evalId: `ev-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      methodId,
      cases: [...cases],
    });
    this.evals.push(ledger);
    return ledger;
  }

  /** Smoke gate: 3 cases, ≥2/3 pass（通过后写入 ledger.smokeGatePassed） */
  checkSmokeGate(evalId: string): boolean {
    const ledger = this.findEval(evalId);
    if (!ledger) throw new Error(`Eval '${evalId}' not found`);

    if (ledger.cases.length < SMOKE_GATE_CASES) return false;
    const passed = ledger.cases.filter((c) => c.passed).length;
    const result = passed >= SMOKE_GATE_PASS_THRESHOLD;
    ledger.smokeGatePassed = result;
    return result;
  }

  /**
   * Promotion gate: 5 cases, ≥3/5 pass, 覆盖 3 类（标准成功/边界应升级/冲突反例）。
   * 通过后写入 ledger.promotionGatePassed。
   */
  checkPromotionGate(evalId: string): boolean {
    const ledger = this.findEval(evalId);
    if (!ledger) throw new Error(`Eval '${evalId}' not found`);

    const cases = ledger.cases;
    if (cases.length < PROMOTION_GATE_CASES) {
      ledger.promotionGatePassed = false;
      return false;
    }

    const passed = cases.filter((c) => c.passed).length;
    if (passed < PROMOTION_GATE_PASS_THRESHOLD) {
      ledger.promotionGatePassed = false;
      return false;
    }

    // 类别覆盖检查（3 类）
    const categories = new Set(cases.map((c) => c.category).filter(Boolean));
    if (categories.size < PROMOTION_GATE_CATEGORY_COVERAGE) {
      ledger.promotionGatePassed = false;
      return false;
    }

    ledger.promotionGatePassed = true;
    return true;
  }

  getEpisodes(): EpisodeCard[] {
    return [...this.episodes];
  }

  getMethods(): MethodCard[] {
    return [...this.methods];
  }

  getEvals(): EvalLedger[] {
    return [...this.evals];
  }

  // ── 内部工具 ────────────────────────────────────────────────────────────

  private findEpisode(episodeId: string): EpisodeCard | undefined {
    return this.episodes.find((ep) => ep.episodeId === episodeId);
  }

  private findEval(evalId: string): EvalLedger | undefined {
    return this.evals.find((ev) => ev.evalId === evalId);
  }

  private validateCases(cases: EvalCase[]): void {
    if (cases.length === 0) throw new Error('cases must not be empty');
    cases.forEach((c, idx) => {
      const missing = CASE_REQUIRED_FIELDS.filter((f) => !(f in c));
      if (missing.length > 0) {
        throw new Error(`case[${idx}] missing required fields: ${missing.join(', ')} (required: ${CASE_REQUIRED_FIELDS.join(', ')})`);
      }
    });
  }
}
