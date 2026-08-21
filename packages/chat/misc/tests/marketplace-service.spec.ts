/**
 * ChatMarketplaceService — T5.8.1 marketplace 服务契约验证（阶段5 批次7）。
 *
 * 覆盖（对齐 clowder-ai `routes/marketplace.ts` + `marketplace/*` 语义）：
 * - search：query 匹配 name/description/id + ecosystems/trustLevels/
 *   artifactKinds 过滤 + limit
 * - buildInstallPlan：各模式（claude direct_mcp / codex direct_mcp +
 *   delegated_cli / openclaw manual / antigravity manual_ui）+ 404 无工件 /
 *   400 无 adapter
 * - validateInstallPlan 纯函数（各 mode 缺字段）
 * - toMcpInstallRequest：direct_mcp 成功 + 非 direct_mcp 400
 * - listEcosystems：默认 4 生态
 *
 * @module @flowforge/chat-misc/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { ChatMarketplaceError, ChatMarketplaceErrorCode, ChatMarketplaceService } from '../src/index.ts'

interface Harness {
  ctx: Context
  marketplace: ChatMarketplaceService
}

function harness(overrides: ConstructorParameters<typeof ChatMarketplaceService>[1] = {}): Harness {
  const ctx = new Context()
  const marketplace = new ChatMarketplaceService(ctx, overrides)
  return { ctx, marketplace }
}

/** 内存目录装配（不依赖 catalog-data 文件）。 */
function memoryAdapters() {
  return {
    claude: {
      catalogLoader: async () => [
        {
          id: 'claude-official',
          name: 'Claude Official MCP',
          description: '官方工具',
          command: 'npx',
          args: ['-y', '@anthropic/official'],
          trustLevel: 'official' as const,
          publisher: 'anthropic',
          versionRef: 'v1',
        },
        {
          id: 'claude-community',
          name: 'Community Server',
          description: '社区贡献',
          trustLevel: 'community' as const,
          publisher: 'someone',
        },
      ],
    },
    codex: {
      catalogLoader: async () => [
        {
          id: 'codex-mcp',
          name: 'Codex MCP Server',
          description: '代码执行',
          kind: 'mcp_server' as const,
          command: 'codex-mcp',
          trustLevel: 'verified' as const,
          publisher: 'openai',
        },
        {
          id: 'codex-plugin',
          name: 'Codex Plugin',
          description: '插件安装',
          kind: 'plugin' as const,
          cliInstallCommand: 'codex install plugin',
          trustLevel: 'verified' as const,
          publisher: 'openai',
        },
      ],
    },
    openclaw: {
      catalogLoader: async () => [
        {
          id: 'clawhub-skill',
          name: 'ClawHub Skill',
          description: '技能包',
          clawType: 'skill' as const,
          trustLevel: 'community' as const,
          publisher: 'clawhub',
        },
      ],
    },
    antigravity: {
      catalogLoader: async () => [
        {
          id: 'anti-ext',
          name: 'Antigravity Extension',
          description: '扩展',
          trustLevel: 'official' as const,
          publisher: 'antigravity',
          resolver: 'antigravity:resolver',
        },
      ],
    },
  }
}

describe('ChatMarketplaceService — search', () => {
  it('searches across all ecosystems and matches name/description/id', async () => {
    const h = harness({ adapters: memoryAdapters() })
    const results = await h.marketplace.search({ query: 'mcp' })
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results.every((r) => /mcp/i.test(r.displayName) || /mcp/i.test(r.componentSummary))).toBe(true)
  })

  it('filters by ecosystems / trustLevels / artifactKinds / limit', async () => {
    const h = harness({ adapters: memoryAdapters() })

    const claudeOnly = await h.marketplace.search({ query: '', ecosystems: ['claude'] })
    expect(claudeOnly.every((r) => r.ecosystem === 'claude')).toBe(true)

    const official = await h.marketplace.search({ query: '', trustLevels: ['official'] })
    expect(official.every((r) => r.trustLevel === 'official')).toBe(true)

    const plugins = await h.marketplace.search({ query: '', artifactKinds: ['plugin'] })
    expect(plugins.every((r) => r.artifactKind === 'plugin')).toBe(true)

    const limited = await h.marketplace.search({ query: '', limit: 2 })
    expect(limited).toHaveLength(2)
  })
})

describe('ChatMarketplaceService — buildInstallPlan', () => {
  it('builds direct_mcp plan and backfills ecosystem', async () => {
    const h = harness({ adapters: memoryAdapters() })
    const plan = await h.marketplace.buildInstallPlan('claude', 'claude-official')
    expect(plan.mode).toBe('direct_mcp')
    expect(plan.mcpEntry?.id).toBe('claude-official')
    expect(plan.mcpEntry?.ecosystem).toBe('claude')
    expect(plan.metadata?.publisherIdentity).toBe('anthropic')
  })

  it('builds delegated_cli plan for plugin entries', async () => {
    const h = harness({ adapters: memoryAdapters() })
    const plan = await h.marketplace.buildInstallPlan('codex', 'codex-plugin')
    expect(plan.mode).toBe('delegated_cli')
    expect(plan.delegatedCommand).toBe('codex install plugin')
  })

  it('builds manual_file plan for clawhub skills', async () => {
    const h = harness({ adapters: memoryAdapters() })
    const plan = await h.marketplace.buildInstallPlan('openclaw', 'clawhub-skill')
    expect(plan.mode).toBe('manual_file')
    expect(plan.manualSteps?.length).toBeGreaterThan(0)
  })

  it('builds manual_file plan when a resolver exists', async () => {
    const h = harness({ adapters: memoryAdapters() })
    const plan = await h.marketplace.buildInstallPlan('antigravity', 'anti-ext')
    // antigravity adapter：有 resolver 的工件走 manual_file（交由能力系统检测）
    expect(plan.mode).toBe('manual_file')
    expect(plan.manualSteps?.length).toBeGreaterThan(0)
  })

  it('404 when the artifact does not exist; 400 when the ecosystem has no adapter', async () => {
    const h = harness({ adapters: memoryAdapters() })
    await expect(h.marketplace.buildInstallPlan('claude', 'nope')).rejects.toMatchObject({
      code: ChatMarketplaceErrorCode.ARTIFACT_NOT_FOUND,
      status: 404,
    })
    await expect(h.marketplace.buildInstallPlan('unknown-eco', 'x')).rejects.toMatchObject({
      code: ChatMarketplaceErrorCode.NO_ADAPTER,
      status: 400,
    })
  })
})

describe('ChatMarketplaceService — validate / bridge', () => {
  it('validates install plans by mode', async () => {
    const h = harness({ adapters: memoryAdapters() })
    const plan = await h.marketplace.buildInstallPlan('claude', 'claude-official')
    expect(h.marketplace.validateInstallPlan(plan)).toEqual([])

    expect(h.marketplace.validateInstallPlan({ mode: 'direct_mcp' })).toEqual([
      'direct_mcp plan requires mcpEntry',
    ])
    expect(h.marketplace.validateInstallPlan({ mode: 'delegated_cli' })).toEqual([
      'delegated_cli plan requires delegatedCommand',
    ])
    expect(h.marketplace.validateInstallPlan({ mode: 'manual_ui' })).toEqual([
      'manual_ui plan requires manualSteps',
    ])
  })

  it('converts direct_mcp plans to McpInstallRequest and rejects others', async () => {
    const h = harness({ adapters: memoryAdapters() })
    const plan = await h.marketplace.buildInstallPlan('claude', 'claude-official')
    const request = h.marketplace.toMcpInstallRequest(plan)
    expect(request).toMatchObject({ id: 'claude-official', command: 'npx', ecosystem: 'claude' })

    expect(() => h.marketplace.toMcpInstallRequest({ mode: 'manual_ui', manualSteps: ['x'] })).toThrow(
      ChatMarketplaceError,
    )
    try {
      h.marketplace.toMcpInstallRequest({ mode: 'manual_ui', manualSteps: ['x'] })
    } catch (err) {
      expect(err).toMatchObject({ code: ChatMarketplaceErrorCode.NOT_DIRECT_MCP, status: 400 })
    }
  })

  it('lists registered ecosystems (default 4)', async () => {
    const h = harness()
    expect(h.marketplace.listEcosystems().sort()).toEqual(['antigravity', 'claude', 'codex', 'openclaw'])
  })

  it('exposes typed error class', () => {
    const err = new ChatMarketplaceError(ChatMarketplaceErrorCode.NO_ADAPTER, 'nope', 400)
    expect(err.name).toBe('ChatMarketplaceError')
    expect(err.status).toBe(400)
  })
})
