/**
 * @flowforge/cats-preview — preview 域共享类型（F120/F156）。
 *
 * TS 移植自 clowder-ai `domains/preview/types.ts`，另含注入端口
 * `PreviewProxyServer`（http-proxy 剥离为宿主注入，包零外部依赖）。
 *
 * @module @flowforge/cats-preview/types
 */

/** Preview Gateway 配置 */
export interface PreviewGatewayConfig {
  /** Gateway 监听端口（独立 origin） */
  port: number;
  /** 允许的目标端口范围 */
  allowedPortRange: [number, number];
  /** 排除的端口列表（Clowder AI 自身服务） */
  excludedPorts: number[];
}

/** 端口发现结果 */
export interface DiscoveredPort {
  port: number;
  source: 'stdout' | 'lsof';
  framework?: string;
  paneId?: string;
  worktreeId: string;
  reachable: boolean;
  discoveredAt: number;
}

/** 端口校验结果 */
export interface PortValidationResult {
  allowed: boolean;
  reason?: string;
}

/** 端口校验选项 */
export interface PortValidationOptions {
  host?: string;
  excludedPorts?: number[];
  gatewaySelfPort?: number;
  /** Runtime-configured ports to exclude (read from env at startup) */
  runtimePorts?: number[];
}

/**
 * http-proxy 最小端口（宿主注入；socket.io 风格 web/ws/on/close）。
 * 宿主可注入 `http-proxy` 的 createProxyServer 实例，或等价实现。
 */
export interface PreviewProxyServer {
  on(event: string, listener: (...args: unknown[]) => void): void;
  web(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    opts: { target: string },
    callback?: (err: Error) => void,
  ): void;
  ws(
    req: import('node:http').IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
    opts: { target: string },
  ): void;
  close(): void;
}
