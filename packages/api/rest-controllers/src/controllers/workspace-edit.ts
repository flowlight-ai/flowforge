/**
 * Workspace edit controller — edit-session tokens + file/dir CRUD + conflict-
 * safe writes.
 *
 * Rebuilds clowder routes/workspace-edit.ts + domains/workspace/workspace-edit.ts
 * behind injected security / fs / time seams. Path resolution is delegated to the
 * workspace-security seam; every write is guarded by an HMAC edit token and
 * (for content writes) sha256 conflict detection.
 */

import { MESSAGES } from '../contract/messages.ts';
import { RestControllerBase } from '../ports/http.ts';
import type { RequestContextResolver } from '../ports/request-context.ts';
import type { WorkspaceFsSeam } from '../ports/workspace-fs.ts';
import { WorkspaceSecurity } from '../ports/workspace-security.ts';
import {
  NodeCryptoEditTokenToolkit,
  signEditToken,
  verifyEditToken,
  writeWorkspaceFile,
  type EditTokenToolkit,
} from '../pure/edit-token.ts';
import { isRawRequest } from '../ports/skill-receipt.ts';
import { isDenylisted } from '../ports/workspace-security.ts';

export interface WorkspaceEditControllerOptions {
  security: WorkspaceSecurity;
  fs: WorkspaceFsSeam;
  identity: RequestContextResolver;
  /** Optional injected now (ms epoch) for deterministic token TTL tests. */
  now?: () => number;
  /** Optional injected signing toolkit (defaults to NodeCrypto with a fixed secret). */
  toolkit?: EditTokenToolkit;
  /** Max upload payload size in bytes (default 10MB). */
  maxUploadBytes?: number;
}

export class WorkspaceEditController extends RestControllerBase {
  constructor(private readonly opts: WorkspaceEditControllerOptions) {
    super();
    this.registerRoutes();
  }

  private currently(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private toolkit(): EditTokenToolkit {
    return this.opts.toolkit ?? new NodeCryptoEditTokenToolkit(new Uint8Array(32).fill(7));
  }

  /** Resolve the true fs root for a worktreeId (throws User-visible 404 via null). */
  private async resolveRoot(worktreeId: string): Promise<string | null> {
    try {
      return await this.opts.security.getWorktreeRoot(worktreeId);
    } catch {
      return null;
    }
  }

  private registerRoutes(): void {
    // POST /api/workspace/edit-sessions — create an edit token
    this.post('/api/workspace/edit-sessions', (req) => {
      const worktreeId = typeof req.body?.worktreeId === 'string' ? req.body.worktreeId : '';
      if (!worktreeId) return { status: 400, body: { error: MESSAGES.worktreeIdRequired } };
      const token = signEditToken(worktreeId, this.toolkit(), this.currently());
      return { status: 201, body: { token, worktreeId, expiresInSeconds: 30 * 60 } };
    });

    // POST /api/workspace/files — create a file
    this.post('/api/workspace/files', async (req) => {
      const { worktreeId, path, content, token } = this.editFields(req);
      if (!worktreeId || !path) return { status: 400, body: { error: MESSAGES.treeAuthRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      if (!this.verifyToken(token, worktreeId)) return { status: 401, body: { error: 'Invalid or expired edit token' } };
      const resolved = await this.opts.security.resolveFilesystemPath(root, path);
      if (isDenylisted(path)) return { status: 403, body: { error: 'Path denied' } };
      await this.opts.fs.writeFileText(resolved, typeof content === 'string' ? content : '');
      return { status: 201, body: { ok: true, path: resolved } };
    });

    // POST /api/workspace/dirs — create a directory
    this.post('/api/workspace/dirs', async (req) => {
      const { worktreeId, path, token } = this.editFields(req);
      if (!worktreeId || !path) return { status: 400, body: { error: MESSAGES.treeAuthRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      if (!this.verifyToken(token, worktreeId)) return { status: 401, body: { error: 'Invalid or expired edit token' } };
      const resolved = await this.opts.security.resolveFilesystemPath(root, path);
      await this.opts.fs.mkdirp(resolved);
      return { status: 201, body: { ok: true, path: resolved } };
    });

    // DELETE /api/workspace/files?worktreeId=&path=&token=
    this.delete('/api/workspace/files', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      const path = req.query?.path ?? '';
      const token = req.query?.token ?? '';
      if (!worktreeId || !path) return { status: 400, body: { error: MESSAGES.treeAuthRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      if (!this.verifyToken(token, worktreeId)) return { status: 401, body: { error: 'Invalid or expired edit token' } };
      const resolved = await this.opts.security.resolveFilesystemPath(root, path);
      await this.opts.fs.remove(resolved);
      return { status: 200, body: { ok: true } };
    });

    // POST /api/workspace/rename
    this.post('/api/workspace/rename', async (req) => {
      const worktreeId = typeof req.body?.worktreeId === 'string' ? req.body.worktreeId : '';
      const from = typeof req.body?.from === 'string' ? req.body.from : '';
      const to = typeof req.body?.to === 'string' ? req.body.to : '';
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      if (!worktreeId || !from || !to) return { status: 400, body: { error: 'worktreeId, from and to are required' } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      if (!this.verifyToken(token, worktreeId)) return { status: 401, body: { error: 'Invalid or expired edit token' } };
      const resolvedFrom = await this.opts.security.resolveFilesystemPath(root, from);
      const resolvedTo = await this.opts.security.resolveFilesystemPath(root, to);
      await this.opts.fs.rename(resolvedFrom, resolvedTo);
      return { status: 200, body: { ok: true, from: resolvedFrom, to: resolvedTo } };
    });

    // POST /api/workspace/upload — raw or base64 upload
    this.post('/api/workspace/upload', async (req) => {
      const worktreeId = typeof req.body?.worktreeId === 'string' ? req.body.worktreeId : '';
      const path = typeof req.body?.path === 'string' ? req.body.path : '';
      if (!worktreeId || !path) return { status: 400, body: { error: MESSAGES.treeAuthRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      if (!this.verifyToken(req.headers['x-edit-token'] ?? '', worktreeId)) {
        return { status: 401, body: { error: 'Invalid or expired edit token' } };
      }
      const max = this.opts.maxUploadBytes ?? 10 * 1024 * 1024;
      let bytes: Uint8Array;
      if (isRawRequest(req)) {
        bytes = toBytes(req.body);
      } else {
        const b64 = typeof req.body?.data === 'string' ? req.body.data : '';
        bytes = fromB64(b64);
      }
      if (bytes.byteLength > max) {
        return { status: 413, body: { error: MESSAGES.fileTooLarge(String(Math.round(max / 1024 / 1024))) } };
      }
      const resolved = await this.opts.security.resolveFilesystemPath(root, path);
      await this.opts.fs.writeFileBytes(resolved, bytes);
      return { status: 201, body: { ok: true, path: resolved, size: bytes.byteLength } };
    });

    // POST /api/workspace/edit-sessions/files/write — sha256-guarded content write
    this.post('/api/workspace/edit-sessions/files/write', async (req) => {
      const worktreeId = typeof req.body?.worktreeId === 'string' ? req.body.worktreeId : '';
      const path = typeof req.body?.path === 'string' ? req.body.path : '';
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      const baseSha256 = typeof req.body?.baseSha256 === 'string' ? req.body.baseSha256 : '';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      if (!worktreeId || !path) return { status: 400, body: { error: MESSAGES.treeAuthRequired } };
      if (!baseSha256) return { status: 400, body: { error: 'baseSha256 is required for a guarded write' } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      if (!this.verifyToken(token, worktreeId)) return { status: 401, body: { error: 'Invalid or expired edit token' } };
      const resolved = await this.opts.security.resolveFilesystemPath(root, path);
      const result = await writeWorkspaceFile(this.opts.fs, resolved, content, baseSha256, (c) => this.toolkit().sha256(c));
      if (!result.ok) {
        return { status: 409, body: { error: 'File changed since base', code: 'FILE_CONFLICT', currentSha256: result.currentSha256 } };
      }
      return { status: 200, body: { ok: true, path: resolved, newSha256: result.newSha256, size: result.size } };
    });
  }

  private editFields(req: { body?: unknown }): { worktreeId: string; path: string; content?: string; token: string } {
    const body = req.body as { worktreeId?: string; path?: string; content?: string; token?: string } | undefined;
    const worktreeId = typeof body?.worktreeId === 'string' ? body.worktreeId : '';
    const path = typeof body?.path === 'string' ? body.path : '';
    const content = typeof body?.content === 'string' ? body.content : undefined;
    const token = typeof body?.token === 'string' ? body.token : '';
    const result: { worktreeId: string; path: string; content?: string; token: string } = { worktreeId, path, token };
    if (content !== undefined) result.content = content;
    return result;
  }

  private verifyToken(token: string, worktreeId: string): boolean {
    if (!token) return false;
    return verifyEditToken(token, worktreeId, this.toolkit(), this.currently()) !== null;
  }
}

function toBytes(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body;
  return new TextEncoder().encode(String(body ?? ''));
}

function fromB64(b64: string): Uint8Array {
  if (!b64) return new Uint8Array();
  const bin = Buffer.from(b64, 'base64');
  return new Uint8Array(bin);
}