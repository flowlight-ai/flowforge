/**
 * SelfDevFrameworkLoop — T7.7 框架自我演进闭环子类验证。
 *
 * 覆盖：
 * - discover：architecture_drift（superseded ADR）/ config_inconsistency（TODO 占位）/ dependency_graph
 * - plan：requiresApproval 恒 true（I8）
 * - act I8：无 approval callback / callback 拒绝 → ApprovalRequiredError；批准 → 写入
 * - verify：ADR front-matter 缺失失败
 *
 * @module @flowforge/forgekin-loops/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalRequiredError } from '../src/errors.js';
import { SelfDevFrameworkLoop } from '../src/loops/framework-loop.js';
import { makeDevPlan } from '../src/models.js';
import { ForgekinConfig } from '../src/self-dev-loop.js';
import { FakeLlmChatClient } from './fake-llm.js';

let root: string;
let llm: FakeLlmChatClient;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forgekin-fw-'));
  llm = new FakeLlmChatClient();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeLoop(approvalCallback?: unknown): SelfDevFrameworkLoop {
  const config: ForgekinConfig = approvalCallback === undefined
    ? { projectRoot: root }
    : { projectRoot: root, approval_callback: approvalCallback };
  return new SelfDevFrameworkLoop({
    llmClient: llm,
    forgekinConfig: config,
    awakeningStage: 'E5',
  });
}

describe('discover 任务发现', () => {
  it('architecture_drift：ADR 含 status: superseded → 任务', async () => {
    const adrDir = path.join(root, 'docs', 'decisions');
    await fs.mkdir(adrDir, { recursive: true });
    await fs.writeFile(path.join(adrDir, 'ADR-001.md'), '---\nstatus: superseded\n---\n# 旧决策\n', 'utf-8');

    const tasks = await makeLoop().discover({ task_source: 'architecture_drift' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetPath).toBe('docs/decisions/ADR-001.md');
    expect(tasks[0]?.priority).toBe('high');
  });

  it('config_inconsistency：根目录 YAML 含 TODO → 任务', async () => {
    await fs.writeFile(path.join(root, 'config.yaml'), 'server:\n  port: 8080 # TODO 确认端口\n', 'utf-8');
    const tasks = await makeLoop().discover({ task_source: 'config_inconsistency' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetPath).toBe('config.yaml');
  });

  it('dependency_graph：monorepo workspaces → 低优先级检查任务', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{"workspaces": ["packages/*"]}', 'utf-8');
    const tasks = await makeLoop().discover({ task_source: 'dependency_graph' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.priority).toBe('low');
  });
});

describe('plan（I8 requiresApproval 强制）', () => {
  it('LLM 未返回 requires_approval 也强制 true', async () => {
    llm.queue.push('{"steps": [{"action": "update_yaml", "path": "config.yaml", "content": "a: 1"}], "expected_effect": "调整", "risk_assessment": "medium"}');
    const task = { taskId: 't1', loopType: 'framework', targetPath: 'config.yaml', modificationType: 'update', description: 'x', priority: 'high', context: {}, createdAt: new Date().toISOString() };
    const plan = await makeLoop().plan(task);
    expect(plan.requiresApproval).toBe(true);
  });
});

describe('act I8 approval 强制', () => {
  it('未配置 approval callback → ApprovalRequiredError', async () => {
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'update_yaml', path: 'config.yaml', content: 'a: 1' }],
      expectedEffect: '',
      riskAssessment: 'high',
      requiresApproval: true,
    });
    await expect(makeLoop().act(plan)).rejects.toThrow(ApprovalRequiredError);
  });

  it('callback 拒绝 → ApprovalRequiredError', async () => {
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'update_yaml', path: 'config.yaml', content: 'a: 1' }],
      expectedEffect: '',
      riskAssessment: 'high',
      requiresApproval: true,
    });
    const loop = makeLoop(() => false);
    await expect(loop.act(plan)).rejects.toThrow(/需要 operator 显式批准/);
  });

  it('callback 批准 → 写入文件', async () => {
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'update_yaml', path: 'config.yaml', content: 'server:\n  port: 8080\n' }],
      expectedEffect: '调整配置',
      riskAssessment: 'low',
      requiresApproval: true,
    });
    const loop = makeLoop(() => true);
    const result = await loop.act(plan);
    expect(result.success).toBe(true);
    expect(result.changedFiles).toEqual(['config.yaml']);
    expect(await fs.readFile(path.join(root, 'config.yaml'), 'utf-8')).toContain('server:');
  });

  it('callback 收到 (plan, task) 参数且支持 async', async () => {
    const seen: unknown[] = [];
    const loop = makeLoop(async (p: unknown, t: unknown) => {
      seen.push(p, t);
      return true;
    });
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'create_adr', path: 'docs/decisions/0001-x.md', content: '---\nstatus: proposed\n---\n# 决策' }],
      expectedEffect: '新建 ADR',
      riskAssessment: 'low',
      requiresApproval: true,
    });
    await loop.act(plan);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ planId: plan.planId });
    expect(seen[1]).toMatchObject({ loopType: 'framework' });
  });
});

describe('verify 框架验证', () => {
  it('ADR 缺 front-matter → 验证失败', async () => {
    const adrDir = path.join(root, 'docs', 'decisions');
    await fs.mkdir(adrDir, { recursive: true });
    await fs.writeFile(path.join(adrDir, '0001-x.md'), '# 无 front-matter 的 ADR\n', 'utf-8');

    llm.queue.push('{"passed": true, "score": 0.9, "issues": [], "suggestions": []}');
    const result = await makeLoop().verify({
      resultId: 'r1', planId: 'p1', changedFiles: ['docs/decisions/0001-x.md'],
      diffSummary: 'x', success: true, errorMessage: '', elapsedMs: 0, createdAt: new Date().toISOString(),
    });
    expect(result.passed).toBe(false);
    expect(result.failureReasons.join(' ')).toContain('front-matter');
  });
});
