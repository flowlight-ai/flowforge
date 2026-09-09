/**
 * @flowforge/webhook ports — 运行时依赖的注入式 seam 集合。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-webhook` 直接或间接依赖的全部宿主服务
 * （agents、agentDefaultModel、agentPresets、agent-overrides 的
 * ModelSelection、permissionPresets、session-title 的 rename、
 * workspace 的 registry、invariants、logger、llm 的 agent/request 事件）。
 * 这些原本是 cordis 服务（Service + `static inject`），按任务铁律（T9）一律转为
 * 包内接口（seam）。每个 seam 都有真实内存实现，供契约测试与无宿主装配使用；
 * 禁用 vi.mock 被测模块。
 */

import type { Branded } from './brand.ts'
import type { UserMessage } from './llm.ts'

/** 当前 agent 默认模型选择（含可选推理努力）。 */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** 一次 LLM 调用已解析的配置路由。 */
export interface AgentCallConfig {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** agent/request 拦截回调；`next()` 解析下一层配置。 */
export type AgentRequestNext = () => Promise<AgentCallConfig>

/** agent-create 的复层会话实例视图。 */
export interface SessionInstance {
  readonly id: string
  readonly header: { readonly cwd?: string }
  readonly requestHeader: () => unknown
}

/** agent-create 的复层 Agent 实例视图。 */
export interface AgentInstance {
  readonly session: SessionInstance
  readonly requestHeader: () => unknown
  followup(message: UserMessage): void
}

/** agent 装配期上下文：可挂事件，且持有当前复层 Agent。 */
export interface AgentSetupTarget {
  on(
    event: 'agent/request',
    handler: (payload: unknown, next: AgentRequestNext) => Promise<AgentCallConfig>,
  ): void
  readonly agent?: AgentInstance
}

/** AgentsPort.create 的入参（对应 dsh agent factory 的 create 选项）。 */
export interface AgentCreateOptions {
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly meta: { readonly cwd: string; readonly agentPreset: string }
  readonly agentOptions: {
    readonly provider: string
    readonly model: string
    readonly maxTokens?: number
  }
  readonly setup: (target: AgentSetupTarget) => void | Promise<void>
}

/** Agent 完成装配后的生命周期句柄。 */
export interface AgentHandle {
  readonly agent: AgentInstance
  dispose(): Promise<void>
}

/** agent 工厂 seam：创建一个 Workspace-backed 会话的 Agent。 */
export interface AgentsPort {
  create(options: AgentCreateOptions): Promise<AgentHandle>
}

/** agent 默认模型 seam。 */
export interface AgentDefaultModelPort {
  currentSelection(): ModelSelection
}

/** agent 预置解析的轻量信息。 */
export interface AgentPresetInfo {
  readonly id: string
}

/** agent 预置 seam：解析、占位键、装配。 */
export interface AgentPresetsPort {
  resolve(id: string): Promise<AgentPresetInfo>
  standingKeyFor(presetId: string): Promise<unknown>
  mount(target: AgentSetupTarget, presetId: string): Promise<void>
}

/** permission 预置 seam：准入前解析 + 会话装配。 */
export interface PermissionPresetsPort {
  resolve(name: string): void
  set(session: SessionInstance, name: string): void
}

/** session 标题 seam。 */
export interface SessionTitlePort {
  rename(session: SessionInstance, title: string): void
}

/** 一个 Web Workspace 实例。 */
export interface WorkspaceInstance {
  readonly path: string
  readonly sessionIds: readonly string[]
  attachSession(sessionId: string): Promise<void>
  detachSession(sessionId: string): Promise<void>
}

/** workspace 注册表 seam。 */
export interface WorkspaceRegistryPort {
  create(path: string): Promise<WorkspaceInstance>
  list(): readonly WorkspaceInstance[]
}

/** invariant 注册失败回调。 */
export type InvariantFailure = (message: string) => void

/** invariant 安装者：在某运行时安装一条不变量规则。 */
export interface InvariantInstaller {
  (runtime: InvariantRuntimeTarget, fail: InvariantFailure): void
}

/** invariant 运行时目标：可挂全局事件监听。 */
export interface InvariantRuntimeTarget {
  on(event: string, listener: (...args: unknown[]) => void): void
}

/** invariant 注册表 seam。 */
export interface InvariantRegistryPort {
  register(packageName: string, installer: InvariantInstaller): () => void
}

/** 极简运行日志 seam。 */
export interface LoggerPort {
  debug(message: string): void
  warn(message: string): void
}

/** webhook 运行时所需的全部注入端口聚合。 */
export interface WebhookRuntimePorts {
  readonly logger: LoggerPort
  readonly agents: AgentsPort
  readonly agentDefaultModel: AgentDefaultModelPort
  readonly agentPresets: AgentPresetsPort
  readonly permissionPresets: PermissionPresetsPort
  readonly sessionTitle: SessionTitlePort
  readonly workspaceRegistry: WorkspaceRegistryPort
  readonly invariants: InvariantRegistryPort
}

/** SessionId 品牌（仅用于区分诊断域，跨状态复用）。 */
export type SessionId = Branded<'WebhookSessionId'>