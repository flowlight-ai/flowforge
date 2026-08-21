/**
 * KnowledgeEvolution / models — T7.4 知识进化契约验证。
 *
 * 覆盖（对齐 Python `evolution/knowledge_evolution.py` + `evolution/models.py`）：
 * - 三问判断（≥2 才沉淀）
 * - Episode Card 创建（direction 校验 + 模板完整）
 * - Dual Distillation（method_card → MethodCard；skill_draft/memory → 方向标识）
 * - Eval Ledger：case 校验 / smoke gate 3≥2 / promotion gate 5≥3 + 3 类覆盖
 * - 成熟度置信度映射（CL-005）
 *
 * @module @flowforge/forgekin-knowledge/tests
 */

import { describe, expect, it } from 'vitest';
import {
  KnowledgeEvolution,
  SMOKE_GATE_CASES,
  SMOKE_GATE_PASS_THRESHOLD,
  PROMOTION_GATE_CASES,
  PROMOTION_GATE_PASS_THRESHOLD,
  PROMOTION_GATE_CATEGORY_COVERAGE,
} from '../src/knowledge-evolution.js';
import {
  computeConfidenceFromMaturity,
  makeEpisodeCard,
  makeEvalLedger,
  makeKnowledgeObject,
  makeMethodCard,
  EvalCase,
} from '../src/models.js';

function episodeInput() {
  return {
    taskSnapshot: '高价值协作：跨厂商 review 流程重构',
    evidenceMap: { trace: 'trace-1', reliability: 0.9 },
    decisionTimeline: [{ step: 'A', reason: 'x' }],
    collaborationPivots: [{ cue: 'human-cue', effect: 'pivot' }],
    transferableMethod: '跨厂商 review 必须核对盲点类别重叠',
    nonTransferableFacts: '本次任务的具体 commit 列表',
    safetyBoundary: '不可自动合入生产',
  };
}

describe('shouldDistill 三问判断', () => {
  const evo = new KnowledgeEvolution();
  it('满足 ≥2 才沉淀', () => {
    expect(evo.shouldDistill(true, true, true)).toBe(true);
    expect(evo.shouldDistill(true, true, false)).toBe(true);
    expect(evo.shouldDistill(true, false, false)).toBe(false);
    expect(evo.shouldDistill(false, false, false)).toBe(false);
  });
});

describe('Episode Card / Dual Distillation', () => {
  const evo = new KnowledgeEvolution();

  it('createEpisodeCard：ep- 前缀 ID + 快照 + 方向校验', () => {
    const ep = evo.createEpisodeCard(episodeInput());
    expect(ep.episodeId).toMatch(/^ep-[0-9a-f]{12}$/);
    expect(ep.distillationDirection).toBe('method_card');
    expect(() => evo.createEpisodeCard({ ...episodeInput(), distillationDirection: 'bogus' as never })).toThrow();
  });

  it('method_card 方向 → MethodCard（title 截断 80 + sourceRefs 指向 episode）', () => {
    const ep = evo.createEpisodeCard(episodeInput());
    const result = evo.distillEpisode(ep.episodeId);
    expect(typeof result).not.toBe('string');
    expect(result).toHaveProperty('methodId');
    expect((result as { methodId: string }).methodId).toMatch(/^mc-[0-9a-f]{12}$/);
    expect((result as { sourceRefs: string[] }).sourceRefs).toEqual([ep.episodeId]);
    expect((result as { maturityLevel: string }).maturityLevel).toBe('L2');
  });

  it('skill_draft / memory 方向 → 返回方向标识', () => {
    const skill = evo.createEpisodeCard({ ...episodeInput(), distillationDirection: 'skill_draft' });
    expect(evo.distillEpisode(skill.episodeId)).toBe('skill_draft');
    const memory = evo.createEpisodeCard({ ...episodeInput(), distillationDirection: 'memory' });
    expect(evo.distillEpisode(memory.episodeId)).toBe('memory');
  });

  it('未知 episode → 报错', () => {
    expect(() => evo.distillEpisode('ep-missing')).toThrow(/not found/);
  });
});

describe('Eval Ledger 双门', () => {
  const evo = new KnowledgeEvolution();
  const ep = evo.createEpisodeCard(episodeInput());
  const method = evo.distillEpisode(ep.episodeId) as { methodId: string };

  function cases(passedFlags: boolean[], categories: string[]): EvalCase[] {
    return passedFlags.map((passed, i) => ({ caseId: `c-${i}`, category: categories[i]!, passed }));
  }

  it('createEvalLedger：空 cases / 缺字段拒绝', () => {
    expect(() => evo.createEvalLedger(method.methodId, [])).toThrow(/not be empty/);
    expect(() => evo.createEvalLedger(method.methodId, [{ caseId: 'x', passed: true } as EvalCase])).toThrow(/missing required fields/);
  });

  it('smoke gate：≥2/3 pass；不足 3 case 直接失败', () => {
    const pass2 = evo.createEvalLedger(method.methodId, cases([true, true, false], ['a', 'a', 'b']));
    expect(evo.checkSmokeGate(pass2.evalId)).toBe(true);
    expect(pass2.smokeGatePassed).toBe(true);

    const pass1 = evo.createEvalLedger(method.methodId, cases([true, false, false], ['a', 'b', 'c']));
    expect(evo.checkSmokeGate(pass1.evalId)).toBe(false);

    const short = evo.createEvalLedger(method.methodId, cases([true, true], ['a', 'a']));
    expect(evo.checkSmokeGate(short.evalId)).toBe(false);
    expect(SMOKE_GATE_CASES).toBe(3);
    expect(SMOKE_GATE_PASS_THRESHOLD).toBe(2);
  });

  it('promotion gate：≥3/5 + 3 类覆盖；不满足任一条件失败', () => {
    const allPass = evo.createEvalLedger(method.methodId, cases(
      [true, true, true, true, true],
      ['standard_success', 'standard_success', 'boundary_escalation', 'conflict_counterexample', 'conflict_counterexample'],
    ));
    expect(evo.checkPromotionGate(allPass.evalId)).toBe(true);
    expect(allPass.promotionGatePassed).toBe(true);

    // 通过数够但类别只覆盖 2 类
    const weakCoverage = evo.createEvalLedger(method.methodId, cases(
      [true, true, true, true, false],
      ['standard_success', 'standard_success', 'standard_success', 'standard_success', 'boundary_escalation'],
    ));
    expect(evo.checkPromotionGate(weakCoverage.evalId)).toBe(false);

    // 5 cases 但通过数不足
    const lowPass = evo.createEvalLedger(method.methodId, cases(
      [true, true, false, false, false],
      ['standard_success', 'standard_success', 'boundary_escalation', 'conflict_counterexample', 'standard_success'],
    ));
    expect(evo.checkPromotionGate(lowPass.evalId)).toBe(false);

    // 不足 5 cases
    const short = evo.createEvalLedger(method.methodId, cases([true, true, true], ['a', 'b', 'c']));
    expect(evo.checkPromotionGate(short.evalId)).toBe(false);

    expect(PROMOTION_GATE_CASES).toBe(5);
    expect(PROMOTION_GATE_PASS_THRESHOLD).toBe(3);
    expect(PROMOTION_GATE_CATEGORY_COVERAGE).toBe(3);
  });

  it('未知 eval → 报错', () => {
    expect(() => evo.checkSmokeGate('ev-missing')).toThrow(/not found/);
    expect(() => evo.checkPromotionGate('ev-missing')).toThrow(/not found/);
  });
});

describe('models 工厂', () => {
  it('computeConfidenceFromMaturity：L0=0.2 → L4=1.0', () => {
    expect(computeConfidenceFromMaturity('L0')).toBe(0.2);
    expect(computeConfidenceFromMaturity('L1')).toBe(0.4);
    expect(computeConfidenceFromMaturity('L2')).toBe(0.6);
    expect(computeConfidenceFromMaturity('L3')).toBe(0.8);
    expect(computeConfidenceFromMaturity('L4')).toBe(1.0);
  });

  it('makeKnowledgeObject：七字段缺省 + 置信度随成熟度', () => {
    const ko = makeKnowledgeObject({
      artifactType: 'method',
      domain: 'programming',
      knowledgeType: 'procedural',
      scope: 'agent_local',
      trustLevel: 'experimental',
      lifecycle: 'draft',
      maturityLevel: 'L2',
    });
    expect(ko.confidence).toBe(0.6);
    expect(ko.trigger).toBe('');
    expect(ko.provenance).toEqual({});
  });

  it('makeMethodCard / makeEvalLedger / makeEpisodeCard 缺省工厂', () => {
    const mc = makeMethodCard({ methodId: 'mc-1', title: 't', content: 'c' });
    expect(mc.trustLevel).toBe('experimental');
    expect(mc.maturityLevel).toBe('L2');
    const ev = makeEvalLedger({ evalId: 'ev-1', methodId: 'mc-1' });
    expect(ev.judgeRubric.boundary_compliance).toBe(0);
    expect(ev.merged).toBe(false);
    const ep = makeEpisodeCard({ episodeId: 'ep-1', taskSnapshot: 's', evidenceMap: {}, decisionTimeline: [], collaborationPivots: [], transferableMethod: 'm', nonTransferableFacts: 'f', safetyBoundary: 'b', distillationDirection: 'method_card' });
    expect(ep.createdAt).toBeTruthy();
  });
});
