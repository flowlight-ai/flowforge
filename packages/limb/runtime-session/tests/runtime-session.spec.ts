import { describe, expect, it } from 'vitest'
import { createCatId } from '../src/runtime-session-types.ts'
import {
  appendRuntimeIdentity,
  normalizeRuntimeSessionMetadata,
  type RuntimeSessionMetadata,
} from '../src/runtime-session-metadata.ts'
import {
  createRuntimeSessionStore,
  KeyValueRuntimeSessionStore,
  MemoryRuntimeSessionStore,
  MemoryKeyValueStore,
  type IRuntimeSessionStore,
  type RuntimeSessionRecentFilter,
} from '../src/runtime-session-store.ts'
import { MemorySessionChainStore, MemoryThreadStore } from '../src/runtime-session-ports.ts'
import {
  registerExternalRuntimeSession,
  normalizeExternalRuntimeSessionRegistration,
  ExternalRuntimeSessionRegistrationError,
  type ExternalRuntimeSessionRegistrationDeps,
} from '../src/external-runtime-session-registration.ts'
import type { CallbackPrincipal } from '../src/runtime-session-types.ts'

const NOW = 1_700_000_000_000

function baseMetadata(overrides: Partial<RuntimeSessionMetadata> = {}): RuntimeSessionMetadata {
  return {
    sessionId: 's1',
    runtime: 'antigravity-desktop',
    runtimeSessionId: 'rs1',
    threadId: 't1',
    catId: createCatId('gpt-pro'),
    userId: 'u1',
    surface: 'ide-direct',
    identityHistory: [{ catId: createCatId('gpt-pro'), model: 'gpt-5', from: NOW, source: 'session_init' }],
    lifecycle: { state: 'active', startedAt: NOW, lastObservedAt: NOW },
    ...overrides,
  }
}

const agentKeyPrincipal: CallbackPrincipal = {
  kind: 'agent_key',
  agentKeyId: 'key-1',
  userId: 'u1',
  catId: createCatId('gpt-pro'),
  scope: 'user-bound',
}

function makeDeps(): ExternalRuntimeSessionRegistrationDeps {
  return {
    sessionChainStore: new MemorySessionChainStore(),
    runtimeSessionStore: createRuntimeSessionStore(),
    threadStore: new MemoryThreadStore(),
    now: () => NOW,
  }
}

function registrationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runtime: 'antigravity-desktop',
    runtimeSessionId: 'rs-1',
    runtimeConversationId: 'rc-1',
    catId: 'gpt-pro',
    model: 'gpt-5',
    title: 'Ide direct session',
    startedAt: NOW,
    lastObservedAt: NOW,
    ...overrides,
  }
}

describe('normalizeRuntimeSessionMetadata', () => {
  it('normalizes a valid record', () => {
    const meta = normalizeRuntimeSessionMetadata(baseMetadata())
    expect(meta.sessionId).toBe('s1')
    expect(meta.lifecycle.state).toBe('active')
    expect(meta.identityHistory).toHaveLength(1)
  })

  it('normalizes missing optional identityHistory to []', () => {
    const meta = normalizeRuntimeSessionMetadata({ ...baseMetadata(), identityHistory: undefined })
    expect(meta.identityHistory).toEqual([])
  })

  it('auto-orders lastObservedAt >= startedAt', () => {
    const meta = normalizeRuntimeSessionMetadata({
      ...baseMetadata(),
      lifecycle: { state: 'active', startedAt: NOW + 1000, lastObservedAt: NOW },
    })
    expect(meta.lifecycle.lastObservedAt).toBeGreaterThanOrEqual(meta.lifecycle.startedAt)
  })

  it('throws on invalid lifecycle state', () => {
    expect(() =>
      normalizeRuntimeSessionMetadata({
        ...baseMetadata(),
        lifecycle: { state: 'bogus', startedAt: NOW, lastObservedAt: NOW },
      }),
    ).toThrow()
  })
})

describe('appendRuntimeIdentity', () => {
  it('closes the previous segment when a new one starts', () => {
    const meta = baseMetadata()
    const next = appendRuntimeIdentity(meta, {
      catId: createCatId('gpt-pro'),
      model: 'gpt-5.1',
      from: NOW + 1000,
      source: 'trajectory',
    })
    expect(next.identityHistory).toHaveLength(2)
    expect(next.identityHistory[0]?.to).toBe(NOW + 1000)
    expect(next.lifecycle.lastObservedAt).toBeGreaterThanOrEqual(NOW + 1000)
  })

  it('throws on overlapping segment', () => {
    const withPastTo = baseMetadata({
      identityHistory: [{ catId: createCatId('gpt-pro'), model: 'gpt-5', from: NOW, to: NOW + 1000, source: 'session_init' }],
    })
    expect(() =>
      appendRuntimeIdentity(withPastTo, {
        catId: createCatId('gpt-pro'),
        model: 'gpt-5.1',
        from: NOW + 500,
        source: 'trajectory',
      }),
    ).toThrow()
  })
})

describe('IRuntimeSessionStore contract', () => {
  const stores: Array<{ name: string; build: () => IRuntimeSessionStore; makeFilter?: () => RuntimeSessionRecentFilter }> = [
    { name: 'MemoryRuntimeSessionStore', build: () => new MemoryRuntimeSessionStore() },
    { name: 'KeyValueRuntimeSessionStore', build: () => new KeyValueRuntimeSessionStore(new MemoryKeyValueStore()) },
  ]

  for (const storeCase of stores) {
    describe(storeCase.name, () => {
      it('upserts and retrieves by sessionId / runtime session', async () => {
        const store = storeCase.build()
        const meta = baseMetadata()
        await store.upsert(meta)
        expect((await store.getBySessionId('s1'))?.sessionId).toBe('s1')
        expect((await store.getByRuntimeSession('antigravity-desktop', 'rs1'))?.sessionId).toBe('s1')
        expect(await store.getByRuntimeSession('antigravity-desktop', 'missing')).toBeNull()
      })

      it('finds active session by thread+cat sorted by recency', async () => {
        const store = storeCase.build()
        const older = baseMetadata({ sessionId: 'old', runtimeSessionId: 'rs-old', lifecycle: { state: 'active', startedAt: NOW, lastObservedAt: NOW } })
        const newer = baseMetadata({ sessionId: 'new', runtimeSessionId: 'rs-new', lifecycle: { state: 'active', startedAt: NOW, lastObservedAt: NOW + 100 } })
        await store.upsert(older)
        await store.upsert(newer)
        expect((await store.getActiveByThreadCat('antigravity-desktop', 't1', createCatId('gpt-pro')))?.sessionId).toBe('new')
      })

      it('lists by lifecycle state', async () => {
        const store = storeCase.build()
        await store.upsert(baseMetadata())
        await store.upsert(
          baseMetadata({
            sessionId: 's2',
            lifecycle: { state: 'sealed', startedAt: NOW, lastObservedAt: NOW },
          }),
        )
        expect(await store.listByLifecycleState('active')).toHaveLength(1)
        expect((await store.listByLifecycleState('sealed')).map((r) => r.sessionId)).toContain('s2')
      })

      it('listRecent respects runtime/surface/cat filters and paging', async () => {
        const store = storeCase.build()
        for (let i = 0; i < 5; i++) {
          await store.upsert(baseMetadata({ sessionId: `r${i}`, runtimeSessionId: `rs${i}`, lifecycle: { state: 'active', startedAt: NOW, lastObservedAt: NOW + i } }))
        }
        const filtered = await store.listRecent({ runtime: 'antigravity-desktop', limit: 2, offset: 0 })
        expect(filtered).toHaveLength(2)
        expect(filtered[0]?.sessionId).toBe('r4')
      })

      it('updateLifecycle patches and returns null for unknown session', async () => {
        const store = storeCase.build()
        await store.upsert(baseMetadata())
        const updated = await store.updateLifecycle('s1', { sealReason: 'runtime_seal' })
        expect(updated?.lifecycle.sealReason).toBe('runtime_seal')
        expect(await store.updateLifecycle('nope', {})).toBeNull()
      })
    })
  }
})

describe('registerExternalRuntimeSession', () => {
  it('normalizes input and requires agent-key principal', () => {
    const input = normalizeExternalRuntimeSessionRegistration(
      registrationPayload(),
      agentKeyPrincipal,
      { now: NOW },
    )
    expect(input.catId).toBe('gpt-pro')
    expect(input.binding.mode).toBe('orphan')
    expect(input.provenance.source).toBe('antigravity-ide-direct')

    expect(() => normalizeExternalRuntimeSessionRegistration(registrationPayload(), {
      kind: 'invocation',
      invocationId: 'inv',
      threadId: 't',
      userId: 'u1',
      catId: createCatId('gpt-pro'),
    })).toThrow()
  })

  it('rejects catId that does not match principal', () => {
    const payload = registrationPayload({ catId: 'other-cat' })
    expect(() => normalizeExternalRuntimeSessionRegistration(payload, agentKeyPrincipal, { now: NOW })).toThrow()
  })

  it('creates a new external runtime session', async () => {
    const deps = makeDeps()
    const result = await registerExternalRuntimeSession(registrationPayload(), agentKeyPrincipal, deps)
    expect(result.status).toBe('created')
    expect(result.catId).toBe('gpt-pro')
    expect(result.binding.mode).toBe('orphan_anchor')
    expect(result.drilldown.sessionRecord).toMatch(/^\/api\/sessions\//)

    const stored = await deps.runtimeSessionStore.getBySessionId(result.sessionId)
    expect(stored?.lifecycle.state).toBe('active')
    expect(stored?.externalRegistration?.provenance.agentKeyId).toBe('key-1')
  })

  it('updates an existing runtime session preserving identity', async () => {
    const deps = makeDeps()
    const first = await registerExternalRuntimeSession(registrationPayload(), agentKeyPrincipal, deps)
    const second = await registerExternalRuntimeSession(
      registrationPayload({ title: 'renamed', lastObservedAt: NOW + 100 }),
      agentKeyPrincipal,
      deps,
    )
    expect(second.status).toBe('updated')
    expect(second.sessionId).toBe(first.sessionId)
    const stored = await deps.runtimeSessionStore.getBySessionId(first.sessionId)
    expect(stored?.externalRegistration?.title).toBe('renamed')
    expect(stored?.lifecycle.lastObservedAt).toBe(NOW + 100)
  })

  it('rejects re-binding to a different thread', async () => {
    const deps = makeDeps()
    // orphan binding anchors to a dedicated thread; re-registering bound to the
    // shared system thread must be rejected as immutable.
    await registerExternalRuntimeSession(registrationPayload(), agentKeyPrincipal, deps)

    await expect(
      registerExternalRuntimeSession(
        registrationPayload({ binding: { mode: 'thread', threadId: 'system' } }),
        agentKeyPrincipal,
        deps,
      ),
    ).rejects.toBeInstanceOf(ExternalRuntimeSessionRegistrationError)
  })

  it('forbids binding to a foreign thread', async () => {
    const deps = makeDeps()
    await deps.threadStore.ensureExternalRuntimeAnchorThread('antigravity-desktop', 'u2')
    await expect(
      registerExternalRuntimeSession(
        registrationPayload({ binding: { mode: 'thread', threadId: 'anchor:antigravity-desktop:u2' } }),
        agentKeyPrincipal,
        deps,
      ),
    ).rejects.toThrow(new ExternalRuntimeSessionRegistrationError('external_runtime_thread_forbidden', 403))
  })
})