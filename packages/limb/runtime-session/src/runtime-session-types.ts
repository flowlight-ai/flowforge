/**
 * @flowforge/limb-runtime-session — 本地内联共享类型（源 clowder-ai `@cat-cafe/shared` 子集）。
 * Limb 运行时会话域（F211）。
 */

declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

export type CatId = Brand<string, 'CatId'>

export function createCatId(id: string): CatId {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid cat ID: must be non-empty string')
  }
  return id as CatId
}

export type CallbackPrincipal =
  | {
      kind: 'invocation'
      invocationId: string
      parentInvocationId?: string
      threadId: string
      userId: string
      catId: CatId
    }
  | {
      kind: 'agent_key'
      agentKeyId: string
      userId: string
      catId: CatId
      scope: 'user-bound'
    }

/**
 * 小型 Cat 注册表（替代 clowder-ai 模块级 catRegistry singleton）。
 * 默认包含 gpt-pro（云端桥接目标），测试/宿主可调用 register() 注册更多。
 */
const registry = new Set<string>(['gpt-pro'])

export function registerCat(catId: string): void {
  registry.add(catId)
}

export function resetCats(): void {
  registry.clear()
  registry.add('gpt-pro')
}

export function isKnownCat(catId: string): boolean {
  return registry.has(catId)
}