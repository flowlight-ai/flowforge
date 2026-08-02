/**
 * protocols.ts — 协议字段配置
 *
 * 定义可进化智能体（Forgekin）支持的通信协议开关。
 * 这些协议决定 Forgekin 通过哪些通道与外部交互。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 */

/** 协议配置 —— 控制 Forgekin 启用的通信协议 */
export interface ProtocolConfig {
  /** ACP（Agent Communication Protocol）启用开关 */
  acp_enabled: boolean;
  /** MCP（Model Context Protocol）启用开关 */
  mcp_enabled: boolean;
  /** SSE（Server-Sent Events）启用开关 */
  sse_enabled: boolean;
  /** WebSocket 启用开关 */
  ws_enabled: boolean;
}

/** 默认协议配置 —— 新建 Forgekin 时的初始值 */
export const DEFAULT_PROTOCOLS: ProtocolConfig = {
  acp_enabled: true,
  mcp_enabled: true,
  sse_enabled: true,
  ws_enabled: false,
};
