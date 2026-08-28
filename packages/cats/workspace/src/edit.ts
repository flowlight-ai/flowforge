/**
 * @flowforge/cats-workspace — workspace 编辑会话（F063 AC-9）。
 *
 * TS 移植自 clowder-ai `domains/workspace/workspace-edit.ts`：
 * HMAC 签名编辑会话 token（30min TTL）+ sha256 乐观并发原子写。
 * 插件化改造：进程级单例（TOKEN_SECRET / fileLocks / Date.now）提升为
 * `EditSession` 实例字段（secret / ttlMs / now 可注入，便于测试与多实例隔离）。
 *
 * @module @flowforge/cats-workspace/edit
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface TokenPayload {
  worktreeId: string;
  exp: number; // Unix ms
}

export interface EditSessionOptions {
  /** HMAC secret（缺省每实例随机 32 字节）。 */
  readonly secret?: Uint8Array;
  /** token TTL（缺省 30min）。 */
  readonly ttlMs?: number;
  /** 时间函数（缺省 Date.now）。 */
  readonly now?: () => number;
}

/**
 * 编辑会话：token 签名/验证 + per-file 互斥的 sha256 冲突检测写。
 * secret / 锁表 / now 均为实例级，host 可注入（测试固定 secret + 时钟）。
 */
export class EditSession {
  private readonly secret: Uint8Array;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly fileLocks = new Map<string, Promise<unknown>>();

  constructor(options: EditSessionOptions = {}) {
    this.secret = options.secret ?? randomBytes(32);
    this.ttlMs = options.ttlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** 签发编辑会话 token。格式：base64url(JSON payload).signature */
  signEditToken(worktreeId: string): string {
    const payload: TokenPayload = {
      worktreeId,
      exp: this.now() + this.ttlMs,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
  }

  /** 验证编辑会话 token；有效返回 payload，否则 null。 */
  verifyEditToken(token: string, worktreeId: string): TokenPayload | null {
    const dot = token.indexOf('.');
    if (dot === -1) return null;

    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const expected = createHmac('sha256', this.secret).update(payloadB64).digest('base64url');
    if (sig !== expected) return null;

    try {
      const payload: TokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      if (payload.exp < this.now()) return null;
      if (payload.worktreeId !== worktreeId) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.fileLocks.get(path) ?? Promise.resolve();
    const next = prev.then(fn, fn); // 前一任务 settle（成功或失败）后执行
    this.fileLocks.set(path, next);
    const cleanup = () => {
      if (this.fileLocks.get(path) === next) this.fileLocks.delete(path);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  private async writeLocked(
    resolvedPath: string,
    content: string,
    baseSha256: string,
  ): Promise<WriteResult | WriteConflict> {
    const current = await readFile(resolvedPath, 'utf-8');
    const currentHash = this.sha256(current);

    if (currentHash !== baseSha256) {
      return { ok: false, code: 'CONFLICT', currentSha256: currentHash };
    }

    await writeFile(resolvedPath, content, 'utf-8');
    const newHash = this.sha256(content);

    return { ok: true, newSha256: newHash, size: Buffer.byteLength(content) };
  }

  /**
   * 写文件内容（sha256 乐观并发）。per-file 互斥串行化 read-compare-write。
   * 调用方必须先解析路径并做安全检查。
   */
  writeWorkspaceFile(resolvedPath: string, content: string, baseSha256: string): Promise<WriteResult | WriteConflict> {
    return this.withFileLock(resolvedPath, () => this.writeLocked(resolvedPath, content, baseSha256));
  }
}

export interface WriteResult {
  ok: true;
  newSha256: string;
  size: number;
}

export interface WriteConflict {
  ok: false;
  code: 'CONFLICT';
  currentSha256: string;
}
