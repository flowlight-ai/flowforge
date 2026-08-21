/**
 * SelfDevDocLoop — T7.7 文档自我演进闭环子类验证。
 *
 * 覆盖：
 * - discover：force_targets 定向 / stale 过期检测 / format 格式问题 / features→design 缺失检测
 * - act：write_file / update_section / append 三动作
 * - verify：front-matter 缺失失败 / 标题层级过深失败 / 正常通过
 *
 * @module @flowforge/forgekin-loops/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SelfDevDocLoop } from '../src/loops/doc-loop.js';
import { makeDevPlan } from '../src/models.js';
import { FakeLlmChatClient, goodDocContent, reviewPassJson } from './fake-llm.js';

let root: string;
let llm: FakeLlmChatClient;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forgekin-doc-'));
  llm = new FakeLlmChatClient();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeLoop(): SelfDevDocLoop {
  return new SelfDevDocLoop({ llmClient: llm, forgekinConfig: { projectRoot: root }, awakeningStage: 'E3' });
}

describe('discover 任务发现', () => {
  it('force_targets 定向更新（跳过扫描，priority high）', async () => {
    const tasks = await makeLoop().discover({ force_targets: ['docs/a.md', 'docs/b.md'] });
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.modificationType).toBe('update');
    expect(tasks[0]?.context.source).toBe('force_targets');
  });

  it('stale 检测：mtime 超过 max_age_days → 过期任务', async () => {
    const target = path.join(root, 'docs', 'old.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '# 旧文档', 'utf-8');
    const past = new Date(Date.now() - 91 * 86400000);
    await fs.utimes(target, past, past);

    const tasks = await makeLoop().discover({ max_age_days: 90 });
    const stale = tasks.find((t) => t.context.source === 'stale_detect');
    expect(stale).toBeDefined();
    expect(stale?.targetPath).toBe('docs/old.md');
  });

  it('format 检测：docs/ 下缺 front-matter → 格式任务', async () => {
    const target = path.join(root, 'docs', 'bad.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '# 标题\n无 front-matter', 'utf-8');

    const tasks = await makeLoop().discover({});
    const format = tasks.find((t) => t.context.source === 'format_check');
    expect(format).toBeDefined();
    expect(format?.description).toContain('front-matter');
  });

  it('missing 检测：features/F001-x.md 存在但 design/D001-x.md 缺失 → create 任务', async () => {
    const featDir = path.join(root, 'docs', 'features');
    await fs.mkdir(featDir, { recursive: true });
    await fs.writeFile(path.join(featDir, 'F001-hello.md'), '# F001', 'utf-8');

    const tasks = await makeLoop().discover({});
    const missing = tasks.find((t) => t.context.source === 'missing_detect');
    expect(missing).toBeDefined();
    expect(missing?.targetPath).toBe('docs/design/D001-hello.md');
    expect(missing?.modificationType).toBe('create');
  });
});

describe('act 文档修改', () => {
  it('write_file 创建新文档（含目录）', async () => {
    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'write_file', path: 'docs/new.md', content: goodDocContent }],
      expectedEffect: '创建',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.success).toBe(true);
    expect(result.changedFiles).toEqual(['docs/new.md']);
    expect(await fs.readFile(path.join(root, 'docs/new.md'), 'utf-8')).toBe(goodDocContent);
  });

  it('update_section 替换既有章节（未找到章节时追加）', async () => {
    const target = path.join(root, 'docs', 'sec.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '# 文档\n\n## 旧章节\n旧内容\n', 'utf-8');

    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'update_section', path: 'docs/sec.md', section: '旧章节', content: '新内容' }],
      expectedEffect: '更新章节',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.success).toBe(true);
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toContain('## 旧章节\n新内容');
    expect(content).not.toContain('旧内容');
  });

  it('append 追加内容', async () => {
    const target = path.join(root, 'docs', 'app.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '# 标题\n', 'utf-8');

    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'append', path: 'docs/app.md', content: '追加段' }],
      expectedEffect: '追加',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.success).toBe(true);
    expect(await fs.readFile(target, 'utf-8')).toContain('追加段');
  });

  it('未知 action → skip 不失败', async () => {
    const loop = makeLoop();
    const plan = makeDevPlan({
      taskId: 't1',
      steps: [{ action: 'explode', path: 'docs/x.md', content: 'x' }],
      expectedEffect: '',
      riskAssessment: 'low',
    });
    const result = await loop.act(plan);
    expect(result.success).toBe(true);
    expect(result.diffSummary).toContain('skip unknown action');
  });
});

describe('verify 文档验证', () => {
  it('docs/ 下缺少 front-matter → 验证失败', async () => {
    const target = path.join(root, 'docs', 'bad.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '# 标题\n无 front-matter', 'utf-8');

    const loop = makeLoop();
    llm.queue.push(reviewPassJson);
    const result = await loop.verify({
      resultId: 'r1', planId: 'p1', changedFiles: ['docs/bad.md'],
      diffSummary: 'x', success: true, errorMessage: '', elapsedMs: 0, createdAt: new Date().toISOString(),
    });
    expect(result.passed).toBe(false);
    expect(result.failureReasons.join(' ')).toContain('front-matter');
  });

  it('首个标题层级过深（###）→ 验证失败', async () => {
    const target = path.join(root, 'docs', 'deep.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '---\ntype: doc\n---\n### 三级标题', 'utf-8');

    const loop = makeLoop();
    llm.queue.push(reviewPassJson);
    const result = await loop.verify({
      resultId: 'r1', planId: 'p1', changedFiles: ['docs/deep.md'],
      diffSummary: 'x', success: true, errorMessage: '', elapsedMs: 0, createdAt: new Date().toISOString(),
    });
    expect(result.passed).toBe(false);
    expect(result.failureReasons.join(' ')).toContain('标题层级');
  });

  it('合规文档 + LLM 审核通过 → 验证通过', async () => {
    const target = path.join(root, 'docs', 'ok.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, goodDocContent, 'utf-8');

    const loop = makeLoop();
    llm.queue.push(reviewPassJson);
    const result = await loop.verify({
      resultId: 'r1', planId: 'p1', changedFiles: ['docs/ok.md'],
      diffSummary: 'x', success: true, errorMessage: '', elapsedMs: 0, createdAt: new Date().toISOString(),
    });
    expect(result.passed).toBe(true);
    expect(result.llmReviewPassed).toBe(true);
  });
});
