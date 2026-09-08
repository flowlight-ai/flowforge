/**
 * @flowforge/webhook brand 包内移植 — 不透明 webhook 标识。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-webhook` 的 `brand.ts`，以及其底层 `dsh-brand`
 * 的 `Branded` 类型 / `brandString` 构造器。按任务铁律将被弃用的 `@deepseek-ai/*`
 * 引用改为包内纯类型与构造函数，不改任何语义。
 */

/** 品牌标记类型：`T` 为区分同一底层类型（string）不同领域的品牌键。 */
export type Branded<T extends string> = string & { readonly [brandBrand]: T }

declare const brandBrand: unique symbol

/**
 * 将一个字符串运行时安全地桥接为品牌字符串。
 * @param value - 任意字符串。
 * @returns 携带编译期品牌 `T` 的字符串。
 */
export function brandString<T extends string>(value: string): Branded<T> {
  return value as Branded<T>
}

/** 标识一个程序化 webhook 规则。 */
export type WebhookRuleId = Branded<'WebhookRuleId'>

/** 标识一个已配置的 webhook 适配器实例。 */
export type WebhookSourceId = Branded<'WebhookSourceId'>

/** 标识一次 provider 投递。运行时不赋予任何去重语义。 */
export type WebhookDeliveryId = Branded<'WebhookDeliveryId'>

/**
 * 品牌化一个 webhook 规则 id。
 * @param value - 非空规则标识（注册处校验）。
 * @returns 携带编译期品牌的相同字符串。
 */
export function WebhookRuleId(value: string): WebhookRuleId {
  return value as WebhookRuleId
}

/**
 * 品牌化一个已配置的 webhook source id。
 * @param value - 非空适配器实例标识（由其适配器校验）。
 * @returns 携带编译期品牌的相同字符串。
 */
export function WebhookSourceId(value: string): WebhookSourceId {
  return value as WebhookSourceId
}

/**
 * 品牌化一个 provider 投递 id。
 * @param value - 非空 provider 标识（由其适配器校验）。
 * @returns 携带编译期品牌的相同字符串。
 */
export function WebhookDeliveryId(value: string): WebhookDeliveryId {
  return value as WebhookDeliveryId
}