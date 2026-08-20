/**
 * session-hooks — F33 strategy-aware hook seal 纯函数（阶段5 批次6）。
 *
 * 移植自 clowder-ai `routes/session-hooks.ts` 的 `POST /api/sessions/seal` 主逻辑：
 * PreCompact hook 触发。按 cat 策略分支：
 * - `compress`：从不 seal，仅记录压缩事件（原子 increment 防并发 P1 race）
 * - `hybrid`：允许 N 次压缩；达到上限后 seal（reason = max_compressions）
 * - `handoff`（缺省）：直接 seal（reason = hook reason）
 *
 * 纯函数化（R13 一切皆插件）：store/sealer/strategy 全部注入，便于单测各策略分支。
 *
 * @module @flowforge/chat-session-chain/hooks
 */

import { HYBRID_MAX_COMPRESSIONS } from './invariant.ts'

/** SessionRecord 最小子集（纯函数所需字段）。 */
export interface SessionChainRecordLike {
  id: string
  catId: string
  threadId: string
  status: 'active' | 'sealing' | 'sealed' | (string & {})
}

/** 已解析的 session strategy（F33）。 */
export interface StrategyLike {
  strategy: 'handoff' | 'compress' | 'hybrid'
  hybrid?: { maxCompressions: number }
}

export type HookSealOutcome =
  | { action: 'compress_allowed'; sessionId: string; compressionCount: number; maxCompressions?: number; strategy: 'compress' | 'hybrid' }
  | { action: 'sealed'; sessionId: string; threadId: string; catId: string; status: 'sealing' }

/** 注入依赖（subset，供纯函数测试隔离）。 */
export interface HandleHookSealDeps {
  getByCliSessionId(cliSessionId: string): SessionChainRecordLike | null
  incrementCompressionCount(id: string): number | Promise<number | null> | null
  requestSeal(sessionId: string, reason: string): Promise<{ accepted: boolean }>
  /** 解析 cat 的 session strategy（缺省 handoff）。 */
  getStrategy?: (catId: string) => StrategyLike
}

export interface HandleHookSealInput {
  cliSessionId: string
  reason: string
}

/** 纯函数错误码（由服务层映射为 HTTP 状态）。 */
export const HookSealErrorCode = {
  NO_SESSION: 'NO_SESSION',
  SESSION_NOT_ACTIVE: 'SESSION_NOT_ACTIVE',
  RACE_SESSION_GONE: 'RACE_SESSION_GONE',
  SEAL_RACE: 'SEAL_RACE',
} as const

/**
 * 执行 strategy-aware seal。返回 sealed（seal 已发）或 compress_allowed（未 seal，只记压缩）。
 * store/strategy 未命中或 CAS race 抛 {@link HookSealErrorCode} 错误由调用方转成 4xx。
 */
export async function handleHookSealStrategy(
  deps: HandleHookSealDeps,
  input: HandleHookSealInput,
): Promise<HookSealOutcome> {
  const record = deps.getByCliSessionId(input.cliSessionId)
  if (!record) throw new Error(HookSealErrorCode.NO_SESSION)
  if (record.status !== 'active') throw new Error(HookSealErrorCode.SESSION_NOT_ACTIVE)

  const strategy: StrategyLike = deps.getStrategy?.(record.catId) ?? { strategy: 'handoff' }

  if (strategy.strategy === 'compress') {
    const newCount = await deps.incrementCompressionCount(record.id)
    if (newCount == null) throw new Error(HookSealErrorCode.RACE_SESSION_GONE)
    return { action: 'compress_allowed', sessionId: record.id, compressionCount: newCount, strategy: 'compress' }
  }

  if (strategy.strategy === 'hybrid') {
    const max = strategy.hybrid?.maxCompressions ?? HYBRID_MAX_COMPRESSIONS
    const newCount = await deps.incrementCompressionCount(record.id)
    if (newCount == null) throw new Error(HookSealErrorCode.RACE_SESSION_GONE)
    if (newCount <= max) {
      return { action: 'compress_allowed', sessionId: record.id, compressionCount: newCount, maxCompressions: max, strategy: 'hybrid' }
    }
    // 达到/超过上限 → 用 max_compressions reason seal（不用 hook reason）。
    return sealActive(deps, record, 'max_compressions')
  }

  // handoff（缺省）→ 用 hook reason seal。
  return sealActive(deps, record, input.reason)
}

async function sealActive(
  deps: HandleHookSealDeps,
  record: SessionChainRecordLike,
  sealReason: string,
): Promise<HookSealOutcome> {
  const result = await deps.requestSeal(record.id, sealReason)
  if (!result.accepted) throw new Error(HookSealErrorCode.SEAL_RACE)
  return {
    action: 'sealed',
    sessionId: record.id,
    threadId: record.threadId,
    catId: record.catId,
    status: 'sealing',
  }
}