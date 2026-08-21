/**
 * OpenClawMarketplaceAdapter — openclaw ecosystem marketplace adapter (T5.8.1).
 *
 * Ported from clowder-ai `marketplace/adapters/openclaw-adapter.ts`
 * (R13 一切皆插件改造: catalog loader 经选项注入, 无模块级状态)。
 *
 * @module @flowforge/chat-misc/marketplace
 */

import type {
  InstallPlan,
  MarketplaceAdapter,
  MarketplaceArtifactKind,
  MarketplaceSearchQuery,
  MarketplaceSearchResult,
} from '@flowforge/cats-shared'

export interface OpenClawCatalogEntry {
  id: string
  name: string
  description: string
  clawType: 'mcp_server' | 'skill' | 'bundle'
  command?: string
  args?: string[]
  sourceBundle?: string
  cliInstallCommand?: string
  trustLevel: 'official' | 'verified' | 'community'
  publisher: string
  versionRef?: string
}

export interface OpenClawAdapterOptions {
  catalogLoader: () => Promise<OpenClawCatalogEntry[]>
}

export class OpenClawMarketplaceAdapter implements MarketplaceAdapter {
  readonly ecosystem = 'openclaw' as const
  private catalogLoader: () => Promise<OpenClawCatalogEntry[]>
  private cachedCatalog: OpenClawCatalogEntry[] | null = null

  constructor(options: OpenClawAdapterOptions) {
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
    if (!entry) throw new Error(`OpenClaw artifact "${artifactId}" not found`)

    if (entry.clawType === 'mcp_server' && entry.command) {
      return {
        mode: 'direct_mcp',
        mcpEntry: { id: entry.id, command: entry.command, ...(entry.args !== undefined ? { args: entry.args } : {}) },
        metadata: { ...(entry.versionRef ? { versionRef: entry.versionRef } : {}), publisherIdentity: entry.publisher },
      }
    }

    if (entry.cliInstallCommand) {
      return {
        mode: 'delegated_cli',
        delegatedCommand: entry.cliInstallCommand,
        metadata: { ...(entry.versionRef ? { versionRef: entry.versionRef } : {}), publisherIdentity: entry.publisher },
      }
    }

    return {
      mode: 'manual_file',
      manualSteps: [
        `Visit OpenClaw ClawHub: https://clawhub.openclaw.ai/${entry.id}`,
        `Follow the install instructions for "${entry.name}"`,
        entry.sourceBundle ? `Source bundle: ${entry.sourceBundle}` : '',
      ].filter(Boolean),
      metadata: { ...(entry.versionRef ? { versionRef: entry.versionRef } : {}), publisherIdentity: entry.publisher },
    }
  }

  private async getCatalog(): Promise<OpenClawCatalogEntry[]> {
    if (!this.cachedCatalog) {
      this.cachedCatalog = await this.catalogLoader()
    }
    return this.cachedCatalog
  }

  private toSearchResult(entry: OpenClawCatalogEntry): MarketplaceSearchResult {
    const kindMap: Record<string, MarketplaceArtifactKind> = {
      mcp_server: 'mcp_server',
      skill: 'skill',
      bundle: 'bundle',
    }
    return {
      artifactId: entry.id,
      artifactKind: kindMap[entry.clawType] ?? 'mcp_server',
      displayName: entry.name,
      ecosystem: 'openclaw',
      sourceLocator: `clawhub:${entry.id}`,
      trustLevel: entry.trustLevel,
      componentSummary: entry.description,
      ...(entry.versionRef !== undefined ? { versionRef: entry.versionRef } : {}),
      publisherIdentity: entry.publisher,
    }
  }
}
