/**
 * @flowforge/forgekin-im-council — T7.16 IM 议事通道抽象基类（F047 §2.2）。
 *
 * TS 重写自 `core/im_council.py` 的 IMCouncilChannel：
 * 所有通道适配器必须实现 3 个抽象方法：
 *   - send: 发送消息到通道
 *   - wait_reply: 等待 operator 回复
 *   - broadcast: 广播给多个接收者
 *
 * 子类必须声明 channelName 类属性（如 "console" / "webchat" / "trae"）。
 *
 * @module @flowforge/forgekin-im-council
 */

import type { CouncilMessage, CouncilReply } from './models.js';

/**
 * IM 议事通道抽象基类 — F047 §2.2。
 */
export abstract class IMCouncilChannel {
  /** 通道名（"console" / "webchat" / "trae"）。 */
  abstract readonly channelName: string;

  /** 发送消息到通道，返回 message_id。 */
  abstract send(message: CouncilMessage): Promise<string>;

  /** 等待回复，超时返回 null（对齐 Python Optional[CouncilReply]）。 */
  abstract wait_reply(messageId: string, timeout: number): Promise<CouncilReply | null>;

  /** 广播给多个接收者，返回 message_id 列表。 */
  abstract broadcast(message: CouncilMessage): Promise<string[]>;
}
