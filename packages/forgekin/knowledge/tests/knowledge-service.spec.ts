/**
 * MindCodex / SpiritForge / KnowledgeService — T7.4 知识库检索 + 蒸馏管线契约验证。
 *
 * 覆盖（对齐 Python `core/memory_federation/mind_codex.py` + F38）：
 * - MindCodex.search：标题 +0.5 / 内容 +0.3 / 标签 +0.2 / 关键词重叠评分
 * - deriveFromExperience：LLM 蒸馏 + 规则化 fallback + extractJson 三格式
 * - recordConsumption 消费加权排名
 * - SpiritForge.forge：三问过滤 → Episode → 蒸馏 → 双门 → 入库
 * - KnowledgeService 插件：ctx.forgeKnowledge + 检索三入口
 *
 * @module @flowforge/forgekin-knowledge/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, { KnowledgeService } from '../src/index.js';
import {
  LlmClient,
  MindCodex,
  MindCodexEntry,
} from '../src/mind-codex.js';
import {
  SpiritForge,
} from '../src/spirit-forge.js';

async function seedCodex(codex: MindCodex, entries: Array<Partial<MindCodexEntry> & Pick<MindCodexEntry, 'title' | 'content'>>): Promise<void> {
  for (const e of entries) {
    await codex.addEntry({
      codexId: `codex-${Math.random().toString(36).slice(2, 8)}`,
      domain: 'general',
      skillTags: [],
      derivedFrom: '',
      createdAt: new Date().toISOString(),
      usageCount: 0,
      ...e,
    });
  }
}

describe('MindCodex.search 评分', () => {
  it('标题命中 > 内容命中 > 标签命中，关键词重叠补充', async () => {
    const codex = new MindCodex();
    await seedCodex(codex, [
      { title: '跨厂商 review 原则', content: '必须核对盲点', skillTags: ['review'] },
      { title: '代码评审清单', content: '跨厂商 review 执行细节', skillTags: ['review'] },
      { title: '无关条目', content: 'tmux 网关调试', skillTags: ['terminal'] },
    ]);
    const hits = await codex.search('review');
    // 两条命中（标题/内容/标签），标题命中排最前；无关条目不含关键词不命中
    expect(hits).toHaveLength(2);
    expect(hits[0]!.title).toBe('跨厂商 review 原则');
  });

  it('空查询返回空 + topK 截断', async () => {
    const codex = new MindCodex();
    await seedCodex(codex, [
      { title: 'a1', content: 'x' },
      { title: 'a2', content: 'x' },
      { title: 'a3', content: 'x' },
    ]);
    expect(await codex.search('')).toEqual([]);
    expect(await codex.search('x', 2)).toHaveLength(2);
  });
});

describe('MindCodex.deriveFromExperience', () => {
  it('无 LLM → 规则化 fallback 直接入库', async () => {
    const codex = new MindCodex();
    const entry = await codex.deriveFromExperience({
      title: '经验标题',
      content: '经验内容',
      domain: 'programming',
      skillTags: ['ts', 'refactor'],
      sourceId: 'ep-1',
    });
    expect(entry.derivedFrom).toBe('ep-1');
    expect(entry.domain).toBe('programming');
    expect(entry.skillTags).toEqual(['ts', 'refactor']);
    expect(codex.listEntries()).toHaveLength(1);
  });

  it('注入 LLM + 模板 → LLM 蒸馏生效；JSON 块解析', async () => {
    const llm: LlmClient = {
      async complete(prompt: string) {
        expect(prompt).toContain('原始标题');
        return '```json\n{"title": "蒸馏标题", "content": "蒸馏内容", "skill_tags": ["a", "b"]}\n```';
      },
    };
    const codex = new MindCodex({ llmClient: llm, distillPromptTemplate: '模板 {title} {content} {domain} {skill_tags}' });
    const entry = await codex.deriveFromExperience({
      title: '原始标题',
      content: '原始内容',
      skillTags: ['x'],
    });
    expect(entry.title).toBe('蒸馏标题');
    expect(entry.content).toBe('蒸馏内容');
    expect(entry.skillTags).toEqual(['a', 'b']);
  });

  it('有 LLM 无模板 → 不调用 LLM 走 fallback（铁律 5+P16）', async () => {
    let called = false;
    const llm: LlmClient = { async complete() { called = true; return '{}'; } };
    const codex = new MindCodex({ llmClient: llm });
    const entry = await codex.deriveFromExperience({ title: 't', content: 'c' });
    expect(called).toBe(false);
    expect(entry.title).toBe('t');
  });

  it('extractJson 三格式：纯 JSON / 代码块 / 首尾大括号', () => {
    expect(MindCodex.extractJson('{"a":1}')).toBe('{"a":1}');
    expect(MindCodex.extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(MindCodex.extractJson('前缀 {"a":1} 后缀')).toBe('{"a":1}');
    expect(MindCodex.extractJson('no json here')).toBeUndefined();
  });

  it('recordConsumption 消费加权提升排名', async () => {
    const codex = new MindCodex();
    const a = await codex.deriveFromExperience({ title: '相同关键词条目A', content: '内容' });
    await codex.deriveFromExperience({ title: '相同关键词条目B', content: '内容' });
    // 初始评分相同（同标题模式），消费 A 后 A 应排前
    await codex.recordConsumption(a.codexId);
    const hits = await codex.search('相同关键词');
    expect(hits[0]!.codexId).toBe(a.codexId);
  });
});

function forgeInput() {
  return {
    taskSnapshot: '高价值协作：跨厂商 review 流程重构',
    evidenceMap: { trace: 'trace-1' },
    decisionTimeline: [],
    collaborationPivots: [],
    transferableMethod: '跨厂商 review 必须核对盲点类别重叠',
    nonTransferableFacts: '具体 commit 列表',
    safetyBoundary: '不可自动合入生产',
    reusability: true,
    nonObviousness: true,
    decayRisk: true,
  };
}

describe('SpiritForge 蒸馏管线', () => {
  it('三问不足 → 不蒸馏不入库', async () => {
    const forge = new SpiritForge();
    const outcome = await forge.forge({ ...forgeInput(), reusability: false, nonObviousness: false, decayRisk: false });
    expect(outcome.distilled).toBe(false);
    expect(forge.codex.listEntries()).toHaveLength(0);
  });

  it('method_card + 双门通过 → MethodCard + MindCodex 入库可检索', async () => {
    const forge = new SpiritForge();
    const outcome = await forge.forge(forgeInput());
    expect(outcome.distilled).toBe(true);
    expect(outcome.method).toBeDefined();
    expect(outcome.evalLedger?.smokeGatePassed).toBe(true);
    expect(outcome.evalLedger?.promotionGatePassed).toBe(true);
    expect(forge.codex.listEntries()).toHaveLength(1);
    const hits = await forge.codex.search('跨厂商 review');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('skill_draft 方向 → 返回 direction 不入库', async () => {
    const forge = new SpiritForge();
    const outcome = await forge.forge({ ...forgeInput(), distillationDirection: 'skill_draft' });
    expect(outcome.distilled).toBe(true);
    expect(outcome.direction).toBe('skill_draft');
    expect(outcome.method).toBeUndefined();
    expect(forge.codex.listEntries()).toHaveLength(0);
  });

  it('distillEpisode 手动蒸馏：仅三问 + Episode → MethodCard', () => {
    const forge = new SpiritForge();
    const r = forge.distillEpisode(forgeInput());
    expect(r.distilled).toBe(true);
    expect(r.method).toBeDefined();
    expect(forge.evolution.getEpisodes()).toHaveLength(1);
  });
});

describe('KnowledgeService 插件', () => {
  async function createCtx(): Promise<{ ctx: Context; service: KnowledgeService }> {
    const ctx = new Context();
    await ctx.plugin(KnowledgeService);
    return { ctx, service: ctx.forgeKnowledge };
  }

  it('ctx.forgeKnowledge 挂载 + 生命周期', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeKnowledge).toBeInstanceOf(KnowledgeService);
  });

  it('检索三入口：search / listByDomain / listByTag（F38）', async () => {
    const { service } = await createCtx();
    await service.deriveFromExperience({ title: 'ts 重构经验', content: '内容', domain: 'programming', skillTags: ['ts', 'refactor'] });
    await service.deriveFromExperience({ title: '医疗诊断经验', content: '内容', domain: 'medical', skillTags: ['diagnosis'] });
    expect(await service.search('重构')).toHaveLength(1);
    expect(await service.listByDomain('medical')).toHaveLength(1);
    expect(await service.listByTag('ts')).toHaveLength(1);
    expect(await service.listByTag('missing')).toHaveLength(0);
  });

  it('蒸馏引擎入口：shouldDistill / createEpisodeCard / 双门 / snapshot', async () => {
    const { service } = await createCtx();
    expect(service.shouldDistill(true, true, false)).toBe(true);
    const ep = service.createEpisodeCard({
      taskSnapshot: 's', evidenceMap: {}, decisionTimeline: [], collaborationPivots: [],
      transferableMethod: 'm', nonTransferableFacts: 'f', safetyBoundary: 'b',
    });
    const method = service.distillEpisode(ep.episodeId) as { methodId: string };
    const ledger = service.createEvalLedger(method.methodId, [
      { caseId: 's1', category: 'standard_success', passed: true },
      { caseId: 's2', category: 'standard_success', passed: true },
      { caseId: 's3', category: 'boundary_escalation', passed: false },
      { caseId: 'p1', category: 'standard_success', passed: true },
      { caseId: 'p2', category: 'standard_success', passed: true },
      { caseId: 'p3', category: 'boundary_escalation', passed: true },
      { caseId: 'p4', category: 'conflict_counterexample', passed: true },
      { caseId: 'p5', category: 'conflict_counterexample', passed: false },
    ]);
    expect(service.checkSmokeGate(ledger.evalId)).toBe(true);
    expect(service.checkPromotionGate(ledger.evalId)).toBe(true);
    const snap = service.snapshot();
    expect(snap.episodes).toBe(1);
    expect(snap.methods).toBe(1);
    expect(snap.evals).toBe(1);
  });
});
