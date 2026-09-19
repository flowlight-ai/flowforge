/**
 * 飞书通道配置探测（S1 stretch）。
 *
 * 对齐 `config/im_channels.yaml` `feishu_group` 槽位的鉴权字段语义
 * （`auth.app_id_env` / `auth.app_secret_env` / `auth.chat_id_env`，
 * 分别映射环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_CHAT_ID`）。
 * 纯函数，无副作用；`isFeishuConfigured` 决定真实通道是否按凭据启用。
 *
 * S1 决策（docs/refactor/35-stage-stretch-batch.md §4-2）：飞书作为首个真实
 * 通道；缺真实凭据时由装配层回退 mock + 健康检查降级，不破坏既有 mock 装配。
 *
 * @module @flowforge/chat-stretch/feishu-config
 */

/** 飞书 OpenAPI 默认基址（与 config/im_channels.yaml `base_url` 一致）。 */
export const FEISHU_DEFAULT_BASE_URL = 'https://open.feishu.cn/open-apis'

/** 可选的 receive_id 类型（对齐飞书 im/v1/messages 的 receive_id_type）。 */
export const FEISHU_RECEIVE_ID_TYPES = ['chat_id', 'open_id', 'user_id'] as const
export type FeishuReceiveIdType = (typeof FEISHU_RECEIVE_ID_TYPES)[number]

/** 飞书通道凭据配置（均取自身份提供方，域名侧不硬编码）。 */
export interface FeishuChannelConfig {
  /** 应用 App ID（env: FEISHU_APP_ID）。 */
  appId?: string | undefined
  /** 应用 App Secret（env: FEISHU_APP_SECRET）。 */
  appSecret?: string | undefined
  /** 目标会话 id（env: FEISHU_CHAT_ID，发送目标）。 */
  chatId?: string | undefined
  /** 飞书 OpenAPI 基址（缺省 FEISHU_DEFAULT_BASE_URL）。 */
  baseUrl?: string | undefined
  /** receive_id 语义（缺省 `chat_id`）。 */
  receiveIdType?: FeishuReceiveIdType | undefined
}

/** 环境探测输入的薄弱类型（允许直接传 process.env 或测试用 Record）。 */
export type FeishuEnv = { readonly [key: string]: string | undefined }

/** 配置探测所需的三个环境键（唯一权威名，避免拼写漂移）。 */
export const FEISHU_CONFIG_ENV_KEYS = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_CHAT_ID'] as const

/** 从环境探测飞书通道配置（缺省 process.env）。 */
export function resolveFeishuChannelConfig(env: FeishuEnv = process.env): FeishuChannelConfig {
  return {
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    chatId: env.FEISHU_CHAT_ID,
    baseUrl: FEISHU_DEFAULT_BASE_URL,
    receiveIdType: 'chat_id',
  }
}

/** 凭据是否齐备（三键均有值）→ 决定真实通道按凭据启用。 */
export function isFeishuConfigured(config: FeishuChannelConfig): boolean {
  return hasText(config.appId) && hasText(config.appSecret) && hasText(config.chatId)
}

/** 未配置时的健康降级描述（辅助诊断缺哪个键）。 */
export function feishuConfigGap(config: FeishuChannelConfig): string {
  const missing: string[] = []
  if (!hasText(config.appId)) missing.push('FEISHU_APP_ID')
  if (!hasText(config.appSecret)) missing.push('FEISHU_APP_SECRET')
  if (!hasText(config.chatId)) missing.push('FEISHU_CHAT_ID')
  return missing.length > 0 ? `feishu not configured (missing ${missing.join(', ')})` : ''
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}