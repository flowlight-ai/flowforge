/**
 * 契约测试共享底座：构建 flow / interaction 的工厂与便捷类型。
 *
 * 按任务铁律（T9）全部基于真实内存端口（`createAuthorizationRuntime`），禁用对
 * 被测模块的 vi.mock；此处仅提供组装被测对象的纯工厂。
 */

import type { AuthorizationFlow, AuthorizationInteraction, AuthorizationPrompt,
  AuthorizationSession, AuthorizationSettlement, CredentialKey } from '../src/index.ts'
import { credentialKey } from '../src/index.ts'

/** 便捷构造一条测试 CredentialKey。 */
export function key(scope = 'test-plugin', name = 'cred'): CredentialKey {
  return credentialKey(scope, name)
}

/** flow 运行器：可在测试内捕获 session 与记录提交行为。 */
export interface FlowBehaviour {
  readonly key: string
  label?: string
  methods?: readonly [{ id: string; label: string }]
  /** 默认 run：立即决议（不提交），供失败的 flow 使用。 */
  run?: (session: AuthorizationSession) => Promise<void>
}

/**
 * 构建一个可中途定制的测试 flow。
 * @param behaviour - flow 字段与运行器覆盖。
 * @param captures - 可选：把每次运行收到的 session 推入该数组，供断言。
 * @returns 一个 AuthorizationFlow。
 */
export function makeFlow(
  behaviour: FlowBehaviour,
  captures: AuthorizationSession[] = [],
): AuthorizationFlow {
  const opts = behaviour.methods !== undefined
    ? behaviour.methods
    : [{ id: 'oauth', label: 'Sign in' }] as const
  return {
    key: key(behaviour.key),
    label: behaviour.label ?? 'Test flow',
    methods: opts,
    run: async (session) => {
      captures.push(session)
      await behaviour.run?.(session)
    },
  }
}

/** interaction 行为描述：notify 与 prompt 的可编程处理器。 */
export interface InteractionBehaviour {
  notify?: (notice: { message: string }) => void
  prompt?: (prompt: AuthorizationPrompt) => Promise<string>
}

/** 构建一个可中途定制的测试 interaction。 */
export function makeInteraction(behaviour: InteractionBehaviour = {}): AuthorizationInteraction {
  return {
    notify: notice => { behaviour.notify?.(notice) },
    prompt: prompt => behaviour.prompt?.(prompt) ?? Promise.resolve('answer'),
  }
}

/** 已收到通知的列表（供断言 flow 的 notify 被转发）。 */
export function noticeLog(): { readonly messages: string[]; notify(notice: { message: string }): void } {
  const messages: string[] = []
  return {
    messages,
    notify: notice => { messages.push(notice.message) },
  }
}

/** 收集一次尝试的 settle 事件（key + settlement）。 */
export function settledLog() {
  const events: { readonly key: string; readonly settlement: AuthorizationSettlement }[] = []
  return {
    events,
    push: (k: CredentialKey, s: AuthorizationSettlement): void => { events.push({ key: k, settlement: s }) },
  }
}