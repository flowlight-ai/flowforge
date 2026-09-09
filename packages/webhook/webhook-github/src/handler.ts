/**
 * @flowforge/webhook-github handler — GitHub HTTP 认证、解析与 fire-and-forget 分发。
 *
 * 移植来源：dsh `webhook-github` 的 `handler.ts`。宿主服务（credentials /
 * webhookRuntime / logger）改为注入端口；签名校验由包内纯函数
 * `verifySignature` 承担（自实现 HMAC-SHA256，等价于 @octokit 协议）。
 */

import { WebhookDeliveryId, WebhookSourceId, type VerifiedWebhookDelivery } from '@flowforge/webhook'
import type { WebRouteHandler, GitHubPorts } from './ports.ts'
import { readBoundedUtf8Body, WebhookHttpError } from './body.ts'
import { verifySignature } from './pure/signature.ts'
import { isJsonContentType, parsePayload, requiredHeader, respond } from './pure/http.ts'

/** 插件加载时一次校验的处理器值。 */
export interface GitHubWebhookHandlerConfig {
  readonly source: string
  readonly secretEnv: string
  readonly maxBodyBytes: number
}

/**
 * 创建一个精确路由的 GitHub handler。
 * @param ports - credentials / dispatcher / logger 注入端口。
 * @param config - 已校验的 source、凭据引用与 body 上限。
 * @returns 一个在内存分发后即应答的 HTTP handler（从不等待规则结算）。
 */
export function createGitHubWebhookHandler(
  ports: GitHubPorts,
  config: GitHubWebhookHandlerConfig,
): WebRouteHandler {
  return async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        throw new WebhookHttpError(405, 'method not allowed')
      }
      if (!isJsonContentType(request.headers['content-type'])) {
        throw new WebhookHttpError(415, 'content type must be application/json')
      }
      const body = await readBoundedUtf8Body(request, config.maxBodyBytes)
      const signature = requiredHeader(request, 'x-hub-signature-256')
      const deliveryId = requiredHeader(request, 'x-github-delivery')
      const eventName = requiredHeader(request, 'x-github-event')
      const credential = await ports.credentials.resolve(config.secretEnv)
      if (credential === undefined || credential.value === '') {
        throw new WebhookHttpError(503, 'GitHub webhook secret is unavailable')
      }
      const secret = credential.value
      if (!verifySignature(secret, body, signature)) {
        throw new WebhookHttpError(401, 'invalid webhook signature')
      }
      const payload = parsePayload(body)
      const delivery: VerifiedWebhookDelivery<'github'> = {
        kind: 'github',
        source: WebhookSourceId(config.source),
        deliveryId: WebhookDeliveryId(deliveryId),
        event: { name: eventName, payload },
        receivedAt: Date.now(),
      }
      try {
        ports.dispatcher.dispatch(delivery)
      } catch {
        ports.logger.warn('webhook-github: dispatch unavailable')
        throw new WebhookHttpError(503, 'webhook runtime is unavailable')
      }
      respond(response, 202)
    } catch (error: unknown) {
      if (error instanceof WebhookHttpError) {
        respond(response, error.status, error.message)
        return
      }
      ports.logger.warn('webhook-github: request failed')
      respond(response, 503, 'webhook ingress is unavailable')
    }
  }
}