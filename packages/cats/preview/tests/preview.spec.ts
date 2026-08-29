/**
 * C28 Preview 包测试 — @flowforge/cats-preview。
 *
 * 覆盖：
 *  - ctx.plugin(CatsPreview) → ctx.catsPreview 挂载 + 工厂
 *  - port-validator：loopback-only + 1024-65535 + gateway 自端口递归 +
 *    硬编码排除 + runtime env 合并（纵深防御）
 *  - origin：loopback 永放行 / RFC 1918 opt-in / FRONTEND_URL|PORT 合并
 *  - port-discovery：framework 检测 / stdout 解析 / probe 注入 / 去重
 *  - bridge-script / ws-patch-script：注入内容关键标记
 *  - preview-gateway：mock proxy 注入 → 400/403/合法转发/HTML 注入/WS origin
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import { createGzip } from 'node:zlib';
import { Context } from '@flowforge/cordis';
import CatsPreview, {
  BRIDGE_SCRIPT,
  PreviewGateway,
  PreviewService,
  PortDiscoveryService,
  buildWsPatchScript,
  collectRuntimePorts,
  DEFAULT_EXCLUDED_PORTS,
  detectFramework,
  isOriginAllowed,
  LOOPBACK_ORIGIN,
  parsePortFromStdout,
  PRIVATE_NETWORK_ORIGIN,
  resolveFrontendCorsOrigins,
  validatePort,
  type PreviewProxyServer,
} from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
});

async function withPreview(): Promise<Context> {
  const ctx = new Context();
  const fiber = await ctx.plugin(CatsPreview) as unknown as { dispose: () => Promise<void> | void };
  fibers.push(fiber);
  return ctx;
}

// ---------- mock proxy（模拟 http-proxy 行为，包零外部依赖） ----------

interface FakeProxyOpts {
  statusCode?: number;
  contentType?: string;
  body?: string;
  headers?: Record<string, string>;
  /** gzip 压缩 body（测解压注入） */
  gzip?: boolean;
}

function fakeProxyServer(opts: FakeProxyOpts = {}) {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const calls: Array<{ kind: 'web' | 'ws'; target: string; url?: string }> = [];
  const proxy: PreviewProxyServer = {
    on(event: string, listener: (...args: unknown[]) => void): void {
      (listeners[event] ??= []).push(listener);
    },
    web(req, res, proxyOpts) {
      calls.push({ kind: 'web', target: proxyOpts.target, ...(req.url !== undefined ? { url: req.url } : {}) });
      // 模拟上游响应：先设置 statusCode/headers（proxyRes listener 同步读取），
      // 再触发 proxyRes 监听器，最后喂 body。
      const proxyRes = new PassThrough() as PassThrough & {
        statusCode?: number;
        headers: Record<string, string>;
      };
      proxyRes.statusCode = opts.statusCode ?? 200;
      proxyRes.headers = {
        'content-type': opts.contentType ?? 'text/html',
        ...(opts.headers ?? {}),
      };
      if (opts.gzip) proxyRes.headers['content-encoding'] = 'gzip';
      queueMicrotask(() => {
        for (const fn of listeners['proxyRes'] ?? []) {
          fn(proxyRes, req, res);
        }
        const body = opts.body ?? '<html><head></head><body>hello preview</body></html>';
        if (opts.gzip) {
          const gz = createGzip();
          gz.end(body);
          gz.pipe(proxyRes);
        } else {
          proxyRes.end(body);
        }
      });
    },
    ws(req, socket, head, proxyOpts) {
      calls.push({ kind: 'ws', target: proxyOpts.target });
      for (const fn of listeners['ws'] ?? []) fn(req, socket, head);
    },
    close() {},
  };
  return { proxy, calls, listeners };
}

/** 临时目标 HTTP 后端（模拟 dev server）。 */
function startTargetServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>target</title></head><body>target ok</body></html>');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('cats-preview 插件挂载', () => {
  it('ctx.plugin(CatsPreview) → ctx.catsPreview 可用', async () => {
    const ctx = await withPreview();
    expect(ctx.catsPreview).toBeInstanceOf(PreviewService);
    expect(ctx.catsPreview.createPortDiscovery()).toBeInstanceOf(PortDiscoveryService);
    expect(() => ctx.catsPreview.createGateway({ port: 0 })).toThrow(/no proxy injected/);
  });

  it('checkPort / resolveOrigins 工厂可用', async () => {
    const ctx = await withPreview();
    expect(ctx.catsPreview.checkPort(4000).allowed).toBe(true);
    expect(ctx.catsPreview.resolveOrigins({})).toContainEqual(LOOPBACK_ORIGIN);
  });
});

describe('port-validator（F120 端口白名单）', () => {
  it('合法 loopback 端口通过（1024-65535）', () => {
    expect(validatePort(5173).allowed).toBe(true);
    expect(validatePort(3847).allowed).toBe(true);
    expect(validatePort(65535).allowed).toBe(true);
    expect(validatePort('8080').allowed).toBe(true);
  });

  it('范围外端口拒绝（<1024 / >65535 / 非数字）', () => {
    expect(validatePort(80).allowed).toBe(false);
    expect(validatePort(1023).allowed).toBe(false);
    expect(validatePort(65536).allowed).toBe(false);
    expect(validatePort(Number.NaN).allowed).toBe(false);
    expect(validatePort('abc').allowed).toBe(false);
    expect(validatePort('').allowed).toBe(false);
  });

  it('非 loopback host 拒绝', () => {
    const r = validatePort(5173, { host: '192.168.1.5' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Only loopback hosts allowed/);
  });

  it('gateway 自端口递归代理拒绝', () => {
    const r = validatePort(9999, { gatewaySelfPort: 9999 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/recursive proxy/);
  });

  it('硬编码 Clowder AI 服务端口拒绝', () => {
    expect(DEFAULT_EXCLUDED_PORTS).toContain(3001);
    expect(DEFAULT_EXCLUDED_PORTS).toContain(6399);
    expect(DEFAULT_EXCLUDED_PORTS).toContain(18888);
    for (const p of DEFAULT_EXCLUDED_PORTS) {
      expect(validatePort(p).allowed).toBe(false);
    }
  });

  it('自定义 excludedPorts 拒绝', () => {
    expect(validatePort(8123, { excludedPorts: [8123] }).allowed).toBe(false);
  });

  it('runtime env 端口合并拒绝（纵深防御）', () => {
    const envPorts = collectRuntimePorts({
      API_SERVER_PORT: '3001',
      MCP_SERVER_PORT: '19999',
      PREVIEW_GATEWAY_PORT: '4100',
      REDIS_PORT: 'abc', // 非法忽略
    } as NodeJS.ProcessEnv);
    expect(envPorts).toEqual(expect.arrayContaining([3001, 19999, 4100]));
    expect(envPorts).not.toContain(0);
    expect(validatePort(4100, { runtimePorts: envPorts }).allowed).toBe(false);
  });
});

describe('origin（F156 CORS Origin 校验）', () => {
  it('默认 origins 含本地默认 + cafe 域 + loopback 正则', () => {
    const origins = resolveFrontendCorsOrigins({});
    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://localhost:3003');
    expect(origins).toContain('https://cafe.clowder-ai.com');
    expect(origins).toContainEqual(LOOPBACK_ORIGIN);
    expect(origins).not.toContainEqual(PRIVATE_NETWORK_ORIGIN);
  });

  it('FRONTEND_URL / FRONTEND_PORT 合并', () => {
    const origins = resolveFrontendCorsOrigins({
      FRONTEND_URL: 'https://app.example.com:444',
      FRONTEND_PORT: '5174',
    } as NodeJS.ProcessEnv);
    expect(origins).toContain('https://app.example.com:444');
    expect(origins).toContain('http://localhost:5174');
  });

  it('非法 FRONTEND_URL / FRONTEND_PORT 告警并忽略', () => {
    const warns: unknown[][] = [];
    const logger = { warn: (...args: unknown[]) => warns.push(args) };
    const origins = resolveFrontendCorsOrigins(
      { FRONTEND_URL: 'not-a-url', FRONTEND_PORT: '99999' } as NodeJS.ProcessEnv,
      logger,
    );
    expect(warns.length).toBeGreaterThan(0);
    expect(origins.some((o) => o === 'not-a-url')).toBe(false);
  });

  it('CORS_ALLOW_PRIVATE_NETWORK=true 才启用私有网段', () => {
    const without = resolveFrontendCorsOrigins({});
    const withFlag = resolveFrontendCorsOrigins({ CORS_ALLOW_PRIVATE_NETWORK: 'true' } as NodeJS.ProcessEnv);
    expect(isOriginAllowed('http://192.168.1.10:3000', without)).toBe(false);
    expect(isOriginAllowed('http://192.168.1.10:3000', withFlag)).toBe(true);
    expect(isOriginAllowed('http://10.0.0.5:80', withFlag)).toBe(true);
  });

  it('loopback Origin 永远放行；外部域名拒绝', () => {
    const origins = resolveFrontendCorsOrigins({});
    expect(isOriginAllowed('http://127.0.0.1:5173', origins)).toBe(true);
    expect(isOriginAllowed('http://127.1.2.3:8080', origins)).toBe(true);
    expect(isOriginAllowed('https://evil.example', origins)).toBe(false);
  });
});

describe('port-discovery（F120 Phase B）', () => {
  it('detectFramework 识别 vite/next/webpack/unknown', () => {
    expect(detectFramework('VITE ready in 300ms')).toBe('vite');
    expect(detectFramework('Next.js 14.2.35')).toBe('next');
    expect(detectFramework('webpack compiled successfully')).toBe('webpack');
    expect(detectFramework('something else')).toBe('unknown');
  });

  it('parsePortFromStdout 解析 localhost 端口 + framework', () => {
    const parsed = parsePortFromStdout('  VITE v5.4.11  ready in 300 ms  ➜  Local:   http://localhost:5173/');
    expect(parsed).toEqual({ port: 5173, framework: 'vite' });
    expect(parsePortFromStdout('no url here')).toBeNull();
  });

  it('stdout 中的非法/排除端口拒绝解析', () => {
    expect(parsePortFromStdout('http://localhost:80/')).toBeNull();
    expect(parsePortFromStdout('http://localhost:3001/')).toBeNull(); // 排除端口
  });

  it('feedStdout 发现可达端口 → onDiscovered 触发；不可达不触发', async () => {
    const service = new PortDiscoveryService({
      probeFn: vi.fn(async (port: number) => port === 5173),
    });
    const discovered: unknown[] = [];
    service.onDiscovered((p) => discovered.push(p));

    await service.feedStdout('wt-1', 'pane-1', 'Local: http://localhost:5173/');
    await service.feedStdout('wt-1', 'pane-1', 'Local: http://localhost:9999/');

    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({ port: 5173, worktreeId: 'wt-1', reachable: true });
    expect(service.getDiscoveredPorts('wt-1')).toHaveLength(2);
    expect(service.getDiscoveredPorts('wt-2')).toHaveLength(0);
  });

  it('重复发现（已 reachable / in-flight）跳过', async () => {
    let calls = 0;
    const service = new PortDiscoveryService({
      probeFn: vi.fn(async () => {
        calls++;
        return true;
      }),
    });
    await service.feedStdout('wt-1', 'pane-1', 'http://localhost:5173/');
    await service.feedStdout('wt-1', 'pane-1', 'http://localhost:5173/'); // 重复
    expect(calls).toBe(1);
  });

  it('removePort / clear 清理', async () => {
    const service = new PortDiscoveryService({ probeFn: vi.fn(async () => true) });
    await service.feedStdout('wt-1', 'pane-1', 'http://localhost:5173/');
    service.removePort('wt-1', 5173);
    expect(service.getDiscoveredPorts()).toHaveLength(0);
    await service.feedStdout('wt-1', 'pane-1', 'http://localhost:5174/');
    service.clear();
    expect(service.getDiscoveredPorts()).toHaveLength(0);
  });
});

describe('bridge-script / ws-patch-script（HTML 注入内容）', () => {
  it('BRIDGE_SCRIPT 含关键标记（console patch / 截屏）', () => {
    expect(BRIDGE_SCRIPT).toContain('data-cat-cafe-bridge="true"');
    expect(BRIDGE_SCRIPT).toContain('patchLevel(\'log\')');
    expect(BRIDGE_SCRIPT).toContain('screenshot-request');
    expect(BRIDGE_SCRIPT).toContain('screenshot-result');
    expect(BRIDGE_SCRIPT).toContain('window.__catCafeBridge');
  });

  it('buildWsPatchScript 注入 __preview_port 与 HMR 路径', () => {
    const script = buildWsPatchScript(5173);
    expect(script).toContain('data-cat-cafe-ws-patch="true"');
    expect(script).toContain('__preview_port');
    expect(script).toContain('5173');
    expect(script).toContain('/__vite_hmr');
    expect(script).toContain('/__webpack_hmr');
  });
});

describe('preview-gateway（F120 反向代理）', () => {
  it('无 proxy/createProxy 注入时构造抛错（插件化铁律）', () => {
    expect(() => new PreviewGateway({ port: 0 })).toThrow(/no proxy injected/);
  });

  it('缺少 __preview_port → 400', async () => {
    const { proxy } = fakeProxyServer();
    const gateway = new PreviewGateway({ port: 0, proxy });
    await gateway.start();
    const res = await fetch(`http://127.0.0.1:${gateway.actualPort}/`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Missing __preview_port query parameter' });
    await gateway.stop();
  });

  it('非法/排除端口 → 403（端口白名单强制）', async () => {
    const { proxy } = fakeProxyServer();
    const gateway = new PreviewGateway({ port: 0, proxy });
    await gateway.start();
    const base = `http://127.0.0.1:${gateway.actualPort}`;
    expect((await fetch(`${base}/?__preview_port=80`)).status).toBe(403); // 范围外
    expect((await fetch(`${base}/?__preview_port=3001`)).status).toBe(403); // 排除端口
    expect((await fetch(`${base}/?__preview_port=5173&__preview_host=192.168.1.9`)).status).toBe(403); // 非 loopback
    await gateway.stop();
  });

  it('非法 Origin → 403（F156 D-5）；无 Origin 放行', async () => {
    const { proxy } = fakeProxyServer();
    const gateway = new PreviewGateway({ port: 0, proxy, allowedOrigins: ['http://trusted.example'] });
    await gateway.start();
    const base = `http://127.0.0.1:${gateway.actualPort}`;
    const evil = await fetch(`${base}/?__preview_port=5173`, { headers: { origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    const trusted = await fetch(`${base}/?__preview_port=5173`, { headers: { origin: 'http://trusted.example' } });
    expect(trusted.status).toBe(200);
    await gateway.stop();
  });

  it('合法请求转发 + HTML 注入 bridge/ws-patch 脚本', async () => {
    const { proxy, calls } = fakeProxyServer({ body: '<html><head><title>t</title></head><body>x</body></html>' });
    const gateway = new PreviewGateway({ port: 0, proxy });
    await gateway.start();
    const res = await fetch(`http://127.0.0.1:${gateway.actualPort}/path?__preview_port=5173&__preview_host=localhost`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(BRIDGE_SCRIPT);
    expect(html).toContain('data-cat-cafe-ws-patch="true"');
    expect(html).toContain('5173');
    expect(html).toContain('__vite_hmr');
    // 转发 URL 已剥离 preview 参数
    expect(calls[0]).toMatchObject({ kind: 'web', target: 'http://localhost:5173' });
    expect(calls[0]?.url).toBe('/path');
    await gateway.stop();
  });

  it('gzip 编码 HTML 解压后注入，并清除 content-encoding', async () => {
    const { proxy } = fakeProxyServer({ gzip: true, body: '<html><head></head><body>gz</body></html>' });
    const gateway = new PreviewGateway({ port: 0, proxy });
    await gateway.start();
    const res = await fetch(`http://127.0.0.1:${gateway.actualPort}/?__preview_port=5173`);
    const html = await res.text();
    expect(html).toContain(BRIDGE_SCRIPT);
    expect(res.headers.get('content-encoding')).toBeNull();
    await gateway.stop();
  });

  it('非 HTML 响应直通不注入', async () => {
    const { proxy, calls } = fakeProxyServer({
      contentType: 'application/json',
      body: '{"ok":true}',
    });
    const gateway = new PreviewGateway({ port: 0, proxy });
    await gateway.start();
    const res = await fetch(`http://127.0.0.1:${gateway.actualPort}/api?__preview_port=5173`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    await gateway.stop();
  });

  it('start(port 0) → actualPort 生效；stop 释放端口', async () => {
    const { proxy } = fakeProxyServer();
    const gateway = new PreviewGateway({ port: 0, proxy });
    expect(gateway.actualPort).toBe(0);
    await gateway.start();
    expect(gateway.actualPort).toBeGreaterThan(0);
    await gateway.stop();
  });

  it('真实后端端到端：gateway → 目标 dev server 转发（host 注入 + 自端口防护）', async () => {
    const target = await startTargetServer();
    const { proxy, calls } = fakeProxyServer({ body: '<html><head></head><body>real target</body></html>' });
    const gateway = new PreviewGateway({ port: 0, proxy });
    await gateway.start();

    // 自端口递归防护
    const selfPortRes = await fetch(
      `http://127.0.0.1:${gateway.actualPort}/?__preview_port=${gateway.actualPort}`,
    );
    expect(selfPortRes.status).toBe(403);

    // 合法转发（目标端口不在排除列表）
    const ok = await fetch(
      `http://127.0.0.1:${gateway.actualPort}/?__preview_port=${target.port}`,
    );
    expect(ok.status).toBe(200);
    expect(calls[0]?.target).toBe(`http://localhost:${target.port}`);

    await gateway.stop();
    await target.close();
  });
});
