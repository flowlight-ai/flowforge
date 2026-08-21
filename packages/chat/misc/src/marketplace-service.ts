/**
 * ChatMarketplaceService — marketplace 服务（T5.8.1）。
 *
 * 移植 clowder-ai `routes/marketplace.ts` 的路由语义为 Cordis 服务
 * （R13 一切皆插件改造）：
 * - search：全生态并发搜索（ecosystems/trustLevels/artifactKinds/limit）
 * - buildInstallPlan：单工件安装计划（404 无工件 / 400 无 adapter /
 *   500 计划非法）
 * - validateInstallPlan / toMcpInstallRequest：install-plan-bridge 桥接
 *
 * 默认装配 4 个生态 adapter（claude/codex/openclaw/antigravity），目录
 * loader 可在选项层替换（测试/离线场景注入内存目录）。
 *
 * @module @flowforge/chat-misc
 */

import { Context, Service } from '@flowforge/cordis'
import type {
  InstallPlan,
  MarketplaceEcosystem,
  MarketplaceSearchQuery,
  MarketplaceSearchResult,
  McpInstallRequest,
} from '@flowforge/cats-shared'
import { createAdapterRegistry, toMcpInstallRequest, validateInstallPlan } from './marketplace/index.ts'
import type { AdapterRegistry } from './marketplace/index.ts'
import {
  loadAntigravityCatalog,
  loadClaudeCatalog,
  loadCodexCatalog,
  loadOpenClawCatalog,
} from './marketplace/catalog-loaders.ts'
import type { CreateRegistryOptions } from './marketplace/index.ts'

export const ChatMarketplaceErrorCode = {
  ARTIFACT_NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  NO_ADAPTER: 'NO_ADAPTER',
  INVALID_PLAN: 'INVALID_PLAN',
  NOT_DIRECT_MCP: 'NOT_DIRECT_MCP',
} as const

export class ChatMarketplaceError extends Error {
  readonly code: (typeof ChatMarketplaceErrorCode)[keyof typeof ChatMarketplaceErrorCode]
  readonly status: number
  readonly detail?: Record<string, unknown> | undefined

  constructor(
    code: (typeof ChatMarketplaceErrorCode)[keyof typeof ChatMarketplaceErrorCode],
    message: string,
    status: number,
    detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ChatMarketplaceError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** 默认生态目录装配选项（loader 可覆写）。 */
export type ChatMarketplaceAdaptersOptions = CreateRegistryOptions

/** ChatMarketplaceService 选项。 */
export interface ChatMarketplaceServiceOptions {
  /** 生态 adapter 装配（缺省 4 生态全部注册，目录 loader 默认从 catalog-data 读取）。 */
  adapters?: ChatMarketplaceAdaptersOptions
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Marketplace 服务（T5.8.1）— mounted by `@flowforge/chat-misc`. */
    chatMarketplace: ChatMarketplaceService
  }
}

/** 缺省 4 生态装配（经选项注入，无模块级状态）。 */
function defaultAdapterOptions(): ChatMarketplaceAdaptersOptions {
  return {
    claude: { catalogLoader: loadClaudeCatalog },
    codex: { catalogLoader: loadCodexCatalog },
    openclaw: { catalogLoader: loadOpenClawCatalog },
    antigravity: { catalogLoader: loadAntigravityCatalog },
  }
}

/**
 * Marketplace 服务。挂载点 `ctx.chatMarketplace`（`@flowforge/chat-misc`）。
 */
export class ChatMarketplaceService extends Service {
  private readonly registry: AdapterRegistry

  constructor(ctx: Context, options: ChatMarketplaceServiceOptions = {}) {
    super(ctx, 'chatMarketplace')
    this.registry = createAdapterRegistry(options.adapters ?? defaultAdapterOptions())
  }

  /** 搜索 marketplace（GET /api/marketplace/search 语义）。 */
  search(query: MarketplaceSearchQuery): Promise<MarketplaceSearchResult[]> {
    return this.registry.search(query)
  }

  /**
   * 构建安装计划（POST /api/marketplace/install/plan 语义）：
   * 404 无工件 / 400 无 adapter / 500 计划非法。
   */
  async buildInstallPlan(ecosystem: string, artifactId: string): Promise<InstallPlan> {
    let plan: InstallPlan
    try {
      plan = await this.registry.buildInstallPlan(ecosystem, artifactId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) {
        throw new ChatMarketplaceError(
          ChatMarketplaceErrorCode.ARTIFACT_NOT_FOUND,
          message,
          404,
          { ecosystem, artifactId },
        )
      }
      if (message.includes('No adapter')) {
        throw new ChatMarketplaceError(ChatMarketplaceErrorCode.NO_ADAPTER, message, 400, { ecosystem })
      }
      throw err
    }

    const errors = validateInstallPlan(plan)
    if (errors.length > 0) {
      throw new ChatMarketplaceError(
        ChatMarketplaceErrorCode.INVALID_PLAN,
        'Invalid install plan',
        500,
        { errors, ecosystem, artifactId },
      )
    }
    return plan
  }

  /** 校验安装计划（纯函数桥接）。 */
  validateInstallPlan(plan: InstallPlan): string[] {
    return validateInstallPlan(plan)
  }

  /** 生态列表（注册的 ecosystem 全集）。 */
  listEcosystems(): MarketplaceEcosystem[] {
    return this.registry.listEcosystems()
  }

  /** direct_mcp 计划 → MCP 安装请求（桥接）。 */
  toMcpInstallRequest(plan: InstallPlan): McpInstallRequest {
    try {
      return toMcpInstallRequest(plan)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ChatMarketplaceError(ChatMarketplaceErrorCode.NOT_DIRECT_MCP, message, 400)
    }
  }
}
