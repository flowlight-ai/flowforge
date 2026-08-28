/**
 * @flowforge/cats-ball-custody — F005 BallCustodyRegistry（球权租借 registry）
 *
 * TS 全量重写自 `docs/features/F005-ball-custody-lease.md`（Python
 * `flowforge/core/teamact/ball_custody.py` 契约，RA-014 持球 lease）：
 *   - CustodyLease 结构化记录（禁裸字符串表示球权，§2.1）
 *   - TTL 默认 300s（安全网不是主要释放机制，持球者应主动 release）
 *   - now_fn 注入（INV-5：测试可快进时间，无需 sleep）
 *   - 双持球防护（INV-1/2：acquire 时 existing lease 未过期抛错，禁静默覆盖）
 *   - 懒清理过期 lease（INV-4：acquire / current_holder 调用时清理，无后台任务）
 *   - renew 允许过期续约但 re-check 球权归属（防被他人抢走）
 *   - 未知 lease_id 视为过期（INV-6：is_expired 返回 true，调用方可安全 evict）
 *
 * 时间统一 epoch ms（number），非 Python datetime——TS 惯例 + 测试确定性。
 *
 * @module @flowforge/cats-ball-custody/registry
 */

import { randomUUID } from 'node:crypto';
import {
  assertNonEmpty,
  assertPositiveTtl,
  BallCustodyError,
  type CustodyLease,
  type NowFn,
} from './models.js';

/** TTL 默认 300 秒（5 分钟）——安全网不是主要释放机制（F005 §2.1 KD-1）。 */
export const DEFAULT_TTL_SECONDS = 300;

/** 球权 registry 监控指标（F005 §2.6，对齐 Python 计数器语义）。 */
export interface BallCustodyMetrics {
  /** 双持球冲突次数（acquire 抛 BallCustodyError 统计）。 */
  readonly acquireConflictCount: number;
  /** TTL 过期懒清理释放次数（acquire / current_holder 统计）。 */
  readonly ttlExpiryCount: number;
  /** 续约次数（renew 调用统计）。 */
  readonly renewCount: number;
  /** 当前活跃 lease 数。 */
  readonly activeLeaseCount: number;
}

/**
 * 内存球权租借 registry（F005 Phase A；持久化留待 Phase B Durable State Surfaces）。
 *
 * 单进程内存字典操作原子（FM-5 多进程 TOCTOU 不在 P0 范围）。
 */
export class BallCustodyRegistry {
  private readonly _nowFn: NowFn;
  private readonly _leases = new Map<string, CustodyLease>(); // lease_id -> lease
  private readonly _ballToLease = new Map<string, string>(); // ball_id -> lease_id
  private _acquireConflictCount = 0;
  private _ttlExpiryCount = 0;
  private _renewCount = 0;

  constructor(nowFn?: NowFn) {
    // 默认 `Date.now()` 即 UTC epoch ms（对齐 Python datetime.now(timezone.utc) 语义）
    this._nowFn = nowFn ?? (() => Date.now());
  }

  /** 生成 `lease-{10hex}` lease_id（F005 AC-A1，与 F003 capsule_id 风格一致）。 */
  private newLeaseId(): string {
    return `lease-${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  }

  /** 懒清理单个 ball 的过期 lease（INV-4：无后台定时任务）。 */
  private evictExpired(ballId: string): void {
    const leaseId = this._ballToLease.get(ballId);
    if (leaseId !== undefined && this.isExpired(leaseId)) {
      this._leases.delete(leaseId);
      this._ballToLease.delete(ballId);
      this._ttlExpiryCount += 1;
    }
  }

  /**
   * 获取球权租约。
   *
   * @throws BallCustodyError - ball_id / owner 为空、ttl_seconds <= 0（AC-A4），
   *   或 ball 已被持有且未过期（AC-A2，双持球防护 INV-1/2）。
   * @returns `lease-{10hex}` lease_id（AC-A1）
   */
  acquire(ballId: string, owner: string, ttlSeconds: number): string {
    assertNonEmpty(ballId, 'ball_id');
    assertNonEmpty(owner, 'owner');
    assertPositiveTtl(ttlSeconds);

    // 懒清理：existing lease 已过期则允许新 owner acquire（AC-A3）
    this.evictExpired(ballId);

    const existingLeaseId = this._ballToLease.get(ballId);
    if (existingLeaseId !== undefined) {
      const existing = this._leases.get(existingLeaseId);
      this._acquireConflictCount += 1;
      throw new BallCustodyError(
        `ball is already held by ${existing?.owner ?? 'unknown'} (lease ${existingLeaseId})`,
      );
    }

    const lease: CustodyLease = {
      lease_id: this.newLeaseId(),
      ball_id: ballId,
      owner,
      expires_at: this._nowFn() + ttlSeconds * 1000,
    };
    this._leases.set(lease.lease_id, lease);
    this._ballToLease.set(ballId, lease.lease_id);
    return lease.lease_id;
  }

  /**
   * 续约 lease（AC-A6：expires_at 更新为 now + DEFAULT_TTL_SECONDS）。
   *
   * 允许过期续约（持球者回归），但 re-check 球权归属——若 ball 已被他人
   * acquire（_ballToLease 指向新 lease），续约被拒（§2.1 KD-2 语义）。
   *
   * @throws BallCustodyError - 未知 lease_id 或 ball 已被其他 owner 持有。
   */
  renew(leaseId: string): void {
    const lease = this._leases.get(leaseId);
    if (lease === undefined) {
      throw new BallCustodyError(`unknown lease_id: ${leaseId}`);
    }
    if (this._ballToLease.get(lease.ball_id) !== leaseId) {
      throw new BallCustodyError(
        `ball ${lease.ball_id} is now held by another owner — renew rejected`,
      );
    }
    // readonly 字段不可变：替换新对象而非原地修改
    this._leases.set(leaseId, {
      ...lease,
      expires_at: this._nowFn() + DEFAULT_TTL_SECONDS * 1000,
    });
    this._renewCount += 1;
  }

  /** 主动释放球权（幂等：未知 lease_id 静默，INV-3 release 后 current_holder 返回 None）。 */
  release(leaseId: string): void {
    const lease = this._leases.get(leaseId);
    if (lease === undefined) return;
    this._leases.delete(leaseId);
    if (this._ballToLease.get(lease.ball_id) === leaseId) {
      this._ballToLease.delete(lease.ball_id);
    }
  }

  /**
   * 查询当前持球者（AC-A7：过期 lease 返回 None，不主动清理——仅查询）。
   * 顺带懒清理过期 lease（INV-4，返回 None 前统计 TTL 过期）。
   */
  currentHolder(ballId: string): string | null {
    this.evictExpired(ballId);
    const leaseId = this._ballToLease.get(ballId);
    if (leaseId === undefined) return null;
    return this._leases.get(leaseId)?.owner ?? null;
  }

  /**
   * 检查 lease 是否过期（AC-A8：未知 lease_id 视为过期返回 true，调用方可安全 evict）。
   */
  isExpired(leaseId: string): boolean {
    const lease = this._leases.get(leaseId);
    if (lease === undefined) return true;
    return this._nowFn() >= lease.expires_at;
  }

  /** 监控指标快照（F005 §2.6）。 */
  metrics(): BallCustodyMetrics {
    return {
      acquireConflictCount: this._acquireConflictCount,
      ttlExpiryCount: this._ttlExpiryCount,
      renewCount: this._renewCount,
      activeLeaseCount: this._leases.size,
    };
  }
}
