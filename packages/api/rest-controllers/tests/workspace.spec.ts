/**
 * Workspace read controller contract tests (tree/file/raw/search/diff/linked-roots/reveal).
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { WorkspaceController } from '../src/controllers/workspace.ts';
import { MemoryWorkspaceFs } from '../src/ports/workspace-fs.ts';
import { WorkspaceSecurity, WorktreeRegistry, MemoryLinkedRootsStore } from '../src/ports/workspace-security.ts';
import { MemoryGitSeam } from '../src/ports/git.ts';
import type { RevealSeam } from '../src/ports/workspace-fs.ts';

function req(method: string, url: string, opts: { headers?: Record<string, string | undefined>; body?: unknown; query?: Record<string, string> } = {}): HttpRequest {
  return { method, url, headers: opts.headers ?? {}, ...(opts.body !== undefined ? { body: opts.body as Record<string, unknown> } : {}), ...(opts.query ? { query: opts.query } : {}) };
}

function make() {
  const git = new MemoryGitSeam({ 'status --porcelain': ' M src/a.ts\n?? new.txt\n' });
  const registry = new WorktreeRegistry();
  registry.register([{ id: 'wt1', root: '/repo', branch: 'main', head: 'abc' }]);
  const linkedRoots = new MemoryLinkedRootsStore();
  const security = new WorkspaceSecurity({ git, linkedRoots, registry, cwd: '/repo' });
  const fs = new MemoryWorkspaceFs({
    '/repo/README.md': 'hello world',
    '/repo/src/a.ts': 'export const a = 1;',
    '/repo/src/b.ts': 'no match here',
  });
  const reveal: RevealSeam = {
    revealCommand: (platform, path, isDir) => ({ program: platform === 'darwin' ? 'open' : 'xdg-open', args: [path + (isDir ? '' : '/file')] }),
  };
  const controller = new WorkspaceController({ security, fs, git, linkedRoots, reveal });
  return { controller, fs, linkedRoots };
}

describe('WorkspaceController tree', () => {
  it('builds a directory tree', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/tree', { query: { worktreeId: 'wt1', path: '.' } }));
    expect(res.status).toBe(200);
    const tree = (res.body as { tree: Array<{ name: string }> }).tree;
    const names = tree.map((n) => n.name);
    expect(names).toContain('README.md');
    expect(names).toContain('src');
  });
  it('requires a worktreeId', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/tree'));
    expect(res.status).toBe(400);
  });
});

describe('WorkspaceController file / raw', () => {
  it('reads a file preview with mime and sha256', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/file', { query: { worktreeId: 'wt1', path: 'README.md' } }));
    expect(res.status).toBe(200);
    const body = res.body as { content: string; mime: string; sha256: string };
    expect(body.content).toBe('hello world');
    expect(body.mime).toBe('text/plain');
    expect(body.sha256).toHaveLength(64);
  });
  it('returns 404 for a missing file', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/file', { query: { worktreeId: 'wt1', path: 'nope.txt' } }));
    expect(res.status).toBe(404);
  });
  it('serves raw content with a content-type header', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/raw', { query: { worktreeId: 'wt1', path: 'README.md' } }));
    expect(res.status).toBe(200);
    expect(res.headers?.['content-type']).toBe('text/plain');
    expect(res.body).toBe('hello world');
  });
});

describe('WorkspaceController search', () => {
  it('searches content across scopeable files', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/search', { query: { worktreeId: 'wt1', q: 'export' } }));
    expect(res.status).toBe(200);
    const body = res.body as { totalMatches: number };
    expect(body.totalMatches).toBe(1);
  });
  it('rejects a long query', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/search', { query: { worktreeId: 'wt1', q: 'x'.repeat(201) } }));
    expect(res.status).toBe(400);
  });
});

describe('WorkspaceController diff & linked-roots', () => {
  it('lists changed files', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/workspace/diff', { query: { worktreeId: 'wt1' } }));
    expect(res.status).toBe(200);
    const changed = (res.body as { changedFiles: Array<{ path: string }> }).changedFiles;
    expect(changed.map((c) => c.path)).toEqual(['src/a.ts', 'new.txt']);
  });
  it('lists, adds and removes linked roots', async () => {
    const { controller, linkedRoots } = make();
    const listRes = await controller.handle(req('GET', '/api/workspace/linked-roots'));
    expect(listRes.status).toBe(200);
    const addRes = await controller.handle(req('POST', '/api/workspace/linked-roots', { body: { name: 'docs', path: '/docs' } }));
    expect(addRes.status).toBe(201);
    expect(linkedRoots.list()).toHaveLength(1);
    const linkedId = (addRes.body as { linkedRoot: { id: string } }).linkedRoot.id;
    const delRes = await controller.handle(req('DELETE', `/api/workspace/linked-roots/${linkedId}`));
    expect(delRes.status).toBe(200);
    expect(linkedRoots.list()).toHaveLength(0);
  });
});

describe('WorkspaceController reveal', () => {
  it('constructs a reveal command for the requested platform', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/workspace/reveal', { body: { worktreeId: 'wt1', path: 'README.md', platform: 'linux' } }));
    expect(res.status).toBe(200);
    expect((res.body as { command: { program: string } }).command.program).toBe('xdg-open');
  });
  it('requires worktreeId and path', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/workspace/reveal', { body: {} }));
    expect(res.status).toBe(400);
  });
});