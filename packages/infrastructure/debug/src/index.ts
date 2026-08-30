/**
 * @flowforge/infrastructure-debug — C33 debug 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `infrastructure/debug/*`（F153 Prompt X-Ray）：
 *   - PromptCaptureStore：gzip 压缩 + NDJSON 索引的 prompt 快照环形缓冲
 *     （maxEntries + ttlMs 双阈值驱逐，异步/同步写入两条路径）
 *   - prompt-capture-bridge：调用管线 fire-and-forget 捕获（不阻塞热路径），
 *     F203 native L0 provider 经注入式 fetcher 异步获取编译 L0 并 stamp
 *
 * 插件化改造：
 *   - clowder createModuleLogger → 注入式 DebugLogger 接口（缺省 console）
 *   - env FF_PROMPT_CAPTURE / FF_PROMPT_CAPTURE_CATS（R17：PROMPT_CAPTURE → FF_*）
 *   - 默认 baseDir ~/.flowforge/prompt-captures（R17 ff2 域）
 *   - compileL0ViaSubprocess → 注入式 nativeL0Fetcher（缺省不获取）
 *   - hmac 经 @flowforge/infrastructure-telemetry pseudonymizeId
 *
 * @module @flowforge/infrastructure-debug
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  appendFile,
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFile,
  writeFileSync,
} from 'node:fs';
import { gunzipSync, gzip, gzipSync } from 'node:zlib';

import { Context, Service } from '@flowforge/cordis';
import { pseudonymizeId } from '@flowforge/infrastructure-telemetry';

// ── Types ───────────────────────────────────────────────────

export interface PromptCapture {
  captureId: string;
  invocationId: string;
  hmacInvocationId?: string;
  catId: string;
  threadId: string;
  userId: string;
  model: string;
  capturedAt: number;
  systemPrompt: string;
  missionPrefix?: string;
  userPrompt: string;
  effectivePrompt: string;
  injectionDecision: {
    isResume: boolean;
    canSkipOnResume: boolean;
    forceReinjection: boolean;
    injected: boolean;
  };
  promptBytes: number;
  tokenEstimate: number;
  nativeSystemPrompt?: string;
  nativeSystemPromptSource?: 'f203-l0';
  nativeSystemTokenEstimate?: number;
  totalTokenEstimate?: number;
  captureDiagnostics?: readonly string[];
}

export interface CaptureIndexEntry {
  captureId: string;
  invocationId: string;
  hmacInvocationId?: string;
  catId: string;
  threadId: string;
  userId: string;
  capturedAt: number;
  promptBytes: number;
  file: string;
}

export interface DebugLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

const DEFAULT_BASE_DIR = join(homedir(), '.flowforge', 'prompt-captures');
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const CAPTURE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isValidCaptureId(id: string): boolean {
  return CAPTURE_ID_RE.test(id);
}

/** Env 闸门：FF_PROMPT_CAPTURE=on 启用，FF_PROMPT_CAPTURE_CATS 限定 cat 白名单。 */
export function isPromptCaptureEnabled(catId?: string): boolean {
  if (process.env.FF_PROMPT_CAPTURE !== 'on') return false;
  const allowedCats = process.env.FF_PROMPT_CAPTURE_CATS;
  if (!allowedCats) return true;
  if (!catId) return true;
  return allowedCats.split(',').some((c) => c.trim() === catId);
}

/** 估算 token 数（字符数 / 3.5）。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ── Store ───────────────────────────────────────────────────

export interface PromptCaptureStoreConfig {
  baseDir?: string;
  maxEntries?: number;
  ttlMs?: number;
  log?: DebugLogger;
}

/** gzip + NDJSON 索引的 prompt 快照环形缓冲。 */
export class PromptCaptureStore {
  private readonly baseDir: string;
  private readonly payloadDir: string;
  private readonly indexPath: string;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly log: DebugLogger;

  constructor(opts: PromptCaptureStoreConfig = {}) {
    this.baseDir = opts.baseDir ?? DEFAULT_BASE_DIR;
    this.payloadDir = join(this.baseDir, 'payloads');
    this.indexPath = join(this.baseDir, 'index.ndjson');
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.log = opts.log ?? console;
    this.ensureDirs();
  }

  private ensureDirs(): void {
    if (!existsSync(this.payloadDir)) {
      mkdirSync(this.payloadDir, { recursive: true });
    }
  }

  /** 异步写入（fire-and-forget，不阻塞热路径）。 */
  captureAsync(data: PromptCapture): void {
    const json = JSON.stringify(data);
    const fileName = `${data.captureId}.json.gz`;
    const filePath = join(this.payloadDir, fileName);
    gzip(Buffer.from(json), (gzipErr, compressed) => {
      if (gzipErr) {
        this.log.warn(`[prompt-capture] gzip failed: ${gzipErr.message}`);
        return;
      }
      writeFile(filePath, compressed, (writeErr) => {
        if (writeErr) {
          this.log.warn(`[prompt-capture] write failed: ${writeErr.message}`);
          return;
        }
        const indexEntry: CaptureIndexEntry = {
          captureId: data.captureId,
          invocationId: data.invocationId,
          catId: data.catId,
          threadId: data.threadId,
          userId: data.userId,
          capturedAt: data.capturedAt,
          promptBytes: data.promptBytes,
          file: fileName,
        };
        if (data.hmacInvocationId !== undefined) indexEntry.hmacInvocationId = data.hmacInvocationId;
        appendFile(this.indexPath, `${JSON.stringify(indexEntry)}\n`, (appendErr) => {
          if (appendErr) this.log.warn(`[prompt-capture] index append failed: ${appendErr.message}`);
          this.pruneIfNeeded();
        });
      });
    });
  }

  /** 同步写入（测试/启动期）。 */
  captureSync(data: PromptCapture): string {
    try {
      const compressed = gzipSync(JSON.stringify(data));
      const fileName = `${data.captureId}.json.gz`;
      writeFileSync(join(this.payloadDir, fileName), compressed);
      const indexEntry: CaptureIndexEntry = {
        captureId: data.captureId,
        invocationId: data.invocationId,
        catId: data.catId,
        threadId: data.threadId,
        userId: data.userId,
        capturedAt: data.capturedAt,
        promptBytes: data.promptBytes,
        file: fileName,
      };
      if (data.hmacInvocationId !== undefined) indexEntry.hmacInvocationId = data.hmacInvocationId;
      appendFileSync(this.indexPath, `${JSON.stringify(indexEntry)}\n`);
      this.pruneIfNeeded();
      return data.captureId;
    } catch (err) {
      this.log.warn(`[prompt-capture] sync write failed: ${(err as Error).message}`);
      return data.captureId;
    }
  }

  /** 读取捕获（TTL + userId 校验）。 */
  read(captureId: string, userId?: string): PromptCapture | null {
    if (!isValidCaptureId(captureId)) return null;
    try {
      const filePath = join(this.payloadDir, `${captureId}.json.gz`);
      if (!existsSync(filePath)) return null;
      const compressed = readFileSync(filePath);
      const capture = JSON.parse(gunzipSync(compressed).toString('utf8')) as PromptCapture;
      if (capture.capturedAt < Date.now() - this.ttlMs) return null;
      if (userId && capture.userId !== userId) return null;
      return capture;
    } catch (err) {
      this.log.warn(`[prompt-capture] read failed: ${(err as Error).message}`);
      return null;
    }
  }

  listByInvocation(invocationId: string, userId?: string): CaptureIndexEntry[] {
    const cutoff = Date.now() - this.ttlMs;
    return this.readIndex().filter(
      (e) =>
        (e.invocationId === invocationId || e.hmacInvocationId === invocationId) &&
        e.capturedAt >= cutoff &&
        (!userId || e.userId === userId),
    );
  }

  listByThread(threadId: string, limit = 20, userId?: string): CaptureIndexEntry[] {
    const cutoff = Date.now() - this.ttlMs;
    return this.readIndex()
      .filter((e) => e.threadId === threadId && e.capturedAt >= cutoff && (!userId || e.userId === userId))
      .slice(-limit);
  }

  listRecent(limit = 20): CaptureIndexEntry[] {
    const cutoff = Date.now() - this.ttlMs;
    return this.readIndex()
      .filter((e) => e.capturedAt >= cutoff)
      .slice(-limit);
  }

  stats(): { entries: number; totalBytes: number } {
    const entries = this.readIndex();
    return { entries: entries.length, totalBytes: entries.reduce((s, e) => s + e.promptBytes, 0) };
  }

  prune(): number {
    const cutoff = Date.now() - this.ttlMs;
    const entries = this.readIndex();
    const keep: CaptureIndexEntry[] = [];
    let removed = 0;
    for (const entry of entries) {
      if (entry.capturedAt < cutoff) {
        this.deletePayload(entry.file);
        removed++;
      } else {
        keep.push(entry);
      }
    }
    if (keep.length > this.maxEntries) {
      const overflow = keep.splice(0, keep.length - this.maxEntries);
      for (const entry of overflow) {
        this.deletePayload(entry.file);
        removed++;
      }
    }
    if (removed > 0) this.writeIndex(keep);
    return removed;
  }

  private pruneIfNeeded(): void {
    try {
      if (this.readIndex().length > this.maxEntries + 10) this.prune();
    } catch {
      /* non-critical */
    }
  }

  private readIndex(): CaptureIndexEntry[] {
    try {
      if (!existsSync(this.indexPath)) return [];
      const content = readFileSync(this.indexPath, 'utf8');
      return content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CaptureIndexEntry);
    } catch {
      return [];
    }
  }

  private writeIndex(entries: CaptureIndexEntry[]): void {
    writeFileSync(this.indexPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }

  private deletePayload(fileName: string): void {
    try {
      unlinkSync(join(this.payloadDir, fileName));
    } catch {
      /* file gone */
    }
  }
}

// ── Bridge ──────────────────────────────────────────────────

export interface CaptureInput {
  catId: string;
  invocationId: string;
  threadId: string;
  userId: string;
  model: string;
  systemPrompt: string;
  missionPrefix?: string;
  userPrompt: string;
  effectivePrompt: string;
  injectionDecision: {
    isResume: boolean;
    canSkipOnResume: boolean;
    forceReinjection: boolean;
    injected: boolean;
  };
  /** F203 native L0 provider 标志（bridge 异步获取编译 L0 stamp 到 nativeSystemPrompt）。 */
  nativeL0Provider?: boolean;
  /** 测试桩：替换缺省 L0 fetcher（缺省不获取）。 */
  nativeL0Fetcher?: (catId: string, userId: string) => Promise<string>;
}

export interface DebugConfig {
  store?: PromptCaptureStoreConfig;
  log?: DebugLogger;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** debug 域（C33）：prompt 快照捕获 + 环形缓冲 */
    forgeDebug: ForgeDebugService;
  }
}

/**
 * debug 域服务 — 挂载 `ctx.forgeDebug`。
 * fire-and-forget 捕获（KD-28：绝不阻塞调用热路径）。
 */
export class ForgeDebugService extends Service {
  readonly store: PromptCaptureStore;
  private readonly log: DebugLogger;

  constructor(ctx: Context, config: DebugConfig = {}) {
    super(ctx, 'forgeDebug');
    this.log = config.log ?? console;
    this.store = new PromptCaptureStore({ ...config.store, log: this.log });
  }

  /** 若启用则异步捕获 prompt（不阻塞热路径）。 */
  capturePromptIfEnabled(input: CaptureInput): void {
    if (!isPromptCaptureEnabled(input.catId)) return;
    void this.runCapture(input);
  }

  private async runCapture(input: CaptureInput): Promise<void> {
    const diagnostics: string[] = [];
    let nativeSystemPrompt: string | undefined;
    let nativeSystemTokenEstimate: number | undefined;

    if (input.nativeL0Provider && input.nativeL0Fetcher) {
      try {
        const l0 = await input.nativeL0Fetcher(input.catId, input.userId);
        if (l0 && l0.trim().length > 0) {
          nativeSystemPrompt = l0;
          nativeSystemTokenEstimate = estimateTokens(l0);
        } else {
          diagnostics.push('native-l0-empty: fetcher returned empty string');
        }
      } catch (err) {
        diagnostics.push(`native-l0-fetch-failed: ${(err as Error).message}`);
      }
    }

    try {
      const tokenEstimate = estimateTokens(input.effectivePrompt);
      const totalTokenEstimate =
        nativeSystemTokenEstimate !== undefined ? tokenEstimate + nativeSystemTokenEstimate : tokenEstimate;
      const data: PromptCapture = {
        captureId: cryptoRandomUuid(),
        invocationId: input.invocationId,
        hmacInvocationId: pseudonymizeId(input.invocationId),
        catId: input.catId,
        threadId: input.threadId,
        userId: input.userId,
        model: input.model,
        capturedAt: Date.now(),
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        effectivePrompt: input.effectivePrompt,
        injectionDecision: input.injectionDecision,
        promptBytes: Buffer.byteLength(input.effectivePrompt, 'utf8'),
        tokenEstimate,
        totalTokenEstimate,
      };
      if (input.missionPrefix !== undefined) data.missionPrefix = input.missionPrefix;
      if (nativeSystemPrompt !== undefined && nativeSystemTokenEstimate !== undefined) {
        data.nativeSystemPrompt = nativeSystemPrompt;
        data.nativeSystemPromptSource = 'f203-l0';
        data.nativeSystemTokenEstimate = nativeSystemTokenEstimate;
      }
      if (diagnostics.length > 0) data.captureDiagnostics = diagnostics;
      this.store.captureAsync(data);
    } catch (err) {
      this.log.warn(`[prompt-capture] capture failed (non-fatal): ${(err as Error).message}`);
    }
  }
}

/** 简单 UUID v4（无 crypto.randomUUID 环境回退）。 */
function cryptoRandomUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return '00000000-0000-4000-8000-000000000000'.replace(/[018]/g, (c) => {
    const n = Number.parseInt(c, 10);
    return (n ^ (Math.random() * 16)).toString(16);
  });
}

export default ForgeDebugService;
