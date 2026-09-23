/**
 * TTS 合成服务配置探测（S2 stretch：外部 TTS/RSS 凭据配置面）。
 *
 * 现状（docs/refactor/36-stage-stretch-remaining.md §4）：TTS 合成引擎与 RSS 聚合
 * 均依赖外部服务/凭据，本轮"待凭据、保持端口 + mock + 显式地址门控"。本模块只
 * 落地**配置探测面**——对齐已批准 S1 飞书通道先例（`feishu-config.ts` 的
 * `resolveFeishuChannelConfig` / `isFeishuConfigured` / `feishuConfigGap`）与
 * `audio-proxy.ts` 的 `audioServiceUrl` 显式地址门控语义：凭据齐备才按真实服务启用，
 * 否则由装配层回退 mock，不硬编码服务地址或密钥。
 *
 * 🔑 权威环境键（唯一名，避免拼写漂移）：
 *   - `TTS_SERVICE_URL`（门控）：TTS 合成服务端点；仅当其有值才启用真实合成
 *   - `TTS_API_KEY`（可选）：调用服务所需的鉴权密钥
 *   - `TTS_VOICE`（可选，缺省 TTS_DEFAULT_VOICE）：默认音色标识
 *
 * 纯函数，无副作用。真实密钥需 operator 在启用前注入环境。
 *
 * @module @flowforge/chat-stretch/tts-config
 */

/** 缺省音色标识（非服务地址，健康降级描述使用）。 */
export const TTS_DEFAULT_VOICE = 'default'

/** TTS 配置探测所需的环境键（权威名）。 */
export const TTS_CONFIG_ENV_KEYS = ['TTS_SERVICE_URL', 'TTS_API_KEY', 'TTS_VOICE'] as const

/** TTS 合成服务凭据配置（端点门控，域名侧不硬编码地址）。 */
export interface TtsConfig {
  /** 合成服务端点（env: TTS_SERVICE_URL）；有值才启用真实合成。 */
  serviceUrl?: string | undefined
  /** 调用鉴权密钥（env: TTS_API_KEY，可选）。 */
  apiKey?: string | undefined
  /** 默认音色（env: TTS_VOICE，缺省 TTS_DEFAULT_VOICE）。 */
  voice?: string | undefined
}

/** 环境探测输入的薄弱类型（允许直接传 process.env 或测试用 Record）。 */
export type TtsEnv = { readonly [key: string]: string | undefined }

/** 从环境探测 TTS 配置（缺省 process.env）。 */
export function resolveTtsConfig(env: TtsEnv = process.env): TtsConfig {
  return {
    serviceUrl: env.TTS_SERVICE_URL,
    apiKey: env.TTS_API_KEY,
    voice: env.TTS_VOICE || TTS_DEFAULT_VOICE,
  }
}

/** 是否已配置（端点到场）→ 决定真实 TTS 合成按凭据启用。 */
export function isTtsConfigured(config: TtsConfig): boolean {
  return hasText(config.serviceUrl)
}

/** 未配置时的健康降级描述（辅助诊断缺哪个键）。 */
export function ttsConfigGap(config: TtsConfig): string {
  const missing: string[] = []
  if (!hasText(config.serviceUrl)) missing.push('TTS_SERVICE_URL')
  return missing.length > 0 ? `tts not configured (missing ${missing.join(', ')})` : ''
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}