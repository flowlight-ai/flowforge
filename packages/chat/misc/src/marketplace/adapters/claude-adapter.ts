/**
 * ClaudeMarketplaceAdapter — claude ecosystem marketplace adapter (T5.8.1).
 *
 * Ported from clowder-ai `marketplace/adapters/claude-adapter.ts`
 * (R13 一切皆插件改造: catalog loader 经选项注入, 无模块级状态)。
 *
 * @module @flowforge/chat-misc/marketplace
 */

import type {
  InstallPlan,
  MarketplaceAdapter,
  MarketplaceSearchQuery,
  MarketplaceSearchResult,
  McpTransport,
} from '@flowforge/cats-shared'

export interface ClaudeCatalogEntry {
  id: string
  name: string
  description: string
  command?: string
  args?: string[]
  url?: string
  transport?: McpTransport
  env?: Record<string, string>
  headers?: Record<string, string>
  trustLevel: 'official' | 'verified' | 'community'
  publisher: string
  versionRef?: string
}

export interface ClaudeAdapterOptions {
  catalogLoader: () => Promise<ClaudeCatalogEntry[]>
}

export class ClaudeMarketplaceAdapter implements MarketplaceAdapter {
  readonly ecosystem = 'claude' as const
  private catalogLoader: () => Promise<ClaudeCatalogEntry[]>
  private cachedCatalog: ClaudeCatalogEntry[] | null = null

  constructor(options: ClaudeAdapterOptions) {
    this.catalogLoader = options.catalogLoader
  }

  async search(query: MarketplaceSearchQuery): Promise<MarketplaceSearchResult[]> {
    const catalog = await this.getCatalog()
    const q = query.query.toLowerCase()
    return catalog
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.id.toLowerCase().includes(q),
      )
      .map((e) => this.toSearchResult(e))
  }

  async buildInstallPlan(artifactId: string): Promise<InstallPlan> {
    const catalog = await this.getCatalog()
    const entry = catalog.find((e) => e.id === artifactId)
    if (!entry) throw new Error(`Claude artifact "${artifactId}" not found`)

    return {
      mode: 'direct_mcp',
      mcpEntry: {
        id: entry.id,
        ...(entry.command !== undefined ? { command: entry.command } : {}),
        ...(entry.args !== undefined ? { args: entry.args } : {}),
        ...(entry.url !== undefined ? { url: entry.url } : {}),
        ...(entry.transport !== undefined ? { transport: entry.transport } : {}),
        ...(entry.env !== undefined ? { env: entry.env } : {}),
        ...(entry.headers !== undefined ? { headers: entry.headers } : {}),
      },
      metadata: {
        ...(entry.versionRef !== undefined ? { versionRef: entry.versionRef } : {}),
        publisherIdentity: entry.publisher,
      },
    }
  }

  private async getCatalog(): Promise<ClaudeCatalogEntry[]> {
    if (!this.cachedCatalog) {
      this.cachedCatalog = await this.catalogLoader()
    }
    return this.cachedCatalog
  }

  private toSearchResult(entry: ClaudeCatalogEntry): MarketplaceSearchResult {
    return {
      artifactId: entry.id,
      artifactKind: 'mcp_server',
      displayName: entry.name,
      ecosystem: 'claude',
      sourceLocator: entry.url ?? `npx:${entry.args?.[1] ?? entry.command ?? ''}`,
      trustLevel: entry.trustLevel,
      componentSummary: entry.description,
      transport: entry.transport ?? 'stdio',
      ...(entry.versionRef !== undefined ? { versionRef: entry.versionRef } : {}),
      publisherIdentity: entry.publisher,
    }
  }
}
