/**
 * AdapterRegistry — 多生态 marketplace adapter 注册表（T5.8.1）。
 *
 * 移植 clowder-ai `marketplace/adapter-registry.ts`（R13 一切皆插件改造：
 * 纯依赖注入，无模块级状态）。聚合 search（全生态并发 + 信任级别/工件
 * 类型过滤 + limit），buildInstallPlan 补全 direct_mcp 的 ecosystem。
 *
 * @module @flowforge/chat-misc/marketplace
 */

import type {
  InstallPlan,
  MarketplaceAdapter,
  MarketplaceEcosystem,
  MarketplaceSearchQuery,
  MarketplaceSearchResult,
} from '@flowforge/cats-shared'

export class AdapterRegistry {
  private readonly adapters = new Map<string, MarketplaceAdapter>()

  register(adapter: MarketplaceAdapter): void {
    this.adapters.set(adapter.ecosystem, adapter)
  }

  get(ecosystem: string): MarketplaceAdapter | undefined {
    return this.adapters.get(ecosystem)
  }

  /** 已注册的 ecosystem 全集。 */
  listEcosystems(): MarketplaceEcosystem[] {
    return [...this.adapters.keys()] as MarketplaceEcosystem[]
  }

  async search(query: MarketplaceSearchQuery): Promise<MarketplaceSearchResult[]> {
    const targetAdapters = query.ecosystems
      ? [...this.adapters.values()].filter((a) => query.ecosystems!.includes(a.ecosystem))
      : [...this.adapters.values()]

    const settled = await Promise.allSettled(targetAdapters.map((a) => a.search(query)))

    let results: MarketplaceSearchResult[] = []
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(...result.value)
      }
    }

    if (query.trustLevels?.length) {
      results = results.filter((r) => query.trustLevels!.includes(r.trustLevel))
    }
    if (query.artifactKinds?.length) {
      results = results.filter((r) => query.artifactKinds!.includes(r.artifactKind))
    }
    if (query.limit && query.limit > 0 && results.length > query.limit) {
      results = results.slice(0, query.limit)
    }

    return results
  }

  async buildInstallPlan(ecosystem: string, artifactId: string): Promise<InstallPlan> {
    const adapter = this.adapters.get(ecosystem)
    if (!adapter) throw new Error(`No adapter for ecosystem: ${ecosystem}`)
    const plan = await adapter.buildInstallPlan(artifactId)
    if (plan.mode === 'direct_mcp' && plan.mcpEntry && !plan.mcpEntry.ecosystem) {
      plan.mcpEntry.ecosystem = ecosystem as MarketplaceEcosystem
    }
    return plan
  }
}
