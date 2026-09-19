import { describe, expect, it } from 'vitest';
import {
  assembleMcpSeverToolsets,
  buildCanonicalToolRegistryForPort,
  TOOLSET_GROUP_ANCHOR,
} from '../../src/toolsets/assemble.js';
import type { CallbackTransportPort } from '../../src/toolsets/callback-transport.js';

function fixturePort() {
  const calls: unknown[] = [];
  const port: CallbackTransportPort = {
    id: 'fixture',
    send: async (req) => {
      calls.push(req);
      return { content: [{ type: 'text', text: JSON.stringify(req) }] };
    },
  };
  return { port, calls };
}

describe('toolsets/canonical-tool-sources', () => {
  it('matches the catalog size anchor for the migrated families', () => {
    const { port } = fixturePort();
    const sources = assembleMcpSeverToolsets(port);
    for (const family of ['collab', 'memory', 'signals', 'limb'] as const) {
      const expected = Object.values(TOOLSET_GROUP_ANCHOR[family]).reduce((a: number, b: number) => a + b, 0);
      expect(sources[family].length, `${family} catalog size`).toBe(expected);
    }
  });

  it('builds a validated canonical registry with unique ordered tool names', () => {
    const { port } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const names = registry.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    const expected = (['collab', 'memory', 'signals', 'limb'] as const)
      .map((family) => Object.values(TOOLSET_GROUP_ANCHOR[family]).reduce((a: number, b: number) => a + b, 0))
      .reduce((a: number, b: number) => a + b, 0);
    expect(registry.length).toBe(expected);
    expect(registry.every((d) => d.actionInventory.length > 0)).toBe(true);
  });

  it('routes a collab tool onto the injected port via the canonical registry handler', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_read_entrusted_work');
    expect(tool).toBeDefined();
    const result = (await tool!.handler({ taskId: 't1' } as never)) as { content: { text: string }[] };
    expect(result.content[0]!.text).toBe(JSON.stringify(calls[0]));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/callbacks/read-entrusted-work', body: { taskId: 't1' } });
  });

  it('substitutes ${programId} path templates before forwarding', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_advance_evolution_program_change');
    expect(tool).toBeDefined();
    await tool!.handler({
      programId: 'evolution-program:deadbeef000000000000000000000000',
      expectedSequence: 1,
      clientMessageId: 'c-1',
      action: { kind: 'sync' },
    } as never);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/callbacks/evolution-programs/${encodeURIComponent('evolution-program:deadbeef000000000000000000000000')}/changes`,
      body: { expectedSequence: 1, clientMessageId: 'c-1', action: { kind: 'sync' } },
    });
  });
});