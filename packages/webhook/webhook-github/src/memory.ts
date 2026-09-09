/**
 * @flowforge/webhook-github memory — 注入端口的真实内存实现 + 契约测试底座。
 *
 * 按任务铁律（T9）：credentials / dispatcher / logger / webServer 均提供真实内存
 * 实现，供契约测试直接装配并断言足迹，禁用 vi.mock。
 */

import type {
  CredentialValue,
  CredentialsPort,
  DispatcherPort,
  GitHubPorts,
  LoggerPort,
  WebRoute,
  WebServerPort,
} from './ports.ts'
import type { VerifiedWebhookDelivery } from '@flowforge/webhook'

/** 内存日志端口（仅记录告警）。 */
export class InMemoryLogger implements LoggerPort {
  readonly warnings: string[] = []

  warn(message: string): void {
    this.warnings.push(message)
  }
}

/** 内存凭据端口：ref → 值 或缺失。 */
export class InMemoryCredentials implements CredentialsPort {
  readonly secrets = new Map<string, string>()

  setSecret(ref: string, value: string): void {
    this.secrets.set(ref, value)
  }

  resolve(ref: string): Promise<CredentialValue | undefined> {
    const value = this.secrets.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value })
  }
}

/** 内存分发端口：记录投递；可注入不可用。 */
export class InMemoryDispatcher implements DispatcherPort {
  readonly deliveries: VerifiedWebhookDelivery[] = []
  unavailable = false

  dispatch(delivery: VerifiedWebhookDelivery): void {
    if (this.unavailable) throw new Error('webhook runtime is unavailable')
    this.deliveries.push(delivery)
  }
}

/** 内存 webserver 端口：记录到访路由并返回清理器。 */
export class InMemoryWebServer implements WebServerPort {
  readonly routes: WebRoute[] = []
  readonly releasedRoutes: string[] = []

  register(route: WebRoute): () => void {
    if (this.routes.some(existing => existing.path === route.path)) {
      throw new Error(`route "${route.path}" is already registered`)
    }
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
      this.releasedRoutes.push(route.path)
    }
  }
}

/** 由内存端口拼接的 GitHub 适配器端口聚合。 */
export interface GitHubFixture {
  readonly ports: GitHubPorts
  readonly logger: InMemoryLogger
  readonly credentials: InMemoryCredentials
  readonly dispatcher: InMemoryDispatcher
  readonly webServer: InMemoryWebServer
}

/**
 * 构造一个真实装配的内存 GitHub 适配器底座。
 * @returns 端口聚合与各内存实现句柄（供断言足迹）。
 */
export function createGitHubFixture(): GitHubFixture {
  const logger = new InMemoryLogger()
  const credentials = new InMemoryCredentials()
  const dispatcher = new InMemoryDispatcher()
  const webServer = new InMemoryWebServer()
  const ports: GitHubPorts = { logger, credentials, dispatcher, webServer }
  return { ports, logger, credentials, dispatcher, webServer }
}