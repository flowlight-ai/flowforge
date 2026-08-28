/**
 * @flowforge/cats-feat-trajectory — store（C26 FeatTrajectoryStore，F233）。
 *
 * TS 移植自 clowder-ai `domains/feat-trajectory/FeatTrajectoryStore.ts`：
 *   - `IFeatTrajectoryStore` port（get/save/listFeatIds/delete + last-collector-tick
 *     健康观察双方法）
 *   - `InMemoryFeatTrajectoryStore` 内置实现（tests + dev）
 *   - Redis 实现不内联：持久化由宿主按 port 注入（照 concierge
 *     `ConciergeKeyValueStore` KV 接口注入先例）
 *
 * **rebuild-safe invariant (INV-2)**：replay 同一组 entries (event-stream +
 * git-ref-snapshot + historical-stitched) 必须得到逐字段相同的 projection。
 *
 * **upsert 语义（砚砚 P2-2）**：同 entry id（如同 `gitRefEntryId`）upsert 而非 append，
 * 防止 cron tick 重复 emit 鞭打 store。
 *
 * @module @flowforge/cats-feat-trajectory/store
 */

import type { FeatTrajectoryProjection } from '@flowforge/cats-shared';

export interface IFeatTrajectoryStore {
  /** 读 per-feat projection；不存在返回 null（rebuild 路径会用 null 初始化）。 */
  get(featId: string): Promise<FeatTrajectoryProjection | null>;
  /** Upsert projection（覆盖整体；upsert 单 entry 级语义由 projector 内部负责）。 */
  save(projection: FeatTrajectoryProjection): Promise<void>;
  /** 列所有已知 feat id（rebuild + 简报"全 feats 一览"用）。 */
  listFeatIds(): Promise<string[]>;
  /** 删 per-feat projection（rebuild 前 wipe）。 */
  delete(featId: string): Promise<void>;
  /**
   * 读 collector 最后一次 tick 的 observation time (Unix ms)。
   *
   * Cloud round 2 P2 fix: `projection.updatedAt` 反映 max event time
   * (headCommitAt / PR / stale threshold), 不是 collector 观察时间. 重复 cron
   * tick 同 stale bucket 会更新 payload.detectedAt 但 projection.updatedAt
   * 不变 → UI 显示的 "last collected" 会显得 stale 即便 collector 正常跑.
   * 单独存 tick observation time 给 UI 健康观察用.
   *
   * 不存在返回 null（首次 backfill / 持久层 flush 后）。
   */
  getLastCollectorTickAt(): Promise<number | null>;
  /** Write collector tick observation time. Called by scheduler / backfill 每次完成. */
  setLastCollectorTickAt(now: number): Promise<void>;
}

// ============================================================================
// In-memory store（tests + dev）
// ============================================================================

export class InMemoryFeatTrajectoryStore implements IFeatTrajectoryStore {
  private readonly map = new Map<string, FeatTrajectoryProjection>();
  private lastCollectorTickAt: number | null = null;

  async get(featId: string): Promise<FeatTrajectoryProjection | null> {
    return this.map.get(featId) ?? null;
  }

  async save(projection: FeatTrajectoryProjection): Promise<void> {
    this.map.set(projection.featId, projection);
  }

  async listFeatIds(): Promise<string[]> {
    return [...this.map.keys()];
  }

  async delete(featId: string): Promise<void> {
    this.map.delete(featId);
  }

  async getLastCollectorTickAt(): Promise<number | null> {
    return this.lastCollectorTickAt;
  }

  async setLastCollectorTickAt(now: number): Promise<void> {
    this.lastCollectorTickAt = now;
  }
}
