/**
 * @flowforge/forgekin-im-council — T7.16 ConsoleChannel（F047 §2.2 完整实现）。
 *
 * TS 重写自 `core/im_council.py` 的 ConsoleChannel：
 *   - send：记录 pending + 打印审批请求（注入 printer，缺省 console.log）
 *   - wait_reply：等待 operator 输入（注入 readInput，缺省挂起等待超时），
 *     超时返回 null（I4 不变量）；输入解析 approve/reject
 *   - broadcast：单接收者等价 send
 *   - parseDecision：approve/yes/y/同意/批准 → approved；reject/no/n/拒绝/驳回 → rejected；
 *     未识别输入默认 rejected（保守策略，I3 不变量）
 *
 * @module @flowforge/forgekin-im-council
 */

import { IMCouncilChannel } from './channel.js';
import {
  type CouncilMessage,
  type CouncilReply,
  newCouncilReply,
} from './models.js';

/** ConsoleChannel 选项。 */
export interface ConsoleChannelOptions {
  /** 提示符前缀（默认 "[FlowForge]"）。 */
  readonly promptPrefix?: string;
  /** 输出回调（缺省 console.log）。 */
  readonly printer?: (text: string) => void;
  /**
   * operator 输入回调（缺省挂起永不 resolve，等价阻塞等待 stdin）。
   * 测试注入 mock 输入；resolve null 表示无输入。
   */
  readonly readInput?: (message: CouncilMessage) => Promise<string | null>;
}

/**
 * CLI 终端通道 — operator 在终端输入 approve/reject（F047 §2.2）。
 *
 * 传输介质：注入式 stdin/stdout 回调（插件环境不直接持有终端 I/O，
 * 由宿主通过 options 注入；对齐 Python run_in_executor 的异步包装语义）。
 */
export class ConsoleChannel extends IMCouncilChannel {
  override readonly channelName = 'console';
  private readonly promptPrefix: string;
  private readonly printer: (text: string) => void;
  private readonly readInput: (message: CouncilMessage) => Promise<string | null>;
  /** message_id → 待回复状态（跟踪 in-flight 请求）。 */
  private readonly pending = new Map<string, CouncilMessage>();

  constructor(options: ConsoleChannelOptions = {}) {
    super();
    this.promptPrefix = options.promptPrefix ?? '[FlowForge]';
    this.printer = options.printer ?? ((text: string) => console.log(text));
    this.readInput = options.readInput ?? (() => new Promise(() => {}));
  }

  /** 发送消息到终端（打印审批请求），返回 message_id。 */
  async send(message: CouncilMessage): Promise<string> {
    this.pending.set(message.messageId, message);
    this.printer(this.formatMessage(message));
    return message.messageId;
  }

  /** 等待 operator 输入 approve/reject，超时返回 null（I4 不变量）。 */
  async wait_reply(
    messageId: string,
    timeout: number,
  ): Promise<CouncilReply | null> {
    const message = this.pending.get(messageId);
    if (message === undefined) {
      return null;
    }
    const raw = await Promise.race([
      this.readInput(message),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout * 1000)),
    ]);
    if (raw === null) {
      // I4 超时：不清理 pending（保留现场），返回 None 触发超时拒绝
      return null;
    }
    const reply = newCouncilReply({
      messageId,
      replier: 'operator',
      content: raw.trim(),
      replyType: 'decision',
    });
    this.pending.delete(messageId);
    return reply;
  }

  /** 广播给多个接收者 — Console 只有一个接收者（operator），等价 send。 */
  async broadcast(message: CouncilMessage): Promise<string[]> {
    const msgId = await this.send(message);
    return [msgId];
  }

  /** 解析 operator 输入为 "approved" / "rejected"（未识别默认拒绝）。 */
  static parseDecision(raw: string): string {
    const text = raw.trim().toLowerCase();
    if (['approve', 'approved', 'yes', 'y', 'ok', '同意', '批准'].includes(text)) {
      return 'approved';
    }
    if (['reject', 'rejected', 'no', 'n', '拒绝', '驳回'].includes(text)) {
      return 'rejected';
    }
    return 'rejected';
  }

  private formatMessage(message: CouncilMessage): string {
    const p = this.promptPrefix;
    const lines = [
      `\n${p} ═══════════════════════════════════════════`,
      `${p} 议事请求 [${message.messageType}]`,
      `${p} 来自：${message.forgekinId}`,
      `${p} 消息ID：${message.messageId}`,
      `${p} 内容：${message.content}`,
    ];
    if (Object.keys(message.payload).length > 0) {
      lines.push(`${p} 附带数据：`);
      for (const [key, value] of Object.entries(message.payload)) {
        lines.push(`${p}   - ${key}: ${String(value)}`);
      }
    }
    lines.push(
      `${p} ───────────────────────────────────────────`,
      `${p} 请回复 approve / reject（或 yes / no）`,
      `${p} ═══════════════════════════════════════════\n`,
    );
    return lines.join('\n');
  }
}
