/**
 * Shared invariants + constants for `@flowforge/cats-orchestration`.
 *
 * Batch 5 ports six clowder-ai orchestration domains into Cordis services.
 * Thresholds are centralised here (F233 Phase A convention: 集中归置不散落各处).
 *
 * @module @flowforge/cats-orchestration/invariant
 */

/** Audit NDJSON 分片目录默认值。 */
export const DEFAULT_AUDIT_DIR = './data/audit-logs'

/** AutoSummarizer：触发阈值——线程消息数低于此不生成纪要。 */
export const AUTO_SUMMARY_MESSAGE_THRESHOLD = 20

/** AutoSummarizer：两次自动纪要之间的冷却（10 分钟）。 */
export const AUTO_SUMMARY_COOLDOWN_MS = 10 * 60 * 1000

/** AutoSummarizer：单次读取线程消息上限。 */
export const AUTO_SUMMARY_READ_LIMIT = 200

/** AutoSummarizer：提取句式的消息窗口（尾部 N 条猫消息）。 */
export const AUTO_SUMMARY_TAIL_MESSAGES = 10

/** TaskExtractor：默认分析的最大消息数。 */
export const TASK_EXTRACTOR_MAX_MESSAGES = 50

/** Freshness：held envelope 预览条数上限（AC-A4）。 */
export const FRESHNESS_HELD_CONTEXT_LIMIT = 3

/** ToolUsage：事件日志容量（环形截断，进程内遥测）。 */
export const TOOL_EVENT_LOG_CAPACITY = 1000

/** ToolUsage：topTools 榜单长度。 */
export const TOOL_USAGE_TOP_TOOLS = 20

/** DutyBriefing：blocked task 超龄判睡美人（>7d）→ staleBlocked 区。 */
export const STALE_BLOCKED_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000

/** DutyBriefing：blocked task 进 needsUser 的下限（1d，AC-A2 防过敏）。 */
export const NEEDS_USER_BLOCKED_MIN_MS = 24 * 60 * 60 * 1000

/** DutyBriefing：invocation 死球 draft 新鲜窗（F194 300s）。 */
export const DEAD_BALL_FRESH_DRAFT_WINDOW_MS = 300_000

/** DutyBriefing：invocation 死球 zombie grace（F194 600s）。 */
export const DEAD_BALL_ZOMBIE_GRACE_MS = 600_000

/** DutyBriefing：默认态正文最大行数（AC-A4：10 秒可读完）。 */
export const MAX_BRIEFING_BODY_LINES = 15

/** DutyBriefing：mention 启发式扫描窗口（72h 活跃 thread）。 */
export const MENTION_SCAN_ACTIVE_WINDOW_MS = 72 * 60 * 60 * 1000

/** DutyBriefing：条目标题最大字符数（截断后加 …）。 */
export const TITLE_MAX = 60

/** DutyBriefing：rich card 稳定 id（当日已发判定依据，INV-5）。 */
export const DUTY_BRIEFING_CARD_ID = 'duty-briefing'

/** DutyBriefing：当日已发判定的消息扫描批量。 */
export const BRIEFING_SCAN_BATCH = 50
