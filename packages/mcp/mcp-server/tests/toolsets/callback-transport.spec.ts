import { describe, expect, it } from 'vitest';
import {
  createCallbackInvoker,
  unavailableCallbackPort,
  type CallbackTransportPort,
} from '../../src/toolsets/callback-transport.js';

describe('toolsets/callback-transport', () => {
  it('forwards a POST body onto the injected port', async () => {
    let received: unknown;
    const port: CallbackTransportPort = {
      id: 'fixture',
      send: async (req) => {
        received = req;
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    };
    const invoke = createCallbackInvoker(port, {
      method: 'POST',
      path: '/api/callbacks/read-entrusted-work',
      bodyKeys: ['taskId', 'observedRevision'],
    });
    const result = await invoke({ taskId: 't1', observedRevision: 3, ignored: true });
    expect(result.content[0]!.text).toBe('ok');
    expect(received).toEqual({
      method: 'POST',
      path: '/api/callbacks/read-entrusted-work',
      body: { taskId: 't1', observedRevision: 3 },
    });
  });

  it('forwards GET params and drops absent body keys', async () => {
    let received: unknown;
    const port: CallbackTransportPort = {
      id: 'fixture',
      send: async (req) => {
        received = req;
        return { content: [{ type: 'text', text: '' }] };
      },
    };
    const invoke = createCallbackInvoker(port, {
      method: 'GET',
      path: '/api/signals',
      paramKeys: ['limit'],
    });
    await invoke({ limit: '5' });
    expect(received).toEqual({ method: 'GET', path: '/api/signals', params: { limit: '5' } });
  });

  it('forwards agentKeyCatId when present', async () => {
    let received: unknown;
    const port: CallbackTransportPort = {
      id: 'fixture',
      send: async (req) => {
        received = req;
        return { content: [{ type: 'text', text: '' }] };
      },
    };
    const invoke = createCallbackInvoker(port, { method: 'POST', path: '/p', bodyKeys: ['x'] });
    await invoke({ x: 'a', agentKeyCatId: 'cat_1' });
    expect(received).toMatchObject({ body: { x: 'a' }, agentKeyCatId: 'cat_1' });
  });

  it('errors on the unavailable port instead of sending', async () => {
    const result = await unavailableCallbackPort.send({ method: 'POST', path: '/p', body: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not configured');
  });
});