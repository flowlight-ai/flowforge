/**
 * @flowforge/chat-mention — callback-auth 签名校验纯函数 + in-context notifier
 * （T5.3.3，阶段5 批次5）。
 *
 * 移植 clowder-ai `callback-auth-prehandler.ts` 的纯抽取面 + `callback-auth-system-message.ts`
 * 的 F174 D2b-1 notifier。HTTP 框架无关：headers/body/query 结构注入，notifier 依赖
 * 最小结构化 `append` + `broadcastToRoom`（可无缝对接 cats-stores / chat-realtime / 适配器）。
 *
 * 表面决策：仅 `expired`/`invalid_token` 表面化；心跳工具（refresh-token）跳过；
 * 同 (reason, tool, catId, threadId, userId) 5 分钟去重 + "隐藏相似" 24h 抑制。
 *
 * @module @flowforge/chat-mention/callback-auth
 */

import { randomUUID } from 'node:crypto'
import type { CallbackAuthFailureReason, CatId } from '@flowforge/cats-shared'
import {
  BACKGROUND_HEARTBEAT_TOOLS,
  CALLBACK_AUTH_SOURCE,
  DEDUP_WINDOW_MS,
  HIDE_WINDOW_MS,
  REASON_DESCRIPTIONS,
  SURFACEABLE_REASONS,
} from './invariant.ts'

export type CallbackAuthReason = CallbackAuthFailureReason | 'missing_creds'

export function isSurfaceableReason(reason: string): boolean {
  return SURFACEABLE_REASONS.has(reason)
}

export function isBackgroundHeartbeatTool(tool: string): boolean {
  return BACKGROUND_HEARTBEAT_TOOLS.has(tool)
}

export type HeaderBag = Record<string, string | string[] | undefined>

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (Array.isArray(value)) return value[0] || undefined
  return undefined
}

/**
 * F174 Phase D1 — 由 URL 推导简洁 tool 名（callback_auth.failures{callback.tool}）。
 * 剥掉 `/api/callbacks/` 前缀与查询串；不匹配返回 'unknown'（防御默认）。
 */
export function callbackToolFromUrl(url: string): string {
  const path = url.split('?')[0] ?? ''
  const match = path.match(/^\/api\/callbacks\/([^/]+)/)
  return match ? (match[1] ?? 'unknown') : 'unknown'
}

/**
 * F174-C — 单点权威：请求实际携带哪种 callback 凭证（headers 优先；二者都缺时
 * 回退 legacy body/query）；混合来源（header + body 各一半）返回 null（preHandler 会 401）。
 */
export function extractCallbackCredentials(
  headers: HeaderBag,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): { invocationId: string; callbackToken: string } | null {
  const headerInv = firstHeaderValue(headers['x-invocation-id'])
  const headerTok = firstHeaderValue(headers['x-callback-token'])

  if (headerInv && headerTok) {
    return { invocationId: headerInv, callbackToken: headerTok }
  }
  if (!headerInv && !headerTok) {
    const legacy = extractLegacyCredentials(body, query)
    if (legacy?.invocationId && legacy?.callbackToken) {
      return { invocationId: legacy.invocationId, callbackToken: legacy.callbackToken }
    }
  }
  return null
}

/** 从 body（POST）/ query（GET）抽取 legacy 凭证；返回部分结果供 fail-closed。 */
export function extractLegacyCredentials(
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): { invocationId: string | undefined; callbackToken: string | undefined } | null {
  if (body) {
    const id = typeof body.invocationId === 'string' ? body.invocationId : undefined
    const tok = typeof body.callbackToken === 'string' ? body.callbackToken : undefined
    if (id || tok) return { invocationId: id, callbackToken: tok }
  }
  if (query) {
    const id = typeof query.invocationId === 'string' ? query.invocationId : undefined
    const tok = typeof query.callbackToken === 'string' ? query.callbackToken : undefined
    if (id || tok) return { invocationId: id, callbackToken: tok }
  }
  return null
}

// ── In-context notifier（F174 D2b-1）─────────────────────────────────

export interface NotifyParams {
  threadId: string
  catId: CatId
  userId: string
  reason: CallbackAuthReason
  tool: string
  fallbackOk?: boolean
}

export interface HideSimilarParams extends NotifyParams {}

/** 最小结构化消息存储（可对接 cats-stores IMessageStore / 适配器）。 */
export interface CallbackAuthMessageStore {
  append(msg: {
    userId: string
    catId: CatId | null
    content: string
    mentions: readonly CatId[]
    timestamp: number
    threadId: string
    extra?: { rich: { v: 1; blocks: readonly unknown[] } }
  }): Promise<{ id: string; content: string; timestamp: number; extra?: unknown }> | { id: string; content: string; timestamp: number; extra?: unknown }
}

/** 最小结构化socket 广播器（可对接 ChatRealtimeService broadcastToRoom）。 */
export interface CallbackAuthSocketBroadcaster {
  broadcastToRoom(room: string, event: string, payload: unknown): void
}

export interface NotifierOptions {
  messageStore: CallbackAuthMessageStore
  socketManager: CallbackAuthSocketBroadcaster
  now?: () => number
}

interface DedupState {
  lastSentAt: number
  hiddenAt?: number
}

function dedupKey(p: { reason: string; tool: string; catId: string; threadId: string; userId: string }): string {
  // Cloud Codex P1 #1397: 含 threadId + userId，避免跨线程/租户误抑制。
  return `${p.reason}:${p.tool}:${p.catId}:${p.threadId}:${p.userId}`
}

export class CallbackAuthSystemMessageNotifier {
  private readonly messageStore: CallbackAuthMessageStore
  private readonly socketManager: CallbackAuthSocketBroadcaster
  private readonly now: () => number
  private readonly dedup = new Map<string, DedupState>()

  constructor(options: NotifierOptions) {
    this.messageStore = options.messageStore
    this.socketManager = options.socketManager
    this.now = options.now ?? (() => Date.now())
  }

  /** 机会式驱逐已过期 dedup 条目，避免长驻进程内存泄漏。 */
  private pruneExpired(now: number): void {
    for (const [key, state] of this.dedup) {
      const expiresAt =
        state.hiddenAt !== undefined ? state.hiddenAt + HIDE_WINDOW_MS : state.lastSentAt + DEDUP_WINDOW_MS
      if (now >= expiresAt) {
        this.dedup.delete(key)
      }
    }
  }

  /** Test seam — 内存回归测试用。 */
  __getDedupSizeForTest(): number {
    return this.dedup.size
  }

  /**
   * 决策 + （表面化、未去重、未隐藏时）投递 in-context 富块。
   * 返回是否真正发送。
   */
  async notify(params: NotifyParams): Promise<boolean> {
    const now = this.now()
    this.pruneExpired(now)

    if (!isSurfaceableReason(params.reason)) return false
    if (isBackgroundHeartbeatTool(params.tool)) return false

    const key = dedupKey({
      reason: params.reason,
      tool: params.tool,
      catId: params.catId,
      threadId: params.threadId,
      userId: params.userId,
    })
    const state = this.dedup.get(key)

    if (state?.hiddenAt !== undefined && now - state.hiddenAt < HIDE_WINDOW_MS) {
      return false
    }
    if (state && state.hiddenAt === undefined && now - state.lastSentAt < DEDUP_WINDOW_MS) {
      return false
    }

    // Cloud Codex P2 #1397: 同步预留 dedup 槽位，防并发 notify 双投。
    this.dedup.set(key, { lastSentAt: now })

    let stored: { id: string; content: string; timestamp: number; extra?: unknown }
    try {
      const block = buildAuthFailureBlock({ ...params, failedAt: now })
      stored = await this.messageStore.append({
        userId: params.userId,
        catId: null,
        content: `[callback-auth] ${params.tool} → ${params.reason}${params.fallbackOk ? ' (fallback ok)' : ''}`,
        mentions: [],
        timestamp: now,
        threadId: params.threadId,
        extra: { rich: { v: 1 as const, blocks: [block] } },
      })
    } catch (err) {
      const current = this.dedup.get(key)
      if (current && current.lastSentAt === now && current.hiddenAt === undefined) {
        this.dedup.delete(key)
      }
      throw err
    }

    this.socketManager.broadcastToRoom(`thread:${params.threadId}`, 'connector_message', {
      threadId: params.threadId,
      message: {
        id: stored.id,
        type: 'connector',
        content: stored.content,
        source: CALLBACK_AUTH_SOURCE,
        timestamp: stored.timestamp,
        extra: stored.extra,
      },
    })

    return true
  }

  /** 对同一 (reason, tool, catId, threadId, userId) 24h 抑制后续表面化。 */
  hideSimilar(params: HideSimilarParams): void {
    const key = dedupKey(params)
    const now = this.now()
    this.dedup.set(key, { lastSentAt: now, hiddenAt: now })
  }
}

export interface CallbackAuthFailureBlock {
  v: 1
  id: string
  kind: 'card'
  title: string
  bodyMarkdown: string
  tone: 'warning'
  fields: { label: string; value: string }[]
  meta: Record<string, unknown>
}

function buildAuthFailureBlock(
  params: NotifyParams & { failedAt: number },
): CallbackAuthFailureBlock {
  return {
    v: 1,
    id: randomUUID(),
    kind: 'card',
    title: 'Callback Auth Failure',
    bodyMarkdown: `\`${params.tool}\` callback auth 失败：${REASON_DESCRIPTIONS[params.reason] ?? params.reason}${
      params.fallbackOk ? '（fallback 已成功）' : ''
    }`,
    tone: 'warning',
    fields: [
      { label: 'Reason', value: params.reason },
      { label: 'Tool', value: params.tool },
      { label: 'Cat', value: params.catId },
      { label: 'Failed', value: new Date(params.failedAt).toISOString() },
    ],
    meta: {
      kind: 'callback_auth_failure',
      reason: params.reason,
      tool: params.tool,
      catId: params.catId,
      threadId: params.threadId,
      userId: params.userId,
      failedAt: params.failedAt,
      fallbackOk: params.fallbackOk ?? false,
    },
  }
}