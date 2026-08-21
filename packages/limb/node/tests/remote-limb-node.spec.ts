/**
 * RemoteLimbNode — T6.2 远端节点代理契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/RemoteLimbNode.ts` 语义）：
 * - invoke POST /invoke 带 Bearer + JSON body；成功透传结果
 * - HTTP 非 2xx / 网络异常 → success:false + error 信息
 * - healthCheck：/health 状态白名单映射；非 2xx → degraded；异常 → offline
 * - endpointUrl 尾斜杠剔除
 *
 * @module @flowforge/limb-node/tests
 */

import { describe, expect, it, vi } from 'vitest';
import { RemoteLimbNode, RemoteLimbNodeConfig } from '../src/remote-limb-node.ts';

function makeNode(overrides: Partial<RemoteLimbNodeConfig> = {}): RemoteLimbNode {
  return new RemoteLimbNode({
    nodeId: 'remote-cam-01',
    displayName: 'Remote Camera',
    platform: 'linux-arm64',
    capabilities: [{ cap: 'camera', commands: ['camera.snap'], authLevel: 'free' }],
    endpointUrl: 'http://192.168.1.100:8080/',
    apiKey: 'key-1',
    ...overrides,
  });
}

function jsonResponse(data: unknown, _ok = true, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RemoteLimbNode', () => {
  it('invoke POST /invoke 带 Bearer 与 JSON body；透传成功结果', async () => {
    const fetchFn = vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ success: true, data: { frames: 2 }, artifactUri: 'file:///f.png' }),
    );
    const node = makeNode({ fetchFn });

    const result = await node.invoke('camera.snap', { count: 2 });
    expect(result).toEqual({ success: true, data: { frames: 2 }, artifactUri: 'file:///f.png' });

    const url = String(fetchFn.mock.calls[0]?.[0]);
    expect(url).toBe('http://192.168.1.100:8080/invoke'); // 尾斜杠剔除
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer key-1');
    expect(JSON.parse(String(init?.body))).toEqual({ command: 'camera.snap', params: { count: 2 } });
  });

  it('invoke HTTP 非 2xx 返回 success:false', async () => {
    const node = makeNode({ fetchFn: vi.fn(async () => jsonResponse({}, false, 503)) });
    const result = await node.invoke('camera.snap', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('503');
  });

  it('invoke 网络异常返回 success:false 带错误信息', async () => {
    const node = makeNode({
      fetchFn: vi.fn(async () => {
        throw new TypeError('ECONNREFUSED');
      }),
    });
    const result = await node.invoke('camera.snap', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('invoke 非 JSON 响应体解析失败 → success:false', async () => {
    const node = makeNode({
      fetchFn: vi.fn(async () => new Response('<html>', { status: 200 })),
    });
    const result = await node.invoke('camera.snap', {});
    expect(result.success).toBe(false);
  });

  it('healthCheck：状态白名单透传；未知状态默认 online', async () => {
    const node1 = makeNode({
      fetchFn: vi.fn(async () => jsonResponse({ status: 'busy' })),
    });
    expect(await node1.healthCheck()).toBe('busy');

    const node2 = makeNode({
      fetchFn: vi.fn(async () => jsonResponse({ status: 'weird' })),
    });
    expect(await node2.healthCheck()).toBe('online');
  });

  it('healthCheck：非 2xx → degraded；网络异常 → offline', async () => {
    const degraded = makeNode({ fetchFn: vi.fn(async () => jsonResponse({}, false, 500)) });
    expect(await degraded.healthCheck()).toBe('degraded');

    const offline = makeNode({
      fetchFn: vi.fn(async () => {
        throw new Error('timeout');
      }),
    });
    expect(await offline.healthCheck()).toBe('offline');
  });

  it('register/deregister 为 no-op', async () => {
    const node = makeNode({ fetchFn: vi.fn() });
    await expect(node.register()).resolves.toBeUndefined();
    await expect(node.deregister()).resolves.toBeUndefined();
    expect(node.nodeId).toBe('remote-cam-01');
    expect(node.capabilities).toHaveLength(1);
  });
});
