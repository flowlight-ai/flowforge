/**
 * F140: Review 反馈终态效应 — PR merged/closed 时的社区事件 + 蒸馏机会投影。
 *
 * TS 移植自 clowder-ai `infrastructure/email/ReviewFeedbackTerminalEffects.ts`。
 * 插件化改造：clowder `ICommunityEventLog`/`projector`（community 域，未移植）
 * → 注入式端口；distillationCheckpoint 已移植（infrastructure-distillation）。
 */

import type { TaskItem } from '@flowforge/cats-shared';

import type { FeatPhaseCloseContext, CheckpointResult } from '@flowforge/infrastructure-distillation';

/** 社区事件端口（community 域 event-log 的子集）。 */
export interface CommunityEventPort {
  append(event: {
    sourceEventId: string;
    subjectKey: string;
    kind: string;
    classification: string;
    payload: Record<string, unknown>;
    at: number;
  }): Promise<{ appended: boolean }>;
}

export interface ReviewFeedbackTerminalEffectsOptions {
  readonly eventLog?: CommunityEventPort;
  readonly projector?: { apply(event: unknown): Promise<void> };
  readonly distillationCheckpoint?: { onFeatPhaseClose(c: FeatPhaseCloseContext): Promise<CheckpointResult> };
  readonly log: { warn: (...args: unknown[]) => void };
}

async function emitCommunityEvent(input: {
  readonly opts: ReviewFeedbackTerminalEffectsOptions;
  readonly subjectKey: string;
  readonly repoFullName: string;
  readonly prNumber: number;
  readonly terminalState: 'merged' | 'closed';
}): Promise<void> {
  if (!input.opts.eventLog) return;
  const kind = input.terminalState === 'merged' ? 'pr.merged' : 'pr.closed';
  try {
    const event = {
      sourceEventId: `lifecycle:${input.subjectKey}:${input.terminalState}`,
      subjectKey: input.subjectKey,
      kind,
      classification: 'state-changing',
      payload: {
        prState: input.terminalState,
        repoFullName: input.repoFullName,
        prNumber: input.prNumber,
      },
      at: Date.now(),
    };
    const { appended } = await input.opts.eventLog.append(event);
    if (appended && input.opts.projector) await input.opts.projector.apply(event);
  } catch {
    input.opts.log.warn(`[review-feedback] community event emit failed for ${input.repoFullName}#${input.prNumber}`);
  }
}

async function emitDistillation(input: {
  readonly opts: ReviewFeedbackTerminalEffectsOptions;
  readonly task: TaskItem;
  readonly repoFullName: string;
  readonly prNumber: number;
  readonly terminalState: 'merged' | 'closed';
  readonly prTitle?: string;
}): Promise<void> {
  if (!input.opts.distillationCheckpoint || input.terminalState !== 'merged') return;
  try {
    const featureMatch = (input.prTitle ?? '').match(/\b[Ff](\d{2,4})\b/);
    if (!featureMatch) return;
    const phaseMatch = (input.prTitle ?? '').match(/[Pp]hase\s+([A-Z])/i);
    await input.opts.distillationCheckpoint.onFeatPhaseClose({
      prNumber: input.prNumber,
      repoFullName: input.repoFullName,
      authorCatId: input.task.ownerCatId ?? 'unknown',
      threadId: input.task.threadId,
      featureId: `F${featureMatch[1]}`,
      phaseLabel: phaseMatch?.[1] ?? 'unknown',
    });
  } catch {
    input.opts.log.warn(`[review-feedback] distillation checkpoint failed for ${input.repoFullName}#${input.prNumber}`);
  }
}

export async function projectReviewFeedbackTerminalEffects(input: {
  readonly opts: ReviewFeedbackTerminalEffectsOptions;
  readonly task: TaskItem;
  readonly subjectKey: string;
  readonly repoFullName: string;
  readonly prNumber: number;
  readonly terminalState: 'merged' | 'closed';
  readonly prTitle?: string;
}): Promise<void> {
  await emitCommunityEvent(input);
  await emitDistillation(input);
}
