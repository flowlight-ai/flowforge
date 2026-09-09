/**
 * @flowforge/webhook-github ports — 注入式 seam 集合。
 *
 * 移植来源：dsh `webhook-github` 依赖的宿主服务（credentials、host-webserver、
 * webhook runtime、logger 与 util-values 的一部分）。原为 cordis 服务；按任务铁律
 * （T9）一律转为包内接口 + 真实内存实现，禁用 vi.mock 被测模块。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { VerifiedWebhookDelivery } from '@flowforge/webhook'

/** 解析出的凭据值。 */
export interface CredentialValue {
  readonly value: string
}

/** 凭据解析 seam。 */
export interface CredentialsPort {
  resolve(ref: string): Promise<CredentialValue | undefined>
}

/** webhook 运行时分发 seam。 */
export interface DispatcherPort {
  dispatch(delivery: VerifiedWebhookDelivery): void
}

/** 极简日志 seam（本包仅记录告警）。 */
export interface LoggerPort {
  warn(message: string): void
}

/** 一个精确路由处理器。 */
export type WebRouteHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

/** 宿主 webserver 的精确路由契型。 */
export interface WebRoute {
  readonly kind: 'exact'
  readonly path: string
  readonly handler: WebRouteHandler
}

/** 宿主 webserver 注册 seam。 */
export interface WebServerPort {
  register(route: WebRoute): void | (() => void)
}

/** 本适配器所需端口聚合。 */
export interface GitHubPorts {
  readonly logger: LoggerPort
  readonly credentials: CredentialsPort
  readonly dispatcher: DispatcherPort
  readonly webServer: WebServerPort
}