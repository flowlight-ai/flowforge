import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../../src/server-toolsets.js';
import { defineMcpToolsetTools } from '../../src/toolsets/define-toolset-tool.js';
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

describe('toolsets/define-toolset-tool', () => {
  it('derives effectiveRisk/annotations/actionInventory from the operation', () => {
    const { port } = fixturePort();
    const [tool] = defineMcpToolsetTools(port, 'collab', [
      {
        name: 'cat_cafe_read_example',
        description: 'Read an example resource.',
        action: 'read',
        risk: { level: 'read', openWorld: false },
        inputSchema: { id: z.string().min(1) },
        resourceFamily: 'example',
        runtimeProfiles: ['full', 'readonly'],
        admissionRef: 'file:docs/features/F000-example.md',
        sourceExport: 'handleReadExample',
        authorizationHint: 'read-only',
        route: { method: 'GET', path: '/api/examples' },
      },
    ]);
    expect(tool!.name).toBe('cat_cafe_read_example');
    expect(tool!.effectiveRisk).toEqual({ level: 'read', openWorld: false });
    expect(tool!.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tool!.actionInventory).toEqual(['read']);
    expect(tool!.serverFamily).toBe('collab');
  });

  it('binds handler to port.send with the declared route', async () => {
    const { port, calls } = fixturePort();
    const [tool] = defineMcpToolsetTools(port, 'memory', [
      {
        name: 'cat_cafe_post_example',
        description: 'Mutate an example resource.',
        action: 'update',
        risk: { level: 'write', openWorld: false },
        inputSchema: { id: z.string().min(1) },
        resourceFamily: 'example',
        runtimeProfiles: ['full'],
        admissionRef: 'file:docs/features/F001-example.md',
        sourceExport: 'handlePostExample',
        authorizationHint: 'callback-owner',
        route: { method: 'POST', path: '/api/examples', bodyKeys: ['id'] },
      },
    ]);
    const result = (await tool!.handler({ id: 'abc' } as never)) as { content: { text: string }[] };
    expect(calls).toHaveLength(1);
    expect(result.content[0]!.text).toBe(JSON.stringify(calls[0]));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/examples', body: { id: 'abc' } });
  });

  it('registers the toolset onto a real McpServer', async () => {
    const { port, calls } = fixturePort();
    const tools = defineMcpToolsetTools(port, 'signals', [
      {
        name: 'cat_cafe_list_signals',
        description: 'List signals.',
        action: 'read',
        risk: { level: 'read', openWorld: true },
        inputSchema: { limit: z.number().int().optional() },
        resourceFamily: 'signals',
        runtimeProfiles: ['full', 'readonly'],
        admissionRef: 'file:docs/features/F002-signals.md',
        sourceExport: 'handleListSignals',
        authorizationHint: 'read-only',
        route: { method: 'GET', path: '/api/signals', paramKeys: ['limit'] },
      },
    ]);
    const server = new McpServer({ name: 'acme', version: '1.0.0' });
    expect(() => registerTools(server, tools)).not.toThrow();
    // The registered tool's handler forwards onto the injected callback port.
    const result = (await tools[0]!.handler({} as never)) as { content: { text: string }[] };
    expect(result.content[0]!.text).toBe(JSON.stringify(calls[0]));
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/signals' });
  });
});