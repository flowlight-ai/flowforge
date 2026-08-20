/**
 * @flowforge/chat-misc — chat misc domain（tasks/memory/publish/signals/marketplace）
 * Cordis 插件（阶段5 批次7，T5.7/T5.8）。
 *
 * Mounts 五个服务（全部移植 clowder-ai `api/src/routes/*` 路由语义，R13
 * 一切皆插件改造，依赖全部经 ctx 注入）：
 * - `ctx.chatTasks` — T5.7.1 任务服务（create/list/get/update/delete +
 *   PR wait cancel；clowder routes/tasks.ts）
 * - `ctx.chatMemory` — T5.7.2 thread KV 记忆（所有权守卫；clowder
 *   routes/memory.ts）
 * - `ctx.chatMemoryPublish` — T5.7.2 记忆发布门禁状态机（clowder
 *   routes/memory-publish.ts）
 * - `ctx.chatSignals` — T5.7.3 signal-hunter（inbox/search/stats/sources/
 *   fetch-enrich-backfill 缝；clowder routes/signals.ts）
 * - `ctx.chatMarketplace` — T5.8.1 多生态 marketplace（clowder
 *   routes/marketplace.ts + marketplace/*）
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-stores'       # mounts tasks()/threads()/threadMemories()/
 *                                        # memoryGovernance()/signalArticles()
 * - name: '@flowforge/cats-orchestration' # mounts catsAudit (best-effort audit)
 * - name: '@flowforge/chat-realtime'     # mounts broadcastToRoom (best-effort)
 * - name: '@flowforge/chat-misc'
 * ```
 *
 * @module @flowforge/chat-misc
 */

import type { Context } from '@flowforge/cordis'
import { ChatTaskService } from './task-service.ts'
import { ChatMemoryService } from './memory-service.ts'
import { ChatMemoryPublishService } from './memory-publish-service.ts'
import { ChatSignalService } from './signal-service.ts'
import { ChatMarketplaceService } from './marketplace-service.ts'

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat 任务服务（T5.7.1）— mounted by `@flowforge/chat-misc`. */
    chatTasks: ChatTaskService
    /** Chat thread KV 记忆服务（F3-lite，T5.7.2）— mounted by `@flowforge/chat-misc`. */
    chatMemory: ChatMemoryService
    /** 记忆发布门禁服务（T5.7.2）— mounted by `@flowforge/chat-misc`. */
    chatMemoryPublish: ChatMemoryPublishService
    /** Signal-hunter 服务（T5.7.3）— mounted by `@flowforge/chat-misc`. */
    chatSignals: ChatSignalService
    /** Marketplace 服务（T5.8.1）— mounted by `@flowforge/chat-misc`. */
    chatMarketplace: ChatMarketplaceService
  }
}

export { ChatTaskError, ChatTaskErrorCode, ChatTaskService } from './task-service.ts'
export type { ChatTaskServiceOptions, ChatTaskWaitLifecycle, CreateChatTaskInput, UpdateChatTaskInput } from './task-service.ts'

export { ChatMemoryError, ChatMemoryErrorCode, ChatMemoryService } from './memory-service.ts'
export type { ChatMemoryServiceOptions, WriteChatMemoryInput } from './memory-service.ts'

export { ChatMemoryPublishError, ChatMemoryPublishErrorCode, ChatMemoryPublishService } from './memory-publish-service.ts'
export type { PublishChatMemoryInput, PublishChatMemoryResult } from './memory-publish-service.ts'

export { ChatSignalService } from './signal-service.ts'
export type { ChatSignalServiceOptions, SignalEnrichResult, SignalFetchSummary, SignalSourceStore } from './signal-service.ts'

export {
  SignalArticleQueryService,
  computeSignalArticleStats,
} from './signal-query.ts'
export type {
  ListInboxOptions,
  SearchSignalArticlesOptions,
  SignalArticleStats,
  StudyMetaEnricher,
  UpdateSignalArticleInput,
} from './signal-query.ts'

export { ChatMarketplaceError, ChatMarketplaceErrorCode, ChatMarketplaceService } from './marketplace-service.ts'
export type { ChatMarketplaceAdaptersOptions, ChatMarketplaceServiceOptions } from './marketplace-service.ts'

export { AdapterRegistry, createAdapterRegistry, toMcpInstallRequest, validateInstallPlan } from './marketplace/index.ts'
export type { CreateRegistryOptions } from './marketplace/index.ts'
export {
  loadAntigravityCatalog,
  loadClaudeCatalog,
  loadCodexCatalog,
  loadOpenClawCatalog,
} from './marketplace/catalog-loaders.ts'
export type { AntigravityCatalogEntry } from './marketplace/adapters/antigravity-adapter.ts'
export type { ClaudeCatalogEntry } from './marketplace/adapters/claude-adapter.ts'
export type { CodexCatalogEntry } from './marketplace/adapters/codex-adapter.ts'
export type { OpenClawCatalogEntry } from './marketplace/adapters/openclaw-adapter.ts'

export default function Plugin(ctx: Context) {
  ctx.plugin(ChatTaskService)
  ctx.plugin(ChatMemoryService)
  ctx.plugin(ChatMemoryPublishService)
  ctx.plugin(ChatSignalService)
  ctx.plugin(ChatMarketplaceService)
}
