/**
 * F140 Phase C: PR 合并冲突自动执行器。
 *
 * 干净 rebase → 自动 push；任何冲突 → abort + 升级（附文件清单）。
 * 安全护栏：仅 feat/* 分支、绝不触碰 runtime worktree、
 * --force-with-lease、30s 超时。
 *
 * TS 移植自 clowder-ai `infrastructure/email/ConflictAutoExecutor.ts`。
 * 插件化改造：execFile/git 子进程与 listWorktrees（clowder workspace 域）→
 * 注入式端口（缺省 node:child_process + 未注入 worktree lister 时跳过）。
 */

import { buildGhCliEnv, withHiddenGhCliWindow } from '@flowforge/infrastructure-github';

const GIT_TIMEOUT_MS = 30_000;
const GH_TIMEOUT_MS = 10_000;

export type AutoResolveResult =
  | { kind: 'resolved'; method: 'clean-rebase'; branch: string }
  | { kind: 'escalated'; files: string[]; branch: string }
  | { kind: 'skipped'; reason: string };

/** git/gh 子进程端口（可注入测试桩）。 */
export interface SubprocessRunner {
  exec(file: string, args: readonly string[], options: { cwd?: string; timeout: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv }): Promise<{ stdout: string }>;
}

/** worktree 枚举端口（clowder workspace-security listWorktrees 的适配）。 */
export interface WorktreeLister {
  list(branch?: string): Promise<Array<{ branch: string | null; root: string }> | readonly { branch: string | null; root: string }[]>;
}

const defaultRunner: SubprocessRunner = {
  async exec(
    file: string,
    args: readonly string[],
    options: { cwd?: string; timeout: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
  ): Promise<{ stdout: string }> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile) as unknown as (
      file: string,
      args: readonly string[],
      options: { cwd?: string; timeout: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
    ) => Promise<{ stdout: string }>;
    return execFileAsync(file, args, options);
  },
};

export interface ConflictAutoExecutorOptions {
  readonly log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /** 注入 git/gh 子进程 runner（缺省 node:child_process）。 */
  readonly runner?: SubprocessRunner;
  /** 注入 worktree 枚举器；缺省 → findWorktree 返回 null（跳过自动解决）。 */
  readonly worktreeLister?: WorktreeLister;
}

export class ConflictAutoExecutor {
  constructor(private readonly opts: ConflictAutoExecutorOptions) {}

  async resolve(repoFullName: string, prNumber: number, signal?: AbortSignal): Promise<AutoResolveResult> {
    const { log } = this.opts;
    signal?.throwIfAborted();

    // 1. 从 GitHub 取 PR head 分支
    const branch = await this.getPrBranch(repoFullName, prNumber, signal);
    if (!branch) return { kind: 'skipped', reason: 'cannot determine PR branch' };

    // 安全护栏：仅 feat/* 分支
    if (!branch.startsWith('feat/')) {
      return { kind: 'skipped', reason: `branch ${branch} is not feat/* — refusing auto-rebase` };
    }

    // 2. 找该分支的本地 worktree
    const worktreePath = await this.findWorktree(branch);
    signal?.throwIfAborted();
    if (!worktreePath) return { kind: 'skipped', reason: `no local worktree for branch ${branch}` };

    // 安全护栏：绝不触碰 runtime
    if (worktreePath.includes('-runtime')) {
      return { kind: 'skipped', reason: 'refusing to touch runtime worktree' };
    }

    log.info(`[ConflictAutoExecutor] Attempting auto-rebase for ${branch} in ${worktreePath}`);

    // 3. Fetch + rebase
    try {
      await this.git(worktreePath, ['fetch', 'origin', 'main'], signal);
      await this.git(worktreePath, ['rebase', 'origin/main'], signal);
    } catch {
      if (signal?.aborted) {
        // 取消的 rebase 可能遗留 sequencer 状态：先完成有界清理再冒泡中止
        await this.abortRebase(worktreePath);
        signal.throwIfAborted();
      }
      return this.handleRebaseFailure(worktreePath, branch, signal);
    }

    // 4. 干净 rebase → push
    try {
      await this.git(worktreePath, ['push', '--force-with-lease'], signal);
      log.info(`[ConflictAutoExecutor] Clean rebase + push succeeded for ${branch}`);
      return { kind: 'resolved', method: 'clean-rebase', branch };
    } catch {
      signal?.throwIfAborted();
      // Push 被拒（如他人已 push）→ 不升级，仅跳过
      return { kind: 'skipped', reason: 'push --force-with-lease rejected' };
    }
  }

  private async handleRebaseFailure(
    worktreePath: string,
    branch: string,
    signal?: AbortSignal,
  ): Promise<AutoResolveResult> {
    const { log } = this.opts;
    let conflictFiles: string[] = [];
    try {
      const { stdout } = await this.git(worktreePath, ['diff', '--name-only', '--diff-filter=U'], signal);
      conflictFiles = stdout.trim().split('\n').filter(Boolean);
    } catch {
      if (signal?.aborted) {
        await this.abortRebase(worktreePath);
        signal.throwIfAborted();
      }
      // 连冲突列表都取不到
    }

    // 总是 abort。清理只用自身 30s 进程界：父取消已知，终态真相在此等待。
    await this.abortRebase(worktreePath);
    signal?.throwIfAborted();

    if (conflictFiles.length === 0) {
      log.warn(`[ConflictAutoExecutor] Rebase failed but no conflict files found for ${branch}`);
      return { kind: 'skipped', reason: 'rebase failed without identifiable conflicts' };
    }

    log.info(`[ConflictAutoExecutor] Escalating: ${conflictFiles.length} conflict file(s) in ${branch}`);
    return { kind: 'escalated', files: conflictFiles, branch };
  }

  async getPrBranch(repoFullName: string, prNumber: number, signal?: AbortSignal): Promise<string | null> {
    try {
      const runner = this.opts.runner ?? defaultRunner;
      const { stdout } = await runner.exec(
        'gh',
        ['api', `repos/${repoFullName}/pulls/${prNumber}`, '--jq', '.head.ref'],
        withHiddenGhCliWindow({
          timeout: GH_TIMEOUT_MS,
          env: buildGhCliEnv({}),
          ...(signal !== undefined ? { signal } : {}),
        }),
      );
      return stdout.trim() || null;
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  }

  async findWorktree(branch: string): Promise<string | null> {
    try {
      if (!this.opts.worktreeLister) return null;
      const entries = await this.opts.worktreeLister.list();
      return entries.find((e) => e.branch === branch)?.root ?? null;
    } catch {
      return null;
    }
  }

  private git(cwd: string, args: string[], signal?: AbortSignal) {
    const runner = this.opts.runner ?? defaultRunner;
    return runner.exec('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      ...(signal !== undefined ? { signal } : {}),
    });
  }

  private async abortRebase(worktreePath: string): Promise<void> {
    try {
      await this.git(worktreePath, ['rebase', '--abort']);
    } catch (error) {
      this.opts.log.warn(`[ConflictAutoExecutor] Failed to abort rebase cleanup; worktree may require repair: ${String(error)}`);
    }
  }
}
