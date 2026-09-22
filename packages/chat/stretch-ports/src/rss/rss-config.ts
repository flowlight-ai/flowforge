/**
 * RSS 聚合服务配置探测（S2 stretch：外部 TTS/RSS 凭据配置面）。
 *
 * 现状（docs/refactor/36-stage-stretch-remaining.md §4）：RSS 聚合依赖外部服务/
 * 凭据，本轮"待凭据、保持端口 + mock + 显式地址门控"。本模块落地**配置探测面**——对齐
 * 已批准 S1 飞书通道先例（`feishu-config.ts`）与 `audio-proxy.ts` 的 `audioServiceUrl`
 * 显式地址门控语义：端点到场才按真实聚合启用，否则由装配层回退 mock。
 *
 * 🔑 权威环境键（唯一名，避免拼写漂移）：
 *   - `RSS_SERVICE_URL`（门控）：RSS 聚合服务端点；仅当其有值才启用真实聚合
 *   - `RSS_API_KEY`（可选）：调用聚合服务所需的鉴权密钥
 *
 * 纯函数，无副作用。真实密钥需 operator 在启用前注入环境。
 *
 * @module @flowforge/chat-stretch/rss-config
 */

/** RSS 聚合服务配置探测所需的环境键（权威名）。 */
export const RSS_CONFIG_ENV_KEYS = ['RSS_SERVICE_URL', 'RSS_API_KEY'] as const

/** RSS 聚合服务凭据配置（端点门控，域名侧不硬编码地址）。 */
export interface RssConfig {
  /** 聚合服务端点（env: RSS_SERVICE_URL）；有值才启用真实聚合。 */
  serviceUrl?: string | undefined
  /** 调用鉴权密钥（env: RSS_API_KEY，可选）。 */
  apiKey?: string | undefined
}

/** 环境探测输入的薄弱类型（允许直接传 process.env 或测试用 Record）。 */
export type RssEnv = { readonly [key: string]: string | undefined }

/** 从环境探测 RSS 配置（缺省 process.env）。 */
export function resolveRssConfig(env: RssEnv = process.env): RssConfig {
  return {
    serviceUrl: env.RSS_SERVICE_URL,
    apiKey: env.RSS_API_KEY,
  }
}

/** 是否已配置（端点到场）→ 决定真实 RSS 聚合按凭据启用。 */
export function isRssConfigured(config: RssConfig): boolean {
  return hasText(config.serviceUrl)
}

/** 未配置时的健康降级描述（辅助诊断缺哪个键）。 */
export function rssConfigGap(config: RssConfig): string {
  const missing: string[] = []
  if (!hasText(config.serviceUrl)) missing.push('RSS_SERVICE_URL')
  return missing.length > 0 ? `rss not configured (missing ${missing.join(', ')})` : ''
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}