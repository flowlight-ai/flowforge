/**
 * install-plan-bridge — InstallPlan 校验与 MCP 安装请求桥接（T5.8.1）。
 *
 * 移植 clowder-ai `marketplace/install-plan-bridge.ts`：
 * - validateInstallPlan：按 mode 校验必需字段（纯函数）
 * - toMcpInstallRequest：direct_mcp 计划 → McpInstallRequest
 *
 * @module @flowforge/chat-misc/marketplace
 */

import type { InstallPlan, McpInstallRequest } from '@flowforge/cats-shared'

export function toMcpInstallRequest(plan: InstallPlan): McpInstallRequest {
  if (plan.mode !== 'direct_mcp') {
    throw new Error(`toMcpInstallRequest only supports direct_mcp plans, got "${plan.mode}"`)
  }
  if (!plan.mcpEntry) {
    throw new Error('direct_mcp plan is missing mcpEntry')
  }
  return { ...plan.mcpEntry }
}

export function validateInstallPlan(plan: InstallPlan): string[] {
  const errors: string[] = []

  switch (plan.mode) {
    case 'direct_mcp':
      if (!plan.mcpEntry) errors.push('direct_mcp plan requires mcpEntry')
      break
    case 'delegated_cli':
      if (!plan.delegatedCommand) errors.push('delegated_cli plan requires delegatedCommand')
      break
    case 'manual_file':
    case 'manual_ui':
      if (!plan.manualSteps?.length) errors.push(`${plan.mode} plan requires manualSteps`)
      break
  }

  return errors
}
