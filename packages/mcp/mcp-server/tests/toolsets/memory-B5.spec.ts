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
  const collab = Object.values(TOOLSET_GROUP_ANCHOR.collab).reduce((a, b) => a + b, 0);
  const memory = Object.values(TOOLSET_GROUP_ANCHOR.memory).reduce((a, b) => a + b, 0);
  const signals = Object.values(TOOLSET_GROUP_ANCHOR.signals).reduce((a, b) => a + b, 0);
  const limb = Object.values(TOOLSET_GROUP_ANCHOR.limb).reduce((a, b) => a + b, 0);
  return { collab, memory, signals, limb, total: collab + memory + signals + limb };
}

describe('toolsets/memory-B5', () => {
  it('memory total matches the sum of TOOLSET_GROUP_ANCHOR.memory', () => {
    const { port } = fixturePort();
    const sources = assembleMcpSeverToolsets(port);
    const expected = anchorSums();
    expect(sources.memory.length).toBe(expected.memory);
  });

  it('collab + memory + signals + limb total matches the four-family anchor sum', () => {
    const { port } = fixturePort();
    const sources = assembleMcpSeverToolsets(port);
    const expected = anchorSums();
    expect(sources.collab.length).toBe(expected.collab);
    expect(sources.signals.length + sources.limb.length).toBe(expected.signals + expected.limb);
    expect(
      sources.collab.length + sources.memory.length + sources.signals.length + sources.limb.length,
    ).toBe(expected.total);
  });

  it('registers 20 memory tools with unique ordered names across the whole registry', () => {
    const { port } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const names = registry.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    expect(registry.length).toBe(anchorSums().total);
    // Only collab + memory use the `cat_cafe_` prefix; signals + limb keep bare names.
    const { collab, memory } = anchorSums();
    expect(registry.filter((d) => d.name.startsWith('cat_cafe_')).length).toBe(collab + memory);
    expect(registry.every((d) => d.actionInventory.length > 0)).toBe(true);
  });

  it('routes cat_cafe_mark_generalizable (POST + ${anchor} template path + body)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_mark_generalizable');
    expect(tool).toBeDefined();
    await tool!.handler({ anchor: 'LL-029', generalizable: true });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/evidence/${encodeURIComponent('LL-029')}/generalizable`,
      body: { generalizable: true },
    });
  });

  it('routes cat_cafe_read_session_events (GET + ${sessionId} template path + query params)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_read_session_events');
    expect(tool).toBeDefined();
    await tool!.handler({ sessionId: 'sess-1', cursor: 3, limit: 50, view: 'handoff' });
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: `/api/sessions/${encodeURIComponent('sess-1')}/events`,
      params: { cursor: '3', limit: '50', view: 'handoff' },
    });
  });

  it('routes cat_cafe_read_meeting_artifact (POST + body, no agent-key leak)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_read_meeting_artifact');
    expect(tool).toBeDefined();
    await tool!.handler({
      resourceRef: 'meet-9',
      view: 'overview',
      maxChars: 1200,
      maxTokens: 300,
      threadId: 'thread-7',
      agentKeyCatId: 'ak-1',
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/callbacks/meeting-artifacts/read',
      body: { resourceRef: 'meet-9', view: 'overview', maxChars: 1200, maxTokens: 300, threadId: 'thread-7' },
      agentKeyCatId: 'ak-1',
    });
    // agentKeyCatId must surface at the transport level, never inside the POST body.
    expect(calls[0] as { body?: Record<string, unknown> }).not.toHaveProperty('body.agentKeyCatId');
  });

  it('routes cat_cafe_read_file_slice (reconciled local-operator GET + params)', async () => {
    const { port, calls } = fixturePort();
    const registry = buildCanonicalToolRegistryForPort(port);
    const tool = registry.find((d) => d.name === 'cat_cafe_read_file_slice');
    expect(tool).toBeDefined();
    await tool!.handler({ path: '/repo/docs/F186.md', startLine: 10, endLine: 20 });
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/api/callbacks/local/read-file-slice',
      params: { path: '/repo/docs/F186.md', startLine: '10', endLine: '20' },
    });
  });
});