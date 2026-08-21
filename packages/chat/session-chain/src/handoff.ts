/**
 * session-handoff — F225 cat-side handoff propose / approve / recover 纯函数。
 *
 * 移植自 clowder-ai
 * `packages/api/src/domains/cats/services/session/sessionHandoffPropose.ts` 与
 * `sessionHandoffApprove.ts`（全量移植，R13 一切皆插件：HTTP 面抽离，服务层在上层
 * `handoff-service.ts` 编排）。依赖仅 store 接口 + 注入函数，便于单元测试
 * commit-point/失败边界（KD-8/9）。
 *
 * @module @flowforge/chat-session-chain/handoff
 */

import type {
  CatHandoffNote,
  CatId,
  RichCardBlock,
  SessionHandoffProposal,
} from '@flowforge/cats-shared'
import type {
  CreateHandoffProposalInput,
  ISessionChainStore,
  ISessionHandoffProposalStore,
} from '@flowforge/cats-stores'
import { HANDOFF_HOURLY_LIMIT, HANDOFF_HOURLY_WINDOW_MS, HANDOFF_COOLDOWN_MS } from './invariant.ts'

// ── propose ─────────────────────────────────────────────────────────────

/** F225 propose 输入（五件套留言；proposalId/persistedAt/sourceSessionId 由 store 填）。 */
export interface ProposeHandoffInput {
  sourceCatId: CatId
  sourceThreadId: string
  sourceMessageId: string
  userId: string
  /** 五件套留言（done/nextSteps 必填）。 */
  note: {
    done: string
    nextSteps: string
    worktreeBranch?: string
    commits?: string[]
    gotchas?: string
  }
  /** 预留 proposalId（dedup 用）。 */
  proposalId?: string
}

/** propose 依赖（store + getActive + A4 窗口/上限，均可注入覆盖便于测试）。 */
export interface ProposeHandoffDeps {
  handoffProposalStore: ISessionHandoffProposalStore
  sessionChainStore: Pick<ISessionChainStore, 'getActive'>
  cooldownMs?: number
  hourlyLimit?: number
  hourlyWindowMs?: number
  now?: () => number
}

export type ProposeResult =
  | { ok: true; proposal: SessionHandoffProposal }
  | { ok: false; reason: 'no_active_session' | 'already_pending' | 'cooldown' | 'hourly_limit' }

/**
 * 为猫的 CURRENT active session 创建 handoff proposal。
 * 要封印的 session 从 getActive 解析（不信任 caller），猫只能提议自己正运行的 session。
 * A4 abuse guard：≤1 pending/active session + per-(cat,thread) cooldown + hourly cap。
 */
export async function proposeSessionHandoff(
  deps: ProposeHandoffDeps,
  input: ProposeHandoffInput,
): Promise<ProposeResult> {
  const { handoffProposalStore: store, sessionChainStore } = deps

  const active = await sessionChainStore.getActive(input.sourceCatId, input.sourceThreadId)
  if (!active) return { ok: false, reason: 'no_active_session' }

  // A4: ≤1 pending|approving handoff proposal per active session。
  const existing = await store.listActiveBySession(active.id)
  if (existing.length > 0) return { ok: false, reason: 'already_pending' }

  // A4 cooldown：reject/expire（或任何最近 proposal）后不能立刻重刷（砚砚 P2）。
  const now = deps.now ?? (() => Date.now())
  const cooldownMs = deps.cooldownMs ?? HANDOFF_COOLDOWN_MS
  const recent = await store.getMostRecentByCatThread(input.userId, input.sourceCatId, input.sourceThreadId)
  // Elapsed clamped ≥0：store 的单调 createdAt 可能比 wall-clock now() 快几 ms。
  if (recent && Math.max(0, now() - recent.createdAt) < cooldownMs) {
    return { ok: false, reason: 'cooldown' }
  }

  // A4 hourly cap（砚砚 P2 / AC-A4 / OQ-4）：cooldown 单靠 5 分钟默认仍可漏 ~12 卡/小时。
  const hourlyWindowMs = deps.hourlyWindowMs ?? HANDOFF_HOURLY_WINDOW_MS
  const hourlyLimit = deps.hourlyLimit ?? HANDOFF_HOURLY_LIMIT
  const recentCount = await store.countRecentByCatThread(
    input.userId,
    input.sourceCatId,
    input.sourceThreadId,
    now() - hourlyWindowMs,
  )
  if (recentCount >= hourlyLimit) {
    return { ok: false, reason: 'hourly_limit' }
  }

  const proposal = await store.create({
    sourceThreadId: input.sourceThreadId,
    sourceSessionId: active.id,
    sourceCatId: input.sourceCatId,
    sourceMessageId: input.sourceMessageId,
    userId: input.userId,
    note: input.note,
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
  } satisfies CreateHandoffProposalInput)
  return { ok: true, proposal }
}

/** 面向 co-creator 的确认卡（approve/reject gate）。 */
export function buildHandoffProposalCardBlock(proposal: SessionHandoffProposal): RichCardBlock {
  const n = proposal.note
  const fields: Array<{ label: string; value: string }> = [
    { label: '封印 session', value: proposal.sourceSessionId },
    { label: '已完成', value: n.done },
    { label: '下一步', value: n.nextSteps },
  ]
  if (n.worktreeBranch) fields.push({ label: 'worktree', value: n.worktreeBranch })
  if (n.commits?.length) fields.push({ label: 'commits', value: n.commits.join(', ') })
  if (n.gotchas) fields.push({ label: 'gotchas', value: n.gotchas })
  return {
    id: `handoff-${proposal.proposalId}`,
    kind: 'card',
    v: 1,
    title: '提议 session 接力（封印当前 → 续接 fresh 自己）',
    bodyMarkdown: `${proposal.sourceCatId} 想在干净断点封印当前 session，把这份亲手写的交接带给续接的自己。`,
    tone: 'info',
    fields,
    actions: [
      { label: '批准并接力', action: 'handoff:approve', payload: { proposalId: proposal.proposalId } },
      { label: '驳回', action: 'handoff:reject', payload: { proposalId: proposal.proposalId } },
    ],
  }
}

// ── approve（commit-point 事务）──────────────────────────────────────────

/** approve 事务依赖（requestSeal/enqueueContinuation 为基础设施适配器注入）。 */
export interface SessionHandoffApproveDeps {
  handoffProposalStore: ISessionHandoffProposalStore
  sessionChainStore: Pick<ISessionChainStore, 'get' | 'getActive' | 'update'>
  requestSeal: (sessionId: string, reason: string) => Promise<{ accepted: boolean }>
  enqueueContinuation: (input: ContinuationInput) => Promise<{ entryId: string }>
  now?: () => number
}

/** 续接入队负载（idempotency keyed by proposalId）。 */
export interface ContinuationInput {
  proposalId: string
  sourceSessionId: string
  threadId: string
  catId: CatId
  note: CatHandoffNote
}

export type ApproveResult =
  | { ok: true; proposal: SessionHandoffProposal }
  | { ok: false; stage: 'pre-commit'; reason: 'not_pending' | 'session_changed' | 'seal_rejected' }

/**
 * Approve 一个 handoff proposal。
 * pre-commit（claim → 校验 active → 持久化 note）可 fail/expire；
 * commit point = requestSeal accepted（不可逆，置 sealing + 清 active pointer）；
 * post-commit（enqueue → finalize）只 recover-forward（抛错由 caller 上抛 → crash recovery 续跑）。
 */
export async function approveSessionHandoff(
  deps: SessionHandoffApproveDeps,
  proposalId: string,
): Promise<ApproveResult> {
  const now = deps.now ?? (() => Date.now())
  const { handoffProposalStore: store, sessionChainStore } = deps

  // ── Pre-commit step 1: CAS claim ──
  const claimed = await store.claimForApproval(proposalId)
  if (!claimed) return { ok: false, stage: 'pre-commit', reason: 'not_pending' }

  // ── Pre-commit step 2: 校验 sourceSessionId 仍是同 (user,thread,cat) 的 active session ──
  const session = await sessionChainStore.get(claimed.sourceSessionId)
  const active = await sessionChainStore.getActive(claimed.sourceCatId, claimed.sourceThreadId)
  const stillActive =
    session?.status === 'active' && active?.id === claimed.sourceSessionId && session.userId === claimed.userId
  if (!stillActive) {
    await store.markExpired(proposalId)
    return { ok: false, stage: 'pre-commit', reason: 'session_changed' }
  }

  // ── Pre-commit step 3: 持久化 catHandoffNote 到 session（commit-point 反推 key, KD-9） ──
  await sessionChainStore.update(claimed.sourceSessionId, { catHandoffNote: claimed.note })
  await store.recordCheckpoint(proposalId, { handoffNotePersistedAt: now() })

  // ── Commit point: requestSeal ──
  const seal = await deps.requestSeal(claimed.sourceSessionId, 'cat_initiated_handoff')
  if (!seal.accepted) {
    // Still pre-commit（无不可逆 seal）。stale note 由 B4 injection 门控防泄露。
    await store.markExpired(proposalId)
    return { ok: false, stage: 'pre-commit', reason: 'seal_rejected' }
  }
  // COMMIT POINT crossed — 持久化 durable checkpoint；自此只 recover-forward。
  await store.recordCheckpoint(proposalId, { sealedSessionId: claimed.sourceSessionId, sealAcceptedAt: now() })

  // ── Post-commit（recover-forward only；抛错由 recovery 从 checkpoint 续跑） ──
  const cont = await deps.enqueueContinuation({
    proposalId,
    sourceSessionId: claimed.sourceSessionId,
    threadId: claimed.sourceThreadId,
    catId: claimed.sourceCatId,
    note: claimed.note,
  })
  await store.recordCheckpoint(proposalId, { continuationEntryId: cont.entryId })
  const finalized = await store.finalizeApproval(proposalId)
  // finalizeApproval CAS-returns null only if status drifted；treat as already-approved。
  return { ok: true, proposal: finalized ?? (await store.get(proposalId))! }
}

// ── crash recovery（B3） ────────────────────────────────────────────────

export interface RecoverResult {
  recovered: boolean
  outcome?: 'completed' | 'expired'
  reason?: 'not_approving' | 'ambiguous_session_state'
}

/**
 * B3：crash 后恢复卡在 'approving' 的 proposal（KD-9 crash-window 闭合）。
 * 无法单靠 proposal 判断 pre-commit——必须交叉核对 session 侧：若 session 已被本次
 * handoff seal（sealReason + note.proposalId 匹配）→ commit point 已过 → backfill +
 * recover-forward；仍 active → seal 未发生 → 安全 expire（砚砚 R3 P1）。
 */
export async function recoverStaleHandoffProposal(
  deps: SessionHandoffApproveDeps,
  proposalId: string,
): Promise<RecoverResult> {
  const now = deps.now ?? (() => Date.now())
  const { handoffProposalStore: store, sessionChainStore } = deps

  let proposal = await store.get(proposalId)
  if (!proposal || proposal.status !== 'approving') {
    return { recovered: false, reason: 'not_approving' }
  }

  // Commitment checkpoint missing → reverse-lookup session 侧。覆盖 BOTH crash 子态：
  // "claim → note-checkpoint crash"（无任何 checkpoint）与
  // "note → seal-checkpoint crash"（handoffNotePersistedAt 有、sealedSessionId 无）。
  if (!proposal.sealedSessionId) {
    const session = await sessionChainStore.get(proposal.sourceSessionId)
    const sealedByThisHandoff =
      !!session &&
      (session.status === 'sealing' || session.status === 'sealed') &&
      session.sealReason === 'cat_initiated_handoff' &&
      session.catHandoffNote?.proposalId === proposalId
    if (sealedByThisHandoff) {
      // commit point 实际已过 → backfill durable checkpoint（可能丢了 note checkpoint）。
      proposal = (await store.recordCheckpoint(proposalId, {
        handoffNotePersistedAt: proposal.handoffNotePersistedAt ?? now(),
        sealedSessionId: proposal.sourceSessionId,
        sealAcceptedAt: now(),
      }))!
    } else {
      // requestSeal 从未 accepted（note 未持久化或未到 seal）→ 真 pre-commit，安全 expire。
      await store.markExpired(proposalId)
      return { recovered: true, outcome: 'expired' }
    }
  }

  // Post-commit recover-forward（idempotent）：重建/校验 continuation 队列入口后 finalize。
  if (proposal.sealedSessionId && proposal.status === 'approving') {
    const cont = await deps.enqueueContinuation({
      proposalId,
      sourceSessionId: proposal.sourceSessionId,
      threadId: proposal.sourceThreadId,
      catId: proposal.sourceCatId,
      note: proposal.note,
    })
    proposal = (await store.recordCheckpoint(proposalId, { continuationEntryId: cont.entryId }))!
  }
  if (proposal.sealedSessionId && proposal.status === 'approving') {
    await store.finalizeApproval(proposalId)
  }
  return { recovered: true, outcome: 'completed' }
}