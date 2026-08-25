/**
 * @flowforge/chat-channels — T7.16 MessageChannelPlugin 接口。
 *
 * TS 重写自 Python `core/interfaces/plugin.py` 的 MessageChannelPlugin：
 * 消息通道插件统一契约（注册/分发/任务状态广播），
 * 供 ChannelManager 以统一方式调度所有通道实现。
 *
 * @module @flowforge/chat-channels
 */

/** 消息通道插件统一契约（对齐 Python MessageChannelPlugin）。 */
export interface MessageChannelPlugin {
  /** 通道名（注册键，唯一）。 */
  readonly name: string;
  /** 通道描述（缺省空串）。 */
  readonly description: string;
  /** 支持的动作列表（缺省 ['pass', 'reject']）。 */
  readonly supportedActions: string[];

  /** 处理一条入站消息，返回处理结果。 */
  onMessage(rawMessage: Record<string, unknown>): Promise<Record<string, unknown>>;

  /** 发送消息给指定接收者，返回是否成功。 */
  sendMessage(recipient: string, content: string): Promise<boolean>;

  /** 任务状态变更推送（默认返回 true）。 */
  onTaskStatusChange(
    taskId: string,
    status: string,
    meta: Record<string, unknown>,
  ): Promise<boolean>;

  /** 健康检查，返回是否可用。 */
  healthCheck(): Promise<boolean>;
}

/** 通道插件基类 — 提供默认实现，子类按需覆盖（对齐 Python 基类语义）。 */
export abstract class BaseMessageChannelPlugin implements MessageChannelPlugin {
  readonly name: string = 'base';
  readonly description: string = '';
  readonly supportedActions: string[] = ['pass', 'reject'];

  abstract onMessage(rawMessage: Record<string, unknown>): Promise<Record<string, unknown>>;
  abstract sendMessage(recipient: string, content: string): Promise<boolean>;
  abstract healthCheck(): Promise<boolean>;

  async onTaskStatusChange(
    _taskId: string,
    _status: string,
    _meta: Record<string, unknown>,
  ): Promise<boolean> {
    return true;
  }
}
