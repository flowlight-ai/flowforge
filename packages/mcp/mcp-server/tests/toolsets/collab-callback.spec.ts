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

describe('toolsets/collab-callback', () => {
  it('collab total matches the sum of TOOLSET_GROUP_ANCHOR.collab', () => {
    const { port } = fixturePort();
    const sources = assembleMcpSeverToolsets(port);
    const expected = Object.values(TOOLSET_GROUP_ANCHOR.collab).reduce((a: number, b: number) => a + b, 0);
    expect(sources.collab.length).toBe(expected);
  });

  it('registers exactly 49 callback tools under unique ordered names', () => {
    const { port } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const names = registry.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    const expected = ['collab', 'memory', 'signals', 'limb']
      .map((family) => Object.values(TOOLSET_GROUP_ANCHOR[family as keyof typeof TOOLSET_GROUP_ANCHOR]).reduce((a: number, b: number) => a + b, 0))
      .reduce((a: number, b: number) => a + b, 0);
    // Only collab + memory use the `cat_cafe_` prefix; signals + limb keep bare names.
    const catCafeExpected =
      Object.values(TOOLSET_GROUP_ANCHOR.collab).reduce((a: number, b: number) => a + b, 0) +
      Object.values(TOOLSET_GROUP_ANCHOR.memory).reduce((a: number, b: number) => a + b, 0);
    expect(registry.length).toBe(expected);
    expect(registry.filter((d) => d.name.startsWith('cat_cafe_')).length).toBe(catCafeExpected);
    expect(registry.every((d) => d.actionInventory.length > 0)).toBe(true);
  });

  it('routes cat_cafe_community_guardian_signoff (POST + ${caseId} template path + body)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_community_guardian_signoff');
    expect(tool).toBeDefined();
    await tool!.handler({
      caseId: 'case-7',
      signoffToken: 'tok-1',
      checklist: ['vision', 'tests'],
      approved: true,
      reason: 'verified',
    } as never);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/community-issues/${encodeURIComponent('case-7')}/guardian-signoff`,
      body: { signoffToken: 'tok-1', checklist: ['vision', 'tests'], approved: true, reason: 'verified' },
    });
  });

  it('routes cat_cafe_get_message (GET + query params)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_get_message');
    expect(tool).toBeDefined();
    await tool!.handler({ messageId: 'msg-9', contextCount: 5, mode: 'full' } as never);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/api/callbacks/get-message',
      params: { messageId: 'msg-9', contextCount: '5', mode: 'full' },
    });
  });

  it('routes cat_cafe_update_task (POST + body, no agent-key leak)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_update_task');
    expect(tool).toBeDefined();
    await tool!.handler({ taskId: 'task-3', status: 'in_progress', why: 'picked up' } as never);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/callbacks/update-task',
      body: { taskId: 'task-3', status: 'in_progress', why: 'picked up' },
    });
    expect(calls[0]).not.toHaveProperty('agentKeyCatId');
  });
});