/**
 * Wire-safe 授权类型与 CredentialKey 契型。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-authorization/types.ts`（全部 wire-safe 类型）及
 * `@deepseek-ai/dsh-credentials` 的 `CredentialKey`。原本依赖 cordis/dsh-credentials
 * 的服务与密钥记载模型，按任务铁律（T9）全部改为包内自有契型：`CredentialKey`
 * 在此定义为品牌字符串（scope/name 拼合），供凭据端口与事件订阅使用。本文件
 * 零 cordis/服务导入，因此浏览器类型链可安全消费而不加载本包的 Context 增强。
 *
 * @module @flowforge/credentials-authorization/types
 */

/** 品牌标记符号：把字符串提升为不可与普通字符串直接赋值的名义类型。 */
declare const brandBrand: unique symbol

/**
 * 名义类型：以 `string & { readonly [brandBrand]?: Name }` 形状构造的字符串品牌。
 * 运行期就是普通字符串，仅在编译期约束赋值。仿照 `@flowforge/brand` 的最小等价。
 */
export type Branded<Name extends string> = string & { readonly [brandBrand]?: Name }

/**
 * 一条凭据记录的主键：名字空间（scope，通常为拥有该凭据的插件名）与记录名
 * （name）的组合。该作用域命名拥有其写入的插件；承载此 key 的 flow 声称由它负责。
 */
export type CredentialKey = Branded<'CredentialKey'>

/**
 * 构造一条 {@link CredentialKey}。
 * @param scope - 拥有该凭据的插件名。
 * @param name - 记录名。
 * @returns 拼接后的品牌字符串。
 */
export function credentialKey(scope: string, name: string): CredentialKey {
  return `${scope}/${name}` as CredentialKey
}

/** 一种 flow 获取其凭据的方式，由提供它的 flow 命名。 */
export interface AuthorizationMethod {
  /** flow 拥有的标识符，调用方选中此方法时回显。 */
  id: string
  /** 供选择器展示的用户可见标签。 */
  label: string
}

/** 运行中 flow 对外界的报告。永不携带任何秘密。 */
export interface AuthorizationNotice {
  /** 正在发生什么，或人类下一步必须做什么。 */
  message: string
  /** 人类必须打开才能继续的页面。 */
  url?: string
  /** 人类必须在该页面输入的短码。 */
  code?: string
}

/** 一个 `select` 提示所提供的一种选项。 */
export interface AuthorizationPromptOption {
  /** 选中该选项时返回的值。 */
  id: string
  /** 用户可见标签。 */
  label: string
  /** 有能力的 surface 可渲染的可选补充上下文。 */
  description?: string
}

/**
 * 一个 flow 在继续前必须被回答的问题。`secret` 与 `text` 仅展示方式不同——surface
 * 会遮罩它并阻止进入日志；`select` 以所选项的 `id` 作答。
 */
export type AuthorizationPrompt = {
  /**
   * 单独撤回这一提示，flow 继续运行。flow 把输入码与浏览器回调竞速时，
   * 在此撤回必输的那一问；整个授权则经由请求的 signal 取消。
   */
  signal?: AbortSignal
} & ({
  kind: 'text'
  message: string
  placeholder?: string
} | {
  kind: 'secret'
  message: string
  placeholder?: string
} | {
  kind: 'select'
  message: string
  options: readonly AuthorizationPromptOption[]
})

/** 一次授权尝试如何结束，按其调用者所见。 */
export type AuthorizationStatus = 'authorized' | 'cancelled'

/**
 * 一次尝试如何结束，按旁观者所见。失败对其调用者表现为抛错而非 outcome，所以
 * `failed` 只存在于这里——在事件流上，一个并未发起该尝试的观察者无法用其他
 * 方式区分一次拒绝与一次损坏。
 */
export type AuthorizationSettlement = AuthorizationStatus | 'failed'

/** 一次 `begin()` 尝试的结果。 */
export interface AuthorizationOutcome {
  /** 记录被提交并被观察后为 `authorized`；人类或调用方撤回时为 `cancelled`。 */
  status: AuthorizationStatus
}

/** 一条已注册 flow 的公开视图：它授权什么、它现在是否忙碌。 */
export interface AuthorizationEntry {
  /** 该 flow 写入的凭据记录。 */
  key: CredentialKey
  /** 正在被授权的对象——面向用户的名称。 */
  label: string
  /** 该 flow 提供的方法，最受青睐者优先。 */
  methods: readonly AuthorizationMethod[]
  /** 该 key 是否此刻有尝试在跑。 */
  inFlight: boolean
}