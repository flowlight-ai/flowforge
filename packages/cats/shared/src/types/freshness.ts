/**
 * Freshness gate types (F254).
 *
 * 副作用新鲜度门（side-effect freshness gate）：猫在发消息（post_message /
 * cross_post 等）前检查目标 thread 是否有未读消息——有则扣留（held），
 * 无则放行（forward）。使用独立的 seenCursor（非 deliveryCursor，
 * AC-A9 隔离要求）。
 *
 * 移植说明（R13 插件化裁剪）：clowder-ai 的 v1/v2 双格式 cursor 与
 * Redis 可见性序列机制不随批次5 移植——flowforge 的消息 ID 本身是
 * lexicographically sortable（timestamp+seq 前缀），字符串比较即可保证
 * 单调递进。closure 状态机（FreshnessClosureStateMachine / supplement
 * glass-box 等）属 clowder-ai Redis 多进程恢复基础设施，待 sqlite 后端
 * 批次再评估。
 *
 * @module @flowforge/cats-shared/types
 */

import type { CatId } from './ids.ts';

/** An unseen message summary (content-limited preview). */
export interface UnseenMessage {
  id: string;
  /** catId or 'user' */
  from: string;
  /** first ~200 chars */
  preview: string;
  /** Explicit source classification when stable identity is finer than catId. */
  selfSource?: boolean;
}

/** Input for the freshness gate check. */
export interface FreshnessCheckInput {
  userId: string;
  catId: CatId;
  threadId: string;
  latestMessageId: string;
  toolName: string;
  /** Messages after seenCursor that the cat hasn't read. */
  unseenMessages?: UnseenMessage[];
  /** AC-A5: Force forward even with unseen messages. */
  acknowledgeHeld?: boolean;
  /** Optional invocation ID for event logging. */
  invocationId?: string;
}

/** Gate decision — held envelope carries capped previews (AC-A4). */
export interface FreshnessDecision {
  decision: 'forward' | 'held';
  reason: string;
  unseenCount: number;
  toolName: string;
  /** Only present when decision === 'held'. */
  previews?: Array<{ from: string; messageId: string; preview: string }>;
  /** Only present when decision === 'held' and previews were capped. */
  omittedCount?: number;
}

/** Content-free unseen summary (privacy invariant — no message body). */
export interface FreshnessUnseenResult {
  count: number;
  senders: string[];
  /** Lexicographically max unseen message id (sortable-id domain). */
  maxMessageId: string;
}

/** Relevance decision reasons (narrower than visibility). */
export type FreshnessRelevanceReason =
  | 'relevant'
  | 'directed_to_other_cat'
  | 'closure_replacement_for_other_cat'
  | 'same_parallel_batch'
  | 'same_user_wave_sibling_reply';

/** Relevance decision output. */
export interface FreshnessRelevanceDecision {
  relevant: boolean;
  reason: FreshnessRelevanceReason;
}

/** Relevance decision context. */
export interface FreshnessRelevanceContext {
  catId: string;
  parallelBatchId?: string;
  coveredTriggerMessageIds?: ReadonlySet<string>;
}

/** Minimal readable-message shape consumed by the relevance policy. */
export interface FreshnessReadableMessage {
  catId: string | null;
  threadId?: string;
  mentions?: readonly string[];
  extra?: {
    freshness?: { kind?: string; targetCatId?: string };
    stream?: { parallelBatchId?: string };
    targetCats?: readonly string[];
    causal?: { kind?: string; triggerMessageId?: string };
    crossPost?: { sourceThreadId?: string };
  };
}
