/**
 * 装配工厂：把真实内存端口、服务与不变量伴生组合成一个可测试的授权运行时底座。
 *
 * 按任务铁律（T9）：所有原本来自 cordis 的宿主服务均提供真实内存实现，供契约测试
 * 直接装配，禁用 vi.mock。`createAuthorizationRuntime` 聚合
 * `MemoryCredentialsStore`、`MemoryAuthorizationHost`、`AuthorizationService`，并
 * （默认）安装本包 invariant 伴生，把失败写入 `invariantFailures` 供断言。
 *
 * @module @flowforge/credentials-authorization/memory
 */

import { MemoryCredentialsStore } from './ports/credentials.ts'
import { MemoryAuthorizationHost } from './ports/host.ts'
import { AuthorizationService } from './service.ts'
import { createAuthorizationInvariantTarget, installAuthorizationInvariant } from './invariant.ts'

/** 装配后的授权运行时底座句柄。 */
export interface AuthorizationRuntime {
  /** 内存凭据存储（flow 在其中 commit/remove，服务观察 record-updated）。 */
  readonly credentials: MemoryCredentialsStore
  /** 内存授权宿主（生命周期/settle/日志）。 */
  readonly host: MemoryAuthorizationHost
  /** 注入端口的授权服务（被测主体）。 */
  readonly service: AuthorizationService
  /** 已安装的不变量伴生记录到的失败消息。 */
  readonly invariantFailures: string[]
  /** 安装本包 invariant 伴生（重复/幂等调用安全）。 */
  installInvariant(): () => void
  /** 模拟宿主上下文被销毁（促发全部注册的流清理器）。 */
  disposeContext(): void
}

/** 装配选项。 */
export interface AuthorizationRuntimeOptions {
  /** 是否（在构造时）安装本包 invariant 伴生，默认 true。 */
  readonly installInvariant?: boolean
}

/**
 * 构造一个真实装配的内存授权运行时。
 * @param options - 装配选项。
 * @returns 端口聚合、服务与内存实现句柄（供断言足迹）。
 */
export function createAuthorizationRuntime(options: AuthorizationRuntimeOptions = {}): AuthorizationRuntime {
  const credentials = new MemoryCredentialsStore()
  const host = new MemoryAuthorizationHost()
  const service = new AuthorizationService({ credentials, host })
  const invariantFailures: string[] = []
  const installInvariant = (): (() => void) => {
    const release = installAuthorizationInvariant(
      createAuthorizationInvariantTarget(host, () => (host.isDestroyed() ? undefined : service)),
      message => { invariantFailures.push(message) },
    )
    // 宿主的销毁清理器集合由服务 registers flow；此 release 与上下文销毁无关，
    // 仅包装安装态。幂等：重复安装由监听者集合去重 + 返回释放句柄。
    return release
  }
  if (options.installInvariant !== false) installInvariant()
  return {
    credentials,
    host,
    service,
    invariantFailures,
    installInvariant,
    disposeContext: () => host.disposeContext(),
  }
}

/** 便捷构造一个用于单测的内存授权运行时（默认安装 invariant）。 */
export function memoryAuthorizationRuntime(): AuthorizationRuntime {
  return createAuthorizationRuntime()
}

export default createAuthorizationRuntime