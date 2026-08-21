/**
 * PluginTokenManager — T6.2 插件令牌管理契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/PluginTokenManager.ts` 语义）：
 * - client_credentials 获取 token（mock fetch）+ 内存缓存复用
 * - ${VAR} 模板解析；缓存键指纹含 tokenEndpoint + 解析后参数
 * - single-flight：并发 getAccessToken 只触发一次 refresh
 * - Redis 缓存命中；invalidate 清理内存+Redis；Redis 失败跳过
 * - 过期重试语义：isTokenExpiredError 命中 tokenExpiredCodes
 *
 * @module @flowforge/limb-node/tests
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LimbAuthConfig } from '@flowforge/limb-embodiment';
import { PluginTokenManager, RedisTokenLike } from '../src/plugin-token-manager.ts';

const AUTH: LimbAuthConfig = {
  type: 'client_credentials',
  tokenEndpoint: '/cgi-bin/token',
  tokenParams: {
    grant_type: 'client_credential',
    appid: '${WECHAT_APPID}',
    secret: '${WECHAT_SECRET}',
  },
  tokenResponsePath: 'access_token',
  tokenPlacement: 'query',
  tokenParamName: 'access_token',
  tokenExpiredCodes: [40001, 42001],
  ttlSeconds: 7200,
};

const PLUGIN_CONFIG = { WECHAT_APPID: 'app-1', WECHAT_SECRET: 's3cret' };

function jsonResponse(data: unknown, _ok = true, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeTokenManager(redis?: RedisTokenLike): PluginTokenManager {
  return new PluginTokenManager(AUTH, 'https://api.wechat.example.com', PLUGIN_CONFIG, redis);
}

function makeRedis(): { redis: RedisTokenLike; data: Map<string, { value: string; ttl: number }> } {
  const data = new Map<string, { value: string; ttl: number }>();
  const redis: RedisTokenLike = {
    async get(key) {
      return data.get(key)?.value ?? null;
    },
    async setex(key, ttlSeconds, value) {
      data.set(key, { value, ttl: ttlSeconds });
    },
    async del(key) {
      data.delete(key);
    },
  };
  return { redis, data };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PluginTokenManager', () => {
  it('获取 token：按 tokenResponsePath 提取 + 内存缓存复用', async () => {
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL) =>
      jsonResponse({ access_token: 'tok-1', expires_in: 7200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = makeTokenManager();
    expect(await manager.getAccessToken()).toBe('tok-1');
    expect(await manager.getAccessToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 请求带解析后的 tokenParams
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('grant_type=client_credential');
    expect(url).toContain('appid=app-1');
    expect(url).toContain('secret=s3cret');
  });

  it('resolveTemplate 解析 ${VAR}；缺失键回退空串', () => {
    const manager = makeTokenManager();
    expect(manager.resolveTemplate('${WECHAT_APPID}')).toBe('app-1');
    expect(manager.resolveTemplate('prefix-${MISSING}-suffix')).toBe('prefix--suffix');
  });

  it('single-flight：并发调用只触发一次 refresh', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return jsonResponse({ access_token: `tok-${calls}`, expires_in: 7200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = makeTokenManager();
    const [a, b, c] = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.getAccessToken(),
    ]);
    expect(a).toBe('tok-1');
    expect(b).toBe('tok-1');
    expect(c).toBe('tok-1');
    expect(calls).toBe(1);
  });

  it('Redis 缓存命中直接返回（不再 refresh）；TTL 减 300s 余量', async () => {
    const { redis, data } = makeRedis();
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL) =>
      jsonResponse({ access_token: 'tok-1', expires_in: 7200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = makeTokenManager(redis);
    expect(await manager.getAccessToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data.size).toBe(1);
    expect([...data.values()][0]?.ttl).toBe(6900);

    // 新实例命中 Redis（无 fetch）
    const manager2 = makeTokenManager(redis);
    expect(await manager2.getAccessToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateAccessToken 清内存 + Redis；Redis 失败时置 skipRedisOnce', async () => {
    const { redis, data } = makeRedis();
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL) =>
      jsonResponse({ access_token: 'tok-1', expires_in: 7200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = makeTokenManager(redis);
    await manager.getAccessToken();
    await manager.invalidateAccessToken();
    expect(data.size).toBe(0);

    // 失效后重新获取 → 再次 refresh
    expect(await manager.getAccessToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Redis del 失败 → skipRedisOnce：下次直接 refresh 不再碰 Redis
    const failingRedis: RedisTokenLike = {
      ...redis,
      async del() {
        throw new Error('redis down');
      },
    };
    const manager2 = makeTokenManager(failingRedis);
    await manager2.getAccessToken();
    await manager2.invalidateAccessToken();
    await manager2.getAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('token 响应缺失/HTTP 错误抛 Error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ errcode: 40013, errmsg: 'invalid appid' })));
    await expect(makeTokenManager().getAccessToken()).rejects.toThrow(/Token error: 40013/);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false, 500)));
    await expect(makeTokenManager().getAccessToken()).rejects.toThrow(/HTTP 500/);
  });

  it('isTokenExpiredError 命中 tokenExpiredCodes', () => {
    const manager = makeTokenManager();
    expect(manager.isTokenExpiredError(40001)).toBe(true);
    expect(manager.isTokenExpiredError(42001)).toBe(true);
    expect(manager.isTokenExpiredError(45009)).toBe(false);
  });
});
