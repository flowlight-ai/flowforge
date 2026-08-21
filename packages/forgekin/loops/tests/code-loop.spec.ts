/**
 * SelfDevCodeLoop — T7.7 代码自我演进闭环子类验证。
 *
 * 覆盖：
 * - discover：pytest_failure（tests/→src/ 推断）/ task_md 未实现项 / bug_report
 * - act I5：禁止删除测试文件
 * - act I6：直接实例化违规（绕过 DI）
 * - act I7：硬编码路径/密钥/端口违规
 * - verify：guardrails 复查
 *
 * @module @flowforge/forgekin-loops/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SelfDevCodeLoop } from '../src/loops/code-loop.js';
import { makeDevPlan } from '../src/models.js';
import { FakeLlmChatClient } from './fake-llm.js';

let root: string;
let llm: FakeLlmChatClient;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forgekin-code-'));
  llm = new FakeLlmChatClient();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeLoop(): SelfDevCodeLoop {
  return new SelfDevCodeLoop({ llmClient: llm, forgekinConfig: { projectRoot: root }, awakeningStage: 'E4' });
}

describe('discover 任务发现', () => {
  it('pytest_failure：FAILED 行提取 + tests/→src/ 源文件推断', async () => {
    const tasks = await makeLoop().discover({
      task_source: 'pytest_failure',
      pytest_output: 'FAILED tests/test_user.py::test_login - AssertionError\nFAILED tests/test_order.py::test_create - TypeError\n',
    });
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.targetPath).toBe('src/user.py');
    expect(tasks[0]?.priority).toBe('critical');
    expect(tasks[1]?.targetPath).toBe('src/order.py');
    expect(tasks[0]?.context.testName).toBe('test_login');
  });

  it('task_md：读取「未实现」标题行生成实现任务', async () => {
    const taskMd = path.join(root, 'TASK.md');
    await fs.writeFile(taskMd, '# 任务清单\n\n## 1. 用户登录（未实现）\n\n## 2. 已完成项\n', 'utf-8');
    const tasks = await makeLoop().discover({ task_source: 'task_md', task_md_path: 'TASK.md' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.description).toContain('用户登录');
  });

  it('bug_report：每行一个 bug 任务', async () => {
    const tasks = await makeLoop().discover({
      task_source: 'bug_report',
      bug_report: '登录后 session 丢失\n',
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.description).toContain('登录后 session 丢失');
  });
});

describe('act 安全护栏（I5/I6/I7）', () => {
  it('I5：delete 测试文件 → 失败 + 违规信息', async () => {
    const result = await makeLoop().act(makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'delete', path: 'tests/test_user.py' }],
      expectedEffect: '',
      riskAssessment: 'low',
    }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('I5 违规');
  });

  it('I6：直接实例化 TraeLLMClient（无 DI 模式）→ 失败', async () => {
    const result = await makeLoop().act(makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'write_file', path: 'src/client.py', content: 'from flowforge.llm.trae.client import TraeLLMClient\nclient = TraeLLMClient()\n' }],
      expectedEffect: '',
      riskAssessment: 'low',
    }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('I6 违规');
  });

  it('I6：构造注入合法（def __init__ 参数注入 Client）→ 通过', async () => {
    const result = await makeLoop().act(makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'write_file', path: 'src/service.py', content: 'def __init__(self, client: TraeLLMClient):\n    self.client = client\n' }],
      expectedEffect: '',
      riskAssessment: 'low',
    }));
    expect(result.success).toBe(true);
  });

  it('I7：硬编码绝对路径 → 失败', async () => {
    const result = await makeLoop().act(makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'write_file', path: 'src/p.py', content: "path = '/home/user/data'\n" }],
      expectedEffect: '',
      riskAssessment: 'low',
    }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('I7 违规');
  });

  it('I7：硬编码密钥 → 失败', async () => {
    const result = await makeLoop().act(makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'write_file', path: 'src/s.py', content: "api_key = 'sk-abcdef123456'\n" }],
      expectedEffect: '',
      riskAssessment: 'low',
    }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('I7 违规');
  });

  it('合规代码写入成功', async () => {
    const result = await makeLoop().act(makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'write_file', path: 'src/ok.py', content: 'def add(a: int, b: int) -> int:\n    return a + b\n' }],
      expectedEffect: '',
      riskAssessment: 'low',
    }));
    expect(result.success).toBe(true);
    expect(result.changedFiles).toEqual(['src/ok.py']);
    expect(await fs.readFile(path.join(root, 'src/ok.py'), 'utf-8')).toContain('def add');
  });
});

describe('verify guardrails 复查', () => {
  it('文件中含硬编码路径 → guardrails 检查失败', async () => {
    const target = path.join(root, 'src', 'bad.py');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "import os\npath = '/etc/passwd'\n", 'utf-8');

    const result = await makeLoop().verify({
      resultId: 'r1', planId: 'p1', changedFiles: ['src/bad.py'],
      diffSummary: 'x', success: true, errorMessage: '', elapsedMs: 0, createdAt: new Date().toISOString(),
    });
    expect(result.passed).toBe(false);
    expect(result.failureReasons.join(' ')).toContain('安全护栏');
  });
});
