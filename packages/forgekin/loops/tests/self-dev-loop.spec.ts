/**
 * SelfDevLoopBase — T7.7 五步循环框架核心验证。
 *
 * 覆盖：
 * - I1 觉醒阶门控（doc=E3 / code=E4 / framework=E5 边界 + 覆盖）
 * - I2 Scope Guard 前置检查（VISION/CONTRIBUTING/SOP/decisions 不可变 + decisions create 特例 + step 级检查）
 * - I3 Reflect 重试上限 3 次（runOnce 失败路径）
 * - I4 LLM 审核（解析 / 失败降级 / 非 JSON）
 * - persist 三模式沉淀（episode_card / distill_episode / create_proposal）
 * - runOnce 五步循环成功路径 + I2 阻断 + I1 门控
 *
 * @module @flowforge/forgekin-loops/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AwakeningStageBlockedError,
  ScopeGuardBlockedError,
} from '../src/errors.js';
import {
  makeDevPlan,
  makeDevResult,
  makeDevTask,
  makeLoopExecutionRecord,
} from '../src/models.js';
import {
  SelfDevDocLoop,
} from '../src/loops/doc-loop.js';
import { SelfDevCodeLoop } from '../src/loops/code-loop.js';
import { SelfDevFrameworkLoop } from '../src/loops/framework-loop.js';
import { NoopPersistEngine } from '../src/types.js';
import {
  FakeLlmChatClient,
  goodDocContent,
  reviewFailJson,
  reviewPassJson,
  writePlanJson,
} from './fake-llm.js';

let root: string;
let llm: FakeLlmChatClient;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forgekin-loops-'));
  llm = new FakeLlmChatClient();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeDocLoop(stage = 'E3', persistEngine?: NoopPersistEngine): SelfDevDocLoop {
  return new SelfDevDocLoop({
    llmClient: llm,
    forgekinConfig: { projectRoot: root },
    persistEngine,
    awakeningStage: stage,
  });
}

describe('I1 觉醒阶门控', () => {
  it('doc 闭环：E3 通过、E2 阻止', () => {
    const loop = makeDocLoop('E3');
    expect(() => loop.checkAwakeningStage()).not.toThrow();
    expect(() => makeDocLoop('E2').checkAwakeningStage()).toThrow(AwakeningStageBlockedError);
  });

  it('code 闭环：E4 通过、E3 阻止（消息含闭环名与要求阶）', () => {
    const loop = new SelfDevCodeLoop({
      llmClient: llm,
      forgekinConfig: { projectRoot: root },
      awakeningStage: 'E4',
    });
    expect(() => loop.checkAwakeningStage()).not.toThrow();
    const blocked = new SelfDevCodeLoop({
      llmClient: llm,
      forgekinConfig: { projectRoot: root },
      awakeningStage: 'E3',
    });
    expect(() => blocked.checkAwakeningStage()).toThrow(/code.*E4/);
  });

  it('framework 闭环：E5 通过、E4 阻止', () => {
    const ok = new SelfDevFrameworkLoop({ llmClient: llm, forgekinConfig: { projectRoot: root }, awakeningStage: 'E5' });
    expect(() => ok.checkAwakeningStage()).not.toThrow();
    const blocked = new SelfDevFrameworkLoop({ llmClient: llm, forgekinConfig: { projectRoot: root }, awakeningStage: 'E4' });
    expect(() => blocked.checkAwakeningStage()).toThrow(AwakeningStageBlockedError);
  });

  it('未知阶位 → 阻止', () => {
    const loop = makeDocLoop('E9');
    expect(() => loop.checkAwakeningStage()).toThrow(AwakeningStageBlockedError);
  });
});

describe('I2 Scope Guard 前置检查', () => {
  it('VISION.md / CONTRIBUTING.md / SOP.md 任何修改 → 阻止', () => {
    const loop = makeDocLoop();
    const task = makeDevTask({ loopType: 'doc', targetPath: 'VISION.md', modificationType: 'update', description: 'x' });
    const plan = makeDevPlan({ taskId: task.taskId, steps: [], expectedEffect: '', riskAssessment: 'low' });
    expect(() => loop.preActScopeGuardCheck(task, plan)).toThrow(ScopeGuardBlockedError);
    expect(() => loop.preActScopeGuardCheck(
      makeDevTask({ loopType: 'doc', targetPath: 'CONTRIBUTING.md', modificationType: 'update', description: 'x' }),
      plan,
    )).toThrow(ScopeGuardBlockedError);
  });

  it('decisions/ 更新阻止，但 create 特例放行（新增 ADR）', () => {
    const loop = makeDocLoop();
    const plan = makeDevPlan({ taskId: 't1', steps: [], expectedEffect: '', riskAssessment: 'low' });
    expect(() => loop.preActScopeGuardCheck(
      makeDevTask({ loopType: 'framework', targetPath: 'docs/decisions/0001-x.md', modificationType: 'update', description: 'x' }),
      plan,
    )).toThrow(/decisions/);
    expect(() => loop.preActScopeGuardCheck(
      makeDevTask({ loopType: 'framework', targetPath: 'docs/decisions/0002-y.md', modificationType: 'create', description: 'x' }),
      plan,
    )).not.toThrow();
  });

  it('plan.steps 中受保护路径 → 阻止；create_adr action 特例放行', () => {
    const loop = makeDocLoop();
    const task = makeDevTask({ loopType: 'doc', targetPath: 'docs/guide.md', modificationType: 'update', description: 'x' });
    expect(() => loop.preActScopeGuardCheck(task, makeDevPlan({
      taskId: task.taskId,
      steps: [{ action: 'write_file', path: 'SOP.md', content: 'x' }],
      expectedEffect: '',
      riskAssessment: 'low',
    }))).toThrow(ScopeGuardBlockedError);
    expect(() => loop.preActScopeGuardCheck(task, makeDevPlan({
      taskId: task.taskId,
      steps: [{ action: 'create_adr', path: 'docs/decisions/0003-z.md', content: 'x' }],
      expectedEffect: '',
      riskAssessment: 'low',
    }))).not.toThrow();
  });
});

describe('I4 LLM 审核', () => {
  it('解析 passed/score/issues/suggestions', async () => {
    llm.queue.push(reviewPassJson);
    const result = await makeDocLoop().llmReviewContent('some content', 'doc');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.95);
    expect(result.issues).toEqual([]);
    expect(result.suggestions).toEqual(['无需修改']);
  });

  it('LLM 调用失败 → passed false + 失败原因', async () => {
    llm.failNext();
    const result = await makeDocLoop().llmReviewContent('content', 'code');
    expect(result.passed).toBe(false);
    expect((result.issues as string[]).join(' ')).toContain('调用失败');
  });

  it('非 JSON 响应 → passed false（解析失败）', async () => {
    llm.queue.push('这不是 JSON');
    const result = await makeDocLoop().llmReviewContent('content', 'doc');
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(['审核响应解析失败']);
  });
});

describe('persist 治理层三模式沉淀', () => {
  it('未注入 persistEngine → skipped 标记，不抛错', async () => {
    const loop = makeDocLoop();
    const record = makeLoopExecutionRecord({
      loopType: 'doc',
      task: makeDevTask({ loopType: 'doc', targetPath: 'docs/x.md', modificationType: 'create', description: 'x' }),
    });
    const payload = await loop.persist(record);
    expect(payload.skipped).toBe(true);
    expect(record.persisted).toBe(false);
  });

  it('成功记录 → create_episode_card + distill_episode（method_id）', async () => {
    const engine = new NoopPersistEngine();
    const loop = makeDocLoop('E3', engine);
    const record = makeLoopExecutionRecord({
      loopType: 'doc',
      task: makeDevTask({ loopType: 'doc', targetPath: 'docs/x.md', modificationType: 'create', description: 'x' }),
      finalPassed: true,
      resultsHistory: [makeDevResult({
        planId: 'p1',
        changedFiles: ['docs/x.md'],
        diffSummary: 'write docs/x.md (12 chars)',
        success: true,
      })],
    });
    const payload = await loop.persist(record);
    const actions = engine.calls.map((c) => c.action);
    expect(actions).toEqual(['create_episode_card', 'distill_episode']);
    expect(payload.episodeId).toMatch(/^ep-/);
    expect(payload.methodId).toMatch(/^method-/);
    expect(record.persisted).toBe(true);
    expect(engine.calls[0]?.payload.transferableMethod).toContain('doc 闭环');
  });

  it('失败记录 → 仅 create_episode_card（不蒸馏）', async () => {
    const engine = new NoopPersistEngine();
    const loop = makeDocLoop('E3', engine);
    const record = makeLoopExecutionRecord({
      loopType: 'doc',
      task: makeDevTask({ loopType: 'doc', targetPath: 'docs/x.md', modificationType: 'create', description: 'x' }),
      finalPassed: false,
    });
    await loop.persist(record);
    expect(engine.calls.map((c) => c.action)).toEqual(['create_episode_card']);
  });

  it('Reflect ≥2 次 → create_proposal（流程改进提案）', async () => {
    const engine = new NoopPersistEngine();
    const loop = makeDocLoop('E3', engine);
    const record = makeLoopExecutionRecord({
      loopType: 'doc',
      task: makeDevTask({ loopType: 'doc', targetPath: 'docs/x.md', modificationType: 'create', description: 'x' }),
      finalPassed: true,
      reflectCount: 2,
    });
    await loop.persist(record);
    const actions = engine.calls.map((c) => c.action);
    expect(actions).toContain('create_proposal');
    const proposal = engine.calls.find((c) => c.action === 'create_proposal');
    expect(proposal?.payload.triggerType).toBe('repeated_error');
  });
});

describe('runOnce 五步循环', () => {
  it('成功路径：Discover→Plan→Act→Verify→Persist，summary.passed=1', async () => {
    const engine = new NoopPersistEngine();
    const loop = makeDocLoop('E3', engine);
    llm.queue.push(writePlanJson('docs/guide.md', goodDocContent)); // plan
    llm.queue.push(reviewPassJson); // verify llm_review

    const result = await loop.runOnce({ force_targets: ['docs/guide.md'] });

    expect(result.loopType).toBe('doc');
    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0, reflectTotal: 0 });
    expect(result.records[0]?.finalPassed).toBe(true);
    expect(result.records[0]?.reflectCount).toBe(0);
    // Act 实际写入了文件
    const written = await fs.readFile(path.join(root, 'docs/guide.md'), 'utf-8');
    expect(written).toBe(goodDocContent);
    // Persist 已执行（成功 → 蒸馏）
    expect(engine.calls.some((c) => c.action === 'distill_episode')).toBe(true);
    expect(llm.pending).toBe(0);
  });

  it('LLM plan 返回 ```json 代码块 → 宽松解析成功', async () => {
    const loop = makeDocLoop();
    llm.queue.push(`\`\`\`json\n${writePlanJson('docs/blk.md', goodDocContent)}\n\`\`\``);
    llm.queue.push(reviewPassJson);
    const result = await loop.runOnce({ force_targets: ['docs/blk.md'] });
    expect(result.summary.passed).toBe(1);
  });

  it('失败路径：Verify 失败后 I3 Reflect 重试 ≤3 次，仍失败 → failed + reflectTotal=3', async () => {
    const loop = makeDocLoop();
    // 1 plan（无 front-matter）+ 1 verify fail + 3×(reflect + verify fail)
    llm.queue.push(writePlanJson('docs/bad.md', '# 无 front-matter 的文档'));
    llm.queue.push(reviewFailJson);
    for (let i = 0; i < 3; i += 1) {
      llm.queue.push(writePlanJson(`docs/bad-${i}.md`, '# 仍然没有 front-matter'));
      llm.queue.push(reviewFailJson);
    }

    const result = await loop.runOnce({ force_targets: ['docs/bad.md'] });

    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1, reflectTotal: 3 });
    const record = result.records[0];
    expect(record?.finalPassed).toBe(false);
    expect(record?.reflectCount).toBe(3);
    expect(record?.plansHistory).toHaveLength(4); // 初始 + 3 次反思
    expect(record?.verifiesHistory).toHaveLength(4);
  });

  it('I2 阻断：force_targets 指向 VISION.md → failed 记录（不抛错）', async () => {
    const loop = makeDocLoop();
    llm.queue.push('{}'); // plan 仍被调用，随后 scope guard 阻止
    const result = await loop.runOnce({ force_targets: ['VISION.md'] });
    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1, reflectTotal: 0 });
    expect(result.records[0]?.finalPassed).toBe(false);
  });

  it('I1 门控：awakening_stage 覆盖为 E2 → 直接抛 AwakeningStageBlockedError', async () => {
    const loop = makeDocLoop('E3');
    await expect(loop.runOnce({ force_targets: ['docs/a.md'], awakening_stage: 'E2' }))
      .rejects.toThrow(AwakeningStageBlockedError);
  });

  it('无任务（discover 空）→ 空记录 + total 0', async () => {
    const loop = makeDocLoop();
    const result = await loop.runOnce({});
    expect(result.summary).toEqual({ total: 0, passed: 0, failed: 0, reflectTotal: 0 });
    expect(result.records).toEqual([]);
  });
});
