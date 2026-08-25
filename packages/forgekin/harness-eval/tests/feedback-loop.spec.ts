/**
 * @flowforge/forgekin-harness-eval — 外环质量门控验证（feedback-loop）。
 *
 * 对齐 Python `harness/feedback_loop.py`：
 *   - 三模式：skip 自动通过 / lightweight 启发式 / full 4 维评分
 *   - 分类门 PASS/CONDITIONAL/FAIL + FAIL 降级 partial + quality_warning
 *   - 数据富集短内容自动 PASS（P0-22）
 *   - 内容提取优先级 report > content（P0-29）
 *   - LLM 客户端注入与响应解析
 *
 * @module @flowforge/forgekin-harness-eval/tests
 */

import { describe, expect, it } from 'vitest';
import {
  buildCombinedPrompt,
  extractContent,
  extractJson,
  FeedbackLoop,
  hasSubstantialData,
  heuristicGate,
  heuristicScores,
  parseScoringResponse,
  type FeedbackJudgeClient,
} from '../src/feedback-loop.js';
import { ClassificationGate, EvaluationMode } from '../src/types.js';

describe('extractContent（P0-29 字段优先级）', () => {
  it('report 优先于 content', () => {
    expect(extractContent({ content: 'short', report: 'long report here' })).toBe('long report here');
  });

  it('嵌套 dict 提取（外层键命中后递归子字段）', () => {
    expect(extractContent({ response: { output: 'nested output' } })).toBe('nested output');
  });

  it('空结果 → 空串', () => {
    expect(extractContent({})).toBe('');
  });
});

describe('hasSubstantialData（P0-22 数据富集）', () => {
  it('records 数组 → true', () => {
    expect(hasSubstantialData({ records: [{ a: 1 }] })).toBe(true);
  });

  it('长字符串字段 → true', () => {
    expect(hasSubstantialData({ report: 'x'.repeat(200) })).toBe(true);
  });

  it('仅短 content → false', () => {
    expect(hasSubstantialData({ content: 'hi' })).toBe(false);
  });
});

describe('heuristicScores / heuristicGate（无 LLM 回退）', () => {
  it('4 维分数：长内容 + 结构 + 段落', () => {
    const scores = heuristicScores('# Title\n\nparagraph one\n\nparagraph two\n\n'.repeat(10));
    expect(scores.correctness).toBe(0.5); // 390 chars ≤ 500（对齐 feedback_loop.py）
    expect(scores.completeness).toBe(0.5);
    expect(scores.coherence).toBe(0.5);
    expect(scores.safety).toBe(0.7);
  });

  it('失败指示词 → CONDITIONAL', () => {
    expect(heuristicGate('I cannot complete this task because of a missing dependency')).toBe(
      ClassificationGate.CONDITIONAL,
    );
  });

  it('短内容 → CONDITIONAL', () => {
    expect(heuristicGate('done')).toBe(ClassificationGate.CONDITIONAL);
  });

  it('重复内容 → FAIL', () => {
    const repetitive = `${'same words here '.repeat(30)}${'same words here '.repeat(30)}`;
    expect(heuristicGate(repetitive)).toBe(ClassificationGate.FAIL);
  });

  it('正常长内容 → PASS', () => {
    const normal = Array.from({ length: 40 }, (_, i) => `word${i} token`).join(' ');
    expect(heuristicGate(normal)).toBe(ClassificationGate.PASS);
  });
});

describe('FeedbackLoop.evaluate', () => {
  it('skip 模式 → 自动 PASS 不计数', async () => {
    const loop = new FeedbackLoop({ evaluationMode: EvaluationMode.SKIP });
    const out = await loop.evaluate({ content: 'anything' });
    expect(out.feedback?.gate).toBe(ClassificationGate.PASS);
    expect(out.feedback?.reason).toBe('skip');
    expect(loop.getStatus().evaluationCount).toBe(0);
  });

  it('短内容无实质数据 → FAIL 降级 partial + quality_warning', async () => {
    const loop = new FeedbackLoop();
    const out = await loop.evaluate({ content: 'too short' });
    expect(out.feedback?.gate).toBe(ClassificationGate.FAIL);
    expect(out.feedback?.action).toBe('downgraded');
    expect(out.status).toBe('partial');
    expect(out.quality_warning).toBe(true);
  });

  it('短内容但有实质数据 → 自动 PASS（P0-22）', async () => {
    const loop = new FeedbackLoop();
    const out = await loop.evaluate({ content: 'short', records: [{ k: 1 }] });
    expect(out.feedback?.gate).toBe(ClassificationGate.PASS);
    expect(out.feedback?.reason).toBe('data_rich_short_content_auto_pass');
    expect(out.status).toBeUndefined();
  });

  it('lightweight 启发式：正常长内容 → PASS', async () => {
    const loop = new FeedbackLoop();
    const content = Array.from({ length: 40 }, (_, i) => `word${i} token`).join(' ');
    const out = await loop.evaluate({ content });
    expect(out.feedback?.gate).toBe(ClassificationGate.PASS);
  });

  it('full 模式（无 LLM）→ 启发式 4 维评分 + 分类', async () => {
    const loop = new FeedbackLoop({ evaluationMode: EvaluationMode.FULL });
    const content = `# T\n\n${Array.from({ length: 30 }, (_, i) => `paragraph ${i} with enough words here`).join('\n\n')}`;
    const out = await loop.evaluate({ content });
    expect(out.feedback?.mode).toBe(EvaluationMode.FULL);
    expect(out.feedback?.scores).toBeDefined();
    expect(Object.keys(out.feedback?.scores ?? {})).toHaveLength(4);
  });

  it('LLM 客户端注入：lightweight 用 LLM 判定', async () => {
    let called = 0;
    const client: FeedbackJudgeClient = {
      judge: async () => {
        called += 1;
        return '{"overall_score": 0.9, "dimension_scores": {"correctness": 0.9, "completeness": 0.9, "coherence": 0.9, "safety": 0.9}, "issues": [], "recommendations": []}';
      },
    };
    const loop = new FeedbackLoop({ llmClient: client });
    const content = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const out = await loop.evaluate({ content });
    expect(called).toBe(1);
    expect(out.feedback?.gate).toBe(ClassificationGate.PASS);
  });

  it('LLM 返回低分 → FAIL 降级', async () => {
    const client: FeedbackJudgeClient = {
      judge: async () => '{"overall_score": 0.2, "dimension_scores": {"correctness": 0.2, "completeness": 0.2, "coherence": 0.2, "safety": 0.2}, "issues": ["bad"], "recommendations": []}',
    };
    const loop = new FeedbackLoop({ llmClient: client });
    const content = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const out = await loop.evaluate({ content });
    expect(out.feedback?.gate).toBe(ClassificationGate.FAIL);
    expect(out.quality_warning).toBe(true);
  });

  it('门计数统计', async () => {
    const loop = new FeedbackLoop();
    await loop.evaluate({ content: 'short' }); // FAIL
    await loop.evaluate({ content: 'short', records: [1] }); // PASS (data-rich)
    const status = loop.getStatus();
    expect(status.evaluationCount).toBe(2);
    expect(status.gateCounts[ClassificationGate.FAIL]).toBe(1);
    expect(status.gateCounts[ClassificationGate.PASS]).toBe(1);
  });
});

describe('parseScoringResponse / extractJson', () => {
  it('```json 围栏提取', () => {
    expect(extractJson('x\n```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('裸 JSON 提取', () => {
    expect(extractJson('prefix {"a": 1} suffix')).toBe('{"a": 1}');
  });

  it('无 JSON → null', () => {
    expect(extractJson('no json here')).toBeNull();
  });

  it('解析维度分数夹取 [0,1]', () => {
    const parsed = parseScoringResponse('{"overall_score": 1.5, "dimension_scores": {"correctness": -1, "completeness": 0.7, "coherence": 0.5, "safety": 0.5}, "issues": ["x"], "recommendations": ["y"]}');
    expect(parsed.overall_score).toBe(1);
    expect(parsed.dimension_scores.correctness).toBe(0);
    expect(parsed.issues).toEqual(['x']);
  });

  it('解析失败 → 兜底 0.5', () => {
    const parsed = parseScoringResponse('not json');
    expect(parsed.overall_score).toBe(0.5);
    expect(parsed.issues).toContain('Failed to parse judge response');
  });
});

describe('buildCombinedPrompt', () => {
  it('包含内容与 JSON 指令', () => {
    const prompt = buildCombinedPrompt('hello');
    expect(prompt).toContain('hello');
    expect(prompt).toContain('overall_score');
  });
});
