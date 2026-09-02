/**
 * #320 backfill: legacy pr-tracking → 统一 TaskStore 迁移。
 *
 * TS 移植自 clowder-ai `infrastructure/email/backfill-legacy-pr-tracking.ts`：
 * 遍历 legacy PrTrackingStore 条目 → 已存在 subjectKey 跳过 → upsertBySubject
 * 写入统一 TaskStore（automationState 映射 ci/conflict 字段）。
 */

import type { AutomationState, CatId, CreateTaskInput, TaskItem } from '@flowforge/cats-shared';

import { prSubjectKey } from './ci-cd-router.ts';
import { type PrTrackingEntry, type IPrTrackingStore } from './pr-tracking-store.ts';

export interface LegacyPrTrackingBackfillOptions {
  legacyStore: IPrTrackingStore;
  /** 统一 TaskStore 端口（#320）。 */
  taskStore: {
    getBySubject(subjectKey: string): Promise<TaskItem | null>;
    upsertBySubject(input: CreateTaskInput): Promise<TaskItem | null>;
  };
  log: { info: (...args: unknown[]) => void };
}

export interface LegacyPrTrackingBackfillResult {
  migrated: number;
  skipped: number;
}

export async function backfillLegacyPrTracking(
  opts: LegacyPrTrackingBackfillOptions,
): Promise<LegacyPrTrackingBackfillResult> {
  const entries = await opts.legacyStore.listAll();
  let migrated = 0;
  let skipped = 0;

  for (const entry of entries) {
    const subjectKey = prSubjectKey(entry.repoFullName, entry.prNumber);
    const existing = await opts.taskStore.getBySubject(subjectKey);
    if (existing) {
      skipped++;
      continue;
    }
    await opts.taskStore.upsertBySubject(toTaskInput(entry));
    migrated++;
  }

  opts.log.info(
    `[#320 backfill] migrated=${migrated} skipped=${skipped} legacy pr-tracking entries into TaskStore`,
  );
  return { migrated, skipped };
}

function toTaskInput(entry: PrTrackingEntry): CreateTaskInput {
  const automationState = buildAutomationState(entry);
  return {
    kind: 'pr_tracking',
    subjectKey: prSubjectKey(entry.repoFullName, entry.prNumber),
    threadId: entry.threadId,
    title: `PR tracking: ${entry.repoFullName}#${entry.prNumber}`,
    ownerCatId: entry.catId as CatId,
    why: `Tracking PR ${entry.repoFullName}#${entry.prNumber}`,
    createdBy: entry.catId as CatId,
    userId: entry.userId,
    ...(automationState ? { automationState } : {}),
  };
}

function buildAutomationState(entry: PrTrackingEntry): AutomationState | undefined {
  const ci =
    entry.headSha !== undefined ||
    entry.lastCiFingerprint !== undefined ||
    entry.lastCiBucket !== undefined ||
    entry.lastCiNotifiedAt !== undefined ||
    entry.ciTrackingEnabled !== undefined
      ? {
          ...(entry.headSha !== undefined ? { headSha: entry.headSha } : {}),
          ...(entry.lastCiFingerprint !== undefined ? { lastFingerprint: entry.lastCiFingerprint } : {}),
          ...(entry.lastCiBucket !== undefined ? { lastBucket: entry.lastCiBucket } : {}),
          ...(entry.lastCiNotifiedAt !== undefined ? { lastNotifiedAt: entry.lastCiNotifiedAt } : {}),
          enabled: entry.ciTrackingEnabled ?? true,
        }
      : undefined;

  const conflict =
    entry.lastConflictFingerprint !== undefined ||
    entry.lastConflictNotifiedAt !== undefined ||
    entry.mergeState !== undefined
      ? {
          ...(entry.lastConflictFingerprint !== undefined ? { lastFingerprint: entry.lastConflictFingerprint } : {}),
          ...(entry.lastConflictNotifiedAt !== undefined ? { lastNotifiedAt: entry.lastConflictNotifiedAt } : {}),
          ...(entry.mergeState !== undefined ? { mergeState: entry.mergeState } : {}),
        }
      : undefined;

  if (!ci && !conflict) return undefined;
  return {
    ...(ci ? { ci } : {}),
    ...(conflict ? { conflict } : {}),
  };
}
