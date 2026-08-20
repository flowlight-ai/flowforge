/**
 * marketplace 装配 — createAdapterRegistry（T5.8.1）。
 *
 * 移植 clowder-ai `marketplace/index.ts`（R13 一切皆插件改造：
 * 各生态 adapter 经选项装配，缺省 4 生态全部注册）。
 *
 * @module @flowforge/chat-misc/marketplace
 */

import { AdapterRegistry } from './adapter-registry.ts'
import type { AntigravityAdapterOptions } from './adapters/antigravity-adapter.ts'
import { AntigravityMarketplaceAdapter } from './adapters/antigravity-adapter.ts'
import type { ClaudeAdapterOptions } from './adapters/claude-adapter.ts'
import { ClaudeMarketplaceAdapter } from './adapters/claude-adapter.ts'
import type { CodexAdapterOptions } from './adapters/codex-adapter.ts'
import { CodexMarketplaceAdapter } from './adapters/codex-adapter.ts'
import type { OpenClawAdapterOptions } from './adapters/openclaw-adapter.ts'
import { OpenClawMarketplaceAdapter } from './adapters/openclaw-adapter.ts'

export interface CreateRegistryOptions {
  claude?: ClaudeAdapterOptions
  codex?: CodexAdapterOptions
  openclaw?: OpenClawAdapterOptions
  antigravity?: AntigravityAdapterOptions
}

export function createAdapterRegistry(options: CreateRegistryOptions): AdapterRegistry {
  const registry = new AdapterRegistry()

  if (options.claude) registry.register(new ClaudeMarketplaceAdapter(options.claude))
  if (options.codex) registry.register(new CodexMarketplaceAdapter(options.codex))
  if (options.openclaw) registry.register(new OpenClawMarketplaceAdapter(options.openclaw))
  if (options.antigravity) {
    registry.register(new AntigravityMarketplaceAdapter(options.antigravity))
  }

  return registry
}

export { AdapterRegistry } from './adapter-registry.ts'
export { toMcpInstallRequest, validateInstallPlan } from './install-plan-bridge.ts'
export { loadClaudeCatalog, loadCodexCatalog, loadOpenClawCatalog, loadAntigravityCatalog } from './catalog-loaders.ts'
