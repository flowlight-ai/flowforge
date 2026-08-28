/**
 * @flowforge/cats-preview — Origin 解析与校验（F156 D-5）。
 *
 * TS 移植自 clowder-ai `config/frontend-origin.ts`（preview 相关子集）：
 * loopback 127.x 永远放行；RFC 1918 / Tailscale 私有网络仅
 * CORS_ALLOW_PRIVATE_NETWORK=true 时放行；FRONTEND_URL/FRONTEND_PORT 配置合并。
 *
 * @module @flowforge/cats-preview/origin
 */

export interface WarnLoggerLike {
  warn: (...args: unknown[]) => void;
}

const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:3003', 'https://cafe.clowder-ai.com'];

/**
 * F156: Loopback (127.x.x.x) ALWAYS allowed — 同一台机器的真实本地。
 * 与 RFC 1918 私有网段分开，因为威胁模型不同：恶意网站的 JS 跑在 loopback
 * 上下文，但其 Origin 头是 `https://evil.example` 而非 `http://127.0.0.1:*`，
 * 因此 loopback Origin 可以安全自动放行。
 */
export const LOOPBACK_ORIGIN = /^https?:\/\/127\.\d+\.\d+\.\d+(:\d+)?$/;

/**
 * 私有网段（RFC 1918 + Tailscale CGNAT 100.64/10）匹配。
 * F156: 仅 CORS_ALLOW_PRIVATE_NETWORK=true 时启用——这是信任边界：
 * LAN 设备（路由器管理页、NAS）上的恶意页面 Origin 可匹配并连接。
 */
export const PRIVATE_NETWORK_ORIGIN =
  /^https?:\/\/(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)(:\d+)?$/;

function normalizeConfiguredOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseFrontendPort(rawPort: string | undefined): number | null {
  const trimmed = rawPort?.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return port;
}

/**
 * 解析允许的 CORS origins（env 注入，缺省 process.env）。
 * 结果含 loopback 正则；私有网段仅显式 opt-in。
 */
export function resolveFrontendCorsOrigins(env: NodeJS.ProcessEnv, logger?: WarnLoggerLike): (string | RegExp)[] {
  const origins = new Set<string>(DEFAULT_CORS_ORIGINS);

  const rawFrontendUrl = env.FRONTEND_URL?.trim();
  if (rawFrontendUrl) {
    const normalizedOrigin = normalizeConfiguredOrigin(rawFrontendUrl);
    if (normalizedOrigin) {
      origins.add(normalizedOrigin);
    } else {
      logger?.warn({ frontendUrl: rawFrontendUrl }, '[cors] Invalid FRONTEND_URL, ignored custom origin');
    }
  }

  const rawFrontendPort = env.FRONTEND_PORT;
  const frontendPort = parseFrontendPort(rawFrontendPort);
  if (frontendPort !== null) {
    origins.add(`http://localhost:${frontendPort}`);
  } else if (rawFrontendPort?.trim()) {
    logger?.warn({ frontendPort: rawFrontendPort }, '[cors] Invalid FRONTEND_PORT, fallback to default origins');
  }

  const result: (string | RegExp)[] = [...origins];
  // F156: Loopback 总是安全（同一台机器，与 LAN 不同）。
  result.push(LOOPBACK_ORIGIN);
  // F156: RFC 1918 / Tailscale 私有网络仅显式 opt-in。
  if (env.CORS_ALLOW_PRIVATE_NETWORK === 'true') {
    result.push(PRIVATE_NETWORK_ORIGIN);
  }
  return result;
}

/**
 * F156: 校验 origin 是否被允许列表接受。
 */
export function isOriginAllowed(origin: string, allowedOrigins: (string | RegExp)[]): boolean {
  return allowedOrigins.some((allowed) => (allowed instanceof RegExp ? allowed.test(origin) : allowed === origin));
}
