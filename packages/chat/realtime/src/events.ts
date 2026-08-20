/**
 * 事件词汇与消息契约 — @flowforge/chat-realtime（阶段5 批次3，T5.11.3）。
 *
 * `AgentMessage`/`AgentMessageType` 移植自 clowder-ai
 * `domains/cats/services/types.ts`（自包含核心契约：本包不拖入 clowder-ai
 * 全域类型；嵌套结构（metadata/extra/tracing）在本缝保留为不透明 record，
 * 由后续批次按需细化）。
 *
 * 事件词汇（对齐 clowder-ai socket.io 事件语义，统一为四类）：
 * - `thread:message`      ← clowder `agent_message`（thread 房间广播）
 * - `invocation:progress` ← clowder heartbeat/intent_mode/queue_updated/messages_queued 族
 * - `signal:new`          ← clowder emitToUser 通知族（user 房间）
 * - `approval:update`     ← clowder `proposal_updated`/`proposal_created`（user 房间）
 *
 * @module @flowforge/chat-realtime/events
 */

import type { CatId } from '@flowforge/cats-shared'
import {
  EVENT_APPROVAL_UPDATE,
  EVENT_INVOCATION_PROGRESS,
  EVENT_SIGNAL_NEW,
  EVENT_THREAD_MESSAGE,
} from './invariant.ts'

export { EVENT_APPROVAL_UPDATE, EVENT_INVOCATION_PROGRESS, EVENT_SIGNAL_NEW, EVENT_THREAD_MESSAGE }

/** 消息类型全集（clowder-ai AgentMessageType 全量移植）。 */
export type AgentMessageType =
  | 'session_init'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'done'
  | 'a2a_handoff'
  | 'system_info' // budget warnings, cancel feedback, extraction progress, thinking
  | 'provider_signal' // 上游容量/重试信号 — invocation 超时与内容旗标跳过
  | 'liveness_signal' // stream idle watchdog — 同上跳过
  | 'status' // 瞬态 daemon 进度细节 — 更新头像 tooltip，非气泡
  | 'agent_loop' // LLM 调用边界的遥测标记 — 永不用户可见

/**
 * 灵智体（agent）在一次 invocation 中产出的流式消息（clowder-ai 核心字段移植）。
 * 嵌套结构体（metadata/extra/tracing）保留为不透明 record —— 传输层只做
 * spread 透传，不解释其内部。
 */
export interface AgentMessage {
  readonly type: AgentMessageType
  /** 产出该消息的灵智体。 */
  readonly catId: CatId
  /** 文本内容（'text'/'tool_result'/'system_info' 等）。 */
  readonly content?: string
  /** 'a2a_handoff' 的机器可读目标灵智体。 */
  readonly targetCatId?: CatId
  /** 前端文本应用方式：append 保留流式；replace 为整体快照替换。 */
  readonly textMode?: 'append' | 'replace'
  /** 会话 ID（'session_init'）。 */
  readonly sessionId?: string
  /** ACP 传输：sessionId 为 per-invocation（会话被替换不触发 seal）。 */
  readonly ephemeralSession?: boolean
  /** 工具名（'tool_use'/'tool_result'）。 */
  readonly toolName?: string
  /** 工具入参（'tool_use'）。 */
  readonly toolInput?: Readonly<Record<string, unknown>>
  /** 原生 provider 工具调用 id — 配对 tool_use ↔ tool_result。 */
  readonly toolUseId?: string
  /** 工具执行结果结构化状态（'tool_result'）。 */
  readonly toolResultStatus?: 'ok' | 'error' | 'unknown'
  /** 审批门控工具结果的宿主侧失败来源。 */
  readonly toolResultErrorCode?: 'user_rejected' | 'confirmation_unavailable'
  /** 错误信息（'error'）。 */
  readonly error?: string
  /** 错误是可恢复诊断还是终态（缺省 = 终态，向后兼容）。 */
  readonly errorDisposition?: 'transient' | 'terminal'
  /** 多灵智体 invocation 中是否为最后一个 'done'。 */
  readonly isFinal?: boolean
  /** Provider/model 元数据（本缝不透明透传）。 */
  readonly metadata?: Readonly<Record<string, unknown>>
  /** 来源：stream = CLI stdout（thinking）；callback = MCP post_message（speech）。 */
  readonly origin?: 'stream' | 'callback'
  /** 后端 stored-message ID（callback post-message；rich_block 关联）。 */
  readonly messageId?: string
  /** 跨线程来源/协作等扩展（本缝不透明透传）。 */
  readonly extra?: Readonly<Record<string, unknown>>
  /** F121: 回复目标消息 ID。 */
  readonly replyTo?: string
  /** F061: 是否 @ 提及共创者。 */
  readonly mentionsUser?: boolean
  /** F108: invocation ID — 前端区分并发 invocation 的消息归属。 */
  readonly invocationId?: string
  /** F194: per-cat-turn invocation id — 气泡身份稳定键。 */
  readonly turnInvocationId?: string
  /** F070: 可恢复失败的结构化错误码。 */
  readonly errorCode?: string
  /**
   * F183 Phase C — thread-scoped 单调序号。由 ChatRealtimeService 分配；
   * 调用方提供 seq>0 时作为 transport 提示保留（如确定性测试夹具），
   * 生产调用方应留空让 sequencer 分配。
   */
  readonly seq?: number
  /** F183 — sequencer 实例 epoch（服务 boot UUID）；epoch 变化 = 服务重启。 */
  readonly seqEpoch?: string
  readonly timestamp: number
}

/**
 * thread:message 广播载荷 = AgentMessage + 服务端注入的投递元数据
 * （threadId 归属 + seq/seqEpoch gap detection 三元组）。
 */
export interface BroadcastAgentMessage extends AgentMessage {
  /** 广播目标 thread（服务端注入 —— 归属不由 seq 决定）。 */
  readonly threadId: string
  /** 由 ThreadSequencer 分配的单调序号（1 起）。 */
  readonly seq: number
  /** 分配 seq 的 sequencer 实例 epoch。 */
  readonly seqEpoch: string
}

/** invocation:progress 载荷（clowder heartbeat/intent_mode/queue 族统一词汇）。 */
export interface InvocationProgressPayload {
  readonly threadId: string
  readonly kind: 'heartbeat' | 'intent_mode' | 'queue_updated' | 'messages_queued'
  readonly data: Readonly<Record<string, unknown>>
}

/** signal:new 载荷（user 房间定向通知）。 */
export interface SignalNewPayload {
  readonly userId: string
  readonly kind: string
  readonly data: Readonly<Record<string, unknown>>
}

/** approval:update 载荷（提案/审批生命周期，定向提案 owner）。 */
export interface ApprovalUpdatePayload {
  readonly userId: string
  readonly proposal: Readonly<Record<string, unknown>>
}
