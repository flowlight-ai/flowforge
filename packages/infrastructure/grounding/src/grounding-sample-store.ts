/**
 * F167 Phase O PR-O2b: Bounded Sample Store — 有界采样存储。
 *
 * 采样规则（spec R2 + R3）：
 *   - mismatch & wouldBlock: 100% 保留
 *   - insufficient: 每 resolver×thread×day 上限 3（防洪水）
 *   - verified: 1/N 采样率 + 全局日上限
 *
 * 进程内（内存）— 重启清空；Redis 持久化随 PR-O4 加固再补。
 * 移植自 clowder-ai `infrastructure/grounding/grounding-sample-store.ts`。
 */

import type { ClaimGroundingEvent } from './types.ts';

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface GroundingSampleStoreOptions {
  /** Maximum total events stored (FIFO eviction on overflow). Default: 1000. */
  maxTotal?: number;
  /** Insufficient cap per resolver×thread×day. Default: 3. */
  insufficientCap?: number;
  /** Verified sampling rate (1 in N). Default: 20. */
  verifiedSampleRate?: number;
  /** Verified global daily cap. Default: 50. */
  verifiedDailyCap?: number;
  /** Injectable sampler for verified events (deterministic testing). */
  shouldSampleVerified?: () => boolean;
}

export class GroundingSampleStore {
  private readonly samples: ClaimGroundingEvent[] = [];
  private readonly maxTotal: number;
  private readonly insufficientCap: number;
  private readonly verifiedDailyCap: number;
  private readonly shouldSampleVerified: () => boolean;
  private readonly insufficientCounts = new Map<string, number>();
  private readonly verifiedDayCounts = new Map<string, number>();
  private dropped = 0;

  constructor(opts: GroundingSampleStoreOptions = {}) {
    this.maxTotal = opts.maxTotal ?? 1000;
    this.insufficientCap = opts.insufficientCap ?? 3;
    this.verifiedDailyCap = opts.verifiedDailyCap ?? 50;
    const rate = opts.verifiedSampleRate ?? 20;
    this.shouldSampleVerified = opts.shouldSampleVerified ?? (() => Math.random() < 1 / rate);
  }

  record(event: ClaimGroundingEvent, wouldBlock: boolean): void {
    if (this.shouldRecord(event, wouldBlock)) {
      this.push(event);
    } else {
      this.dropped++;
    }
  }

  getSamples(): ClaimGroundingEvent[] {
    return [...this.samples];
  }

  getStats(): { stored: number; dropped: number } {
    return { stored: this.samples.length, dropped: this.dropped };
  }

  private shouldRecord(event: ClaimGroundingEvent, wouldBlock: boolean): boolean {
    // Rule 1: mismatch or wouldBlock → always keep (100%)
    if (event.verdict === 'mismatch' || wouldBlock) return true;
    // Rule 2: insufficient → cap 3 per resolver×thread×day
    if (event.verdict === 'insufficient') return this.checkInsufficientCap(event);
    // Rule 3: verified → 1/N rate + daily cap
    if (event.verdict === 'verified') return this.checkVerifiedSampling(event);
    return true;
  }

  private checkInsufficientCap(event: ClaimGroundingEvent): boolean {
    const key = `${event.resolver}:${event.threadId}:${dayKey(event.ts)}`;
    const count = this.insufficientCounts.get(key) ?? 0;
    if (count >= this.insufficientCap) return false;
    this.insufficientCounts.set(key, count + 1);
    return true;
  }

  private checkVerifiedSampling(event: ClaimGroundingEvent): boolean {
    const day = dayKey(event.ts);
    const dayCount = this.verifiedDayCounts.get(day) ?? 0;
    if (dayCount >= this.verifiedDailyCap) return false;
    if (!this.shouldSampleVerified()) return false;
    this.verifiedDayCounts.set(day, dayCount + 1);
    return true;
  }

  private push(event: ClaimGroundingEvent): void {
    if (this.samples.length >= this.maxTotal) {
      this.samples.shift();
      this.dropped++;
    }
    this.samples.push(event);
  }
}
