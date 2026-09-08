/**
 * Workspace git controller contract tests (command construction + networking guards).
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { WorkspaceGitController } from '../src/controllers/workspace-git.ts';
import { MemoryGitSeam } from '../src/ports/git.ts';
import { WorkspaceSecurity, WorktreeRegistry, MemoryLinkedRootsStore } from '../src/ports/workspace-security.ts';

function req(method: string, url: string, opts: { query?: Record<string, string> } = {}): HttpRequest {
  return { method, url, headers: {}, ...(opts.query ? { query: opts.query } : {}) };
}

const PORCELAIN =
  'worktree /repo\n' +
  'HEAD abcdef01\n' +
  'branch refs/heads/main\n\n' +
  'worktree /repo/feature\n' +
  'HEAD 12345678\n' +
  'branch refs/heads/feature\n\n';

function make() {
  const git = new MemoryGitSeam({
    'worktree list --porcelain': PORCELAIN,
    'for-each-ref': 'feature/x\u00002026-01-01\u0000Alice\n',
    'log --pretty=format': 'abc12345\u0000Alice\u00002026-01-01 10:00:00 +0800\u0000feat: add thing\nbbbb0000\u0000Bob\u00002026-01-02 11:00:00 +0800\u0000fix: bug\n',
    'show --stat': ' src/a.ts | 5 +++++-\n',
    'status --porcelain': ' M src/a.ts\n?? new.txt\n',
  });
  const registry = new WorktreeRegistry();
  registry.register([{ id: 'wt1', root: '/repo', branch: 'main', head: 'abc12345' }]);
  const security = new WorkspaceSecurity({ git, linkedRoots: new MemoryLinkedRootsStore(), registry, cwd: '/repo' });
  const controller = new WorkspaceGitController({ security, git });
  return { git, controller };
}

describe('WorkspaceGitController guards', () => {
  it('requires a worktreeId', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/git/log'));
    expect(res.status).toBe(400);
  });
  it('resolves 404 for an unknown worktree', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/git/log', { query: { worktreeId: 'nope' } }));
    expect(res.status).toBe(404);
  });
  it('rejects an invalid git hash', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/git/show', { query: { worktreeId: 'wt1', hash: 'not-a-hash!!' } }));
    expect(res.status).toBe(400);
  });
});

describe('WorkspaceGitController log / status / show', () => {
  it('parses git log commits', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/git/log', { query: { worktreeId: 'wt1' } }));
    expect(res.status).toBe(200);
    const commits = (res.body as { commits: Array<{ short: string }> }).commits;
    expect(commits).toHaveLength(2);
    expect(commits[0]?.short).toBe('abc12345');
  });
  it('parses status into staged/unstaged/untracked', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/git/status', { query: { worktreeId: 'wt1' } }));
    expect(res.status).toBe(200);
    const status = (res.body as { status: { unstaged: Array<{ path: string }>; untracked: Array<{ path: string }> } }).status;
    expect(status.unstaged.map((s) => s.path)).toEqual(['src/a.ts']);
    expect(status.untracked.map((s) => s.path)).toEqual(['new.txt']);
  });
  it('parses git show stat files', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/git/show', { query: { worktreeId: 'wt1', hash: 'abc1234' } }));
    expect(res.status).toBe(200);
    expect((res.body as { files: Array<{ path: string }> }).files).toEqual([{ path: 'src/a.ts', summary: '5 +++++-' }]);
  });
  it('records the constructed git commands for later assertion', async () => {
    const { controller, git } = make();
    await controller.handle(req('GET', '/api/workspace/git/log', { query: { worktreeId: 'wt1', path: 'src/a.ts' } }));
    const logCall = git.calls.find((c) => c.args[0] === 'log');
    expect(logCall?.args).toEqual(['log', '--pretty=format:%h%x00%an%x00%ad%x00%s', '--date=iso', '--', 'src/a.ts']);
  });
});

describe('WorkspaceGitController health', () => {
  it('builds worktree health and stale branches', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/git/health', { query: { worktreeId: 'wt1' } }));
    expect(res.status).toBe(200);
    const body = res.body as { health: Array<{ path: string; branch: string }>; staleBranches: Array<{ name: string }> };
    expect(body.health).toHaveLength(2);
    expect(body.health[1]).toMatchObject({ path: '/repo/feature', branch: 'feature' });
    expect(body.staleBranches.map((s) => s.name)).toEqual(['feature/x']);
  });
});