/**
 * 授权能力 seam（等价于 dsh 的 `ctx.authorization`）的移植与核心语义。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-authorization`（A8）。职责：通过与人对话获取
 * 任何无法仅凭配置得到的凭据——打开这个页面、粘贴那段代码、选一个账户。seam 拥有
 * 对话与生命周期，却永不拥有协议：知道如何自取凭据的插件注册一个面向它写入的
 * `CredentialKey` 的 flow，flow 以一套中立的 notices/prompts 词汇与启动它的任何
 * surface 对话。原 cordis `Service`/`Context`（`ctx.effect`、`ctx.on`、
 * `ctx.events.dispatch('emit', ...)`、`ctx.logger`、`ctx.credentials`）一律抽象为
 * 包内注入端口（`AuthorizationCredentialsPort` / `AuthorizationHostPort`），
 * 本服务改为依赖注入构造的普通类，方法语义逐字保留。
 *
 * @module @flowforge/credentials-authorization/service
 */

import { AuthorizationError, AuthorizationDeclinedError } from './error.ts'
import type { AuthorizationSettlement, AuthorizationMethod, AuthorizationNotice,
  AuthorizationPrompt, AuthorizationOutcome, AuthorizationEntry, CredentialKey } from './types.ts'
import type { AuthorizationCredentialsPort } from './ports/credentials.ts'
import type { AuthorizationHostPort } from './ports/host.ts'

export type { AuthorizationEntry, AuthorizationMethod, AuthorizationNotice, AuthorizationOutcome,
  AuthorizationPrompt, AuthorizationPromptOption, AuthorizationSettlement, AuthorizationStatus } from './types.ts'

/** 服务依赖端口聚合（注入替代原 cordis `ctx`）。 */
export interface AuthorizationServiceDeps {
  /** 凭据记载端口（describeRecord / record-updated 订阅）。 */
  readonly credentials: AuthorizationCredentialsPort
  /** 宿主端口（生命周期 / settle 事件 / 日志）。 */
  readonly host: AuthorizationHostPort
}

/** 运行中 flow 拿去与人类对话的界面。每个成员只作用于一次尝试：flow 既不知道也不选择哪个 surface 在听。 */
export interface AuthorizationSession {
  /** 调用方选中的方法 id，必为该 flow 声明之一。 */
  readonly method: string
  /** 当调用方撤回或对该 key 调用 `cancel()` 时中止。 */
  readonly signal: AbortSignal
  /**
   * 汇报进度，或告诉人类接下来做什么。Fire-and-forget：无法渲染 notice 的
   * surface 不得拖住 flow。
   * @param notice - 消息，及其指向的页面或代码。
   */
  notify(notice: AuthorizationNotice): void
  /**
   * 向人类提出 flow 无法自行回答的问题。
   * @param prompt - 问什么，以及应如何展示。
   * @returns 人类输入的内容，或所选 option 的 id。
   * @throws 当人类拒绝，或该提示自身的 signal 撤回它。
   */
  prompt(prompt: AuthorizationPrompt): Promise<string>
}

/**
 * 插件对“如何获取某一条凭据”的全部认知。flow 拥有写入权：`run()` 决议意味着在
 * 该次 run 期间，已通过凭据层向 `key` 提交了一条记录，seam 会确认它——在尝试内
 * 观察到的提交、结束后仍存在的提交——才报告成功。在 flow 内提交，让一个经由自身
 * 存储适配器持久化的库（如 pi-ai 的 `Models.login()`）保持唯一写者，而不被复制
 * 出来写成两份。
 */
export interface AuthorizationFlow {
  /** 该 flow 写入的凭据记录，其 scope 命名拥有它的插件。 */
  readonly key: CredentialKey
  /** 正在被授权对象的用户可见名称。 */
  readonly label: string
  /**
   * 提供的方法，最受青睐者优先；调用方不指名时取第一个。类型化为非空，因为
   * 一个无可运行之物的 flow 是无法开始的 flow。
   */
  readonly methods: readonly [AuthorizationMethod, ...AuthorizationMethod[]]
  /**
   * 运行一次尝试：获取并提交该凭据。
   * @param session - 所选方法、取消信号与交互回调。
   * @returns 记录已提交后决议。
   * @throws 当尝试失败或人类拒绝时。
   */
  run(session: AuthorizationSession): Promise<void>
}

/**
 * 一次尝试的 surface 半边。随请求提供而非注册，因为发起授权的调用方正是可以和
 * 人类谈论它的一方：prompt 恰好到达发起提问的页面；headless 调用方提供一个拒绝
 * 的 interaction。
 */
export interface AuthorizationInteraction {
  /**
   * 渲染来自运行中 flow 的 notice。
   * @param notice - 消息，及其指向的页面或代码。
   */
  notify(notice: AuthorizationNotice): void
  /**
   * 向人类提问并等待。
   * @param prompt - 问什么，以及应如何展示。
   * @returns 输入文本，或所选项的 id。
   * @throws {AuthorizationDeclinedError} 当人类拒绝；任何其他拒绝都被读作
   *   surface 损坏而非答案。
   */
  prompt(prompt: AuthorizationPrompt): Promise<string>
}

/** 一次授权某 key 的请求。 */
export interface AuthorizationRequest {
  /** 待授权的凭据记录；必须有 flow 已为它注册。 */
  key: CredentialKey
  /** 运行 flow 的哪一方法。缺省为该 flow 的第一个。 */
  method?: string
  /** 将渲染本次尝试 notices/prompts 的 surface。 */
  interaction: AuthorizationInteraction
  /** 撤回整个尝试。 */
  signal?: AbortSignal
}

/** 一次在跑尝试的句柄，携带撤回它的控制器。 */
interface InFlight {
  readonly controller: AbortController
}

/**
 * `AuthorizationService`：凭据获取 flow 的注册表，每个 key 同一时刻至多一次尝试。
 *
 * 源语义逐字保留：
 * - `registerFlow` / `list` / `describe` / `cancel` / `begin`；
 * - 方法校验三级错误 `NO_FLOW` / `UNKNOWN_METHOD` / `ALREADY_IN_FLIGHT`；
 * - `begin` 已中止直接返回 `{ status: 'cancelled' }`（不占 slot、不跑 flow）；
 * - `attempt` 内 `Promise.race` withdraw vs ran、decline 观察、commit 观察
 *   （`record-updated` 只认 `flow.key`）、resolve 后复查 `describeRecord().configured`
 *   防删除/未提交 → `NOT_COMMITTED`；
 * - settle 事件 fan-out 含 INVARIANT 再抛与普通监听者失败不外泄。
 */
export class AuthorizationService {
  private readonly flows = new Map<CredentialKey, AuthorizationFlow>()
  private readonly running = new Map<CredentialKey, InFlight>()

  constructor(private readonly deps: AuthorizationServiceDeps) {}

  /**
   * 提供一条获取凭据的路径。每个 key 至多一个 flow：两个插件声称同一 key，
   * 各以其格式写一条记录，后跑者会留下前一个读到无法解析的 payload。
   *
   * @param flow - 它写入的 key、label、methods 与其 runner。
   * @returns 撤回该 flow 的清理器。
   * @throws {AuthorizationError} code `DUPLICATE_FLOW` 当 key 已被认领。
   */
  registerFlow(flow: AuthorizationFlow): () => void {
    if (this.flows.has(flow.key)) {
      throw new AuthorizationError(
        `an authorization flow for "${flow.key}" is already registered`, 'DUPLICATE_FLOW')
    }
    this.flows.set(flow.key, flow)
    const cleanup = (): void => {
      // 一个中途离场的 flow 带走它的尝试：runner 属于一个即将离开的插件，
      // 让它继续提问会活得比还能作答的 fiber 更久。
      this.flows.delete(flow.key)
      this.running.get(flow.key)?.controller.abort()
    }
    const release = this.deps.host.registerDisposer(cleanup)
    return () => { release(); cleanup() }
  }

  /**
   * 每个已注册 flow，供 surface 列出可授权之物。
   * @returns 每个 flow 对应一条 entry，按注册顺序。
   */
  list(): readonly AuthorizationEntry[] {
    return [...this.flows.values()].map(flow => this.entry(flow))
  }

  /**
   * 单个已注册 flow。
   * @param key - 待询问的凭据记录。
   * @returns 其 entry，或当无 flow 声称该 key 时为 `undefined`。
   */
  describe(key: CredentialKey): AuthorizationEntry | undefined {
    const flow = this.flows.get(key)
    return flow === undefined ? undefined : this.entry(flow)
  }

  /** 单个已注册 flow 的公开视图。 */
  private entry(flow: AuthorizationFlow): AuthorizationEntry {
    return {
      key: flow.key,
      label: flow.label,
      methods: flow.methods,
      inFlight: this.running.has(flow.key),
    }
  }

  /**
   * 撤回一个 key 正在运行的尝试（若有）。与请求自身的 signal 分开，因为
   * 一次请求/响应传输在第二次调用应答 Cancel 按钮，却没有第一个请求 signal 的
   * 句柄。
   * @param key - 其尝试应停止的凭据记录。
   */
  cancel(key: CredentialKey): void {
    this.running.get(key)?.controller.abort()
  }

  /**
   * 运行一次授权某 key 的尝试，并报告它如何结束。
   *
   * 每个 key 同一时刻至多一次尝试。第二个调用方被拒绝而非加入：他们会在同一
   * flow 上问不同的人类，第二个会答第一个被问的问题。
   *
   * @param request - key、方法、surface 与取消信号。
   * @returns 记录在本次尝试内被提交并被观察到时为 `authorized`；人类拒绝或调用方
   *   撤回时为 `cancelled`。
   * @throws {AuthorizationError} code `NO_FLOW` 当无 flow 声称该 key、
   *   `UNKNOWN_METHOD` 当所指名方法不是该 flow 提供之一、
   *   `ALREADY_IN_FLIGHT` 当该 key 已有尝试在跑，或 `NOT_COMMITTED` 当 flow 在
   *   尝试内未提交记录即已决议。
   */
  async begin(request: AuthorizationRequest): Promise<AuthorizationOutcome> {
    const { key } = request
    const flow = this.flows.get(key)
    if (flow === undefined) {
      throw new AuthorizationError(`no authorization flow is registered for "${key}"`, 'NO_FLOW')
    }
    const method = request.method ?? flow.methods[0].id
    if (!flow.methods.some(candidate => candidate.id === method)) {
      throw new AuthorizationError(
        `authorization flow for "${key}" offers no method "${method}"`, 'UNKNOWN_METHOD')
    }
    if (this.running.has(key)) {
      throw new AuthorizationError(
        `an authorization attempt for "${key}" is already running`, 'ALREADY_IN_FLIGHT')
    }
    // 在开始前已撤回：永不占 slot，永不跑 flow。把已中止的 signal 交给 `run()`
    // 会依赖每个 flow 在首个 await 前都检查它，而未检查的 flow 会握住 key 悬挂。
    // 校验仍先跑，因此无论是否同时放弃，指名一个不存在的 key/方法都会被告知。
    if (request.signal?.aborted === true) return { status: 'cancelled' }
    const controller = new AbortController()
    const withdraw = (): void => { controller.abort(request.signal?.reason) }
    request.signal?.addEventListener('abort', withdraw, { once: true })
    this.running.set(key, { controller })
    let settlement: AuthorizationSettlement = 'failed'
    try {
      const outcome = await this.attempt(flow, method, controller.signal, request.interaction)
      settlement = outcome.status
      return outcome
    } finally {
      request.signal?.removeEventListener('abort', withdraw)
      this.running.delete(key)
      // 释放 slot 之后，让对该执行结束作出反应而立即启动下一次尝试的监听者
      // 不会因刚结束的那次而被拒绝。
      this.settle(key, settlement)
    }
  }

  /* jscpd:ignore-start -- 与凭据/设置 seam 的 commit fan-out 刻意对称：contained-
     dispatch 形状是经过评审的监听者生命周期契约，抽出它会耦合各 seam 的事件语义。 */
  /**
   * 把 `authorization/settled` 以 contained 监听者失败方式 fan-out：每个监听者都跑，
   * 同步抛出或异步拒绝都被记录而不改变已结束尝试自身的结果——除了 `INVARIANT`
   * 码的失败，它在所有监听者跑完后再次抛出。事件触发时尝试已结束、其 key 已释放，
   * 因此一个坏掉的观察者（那个第二个浏览器标签页）永远不能把调用方已成定局的结果
   * 变成它自己的失败。
   */
  private settle(key: CredentialKey, settlement: AuthorizationSettlement): void {
    let invariantFailure: unknown
    for (const listener of this.deps.host.settledListeners()) {
      try {
        const returned = listener(key, settlement)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnSettledListenerFailure(key, error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.warnSettledListenerFailure(key, error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }
  /* jscpd:ignore-end */

  /** 同步与异步失败路径共用的 contained 监听者诊断。 */
  private warnSettledListenerFailure(key: CredentialKey, error: unknown): void {
    this.deps.host.logger.warn('authorization: an authorization/settled listener for "%s" failed', key)
    this.deps.host.logger.warn(error)
  }

  /** 运行 flow，再拿它履行它那一半的提交契约。 */
  private async attempt(
    flow: AuthorizationFlow,
    method: string,
    signal: AbortSignal,
    interaction: AuthorizationInteraction,
  ): Promise<AuthorizationOutcome> {
    // 无论 flow 是否对其作反应，撤回都让尝试结算。flow 本应在 signal 触发时停止，
    // 但未停止的 flow 会握住 key 直到进程结束，而从外部看一个卡住的 key 与一个忙碌
    // 的 key 无法区分。无主的 run 任其自行结束；没有东西等它，而它仍然设法提交的
    // 记录是一条人类确已授权的记录。
    const withdrawn = new Promise<'withdrawn'>((resolve) => {
      // `begin()` 在其调用方已撤回时于认领 key 前返回，因此这里的 signal 不可能已中止。
      signal.addEventListener('abort', () => { resolve('withdrawn') }, { once: true })
    })
    // 尝试期间 seam 亲眼所见之物，以属性持有，因为闭包写入不会跨 await 收窄局部变量：
    // prompt 包装器亲眼看到拒绝（离开时重包该拒绝的 flow 无法隐藏它），确认提交就是
    // 确认它*此刻*发生——重新授权时记录已存在，仅凭存在会让什么都没写的 flow 把陈旧
    // 凭据报告为新鲜授权。
    const observed = { declined: false, committed: false }
    const unwatch = this.deps.credentials.onRecordUpdated((key: CredentialKey) => {
      if (key === flow.key) observed.committed = true
    })
    try {
      const running = flow.run({
        method,
        signal,
        notify: (notice) => {
          try {
            interaction.notify(notice)
          } catch (error) {
            // Fire-and-forget 由 seam 兜底：无法渲染 notice 的 surface（页面连接刚关闭）
            // 失去的是 notice，绝不是尝试。
            this.deps.host.logger.warn('authorization: the interaction surface failed to render a notice')
            this.deps.host.logger.warn(error)
          }
        },
        prompt: prompt => interaction.prompt(prompt).catch((error: unknown) => {
          if (error instanceof AuthorizationDeclinedError) observed.declined = true
          throw error
        }),
      })
      try {
        if (await Promise.race([running.then(() => 'ran' as const), withdrawn]) === 'withdrawn') {
          // 再也没有东西等这个孤儿，它最终的失败必须被标记为已处理，否则会击垮进程。
          void running.catch(() => { this.deps.host.logger.debug('authorization: withdrawn flow failed after the fact') })
          return { status: 'cancelled' }
        }
      } catch (error) {
        // 撤回的尝试与被拒绝的提示都是结果而非失败：人类说“不”，或关了页面。
        // 任何其他都是 flow 失败，属于调用方，cause 链原样保留。
        if (signal.aborted || observed.declined) return { status: 'cancelled' }
        throw error
      }
    } finally {
      unwatch()
    }
    if (!observed.committed) {
      throw new AuthorizationError(
        `authorization flow for "${flow.key}" resolved without committing a credential record in this attempt`,
        'NOT_COMMITTED')
    }
    const stored = await this.deps.credentials.describeRecord(flow.key)
    if (!stored.configured) {
      throw new AuthorizationError(
        `authorization flow for "${flow.key}" deleted its credential record instead of committing one`,
        'NOT_COMMITTED')
    }
    return { status: 'authorized' }
  }
}

export default AuthorizationService