/**
 * @flowforge/cats-guides — ConciergeInvestigationJobStore（F229 Phase B2）。
 *
 * InvestigationJob 持久化。TTL=0（铁律 5 LL-048）。
 * 三件模式：port interface + KV 实现 + Memory 实现。
 *
 * 状态机：queued → running → done | failed | cancelled
 *         queued → cancelled
 *
 * INV I1: queued/running → cancelled（fail-closed on deadline）
 * INV I2: running → done 必须有 report
 * INV I3: 60s deadline 到期自动 cancel（不能 stuck running）
 *
 * 插件化改造：clowder Redis Lua CAS → KV 后端 read-modify-write 由注入端保证
 * 原子性（sqlite BEGIN IMMEDIATE 事务 / redis EVAL）；内存实现同步 CAS。
 *
 * @module @flowforge/cats-guides/concierge/investigation-job-store
 */

import type { InvestigationJob, InvestigationJobStatus, InvestigationReport } from '../models.js';
import { ConciergeKeys } from './keys.js';
import type { ConciergeKeyValueStore } from './kv-store.js';
import { MemoryConciergeKeyValueStore } from './kv-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: ReadonlySet<InvestigationJobStatus> = new Set(['done', 'failed', 'cancelled']);

/**
 * Check if a job has exceeded its deadline and should be cancelled.
 * Only returns true for non-terminal statuses (queued/running).
 */
export function isJobExpired(job: InvestigationJob, now: number = Date.now()): boolean {
  if (TERMINAL_STATUSES.has(job.status)) return false;
  return now >= job.deadline;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IConciergeInvestigationJobStore {
  /** Create a new investigation job (status = 'queued') */
  create(job: InvestigationJob): Promise<void>;
  /** Get job by ID */
  get(jobId: string): Promise<InvestigationJob | null>;
  /** Get job by triagePlanId (1:1 relationship) */
  getByTriagePlan(triagePlanId: string): Promise<InvestigationJob | null>;
  /** Update job status (state transition) — sets timestamps */
  updateStatus(jobId: string, status: InvestigationJobStatus): Promise<void>;
  /**
   * Atomic compare-and-swap status transition.
   * Returns true if the job existed AND its current status matched `expectedStatus`,
   * in which case it is atomically updated to `newStatus`.
   */
  claimTransition(
    jobId: string,
    expectedStatus: InvestigationJobStatus,
    newStatus: InvestigationJobStatus,
  ): Promise<boolean>;
  /** Set investigation report on job */
  setReport(jobId: string, report: InvestigationReport): Promise<void>;
  /**
   * Atomic CAS: running → done WITH report in a single write.
   * Enforces INV I2 (done ⇒ report): status never reaches 'done'
   * unless the report is persisted in the same atomic operation.
   * Returns true if the job existed AND was 'running', in which case
   * both status='done' and report are written atomically.
   */
  claimDoneWithReport(jobId: string, report: InvestigationReport): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// KV-backed implementation（可注入 sqlite/redis 后端）
// ---------------------------------------------------------------------------

export class KvConciergeInvestigationJobStore implements IConciergeInvestigationJobStore {
  private readonly kv: ConciergeKeyValueStore;

  constructor(kv: ConciergeKeyValueStore = new MemoryConciergeKeyValueStore()) {
    this.kv = kv;
  }

  async create(job: InvestigationJob): Promise<void> {
    // TTL=0 = persistent (铁律 5 LL-048)
    await this.kv.set(ConciergeKeys.investigationJob(job.id), JSON.stringify(job));
    // Index by triagePlanId for lookup
    await this.kv.set(ConciergeKeys.investigationJobByPlan(job.triagePlanId), job.id);
    // Index by userId for listing
    await this.kv.addToSet(ConciergeKeys.investigationJobIndex(job.userId), job.id);
  }

  async get(jobId: string): Promise<InvestigationJob | null> {
    const raw = await this.kv.get(ConciergeKeys.investigationJob(jobId));
    return raw ? (JSON.parse(raw) as InvestigationJob) : null;
  }

  async getByTriagePlan(triagePlanId: string): Promise<InvestigationJob | null> {
    const jobId = await this.kv.get(ConciergeKeys.investigationJobByPlan(triagePlanId));
    if (!jobId) return null;
    return this.get(jobId);
  }

  async updateStatus(jobId: string, status: InvestigationJobStatus): Promise<void> {
    const raw = await this.kv.get(ConciergeKeys.investigationJob(jobId));
    if (!raw) return;
    const job = JSON.parse(raw) as InvestigationJob;
    job.status = status;
    job.updatedAt = Date.now();
    if (status === 'running') job.startedAt = job.updatedAt;
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      job.completedAt = job.updatedAt;
    }
    await this.kv.set(ConciergeKeys.investigationJob(jobId), JSON.stringify(job));
  }

  async claimTransition(
    jobId: string,
    expectedStatus: InvestigationJobStatus,
    newStatus: InvestigationJobStatus,
  ): Promise<boolean> {
    const key = ConciergeKeys.investigationJob(jobId);
    const raw = await this.kv.get(key);
    if (!raw) return false;
    const job = JSON.parse(raw) as InvestigationJob;
    if (job.status !== expectedStatus) return false;
    job.status = newStatus;
    job.updatedAt = Date.now();
    if (newStatus === 'running') job.startedAt = job.updatedAt;
    if (newStatus === 'done' || newStatus === 'failed' || newStatus === 'cancelled') {
      job.completedAt = job.updatedAt;
    }
    await this.kv.set(key, JSON.stringify(job));
    return true;
  }

  async setReport(jobId: string, report: InvestigationReport): Promise<void> {
    const key = ConciergeKeys.investigationJob(jobId);
    const raw = await this.kv.get(key);
    if (!raw) return;
    const job = JSON.parse(raw) as InvestigationJob;
    job.report = report;
    job.updatedAt = Date.now();
    await this.kv.set(key, JSON.stringify(job));
  }

  async claimDoneWithReport(jobId: string, report: InvestigationReport): Promise<boolean> {
    const key = ConciergeKeys.investigationJob(jobId);
    const raw = await this.kv.get(key);
    if (!raw) return false;
    const job = JSON.parse(raw) as InvestigationJob;
    if (job.status !== 'running') return false;
    job.status = 'done';
    job.report = report;
    job.updatedAt = Date.now();
    job.completedAt = job.updatedAt;
    await this.kv.set(key, JSON.stringify(job));
    return true;
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation（仅用于单元测试 / stub）
// ---------------------------------------------------------------------------

export class MemoryConciergeInvestigationJobStore implements IConciergeInvestigationJobStore {
  private readonly store = new Map<string, InvestigationJob>();
  private readonly planIndex = new Map<string, string>(); // triagePlanId → jobId

  async create(job: InvestigationJob): Promise<void> {
    this.store.set(job.id, structuredClone(job));
    this.planIndex.set(job.triagePlanId, job.id);
  }

  async get(jobId: string): Promise<InvestigationJob | null> {
    const entry = this.store.get(jobId);
    return entry ? structuredClone(entry) : null;
  }

  async getByTriagePlan(triagePlanId: string): Promise<InvestigationJob | null> {
    const jobId = this.planIndex.get(triagePlanId);
    if (!jobId) return null;
    return this.get(jobId);
  }

  async updateStatus(jobId: string, status: InvestigationJobStatus): Promise<void> {
    const entry = this.store.get(jobId);
    if (!entry) return;
    entry.status = status;
    entry.updatedAt = Date.now();
    if (status === 'running') entry.startedAt = entry.updatedAt;
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      entry.completedAt = entry.updatedAt;
    }
    this.store.set(jobId, structuredClone(entry));
  }

  async claimTransition(
    jobId: string,
    expectedStatus: InvestigationJobStatus,
    newStatus: InvestigationJobStatus,
  ): Promise<boolean> {
    const entry = this.store.get(jobId);
    if (!entry || entry.status !== expectedStatus) return false;
    entry.status = newStatus;
    entry.updatedAt = Date.now();
    if (newStatus === 'running') entry.startedAt = entry.updatedAt;
    if (newStatus === 'done' || newStatus === 'failed' || newStatus === 'cancelled') {
      entry.completedAt = entry.updatedAt;
    }
    this.store.set(jobId, structuredClone(entry));
    return true;
  }

  async setReport(jobId: string, report: InvestigationReport): Promise<void> {
    const entry = this.store.get(jobId);
    if (!entry) return;
    entry.report = structuredClone(report);
    entry.updatedAt = Date.now();
    this.store.set(jobId, structuredClone(entry));
  }

  async claimDoneWithReport(jobId: string, report: InvestigationReport): Promise<boolean> {
    const entry = this.store.get(jobId);
    if (!entry || entry.status !== 'running') return false;
    entry.status = 'done';
    entry.report = structuredClone(report);
    entry.updatedAt = Date.now();
    entry.completedAt = entry.updatedAt;
    this.store.set(jobId, structuredClone(entry));
    return true;
  }
}
