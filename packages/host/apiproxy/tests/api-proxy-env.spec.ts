/**
 * env.summary domain: read-only env-registry projection — masking never leaks a
 * raw secret, the fail-closed editable whitelist drives `editable`, and a
 * composition without the env-registry plugin reports `internal` rather than
 * fabricating an empty catalog.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import EnvRegistryService from '@flowforge/harness-env-registry'
import UserQuestionService from '@flowforge/user-questions'
import type { RpcRequest } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import type { EnvVariableView } from '../src/api/env.ts'

let nextRpc = 1
function request(payload: {}): RpcRequest<{}> {
  return { rpcId: RpcId(`env-${String(nextRpc++)}`), payload }
}

function valueOf(response: { result: { ok: true; value: { variables: readonly EnvVariableView[]; categories: Record<string, string> } } | { ok: false } }) {
  if (!response.result.ok) throw new Error('expected successful response')
  return response.result.value
}

async function makeApi(withEnvRegistry: boolean) {
  const ctx = new Context()
  // createApiProxy registers a question provider at construction time.
  await ctx.plugin(UserQuestionService)
  if (withEnvRegistry) await ctx.plugin(EnvRegistryService)
  return createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
}

describe('env.summary', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  it('registry projection: variables + category labels', async () => {
    const api = await makeApi(true)
    const response = await api.env.summary(request({}))
    if (!response.result.ok) throw new Error('env.summary should succeed when env-registry is mounted')
    const { variables, categories } = response.result.value
    expect(variables.length).toBeGreaterThan(0)
    expect(Object.keys(categories).length).toBeGreaterThan(0)
    for (const variable of variables) {
      expect(variable.name.length).toBeGreaterThan(0)
      expect(typeof variable.category).toBe('string')
      expect(variable.currentValue === null || typeof variable.currentValue === 'string').toBe(true)
    }
  })

  it('sensitive values are masked host-side and never leak', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-leak-secret'
    const api = await makeApi(true)
    const { variables } = valueOf(await api.env.summary(request({})))

    const keyEntry = variables.find(variable => variable.name === 'ANTHROPIC_API_KEY')
    expect(keyEntry).toBeDefined()
    expect(keyEntry?.sensitive).toBe(true)
    expect(keyEntry?.editable).toBe(true) // runtimeEditable: true → fail-closed whitelist opt-in
    expect(keyEntry?.masked).toBe(true)
    expect(keyEntry?.currentValue).toBe('***')

    for (const variable of variables) {
      expect(variable.currentValue?.includes('sk-leak-secret') ?? false).toBe(false)
    }
  })

  it('editable whitelist + unset currentValue + allowedValues projection', async () => {
    const api = await makeApi(true)
    const { variables } = valueOf(await api.env.summary(request({})))

    const byName = new Map(variables.map(variable => [variable.name, variable]))
    // runtimeEditable: false → never editable
    expect(byName.get('FF_GLOBAL_CONFIG_ROOT')?.editable).toBe(false)
    // non-sensitive default-editable + unset → null
    const logLevel = byName.get('LOG_LEVEL')
    expect(logLevel?.editable).toBe(true)
    expect(logLevel?.currentValue).toBeNull()
    // allowedValues passthrough (cycle-style switch)
    const sandboxMode = byName.get('CAT_CODEX_SANDBOX_MODE')
    expect(sandboxMode?.allowedValues).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
  })

  it('composition without the env-registry plugin reports internal', async () => {
    const api = await makeApi(false)
    const response = await api.env.summary(request({}))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) {
      expect(response.result.error.code).toBe('internal')
      expect(response.result.error.message).toContain('env registry is absent')
    }
  })
})
