/**
 * @flowforge/forgekin-e2e — stage-7 forgekin 跨包集成测试（T7.13/T7.29）。
 *
 * 集成面：species（YAML 档案注册）× loops（五闭环演进）× council（跨厂商审议）
 * × workflow-compiler（YAML→DAG）× knowledge（SpiritForge 蒸馏→MindCodex 检索）。
 * LLM 双模式：OpenRoute 真实网关（env 可达时）或循环内置降级路径（T1 边界见 spec 头注）。
 *
 * @module @flowforge/forgekin-e2e
 */

import { OpenRouteLlmClient } from '@flowforge/llm-openroute'

/** LlmChatClient 最小面（loops 契约） */
export interface E2ELlmChatClient {
  chat(messages: ReadonlyArray<{ role: string; content: string }>): Promise<{ content: string; model?: string }>
}

export type E2ELlmMode = 'openroute-real' | 'unavailable'

/**
 * LLM 双模式解析（批次53，T7.13/T1 铁律）：
 * - env 配置了 OpenRoute 网关 → 真实客户端（真实调用）
 * - 未配置 → unavailable（依赖 LLM 的用例自跳过；循环自身降级路径属生产代码路径，非 mock）
 */
export function resolveE2ELlmClient(env = process.env): { mode: E2ELlmMode; client?: E2ELlmChatClient } {
  const baseUrl =
    env['FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL'] ?? env['OPENROUTE_BASE_URL']
  if (!baseUrl) return { mode: 'unavailable' }
  const client = new OpenRouteLlmClient({ env })
  return {
    mode: 'openroute-real',
    client: {
      async chat(messages) {
        const result = await client.chat({ messages: messages.map((m) => ({ role: m.role, content: m.content })) })
        return { content: result.content, model: result.model }
      },
    },
  }
}
