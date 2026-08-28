/**
 * @flowforge/cats-human-disposition — F281 ledger（双索引 zset + 严格游标分页）。
 *
 * TS 移植自 clowder-ai `domains/human-disposition/HumanDispositionLedger.ts`。
 * 插件化改造：Redis 依赖剥离为 `HumanDispositionLedgerKV` 注入接口（host 提供持久实现），
 * 默认 `MemoryHumanDispositionLedgerKV`（含 CAS appendReceipt，对齐 lua 语义）。
 *
 * @module @flowforge/cats-human-disposition/ledger
 */

import { z } from 'zod';
import {
  buildHumanDispositionLedgerReceipt,
  humanDispositionLedgerEntrySchema,
  humanDispositionLedgerReceiptSchema,
} from './types.js';
import type {
  HumanDispositionLedgerEntry,
  HumanDispositionLedgerReceipt,
} from './types.js';
import { HumanDispositionKeys } from './keys.js';

const cursorSchema = z
  .object({
    decidedAt: z.number().finite().nonnegative(),
    sourceRef: z.string().trim().min(1).max(500),
  })
  .strict();

const pageOptionsSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    scanLimit: z.number().int().min(1).max(500).optional(),
    cursor: cursorSchema.optional(),
  })
  .strict();

export type HumanDispositionLedgerCursor = z.infer<typeof cursorSchema>;

export interface HumanDispositionLedgerPageOptions {
  limit: number;
  scanLimit?: number;
  cursor?: HumanDispositionLedgerCursor;
}

export interface HumanDispositionLedgerPage {
  entries: HumanDispositionLedgerEntry[];
  scannedCount: number;
  nextCursor?: HumanDispositionLedgerCursor;
}

export interface HumanDispositionLedgerQueryOptions extends HumanDispositionLedgerPageOptions {
  interactionKind?: string;
  subjectRef?: string;
}

export class HumanDispositionLedgerCursorError extends Error {
  constructor() {
    super('human disposition ledger cursor does not match immutable index truth');
    this.name = 'HumanDispositionLedgerCursorError';
  }
}

export class HumanDispositionLedgerInvariantError extends Error {
  constructor() {
    super('human disposition ledger receipt cannot hydrate exact producer truth');
    this.name = 'HumanDispositionLedgerInvariantError';
  }
}

export interface HumanDispositionProducerEntryLoader {
  loadEntry(input: {
    ownerUserId: string;
    receipt: HumanDispositionLedgerReceipt;
  }): Promise<HumanDispositionLedgerEntry | null>;
}

/** F281 ledger KV 端口：receipts hash + episodes/subject zset + CAS append。 */
export interface HumanDispositionLedgerKV {
  hget(key: string, field: string): Promise<string | null> | string | null;
  /** zrevrange WITHSCORES 语义：扁平 [member, score, member, score, ...]。 */
  zrevrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> | string[];
  zrevrank(key: string, member: string): Promise<number | null> | number | null;
  zscore(key: string, member: string): Promise<string | null> | string | null;
  /**
   * CAS 追加 receipt（对齐 `HUMAN_DISPOSITION_RECEIPT_APPEND_LUA` 语义）：
   * 返回 'APPLIED' | 'REPLAY' | 'CONFLICT' | 'TYPE_CONFLICT' | 'INVALID_RECEIPT'。
   */
  appendReceipt(args: {
    keys: [string, string, string];
    arguments: [string, string, string, string];
  }): Promise<string> | string;
}

/** 内存 KV 实现：receipts hash Map + 双索引 zset Map，append 同步 CAS。 */
export class MemoryHumanDispositionLedgerKV implements HumanDispositionLedgerKV {
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly zsets = new Map<string, Map<string, number>>();

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async zrevrange(key: string, start: number, stop: number, withScores = false): Promise<string[]> {
    const zset = this.zsets.get(key);
    if (!zset || zset.size === 0) return [];
    const entries = [...zset.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const normalizedStart = start < 0 ? Math.max(entries.length + start, 0) : start;
    const normalizedStop = stop < 0 ? Math.max(entries.length + stop, 0) : stop;
    const slice = entries.slice(normalizedStart, normalizedStop + 1);
    if (!withScores) return slice.map(([member]) => member);
    return slice.flatMap(([member, score]) => [member, String(score)]);
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    const zset = this.zsets.get(key);
    if (!zset || !zset.has(member)) return null;
    const sorted = [...zset.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const rank = sorted.findIndex(([m]) => m === member);
    return rank === -1 ? null : rank;
  }

  async zscore(key: string, member: string): Promise<string | null> {
    const score = this.zsets.get(key)?.get(member);
    return score === undefined ? null : String(score);
  }

  async appendReceipt(args: {
    keys: [string, string, string];
    arguments: [string, string, string, string];
  }): Promise<string> {
    const [receiptKey, ownerIndexKey, subjectIndexKey] = args.keys;
    const [receiptJson, sourceRef, subjectRef, scoreText] = args.arguments;

    // INVALID_RECEIPT 校验（对齐 lua preflight）
    let receipt: unknown;
    try {
      receipt = JSON.parse(receiptJson);
    } catch {
      return 'INVALID_RECEIPT';
    }
    const score = Number(scoreText);
    if (typeof receipt !== 'object' || receipt === null || !Number.isFinite(score)) {
      return 'INVALID_RECEIPT';
    }
    const fields = Object.entries(receipt as Record<string, unknown>).filter(([k]) => k !== 'sourceRef' && k !== 'subjectRef' && k !== 'interactionKind' && k !== 'decidedAt');
    const r = receipt as Record<string, unknown>;
    if (
      fields.length !== 0 ||
      typeof r.sourceRef !== 'string' || r.sourceRef === '' ||
      typeof r.subjectRef !== 'string' || r.subjectRef === '' ||
      typeof r.interactionKind !== 'string' || r.interactionKind === '' ||
      typeof r.decidedAt !== 'number' ||
      r.sourceRef !== sourceRef || r.subjectRef !== subjectRef || r.decidedAt !== score
    ) {
      return 'INVALID_RECEIPT';
    }

    // CAS preflight
    const existing = this.hashes.get(receiptKey)?.get(sourceRef);
    const ownerScore = this.zsets.get(ownerIndexKey)?.get(sourceRef);
    const subjectScore = this.zsets.get(subjectIndexKey)?.get(sourceRef);
    if (existing !== undefined) {
      if (existing === receiptJson && ownerScore === score && subjectScore === score) return 'REPLAY';
      return 'CONFLICT';
    }
    if (ownerScore !== undefined || subjectScore !== undefined) return 'CONFLICT';

    // write
    let hash = this.hashes.get(receiptKey);
    if (!hash) {
      hash = new Map();
      this.hashes.set(receiptKey, hash);
    }
    hash.set(sourceRef, receiptJson);
    for (const [indexKey] of [[ownerIndexKey], [subjectIndexKey]] as const) {
      let zset = this.zsets.get(indexKey);
      if (!zset) {
        zset = new Map();
        this.zsets.set(indexKey, zset);
      }
      zset.set(sourceRef, score);
    }
    return 'APPLIED';
  }
}

interface LedgerListBehavior {
  strictHydration?: boolean;
  interactionKind?: string;
}

function indexedCursor(raw: string[], index: number): HumanDispositionLedgerCursor | null {
  const sourceRef = raw[index * 2];
  const scoreText = raw[index * 2 + 1];
  if (sourceRef === undefined || scoreText === undefined) return null;
  return { decidedAt: Number(scoreText), sourceRef };
}

function shouldIncludeEntry(
  entry: HumanDispositionLedgerEntry | null,
  behavior: LedgerListBehavior,
): entry is HumanDispositionLedgerEntry {
  if (!entry && behavior.strictHydration) throw new HumanDispositionLedgerInvariantError();
  return entry !== null && (!behavior.interactionKind || entry.episode.interactionKind === behavior.interactionKind);
}

export class HumanDispositionLedger {
  constructor(
    private readonly kv: HumanDispositionLedgerKV,
    private readonly producerLoader: HumanDispositionProducerEntryLoader,
  ) {}

  async get(ownerUserId: string, sourceRef: string): Promise<HumanDispositionLedgerEntry | null> {
    const raw = await this.kv.hget(HumanDispositionKeys.receipts(ownerUserId), sourceRef);
    if (!raw) return null;
    const receipt = humanDispositionLedgerReceiptSchema.safeParse(this.parseJson(raw));
    if (!receipt.success || receipt.data.sourceRef !== sourceRef) return null;
    if (!(await this.hasExactIndexes(ownerUserId, receipt.data))) return null;
    return this.hydrate(ownerUserId, receipt.data);
  }

  async listByOwner(
    ownerUserId: string,
    options: HumanDispositionLedgerPageOptions,
  ): Promise<HumanDispositionLedgerPage> {
    return this.listIndex(ownerUserId, HumanDispositionKeys.episodes(ownerUserId), options);
  }

  async listBySubject(
    ownerUserId: string,
    subjectRef: string,
    options: HumanDispositionLedgerPageOptions,
  ): Promise<HumanDispositionLedgerPage> {
    return this.listIndex(ownerUserId, HumanDispositionKeys.subject(ownerUserId, subjectRef), options, subjectRef);
  }

  async query(ownerUserId: string, options: HumanDispositionLedgerQueryOptions): Promise<HumanDispositionLedgerPage> {
    const { interactionKind, subjectRef, ...pageOptions } = options;
    const indexKey = subjectRef
      ? HumanDispositionKeys.subject(ownerUserId, subjectRef)
      : HumanDispositionKeys.episodes(ownerUserId);
    const behavior: LedgerListBehavior = { strictHydration: true };
    if (interactionKind !== undefined) behavior.interactionKind = interactionKind;
    return this.listIndex(ownerUserId, indexKey, pageOptions, subjectRef, behavior);
  }

  private async listIndex(
    ownerUserId: string,
    indexKey: string,
    optionsInput: HumanDispositionLedgerPageOptions,
    expectedSubjectRef?: string,
    behavior: LedgerListBehavior = {},
  ): Promise<HumanDispositionLedgerPage> {
    const options = pageOptionsSchema.parse(optionsInput);
    const scanLimit = options.scanLimit ?? Math.min(Math.max(options.limit * 4, 20), 500);
    const startRank = await this.resolveStartRank(
      ownerUserId,
      indexKey,
      options.cursor,
      expectedSubjectRef,
      behavior.strictHydration === true,
    );
    if (startRank === null) return { entries: [], scannedCount: 0 };

    const raw = await this.kv.zrevrange(indexKey, startRank, startRank + scanLimit, true);
    const availablePairs = Math.floor(raw.length / 2);
    const processCount = Math.min(availablePairs, scanLimit);
    const entries: HumanDispositionLedgerEntry[] = [];
    let scannedCount = 0;
    let lastScanned: HumanDispositionLedgerCursor | undefined;
    let hasMore = availablePairs > processCount;

    for (let index = 0; index < processCount; index += 1) {
      const cursor = indexedCursor(raw, index);
      if (!cursor) break;
      scannedCount += 1;
      lastScanned = cursor;

      const entry = await this.hydrateIndexedReceipt(ownerUserId, lastScanned, expectedSubjectRef);
      if (shouldIncludeEntry(entry, behavior)) entries.push(entry);

      if (entries.length === options.limit) {
        hasMore = hasMore || index + 1 < availablePairs;
        break;
      }
    }

    return {
      entries,
      scannedCount,
      ...(hasMore && lastScanned ? { nextCursor: lastScanned } : {}),
    };
  }

  private async resolveStartRank(
    ownerUserId: string,
    indexKey: string,
    cursor: HumanDispositionLedgerCursor | undefined,
    expectedSubjectRef: string | undefined,
    strict: boolean,
  ): Promise<number | null> {
    if (!cursor) return 0;
    const [rank, score] = await Promise.all([
      this.kv.zrevrank(indexKey, cursor.sourceRef),
      this.kv.zscore(indexKey, cursor.sourceRef),
    ]);
    if (rank === null || score === null || Number(score) !== cursor.decidedAt) {
      if (strict) throw new HumanDispositionLedgerCursorError();
      return null;
    }
    if (strict) {
      const entry = await this.hydrateIndexedReceipt(ownerUserId, cursor, expectedSubjectRef);
      if (!entry) throw new HumanDispositionLedgerInvariantError();
    }
    return rank + 1;
  }

  private async hydrateIndexedReceipt(
    ownerUserId: string,
    cursor: HumanDispositionLedgerCursor,
    expectedSubjectRef?: string,
  ): Promise<HumanDispositionLedgerEntry | null> {
    const receiptRaw = await this.kv.hget(HumanDispositionKeys.receipts(ownerUserId), cursor.sourceRef);
    const receipt = humanDispositionLedgerReceiptSchema.safeParse(this.parseJson(receiptRaw));
    if (
      !receipt.success ||
      receipt.data.sourceRef !== cursor.sourceRef ||
      receipt.data.decidedAt !== cursor.decidedAt
    ) {
      return null;
    }
    if (expectedSubjectRef !== undefined && receipt.data.subjectRef !== expectedSubjectRef) return null;
    if (!(await this.hasExactIndexes(ownerUserId, receipt.data))) return null;
    return this.hydrate(ownerUserId, receipt.data);
  }

  private async hasExactIndexes(ownerUserId: string, receipt: HumanDispositionLedgerReceipt): Promise<boolean> {
    const [ownerScore, subjectScore] = await Promise.all([
      this.kv.zscore(HumanDispositionKeys.episodes(ownerUserId), receipt.sourceRef),
      this.kv.zscore(HumanDispositionKeys.subject(ownerUserId, receipt.subjectRef), receipt.sourceRef),
    ]);
    return (
      ownerScore !== null &&
      subjectScore !== null &&
      Number(ownerScore) === receipt.decidedAt &&
      Number(subjectScore) === receipt.decidedAt
    );
  }

  private async hydrate(
    ownerUserId: string,
    receipt: HumanDispositionLedgerReceipt,
  ): Promise<HumanDispositionLedgerEntry | null> {
    try {
      const loaded = await this.producerLoader.loadEntry({ ownerUserId, receipt });
      const entry = humanDispositionLedgerEntrySchema.safeParse(loaded);
      if (!entry.success || entry.data.episode.ownerUserId !== ownerUserId) return null;
      const canonicalReceipt = buildHumanDispositionLedgerReceipt(entry.data);
      return JSON.stringify(canonicalReceipt) === JSON.stringify(receipt) ? entry.data : null;
    } catch {
      return null;
    }
  }

  private parseJson(raw: string | null): unknown {
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
