/**
 * @flowforge/webhook memory — 注入端口的真实内存实现 + 契约测试底座。
 *
 * 按任务铁律（T9）：所有原本来自 cordis 的宿主服务，除端口接口外均提供真实内存
 * 实现，供契约测试直接装配，禁用 vi.mock。每个实现记录其被调用的足迹，供断言
 * “session 创建编排”“错误路径”“内存实现行为”等测试分组使用。
 */

import type {
  AgentCallConfig,
  AgentCreateOptions,
  AgentDefaultModelPort,
  AgentHandle,
  AgentInstance,
  AgentPresetInfo,
  AgentPresetsPort,
  AgentSetupTarget,
  AgentsPort,
  InvariantFailure,
  InvariantInstaller,
  InvariantRegistryPort,
  LoggerPort,
  ModelSelection,
  PermissionPresetsPort,
  SessionId,
  SessionInstance,
  SessionTitlePort,
  WebhookRuntimePorts,
  WorkspaceInstance,
  WorkspaceRegistryPort,
} from './ports.ts'
import { evaluateWebhookInboxPlacement, installWebhookInvariant } from './pure/invariant.ts'
import { brandString } from './brand.ts'
import type { UserMessage } from './llm.ts'

/** 内存日志端口：记录每条 debug/warn。 */
export class InMemoryLogger implements LoggerPort {
  readonly debugLog: string[] = []
  readonly warnLog: string[] = []

  debug(message: string): void {
    this.debugLog.push(message)
  }

  warn(message: string): void {
    this.warnLog.push(message)
  }
}

/** 内存 agent 默认模型端口。 */
export class InMemoryAgentDefaultModel implements AgentDefaultModelPort {
  constructor(private readonly selection: ModelSelection) {}

  currentSelection(): ModelSelection {
    return this.selection
  }
}

/** 内存 agent 预置端口。 */
export class InMemoryAgentPresets implements AgentPresetsPort {
  readonly presets = new Map<string, AgentPresetInfo>()
  readonly standingKeys: string[] = []
  readonly mounts: { readonly target: AgentSetupTarget; readonly presetId: string }[] = []

  constructor(ids: readonly string[] = ['default']) {
    for (const id of ids) this.presets.set(id, { id })
  }

  resolve(id: string): Promise<AgentPresetInfo> {
    const preset = this.presets.get(id)
    if (preset === undefined) return Promise.reject(new Error(`agent preset "${id}" is unknown`))
    return Promise.resolve(preset)
  }

  standingKeyFor(presetId: string): Promise<unknown> {
    if (!this.presets.has(presetId)) return Promise.reject(new Error(`agent preset "${presetId}" is unknown`))
    const key = `standing:${presetId}`
    this.standingKeys.push(key)
    return Promise.resolve(key)
  }

  mount(target: AgentSetupTarget, presetId: string): Promise<void> {
    this.mounts.push({ target, presetId })
    return Promise.resolve()
  }
}

/** 内存 permission 预置端口。 */
export class InMemoryPermissionPresets implements PermissionPresetsPort {
  readonly known = new Set<string>()
  readonly sets: { readonly sessionId: string; readonly name: string }[] = []

  constructor(ids: readonly string[] = ['sandboxed']) {
    for (const id of ids) this.known.add(id)
  }

  resolve(name: string): void {
    if (!this.known.has(name)) throw new Error(`permission preset "${name}" is unknown`)
  }

  set(session: SessionInstance, name: string): void {
    this.sets.push({ sessionId: session.id, name })
  }
}

/** 内存 session 标题端口。 */
export class InMemorySessionTitle implements SessionTitlePort {
  readonly renames: { readonly sessionId: string; readonly title: string }[] = []

  rename(session: SessionInstance, title: string): void {
    this.renames.push({ sessionId: session.id, title })
  }
}

/** 内存 workspace 实例。 */
export class InMemoryWorkspace implements WorkspaceInstance {
  readonly sessionIdList: string[] = []
  failNextAttach = false

  constructor(readonly path: string) {}

  get sessionIds(): readonly string[] {
    return this.sessionIdList
  }

  attachSession(sessionId: string): Promise<void> {
    if (this.failNextAttach) {
      this.failNextAttach = false
      return Promise.reject(new Error('workspace attach failed (injected)'))
    }
    if (!this.sessionIdList.includes(sessionId)) this.sessionIdList.push(sessionId)
    return Promise.resolve()
  }

  detachSession(sessionId: string): Promise<void> {
    const index = this.sessionIdList.indexOf(sessionId)
    if (index >= 0) this.sessionIdList.splice(index, 1)
    return Promise.resolve()
  }
}

/** 内存 workspace 注册表端口。 */
export class InMemoryWorkspaceRegistry implements WorkspaceRegistryPort {
  readonly workspaces: InMemoryWorkspace[] = []

  create(path: string): Promise<WorkspaceInstance> {
    const workspace = new InMemoryWorkspace(path)
    this.workspaces.push(workspace)
    return Promise.resolve(workspace)
  }

  list(): readonly WorkspaceInstance[] {
    return this.workspaces
  }

  /** 供不变量判定归属事实使用。 */
  ownersOf(sessionId: string): import('./pure/invariant.ts').WorkspaceOwnerFact[] {
    return this.workspaces
      .filter(workspace => workspace.sessionIds.includes(sessionId))
      .map(workspace => ({ path: workspace.path, sessionIds: workspace.sessionIds }))
  }
}

/** 内存 agent 实例（同时充当装配目标 AgentSetupTarget）。 */
export class InMemoryAgent implements AgentInstance, AgentSetupTarget {
  readonly requestHandlers: ((payload: unknown, next: () => Promise<AgentCallConfig>) => Promise<AgentCallConfig>)[] = []
  readonly followups: UserMessage[] = []
  disposed = false
  meta: AgentCreateOptions['meta'] | undefined
  agentOptions: AgentCreateOptions['agentOptions'] | undefined

  constructor(readonly session: SessionInstance) {}

  get agent(): AgentInstance {
    return this
  }

  requestHeader(): unknown {
    return undefined
  }

  followup(message: UserMessage): void {
    this.followups.push(message)
  }

  on(
    event: 'agent/request',
    handler: (payload: unknown, next: () => Promise<AgentCallConfig>) => Promise<AgentCallConfig>,
  ): void {
    if (event === 'agent/request') this.requestHandlers.push(handler)
  }

  /** 模拟一次 LLM 请求，按注册顺序重放 agent/request 钩子。 */
  async simulateRequest(config: AgentCallConfig): Promise<AgentCallConfig> {
    let current = config
    for (const handler of [...this.requestHandlers]) {
      current = await handler({}, async () => current)
    }
    return current
  }
}

/** 内存 agent 工厂端口。 */
export class InMemoryAgents implements AgentsPort {
  readonly creations: InMemoryAgent[] = []
  readonly disposed: InMemoryAgent[] = []

  async create(options: AgentCreateOptions): Promise<AgentHandle> {
    const session: SessionInstance = {
      id: options.sessionId,
      header: { cwd: options.meta.cwd },
      requestHeader: () => undefined,
    }
    const agent = new InMemoryAgent(session)
    agent.meta = options.meta
    agent.agentOptions = options.agentOptions
    await options.setup(agent)
    this.creations.push(agent)
    const handle: AgentHandle = {
      agent,
      dispose: async () => {
        agent.disposed = true
        this.disposed.push(agent)
      },
    }
    return handle
  }
}

/** 内存不变量注册表端口（register 时立即安装，并收集失败）。 */
export class InMemoryInvariantRegistry implements InvariantRegistryPort {
  private readonly installs = new Map<
    string,
    { readonly listeners: ((payload: unknown) => void)[]; readonly fail: InvariantFailure }
  >()
  readonly failures: { readonly name: string; readonly message: string }[] = []

  register(packageName: string, installer: InvariantInstaller): () => void {
    if (this.installs.has(packageName)) {
      throw new Error(`invariant "${packageName}" is already registered`)
    }
    const listeners: ((payload: unknown) => void)[] = []
    const fail: InvariantFailure = (message) => {
      this.failures.push({ name: packageName, message })
    }
    const runtime = {
      on(_event: string, listener: (...args: unknown[]) => void) {
        listeners.push(listener as (payload: unknown) => void)
      },
    }
    installer(runtime, fail)
    this.installs.set(packageName, { listeners, fail })
    return () => {
      this.installs.delete(packageName)
    }
  }

  /** 触发一次 session/event，驱动已安装的不变量监听器。 */
  notifySessionEvent(payload: unknown): void {
    for (const install of this.installs.values()) {
      for (const listener of install.listeners) listener(payload)
    }
  }
}

/** 由内存端口拼接成的运行时端口聚合。 */
export interface MemoryRuntime {
  readonly ports: WebhookRuntimePorts
  readonly logger: InMemoryLogger
  readonly agents: InMemoryAgents
  readonly agentDefaultModel: InMemoryAgentDefaultModel
  readonly agentPresets: InMemoryAgentPresets
  readonly permissionPresets: InMemoryPermissionPresets
  readonly sessionTitle: InMemorySessionTitle
  readonly workspaceRegistry: InMemoryWorkspaceRegistry
  readonly invariants: InMemoryInvariantRegistry
}

/** 契约测试选项。 */
export interface MemoryRuntimeOptions {
  readonly defaultSelection?: ModelSelection
  readonly agentPresetIds?: readonly string[]
  readonly permissionPresetIds?: readonly string[]
  readonly installInvariant?: boolean
}

/**
 * 构造一个真实装配的内存运行时底座。
 * @param options - 各端口初始状态。
 * @returns 端口聚合与各内存实现句柄（供断言足迹）。
 */
export function createMemoryRuntime(options: MemoryRuntimeOptions = {}): MemoryRuntime {
  const logger = new InMemoryLogger()
  const agentDefaultModel = new InMemoryAgentDefaultModel(
    options.defaultSelection ?? { provider: 'default-provider', model: 'default-model' },
  )
  const agentPresets = new InMemoryAgentPresets(options.agentPresetIds ?? ['base'])
  const permissionPresets = new InMemoryPermissionPresets(options.permissionPresetIds ?? ['sandboxed'])
  const sessionTitle = new InMemorySessionTitle()
  const workspaceRegistry = new InMemoryWorkspaceRegistry()
  const agents = new InMemoryAgents()
  const invariants = new InMemoryInvariantRegistry()
  const ports: WebhookRuntimePorts = {
    logger,
    agents,
    agentDefaultModel,
    agentPresets,
    permissionPresets,
    sessionTitle,
    workspaceRegistry,
    invariants,
  }
  if (options.installInvariant !== false) {
    installWebhookInvariant(invariants, sessionId => workspaceRegistry.ownersOf(sessionId))
  }
  return {
    ports,
    logger,
    agents,
    agentDefaultModel,
    agentPresets,
    permissionPresets,
    sessionTitle,
    workspaceRegistry,
    invariants,
  }
}

/** 便捷构造一个内存 SessionId（诊断域可用）。 */
export function memorySessionId(seed: string): SessionId {
  return brandString<'WebhookSessionId'>(`test-${seed}`)
}

// 复导出判定政策，供不变量测试与内存装配复用。
export { evaluateWebhookInboxPlacement }