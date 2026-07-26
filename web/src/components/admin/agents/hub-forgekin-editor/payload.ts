/**
 * payload.ts — Forgekin 提交 payload 构造与校验
 *
 * 提供完整创建 payload 的构造函数与表单校验函数。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 */

import type { ForgekinFormData } from "./model";
import { DEFAULT_PROTOCOLS } from "./protocols";
import { DEFAULT_ACP } from "./acp";

/**
 * buildForgekinPayload —— 构建完整的 Forgekin 创建 payload。
 *
 * 与 buildPatchPayload 的区别：本函数用于 POST 创建新 Forgekin，
 * 包含协议配置与 ACP 配置等完整字段。
 */
export function buildForgekinPayload(form: ForgekinFormData): object {
  return {
    id: form.id,
    name: form.name,
    nickname: form.nickname,
    species: form.species,
    role: {
      primary: form.role,
      description: form.system_prompt || undefined,
    },
    system_prompt: form.system_prompt,
    model: form.model,
    tools: form.tools,
    runtime: {
      temperature: form.temperature,
      top_p: form.topP,
      max_tokens: form.maxTokens,
    },
    theme_color: form.themeColor,
    voice: {
      voice: form.voiceConfig.voice,
      rate: form.voiceConfig.rate,
      pitch: form.voiceConfig.pitch,
    },
    routing: form.routing,
    protocols: { ...DEFAULT_PROTOCOLS },
    acp: {
      channel_id: DEFAULT_ACP.channel_id,
      allowed_peers: [...DEFAULT_ACP.allowed_peers],
      message_format: DEFAULT_ACP.message_format,
      retry_policy: { ...DEFAULT_ACP.retry_policy },
    },
  };
}

/**
 * validatePayload —— 校验表单数据，返回错误信息列表。
 *
 * 返回空数组表示校验通过；否则数组中每一项为一条错误描述。
 */
export function validatePayload(form: ForgekinFormData): string[] {
  const errors: string[] = [];

  // id 校验：非空且仅允许小写字母/数字/下划线/连字符
  if (!form.id || !form.id.trim()) {
    errors.push("ID 不能为空");
  } else if (!/^[a-z0-9_-]+$/.test(form.id)) {
    errors.push("ID 仅允许小写字母、数字、下划线与连字符");
  }

  // 名称校验
  if (!form.name || !form.name.trim()) {
    errors.push("名称不能为空");
  } else if (form.name.length > 32) {
    errors.push("名称长度不能超过 32 个字符");
  }

  // 昵称校验
  if (!form.nickname || !form.nickname.trim()) {
    errors.push("昵称不能为空");
  }

  // 系统提示词校验：允许为空，但若填写则不超过 4000 字符
  if (form.system_prompt && form.system_prompt.length > 4000) {
    errors.push("系统提示词长度不能超过 4000 个字符");
  }

  // 温度校验
  if (form.temperature < 0 || form.temperature > 2) {
    errors.push("温度必须在 0 到 2 之间");
  }

  // top_p 校验
  if (form.topP < 0 || form.topP > 1) {
    errors.push("top_p 必须在 0 到 1 之间");
  }

  // max_tokens 校验
  if (!Number.isFinite(form.maxTokens) || form.maxTokens < 1 || form.maxTokens > 32768) {
    errors.push("最大 token 数必须在 1 到 32768 之间");
  }

  // 主题色校验：十六进制颜色
  if (!/^#[0-9A-Fa-f]{6}$/.test(form.themeColor)) {
    errors.push("主题色必须为合法的十六进制颜色（如 #D4A017）");
  }

  // 语速校验
  if (form.voiceConfig.rate < 0.5 || form.voiceConfig.rate > 2.0) {
    errors.push("语速必须在 0.5 到 2.0 之间");
  }

  // 音调校验
  if (form.voiceConfig.pitch < -10 || form.voiceConfig.pitch > 10) {
    errors.push("音调必须在 -10 到 10 之间");
  }

  return errors;
}
