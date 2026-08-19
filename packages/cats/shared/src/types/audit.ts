/**
 * Event Audit Log types (F-orchestration).
 *
 * Append-only 事件日志契约：记录关键里程碑（辩论冠军宣判 / Phase 完成 /
 * Review 批准 / 重要决策等）。设计原则：
 * - 只追加，不可修改（append-only）
 * - 每个事件都有唯一 ID 和时间戳
 * - 文件名按日期分片（ndjson），便于归档
 * - 即使持久层丢失，真相仍可追溯
 *
 * Ported from clowder-ai `orchestration/EventAuditLog.ts` (types split out
 * for cross-package consumption — the Cordis service lives in
 * `@flowforge/cats-orchestration`).
 *
 * @module @flowforge/cats-shared/types
 */

/** A single append-only audit event. */
export interface AuditEvent {
  readonly id: string;
  readonly type: string;
  readonly timestamp: number;
  readonly threadId?: string;
  readonly data: Record<string, unknown>;
  /** Optional hash signature for integrity verification. */
  readonly signature?: string;
}

/** Input for appending an event (id/timestamp are service-owned). */
export type AuditEventInput = Omit<AuditEvent, 'id' | 'timestamp'>;

/** Common audit event types (Clowder AI parity, stable string contract). */
export const AuditEventTypes = Object.freeze({
  /** 辩论/讨论冠军宣判 */
  DEBATE_WINNER: 'debate_winner',
  /** Phase 完成 */
  PHASE_COMPLETED: 'phase_completed',
  /** Code review 批准 */
  REVIEW_APPROVED: 'review_approved',
  /** 重要决策 */
  DECISION_MADE: 'decision_made',
  /** 对话创建 */
  THREAD_CREATED: 'thread_created',
  /** 对话删除 (I-2: 删除操作审计) */
  THREAD_DELETED: 'thread_deleted',
  /** 任务提取完成 */
  TASKS_EXTRACTED: 'tasks_extracted',
  /** 服务器启动 */
  SERVER_STARTED: 'server_started',
  /** 服务器关闭 */
  SERVER_SHUTDOWN: 'server_shutdown',
  /** 运行时配置被更新 */
  CONFIG_UPDATED: 'config_updated',
  /** 敏感环境变量被写入（owner-only, keys-only audit） */
  ENV_SENSITIVE_WRITE: 'env_sensitive_write',

  // === 消息级审计 (茶话会夺魂 bug fix #37) ===

  /** 猫被调用 (CLI spawn 前) */
  CAT_INVOKED: 'cat_invoked',
  /** 猫响应完成 (done 消息后) */
  CAT_RESPONDED: 'cat_responded',
  /** 调用发生错误 */
  CAT_ERROR: 'cat_error',
  /** 猫猫互调 handoff */
  A2A_HANDOFF: 'a2a_handoff',
  /** CLI 工具执行开始（command_execution started） */
  CLI_TOOL_STARTED: 'cli_tool_started',
  /** CLI 工具执行完成（command_execution completed） */
  CLI_TOOL_COMPLETED: 'cli_tool_completed',

  // === 记忆治理 (Phase 5.0 Step 2a) ===

  /** 记忆提交审核 (draft → pending_review) */
  MEMORY_PUBLISH_SUBMITTED: 'memory_publish_submitted',
  /** 记忆审核通过 (pending_review → published) */
  MEMORY_PUBLISH_APPROVED: 'memory_publish_approved',
  /** 记忆归档 (published → archived) */
  MEMORY_PUBLISH_ARCHIVED: 'memory_publish_archived',
  /** 记忆回滚 (published → draft) */
  MEMORY_PUBLISH_ROLLBACK: 'memory_publish_rollback',

  // === Session Chain (F24 Phase B) ===

  /** 手动绑定 CLI session (#72) */
  SESSION_BIND: 'session_bind',
  /** F211 Phase B: External IDE-direct runtime session registration */
  EXTERNAL_RUNTIME_SESSION_REGISTERED: 'external_runtime_session_registered',

  // === Push Delivery Diagnostics ===

  /** 用户触发测试推送 */
  PUSH_TEST_REQUESTED: 'push_test_requested',
  /** 测试推送结果（成功/失败 + delivery summary） */
  PUSH_TEST_RESULT: 'push_test_result',
  /** 订阅成功写入 */
  PUSH_SUBSCRIPTION_UPSERTED: 'push_subscription_upserted',
  /** 订阅移除 */
  PUSH_SUBSCRIPTION_REMOVED: 'push_subscription_removed',

  // === Browser Preview (F120) ===

  /** 浏览器预览打开 */
  BROWSER_PREVIEW_OPEN: 'browser_preview_open',
  /** 浏览器预览关闭 */
  BROWSER_PREVIEW_CLOSE: 'browser_preview_close',
  /** 浏览器预览导航 */
  BROWSER_PREVIEW_NAVIGATE: 'browser_preview_navigate',
  /** Workspace 面板导航 */
  WORKSPACE_NAVIGATE: 'workspace_navigate',

  // === Session Sealing (F118) ===

  /** requestSeal() accepted — session transitioning active → sealing */
  SEAL_REQUESTED: 'seal_requested',
  /** finalize() completed cleanly — session sealed with transcript + digest written. */
  SEAL_FINALIZED: 'seal_finalized',
  /** finalize() failed or timed out */
  SEAL_FINALIZE_FAILED: 'seal_finalize_failed',
} as const);

export type AuditEventType = (typeof AuditEventTypes)[keyof typeof AuditEventTypes];
