/**
 * @flowforge/cats-feat-trajectory — backfill（C26 FeatTrajectoryBackfill，F233）。
 *
 * TS 移植自 clowder-ai `domains/feat-trajectory/FeatTrajectoryBackfill.ts`：
 *   - 历史回填核心逻辑 `runBackfill(deps)` 纯函数（collector.collectAll →
 *     projector.applyGitRefSnapshot → store 全 feats 汇总）
 *   - 宿主 entry script 拼好 deps（Real IO 注入 + store）后调用；test 用 stub
 *     deps 验证 main flow（不依赖真 Redis / git）
 *
 * @module @flowforge/cats-feat-trajectory/backfill
 */

import type { FeatTrajectoryProjection } from '@flowforge/cats-shared';
import type { FeatTrajectoryProjector } from './projector.js';
import type { IFeatTrajectoryStore } from './store.js';
import type { GitRefSnapshotCollector } from './git-ref-collector.js';

export interface FeatTrajectoryBackfillDeps {
  collector: GitRefSnapshotCollector;
  projector: FeatTrajectoryProjector;
  store: IFeatTrajectoryStore;
  /** Unix ms — cron tick "now" for staleBucket assignment. Default Date.now(). */
  now?: () => number;
  /** Logger (production = console; tests = stub array push). */
  logger?: (msg: string) => void;
}

export interface FeatTrajectoryBackfillResult {
  snapshotsCollected: number;
  snapshotsApplied: number;
  featsInStore: string[];
  /** Per-feat summary: entries count + counts by kind. */
  perFeatSummary: Array<{
    featId: string;
    entryCount: number;
    countsByKind: Record<string, number>;
  }>;
}

/**
 * Run historical backfill. Returns summary; does not exit.
 *
 * Caller (script entry) responsible for:
 * - Building deps (persistent store, RealGitRunner, RealGhClient, etc.)
 * - Cleanup (close store connections, etc.)
 * - Exit code based on result (non-zero on 0 snapshots = likely misconfig)
 */
export async function runBackfill(deps: FeatTrajectoryBackfillDeps): Promise<FeatTrajectoryBackfillResult> {
  const { collector, projector, store, now = Date.now, logger = () => {} } = deps;
  const tick = now();

  logger(`[F233 C2c] Collecting snapshots at tick=${new Date(tick).toISOString()}`);
  const snapshots = await collector.collectAll(tick);
  logger(`[F233 C2c]   → ${snapshots.length} snapshots collected`);

  logger(`[F233 C2c] Applying snapshots to projector...`);
  let applied = 0;
  for (const snap of snapshots) {
    try {
      await projector.applyGitRefSnapshot(snap);
      applied++;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger(`[F233 C2c]   ⚠️  skip snapshot for ${snap.branchName}: ${errMsg}`);
    }
  }
  logger(`[F233 C2c]   → ${applied}/${snapshots.length} snapshots applied`);

  const featsInStore = await store.listFeatIds();
  featsInStore.sort((a, b) => Number(a.replace(/^F/, '')) - Number(b.replace(/^F/, '')));

  const perFeatSummary: FeatTrajectoryBackfillResult['perFeatSummary'] = [];
  for (const featId of featsInStore) {
    const proj: FeatTrajectoryProjection | null = await store.get(featId);
    if (!proj) continue;
    perFeatSummary.push({
      featId,
      entryCount: proj.entries.length,
      countsByKind: { ...proj.countsByKind },
    });
  }

  logger(`[F233 C2c] Result: ${featsInStore.length} feats with projections`);
  for (const summary of perFeatSummary) {
    const kindsStr = Object.entries(summary.countsByKind)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    logger(`[F233 C2c]   ${summary.featId}: ${summary.entryCount} entries (${kindsStr})`);
  }

  return {
    snapshotsCollected: snapshots.length,
    snapshotsApplied: applied,
    featsInStore,
    perFeatSummary,
  };
}
