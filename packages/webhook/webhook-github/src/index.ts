/**
 * @flowforge/webhook-github — 签名 GitHub HTTP webhook 适配器装配（EP1-9 / A29）。
 *
 * 移植来源：dsh `webhook-github`。职责：校验 GitHub 签名、解析 body、按事件类型
 * 分发到 webhook 规则运行时。宿主服务（credentials / host-webserver / webhook
 * runtime）改为注入端口（`GitHubPorts`）+ 真实内存实现；签名校验为包内自实现
 * HMAC-SHA256（本环境无 @octokit/webhooks，取舍见 `pure/signature.ts`）。
 */

import type { GitHubPorts, WebRoute } from './ports.ts'
import { createGitHubWebhookHandler } from './handler.ts'

export type * from './types.ts'
export * from './ports.ts'
export * from './memory.ts'
export { WebhookHttpError, readBoundedUtf8Body } from './body.ts'
export { computeHmacSha256Hex, verifySignature, HMAC_SIGNATURE_PREFIX } from './pure/signature.ts'
export { createGitHubWebhookHandler } from './handler.ts'

/** 插件名（源保留）。 */
export const name = 'webhook-github'

/** 必需 GitHub 入口配置。 */
export interface Config {
  /** 携带到规则中的适配器实例名。 */
  readonly source: string
  /** 精确绝对路由路径。 */
  readonly path: string
  /** 包含共享 webhook 密钥的凭据引用。 */
  readonly secretEnv: string
  /** 原始 body 正整字节上限。 */
  readonly maxBodyBytes: number
}

/**
 * 校验 Config 中无法以 schema 表达的字段事实。
 * @param config - 待校验配置。
 * @throws 任一字段不符时抛出。
 */
export function validateConfig(config: Config): void {
  if (config.source.trim() !== config.source || config.source === '') {
    throw new Error('webhook-github source must be a non-empty trimmed string')
  }
  if (config.path.startsWith('/') !== true || config.path === '/' || config.path.endsWith('/')
    || config.path.includes('?') || config.path.includes('#')) {
    throw new Error('webhook-github path must be an absolute non-root pathname without a trailing slash, query, or fragment')
  }
  if (!Number.isSafeInteger(config.maxBodyBytes) || config.maxBodyBytes < 1) {
    throw new Error('webhook-github maxBodyBytes must be a positive safe integer')
  }
}

/**
 * 在注入的 webserver 上注册一个签名 GitHub 端点。
 * @param ports - credentials / dispatcher / logger / webServer 端口。
 * @param config - 校验后的配置。
 * @returns 路由注册清理器（webserver 端口返回时）。
 */
export function apply(ports: GitHubPorts, config: Config): void | (() => void) {
  validateConfig(config)
  const route: WebRoute = {
    kind: 'exact' as const,
    path: config.path,
    handler: createGitHubWebhookHandler(ports, {
      source: config.source,
      secretEnv: config.secretEnv,
      maxBodyBytes: config.maxBodyBytes,
    }),
  }
  return ports.webServer.register(route)
}