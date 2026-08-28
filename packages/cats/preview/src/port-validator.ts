/**
 * @flowforge/cats-preview — 目标端口校验（F120 安全边界）。
 *
 * TS 移植自 clowder-ai `domains/preview/port-validator.ts`：
 * loopback-only + 1024-65535 范围 + gateway 自端口递归防护 +
 * 硬编码服务端口保底 + runtime env 合并（纵深防御）。
 * 插件化改造：`process.env` 读取剥离为 `collectRuntimePorts(env)` 注入参数。
 *
 * @module @flowforge/cats-preview/port-validator
 */

import type { PortValidationOptions, PortValidationResult } from './types.js';

/** Clowder AI 自身服务端口 — 硬编码保底 */
export const DEFAULT_EXCLUDED_PORTS = [
  3001,
  3002, // Hub frontend + API (internal defaults)
  3003,
  3004, // Hub frontend + API (public/open-source defaults)
  6398,
  6399, // Redis dev + prod
  18888,
  19999, // MCP / API gateway
  9876,
  9878,
  9877, // Anthropic proxy (default ANTHROPIC_PROXY_PORT)
  9879, // Whisper, LLM postprocess, TTS
  9880, // Embedding server (embed-api.py)
  9881, // Audio capture service (F195 audio-service.py)
];

const RUNTIME_PORT_ENV_KEYS = [
  'API_SERVER_PORT',
  'FRONTEND_PORT',
  'MCP_SERVER_PORT',
  'PREVIEW_GATEWAY_PORT',
  'REDIS_PORT',
  'VITE_PORT',
  'ANTHROPIC_PROXY_PORT', // P1 fix (砚砚 review): proxy port must be excluded
  'EMBED_PORT', // P1 fix: custom embed port
];

/**
 * 从运行时环境变量收集服务端口（与硬编码保底合并，纵深防御）。
 * env 注入（缺省 process.env），便于测试与多实例隔离。
 */
export function collectRuntimePorts(env: NodeJS.ProcessEnv = process.env): number[] {
  const ports: number[] = [];
  for (const key of RUNTIME_PORT_ENV_KEYS) {
    const val = env[key];
    if (val) {
      const n = Number.parseInt(val, 10);
      if (n > 0 && n <= 65535) ports.push(n);
    }
  }
  return ports;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PORT_MIN = 1024;
const PORT_MAX = 65535;

export function validatePort(rawPort: number | string, opts: PortValidationOptions = {}): PortValidationResult {
  const port = typeof rawPort === 'string' ? Number.parseInt(rawPort, 10) : rawPort;
  if (!Number.isFinite(port)) {
    return { allowed: false, reason: 'Port must be a valid number' };
  }

  const { host, gatewaySelfPort, runtimePorts } = opts;
  const excludedPorts = [...DEFAULT_EXCLUDED_PORTS, ...(opts.excludedPorts ?? []), ...(runtimePorts ?? [])];

  if (host && !LOOPBACK_HOSTS.has(host)) {
    return { allowed: false, reason: `Only loopback hosts allowed (got: ${host})` };
  }

  if (port < PORT_MIN || port > PORT_MAX) {
    return { allowed: false, reason: `Port must be in range ${PORT_MIN}-${PORT_MAX}` };
  }

  if (gatewaySelfPort && port === gatewaySelfPort) {
    return { allowed: false, reason: 'Cannot proxy to gateway self port (recursive proxy)' };
  }

  if (excludedPorts.includes(port)) {
    return { allowed: false, reason: `Port ${port} is excluded (Clowder AI service port)` };
  }

  return { allowed: true };
}
