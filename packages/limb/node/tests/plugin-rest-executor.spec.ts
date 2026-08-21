/**
 * PluginRestExecutor — T6.2 REST 执行契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/PluginRestExecutor.ts` 语义）：
 * - 按命令定义构造请求（method/endpoint/body 模板/params 默认值）
 * - token 注入：query 参数 / header 两种 placement
 * - errcode 命中 tokenExpiredCodes → 自动失效重试一次
 * - 响应错误码（非 0）抛 RestApiError；HTTP 非 2xx 抛 Error
 *
 * @module @flowforge/limb-node/tests
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LimbCommandDef } from '@flowforge/limb-embodiment';
import { PluginRestExecutor, RestApiError } from '../src/plugin-rest-executor.ts';
import { PluginTokenManager } from '../src/plugin-token-manager.ts';
import type { LimbAuthConfig } from '@flowforge/limb-embodiment';

const AUTH: LimbAuthConfig = {
  type: 'client_credentials',
  tokenEndpoint: '/token',
  tokenParams: { grant_type: 'client_credential' },
  tokenResponsePath: 'access_token',
  tokenPlacement: 'query',
  tokenParamName: 'access_token',
  tokenExpiredCodes: [40001],
  ttlSeconds: 7200,
};

function makeExecutor(tokenPlacement: 'query' | 'header' = 'query', errorConfig?: { codePath: string; messagePath: string }) {
  const tokenManager = new PluginTokenManager(AUTH, 'https://api.example.com', {}, undefined);
  const executor = new PluginRestExecutor(
    'https://api.example.com',
    tokenManager,
    errorConfig,
    tokenPlacement,
    'access_token',
  );
  return { executor, tokenManager };
}

const SEND_DEF: LimbCommandDef = {
  type: 'rest',
  description: 'send',
  endpoint: '/cgi-bin/send',
  method: 'POST',
  params: {
    touser: { type: 'string', required: true },
    msgtype: { type: 'string', default: 'text' },
  },
  body: {
    touser: '${params.touser}',
    msgtype: '${params.msgtype}',
    nested: { value: '${params.missing_key}' },
  },
};

function jsonResponse(data: unknown, _ok = true, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PluginRestExecutor', () => {
  it('构造请求：body 模板解析 + params 默认值 + query token 注入', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input?: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/token')) return jsonResponse({ access_token: 'tok-1', expires_in: 7200 });
        void init;
        return jsonResponse({ errcode: 0, msgid: 'm-1' });
      }),
    );

    const { executor } = makeExecutor('query');
    const result = await executor.execute(SEND_DEF, { touser: 'u-1' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ errcode: 0, msgid: 'm-1' });

    // API 调用：URL 带 token query + 正确路径
    const calls = vi.mocked(fetch).mock.calls;
    const apiCall = calls.find((c) => String(c[0]).includes('/cgi-bin/send'));
    expect(apiCall).toBeDefined();
    expect(String(apiCall?.[0])).toBe('https://api.example.com/cgi-bin/send?access_token=tok-1');
    const init = apiCall?.[1];
    expect(init?.method).toBe('POST');
    // body 模板：缺省 msgtype=text；空值字段被剔除（空对象 nested 保留，对齐 clowder-ai 语义）
    expect(JSON.parse(String(init?.body))).toEqual({ touser: 'u-1', msgtype: 'text', nested: {} });
  });

  it('header placement：token 放请求头', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input?: RequestInfo | URL) => {
        if (String(input).includes('/token')) return jsonResponse({ access_token: 'tok-h', expires_in: 7200 });
        return jsonResponse({ errcode: 0 });
      }),
    );

    const { executor } = makeExecutor('header');
    await executor.execute(SEND_DEF, { touser: 'u-1' });
    const calls = vi.mocked(fetch).mock.calls;
    const apiCall = calls.find((c) => String(c[0]).includes('/cgi-bin/send'));
    expect(apiCall).toBeDefined();
    const headers = apiCall?.[1]?.headers as Record<string, string>;
    expect(headers['access_token']).toBe('tok-h');
    expect(String(apiCall?.[0])).not.toContain('access_token=');
  });

  it('errcode 命中 tokenExpiredCodes → 失效后自动重试一次成功', async () => {
    let apiCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) => {
        if (String(_input).includes('/token')) return jsonResponse({ access_token: 'tok-1', expires_in: 7200 });
        apiCalls += 1;
        if (apiCalls === 1) return jsonResponse({ errcode: 40001, errmsg: 'token expired' });
        return jsonResponse({ errcode: 0, msgid: 'm-2' });
      }),
    );

    const { executor } = makeExecutor('query', { codePath: 'errcode', messagePath: 'errmsg' });
    const result = await executor.execute(SEND_DEF, { touser: 'u-1' });

    expect(apiCalls).toBe(2);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ errcode: 0, msgid: 'm-2' });
  });

  it('响应非 0 错误码（不在 tokenExpiredCodes）抛 RestApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) => {
        if (String(_input).includes('/token')) return jsonResponse({ access_token: 'tok-1', expires_in: 7200 });
        return jsonResponse({ errcode: 45009, errmsg: 'rate limited' });
      }),
    );

    const { executor } = makeExecutor('query', { codePath: 'errcode', messagePath: 'errmsg' });
    await expect(executor.execute(SEND_DEF, { touser: 'u-1' })).rejects.toThrow(RestApiError);
  });

  it('HTTP 非 2xx 抛 Error（不重试）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) => {
        if (String(_input).includes('/token')) return jsonResponse({ access_token: 'tok-1', expires_in: 7200 });
        return jsonResponse({}, false, 500);
      }),
    );

    const { executor } = makeExecutor();
    await expect(executor.execute(SEND_DEF, { touser: 'u-1' })).rejects.toThrow(/HTTP 500/);
  });

  it('无 errorConfig 时响应任意 JSON 直接成功', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) => {
        if (String(_input).includes('/token')) return jsonResponse({ access_token: 'tok-1', expires_in: 7200 });
        return jsonResponse({ anything: true });
      }),
    );

    const { executor } = makeExecutor();
    const result = await executor.execute(SEND_DEF, { touser: 'u-1' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ anything: true });
  });
});
