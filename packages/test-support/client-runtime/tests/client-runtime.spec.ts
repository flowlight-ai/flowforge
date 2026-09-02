/**
 * client-runtime 测试 — D42。
 *
 * 覆盖：进程内 host↔client round-trip；handle 注册校验（前缀/重复）；
 * /api intercept 优先于 channel fallback + 卸载；handler 异常折叠 internal；
 * 未知 channel 错误；取消信号透传；disposer 幂等移除。
 */

import { describe, expect, it } from 'vitest';

import {
  MemoryClientRpc,
  MemoryHostConnection,
  createClientRuntime,
  type ConnectionRpcHandlerOptions,
} from '../src/index.ts';

const trusted: ConnectionRpcHandlerOptions = { authority: 'trusted-host' };

describe('createClientRuntime（round-trip）', () => {
  it('host.handle + client.call 返回 ok 分支', async () => {
    const { host, client } = createClientRuntime();
    await host.handle('/rpc', async (endpoint, payload) => {
      return { ok: true as const, value: { endpoint, payload } };
    }, trusted);

    const result = await client.call('/rpc', 'echo', { text: 'hi' });
    expect(result).toEqual({ ok: true, value: { endpoint: 'echo', payload: { text: 'hi' } } });
  });

  it('未知 channel → internal 错误分支', async () => {
    const { host, client } = createClientRuntime();
    void host;
    const result = await client.call('/nope', 'x', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('/nope');
  });

  it('handler 抛异常 → transportError 折叠为 internal', async () => {
    const { host, client } = createClientRuntime();
    await host.handle('/rpc', async () => {
      throw new Error('boom');
    }, trusted);

    const result = await client.call('/rpc', 'fail', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal');
      expect(result.error.message).toBe('boom');
    }
  });

  it('取消信号透传到 handler', async () => {
    const { host, client } = createClientRuntime();
    let seenAbort: AbortSignal | undefined;
    await host.handle('/rpc', async (_endpoint, _payload, signal) => {
      seenAbort = signal;
      return { ok: true as const, value: { aborted: signal.aborted } };
    }, trusted);

    const controller = new AbortController();
    controller.abort();
    const result = await client.call('/rpc', 'ping', {}, controller.signal);
    expect(seenAbort?.aborted).toBe(true);
    expect(result).toEqual({ ok: true, value: { aborted: true } });
  });
});

describe('MemoryHostConnection.handle/intercept', () => {
  it('handle 校验：channel 需 / 前缀 + 重复注册拒绝', async () => {
    const host = new MemoryHostConnection();
    await host.handle('/a', async () => ({ ok: true as const, value: null }), trusted);
    await expect(host.handle('/a', async () => ({ ok: true as const, value: null }), trusted)).rejects.toThrow(
      /already registered/,
    );
    await expect(host.handle('a', async () => ({ ok: true as const, value: null }), trusted)).rejects.toThrow(
      /must start with "\/"/,
    );
  });

  it('/api intercept 优先于 channel fallback；卸载后回落', async () => {
    const host = new MemoryHostConnection();
    await host.handle('/api', async (_endpoint, _payload) => {
      return { ok: true as const, value: { source: 'channel' } };
    }, trusted);
    const disposeInterceptor = await host.intercept('/api', (endpoint) => endpoint.startsWith('owned/'), async () => {
      return { ok: true as const, value: { source: 'interceptor' } };
    }, trusted);

    const client = new MemoryClientRpc(host);
    expect(await client.call('/api', 'owned/x', {})).toEqual({ ok: true, value: { source: 'interceptor' } });
    expect(await client.call('/api', 'free/x', {})).toEqual({ ok: true, value: { source: 'channel' } });

    await disposeInterceptor();
    expect(await client.call('/api', 'owned/x', {})).toEqual({ ok: true, value: { source: 'channel' } });
  });

  it('intercept 仅接受 /api', async () => {
    const host = new MemoryHostConnection();
    await expect(
      host.intercept('/other' as '/api', () => true, async () => ({ ok: true as const, value: null }), trusted),
    ).rejects.toThrow(/only the "\/api"/);
  });

  it('handle disposer 移除路由后未知 channel', async () => {
    const host = new MemoryHostConnection();
    const dispose = await host.handle(
      '/rpc',
      async () => ({ ok: true as const, value: null }),
      trusted,
    );
    await dispose();
    const client = new MemoryClientRpc(host);
    const result = await client.call('/rpc', 'x', {});
    expect(result.ok).toBe(false);
  });

  it('handle 支持 loopback authority 注册并返回 disposer', async () => {
    const host = new MemoryHostConnection();
    const dispose = await host.handle(
      '/loop',
      async () => ({ ok: true as const, value: 'ok' }),
      { authority: 'loopback' },
    );
    const client = new MemoryClientRpc(host);
    expect(await client.call('/loop', 'x', {})).toEqual({ ok: true, value: 'ok' });
    await dispose();
    expect((await client.call('/loop', 'x', {})).ok).toBe(false);
  });
});
