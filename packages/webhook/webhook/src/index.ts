/**
 * @flowforge/webhook — fire-and-forget webhook 规则运行时装配（EP1-9 / A29）。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-webhook`。职责：接收已认证 webhook 投递，经规则
 * 匹配后创建一个 Workspace-backed Session 并在后台跑 agent。全部原 cordis 宿主
 * 服务改为包内注入式端口（`WebhookRuntimePorts`）+ 真实内存实现（`memory.ts`）；
 * 不引用任何 `@deepseek-ai/*` / `@cat-cafe/*` / `@clowder-ai/*`。
 */

export * from './brand.ts'
export * from './ports.ts'
export * from './values.ts'
export * from './memory.ts'
export * from './contract/command.ts'
export { errorChain, createUserMessage, boundContextSummary } from './llm.ts'
export type { UserMessage, WebhookMessageSource } from './llm.ts'
export type * from './types.ts'
export { WebhookRuntime } from './pure/dispatch.ts'
export { createWebhookSession } from './pure/request.ts'
export {
  evaluateWebhookInboxPlacement,
  installWebhookInvariant,
  extractWebhookInboxCount,
  INVARIANT_PACKAGE_NAME,
} from './pure/invariant.ts'
export type { WorkspaceOwnerFact, SplicedInboxEvent, InvariantSessionView } from './pure/invariant.ts'
export type {
  AgentHandle,
  AgentInstance,
  AgentSetupTarget,
  AgentsPort,
  AgentDefaultModelPort,
  AgentPresetsPort,
  AgentPresetInfo,
  AgentCallConfig,
  AgentCreateOptions,
  ModelSelection,
  PermissionPresetsPort,
  SessionTitlePort,
  SessionInstance,
  WorkspaceInstance,
  WorkspaceRegistryPort,
  InvariantRegistryPort,
  InvariantInstaller,
  InvariantFailure,
  LoggerPort,
  WebhookRuntimePorts,
  SessionId,
} from './ports.ts'

import type { WebhookRuntimePorts } from './ports.ts'
import { WebhookRuntime } from './pure/dispatch.ts'

/**
 * 便捷工厂：以注入端口创建一个已装配的规则运行时。
 * @param ports - 运行时依赖端口聚合。
 * @returns 可注册/分发的 WebhookRuntime。
 */
export function createWebhookRuntime(ports: WebhookRuntimePorts): WebhookRuntime {
  return new WebhookRuntime(ports)
}

export default WebhookRuntime