/**
 * SelfDevTestLoop — T7.7 自动化测试自我演进闭环子类验证。
 *
 * 覆盖：
 * - discover：target_files（源码→tests/ 推断）/ test_failure / coverage_gap
 * - act I10：已有测试文件 write_file 自动改 append（不覆盖）
 * - T1-T8 铁律检查（Mock LLM / 假数据 / 模糊断言 / T7 审核缺失 → 警告）
 * - verify：T 规则复查
 *
 * @module @flowforge/forgekin-loops/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SelfDevTestLoop } from '../src/loops/test-loop.js';
import { makeDevPlan } from '../src/models.js';
import { FakeLlmChatClient } from './fake-llm.js';

let root: string;
let llm: FakeLlmChatClient;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forgekin-test-'));
  llm = new FakeLlmChatClient();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeLoop(): SelfDevTestLoop {
  return new SelfDevTestLoop({ llmClient: llm, forgekinConfig: { projectRoot: root }, awakeningStage: 'E3' });
}

describe('discover 任务发现', () => {
  it('target_files：源码路径 → tests/<name>.spec.ts 推断', async () => {
    const tasks = await makeLoop().discover({ target_files: ['src/user-service.ts'] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetPath).toBe('tests/user-service.spec.ts');
    expect(tasks[0]?.modificationType).toBe('create');
    expect(tasks[0]?.context.source).toBe('target_files');
  });

  it('test_failure：FAILED 行 → 测试文件修复任务（critical）', async () => {
    const tasks = await makeLoop().discover({
      task_source: 'test_failure',
      pytest_output: 'FAILED tests/test_login.py::test_ok - AssertionError\n',
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetPath).toBe('tests/test_login.py');
    expect(tasks[0]?.priority).toBe('critical');
    expect(tasks[0]?.context.testName).toBe('test_ok');
  });

  it('coverage_gap：指定源文件 → 补覆盖任务', async () => {
    const tasks = await makeLoop().discover({ task_source: 'coverage_gap', source_file: 'src/order.ts' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetPath).toBe('tests/order.spec.ts');
  });
});

describe('act I10 不覆盖已有测试', () => {
  it('write_file 命中已有测试文件 → 自动改 append（原内容保留）', async () => {
    const target = path.join(root, 'tests', 'existing.spec.ts');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '// 原有用例\n', 'utf-8');

    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'write_file', path: 'tests/existing.spec.ts', content: '// 新用例\n' }],
      expectedEffect: '追加',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.success).toBe(true);
    expect(result.diffSummary).toContain('append');
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toContain('// 原有用例');
    expect(content).toContain('// 新用例');
  });

  it('write_file 命中不存在文件 → 正常创建', async () => {
    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'write_file', path: 'tests/new.spec.ts', content: 'it("x", () => {})\n' }],
      expectedEffect: '创建',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.success).toBe(true);
    expect(result.diffSummary).toContain('write');
    expect(await fs.readFile(path.join(root, 'tests/new.spec.ts'), 'utf-8')).toContain('it(');
  });
});

describe('T1-T8 测试铁律检查（警告不阻止）', () => {
  it('检测 Mock LLM / 假数据 / 模糊断言 → T 铁律警告', async () => {
    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{
        action: 'write_file',
        path: 'tests/quality.py',
        content: "mock(LLMClient)\nassert 'hello' in resp\nassert status in ('completed', 'error')\n",
      }],
      expectedEffect: '低质量测试',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.success).toBe(true); // 仅警告
    expect(result.diffSummary).toContain('T 铁律警告');
    expect(result.diffSummary).toContain('T1');
    expect(result.diffSummary).toContain('T2');
    expect(result.diffSummary).toContain('T3');
  });

  it('涉及 LLM 的测试未调用 llm_review_content → T7 警告', async () => {
    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{
        action: 'write_file',
        path: 'tests/llm_use.py',
        content: 'client = LLMClient()\nresult = client.chat(...)\n',
      }],
      expectedEffect: '',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.diffSummary).toContain('T7 违规');
  });

  it('合规测试（.ts 后缀 + 具体断言 + 调用审核）→ 无警告', async () => {
    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{
        action: 'write_file',
        path: 'tests/good.spec.ts',
        content: 'expect(sum(1, 2)).toBe(3);\n',
      }],
      expectedEffect: '',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.success).toBe(true);
    expect(result.diffSummary).not.toContain('T 铁律警告');
  });
});

describe('verify 测试验证', () => {
  it('测试文件含 T1 违规 → verify 失败', async () => {
    const target = path.join(root, 'tests', 'bad.py');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'mock(LLMClient)\nassert result is not None\n', 'utf-8');

    llm.queue.push('{"passed": true, "score": 0.9, "issues": [], "suggestions": []}');
    const result = await makeLoop().verify({
      resultId: 'r1', planId: 'p1', changedFiles: ['tests/bad.py'],
      diffSummary: 'x', success: true, errorMessage: '', elapsedMs: 0, createdAt: new Date().toISOString(),
    });
    expect(result.passed).toBe(false);
    expect(result.failureReasons.join(' ')).toContain('T 铁律违规');
  });
});
