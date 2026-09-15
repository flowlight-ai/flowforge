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

describe('toolsets/collab-B3', () => {
  it('collab total matches the sum of TOOLSET_GROUP_ANCHOR.collab', () => {
    const { port } = fixturePort();
    const sources = assembleMcpSeverToolsets(port);
    const expected = Object.values(TOOLSET_GROUP_ANCHOR.collab).reduce((a, b) => a + b, 0);
    expect(sources.collab.length).toBe(expected);
  });

  it('builds a validated canonical registry with unique ordered names', () => {
    const { port } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const names = registry.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    const expected = Object.values(TOOLSET_GROUP_ANCHOR.collab).reduce((a, b) => a + b, 0);
    expect(registry.length).toBe(expected);
    expect(registry.every((d) => d.actionInventory.length > 0)).toBe(true);
  });

  it('routes cat_cafe_validate_community_route (POST + template path + body)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_validate_community_route');
    expect(tool).toBeDefined();
    await tool!.handler({ issueId: 'case-42', decision: 'accept', reason: 'verified custody' });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/community-issues/${encodeURIComponent('case-42')}/validate-route`,
      body: { decision: 'accept', reason: 'verified custody' },
    });
  });

  it('routes cat_cafe_list_events (GET + query params)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_list_events');
    expect(tool).toBeDefined();
    await tool!.handler({ cat: 'cat-miao', limit: 12 });
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/api/memory/events',
      params: { cat: 'cat-miao', limit: '12' },
    });
  });

  it('routes cat_cafe_submit_game_action (POST + template path + full body)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_submit_game_action');
    expect(tool).toBeDefined();
    await tool!.handler({
      gameId: 'game-1',
      round: 2,
      phase: 'day_vote',
      seat: 3,
      action: 'vote',
      target: 5,
      nonce: 'n-1',
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/game/${encodeURIComponent('game-1')}/action`,
      body: { round: 2, phase: 'day_vote', seat: 3, action: 'vote', target: 5, nonce: 'n-1' },
    });
  });
});