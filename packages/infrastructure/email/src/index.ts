/**
 * @flowforge/infrastructure-email — C33 email 域 Cordis 插件（核心层）。
 *
 * TS 移植自 clowder-ai `infrastructure/email/*`：
 *   - ci-cd-contract：CI 桶/检查明细/轮询结果/路由结果类型 + 投递目标解析
 *   - severity-parser：严格 P0/P1/P2 解析（shields 徽章/行首方括号/行首冒号
 *     三格式，全扫描取最大 + 代码块/引用行去噪 FP 守卫）
 *   - setup-noise-filter：bot Codex setup 引导噪声过滤（会话类 + bot 作者 +
 *     setup-only 三条件，动态 bot 登录 thunk 支持运行时配置变更）
 *   - github-feedback-filter：Rule A 自反馈过滤（E.2 后轮询为唯一事实源，
 *     仅跳过自反馈避免数据丢失）
 *   - pr-tracking-store：IPrTrackingStore 端口 + MemoryPrTrackingStore
 *     （repo#pr → cat/thread/user + CI/Conflict 状态域独立 patch，KD-7/KD-12）
 *   - ci-message-content：CI 通知/终态生命周期消息构建
 *
 * 插件化改造：
 *   - @cat-cafe/shared → @flowforge/cats-shared（AwaitStateV1/WaitOutcomeV1）
 *   - RedisPrTrackingStore（持久化）与 TaskSpecs/Routers/ConnectorInvokeTrigger/
 *     ci-status-fetchers/Conflict* 深度耦合 connector/github/cats runtime，
 *     随对应特性移植再补
 *
 * @module @flowforge/infrastructure-email
 */

import { Context, Service } from '@flowforge/cordis';
import { resolveGhCliToken } from '@flowforge/infrastructure-github';

import { fetchPrCiStatus, type FetchPrCiStatusOptions, type MinimalLog } from './ci-status-fetcher.ts';
import { fetchPrCiStatuses } from './ci-status-batch-fetcher.ts';
import type { AwaitStateV1, WaitOutcomeV1 } from '@flowforge/cats-shared';

// ── ci-cd-contract ──────────────────────────────────────────

export type CiBucket = 'pass' | 'fail' | 'pending' | 'external_infrastructure';
export type CiExecutionFailure = 'billing_spending_limit_zero_step';

export interface CiCheckDetail {
  readonly name: string;
  readonly bucket: CiBucket;
  readonly link?: string;
  readonly workflow?: string;
  readonly description?: string;
  /** Closed enum derived only from typed GitHub execution payloads. */
  readonly executionFailure?: CiExecutionFailure;
}

export interface CiPollResult {
  readonly repoFullName: string;
  readonly prNumber: number;
  readonly headSha: string;
  readonly prState: 'open' | 'merged' | 'closed';
  readonly aggregateBucket: CiBucket;
  /** Raw GitHub rollup presence before the poller's empty-rollup stability guard. */
  readonly checkRollup?: 'empty' | 'present';
  readonly checks: readonly CiCheckDetail[];
  /** GitHub login of the user who merged the PR (only present when prState=merged). */
  readonly mergedByLogin?: string;
}

export type CiRouteResult =
  | {
      kind: 'notified';
      threadId: string;
      catId: string;
      messageId: string;
      bucket: CiBucket;
      content: string;
      headSha?: string;
    }
  | {
      kind: 'lifecycle';
      threadId: string;
      catId: string;
      messageId: string;
      prState: 'merged' | 'closed';
      content: string;
    }
  | { kind: 'deduped'; reason: string }
  | { kind: 'skipped'; reason: string };

/** Subset of the tracked TaskItem fields the lifecycle-close path reads. */
export interface TrackedTaskLike {
  readonly id: string;
  readonly threadId: string;
  readonly ownerCatId: string | null;
  readonly userId?: string;
  readonly title?: string;
  readonly automationState?: {
    readonly ci?: { readonly prState?: 'merged' | 'closed'; readonly headSha?: string };
    readonly await?: AwaitStateV1;
    readonly waitOutcome?: WaitOutcomeV1;
  };
}

export function getConnectorDeliveryTarget(task: Pick<TrackedTaskLike, 'threadId' | 'userId' | 'ownerCatId'>): {
  threadId: string;
  userId: string;
  catId: string;
} {
  return {
    threadId: task.threadId,
    userId: task.userId ?? '',
    catId: task.ownerCatId ?? '',
  };
}

// ── severity-parser ─────────────────────────────────────────

/**
 * F140 Phase E.1 — Strict severity parser (P0 / P1 / P2) with FP guards.
 * 三格式（徽章/行首方括号/行首冒号）全扫描取最大（多严重级 body 取最高），
 * 先剥 fenced code blocks + blockquote 行防误报。
 */
export type Severity = 'P0' | 'P1' | 'P2';

const SEVERITY_RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2 };

const BADGE_REGEX = /img\.shields\.io\/badge\/(P[0-2])-/g;
const BRACKET_REGEX = /^\s*\[(P[0-2])\](?=\s|$)/gm;
const COLON_REGEX = /^\s*(?:\*\*)?(P[0-2])(?:\*\*)?:/gm;

/** Strip fenced code blocks + blockquote lines before severity match. */
function stripNoise(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
}

export function parseSeverity(body: string): Severity | null {
  if (!body) return null;
  const cleaned = stripNoise(body);

  let max: Severity | null = null;
  const consider = (s: Severity): void => {
    if (!max || SEVERITY_RANK[s]! < SEVERITY_RANK[max]!) max = s;
  };

  BADGE_REGEX.lastIndex = 0;
  BRACKET_REGEX.lastIndex = 0;
  COLON_REGEX.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = BADGE_REGEX.exec(cleaned)) !== null) consider(m[1] as Severity);
  while ((m = BRACKET_REGEX.exec(cleaned)) !== null) consider(m[1] as Severity);
  while ((m = COLON_REGEX.exec(cleaned)) !== null) consider(m[1] as Severity);

  return max;
}

export function getMaxSeverity(
  comments: readonly { body: string }[],
  decisions: readonly { body: string }[],
): Severity | null {
  let max: Severity | null = null;
  const consider = (s: Severity | null): void => {
    if (!s) return;
    if (!max || SEVERITY_RANK[s] < SEVERITY_RANK[max]!) max = s;
  };
  for (const c of comments) consider(parseSeverity(c.body));
  for (const d of decisions) consider(parseSeverity(d.body));
  return max;
}

// ── setup-noise-filter ──────────────────────────────────────

export interface SetupNoiseContext {
  readonly author: string;
  readonly body: string;
  readonly commentType: 'inline' | 'conversation';
}

const SETUP_GUIDANCE_SENTENCE = /to use codex here,/i;
const SETUP_GUIDANCE_ANCHOR = /environment for this repo\b/i;
const CODEX_REVIEW_CONTENT = /\bcodex review\b/i;

/**
 * Create a setup-noise filter（bot + conversation + setup-only 三条件）。
 * 接受静态数组（测试/向后兼容）或 thunk（运行时配置变更实时生效，P2-3）。
 */
export function createSetupNoiseFilter(
  botLoginsOrGetter: readonly string[] | (() => readonly string[]),
): (c: SetupNoiseContext) => boolean {
  let staticBots: Set<string> | null = null;
  let getter: (() => readonly string[]) | null = null;
  if (typeof botLoginsOrGetter === 'function') {
    getter = botLoginsOrGetter;
  } else {
    staticBots = new Set(botLoginsOrGetter);
  }

  return (c: SetupNoiseContext): boolean => {
    if (!c.body) return false;
    if (c.commentType !== 'conversation') return false;
    const bots = staticBots ?? new Set(getter?.() ?? []);
    if (!bots.has(c.author)) return false;
    const hasSetupSentence = SETUP_GUIDANCE_SENTENCE.test(c.body) && SETUP_GUIDANCE_ANCHOR.test(c.body);
    if (!hasSetupSentence) return false;
    const hasCodexReviewContent = CODEX_REVIEW_CONTENT.test(c.body);
    return !hasCodexReviewContent;
  };
}

// ── github-feedback-filter ──────────────────────────────────

/**
 * F140: GitHub feedback filter — Rule A（自反馈）only。
 * E.2 后轮询为唯一事实源，仅跳过自反馈（Rule B/C 已退役）。
 */
export interface GitHubFeedbackFilterOptions {
  /** Authenticated GitHub login. undefined = filter disabled for self. */
  readonly selfGitHubLogin?: string;
  /** Late-bound login（凭据运行时可变时优先，如插件配置面板更新）。 */
  readonly getSelfGitHubLogin?: () => string | undefined;
}

export interface GitHubFeedbackFilter {
  isSelfAuthored: (author: string) => boolean;
  shouldSkipComment: (comment: { author: string; commentType?: 'inline' | 'conversation' }) => boolean;
  shouldSkipReview: (review: { author: string }) => boolean;
}

export function createGitHubFeedbackFilter(opts: GitHubFeedbackFilterOptions): GitHubFeedbackFilter {
  const getSelfGitHubLogin = (): string | undefined =>
    opts.getSelfGitHubLogin ? opts.getSelfGitHubLogin() : opts.selfGitHubLogin;
  const isSelfAuthored = (author: string): boolean => {
    const selfGitHubLogin = getSelfGitHubLogin();
    return selfGitHubLogin != null && author === selfGitHubLogin;
  };
  return {
    isSelfAuthored,
    shouldSkipComment: (c) => isSelfAuthored(c.author),
    shouldSkipReview: (r) => isSelfAuthored(r.author),
  };
}

// ── pr-tracking-store ───────────────────────────────────────

/**
 * PR Tracking Store — (repo#pr) → { catId, threadId, userId }。
 * F140 polling（ReviewFeedback/ConflictCheck）与 F133 CI/CD tracking 用于
 * 将通知路由到正确的 cat/thread。
 */
// ── pr-tracking-store（类型/key/内存实现）─────────────────────

import { MemoryPrTrackingStore } from './pr-tracking-store.ts';

export {
  MemoryPrTrackingStore,
  PrTrackingKeys,
  type CiStateFields,
  type ConflictStateFields,
  type IPrTrackingStore,
  type PrTrackingEntry,
  type PrTrackingInput,
} from './pr-tracking-store.ts';
export { classifyGitHubExecutionFailure, enrichGitHubExecutionFailures, type GitHubExecutionFailureEvidence } from './ci-execution-failure.ts';
export {
  computeAggregateBucket,
  executeGh,
  fetchPrCiStatus,
  fetchRequiredFailingChecks,
  ghApiJson,
  normalizeBucket,
  normalizePrState,
  type FetchPrCiStatusOptions,
  type GhExecFileAsync,
  type MinimalLog,
} from './ci-status-fetcher.ts';
export { ciStatusTargetKey, fetchPrCiStatuses, type PrCiStatusTarget } from './ci-status-batch-fetcher.ts';
export { deliverConnectorMessage, type ConnectorDeliveryDeps, type ConnectorDeliveryInput, type ConnectorDeliveryResult, type MessageAppender, type SocketBroadcaster } from './deliver-connector-message.ts';
export { buildConflictMessageContent, ConflictRouter, prSubjectKey, type ConflictRouteResult, type ConflictSignal, type TaskLookup, type WaitLifecyclePort } from './conflict-router.ts';
export { ConflictAutoExecutor, type AutoResolveResult, type SubprocessRunner, type WorktreeLister } from './conflict-auto-executor.ts';
export { createConflictCheckTaskSpec, type ConflictCheckSpec, type ConflictSignalWorkItem, type ConnectorTriggerPolicy, type InvokeTriggerPort, type TaskListPort } from './conflict-check-task-spec.ts';
export { projectReviewFeedbackTerminalEffects, type CommunityEventPort, type ReviewFeedbackTerminalEffectsOptions } from './review-feedback-terminal-effects.ts';
export { validateIssueFixEvidence, hasIssueFixClaim, isCriticalIssueSignal, extractIssueFixEvidence, selectIssueFixReadiness, type IssueFixEvidence, type IssueFixReadinessDecision, type LinkedPullRequestEvidenceProjection, type CommunityEventLike } from './issue-fix-evidence.ts';
export { IssueCommentRouter, buildIssueCommentContent, type IssueComment, type IssueCommentRouteResult, type IssueCommentSignal } from './issue-comment-router.ts';
export { ReviewFeedbackRouter, buildReviewFeedbackContent, type PrFeedbackComment, type PrReviewDecision, type ReviewFeedbackRouteResult, type ReviewFeedbackRoutingAudit, type ReviewFeedbackSignal, type ReviewWaitLifecyclePort } from './review-feedback-router.ts';
export { backfillLegacyPrTracking, type LegacyPrTrackingBackfillOptions, type LegacyPrTrackingBackfillResult } from './backfill-legacy-pr-tracking.ts';
export { createIssueCommentTaskSpec, type IssueCommentSpec, type IssueCommentTaskSpecOptions, type IssueEventLogPort, type IssueTrackingMetadata } from './issue-comment-task-spec.ts';
export { createReviewFeedbackTaskSpec, type ReviewFeedbackSpec, type ReviewFeedbackTaskSpecOptions, type ReviewFetchResult } from './review-feedback-task-spec.ts';
export { createConnectorInvokeTrigger, type ConnectorInvokeTriggerOptions, type InvocationWakePort } from './connector-invoke-trigger.ts';
export { createInvocationWakePort, type InvocationQueueWakeSource, type InvocationWakeBridgeOptions } from './invocation-wake-bridge.ts';
export { createCiCdCheckTaskSpec, type CiCdCheckSignal, type CiCdCheckSpec, type CiCdCheckTaskSpecOptions, type CiPollResultLike } from './ci-cd-check-task-spec.ts';
export {
  buildDeliveryDecisionCueCarrier,
  CiCdRouter,
  classifyCiWaitBucket,
  EMPTY_ROLLUP_STABILITY_MS,
  settleEmptyCheckRollup,
  type CiDistillationPort,
  type CiEventLogPort,
  type CiExternalReviewPort,
  type CiProjectorPort,
  type CiTaskStorePort,
  type CiWaitLifecyclePort,
  type CiWaitLifecycleResult,
  type TerminalEffectCommit,
} from './ci-cd-router.ts';
export {
  PR_TRACKING_PATCH_STATE_LUA,
  PR_TRACKING_REMOVE_LUA,
  PR_TRACKING_SELF_HEAL_LUA,
  RedisPrTrackingStore,
  type RedisPrTrackingStoreOptions,
} from './redis-pr-tracking-store.ts';

// ── ci-message-content ──────────────────────────────────────

/** CI 轮询候选通知内容。 */
export function buildCiMessageContent(poll: CiPollResult, _legacyInstructions?: string): string {
  const failedChecks = poll.checks.filter((c) => c.bucket === 'fail');
  return [
    `🔔 **PR wait candidate** — ${poll.repoFullName}#${poll.prNumber}`,
    '',
    `- CI ${poll.aggregateBucket} (${failedChecks.length} blockers)`,
    `- HEAD ${poll.headSha.slice(0, 7)}`,
    '',
    'The typed wait predicate decides whether this becomes an owner wake.',
  ].join('\n');
}

/** Terminal lifecycle (merged/closed) notification. */
export function buildLifecycleMessageContent(
  poll: Pick<CiPollResult, 'repoFullName' | 'prNumber' | 'prState'>,
  _legacyInstructions?: string,
): string {
  const merged = poll.prState === 'merged';
  const headline = merged ? '🎉 **PR 已 merge**' : '🚪 **PR 已关闭（未合并）**';
  const lines: string[] = [headline, '', `PR #${poll.prNumber} (${poll.repoFullName})`];
  lines.push(
    '',
    merged
      ? '请执行 post-merge 收尾（验证 main、更新任务状态、清理分支/worktree）。'
      : '该 PR 未合并即关闭，请确认是否需要跟进（重开、改道或收尾归档）。',
  );
  if (merged) {
    lines.push(
      '',
      '若 PR 触及 runtime 加载面，请分开报告 main 与 live runtime：默认记录 `live=dormant`（未加载/未生效），不得自动同步或重启；只有 co-creator 显式授权后，才从 main 运行 `pnpm start` 完成 sync+build+restart，并以新进程或 fresh invocation 验证生效。',
    );
  }
  return lines.join('\n');
}

// ── Cordis 插件 ─────────────────────────────────────────────

export interface EmailToolsConfig {
  /** bot 登录清单（setup-noise 过滤；静态或 thunk）。 */
  setupNoiseBotLogins?: readonly string[] | (() => readonly string[]);
  /** 自反馈过滤：authenticated GitHub login（静态或 late-bound thunk）。 */
  selfGitHubLogin?: string;
  getSelfGitHubLogin?: () => string | undefined;
  /** pluginEnv（gh token 解析注入缝）。 */
  pluginEnv?: Record<string, string | undefined>;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** email 域（C33）：严重级解析/噪声过滤/PR 跟踪 store/CI 消息构建 */
    forgeEmailTools: ForgeEmailToolsService;
  }
}

/**
 * email 域服务 — 挂载 `ctx.forgeEmailTools`。
 * 纯工具聚合：severity 解析 / setup-noise / self-feedback 过滤 /
 * PR tracking store / CI 消息构建 / CI 状态获取。
 */
export class ForgeEmailToolsService extends Service {
  readonly prTracking: MemoryPrTrackingStore;
  readonly isSetupNoise: (c: SetupNoiseContext) => boolean;
  readonly feedbackFilter: GitHubFeedbackFilter;
  private readonly cfg: EmailToolsConfig;

  constructor(ctx: Context, config: EmailToolsConfig = {}) {
    super(ctx, 'forgeEmailTools');
    this.cfg = config;
    this.prTracking = new MemoryPrTrackingStore();
    this.isSetupNoise = createSetupNoiseFilter(config.setupNoiseBotLogins ?? []);
    this.feedbackFilter = createGitHubFeedbackFilter({
      ...(config.selfGitHubLogin !== undefined ? { selfGitHubLogin: config.selfGitHubLogin } : {}),
      ...(config.getSelfGitHubLogin !== undefined ? { getSelfGitHubLogin: config.getSelfGitHubLogin } : {}),
    });
  }

  private resolveGhToken(): string | undefined {
    return this.cfg.pluginEnv ? resolveGhCliToken({ pluginEnv: this.cfg.pluginEnv }) : undefined;
  }

  /** 拉取单个 PR 的 CI 状态（gh pr view）。 */
  fetchPrCiStatus(
    repoFullName: string,
    prNumber: number,
    log: MinimalLog,
    options: Omit<FetchPrCiStatusOptions, 'ghToken'> = {},
  ) {
    const token = this.resolveGhToken();
    return fetchPrCiStatus(repoFullName, prNumber, log, {
      ...options,
      ...(token !== undefined ? { ghToken: token } : {}),
    });
  }

  /** 批量拉取（单次 gh GraphQL）。 */
  fetchPrCiStatuses(
    targets: readonly import('./ci-status-batch-fetcher.ts').PrCiStatusTarget[],
    log: MinimalLog,
    options: Omit<FetchPrCiStatusOptions, 'ghToken'> = {},
  ) {
    const token = this.resolveGhToken();
    return fetchPrCiStatuses(targets, log, {
      ...options,
      ...(token !== undefined ? { ghToken: token } : {}),
    });
  }
}

export default ForgeEmailToolsService;
