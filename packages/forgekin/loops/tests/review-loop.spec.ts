/**
 * SelfDevReviewLoop — T7.7 审查自我演进闭环子类验证。
 *
 * 覆盖：
 * - I9 no-self-review：厂商映射 + 同厂商/跨厂商判定
 * - discover：target_files 存在 → 任务；不存在 → 跳过
 * - act：生成 docs/reviews/ 审查报告（front-matter + P0-P3 计数）
 * - verify：报告 front-matter + LLM 审核
 *
 * @module @flowforge/forgekin-loops/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SelfDevReviewLoop } from '../src/loops/review-loop.js';
import { makeDevPlan } from '../src/models.js';
import { FakeLlmChatClient } from './fake-llm.js';

let root: string;
let llm: FakeLlmChatClient;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forgekin-review-'));
  llm = new FakeLlmChatClient();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeLoop(reviewerModel = 'claude-3.5-sonnet'): SelfDevReviewLoop {
  return new SelfDevReviewLoop({
    llmClient: llm,
    forgekinConfig: { projectRoot: root, reviewer_model: reviewerModel },
    awakeningStage: 'E3',
  });
}

describe('I9 no-self-review 跨厂商判定', () => {
  it('vendorOf 映射：gpt/claude/gemini/glm 各归其厂', () => {
    const loop = makeLoop();
    expect(loop.vendorOf('gpt-4o')).toBe('openai');
    expect(loop.vendorOf('claude-3-5-sonnet')).toBe('anthropic');
    expect(loop.vendorOf('gemini-2-flash')).toBe('google');
    expect(loop.vendorOf('glm-5')).toBe('zhipu');
    expect(loop.vendorOf('unknown-model')).toBe('unknown');
  });

  it('不同厂商 → sameVendor false（允许审查）', () => {
    const loop = makeLoop('claude-3.5-sonnet');
    expect(loop.checkNoSelfReview('gpt-4o', 'claude-3.5-sonnet')).toEqual({
      sameVendor: false, authorVendor: 'openai', reviewerVendor: 'anthropic',
    });
  });

  it('同厂商（gpt-4 与 gpt-4o）→ sameVendor true（禁止自审）', () => {
    const loop = makeLoop('gpt-4o');
    expect(loop.checkNoSelfReview('gpt-4', 'gpt-4o').sameVendor).toBe(true);
  });

  it('未知模型一律归 unknown → 同厂商', () => {
    const loop = makeLoop('some-custom-model');
    expect(loop.checkNoSelfReview('another-custom', 'some-custom-model').sameVendor).toBe(true);
  });
});

describe('discover 任务发现', () => {
  it('target_files 存在 → 审查任务（携带 author 上下文）', async () => {
    const target = path.join(root, 'src', 'app.py');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'print(1)', 'utf-8');

    const tasks = await makeLoop().discover({
      target_files: ['src/app.py'],
      author_forgekin_id: 'fk-sherlock',
      author_llm_model: 'gpt-4o',
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetPath).toBe('src/app.py');
    expect(tasks[0]?.context.authorLlmModel).toBe('gpt-4o');
  });

  it('文件不存在 → 跳过（无任务）', async () => {
    const tasks = await makeLoop().discover({ target_files: ['src/missing.py'] });
    expect(tasks).toEqual([]);
  });
});

describe('act 生成审查报告', () => {
  it('review_file → 报告写入 docs/reviews/ 且含 front-matter + P0/P1 计数', async () => {
    const target = path.join(root, 'src', 'app.py');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'def f():\n    pass\n', 'utf-8');

    llm.queue.push(JSON.stringify({
      issues: [
        { severity: 'P0', location: 'app.py:1', description: '未处理异常', suggestion: '加 try/except' },
        { severity: 'P1', location: 'app.py:2', description: '命名不规范', suggestion: '改名' },
      ],
      summary: '整体可用，需修复 P0',
      score: 0.6,
    }));

    const loop = makeLoop('claude-3.5-sonnet');
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'review_file', path: 'src/app.py', checklist: ['检查异常处理'] }],
      expectedEffect: '审查',
      riskAssessment: 'low',
      llmModel: 'claude-3.5-sonnet',
    });
    const result = await loop.act(plan);

    expect(result.success).toBe(true);
    expect(result.changedFiles).toHaveLength(1);
    const reportPath = result.changedFiles[0] ?? '';
    expect(reportPath).toMatch(/^docs\/reviews\/.+_app\.py\.md$/);

    const content = await fs.readFile(path.join(root, reportPath), 'utf-8');
    expect(content).toMatch(/^---\s*\n/);
    expect(content).toContain('p0: 1');
    expect(content).toContain('p1: 1');
    expect(content).toContain('### [P0] app.py:1');
    expect(result.diffSummary).toContain('P0=1, P1=1');
  });

  it('LLM 调用失败 → 报告降级为「LLM 调用失败」仍可写入', async () => {
    const target = path.join(root, 'src', 'b.py');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'x = 1\n', 'utf-8');

    llm.failNext();
    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'review_file', path: 'src/b.py', checklist: [] }],
      expectedEffect: '',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.success).toBe(true);
    const reportPath = result.changedFiles[0] ?? '';
    const content = await fs.readFile(path.join(root, reportPath), 'utf-8');
    expect(content).toContain('LLM 调用失败');
  });
});

describe('verify 审查报告验证', () => {
  it('报告存在 + front-matter + LLM 审核通过 → 验证通过', async () => {
    const reportDir = path.join(root, 'docs', 'reviews');
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, '2026-01-01_00-00-00_app.md'), '---\ntype: review_report\n---\n# 审查报告\n', 'utf-8');

    llm.queue.push('{"passed": true, "score": 0.88, "issues": [], "suggestions": []}');
    const result = await makeLoop().verify({
      resultId: 'r1', planId: 'p1', changedFiles: ['docs/reviews/2026-01-01_00-00-00_app.md'],
      diffSummary: 'x', success: true, errorMessage: '', elapsedMs: 0, createdAt: new Date().toISOString(),
    });
    expect(result.passed).toBe(true);
    expect(result.llmReviewPassed).toBe(true);
  });

  it('报告缺 front-matter → 验证失败', async () => {
    const reportDir = path.join(root, 'docs', 'reviews');
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, '2026-01-01_00-00-00_b.md'), '# 无 front-matter\n', 'utf-8');

    const result = await makeLoop().verify({
      resultId: 'r1', planId: 'p1', changedFiles: ['docs/reviews/2026-01-01_00-00-00_b.md'],
      diffSummary: 'x', success: true, errorMessage: '', elapsedMs: 0, createdAt: new Date().toISOString(),
    });
    expect(result.passed).toBe(false);
    expect(result.failureReasons.join(' ')).toContain('front-matter');
  });
});
