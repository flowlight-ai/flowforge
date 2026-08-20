/**
 * chat-approval 域不变量与常量（阶段5 批次4）。
 *
 * 汇集 clowder-ai 审批/投票域的跨文件常量（F128/F079），供服务、纯函数与
 * 测试共用。所有用户可见文案沿用 clowder-ai 语义（不硬编码散落）。
 *
 * @module @flowforge/chat-approval/invariant
 */

/** F128 stale-claim 恢复阈值：approving 超过此窗口视为 claimer 崩溃。 */
export const STALE_APPROVING_MS = 30_000

/** F079 投票时限边界。 */
export const VOTE_QUESTION_MAX = 500
export const VOTE_OPTION_MAX = 100
export const VOTE_OPTION_MIN = 2
export const VOTE_OPTION_MAX_COUNT = 20
export const VOTE_VOTERS_MIN = 1
export const VOTE_VOTERS_MAX = 20
export const VOTE_TIMEOUT_MIN_SEC = 10
export const VOTE_TIMEOUT_MAX_SEC = 600
export const VOTE_TIMEOUT_DEFAULT_SEC = 120

/** 广播事件名（对齐 clowder-ai socket 事件词汇）。 */
export const EVENT_PROPOSAL_UPDATED = 'proposal_updated'
export const EVENT_VOTE_STARTED = 'vote_started'
export const EVENT_VOTE_CLOSED = 'vote_closed'

/** 终态冲突提示（对齐 clowder-ai proposal-terminal-conflict）。 */
export const CANNOT_APPROVE_NON_PENDING = 'proposal is not pending'
export const CANNOT_REJECT_APPROVED_THREAD = 'proposal already created a thread; cannot reject'
