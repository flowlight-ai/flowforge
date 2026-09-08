/**
 * 授权失败可路由的错误分类法。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-authorization` 的 `AuthorizationError` 与
 * `AuthorizationDeclinedError`。两者直接继承 `HarnessError`——此处**复用**
 * `@flowforge/llm` 的 `HarnessError`（其 `src/error.ts` 导出
 * `HarnessError(message, code, options?)`，`code`/`cause` 语义与 dsh 的
 * `dsh-llm` 完全一致），类名、错误码与消息逐字保留。
 *
 * @module @flowforge/credentials-authorization/error
 */

import { HarnessError } from '@flowforge/llm'

/** 授权失败的稳定错误分类。 */
export class AuthorizationError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'AuthorizationError'
  }
}

/**
 * {@link AuthorizationInteraction.prompt} 用来表达“人类拒绝了”——关掉了问题、
 * 选择不回答——而不是 surface 坏掉的拒绝。若某次尝试的 flow 在提示被拒绝后失败，
 * 它结算为 `cancelled`，与撤回信号的结果相同，因为人类说“不”是一种拒绝而非损坏。
 * 只有人类的“不”才可以用本类拒绝：被其自身 signal 撤回的提示（flow 退掉一场
 * 竞速中必输的那一问）必须用别的错误拒绝，否则后续的真失败会被误读为拒绝。
 */
export class AuthorizationDeclinedError extends AuthorizationError {
  constructor(message = 'the authorization prompt was declined') {
    super(message, 'DECLINED')
    this.name = 'AuthorizationDeclinedError'
  }
}

export default AuthorizationError