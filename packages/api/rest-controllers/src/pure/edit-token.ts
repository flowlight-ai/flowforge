/**
 * Workspace edit-session tokens (HMAC, 30min TTL) + atomic file write with
 * sha256 conflict detection — self-contained with injected time/fs/secret.
 */

import { createHmac } from 'node:crypto';
import type { EditTokenPayload } from '../contract/workspace.ts';
import type { WorkspaceFsSeam } from '../ports/workspace-fs.ts';
import { sha256Hex } from '../ports/workspace-fs.ts';

export const EDIT_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface EditTokenToolkit {
  hmacSign(input: { payloadB64: string }): string;
  sha256(content: string): string;
}

export class NodeCryptoEditTokenToolkit implements EditTokenToolkit {
  constructor(private readonly secret: Uint8Array = new Uint8Array(32)) {}
  hmacSign(input: { payloadB64: string }): string {
    return createHmac('sha256', Buffer.from(this.secret)).update(input.payloadB64).digest('base64url');
  }
  sha256(content: string): string {
    return sha256Hex(content);
  }
}

export function signEditToken(worktreeId: string, toolkit: EditTokenToolkit, now: number): string {
  const payload: EditTokenPayload = { worktreeId, exp: now + EDIT_TOKEN_TTL_MS };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = toolkit.hmacSign({ payloadB64 });
  return `${payloadB64}.${sig}`;
}

export function verifyEditToken(token: string, worktreeId: string, toolkit: EditTokenToolkit, now: number): EditTokenPayload | null {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = toolkit.hmacSign({ payloadB64 });
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as EditTokenPayload;
    if (payload.exp < now) return null;
    if (payload.worktreeId !== worktreeId) return null;
    return payload;
  } catch {
    return null;
  }
}

export type WriteWorkspaceFileResult =
  | { ok: true; newSha256: string; size: number }
  | { ok: false; code: 'CONFLICT'; currentSha256: string };

export async function writeWorkspaceFile(
  fs: WorkspaceFsSeam,
  resolvedPath: string,
  content: string,
  baseSha256: string,
  sha256: (content: string) => string,
): Promise<WriteWorkspaceFileResult> {
  const current = await fs.readFileText(resolvedPath);
  if (current === null) return { ok: false, code: 'CONFLICT', currentSha256: '' };
  const currentHash = sha256(current);
  if (currentHash !== baseSha256) return { ok: false, code: 'CONFLICT', currentSha256: currentHash };
  await fs.writeFileText(resolvedPath, content);
  return { ok: true, newSha256: sha256(content), size: Buffer.byteLength(content, 'utf8') };
}

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}