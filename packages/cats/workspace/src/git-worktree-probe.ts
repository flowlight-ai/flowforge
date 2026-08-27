/**
 * @flowforge/cats-workspace — git worktree 探测（GitRunner 注入端口）。
 *
 * TS 移植自 clowder-ai `domains/workspace/git-worktree-probe.ts`。
 * 插件化改造：`execFile('git')` 剥离为 `GitRunner` 注入接口（host 可替换为
 * mock / 受限 runner），默认 `nodeGitRunner` 保持原 execFile 语义。
 *
 * @module @flowforge/cats-workspace/git-worktree-probe
 */

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitResult = { ok: true; stdout: string } | { ok: false; err: unknown };

/** git 执行端口：host 注入（测试 / 沙箱 / 记录器）。 */
export interface GitRunner {
  exec(args: string[], cwd: string): Promise<GitResult>;
}

/** 默认实现：node:child_process execFile('git', ...)。 */
export const nodeGitRunner: GitRunner = {
  async exec(args, cwd) {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd });
      return { ok: true, stdout };
    } catch (err) {
      return { ok: false, err };
    }
  },
};

function isGitExecutableUnavailableError(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
  return code === 'ENOENT';
}

function isGitExit128(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
  return code === '128';
}

async function hasGitMarkerInParents(cwd: string): Promise<boolean> {
  let current = resolve(cwd);
  while (true) {
    if (
      await stat(join(current, '.git')).then(
        () => true,
        () => false,
      )
    )
      return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function hasBareGitRepositoryMarkers(cwd: string): Promise<boolean> {
  const root = resolve(cwd);
  const stats = await Promise.all([
    stat(join(root, 'HEAD')).then(
      (s) => s,
      () => null,
    ),
    stat(join(root, 'objects')).then(
      (s) => s,
      () => null,
    ),
    stat(join(root, 'refs')).then(
      (s) => s,
      () => null,
    ),
  ]);
  const [head, objects, refs] = stats;
  return Boolean(head?.isFile() && objects?.isDirectory() && refs?.isDirectory());
}

async function isInsideGitWorkTree(cwd: string, runner: GitRunner): Promise<boolean> {
  const result = await runner.exec(['rev-parse', '--is-inside-work-tree'], cwd);
  if (result.ok) return result.stdout.trim() === 'true';
  if (isGitExecutableUnavailableError(result.err)) return false;
  if (isGitExit128(result.err) && !(await hasGitMarkerInParents(cwd))) return false;
  throw result.err;
}

async function isBareGitRepository(cwd: string, runner: GitRunner): Promise<boolean> {
  const result = await runner.exec(['rev-parse', '--is-bare-repository'], cwd);
  if (result.ok) return result.stdout.trim() === 'true';
  const hasCheckoutMarker = await hasGitMarkerInParents(cwd);
  const hasBareMarkers = await hasBareGitRepositoryMarkers(cwd);
  if (isGitExecutableUnavailableError(result.err)) return false;
  if (isGitExit128(result.err) && !hasCheckoutMarker && !hasBareMarkers) return false;
  throw result.err;
}

/**
 * 读取 `git worktree list --porcelain` 输出；非 git 仓库或 git 不可用时返回 null。
 * runner 注入（缺省 nodeGitRunner）。
 */
export async function readGitWorktreeList(cwd: string, runner: GitRunner = nodeGitRunner): Promise<string | null> {
  if (!(await isInsideGitWorkTree(cwd, runner)) && !(await isBareGitRepository(cwd, runner))) return null;

  const result = await runner.exec(['worktree', 'list', '--porcelain'], cwd);
  if (result.ok) return result.stdout;
  if (isGitExecutableUnavailableError(result.err)) return null;
  throw result.err;
}
