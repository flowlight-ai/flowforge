/**
 * @flowforge/cats-preview — F120/F156 preview Cordis 插件（C28）。
 *
 * TS 移植自 clowder-ai `domains/preview`（6 文件）：
 *   - preview-gateway：loopback-only 反向代理（http-proxy 剥离为 PreviewProxyServer 注入）
 *   - port-validator：端口白名单（DEFAULT_EXCLUDED_PORTS + runtime env 合并，纵深防御）
 *   - origin：F156 Origin 校验（loopback 永放行 / RFC 1918 私有网段显式 opt-in）
 *   - port-discovery：stdout 端口发现 + 可达性 probe（fetch 剥离为 probeFn 注入）
 *   - bridge-script / ws-patch-script：HTML 注入脚本（console patch / 截屏 / HMR WS patch）
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsPreview from '@flowforge/cats-preview'
 * ctx.plugin(CatsPreview)
 * // ctx.catsPreview.createGateway({ port: 0, proxy }) / .createPortDiscovery()
 * ```
 *
 * @module @flowforge/cats-preview
 */

import { Context, Service } from '@flowforge/cordis';

import { PreviewGateway } from './preview-gateway.js';
import type { PreviewGatewayOptions, PreviewProxyCreateOptions } from './preview-gateway.js';
import { validatePort, collectRuntimePorts, DEFAULT_EXCLUDED_PORTS } from './port-validator.js';
import type { PortValidationOptions, PortValidationResult } from './types.js';
import { resolveFrontendCorsOrigins, isOriginAllowed, LOOPBACK_ORIGIN, PRIVATE_NETWORK_ORIGIN } from './origin.js';
import type { WarnLoggerLike } from './origin.js';
import { PortDiscoveryService, detectFramework, parsePortFromStdout, probePort } from './port-discovery.js';
import type { FrameworkHint } from './port-discovery.js';
import { BRIDGE_SCRIPT } from './bridge-script.js';
import { buildWsPatchScript } from './ws-patch-script.js';
import type { DiscoveredPort, PreviewProxyServer } from './types.js';

// Re-export 核心实现 + 类型。
export { PreviewGateway };
export type { PreviewGatewayOptions, PreviewProxyCreateOptions };
export { validatePort, collectRuntimePorts, DEFAULT_EXCLUDED_PORTS };
export type { PortValidationOptions, PortValidationResult };
export { resolveFrontendCorsOrigins, isOriginAllowed, LOOPBACK_ORIGIN, PRIVATE_NETWORK_ORIGIN };
export type { WarnLoggerLike };
export { PortDiscoveryService, detectFramework, parsePortFromStdout, probePort };
export type { FrameworkHint };
export { BRIDGE_SCRIPT };
export { buildWsPatchScript };
export type { DiscoveredPort, PreviewProxyServer };

declare module '@flowforge/cordis' {
  interface Context {
    /** preview 域（F120/F156）：gateway / port-discovery / origin / 脚本工厂 */
    catsPreview: PreviewService;
  }
}

/**
 * preview 域服务 — 组装 F120 gateway / port-discovery / origin 校验工厂。
 *
 * 挂载 `ctx.catsPreview`，提供：
 *   - createGateway(opts)：反向代理网关（proxy/createProxy 宿主注入，包零外部依赖）
 *   - createPortDiscovery(opts?)：端口发现服务（probeFn 注入，缺省全局 fetch）
 *   - checkPort / resolveOrigins：端口与 Origin 校验纯函数
 */
export class PreviewService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'catsPreview');
  }

  /** 创建 Preview Gateway（必须注入 proxy 实例或 createProxy 工厂）。 */
  createGateway(options: PreviewGatewayOptions): PreviewGateway {
    return new PreviewGateway(options);
  }

  /** 创建端口发现服务（probeFn 注入，缺省全局 fetch probe）。 */
  createPortDiscovery(options?: { probeFn?: (port: number, host?: string) => Promise<boolean> }): PortDiscoveryService {
    return new PortDiscoveryService(options);
  }

  /** 端口校验（白名单 + range + gateway 自端口递归防护 + runtime env 合并）。 */
  checkPort(rawPort: number | string, opts: PortValidationOptions = {}): PortValidationResult {
    return validatePort(rawPort, opts);
  }

  /** 解析允许的 CORS origins（env 注入，缺省 process.env）。 */
  resolveOrigins(env: NodeJS.ProcessEnv = process.env, logger?: WarnLoggerLike): (string | RegExp)[] {
    return resolveFrontendCorsOrigins(env, logger);
  }
}

export default PreviewService;
