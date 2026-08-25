/**
 * @flowforge/forgekin-im-council — T7.16 WebChatChannel（F047 §2.2 Phase 2 骨架）。
 *
 * TS 重写自 `core/im_council.py` 的 WebChatChannel：
 *   - send：Phase 2 骨架降级，返回 message_id 但标记未送达（不抛异常，
 *     避免阻断 I1 降级链路）
 *   - wait_reply：骨架返回 null（触发 I4 超时拒绝）
 *   - broadcast：骨架返回空数组
 *
 * 传输介质：FastAPI WebSocket /ws/im（Phase 2 完整实现填充），
 * 当前为插件环境可注入的 transport 回调预留扩展点。
 *
 * @module @flowforge/forgekin-im-council
 */

import { IMCouncilChannel } from './channel.js';
import type { CouncilMessage, CouncilReply } from './models.js';

/** WebChatChannel 选项。 */
export interface WebChatChannelOptions {
  /** WebSocket 端点 URL（默认 ws://localhost:8000/ws/im）。 */
  readonly websocketUrl?: string;
  /** 日志回调（缺省 console.debug，skeleton 降级记录）。 */
  readonly logger?: (text: string) => void;
}

/**
 * Web 版群通道 — 远程监督/移动端/群聊式 UI（F047 §2.2）。
 *
 * Phase 状态：🔄 骨架（Phase 2 完整实现）。当前 send/wait_reply/broadcast
 * 仅记录降级日志并返回降级结果，**不抛异常**（对齐 Python 骨架语义，
 * 保证 I1 降级链路不被阻断）。
 */
export class WebChatChannel extends IMCouncilChannel {
  override readonly channelName = 'webchat';
  private readonly websocketUrl: string;
  private readonly logger: (text: string) => void;

  constructor(options: WebChatChannelOptions = {}) {
    super();
    this.websocketUrl = options.websocketUrl ?? 'ws://localhost:8000/ws/im';
    this.logger = options.logger ?? ((text: string) => console.debug(text));
  }

  /** 发送消息到 Web UI — Phase 2 实现（当前骨架降级，不抛异常）。 */
  async send(message: CouncilMessage): Promise<string> {
    this.logger(
      `WebChatChannel.send: skeleton not implemented (Phase 2), ` +
        `message_id=${message.messageId} forgekin=${message.forgekinId} ` +
        `websocket_url=${this.websocketUrl}`,
    );
    // 骨架降级：返回 message_id 但标记未送达（不抛异常以保持 I1 降级链路工作）
    return message.messageId;
  }

  /** 等待 Web UI 回复 — Phase 2 实现（当前骨架返回 null 触发 I4 超时拒绝）。 */
  async wait_reply(messageId: string, timeout: number): Promise<CouncilReply | null> {
    this.logger(
      `WebChatChannel.wait_reply: skeleton not implemented (Phase 2), ` +
        `message_id=${messageId} timeout=${timeout}s`,
    );
    return null;
  }

  /** 广播给多个 Web UI 接收者 — Phase 2 实现（当前骨架返回空数组）。 */
  async broadcast(message: CouncilMessage): Promise<string[]> {
    this.logger(
      `WebChatChannel.broadcast: skeleton not implemented (Phase 2), ` +
        `message_id=${message.messageId}`,
    );
    return [];
  }
}
