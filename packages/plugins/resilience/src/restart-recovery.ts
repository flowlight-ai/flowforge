/**
 * RestartRecoveryPipeline — restart recovery core.
 *
 * Compact core mapped from flowforge Python legacy core/restart_recovery.py
 * (F25). The legacy module targets Redis + AOF/RDB files directly; here
 * the same three-phase contract runs against an injected KeyValueStore so
 * hosts can bind Redis or any other backend:
 * - Phase A: sweep stale records (status='running' with TTL < 0); mark,
 *   never delete (audit trail preserved).
 * - Phase A+: publish a restart_notification event.
 * - Phase B: snapshot queue state, then replay journal entries recorded
 *   after the snapshot tail position. TTL compliance enforced:
 *   default 24h, max 7 days, min 60s, zero-TTL forbidden.
 */

import { randomUUID } from 'node:crypto'

export interface StaleRecord {
  key: string
  originalStatus: string
  /** TTL at sweep time; negative means expired or no explicit TTL. */
  ttlSeconds: number
  createdAt: number
  sweptAt: number
}

export interface RestartNotification {
  restartId: string
  sweptRecordsCount: number
  timestamp: number
  operatorUserId: string
}

export interface RestartRecoveryConfig {
  defaultTtlSeconds: number
  maxTtlSeconds: number
  minTtlSeconds: number
  forbidZeroTtl: boolean
}

export const DEFAULT_RESTART_RECOVERY_CONFIG: RestartRecoveryConfig = {
  defaultTtlSeconds: 86400,
  maxTtlSeconds: 604800,
  minTtlSeconds: 60,
  forbidZeroTtl: true,
}

export interface QueueEntryState {
  value: unknown
  ttlSeconds: number
  status: string
}

export interface QueueStateSnapshot {
  snapshotId: string
  takenAt: number
  queueStates: Record<string, QueueEntryState>
  /** Journal offset at snapshot time; replay starts from here. */
  aofTailPosition: number
}

/** Journal entry appended after every queue mutation (AOF analog). */
export interface JournalEntry {
  key: string
  value: unknown
  ttlSeconds: number
  status: string
  position: number
}

/** Minimal store contract the pipeline needs (Redis-like). */
export interface RestartRecoveryStore {
  keys(): Promise<string[]>
  ttl(key: string): Promise<number>
  getStatus(key: string): Promise<string | null>
  markStale(key: string): Promise<void>
}

export interface RestartEventBus {
  emit(eventType: string, payload: Record<string, unknown>): unknown
}

export interface RestartRecoveryPipelineOptions {
  config?: Partial<RestartRecoveryConfig>
  operatorUserId?: string
  /** Injectable clock (epoch seconds). */
  now?: () => number
  idFactory?: () => string
}

export class RestartRecoveryPipeline {
  private readonly config: RestartRecoveryConfig
  private readonly operatorUserId: string
  private readonly now: () => number
  private readonly idFactory: () => string

  constructor(options: RestartRecoveryPipelineOptions = {}) {
    this.config = { ...DEFAULT_RESTART_RECOVERY_CONFIG, ...options.config }
    if (this.config.defaultTtlSeconds < 1) throw new Error('default_ttl_seconds must be >= 1')
    if (this.config.maxTtlSeconds < 1) throw new Error('max_ttl_seconds must be >= 1')
    if (this.config.minTtlSeconds < 1) throw new Error('min_ttl_seconds must be >= 1')
    this.operatorUserId = options.operatorUserId ?? 'system'
    this.now = options.now ?? (() => Date.now() / 1000)
    this.idFactory = options.idFactory ?? randomUUID
  }

  /** Phase A: sweep expired running records; mark stale, never delete. */
  async sweepStaleRecords(store: RestartRecoveryStore): Promise<StaleRecord[]> {
    const stale: StaleRecord[] = []
    for (const key of await store.keys()) {
      const ttlSeconds = await store.ttl(key)
      if (ttlSeconds >= 0) continue
      const status = await store.getStatus(key)
      if (status !== 'running') continue
      await store.markStale(key)
      stale.push({
        key,
        originalStatus: status,
        ttlSeconds,
        createdAt: this.now(),
        sweptAt: this.now(),
      })
    }
    return stale
  }

  /** Phase A+: publish the restart notification event. */
  async notifyRestart(
    eventBus: RestartEventBus | undefined,
    sweptRecordsCount: number,
  ): Promise<RestartNotification> {
    const notification: RestartNotification = {
      restartId: this.idFactory(),
      sweptRecordsCount,
      timestamp: this.now(),
      operatorUserId: this.operatorUserId,
    }
    if (eventBus) {
      try {
        await eventBus.emit('restart_notification', {
          restart_id: notification.restartId,
          swept_records_count: notification.sweptRecordsCount,
          timestamp: notification.timestamp,
          operator_user_id: notification.operatorUserId,
        })
      } catch {
        // emit failures are non-fatal
      }
    }
    return notification
  }

  /** Phase B (persist): snapshot every queue entry plus journal tail. */
  takeSnapshot(
    queueStates: Record<string, QueueEntryState>,
    journalLength: number,
  ): QueueStateSnapshot {
    return {
      snapshotId: this.idFactory(),
      takenAt: this.now(),
      queueStates: { ...queueStates },
      aofTailPosition: journalLength,
    }
  }

  /** Phase B (replay): apply journal entries recorded after the tail. */
  replayJournal(
    snapshot: QueueStateSnapshot,
    journal: JournalEntry[],
  ): Record<string, QueueEntryState> {
    const states: Record<string, QueueEntryState> = { ...snapshot.queueStates }
    for (const entry of journal) {
      if (entry.position < snapshot.aofTailPosition) continue
      states[entry.key] = {
        value: entry.value,
        ttlSeconds: entry.ttlSeconds,
        status: entry.status,
      }
    }
    return states
  }

  /**
   * TTL compliance audit: reports keys violating min/max bounds and, when
   * forbidZeroTtl is on, keys without a positive explicit TTL (red line).
   */
  validateTtlCompliance(store: RestartRecoveryStore): Promise<string[]> {
    return this.collectTtlViolations(store)
  }

  private async collectTtlViolations(store: RestartRecoveryStore): Promise<string[]> {
    const violations: string[] = []
    for (const key of await store.keys()) {
      const ttlSeconds = await store.ttl(key)
      if (this.config.forbidZeroTtl && ttlSeconds <= 0) {
        violations.push(`${key}: zero/missing TTL forbidden`)
        continue
      }
      if (ttlSeconds > 0 && ttlSeconds < this.config.minTtlSeconds) {
        violations.push(`${key}: TTL ${ttlSeconds}s below minimum ${this.config.minTtlSeconds}s`)
      }
      if (ttlSeconds > this.config.maxTtlSeconds) {
        violations.push(`${key}: TTL ${ttlSeconds}s above maximum ${this.config.maxTtlSeconds}s`)
      }
    }
    return violations
  }

  /** Full pipeline: sweep → notify → snapshot (journal replay is host-driven). */
  async runFullPipeline(
    store: RestartRecoveryStore,
    eventBus?: RestartEventBus,
    queueStates: Record<string, QueueEntryState> = {},
    journal: JournalEntry[] = [],
  ): Promise<{
    staleRecords: StaleRecord[]
    notification: RestartNotification
    snapshot: QueueStateSnapshot
  }> {
    const staleRecords = await this.sweepStaleRecords(store)
    const notification = await this.notifyRestart(eventBus, staleRecords.length)
    const snapshot = this.takeSnapshot(queueStates, journal.length)
    return { staleRecords, notification, snapshot }
  }
}
