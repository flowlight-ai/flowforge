/**
 * acp.ts — ACP（Agent Communication Protocol）配置
 *
 * 定义可进化智能体（Forgekin）在 ACP 协议下的通道参数。
 * ACP 用于 Forgekin 之间的群聊（灵议）与点对点消息传递。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 */

/** ACP 配置 —— Forgekin 在 ACP 总线上的接入参数 */
export interface AcpConfig {
  /** 通道 ID（ACP channel identifier） */
  channel_id: string;
  /** 允许通信的对端 Forgekin ID 列表（白名单） */
  allowed_peers: string[];
  /** 消息格式（json | msgpack | protobuf） */
  message_format: "json" | "msgpack" | "protobuf";
  /** 重试策略 */
  retry_policy: {
    /** 最大重试次数 */
    max_retries: number;
    /** 重试间隔（毫秒） */
    backoff_ms: number;
  };
}

/** 默认 ACP 配置 —— 新建 Forgekin 时的初始值 */
export const DEFAULT_ACP: AcpConfig = {
  channel_id: "default",
  allowed_peers: [],
  message_format: "json",
  retry_policy: {
    max_retries: 3,
    backoff_ms: 500,
  },
};
