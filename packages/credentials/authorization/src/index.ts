/**
 * @flowforge/credentials-authorization — 授权能力 seam（等价于 dsh `ctx.authorization`，
 * A8）的移植实现。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-authorization`。职责：通过与人对话获取任何无法
 * 仅凭配置得到的凭据——打开这个页面、粘贴那段代码、选一个账户。seam 拥有对话与
 * 生命周期，却永不拥有协议；一个知道如何自取凭据的插件注册一个面向它写入的
 * `CredentialKey` 的 flow。全部原 cordis 宿主服务（Service/Context 各类接口、
 * dsh-credentials 的 `CredentialKey`/`describeRecord`/`record-updated`、
 * dsh-invariants 伴生）改为包内注入式端口（`AuthorizationCredentialsPort` /
 * `AuthorizationHostPort`）+ 真实内存实现；唯一复用上游面是 `@flowforge/llm` 的
 * `HarnessError`。零 `@deepseek-ai/*` / `@cat-cafe/*` / `@clowder-ai/*` 引用。
 */

export * from './types.ts'
export * from './error.ts'
export * from './service.ts'
export { MemoryCredentialsStore } from './ports/credentials.ts'
export type {
  AuthorizationCredentialsPort,
  CredentialRecordInfo,
} from './ports/credentials.ts'
export { MemoryAuthorizationHost, InMemoryAuthorizationLogger } from './ports/host.ts'
export type {
  AuthorizationHostPort,
  AuthorizationSettledListener,
  LoggerPort,
} from './ports/host.ts'
export {
  installAuthorizationInvariant,
  createAuthorizationInvariantTarget,
  apply,
  name,
  INVARIANT_PACKAGE_NAME,
} from './invariant.ts'
export type {
  AuthorizationInvariantTarget,
  InvariantFailure,
} from './invariant.ts'
export {
  createAuthorizationRuntime,
  memoryAuthorizationRuntime,
} from './memory.ts'
export type {
  AuthorizationRuntime,
  AuthorizationRuntimeOptions,
} from './memory.ts'

import type { AuthorizationServiceDeps } from './service.ts'
import { AuthorizationService } from './service.ts'

/**
 * 便捷装配：以注入端口构造一个授权服务。
 * @param deps - 服务依赖端口聚合（凭据 + 宿主）。
 * @returns 注入端口的 AuthorizationService。
 */
export function createAuthorizationService(deps: AuthorizationServiceDeps): AuthorizationService {
  return new AuthorizationService(deps)
}

export default AuthorizationService