/**
 * F140: PR 冲突路由（ConflictRouter + 消息构建）。
 *
 * TS 移植自 clowder-ai `infrastructure/email/ConflictRouter.ts`：
 * signal → task 查表（#320 统一 TaskStore）→ wait-lifecycle 观察（dedup/
 * 指纹更新/投递判定）→ notified 结果。
 *
 * 插件化改造：clowder `GitHubWaitLifecycleService`（github-signals 域，未移植）
 * → 注入式 `WaitLifecyclePort`；TaskStore → 注入式 `TaskLookup` 端口。
 */

import type { TaskItem } from '@flowforge/cats-shared';

export interface ConflictSignal {
  readonly repoFullName: string;
  readonly prNumber: number;
  readonly headSha: string;
  readonly mergeState: string;
}

export type ConflictRouteResult =
  | {
      readonly kind: 'notified';
      readonly threadId: string;
      readonly catId: string;
      readonly messageId: string;
      readonly content: string;
    }
  | { readonly kind: 'deduped' | 'skipped'; readonly reason: string };

/** 任务查表端口（#320 统一 TaskStore 的子集）。 */
export interface TaskLookup {
  getBySubject(subjectKey: string): Promise<TaskItem | null>;
}

/** GitHubWaitLifecycleService.observe 端口（github-signals 域注入）。 */
export interface WaitLifecyclePort {
  observe(input: {
    taskId: string;
    facts: { headSha: string; conflict: { mergeState: string } };
    collectorPatch: {
      conflict: { mergeState: string; lastFingerprint: string };
    };
  }): Promise<
    | { kind: 'notified'; task: { id: string; threadId: string; ownerCatId: string | null }; messageId: string; content: string }
    | { kind: 'deduped' | 'skipped'; reason: string }
  >;
}

export interface ConflictRouterOptions {
  readonly taskLookup: TaskLookup;
  readonly waitLifecycle: WaitLifecyclePort;
  readonly log: { warn: (...args: unknown[]) => void };
}

export class ConflictRouter {
  constructor(private readonly opts: ConflictRouterOptions) {}

  async route(signal: ConflictSignal): Promise<ConflictRouteResult> {
    const sk = prSubjectKey(signal.repoFullName, signal.prNumber);
    const task = await this.opts.taskLookup.getBySubject(sk);
    if (!task) return { kind: 'skipped', reason: `No tracking task for ${signal.repoFullName}#${signal.prNumber}` };
    if (signal.mergeState === 'UNKNOWN') return { kind: 'skipped', reason: 'mergeState UNKNOWN' };

    const result = await this.opts.waitLifecycle.observe({
      taskId: task.id,
      facts: {
        headSha: signal.headSha,
        conflict: { mergeState: signal.mergeState },
      },
      collectorPatch: {
        conflict: {
          mergeState: signal.mergeState,
          lastFingerprint: `${signal.headSha}:${signal.mergeState}`,
        },
      },
    });

    if (result.kind !== 'notified') {
      return {
        kind: result.kind === 'deduped' ? 'deduped' : 'skipped',
        reason: result.reason,
      };
    }
    return {
      kind: 'notified',
      threadId: result.task.threadId,
      catId: result.task.ownerCatId ?? '',
      messageId: result.messageId,
      content: result.content,
    };
  }
}

export function buildConflictMessageContent(signal: ConflictSignal): string {
  return [
    `🔔 **PR wait satisfied** — ${signal.repoFullName}#${signal.prNumber}`,
    '',
    `- ${signal.mergeState.toLowerCase()}`,
    '',
    'Matched reason: `matched`',
  ].join('\n');
}

/** `pr:owner/repo#123` 标准格式（与 cats-shared prSubjectKey 对齐）。 */
export function prSubjectKey(repoFullName: string, prNumber: number): string {
  return `pr:${repoFullName.toLowerCase()}#${prNumber}`;
}
