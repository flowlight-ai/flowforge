/**
 * 视频/图片协议模板引擎（C35，clowder protocol-server 引擎核心移植）。
 *
 * 从 clowder-ai `packages/mcp-server` 的 protocol engine（F205）移植渲染与
 * 解析纯函数部分：
 *   - `{{var | default:literal}}` 占位符递归渲染（提供 var 用之，缺省回落
 *     template 内 default 字面量，再缺省为空串）
 *   - sync/async 能力请求构建（submit + poll 规格）
 *   - `$.data.task_id` JSONPath 提取 + statusMap 状态归类
 *   - capability `inherit` 链解析（如 zhipu image2video 继承 text2video poll）
 */

export type ProtocolMode = 'sync' | 'async';

export interface ProtocolAuth {
  method: 'query-param' | 'header' | 'apikey' | 'jwt-hs256' | 'hmac-sha256-v4';
  paramName?: string;
}

export interface ProtocolResponseSpec {
  /** 同步能力的结果字段（JSONPath）。 */
  result?: string;
  taskId?: string;
  status?: string;
  statusMap?: Record<string, string[]>;
  resultUrl?: string;
  fallbackResultUrl?: string;
  coverUrl?: string;
  error?: string;
  codeField?: string;
  successCode?: number | string;
}

export interface ProtocolRequestSpec {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  response?: ProtocolResponseSpec;
}

export interface ProtocolPollSpec {
  method: 'GET' | 'POST';
  path: string;
  interval: number;
  maxAttempts: number;
  body?: unknown;
  response?: ProtocolResponseSpec;
}

export type VideoCapabilitySpec =
  | {
      /** sync 协议：单次请求。 */
      mode: 'sync';
      request: ProtocolRequestSpec;
    }
  | {
      /** async 协议：submit + poll。 */
      mode: 'async';
      inherit?: string;
      submit: ProtocolRequestSpec;
      poll?: ProtocolPollSpec;
    };

export interface VideoProtocol {
  name: string;
  version: number;
  mode: ProtocolMode;
  baseUrl: string;
  auth?: ProtocolAuth;
  capabilities: Record<string, VideoCapabilitySpec>;
}

export type ProtocolVars = Record<string, string | number | boolean | undefined>;

// ── 占位符渲染 ─────────────────────────────────────────────

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*(?:\|\s*default\s*:\s*([^}]*))?\s*\}\}/gu;

function renderTemplateValue(value: unknown, vars: ProtocolVars): unknown {
  if (typeof value === 'string') return renderTemplateString(value, vars);
  if (Array.isArray(value)) return value.map((item) => renderTemplateValue(item, vars));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderTemplateValue(child, vars);
    }
    return out;
  }
  return value;
}

export function renderTemplateString(template: string, vars: ProtocolVars): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, name: string, rawDefault?: string) => {
    const value = vars[name];
    if (value !== undefined) return String(value);
    if (rawDefault !== undefined && rawDefault !== '') return rawDefault;
    return '';
  });
}

export function buildRequest(
  baseUrl: string,
  request: ProtocolRequestSpec,
  vars: ProtocolVars,
): { method: string; url: string; body: unknown } {
  return {
    method: request.method,
    url: `${baseUrl}${renderTemplateString(request.path, vars)}`,
    body: request.body === undefined ? undefined : renderTemplateValue(request.body, vars),
  };
}

// ── capability 解析（inherit 链） ──────────────────────────

export interface ResolvedCapability {
  mode: 'sync' | 'async';
  request?: ProtocolRequestSpec;
  submit: ProtocolRequestSpec;
  poll?: ProtocolPollSpec;
}

export function resolveCapability(protocol: VideoProtocol, capabilityName: string): ResolvedCapability {
  const capability = protocol.capabilities[capabilityName];
  if (!capability) throw new Error(`capability "${capabilityName}" not found in protocol "${protocol.name}"`);

  if (capability.mode === 'sync') {
    return { mode: 'sync', request: capability.request, submit: capability.request };
  }

  let poll = capability.poll;
  if (!poll && capability.inherit) {
    const inherited = resolveCapability(protocol, capability.inherit);
    poll = inherited.poll;
  }
  return poll ? { mode: 'async', submit: capability.submit, poll } : { mode: 'async', submit: capability.submit };
}

// ── JSONPath 提取与状态归类 ───────────────────────────────

function parseIndex(token: string): number | null {
  if (/^\d+$/u.test(token)) return Number(token);
  return null;
}

function descend(node: unknown, key: string): unknown {
  if (node === null || node === undefined) return undefined;
  if (Array.isArray(node)) {
    const index = parseIndex(key);
    return index !== null ? node[index] : undefined;
  }
  if (typeof node === 'object') return (node as Record<string, unknown>)[key];
  return undefined;
}

/** 提取 `$.a.b[0].c` 形式的 JSONPath。 */
export function extractJsonPath(document: unknown, path: string | undefined): unknown {
  if (path === undefined || path === '') return undefined;
  if (!path.startsWith('$.')) return undefined;
  const tokens = path.slice(2).replace(/\[(\d+)\]/gu, '.$1').split('.').filter((token) => token.length > 0);
  let current: unknown = document;
  for (const token of tokens) {
    current = descend(current, token);
    if (current === undefined) return undefined;
  }
  return current;
}

export type LifecycleStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export function classifyStatus(
  response: ProtocolResponseSpec,
  rawStatus: unknown,
): { lifecycle: LifecycleStatus | null; matched: boolean } {
  if (rawStatus === null || rawStatus === undefined) return { lifecycle: null, matched: false };
  const raw = String(rawStatus);
  const map = response.statusMap;
  if (!map) return { lifecycle: null, matched: false };
  for (const [lifecycle, values] of Object.entries(map)) {
    if (values.includes(raw)) return { lifecycle: lifecycle as LifecycleStatus, matched: true };
  }
  return { lifecycle: null, matched: false };
}

// ── async 状态快照 ────────────────────────────────────────

export interface AsyncSnapshot {
  taskId: string | undefined;
  status: LifecycleStatus | null;
  resultUrl: string | undefined;
  coverUrl: string | undefined;
  error: string | undefined;
  isTerminal: boolean;
}

export function snapshotAsyncResult(response: ProtocolResponseSpec, body: unknown): AsyncSnapshot {
  const taskId = extractJsonPath(body, response.taskId);
  const statusRaw = extractJsonPath(body, response.status);
  const { lifecycle } = classifyStatus(response, statusRaw);
  const resultUrl = extractJsonPath(body, response.resultUrl);
  const fallback = response.fallbackResultUrl ? extractJsonPath(body, response.fallbackResultUrl) : undefined;
  const coverUrl = extractJsonPath(body, response.coverUrl);
  const error = extractJsonPath(body, response.error);
  const isTerminal = lifecycle === 'succeeded' || lifecycle === 'failed';
  return {
    taskId: taskId === undefined ? undefined : String(taskId),
    status: lifecycle,
    resultUrl: asString(resultUrl) ?? (fallback !== undefined ? asString(fallback) : undefined),
    coverUrl: asString(coverUrl),
    error: asString(error),
    isTerminal,
  };
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return first === undefined || first === null ? undefined : String(first);
  }
  return String(value);
}
