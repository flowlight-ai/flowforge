/**
 * @flowforge/webhook pure invariant — webhook 来源提示准入的关系不变量。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-webhook` 的 `invariant.ts`（webhook-invariant
 * 伴生插件）。原实现监听 cordis `internal/dispatch` 中的 `session/event`
 * `agent/inbox/spliced`，校验 webhook 来源消息已属于其 cwd Workspace，并通过
 * `ctx.workspaceRegistry.list()` 判定归属。此处将判定政策提取为纯函数
 * `evaluateWebhookInboxPlacement`，归属来源改为注入的 `ownersOf` 提供者，
 * 装配件基于 `InvariantRegistryPort` 端口安装，零 cordis 依赖。
 */

import type { InvariantInstaller, InvariantRegistryPort } from '../ports.ts'

/** 一次提示准入的事件契型（`agent/inbox/spliced` 的窄视图）。 */
export interface SplicedInboxEvent {
  readonly type: 'agent/inbox/spliced'
  readonly data: { readonly inserted: readonly { readonly source: { readonly kind: string } }[] }
}

/** workspace 持有事实（用于判定归属）。 */
export interface WorkspaceOwnerFact {
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** 会话的窄视图（供制作失败消息）。 */
export interface InvariantSessionView {
  readonly id: string
  readonly header: { readonly cwd?: string }
}

/**
 * 校验一次 webhook 来源消息已属于其 cwd Workspace。
 * @param session - 被插入消息的 Session。
 * @param owners - 当前持有该 Session 的工作区集合。
 * @returns 失败描述；归属合法时为 `undefined`。
 */
export function evaluateWebhookInboxPlacement(
  session: InvariantSessionView,
  owners: readonly WorkspaceOwnerFact[],
): string | undefined {
  const cwd = session.header.cwd
  if (cwd === undefined) return `webhook Session "${session.id}" has no cwd`
  if (owners.length !== 1) {
    return `webhook Session "${session.id}" belongs to ${owners.length} Workspaces at prompt admission`
  }
  const owner = owners[0]
  if (owner !== undefined && owner.path !== cwd) {
    return `webhook Session "${session.id}" cwd ${JSON.stringify(cwd)} differs from its Workspace path`
  }
  return undefined
}

/** 该不变量注册的包名（保留伴生插件名）。 */
export const INVARIANT_PACKAGE_NAME = 'flowforge/webhook-invariant'

/** 从一次 `session/event` 中抽取 `agent/inbox/spliced` 事件里的 webhook 消息数。 */
export function extractWebhookInboxCount(event: unknown): number {
  const candidate = event as SplicedInboxEvent | undefined
  if (candidate?.type !== 'agent/inbox/spliced') return 0
  return candidate.data.inserted.filter(message => message.source.kind === 'webhook').length
}

/**
 * 通过注入端口安装本包的关系不变量。
 * @param registry - 不变量注册端口。
 * @param ownersOf - 返回持有某 Session 的 workspace 集合。
 * @returns 注册清理器。
 */
export function installWebhookInvariant(
  registry: InvariantRegistryPort,
  ownersOf: (sessionId: string) => readonly WorkspaceOwnerFact[],
): () => void {
  const installer: InvariantInstaller = (runtime, fail) => {
    runtime.on('session/event', (payload: unknown) => {
      const { session, event } = payload as { session?: InvariantSessionView; event?: unknown }
      if (session === undefined || event === undefined) return
      if (extractWebhookInboxCount(event) === 0) return
      const message = evaluateWebhookInboxPlacement(session, ownersOf(session.id))
      if (message !== undefined) fail(message)
    })
  }
  return registry.register(INVARIANT_PACKAGE_NAME, installer)
}