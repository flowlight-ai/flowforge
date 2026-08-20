/**
 * @flowforge/chat-session-chain — shared invariants & prompt copy (stage-5 batch 6).
 *
 * 集中管理会话链/交接/策略/hook 的阈值与面向 Llama 的提示文案，避免散落硬编码。
 * 对齐批次 4/5 范式（proposal-service 的 CANNOT_APPROVE_NON_PENDING 等常量化）。
 *
 * @module @flowforge/chat-session-chain/invariant
 */

// ── F225 A4 abuse-guard 阈值 ────────────────────────────────────────────
/** Per-(user,cat,thread) cooldown 窗口（reject/expire 后不让立刻重刷卡片）。 */
export const HANDOFF_COOLDOWN_MS = 5 * 60 * 1000
/** A4 hourly cap 窗口。 */
export const HANDOFF_HOURLY_WINDOW_MS = 60 * 60 * 1000
/** A4 hourly cap：per-(user,cat,thread) 最近一小时最大提案数。 */
export const HANDOFF_HOURLY_LIMIT = 5
/** 单 active session 最多 1 个 pending|approving proposal。 */
export const HANDOFF_MAX_ACTIVE_PER_SESSION = 1

/** approving 卡住多久视为 crash-stale（健康 commit-point 事务秒级完成）。 */
export const APPROVE_STALE_MS = 30_000
/** 卡片兜底默认列表上限。 */
export const HANDOFF_LIST_LIMIT = 100

// ── F225 ④ B5 continuation 入队提示（外部化，勿内联）───────────────────────
export const HANDOFF_CONTINUATION_PROMPT =
  '〔session 接力续接〕你在上个 session 的干净断点主动发起了 handoff 并获批。这是 fresh context 的你——' +
  '上个 session 你亲手写的五件套交接留言已在上方 bootstrap 注入。请据此无缝接力，从 next_steps 继续。'

// ── F33 session hooks ───────────────────────────────────────────────────
/** 支持压缩事件信号（PreCompact hook）的 provider（hybrid 策略必需）。 */
export const HOOK_CAPABLE_PROVIDERS: ReadonlySet<string> = new Set(['anthropic'])
/** hybrid 缺省最大压缩次数。 */
export const HYBRID_MAX_COMPRESSIONS = 2
/** F073 P4 SOP bookmark TTL（24h，best-effort）。 */
export const SOP_BOOKMARK_TTL_MS = 24 * 60 * 60 * 1000

// ── F33 session strategy 缺省（对齐 clowder config/session-strategy.ts）──
/** 全局缺省策略（无 provider/无 override 时兜底）。 */
export const GLOBAL_DEFAULT_STRATEGY = {
  strategy: 'handoff',
  thresholds: { warn: 0.75, action: 0.85 },
  turnBudget: 12_000,
  safetyMargin: 4_000,
} as const

/** provider 级缺省策略（clowder DEFAULT_STRATEGY_BY_PROVIDER）。 */
export const DEFAULT_STRATEGY_BY_PROVIDER: Readonly<Record<string, {
  strategy: 'handoff'
  thresholds: { warn: number; action: number }
  turnBudget: number
  safetyMargin: number
}>> = {
  anthropic: { strategy: 'handoff', thresholds: { warn: 0.8, action: 0.9 }, turnBudget: 12_000, safetyMargin: 4_000 },
  openai: { strategy: 'handoff', thresholds: { warn: 0.75, action: 0.85 }, turnBudget: 12_000, safetyMargin: 4_000 },
  google: { strategy: 'handoff', thresholds: { warn: 0.55, action: 0.65 }, turnBudget: 12_000, safetyMargin: 4_000 },
  opencode: { strategy: 'handoff', thresholds: { warn: 0.75, action: 0.85 }, turnBudget: 12_000, safetyMargin: 4_000 },
}