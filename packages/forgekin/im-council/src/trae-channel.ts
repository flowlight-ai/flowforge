/**
 * @flowforge/forgekin-im-council — T7.16 TraeBridgeChannel（F047 §2.2 完整实现）。
 *
 * TS 重写自 `core/im_council.py` 的 TraeBridgeChannel：
 *   - send：通过 TraeBridgeProtocol.writeRequest 写入 request 文件
 *     （复用 @flowforge/forgekin-trae-bridge 的 F045 文件协议）
 *   - wait_reply：通过 TraeBridgeProtocol.pollResponse 轮询响应文件，
 *     超时/取消/协议异常均返回 null（触发 I4 超时拒绝，不向上抛）
 *   - broadcast：单 bridge_dir 等价 send
 *
 * 依赖注入（红线 12）：protocol 实例通过 options 注入；缺省时按
 * bridgeDir 构造（复用 makeTraeBridgeConfig，${ENV_VAR} 占位符已由
 * 配置层展开，红线 11）。
 *
 * @module @flowforge/forgekin-im-council
 */

import { IMCouncilChannel } from './channel.js';
import { newCouncilReply, type CouncilMessage, type CouncilReply } from './models.js';
import { makeTraeBridgeConfig } from '@flowforge/forgekin-trae-bridge/config';
import { makeBridgeRequestContext } from '@flowforge/forgekin-trae-bridge/models';
import { TraeBridgeProtocol } from '@flowforge/forgekin-trae-bridge/protocol';

/** TraeBridgeChannel 选项。 */
export interface TraeBridgeChannelOptions {
  /** F045 共享目录路径（支持 ${ENV_VAR:default} 占位符；缺省 FLOWFORGE_BRIDGE_DIR）。 */
  readonly bridgeDir?: string;
  /** 协议实例（DI 注入；缺省按 bridgeDir 新建）。 */
  readonly protocol?: TraeBridgeProtocol | undefined;
}

/**
 * Trae IDE 桥接通道 — 通过 F045 文件协议推送到 Trae IDE（F047 §2.2）。
 *
 * 复用 TraeBridgeProtocol 的 request_{uuid}.json / response_{uuid}.json
 * 命名约定，operator 在 Trae CN 内接收审批请求并回写决策。
 */
export class TraeBridgeChannel extends IMCouncilChannel {
  override readonly channelName = 'trae';
  private readonly protocol: TraeBridgeProtocol;

  constructor(options: TraeBridgeChannelOptions = {}) {
    super();
    this.protocol =
      options.protocol ??
      new TraeBridgeProtocol(
        makeTraeBridgeConfig(
          options.bridgeDir !== undefined ? { shared_dir: options.bridgeDir } : {},
        ),
      );
  }

  /** 发送消息到 Trae IDE — 写入 F045 request 文件，返回 request_id。 */
  async send(message: CouncilMessage): Promise<string> {
    const context = makeBridgeRequestContext({
      forgekin_id: message.forgekinId,
      task_type: 'council_approval',
      task_summary: message.content.slice(0, 200),
      model: 'trae',
    });
    const messages = [
      {
        role: 'user',
        content:
          `[IM Council 议事请求]\n` +
          `消息ID: ${message.messageId}\n` +
          `发起者: ${message.forgekinId}\n` +
          `类型: ${message.messageType}\n` +
          `内容: ${message.content}\n` +
          (Object.keys(message.payload).length > 0
            ? `附加数据: ${JSON.stringify(message.payload)}`
            : ''),
      },
    ];
    // 使用 message_id 作为 request_id 便于与 wait_reply 配对
    const requestId = await this.protocol.writeRequest(messages, context, {
      requestId: message.messageId,
      timeoutSeconds: 300,
    });
    return requestId;
  }

  /** 等待 Trae IDE 回复 — 轮询 response 文件；超时/异常返回 null（I4）。 */
  async wait_reply(messageId: string, timeout: number): Promise<CouncilReply | null> {
    try {
      const response = await this.protocol.pollResponse(messageId, { timeout });
      const raw = (response.content ?? '').trim();
      // 对齐 Python：approve/reject → decision；含问号 → question；其余 → comment
      const lower = raw.toLowerCase();
      if (['approve', 'approved', '同意', '批准'].includes(lower)) {
        return newCouncilReply({
          messageId,
          replier: 'operator',
          content: 'approve',
          replyType: 'decision',
        });
      }
      if (['reject', 'rejected', '拒绝', '否决'].includes(lower)) {
        return newCouncilReply({
          messageId,
          replier: 'operator',
          content: 'reject',
          replyType: 'decision',
        });
      }
      return newCouncilReply({
        messageId,
        replier: 'operator',
        content: raw,
        // 半角/全角问号均视为提问（Python 检查 "?"，扩展支持中文语境全角 "？"）
        replyType: raw.includes('?') || raw.includes('？') ? 'question' : 'comment',
      });
    } catch {
      // 超时（TraeBridgeTimeoutError）/ 取消 / 协议异常 → null 触发 I4 超时拒绝
      return null;
    }
  }

  /** 广播给多个 Trae IDE 接收者 — 当前单目录写入，等价 send。 */
  async broadcast(message: CouncilMessage): Promise<string[]> {
    const sentId = await this.send(message);
    return [sentId];
  }
}
