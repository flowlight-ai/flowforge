/**
 * @flowforge/chat-session-chain — session-chain/handoff/strategy/hooks Cordis 插件
 * （阶段5 批次6，T5.4）。
 *
 * Mounts 四个服务：
 * - `ctx.chatSessionChain` — F24 会话链管理（list/get/unseal/bind，复用 cats-session
 *   Sealer 的 unseal-displacement 语义）
 * - `ctx.chatSessionHandoff` — F225 cat-initiated session handoff（提案/审批/执行；
 *   commit-point 事务 + crash recovery，依赖批次4 approval 的
 *   ISessionHandoffProposalStore 提升）
 * - `ctx.chatSessionStrategy` — F33 per-cat session 策略配置（layered lookup + override +
 *   shouldTakeAction 决策）
 * - `ctx.chatSessionHooks` — F24/F33 CLI hooks（strategy-aware seal / latest-digest /
 *   F073 P4 SOP bookmark）
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-stores'       # mounts sessionChains()/sessionHandoffProposals()
 * - name: '@flowforge/cats-session'      # mounts catsSessionSealer / catsTranscriptReader
 * - name: '@flowforge/chat-session-chain'
 * # optional collaborators (lazy-resolved):
 * - name: '@flowforge/cats-invocation'   # continuation enqueue (④ B5)
 * - name: '@flowforge/chat-realtime'     # proposal_updated broadcast
 * ```
 *
 * @module @flowforge/chat-session-chain
 */

import type { Context } from '@flowforge/cordis'
import { SessionChainService } from './session-chain-service.ts'
import { ChatSessionHandoffService } from './session-handoff-service.ts'
import { ChatSessionStrategyService } from './session-strategy-service.ts'
import { SessionHooksService } from './session-hooks-service.ts'

declare module '@flowforge/cordis' {
  interface Context {
    /** F24 会话链管理 — mounted by `@flowforge/chat-session-chain`. */
    chatSessionChain: SessionChainService
    /** F225 session handoff — mounted by `@flowforge/chat-session-chain`. */
    chatSessionHandoff: ChatSessionHandoffService
    /** F33 per-cat session strategy config — mounted by `@flowforge/chat-session-chain`. */
    chatSessionStrategy: ChatSessionStrategyService
    /** F24/F33 CLI session hooks — mounted by `@flowforge/chat-session-chain`. */
    chatSessionHooks: SessionHooksService
  }
}

export { ChatSessionChainError, SessionChainErrorCode, SessionChainService } from './session-chain-service.ts'
export type {
  BindCliSessionResult,
  SessionChainServiceOptions,
  UnsealResult,
} from './session-chain-service.ts'

export {
  ChatSessionHandoffError,
  SessionHandoffErrorCode,
  ChatSessionHandoffService,
} from './session-handoff-service.ts'
export type {
  ProposeHandoffServiceInput,
  ProposeHandoffServiceResult,
  RejectHandoffServiceInput,
  SessionHandoffServiceOptions,
} from './session-handoff-service.ts'

export {
  ChatSessionStrategyError,
  ChatSessionStrategyService,
  HOOK_CAPABLE_PROVIDERS,
  mergeStrategyConfig,
  shouldTakeAction,
  validateProviderCapability,
} from './session-strategy-service.ts'
export type {
  DeepPartial,
  SessionStrategyServiceOptions,
  StrategyOverrideStore,
  StrategySource,
} from './session-strategy-service.ts'

export { SessionHooksError, SessionHooksService } from './session-hooks-service.ts'
export type { HookSealResult, HookSealDeps, LatestDigestResult } from './session-hooks-service.ts'

export {
  approveSessionHandoff,
  buildHandoffProposalCardBlock,
  proposeSessionHandoff,
  recoverStaleHandoffProposal,
} from './handoff.ts'
export type {
  ApproveResult,
  ContinuationInput,
  ProposeHandoffDeps,
  ProposeHandoffInput,
  ProposeResult,
  RecoverResult,
  SessionHandoffApproveDeps,
} from './handoff.ts'

export {
  handleHookSealStrategy,
  HookSealErrorCode,
} from './session-hooks.ts'
export type { HandleHookSealDeps, HandleHookSealInput, HookSealOutcome, SessionChainRecordLike, StrategyLike } from './session-hooks.ts'

export {
  APPROVE_STALE_MS,
  DEFAULT_STRATEGY_BY_PROVIDER,
  GLOBAL_DEFAULT_STRATEGY,
  HANDOFF_CONTINUATION_PROMPT,
  HANDOFF_COOLDOWN_MS,
  HANDOFF_HOURLY_LIMIT,
  HANDOFF_HOURLY_WINDOW_MS,
  HANDOFF_LIST_LIMIT,
  HANDOFF_MAX_ACTIVE_PER_SESSION,
  HYBRID_MAX_COMPRESSIONS,
  SOP_BOOKMARK_TTL_MS,
} from './invariant.ts'

export default function Plugin(ctx: Context) {
  ctx.plugin(SessionChainService)
  ctx.plugin(ChatSessionHandoffService)
  ctx.plugin(ChatSessionStrategyService)
  ctx.plugin(SessionHooksService)
}