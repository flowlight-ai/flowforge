/**
 * @flowforge/forgekin-im-council — T7.16 IM 议事通道数据模型（F047 §2.4）。
 *
 * TS 重写自 `core/im_council.py` 的 CouncilMessage / CouncilReply：
 *   - CouncilMessage：议事消息（Step 1/2 载荷）
 *   - CouncilReply：议事回复（Step 3 载荷）
 *
 * 字段命名对齐 TS 版 ApprovalHub（camelCase）。
 *
 * @module @flowforge/forgekin-im-council
 */

/** 生成带前缀的 UUID（对齐 Python `_new_id`）。 */
export function newId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${prefix}_${hex}`;
}

/** 议事消息（对齐 Python CouncilMessage）。 */
export interface CouncilMessage {
  messageId: string;
  /** "console" | "webchat" | "trae" */
  channel: string;
  /** 发起 Forgekin ID */
  forgekinId: string;
  /** 消息内容 */
  content: string;
  /** "approval_request" | "info" | "alert" | "council" */
  messageType: string;
  /** 附加数据（PR url / config diff） */
  payload: Record<string, unknown>;
  /** 创建时间（UTC ISO） */
  createdAt: string;
}

/** 议事回复（对齐 Python CouncilReply）。 */
export interface CouncilReply {
  replyId: string;
  /** 对应的 message_id */
  messageId: string;
  /** "operator" 或 forgekin_id */
  replier: string;
  /** "approve" / "reject" / 自然语言回复 */
  content: string;
  /** "decision" | "comment" | "question" */
  replyType: string;
  /** 决策时间（UTC ISO） */
  decidedAt: string;
}

/** 构造议事消息。 */
export function newCouncilMessage(init: {
  messageId?: string;
  channel: string;
  forgekinId: string;
  content: string;
  messageType?: string;
  payload?: Record<string, unknown>;
  createdAt?: string | Date;
}): CouncilMessage {
  return {
    messageId: init.messageId ?? newId('council_msg'),
    channel: init.channel,
    forgekinId: init.forgekinId,
    content: init.content,
    messageType: init.messageType ?? 'info',
    payload: { ...(init.payload ?? {}) },
    createdAt:
      init.createdAt instanceof Date
        ? init.createdAt.toISOString()
        : (init.createdAt ?? new Date().toISOString()),
  };
}

/** 构造议事回复。 */
export function newCouncilReply(init: {
  replyId?: string;
  messageId: string;
  replier: string;
  content: string;
  replyType?: string;
  decidedAt?: string | Date;
}): CouncilReply {
  return {
    replyId: init.replyId ?? newId('reply'),
    messageId: init.messageId,
    replier: init.replier,
    content: init.content,
    replyType: init.replyType ?? 'decision',
    decidedAt:
      init.decidedAt instanceof Date
        ? init.decidedAt.toISOString()
        : (init.decidedAt ?? new Date().toISOString()),
  };
}
