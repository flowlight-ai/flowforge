/**
 * PluginLimbAdapter — T6.2 插件四肢适配器契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/PluginLimbAdapter.ts` 语义）：
 * - commandSchemas 仅暴露 description + params（不含内部 REST/handler 细节）
 * - 未知命令 → success:false；缺失必填参数 → success:false
 * - rest 命令路由到 REST 执行器；invoke 命令路由到 handler
 * - builtin:health_check；handler 缺失/未知 → success:false
 * - executeRest 在 invoke handler 内可调 REST 命令
 * - healthCheck：auth 模板未解析 → offline；token 获取失败 → degraded
 *
 * @module @flowforge/limb-node/tests
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LimbDeclaration } from '@flowforge/limb-embodiment';
import { PluginLimbAdapter, InvokeHandler } from '../src/plugin-limb-adapter.ts';

const DECLARATION: LimbDeclaration = {
  nodeId: 'wechat-plugin',
  displayName: 'WeChat Plugin Limb',
  platform: 'linux-x64',
  baseUrl: 'https://api.wechat.example.com',
  capabilities: [{ cap: 'message', commands: ['message.send'], authLevel: 'free' }],
  auth: {
    type: 'client_credentials',
    tokenEndpoint: '/cgi-bin/token',
    tokenParams: { appid: '${WECHAT_APPID}', secret: '${WECHAT_SECRET}' },
    tokenResponsePath: 'access_token',
    tokenPlacement: 'query',
    tokenParamName: 'access_token',
    tokenExpiredCodes: [40001],
    ttlSeconds: 7200,
  },
  error: { codePath: 'errcode', messagePath: 'errmsg' },
  commands: {
    send: {
      type: 'rest',
      description: 'Send a message',
      endpoint: '/cgi-bin/message/send',
      method: 'POST',
      params: { touser: { type: 'string', required: true } },
      body: { touser: '${params.touser}' },
    },
    health: {
      type: 'invoke',
      description: 'Health check',
      params: {},
      handler: 'builtin:health_check',
    },
    custom: {
      type: 'invoke',
      description: 'Custom handler',
      params: { text: { type: 'string', required: true, validation: 'handler' } },
      handler: 'my-plugin:echo',
    },
    relay: {
      type: 'invoke',
      description: 'Relay to REST command',
      params: { touser: { type: 'string', required: true } },
      handler: 'my-plugin:relay',
    },
  },
};

function jsonResponse(data: unknown, _ok = true, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const PLUGIN_CONFIG = { WECHAT_APPID: 'app-1', WECHAT_SECRET: 's3cret' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PluginLimbAdapter', () => {
  it('commandSchemas 仅暴露 description + params（不含内部细节）', () => {
    const adapter = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG });
    expect(adapter.nodeId).toBe('wechat-plugin');
    expect(adapter.capabilities).toEqual([{ cap: 'message', commands: ['message.send'], authLevel: 'free' }]);

    const send = adapter.commandSchemas['send'];
    expect(send).toEqual({ description: 'Send a message', params: { touser: { type: 'string', required: true } } });
    expect('endpoint' in send!).toBe(false);
    expect('handler' in send!).toBe(false);
  });

  it('rest 命令路由到 REST 执行器', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input?: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/token')) return jsonResponse({ access_token: 'tok-1', expires_in: 7200 });
        void init;
        return jsonResponse({ errcode: 0, msgid: 'm-1' });
      }),
    );

    const adapter = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG });
    const result = await adapter.invoke('send', { touser: 'u-1' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ errcode: 0, msgid: 'm-1' });
  });

  it('未知命令 / 缺失必填参数 → success:false', async () => {
    const adapter = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG });
    const unknown = await adapter.invoke('nope', {});
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain('Unknown command');

    const missing = await adapter.invoke('send', {});
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('Missing required params: touser');
  });

  it('builtin:health_check 返回连接状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ access_token: 'tok-1', expires_in: 7200 })));
    const adapter = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG });
    const result = await adapter.invoke('health', {});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'connected' });
  });

  it('invoke handler 分发；handler 缺失/未知 → success:false', async () => {
    const handlers: Record<string, InvokeHandler> = {
      'my-plugin:echo': async (params) => ({ success: true, data: { echoed: params['text'] } }),
    };
    const adapter = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG, handlers });

    const ok = await adapter.invoke('custom', { text: 'hello' });
    expect(ok).toEqual({ success: true, data: { echoed: 'hello' } });

    // 无 handlers 注入
    const bare = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG });
    const missing = await bare.invoke('custom', { text: 'x' });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('Handler not found');
  });

  it('handler 内 executeRest 调用同一 YAML 的 REST 命令', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input?: RequestInfo | URL) => {
        if (String(input).includes('/token')) return jsonResponse({ access_token: 'tok-1', expires_in: 7200 });
        return jsonResponse({ errcode: 0, msgid: 'relayed' });
      }),
    );

    const handlers: Record<string, InvokeHandler> = {
      'my-plugin:relay': async (params, ctx) => {
        const rest = await ctx.executeRest('send', params);
        return rest;
      },
    };
    const adapter = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG, handlers });
    const result = await adapter.invoke('relay', { touser: 'u-2' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ errcode: 0, msgid: 'relayed' });
  });

  it('handler 内 executeRest 引用未知命令 → success:false', async () => {
    const handlers: Record<string, InvokeHandler> = {
      'my-plugin:relay': async (_params, ctx) => ctx.executeRest('not-a-command', {}),
    };
    const adapter = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG, handlers });
    const result = await adapter.invoke('relay', { touser: 'u-2' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('REST command not found');
  });

  it('invoke 命令异常 → success:false 携带错误信息', async () => {
    const handlers: Record<string, InvokeHandler> = {
      'my-plugin:echo': async () => {
        throw new Error('boom');
      },
    };
    const adapter = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG, handlers });
    const result = await adapter.invoke('custom', { text: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('healthCheck：auth 模板未解析 → offline；token 获取失败 → degraded；无 auth → online', async () => {
    // 未解析模板
    const unconfigured = new PluginLimbAdapter({
      declaration: DECLARATION,
      pluginConfig: { WECHAT_APPID: '', WECHAT_SECRET: 'x' },
    });
    expect(await unconfigured.healthCheck()).toBe('offline');

    // token 失败
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ errcode: 40013 }, false, 400)));
    const degraded = new PluginLimbAdapter({ declaration: DECLARATION, pluginConfig: PLUGIN_CONFIG });
    expect(await degraded.healthCheck()).toBe('degraded');

    // 无 auth 声明
    const noAuthDecl = { ...DECLARATION };
    delete noAuthDecl.auth;
    delete noAuthDecl.baseUrl;
    const noAuth = new PluginLimbAdapter({
      declaration: noAuthDecl,
      pluginConfig: {},
    });
    expect(await noAuth.healthCheck()).toBe('online');
  });
});
