/**
 * @flowforge/webhook contract — 命令结果契型。
 *
 * 帮助函数：把端口/运行时“无异常即 ok、异常即 error”的语义折叠为稳定可断言的
 * 契约结果，供契约测试与编排层消费；不改变纯逻辑抛错语义。
 */

/** 命令终态。 */
export type CommandStatus = 'ok' | 'error'

/** 一个命令的可序列化结果。 */
export interface CommandResult<T = void> {
  readonly status: CommandStatus
  /** 稳定的人类可读摘要（不携带请求数据）。 */
  readonly detail: string
  /** 可选负载。 */
  readonly value?: T
}

/** 构造成功结果。 */
export function CommandOk<T>(detail = 'ok', value?: T): CommandResult<T> {
  return value === undefined ? { status: 'ok', detail } : { status: 'ok', detail, value }
}

/** 构造失败结果。 */
export function CommandFail<T>(detail: string, value?: T): CommandResult<T> {
  return value === undefined ? { status: 'error', detail } : { status: 'error', detail, value }
}

/** 将一次可抛调用折叠为 CommandResult。 */
export function captureCommand<T>(operation: () => T, detail: string): CommandResult<T> {
  try {
    return CommandOk(detail, operation())
  } catch (error) {
    return CommandFail(`${detail}: ${error instanceof Error ? error.message : String(error)}`)
  }
}