/**
 * Capability Write Guards — 能力写操作的本地回环 + owner 门禁。
 *
 * 移植自 clowder-ai `config/capabilities/capability-write-guards.ts`。
 * 改造：原实现依赖 FastifyRequest，这里抽象为 `CapabilityWriteRequestLike`
 * 纯参数接口（ip/hostname/headers/sessionUserId），HTTP 层由调用方适配，
 * 便于测试与多框架复用。owner-gate / loopback 判定逻辑（原
 * `utils/owner-gate.ts` + `utils/loopback-request.ts`）内联。
 */

import { REDACTED_CAPABILITY_SECRET } from './capability-redaction.js';

/** HTTP 请求的最小形状 — 替代 fastify FastifyRequest。 */
export interface CapabilityWriteRequestLike {
  /** 对端 socket 地址（例如 '127.0.0.1' / '::1'）。 */
  ip: string;
  /** Host 头解析出的主机名（可选回退）。 */
  hostname?: string;
  /** 原始请求头。 */
  headers: Record<string, string | string[] | undefined>;
  /** 会话用户 ID（认证层填充，可选）。 */
  sessionUserId?: string;
}

export interface CapabilityWriteRouteError {
  status: number;
  error: string;
}

export interface CapabilityWriteOwnerOptions {
  allowMissingOwner?: boolean;
  requireConfiguredOwner?: boolean;
  missingOwnerError?: string;
}

const LOCAL_CAPABILITY_WRITE_ERROR = 'Capability writes require direct localhost Hub access';

// ────────── owner gate（原 utils/owner-gate.ts 内联）──────────

export interface OwnerGateOptions {
  errorMessage?: string;
  requireConfiguredOwner?: boolean;
}

/**
 * Owner gate：DEFAULT_OWNER_USER_ID 已配置时要求匹配；未配置时单用户模式放行
 * （除非 requireConfiguredOwner，此时"未配置"= 拒绝）。
 */
export function resolveOwnerGate(userId: string, options: OwnerGateOptions = {}): CapabilityWriteRouteError | null {
  const ownerId = process.env.DEFAULT_OWNER_USER_ID?.trim();
  if (!ownerId) {
    if (options.requireConfiguredOwner) {
      return {
        status: 403,
        error: options.errorMessage ?? 'This operation requires DEFAULT_OWNER_USER_ID to be configured',
      };
    }
    return null;
  }
  if (userId !== ownerId) {
    return {
      status: 403,
      error: options.errorMessage ?? 'This operation can only be performed by the configured owner',
    };
  }
  return null;
}

export function resolveCapabilityWriteSessionUserId(request: CapabilityWriteRequestLike): string | null {
  const sessionUserId = request.sessionUserId;
  return typeof sessionUserId === 'string' && sessionUserId.trim() ? sessionUserId.trim() : null;
}

/**
 * 能力写操作的 owner 门禁（#794 统一模式）。
 *
 * 写路由用 `{ allowMissingOwner: true }` — 本地单用户模式放行；
 * 数据可见性过滤用 `{ requireConfiguredOwner: true }` — 未配置即隐藏。
 */
export function requireCapabilityWriteOwner(
  userId: string,
  options: CapabilityWriteOwnerOptions = {},
): CapabilityWriteRouteError | null {
  const shouldFallThrough = !!options.allowMissingOwner && !options.requireConfiguredOwner;
  return resolveOwnerGate(userId, {
    requireConfiguredOwner: !shouldFallThrough,
    ...(options.missingOwnerError !== undefined ? { errorMessage: options.missingOwnerError } : {}),
  });
}

// ────────── loopback 判定（原 utils/loopback-request.ts 内联）──────────

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackAddress(address: string): boolean {
  return LOOPBACK_ADDRS.has(address);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeHostForLoopbackCheck(value: string | undefined): string {
  const raw = value?.split(',')[0]?.trim().toLowerCase() ?? '';
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : raw;
  }
  if (raw.indexOf(':') === raw.lastIndexOf(':')) {
    return raw.split(':')[0] ?? raw;
  }
  return raw;
}

function isLoopbackHost(value: string): boolean {
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

const PROXY_FORWARDING_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'x-client-ip',
  'cf-connecting-ip',
  'true-client-ip',
] as const;

function hasHeaderValue(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.some((item) => item.trim().length > 0);
  return typeof value === 'string' && value.trim().length > 0;
}

function hasProxyForwardingHeaders(request: CapabilityWriteRequestLike): boolean {
  return PROXY_FORWARDING_HEADERS.some((header) => hasHeaderValue(request.headers[header]));
}

function hasTrustedLocalOrigin(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    return isLoopbackHost(normalizeHostForLoopbackCheck(new URL(value).host));
  } catch {
    return false;
  }
}

function isApiBoundToLocalhost(): boolean {
  const host = process.env.API_SERVER_HOST?.trim();
  if (!host) return true;
  return isLoopbackHost(normalizeHostForLoopbackCheck(host));
}

/**
 * 判定是否为直连本地回环的能力写请求：
 * API 绑定 localhost + 对端回环 + 无代理转发头 + Host 回环 + Origin 可信。
 */
export function isLocalCapabilityWriteRequest(request: CapabilityWriteRequestLike): boolean {
  if (!isApiBoundToLocalhost()) return false;
  if (!isLoopbackAddress(request.ip)) return false;
  if (hasProxyForwardingHeaders(request)) return false;

  // Host 是客户端提供的；只有在对端 socket 是回环之后才用它收窄。
  const host = firstHeaderValue(request.headers.host) ?? request.hostname;
  const normalized = normalizeHostForLoopbackCheck(host);
  if (!isLoopbackHost(normalized)) return false;

  // 能力写是直连本地 Hub 的表面；头部用于收窄回环对端检查。
  return hasTrustedLocalOrigin(firstHeaderValue(request.headers.origin));
}

export function requireLocalCapabilityWriteRequest(request: CapabilityWriteRequestLike): CapabilityWriteRouteError | null {
  if (isLocalCapabilityWriteRequest(request)) return null;
  return { status: 403, error: LOCAL_CAPABILITY_WRITE_ERROR };
}

/** 深度检测载荷中是否包含脱敏占位符（防止把占位符写回配置）。 */
export function containsRedactedPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(REDACTED_CAPABILITY_SECRET);
  if (Array.isArray(value)) return value.some((item) => containsRedactedPlaceholder(item));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => containsRedactedPlaceholder(item));
  }
  return false;
}
