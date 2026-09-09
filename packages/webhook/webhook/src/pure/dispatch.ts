/**
 * @flowforge/webhook pure dispatch — fire-and-forget 规则运行时核心。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-webhook` 的 `index.ts`（WebhookRuntime）。原
 * 实现继承 cordis `Service` 并通过 `static inject` 注入 agents /
 * agentDefaultModel / agentPresets / permissionPresets / sessionTitle /
 * workspaceRegistry；此处改为构造注入 `WebhookRuntimePorts`，规则注册、投递快照、
 * kind 匹配、后台调用生命周期、注册清理等核心编排逐字/语义等价格保，零 cordis 依赖。
 */

import { deepFreeze, snapshotJsonValue } from '../values.ts'
import { errorChain } from '../llm.ts'
import type { WebhookRuleId } from '../brand.ts'
import type { WebhookRuntimePorts } from '../ports.ts'
import type { VerifiedWebhookDelivery, WebhookRule, WebhookSessionRequest } from '../types.ts'
import { createWebhookSession } from './request.ts'

/** 公共泛型注册校验 provider kind 后的内部类型擦除。 */
interface AnyWebhookRule {
  readonly id: WebhookRuleId
  readonly kind: string
  run(
    delivery: Readonly<VerifiedWebhookDelivery>,
    signal: AbortSignal,
  ): WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}

/** 一个 effect 持有的规则注册及其正在使用的调用。 */
interface RuleRegistration {
  readonly rule: AnyWebhookRule
  readonly controller: AbortController
  readonly active: Set<Promise<void>>
  closing: boolean
  disposal?: Promise<void>
}

/** 校验并分离一次投递，再分享给任意规则。 */
function snapshotDelivery(delivery: VerifiedWebhookDelivery): VerifiedWebhookDelivery {
  if (typeof delivery.kind !== 'string' || delivery.kind.trim() === '') {
    throw new TypeError('webhook delivery kind must be a non-empty string')
  }
  if (typeof delivery.source !== 'string' || delivery.source.trim() === '') {
    throw new TypeError('webhook delivery source must be a non-empty string')
  }
  if (typeof delivery.deliveryId !== 'string' || delivery.deliveryId.trim() === '') {
    throw new TypeError('webhook delivery id must be a non-empty string')
  }
  if (!Number.isSafeInteger(delivery.receivedAt) || delivery.receivedAt < 0) {
    throw new TypeError('webhook delivery receivedAt must be a non-negative safe integer')
  }
  const snapshot = snapshotJsonValue(delivery)
  if (snapshot === undefined) throw new TypeError('webhook delivery must be lossless JSON')
  return deepFreeze(snapshot as unknown as VerifiedWebhookDelivery)
}

/**
 * Fire-and-forget 规则运行时。会话创建是唯一内置动作。
 */
export class WebhookRuntime {
  private readonly ports: WebhookRuntimePorts
  private readonly rules = new Map<WebhookRuleId, RuleRegistration>()
  private closing = false

  /** 构造一个以注入端口背书的运行时。 */
  constructor(ports: WebhookRuntimePorts) {
    this.ports = ports
  }

  /**
   * 注册一条可信程序化规则。
   * @param rule - 唯一 id、provider kind、任意回调。
   * @returns 可 await 的 effect 清理器（中止并排空该规则的活动回调）。
   */
  register<K extends string>(rule: WebhookRule<K>): () => Promise<void> {
    if (this.closing) throw new Error('webhook runtime is closing')
    if (typeof rule.id !== 'string' || rule.id.trim() === '') {
      throw new TypeError('webhook rule id must be a non-empty string')
    }
    if (typeof rule.kind !== 'string' || rule.kind.trim() === '') {
      throw new TypeError(`webhook rule "${String(rule.id)}" kind must be a non-empty string`)
    }
    if (typeof rule.run !== 'function') {
      throw new TypeError(`webhook rule "${String(rule.id)}" requires run()`)
    }
    // 公共泛型保留适配器特定类型；运行时在校验共享 provider 标签后存一条擦除回调。
    const erased = rule as unknown as AnyWebhookRule
    if (this.rules.has(rule.id)) throw new Error(`webhook rule "${rule.id}" is already registered`)
    const registration: RuleRegistration = {
      rule: erased,
      controller: new AbortController(),
      active: new Set(),
      closing: false,
    }
    this.rules.set(rule.id, registration)
    return async () => { await this.disposeRegistration(registration) }
  }

  /**
   * 启动所有当前匹配的规则，并在任何回调结算前返回。
   * @param delivery - 已认证 provider 数据；分发前先快照。
   * @throws 运行时正在关闭或投递畸形时同步抛出。
   */
  dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>): void {
    if (this.closing) throw new Error('webhook runtime is closing')
    const snapshot = snapshotDelivery(delivery)
    for (const registration of [...this.rules.values()]) {
      if (registration.closing || registration.rule.kind !== snapshot.kind) continue
      this.startInvocation(registration, snapshot)
    }
  }

  /** 待结算的当前活动调用数（供测试/观测断言用）。 */
  activeCount(): number {
    let total = 0
    for (const registration of this.rules.values()) total += registration.active.size
    return total
  }

  /** 是否已开始关闭。 */
  isClosing(): boolean {
    return this.closing
  }

  /** 关闭运行时：排空全部注册的活动调用。 */
  async dispose(): Promise<void> {
    if (this.closing) return
    this.closing = true
    await Promise.all([...this.rules.values()].map(registration => this.disposeRegistration(registration)))
  }

  /** 启动一次受控调用，并挂到注册清理链上。 */
  private startInvocation(registration: RuleRegistration, delivery: VerifiedWebhookDelivery): void {
    const tracked = Promise.resolve().then(async () => {
      registration.controller.signal.throwIfAborted()
      const request = await registration.rule.run(delivery, registration.controller.signal)
      registration.controller.signal.throwIfAborted()
      if (request !== null) {
        await createWebhookSession(
          this.ports,
          delivery,
          registration.rule.id,
          request,
          registration.controller.signal,
        )
      }
    }).catch((error: unknown) => {
      const invocation = `webhook: provider=${JSON.stringify(delivery.kind)} source=${JSON.stringify(delivery.source)} `
        + `delivery=${JSON.stringify(delivery.deliveryId)} rule=${JSON.stringify(registration.rule.id)}`
      if (registration.controller.signal.aborted) {
        this.ports.logger.debug(`${invocation} stopped after disposal: ${errorChain(error)}`)
      } else {
        this.ports.logger.warn(`${invocation} failed: ${errorChain(error)}`)
      }
    }).finally(() => {
      registration.active.delete(tracked)
    })
    registration.active.add(tracked)
  }

  /** 记忆化注册清理：卸载→中止→排空。 */
  private disposeRegistration(registration: RuleRegistration): Promise<void> {
    registration.disposal ??= (async () => {
      registration.closing = true
      this.rules.delete(registration.rule.id)
      registration.controller.abort(new Error(`webhook rule "${registration.rule.id}" was disposed`))
      while (registration.active.size > 0) {
        await Promise.allSettled([...registration.active])
      }
    })()
    return registration.disposal
  }
}