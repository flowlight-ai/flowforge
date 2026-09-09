/**
 * 授权宿主端口（AuthorizationHostPort）+ 真实内存实现（MemoryAuthorizationHost）。
 *
 * 移植来源：dsh 中 `AuthorizationService` 直接占用的 cordis `Context` 服务面——
 * `ctx.effect`（生命周期 disposer 注册）、`ctx.on`（记录更新订阅）、
 * `ctx.events.dispatch('emit', ...)`（settle 事件 fan-out）、`ctx.logger`
 * （运行日志）。按任务铁律（T9）全部转为本包 seam：端口接口 + 真实内存实现，
 * 禁用 vi.mock。内存实现以独立集合持有 disposer（供上下文销毁一并促发）、
 * settle 监听者（供 settle fan-out 枚举）与日志足迹（供断言）。
 *
 * @module @flowforge/credentials-authorization/ports/host
 */

import type { CredentialKey, AuthorizationSettlement } from '../types.ts'

/** settle 事件监听器签名：`authorization/settled(key, settlement)`。 */
export type AuthorizationSettledListener = (
  key: CredentialKey,
  settlement: AuthorizationSettlement,
) => void

/** 极简运行日志 seam（对应 dsh `ctx.logger` 的 debug/warn 两级）。 */
export interface LoggerPort {
  debug(message: unknown, ...args: unknown[]): void
  warn(message: unknown, ...args: unknown[]): void
}

/**
 * 授权服务所需的最小宿主端口：生命周期处置、settle 事件订阅与 fan-out、日志。
 * 记录更新的订阅走凭据端口（`ports/credentials.ts`），此处只管授权自身的生命周期
 * 与 settle 事件流。
 */
export interface AuthorizationHostPort {
  /** 运行日志。 */
  readonly logger: LoggerPort
  /**
   * 注册一个当宿主上下文被销毁（fiber/context 卸载）时运行的清理器。
   * @param dispose - 上下文销毁时执行的清理器。
   * @returns 取消本次注册的清理器（调用方主动销毁时避免重复执行）。
   */
  registerDisposer(dispose: () => void): () => void
  /**
   * 订阅 `authorization/settled`：一次尝试结束并释放其 key。
   * @param listener - 结算监听者。
   * @returns 卸载订阅的清理器。
   */
  onSettled(listener: AuthorizationSettledListener): () => void
  /**
   * 枚举当前 settle 监听者，供服务在释放 slot 后 fan-out。
   * @returns 当前全部监听者（快照）。
   */
  settledListeners(): readonly AuthorizationSettledListener[]
}

/** 内存运行日志：记录每条 debug/warn。 */
export class InMemoryAuthorizationLogger implements LoggerPort {
  readonly debugLog: unknown[][] = []
  readonly warnLog: unknown[][] = []

  debug(message: unknown, ...args: unknown[]): void {
    this.debugLog.push([message, ...args])
  }

  warn(message: unknown, ...args: unknown[]): void {
    this.warnLog.push([message, ...args])
  }
}

/**
 * 真实内存授权宿主：契约测试底座与无宿主装配。持有 disposer 集合（可一次销毁）、
 * settle 监听者集合（可枚举 fan-out）与一个内存日志。
 */
export class MemoryAuthorizationHost implements AuthorizationHostPort {
  readonly logger = new InMemoryAuthorizationLogger()
  /** 已注册的上下文销毁清理器。 */
  private readonly disposers = new Set<() => void>()
  /** 已注册的 settle 监听者。 */
  private readonly settled = new Set<AuthorizationSettledListener>()
  /** 宿主是否已被销毁（服务返回 `undefined` 的依据）。 */
  private destroyed = false

  /**
   * 注册上下文销毁清理器。
   * @param dispose - 销毁时执行的清理器。
   * @returns 取消本次注册的清理器。
   */
  registerDisposer(dispose: () => void): () => void {
    this.disposers.add(dispose)
    return () => { this.disposers.delete(dispose) }
  }

  /**
   * 订阅 settle 事件。
   * @param listener - 结算监听者。
   * @returns 卸载订阅的清理器。
   */
  onSettled(listener: AuthorizationSettledListener): () => void {
    this.settled.add(listener)
    return () => { this.settled.delete(listener) }
  }

  /**
   * 枚举 settle 监听者快照。
   * @returns 当前全部监听者。
   */
  settledListeners(): readonly AuthorizationSettledListener[] {
    return [...this.settled]
  }

  /**
   * 模拟宿主上下文被销毁：执行全部 disposer 并清空集合；此后宿主视为不可用。
   */
  disposeContext(): void {
    this.destroyed = true
    for (const dispose of [...this.disposers]) dispose()
    this.disposers.clear()
  }

  /** 宿主是否仍可用。 */
  isDestroyed(): boolean {
    return this.destroyed
  }
}

/** 便捷构造一个内存授权宿主。 */
export function createMemoryAuthorizationHost(): MemoryAuthorizationHost {
  return new MemoryAuthorizationHost()
}

export default MemoryAuthorizationHost