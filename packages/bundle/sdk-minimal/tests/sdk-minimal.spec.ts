/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@flowforge/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('@flowforge/sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      flowforge?: { bundle?: { patch?: string } }
    }
    expect(manifest.flowforge?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.flowforge!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@flowforge/sdk-app'],
      ['sdk-jsonrpc-server', '@flowforge/sdk-jsonrpc-server'],
      ['llm-deepseek', '@flowforge/llm-deepseek'],
      ['sandbox', '@flowforge/sandbox-local'],
      ['session-projection', '@flowforge/session-projection'],
      ['sandbox-policy', '@flowforge/sandbox-policy'],
      ['subprocess', '@flowforge/subprocess-local'],
      ['pty', '@flowforge/terminal'],
      ['terminal-bash', '@flowforge/terminal-bash'],
      ['fs-local', '@flowforge/fs-local'],
      ['timer', '@flowforge/cordis-plugin-timer'],
      ['llm', '@flowforge/llm'],
      ['session', '@flowforge/session'],
      ['session-title', '@flowforge/session-title'],
      ['system-prompt', '@flowforge/system-prompt'],
      ['tools', '@flowforge/tools'],
      ['agent', '@flowforge/agent'],
      ['llm-retry', '@flowforge/llm-retry'],
      ['jobs', '@flowforge/jobs-local'],
      ['invariants', '@flowforge/invariants'],
      ['session-invariant', '@flowforge/session/invariant'],
      ['agent-invariant', '@flowforge/agent/invariant'],
      ['scope-invariant', '@flowforge/scope/invariant'],
      ['agent-loop-invariant', '@flowforge/agent-loop/invariant'],
      ['agent-loop', '@flowforge/agent-loop'],
      ['persistent-bash', '@flowforge/tool-bash'],
      ['str-replace-editor', '@flowforge/tool-str-replace-editor'],
      ['sessions', '@flowforge/session-persistence-jsonl'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.FF_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: { __jsExpr: "process.env.FF_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})