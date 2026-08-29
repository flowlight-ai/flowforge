/**
 * InjectionTraceStore — C41（F237 Trace v0）。
 *
 * 注入追踪双层持久化：
 *   Layer 1: InjectionTraceSummary — 常驻（TTL=0）
 *   Layer 2: InjectionTraceDetail — 短 TTL（默认 7 天）
 *
 * 插件化改造决策（相对 clowder-ai 原版）：
 *   - clowder 依赖 Redis（RedisClient），flowforge 惯例为可注入后端端口：
 *     `TraceBackend` 接口（get/set/del/zadd/zrevrange/zcard），
 *     内置内存（MemoryTraceBackend）与 JSONL（JsonlTraceBackend）实现；
 *     宿主可注入自有后端（如 SQLite/Redis 适配器）
 *   - TTL 语义：set 时携带 expireSeconds（0 = 永久），由后端决定是否执行
 *     （JSONL 忽略；内存实现带惰性过期清理）
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { InjectionTraceDetail, InjectionTraceSummary } from './types.js';

// ---------------------------------------------------------------------------
// TraceBackend 端口 — 可注入的持久化后端
// ---------------------------------------------------------------------------

export interface TraceBackendEntry {
  value: string;
  /** 过期秒数（0 = 永不过期）。 */
  expireSeconds: number;
}

export interface TraceBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expireSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** zset 语义：member 按 score 升序存储。 */
  zadd(key: string, score: number, member: string): Promise<void>;
  /** zset 逆序取区间 [offset, offset+count-1]（score 降序）。 */
  zrevrange(key: string, offset: number, count: number): Promise<string[]>;
  zcard(key: string): Promise<number>;
  zrem(key: string, member: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// 内存后端（测试/单进程缺省）
// ---------------------------------------------------------------------------

interface MemoryEntry {
  value: string;
  expiresAt: number; // 0 = 永久
}

export class MemoryTraceBackend implements TraceBackend {
  private readonly store = new Map<string, MemoryEntry>();
  private readonly sorted = new Map<string, Map<number, Set<string>>>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, expireSeconds = 0): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: expireSeconds > 0 ? Date.now() + expireSeconds * 1000 : 0,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    if (!this.sorted.has(key)) this.sorted.set(key, new Map());
    const map = this.sorted.get(key)!;
    for (const [existingScore, members] of map) {
      if (members.has(member)) {
        members.delete(member);
        if (members.size === 0) map.delete(existingScore);
        break;
      }
    }
    if (!map.has(score)) map.set(score, new Set());
    map.get(score)!.add(member);
  }

  async zrevrange(key: string, offset: number, count: number): Promise<string[]> {
    const map = this.sorted.get(key);
    if (!map) return [];
    const sortedScores = [...map.keys()].sort((a, b) => b - a);
    const members: string[] = [];
    for (const score of sortedScores) {
      for (const member of [...map.get(score)!].sort()) {
        members.push(member);
      }
    }
    return members.slice(offset, offset + count);
  }

  async zcard(key: string): Promise<number> {
    const map = this.sorted.get(key);
    if (!map) return 0;
    let total = 0;
    for (const members of map.values()) total += members.size;
    return total;
  }

  async zrem(key: string, member: string): Promise<void> {
    const map = this.sorted.get(key);
    if (!map) return;
    for (const [score, members] of map) {
      if (members.delete(member) && members.size === 0) map.delete(score);
    }
  }

  /** 测试辅助：清空全部数据。 */
  clear(): void {
    this.store.clear();
    this.sorted.clear();
  }
}

// ---------------------------------------------------------------------------
// JSONL 后端（文件持久化，TTL 语义忽略 — 永久保留）
// ---------------------------------------------------------------------------

/**
 * JSONL 文件后端：每个 key 一个 `<key>.jsonl` 追加文件。
 * 适合调试/审计场景；生产高吞吐请注入 Redis/SQLite 适配器。
 */
export class JsonlTraceBackend implements TraceBackend {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  private filePath(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9:_-]/g, '_');
    return join(this.dir, `${safe}.jsonl`);
  }

  async get(key: string): Promise<string | null> {
    const file = this.filePath(key);
    if (!existsSync(file)) return null;
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    const last = lines[lines.length - 1];
    return last ? (JSON.parse(last) as { value: string }).value : null;
  }

  async set(key: string, value: string, _expireSeconds = 0): Promise<void> {
    const file = this.filePath(key);
    writeFileSync(file, `${JSON.stringify({ value, ts: Date.now() })}\n`, { flag: 'a' });
  }

  async del(key: string): Promise<void> {
    const file = this.filePath(key);
    if (existsSync(file)) {
      // 空文件表示删除标记（zrem 由宿主索引删除语义覆盖）
      writeFileSync(file, '');
    }
  }

  async zadd(_key: string, _score: number, _member: string): Promise<void> {
    // 无 zset 结构 — 忽略（JSONL 定位为调试后端）
  }

  async zrevrange(_key: string, _offset: number, _count: number): Promise<string[]> {
    return [];
  }

  async zcard(_key: string): Promise<number> {
    return 0;
  }

  async zrem(_key: string, _member: string): Promise<void> {
    // 无 zset 结构 — 忽略
  }
}

// ---------------------------------------------------------------------------
// InjectionTraceStore
// ---------------------------------------------------------------------------

const SUMMARY_PREFIX = 'injection-trace-summary:';
const DETAIL_PREFIX = 'injection-trace-detail:';
const INDEX_PREFIX = 'injection-trace-index:';

function summaryKey(threadId: string, turnId: string): string {
  return `${SUMMARY_PREFIX}${threadId}:${turnId}`;
}
function detailKey(threadId: string, turnId: string): string {
  return `${DETAIL_PREFIX}${threadId}:${turnId}`;
}
function indexKey(threadId: string): string {
  return `${INDEX_PREFIX}${threadId}`;
}

const DEFAULT_DETAIL_TTL_SECONDS = 7 * 24 * 60 * 60;

export class InjectionTraceStore {
  private readonly detailTtl: number;

  constructor(
    private readonly backend: TraceBackend,
    options?: { detailTtlSeconds?: number },
  ) {
    this.detailTtl = options?.detailTtlSeconds ?? DEFAULT_DETAIL_TTL_SECONDS;
  }

  /** 持久化 summary（常驻）+ detail（TTL）+ 线程索引（zset）。 */
  async persist(summary: InjectionTraceSummary, detail: InjectionTraceDetail): Promise<void> {
    const sKey = summaryKey(summary.threadId, summary.turnId);
    const dKey = detailKey(detail.threadId, detail.turnId);
    const iKey = indexKey(summary.threadId);
    await this.backend.set(sKey, JSON.stringify(summary));
    await this.backend.set(dKey, JSON.stringify(detail), this.detailTtl);
    await this.backend.zadd(iKey, summary.timestamp, summary.turnId);
  }

  async getSummary(threadId: string, turnId: string): Promise<InjectionTraceSummary | null> {
    const raw = await this.backend.get(summaryKey(threadId, turnId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as InjectionTraceSummary;
    } catch {
      return null;
    }
  }

  async getDetail(threadId: string, turnId: string): Promise<InjectionTraceDetail | null> {
    const raw = await this.backend.get(detailKey(threadId, turnId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as InjectionTraceDetail;
    } catch {
      return null;
    }
  }

  /** 线程的 turnId 索引（score 降序，最新在前）。 */
  async listTurnIds(
    threadId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ turnIds: string[]; total: number }> {
    const iKey = indexKey(threadId);
    const total = await this.backend.zcard(iKey);
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;
    const turnIds = await this.backend.zrevrange(iKey, offset, limit);
    return { turnIds, total };
  }

  /** 线程的 summary 列表（分页）。 */
  async listSummaries(
    threadId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ summaries: InjectionTraceSummary[]; total: number }> {
    const { turnIds, total } = await this.listTurnIds(threadId, options);
    const summaries: InjectionTraceSummary[] = [];
    for (const turnId of turnIds) {
      const summary = await this.getSummary(threadId, turnId);
      if (summary) summaries.push(summary);
    }
    return { summaries, total };
  }

  /** 删除单 turn 的 summary + detail + 索引项。 */
  async deleteTurn(threadId: string, turnId: string): Promise<void> {
    await this.backend.del(summaryKey(threadId, turnId));
    await this.backend.del(detailKey(threadId, turnId));
    await this.backend.zrem(indexKey(threadId), turnId);
  }
}
