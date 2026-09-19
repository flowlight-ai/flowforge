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

function anchorSums() {
  const collab = Object.values(TOOLSET_GROUP_ANCHOR.collab).reduce((a: number, b: number) => a + b, 0);
  const memory = Object.values(TOOLSET_GROUP_ANCHOR.memory).reduce((a: number, b: number) => a + b, 0);
  const signals = Object.values(TOOLSET_GROUP_ANCHOR.signals).reduce((a: number, b: number) => a + b, 0);
  const limb = Object.values(TOOLSET_GROUP_ANCHOR.limb).reduce((a: number, b: number) => a + b, 0);
  return { collab, memory, signals, limb, total: collab + memory + signals + limb };
}

describe('toolsets/signals-limb-B6', () => {
  it('four families (collab/memory/signals/limb) each match the sum of TOOLSET_GROUP_ANCHOR', () => {
    const { port } = fixturePort();
    const sources = assembleMcpSeverToolsets(port);
    const expected = anchorSums();
    expect(sources.collab.length).toBe(expected.collab);
    expect(sources.memory.length).toBe(expected.memory);
    expect(sources.signals.length).toBe(expected.signals);
    expect(sources.limb.length).toBe(expected.limb);
  });

  it('registers a unique, name-sorted canonical registry spanning all four families', () => {
    const { port } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const names = registry.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    expect(registry.length).toBe(anchorSums().total);
    expect(registry.every((d) => d.actionInventory.length > 0)).toBe(true);
  });

  it('routes signal_get_article (GET with ${id} path template)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'signal_get_article');
    expect(tool).toBeDefined();
    await tool!.handler({ id: 'art-42' } as never);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: `/api/signals/articles/${encodeURIComponent('art-42')}`,
    });
  });

  it('routes limb_list_tools (POST + body from inputs, no agent-key leak into body)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'limb_list_tools');
    expect(tool).toBeDefined();
    await tool!.handler({ nodeId: 'weixin-mp', command: 'weixin_mp.create_draft', agentKeyCatId: 'antig-opus' } as never);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/callback/limb/list-tools',
      body: { nodeId: 'weixin-mp', command: 'weixin_mp.create_draft' },
      agentKeyCatId: 'antig-opus',
    });
    // agentKeyCatId must surface at the transport level, never inside the POST body.
    expect(calls[0] as { body?: Record<string, unknown> }).not.toHaveProperty('body.agentKeyCatId');
  });

  it('routes signal_mark_read (PATCH downgraded to POST with ${id} path template)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'signal_mark_read');
    expect(tool).toBeDefined();
    await tool!.handler({ id: 'art-7' } as never);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/signals/articles/${encodeURIComponent('art-7')}`,
    });
  });

  it('routes signal_search (GET + params) with an openWorld read annotation', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'signal_search');
    expect(tool).toBeDefined();
    await tool!.handler({ query: 'redis', limit: 10, status: 'inbox' } as never);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/api/signals/search',
      params: { query: 'redis', limit: '10', status: 'inbox' },
    });
    // openWorld hint is carried on the governance certificate / effective risk.
    expect(tool!.annotations?.openWorldHint).toBe(true);
  });
});