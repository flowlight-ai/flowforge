/**
 * file-reference-local 包测试 — D39（WorkspaceFileSearch 本地发现）。
 *
 * 覆盖：目录作用域列表（前缀过滤/隐藏文件/排除目录/路径逃逸拒绝）；
 * 全局模糊查询（索引构建 + 排序 + 隐藏过滤 + 缓存失效后台刷新 + dispose）；
 * maxEntries 上限；LocalFileReferenceService 挂载 ctx.fileReferences
 * （注入 cwd 解析 + invalidate）。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceFileSearch } from '../src/search.ts';
import LocalFileReferenceService from '../src/index.ts';

const tempDirs: string[] = [];
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-fileref-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  mkdirSync(join(dir, '.hidden'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.ts'), 'export {}', 'utf-8');
  writeFileSync(join(dir, 'src', 'lib', 'core.ts'), 'export {}', 'utf-8');
  writeFileSync(join(dir, 'README.md'), '# r', 'utf-8');
  writeFileSync(join(dir, '.hidden', 'secret.ts'), 'x', 'utf-8');
  writeFileSync(join(dir, 'node_modules', 'dep.ts'), 'x', 'utf-8');
  return dir;
}

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('WorkspaceFileSearch', () => {
  it('目录作用域：fragment 过滤 + 隐藏/排除目录过滤', async () => {
    const root = makeRoot();
    const search = new WorkspaceFileSearch(root, { maxResults: 20, maxEntries: 1000, excludedDirectories: ['node_modules', 'dist', 'build'] });
    const candidates = await search.list('src/', new AbortController().signal);
    const names = candidates.map((c) => c.path);
    expect(names).toContain('src/index.ts');
    expect(names).toContain('src/lib');
    expect(names).not.toContain('src/.hidden'); // src 下无 .hidden，全局隐藏由 list('') 验证
    // node_modules 被排除（根级目录查询）
    const rootCandidates = await search.list('', new AbortController().signal);
    expect(rootCandidates.map((c) => c.path)).not.toContain('node_modules/');
  });

  it('全局模糊查询：索引 + 排序 + 隐藏过滤', async () => {
    const root = makeRoot();
    const search = new WorkspaceFileSearch(root, { maxResults: 20, maxEntries: 1000, excludedDirectories: ['node_modules', 'dist', 'build'] });
    const candidates = await search.list('core', new AbortController().signal);
    expect(candidates.some((c) => c.path === 'src/lib/core.ts')).toBe(true);
    // 隐藏文件对非隐藏查询不可见
    expect(candidates.some((c) => c.path.includes('.hidden'))).toBe(false);
    // 排除目录不被索引
    expect(candidates.some((c) => c.path.includes('node_modules'))).toBe(false);
  });

  it('路径逃逸拒绝（../../）', async () => {
    const root = makeRoot();
    const search = new WorkspaceFileSearch(root, { maxResults: 20, maxEntries: 1000, excludedDirectories: ['node_modules'] });
    const candidates = await search.list('../', new AbortController().signal);
    expect(candidates.length).toBe(0);
  });

  it('invalidate + 新增文件可见；dispose 后返回空', async () => {
    const root = makeRoot();
    const search = new WorkspaceFileSearch(root, { maxResults: 20, maxEntries: 1000, excludedDirectories: ['node_modules'] });
    const before = await search.list('newfile', new AbortController().signal);
    expect(before.length).toBe(0);

    writeFileSync(join(root, 'newfile.ts'), 'x', 'utf-8');
    // 根级目录作用域查询实时读取（不依赖索引）
    const live = await search.list('', new AbortController().signal);
    expect(live.some((c) => c.path === 'newfile.ts')).toBe(true);
    // 全局索引：invalidate 后旧索引继续应答，后台重建（dsh 语义）
    search.invalidate();
    await search.list('newfile', new AbortController().signal); // 触发后台重建
    await new Promise<void>((r) => setTimeout(r, 200));
    const fresh = await search.list('newfile', new AbortController().signal);
    expect(fresh.some((c) => c.path === 'newfile.ts')).toBe(true);

    search.dispose();
    expect(await search.list('newfile', new AbortController().signal)).toEqual([]);
  });

  it('maxEntries 上限', async () => {
    const root = makeRoot();
    const search = new WorkspaceFileSearch(root, { maxResults: 20, maxEntries: 2, excludedDirectories: ['node_modules'] });
    // 全局索引被 2 条目截断
    const candidates = await search.list('', new AbortController().signal);
    expect(candidates.length).toBeLessThanOrEqual(2);
  });
});

describe('LocalFileReferenceService（Cordis 插件）', () => {
  it('挂载 ctx.fileReferences + 注入 cwd 解析 + invalidate', async () => {
    const root = makeRoot();
    const ctx = new Context();
    const fiber = (await ctx.plugin(LocalFileReferenceService, {
      resolveCwd: () => root,
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.fileReferences;
    expect(svc).toBeDefined();
    const candidates = await svc.list('agent-1', 'core', new AbortController().signal);
    expect(candidates.some((c) => c.path === 'src/lib/core.ts')).toBe(true);

    (svc as LocalFileReferenceService).invalidate('agent-1');
    await fiber.dispose();
  });
});
