/**
 * 本包拥有的不变量伴生（invariant companion）。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-authorization/invariant.ts`。原实现
 * 依赖 `dsh-invariants` 的 `InvariantInstaller`/`InvariantFailure` 契型与 cordis
 * `ctx.get('authorization')`；按任务铁律（T9）契型在包内定义 + 内存装配。校验逻辑
 * 逐字保留：`authorization/settled` 指向一个已结束的尝试，而 seam 每个 key 只放行
 * 一次尝试，因此事件触发时 key 必然已经释放——若结算时仍被占用，则该 key 从此
 * 无法恢复（此后每个 `begin()` 都被拒绝为 `ALREADY_IN_FLIGHT`，直到进程重启），
 * 而从外部看，一个卡住的 key 与一个忙碌的 key 无法区分。
 *
 * @module @flowforge/credentials-authorization/invariant
 */

import type { AuthorizationSettlement, AuthorizationEntry, CredentialKey } from './types.ts'
import type { AuthorizationService } from './service.ts'

/** 该不变量注册的包名（保留伴生插件名）。 */
export const INVARIANT_PACKAGE_NAME = '@flowforge/credentials-authorization'

/** 伴生插件名（含自动化使用的稳定标识，对应 dsh `name` 导出）。 */
export const name = 'credentials-authorization-invariant'

/** invariant 失败回调：携带人类可读的描述。 */
export type InvariantFailure = (message: string) => void

/** 安装不变量所需的最小目标：可订阅 settle 事件，并可取得当前授权服务。 */
export interface AuthorizationInvariantTarget {
  /** 订阅 `authorization/settled`。 */
  onSettled(listener: (key: CredentialKey, settlement: AuthorizationSettlement) => void): () => void
  /** 当前存活的授权服务；宿主不可用时为 `undefined`。 */
  service(): AuthorizationService | undefined
}

/**
 * 安装 single-flight 释放契约：`authorization/settled` 命名一个已结束的尝试，
 * seam 每个 key 只放行一次尝试，因此事件触发时 key 必然已空闲。
 *
 * 兼容原有两条失败分支：无存活服务时警告；结算后 `describe(key).inFlight` 仍为
 * true 时视为 key 被卡住。一个在其自身尝试中被撤回的 flow，结算时已无可描述之物，
 * 这是 disposer 的文档化行为而非泄漏，故不触发失败。
 *
 * @param target - settle 事件订阅 + 服务获取。
 * @param fail - 不变量失败回调。
 * @returns 卸载本次安装的清理器。
 */
export function installAuthorizationInvariant(
  target: AuthorizationInvariantTarget,
  fail: InvariantFailure,
): () => void {
  return target.onSettled((key) => {
    const authorization = target.service()
    if (authorization === undefined) {
      fail(`authorization/settled for "${key}" emitted without a live authorization service`)
      return
    }
    // 一个在其自身尝试中被撤回的 flow 结算时已无可描述之物，这是 disposer 的
    // 文档化行为而非泄漏。
    if (authorization.describe(key)?.inFlight === true) {
      fail(`authorization/settled for "${key}" left the key in flight, wedging every later attempt`)
    }
  })
}

/** 由宿主与服务构造一个 invariant 目标。 */
export function createAuthorizationInvariantTarget(
  host: import('./ports/host.ts').AuthorizationHostPort,
  getService: () => AuthorizationService | undefined,
): AuthorizationInvariantTarget {
  return {
    onSettled: listener => host.onSettled(listener),
    service: getService,
  }
}

/**
 * 以注入端口注册本包的不变量伴生（等价于 dsh `apply`）。
 * @param target - settle 订阅 + 服务获取。
 * @param fail - 失败回调。
 * @returns 安装清理器。
 */
export const apply = (target: AuthorizationInvariantTarget, fail: InvariantFailure): (() => void) =>
  installAuthorizationInvariant(target, fail)

export type { AuthorizationEntry }
export type { AuthorizationService } from './service.ts'