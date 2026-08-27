/**
 * @flowforge/cats-taste — Canonical Taste repository（F221）。
 *
 * TS 移植自 clowder-ai `domains/taste/services/TasteRepository.ts`：
 * Public Taste 保持 Git-tracked，其持久根是同一 Git 仓库中真正持有
 * refs/heads/main 的 worktree；runtime/workspace 环境根不参与定位。
 * 插件化改造：`execFileSync('git')` 剥离为 `GitRunner` 注入
 * （缺省 `nodeGitRunner`，与 `@flowforge/cats-workspace` 同构）。
 *
 * @module @flowforge/cats-taste/taste-repository
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { GitRunner, TasteRepository } from './types.js';

const execFileAsync = promisify(execFile);

/** 默认 git 执行器（与 cats-workspace nodeGitRunner 同构）。 */
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

interface GitWorktree {
  path: string;
  branch?: string;
}

async function runGit(runner: GitRunner, projectRoot: string, args: string[]): Promise<string> {
  const result = await runner.exec(args, projectRoot);
  if (!result.ok) throw result.err;
  return result.stdout.trim();
}

function parseWorktrees(raw: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: GitWorktree | undefined;

  for (const field of raw.split('\0')) {
    if (field.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: field.slice('worktree '.length) };
    } else if (field.startsWith('branch ') && current) {
      current.branch = field.slice('branch '.length);
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

/**
 * Canonical F221 Taste repository.
 *
 * Public Taste remains Git-tracked, so its durable root is the worktree that
 * actually owns refs/heads/main in the same Git repository. Runtime/workspace
 * environment roots are intentionally not consulted: production may point both
 * at runtime/main-sync, and neither variable is a canonical-main locator.
 */
export class FileTasteRepository implements TasteRepository {
  private readonly projectRoot: string;
  private readonly runner: GitRunner;

  constructor(projectRoot: string, runner: GitRunner = nodeGitRunner) {
    this.projectRoot = resolve(projectRoot);
    this.runner = runner;
  }

  async canonicalRoot(): Promise<string> {
    const repositoryRoot = await runGit(this.runner, this.projectRoot, ['rev-parse', '--show-toplevel']);
    const raw = await runGit(this.runner, repositoryRoot, ['worktree', 'list', '--porcelain', '-z']);
    const mainWorktree = parseWorktrees(raw).find((worktree) => worktree.branch === 'refs/heads/main');

    if (!mainWorktree || !existsSync(mainWorktree.path)) {
      throw new Error(`Taste repository cannot find a checked-out refs/heads/main worktree from "${this.projectRoot}"`);
    }
    return resolve(mainWorktree.path);
  }

  async approvalLockKey(): Promise<string> {
    return join(await this.canonicalRoot(), 'docs/taste/index.md');
  }
}
