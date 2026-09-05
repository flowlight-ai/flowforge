/**
 * F152: TelemetryRedactor 纯逻辑层（TS 移植自 clowder-ai `redactor.ts`）。
 *
 * D1 字段分级（Class A/B/C/D）在遥测出口处强制执行：
 *   - Class A（凭据）：一律 `[REDACTED]`
 *   - Class B（业务内容）：仅 hash 前 16 hex + 长度
 *   - Class C（系统标识符）：HMAC 伪名化
 *   - Class D（其余）：原样透传
 *
 * 批次51 适配：OTel SpanProcessor/LogRecordProcessor 包装类依赖 SDK，挂 T9.5；
 * 本模块提供结构化记录（{ attributes, events? }）上的纯脱敏函数——OTel 适配层
 * 接线时直接调用 redactAttributes / redactRecord。
 */

import { createHash } from 'node:crypto';
import { pseudonymizeId } from './hmac.ts';

// --- Class A: credentials — always redacted ---
const CLASS_A_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'token',
  'apikey',
  'api_key',
  'secret',
  'password',
  'credential',
  'credentials',
  'callbacktoken',
]);

export function isClassA(key: string): boolean {
  const lower = key.toLowerCase();
  return CLASS_A_KEYS.has(lower) || lower.endsWith('_token') || lower.endsWith('_api_key');
}

// --- Class B: business content — hash+length only ---
const CLASS_B_KEYS = new Set([
  'prompt',
  'message.content',
  'thinking',
  'toolinput',
  'tool_result',
  'command',
  'aggregated_output',
  'mcp.arguments',
  'rich_block.image',
]);

export function isClassB(key: string): boolean {
  return CLASS_B_KEYS.has(key.toLowerCase());
}

// --- Class C: system identifiers — HMAC pseudonymized ---
const CLASS_C_KEYS = new Set([
  'userid',
  'threadid',
  'invocationid',
  'sessionid',
  'messageid',
  'rawarchivepath',
]);

export function isClassC(key: string): boolean {
  return CLASS_C_KEYS.has(key.toLowerCase());
}

export function redactValue(key: string, value: unknown): unknown {
  if (isClassA(key)) return '[REDACTED]';
  if (isClassB(key) && typeof value === 'string') {
    const hash = createHash('sha256').update(value).digest('hex').slice(0, 16);
    return `[hash:${hash} len:${value.length}]`;
  }
  if (isClassC(key) && typeof value === 'string') {
    return pseudonymizeId(value);
  }
  return value; // Class D: pass through
}

export function redactAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    result[key] = redactValue(key, value);
  }
  return result;
}

/** 结构化记录（span/log record 最小面）：attributes + 可选 events。 */
export interface RedactableRecord {
  attributes: Record<string, unknown>;
  events?: ReadonlyArray<{ attributes?: Record<string, unknown> | undefined }> | undefined;
}

/**
 * 就地脱敏一条结构化记录的 attributes 与（F192 Phase D）每个 event 的 attributes。
 * LocalTraceExporter/LocalTraceStore 契约为"所有 ID 已由 redactor 伪名化"——
 * 事件属性不脱敏会使原始 messageId/invocationId/threadId 经 traces 查询泄露。
 */
export function redactRecord(record: RedactableRecord): void {
  Object.assign(record.attributes, redactAttributes(record.attributes));
  if (record.events !== undefined) {
    for (const event of record.events) {
      if (event.attributes !== undefined) {
        Object.assign(event.attributes, redactAttributes(event.attributes));
      }
    }
  }
}
