/**
 * Workspace git controller — log / status / show / health.
 *
 * Rebuilds clowder routes/workspace-git.ts behind the injected GitSeam; command
 * construction and guarding are pure (see `pure/git-parsers.ts`). Worktree root
 * resolution delegates to the workspace-security seam.
 */

import { RestControllerBase } from '../ports/http.ts';
import type { GitSeam } from '../ports/git.ts';
import { WorkspaceSecurity } from '../ports/workspace-security.ts';
import { MESSAGES } from '../contract/messages.ts';
import type { GitCommit, GitStatusResult, GitShowFile, WorktreeHealthEntry, StaleBranch } from '../contract/workspace.ts';
import { parseGitLog, parseGitShow, parseGitStatus, parseStaleBranches } from '../pure/git-parsers.ts';

export interface WorkspaceGitControllerOptions {
  security: WorkspaceSecurity;
  git: GitSeam;
  /** Protected/merged branch set for health-oracle detection. */
  mergedBranches?: () => Set<string> | Promise<Set<string>>;
}

const HASH_RE = /^[0-9a-fA-F]{7,40}$/;

export class WorkspaceGitController extends RestControllerBase {
  constructor(private readonly opts: WorkspaceGitControllerOptions) {
    super();
    this.registerRoutes();
  }

  private async resolveRoot(worktreeId: string): Promise<string | null> {
    try {
      return await this.opts.security.getWorktreeRoot(worktreeId);
    } catch {
      return null;
    }
  }

  private registerRoutes(): void {
    // GET /api/workspace/git/log?worktreeId=&path=
    this.get('/api/workspace/git/log', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      if (!worktreeId) return { status: 400, body: { error: MESSAGES.worktreeIdRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const relPath = req.query?.path ?? '';
      const args = ['log', '--pretty=format:%h%x00%an%x00%ad%x00%s', '--date=iso'];
      if (relPath) args.push('--', relPath);
      const { stdout } = await this.opts.git.exec(root, args, { timeoutMs: 5000 });
      const commits: GitCommit[] = parseGitLog(stdout);
      return { status: 200, body: { worktreeId, commits } };
    });

    // GET /api/workspace/git/status?worktreeId=
    this.get('/api/workspace/git/status', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      if (!worktreeId) return { status: 400, body: { error: MESSAGES.worktreeIdRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const { stdout } = await this.opts.git.exec(root, ['status', '--porcelain'], { timeoutMs: 5000 });
      const status: GitStatusResult = parseGitStatus(stdout);
      return { status: 200, body: { worktreeId, status } };
    });

    // GET /api/workspace/git/show?worktreeId=&hash=&path=
    this.get('/api/workspace/git/show', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      const hash = req.query?.hash ?? '';
      if (!worktreeId) return { status: 400, body: { error: MESSAGES.worktreeIdRequired } };
      if (!HASH_RE.test(hash)) return { status: 400, body: { error: 'Invalid git hash' } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const relPath = req.query?.path ?? '';
      const showArgs = ['show', '--stat', '--oneline', hash];
      if (relPath) showArgs.push('--', relPath);
      const { stdout } = await this.opts.git.exec(root, showArgs, { timeoutMs: 5000 });
      const files: GitShowFile[] = parseGitShow(stdout);
      return { status: 200, body: { worktreeId, hash, files } };
    });

    // GET /api/workspace/git/health?worktreeId=
    this.get('/api/workspace/git/health', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      if (!worktreeId) return { status: 400, body: { error: MESSAGES.worktreeIdRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      // Derive health from the single worktree listing (listWorktrees already
      // returns path/branch/head for every worktree); a branch is orphan when it
      // appears in the merged/stale set supplied by the caller.
      const worktrees = await this.opts.security.listWorktrees(root);
      const staleScript = await this.staleBranches(root);
      const merged = this.opts.mergedBranches ? await this.opts.mergedBranches() : new Set(staleScript.map((s) => s.name));
      const health: WorktreeHealthEntry[] = worktrees.map((w) => ({
        path: w.root,
        branch: w.branch === 'HEAD' ? '(detached)' : w.branch ?? '(unknown)',
        head: w.head ?? '',
        isOrphan: w.branch && w.branch !== 'HEAD' ? merged.has(w.branch) : false,
      }));
      return { status: 200, body: { worktreeId, health, staleBranches: staleScript } };
    });
  }

  private async staleBranches(root: string): Promise<StaleBranch[]> {
    const { stdout } = await this.opts.git.exec(root, ['for-each-ref', '--format=%(refname:short)%00%(committerdate:iso)%00%(authorname)', 'refs/heads'], { timeoutMs: 5000 });
    return parseStaleBranches(stdout);
  }
}