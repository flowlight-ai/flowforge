/**
 * @flowforge/webhook pure request — Workspace-backed Session 创建编排。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-webhook` 的 `session.ts`
 * （`createWebhookSession` 以及对 dsh-agent / dsh-agent-default-model /
 * dsh-agent-presets / dsh-permission-presets / dsh-session / dsh-session-title /
 * dsh-workspace / dsh-llm 的调用）。所有宿主服务调用改为注入端口
 * （`WebhookRuntimePorts`），核心创建事务、回滚、初始模型选择钩子逐字/语义等价重建。
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { brandString } from '../brand.ts'
import { boundContextSummary, createUserMessage, errorChain } from '../llm.ts'
import type {
  AgentCallConfig,
  AgentSetupTarget,
  ModelSelection,
  WebhookRuntimePorts,
} from '../ports.ts'
import type { WebhookRuleId } from '../brand.ts'
import type { VerifiedWebhookDelivery, WebhookSessionRequest } from '../types.ts'

/** 创建事务在异步预检期间保留的已分离值。 */
interface ResolvedWebhookSessionRequest {
  readonly workspacePath: string
  readonly title: string
  readonly prompt: string
  readonly agentPreset: string
  readonly permissionPreset: string
  readonly modelSelection: ModelSelection
  readonly agentOptions: {
    readonly provider: string
    readonly model: string
    readonly maxTokens?: number
  }
}

/** 要求来自无类型规则结果的一个非空字符串字段。 */
function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`webhook Session request ${field} must be a non-empty string`)
  }
  return value
}

/** 快照并校验同进程规则结果，随后跨 await 前先固化。 */
function resolveRequest(ports: WebhookRuntimePorts, input: WebhookSessionRequest): ResolvedWebhookSessionRequest {
  const candidate: unknown = input
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('webhook rule result must be null or a Session request object')
  }
  const record = candidate as Record<string, unknown>
  const workspacePath = requiredString(record, 'workspacePath')
  if (!isAbsolute(workspacePath)) {
    throw new TypeError(`webhook Session request workspacePath must be absolute, got ${JSON.stringify(workspacePath)}`)
  }
  const title = requiredString(record, 'title')
  const prompt = requiredString(record, 'prompt')
  const agentPreset = requiredString(record, 'agentPreset')
  const permissionPreset = requiredString(record, 'permissionPreset')
  const model = record['model']
  if (model !== undefined && (model === null || typeof model !== 'object' || Array.isArray(model))) {
    throw new TypeError('webhook Session request model must be an object')
  }
  let agentOptions: ResolvedWebhookSessionRequest['agentOptions']
  let modelSelection: ModelSelection
  if (model === undefined) {
    const selected = ports.agentDefaultModel.currentSelection()
    agentOptions = { provider: selected.provider, model: selected.model }
    modelSelection = { ...selected }
  } else {
    const modelRecord = model as Record<string, unknown>
    const provider = requiredString(modelRecord, 'provider')
    const modelId = requiredString(modelRecord, 'model')
    const maxTokens = modelRecord['maxTokens']
    if (maxTokens !== undefined
      && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
      throw new TypeError('webhook Session request model.maxTokens must be a positive safe integer')
    }
    agentOptions = {
      provider,
      model: modelId,
      ...(maxTokens === undefined ? {} : { maxTokens }),
    }
    modelSelection = { provider, model: modelId }
  }
  return { workspacePath, title, prompt, agentPreset, permissionPreset, modelSelection, agentOptions }
}

/** 记录一次回滚失败而不替换操作原始失败。 */
function reportRollbackFailure(ports: WebhookRuntimePorts, subject: string, error: unknown): void {
  ports.logger.warn(`webhook: ${subject} rollback failed: ${errorChain(error)}`)
}

/**
 * 应用创建时选择，直到第一个持久请求头存在。
 * @param target - agent 装配期目标（可挂 `agent/request` 事件、持当前复层 Agent）。
 * @param selection - 创建时选定的模型路由。
 */
function installInitialModelSelection(target: AgentSetupTarget, selection: ModelSelection): void {
  target.on('agent/request', async (_payload, next): Promise<AgentCallConfig> => {
    const resolved = await next()
    const agent = target.agent
    /* 复层 Agent 装配完成前不发布 scoped Agent 时，不认为有 Session。 */
    if (agent === undefined) throw new Error('webhook Session setup has no scoped Agent')
    if (agent.requestHeader() !== undefined
      || resolved.provider !== selection.provider
      || resolved.model !== selection.model) return resolved
    const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
    return {
      ...withoutInheritedEffort,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }
  })
}

/**
 * 创建、装配、命名、配置并提示一个普通根 Session。
 * 提示准入成功后 webhook 对该操作的所有权结束；Agent 继续由调用方生命周期拥有，
 * 遵循普通 Session 行为。
 *
 * @param ports - 创建事务所需的注入端口。
 * @param delivery - 用于 provenance 的精确已认证 provider 投递。
 * @param ruleId - 返回请求的规则。
 * @param request - 同进程规则结果。
 * @param signal - 到 publish 为止的注册生命周期取消。
 */
export async function createWebhookSession(
  ports: WebhookRuntimePorts,
  delivery: VerifiedWebhookDelivery,
  ruleId: WebhookRuleId,
  request: WebhookSessionRequest,
  signal: AbortSignal,
): Promise<void> {
  const resolved = resolveRequest(ports, request)
  ports.permissionPresets.resolve(resolved.permissionPreset)
  const preset = await ports.agentPresets.resolve(resolved.agentPreset)
  await ports.agentPresets.standingKeyFor(preset.id)
  signal.throwIfAborted()

  const workspace = await ports.workspaceRegistry.create(resolved.workspacePath)
  signal.throwIfAborted()
  const sessionId = brandString<'WebhookSessionId'>(`webhook-${randomUUID()}`)
  const handle = await ports.agents.create({
    sessionId,
    signal,
    meta: { cwd: workspace.path, agentPreset: preset.id },
    agentOptions: resolved.agentOptions,
    setup: async (target) => {
      await ports.agentPresets.mount(target, preset.id)
      installInitialModelSelection(target, resolved.modelSelection)
    },
  })

  let attached = false
  try {
    signal.throwIfAborted()
    await workspace.attachSession(sessionId)
    attached = true
    signal.throwIfAborted()
    ports.permissionPresets.set(handle.agent.session, resolved.permissionPreset)
    ports.sessionTitle.rename(handle.agent.session, resolved.title)
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: resolved.prompt }],
      source: {
        kind: 'webhook',
        provider: delivery.kind,
        source: delivery.source,
        deliveryId: delivery.deliveryId,
        ruleId,
        form: 'notice',
        summary: boundContextSummary(`${delivery.kind} webhook handled by ${ruleId}`),
      },
    }))
  } catch (error: unknown) {
    if (attached) {
      try {
        await workspace.detachSession(sessionId)
      } catch (rollbackError: unknown) {
        reportRollbackFailure(ports, `Workspace detach for Session "${sessionId}"`, rollbackError)
      }
    }
    try {
      await handle.dispose()
    } catch (rollbackError: unknown) {
      reportRollbackFailure(ports, `Agent disposal for Session "${sessionId}"`, rollbackError)
    }
    throw error
  }
}