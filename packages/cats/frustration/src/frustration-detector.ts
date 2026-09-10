/**
 * F222: Frustration Auto-Issue — Detection service（迁移自 clowder-ai 同名文件）。
 * 评估 post-invocation 信号并创建自动 issue 草稿。Redis/store/socket 均抽象为注入式端口。
 */

import { buildFrustrationIssueCard } from './frustration-card-builder.ts'
import { TEXT_FRUSTRATION_THRESHOLD } from './text-frustration-keywords.ts'
import type {
  CatId,
  CreateFrustrationIssueInput,
  FrustrationIssue,
  FrustrationSignalType,
} from './frustration-types.ts'

export const TRIGGERING_REASON_CODES = new Set([
  'auth_failed',
  'quota_exceeded',
  'network_error',
  'context_window_exceeded',
  'tool_call_parse_failed',
  'spawn_failed',
  'invalid_config',
  'incompatible_cli_arguments',
])

const EXCLUDED_REASON_CODES = new Set([
  'server_overloaded',
  'invalid_thinking_signature',
  'missing_rollout',
  'upstream_policy_reject',
])

export const CANCEL_BURST_THRESHOLD = 3
export const A2A_TIMEOUT_THRESHOLD_MS = 60_000
export const CANCEL_WINDOW_MS = 60_000
export const DEDUP_WINDOW_MS = 5 * 60_000
export const CONTEXT_MESSAGE_COUNT = 5

export interface CliErrorSignal {
  type: 'cli_error'
  diagnostics: { reasonCode?: string; publicSummary?: string; publicHint?: string; safeExcerpt?: string }
}
export interface CancelBurstSignal {
  type: 'cancel_burst'
  recentDenials: Array<{ action: string; timestamp: number }>
}
export interface TextFrustrationSignal {
  type: 'text_frustration'
  matchedKeywords: string[]
  matchCount: number
  recentUserMessages: string[]
}
export interface A2ATimeoutSignal {
  type: 'a2a_timeout'
  targetCatId: string
  elapsedMs: number
}
export interface RetryBurstSignal {
  type: 'retry_burst'
  matchCount: number
  repeatedPrefix: string
}
export interface UserReportSignal {
  type: 'user_report'
  toolName: string
  cancelReason?: string
}

export type FrustrationSignal =
  | CliErrorSignal
  | CancelBurstSignal
  | TextFrustrationSignal
  | A2ATimeoutSignal
  | RetryBurstSignal
  | UserReportSignal

export const RETRY_BURST_THRESHOLD = 3
export const RETRY_PREFIX_LENGTH = 30

export function shouldTrigger(signal: FrustrationSignal): boolean {
  if (signal.type === 'cli_error') {
    const code = signal.diagnostics.reasonCode
    if (!code) return false
    if (EXCLUDED_REASON_CODES.has(code)) return false
    return TRIGGERING_REASON_CODES.has(code)
  }
  if (signal.type === 'cancel_burst') {
    const now = Date.now()
    const recentCount = signal.recentDenials.filter((d) => now - d.timestamp <= CANCEL_WINDOW_MS).length
    return recentCount >= CANCEL_BURST_THRESHOLD
  }
  if (signal.type === 'text_frustration') {
    return signal.matchCount >= TEXT_FRUSTRATION_THRESHOLD
  }
  if (signal.type === 'a2a_timeout') {
    return signal.elapsedMs >= A2A_TIMEOUT_THRESHOLD_MS
  }
  if (signal.type === 'retry_burst') {
    return signal.matchCount >= RETRY_BURST_THRESHOLD
  }
  if (signal.type === 'user_report') {
    return true
  }
  return false
}

const dedupMap = new Map<string, number>()

function dedupKey(threadId: string, signalType: FrustrationSignalType): string {
  return `${threadId}::${signalType}`
}

export function isDuplicate(threadId: string, signalType: FrustrationSignalType): boolean {
  const lastTriggered = dedupMap.get(dedupKey(threadId, signalType))
  return lastTriggered !== undefined && Date.now() - lastTriggered < DEDUP_WINDOW_MS
}

export function markTriggered(threadId: string, signalType: FrustrationSignalType): void {
  dedupMap.set(dedupKey(threadId, signalType), Date.now())
}

export function resetDedup(): void {
  dedupMap.clear()
}

// ── 注入式端口 ──────────────────────────────────────────────────

export interface FrustrationStoreMessage {
  id: string
  catId?: string | null
  userId?: string
  content?: string
  timestamp: number
}

export interface IFrustrationIssueStore {
  create(input: CreateFrustrationIssueInput): Promise<FrustrationIssue>
  setCardMessageId(issueId: string, messageId: string): Promise<void>
}

export interface IMessageStore {
  getByThread(threadId: string, limit?: number): Promise<FrustrationStoreMessage[]>
  append(input: {
    userId: string
    catId: string | null
    threadId: string
    content: string
    mentions: string[]
    timestamp: number
    source: Record<string, unknown>
    extra?: Record<string, unknown>
  }): Promise<FrustrationStoreMessage>
}

export interface ISocketManager {
  broadcastToRoom(room: string, event: string, payload: unknown): void
}

export interface FrustrationDetectorDeps {
  frustrationIssueStore: IFrustrationIssueStore
  messageStore: IMessageStore
  socketManager?: ISocketManager
}

export interface EvaluateInput {
  signal: FrustrationSignal
  threadId: string
  userId: string
  catId: string
  invocationId?: string
}

export async function evaluate(
  input: EvaluateInput,
  deps: FrustrationDetectorDeps,
): Promise<FrustrationIssue | null> {
  const { signal, threadId, userId, catId, invocationId } = input
  if (!shouldTrigger(signal)) return null

  const signalType: FrustrationSignalType = signal.type
  if (signalType !== 'user_report' && isDuplicate(threadId, signalType)) return null

  let signalDetail: Record<string, unknown>
  if (signal.type === 'cli_error') {
    signalDetail = {
      reasonCode: signal.diagnostics.reasonCode,
      publicSummary: signal.diagnostics.publicSummary,
      publicHint: signal.diagnostics.publicHint,
    }
  } else if (signal.type === 'cancel_burst') {
    signalDetail = { cancelCount: signal.recentDenials.length, windowMs: CANCEL_WINDOW_MS }
  } else if (signal.type === 'text_frustration') {
    signalDetail = { matchedKeywords: signal.matchedKeywords, matchCount: signal.matchCount }
  } else if (signal.type === 'a2a_timeout') {
    signalDetail = { targetCatId: signal.targetCatId, elapsedMs: signal.elapsedMs }
  } else if (signal.type === 'retry_burst') {
    signalDetail = { matchCount: signal.matchCount, repeatedPrefix: signal.repeatedPrefix }
  } else {
    signalDetail = { toolName: signal.toolName, cancelReason: signal.cancelReason }
  }

  let recentMessages: Array<{ role: 'user' | 'cat' | 'system'; content: string; timestamp: number }> = []
  try {
    const messages = await deps.messageStore.getByThread(threadId, CONTEXT_MESSAGE_COUNT)
    recentMessages = messages.map((m) => ({
      role: (m.catId ? 'cat' : m.userId === 'system' ? 'system' : 'user') as 'user' | 'cat' | 'system',
      content: typeof m.content === 'string' ? m.content.slice(0, 500) : '',
      timestamp: m.timestamp,
    }))
  } catch {
    // 非阻塞：context 收集失败不影响 issue 创建
  }

  const issue = await deps.frustrationIssueStore.create({
    threadId,
    userId,
    catId: catId as CatId,
    ...(invocationId !== undefined ? { invocationId } : {}),
    signalType,
    signalDetail,
    context: {
      recentMessages,
      ...(signal.type === 'cli_error' && signal.diagnostics.safeExcerpt
        ? { errorLogs: signal.diagnostics.safeExcerpt }
        : {}),
    },
  })

  const cardBlock = buildFrustrationIssueCard(issue)

  try {
    const stored = await deps.messageStore.append({
      userId: 'system',
      catId: null,
      threadId,
      content: `[${signalType === 'user_report' ? '用户反馈' : '自动检测'}] 已自动整理上下文。`,
      mentions: [],
      timestamp: Date.now(),
      source: { connector: 'frustration-auto-issue', label: '问题检测', icon: '🔍' },
      extra: { rich: { v: 1, blocks: [cardBlock] } },
    })
    await deps.frustrationIssueStore.setCardMessageId(issue.issueId, stored.id)
    if (deps.socketManager) {
      deps.socketManager.broadcastToRoom(`thread:${threadId}`, 'connector_message', {
        threadId,
        message: { id: stored.id, type: 'connector', content: stored.content },
      })
    }
  } catch {
    // 非阻塞：卡片投递失败，issue 仍在 store
  }

  if (signalType !== 'user_report') {
    markTriggered(threadId, signalType)
  }

  return issue
}