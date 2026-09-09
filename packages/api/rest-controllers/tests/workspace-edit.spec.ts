/**
 * Workspace edit controller contract tests (edit tokens + file CRUD + guarded writes).
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { WorkspaceEditController } from '../src/controllers/workspace-edit.ts';
import { MemoryWorkspaceFs } from '../src/ports/workspace-fs.ts';
import { WorkspaceSecurity, WorktreeRegistry } from '../src/ports/workspace-security.ts';
import { MemoryLinkedRootsStore } from '../src/ports/workspace-security.ts';
import { MemoryGitSeam } from '../src/ports/git.ts';
import { NodeCryptoEditTokenToolkit, EDIT_TOKEN_TTL_MS } from '../src/pure/edit-token.ts';
import { DefaultRequestContextResolver } from '../src/ports/request-context.ts';

function req(method: string, url: string, opts: { headers?: Record<string, string | undefined>; body?: unknown; query?: Record<string, string> } = {}): HttpRequest {
  return { method, url, headers: opts.headers ?? {}, ...(opts.body !== undefined ? { body: opts.body as Record<string, unknown> } : {}), ...(opts.query ? { query: opts.query } : {}) };
}

function make(o: { now?: () => number; maxUploadBytes?: number } = {}) {
  const git = new MemoryGitSeam();
  const registry = new WorktreeRegistry();
  registry.register([{ id: 'wt1', root: '/repo', branch: 'main', head: 'abc' }]);
  const security = new WorkspaceSecurity({ git, linkedRoots: new MemoryLinkedRootsStore(), registry, cwd: '/repo' });
  const fs = new MemoryWorkspaceFs({ '/repo/a.txt': 'original', '/repo/b.bin': 'x' });
  const toolkit = new NodeCryptoEditTokenToolkit(new Uint8Array(32).fill(3));
  const controller = new WorkspaceEditController({
    security,
    fs,
    identity: new DefaultRequestContextResolver(),
    toolkit,
    ...(o.now ? { now: o.now } : {}),
    ...(o.maxUploadBytes ? { maxUploadBytes: o.maxUploadBytes } : {}),
  });
  return { controller, fs, toolkit };
}

function sign(controller: WorkspaceEditController, worktreeId = 'wt1'): Promise<string> {
  return controller.handle(req('POST', '/api/workspace/edit-sessions', { body: { worktreeId } })).then((r) => (r.body as { token: string }).token);
}

describe('edit session tokens', () => {
  it('issues a token with an expiry window', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/workspace/edit-sessions', { body: { worktreeId: 'wt1' } }));
    expect(res.status).toBe(201);
    expect((res.body as { expiresInSeconds: number }).expiresInSeconds).toBe(30 * 60);
  });
  it('requires a worktreeId', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/workspace/edit-sessions', { body: {} }));
    expect(res.status).toBe(400);
  });
  it('rejects an expired token', async () => {
    let t = 1000;
    const { controller } = make({ now: () => t });
    const token = await sign(controller);
    t += EDIT_TOKEN_TTL_MS + 1;
    const res = await controller.handle(req('POST', '/api/workspace/files', { body: { worktreeId: 'wt1', path: 'new.txt', content: 'x', token } }));
    expect(res.status).toBe(401);
  });
});

describe('file / dir CRUD', () => {
  it('creates a file with a valid token (201)', async () => {
    const { controller, fs } = make();
    const token = await sign(controller);
    const res = await controller.handle(req('POST', '/api/workspace/files', { body: { worktreeId: 'wt1', path: 'new.txt', content: 'hi', token } }));
    expect(res.status).toBe(201);
    expect(fs.files.get('/repo/new.txt')).toBe('hi');
  });
  it('creates a directory (201) and deletes a file (200)', async () => {
    const { controller, fs } = make();
    const token = await sign(controller);
    const mk = await controller.handle(req('POST', '/api/workspace/dirs', { body: { worktreeId: 'wt1', path: 'sub', token } }));
    expect(mk.status).toBe(201);
    expect(fs.dirs.has('/repo/sub')).toBe(true);
    const del = await controller.handle(req('DELETE', '/api/workspace/files', { query: { worktreeId: 'wt1', path: 'b.bin', token } }));
    expect(del.status).toBe(200);
    expect(fs.files.has('/repo/b.bin')).toBe(false);
  });
  it('rejects a request without a valid token', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/workspace/files', { body: { worktreeId: 'wt1', path: 'new.txt', content: 'x', token: 'bad' } }));
    expect(res.status).toBe(401);
  });
  it('renames a file (200)', async () => {
    const { controller, fs } = make();
    const token = await sign(controller);
    const res = await controller.handle(req('POST', '/api/workspace/rename', { body: { worktreeId: 'wt1', from: 'a.txt', to: 'a2.txt', token } }));
    expect(res.status).toBe(200);
    expect(fs.files.has('/repo/a2.txt')).toBe(true);
    expect(fs.files.has('/repo/a.txt')).toBe(false);
  });
});

describe('guarded writes', () => {
  it('writes when the base sha256 matches and returns the new hash', async () => {
    const { controller, fs, toolkit } = make();
    const token = await sign(controller);
    const baseSha256 = toolkit.sha256('original');
    const res = await controller.handle(
      req('POST', '/api/workspace/edit-sessions/files/write', { body: { worktreeId: 'wt1', path: 'a.txt', baseSha256, content: 'updated', token } }),
    );
    expect(res.status).toBe(200);
    expect((res.body as { newSha256: string }).newSha256).toBe(toolkit.sha256('updated'));
    expect(fs.files.get('/repo/a.txt')).toBe('updated');
  });
  it('returns 409 FILE_CONFLICT on a sha256 mismatch', async () => {
    const { controller } = make();
    const token = await sign(controller);
    const res = await controller.handle(
      req('POST', '/api/workspace/edit-sessions/files/write', { body: { worktreeId: 'wt1', path: 'a.txt', baseSha256: 'donotmatch', content: 'updated', token } }),
    );
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('FILE_CONFLICT');
  });
  it('requires a baseSha256', async () => {
    const { controller } = make();
    const token = await sign(controller);
    const res = await controller.handle(req('POST', '/api/workspace/edit-sessions/files/write', { body: { worktreeId: 'wt1', path: 'a.txt', content: 'x', token } }));
    expect(res.status).toBe(400);
  });
});

describe('upload', () => {
  it('uploads base64 content (201)', async () => {
    const { controller, fs } = make();
    const token = await sign(controller);
    const data = Buffer.from('hello world').toString('base64');
    const res = await controller.handle(req('POST', '/api/workspace/upload', { body: { worktreeId: 'wt1', path: 'up.txt', data }, headers: { 'x-edit-token': token } }));
    expect(res.status).toBe(201);
    expect((res.body as { size: number }).size).toBe(11);
    expect(fs.files.get('/repo/up.txt')).toBe('hello world');
  });
  it('rejects an oversized upload with 413', async () => {
    const { controller } = make({ maxUploadBytes: 4 });
    const token = await sign(controller);
    const data = Buffer.from('toolongcontent').toString('base64');
    const res = await controller.handle(req('POST', '/api/workspace/upload', { body: { worktreeId: 'wt1', path: 'up.txt', data }, headers: { 'x-edit-token': token } }));
    expect(res.status).toBe(413);
  });
});