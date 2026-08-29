/**
 * Capability Redaction — MCP 敏感字段（env/headers）脱敏。
 *
 * 移植自 clowder-ai `config/capabilities/capability-redaction.ts`。
 * 审计日志与 API 响应统一走此脱敏，保证密钥不外泄。
 */

import type { CapabilityAuditEntry, CapabilityEntry, McpInstallPreview } from '@flowforge/cats-shared';

export const REDACTED_CAPABILITY_SECRET = '••••••';

function redactRecord(record: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.keys(record).map((key) => [key, REDACTED_CAPABILITY_SECRET]));
}

function sanitizeMcpServer<T extends CapabilityEntry['mcpServer'] | CapabilityEntry['mcpServerOverride']>(
  server: T,
): T {
  if (!server) return server;
  const sanitized = { ...server };
  if (Array.isArray(server.args)) {
    sanitized.args = [...server.args];
  }
  const redactedEnv = redactRecord(server.env);
  const redactedHeaders = redactRecord(server.headers);
  if (redactedEnv) sanitized.env = redactedEnv;
  else delete sanitized.env;
  if (redactedHeaders) sanitized.headers = redactedHeaders;
  else delete sanitized.headers;
  return sanitized as T;
}

export function sanitizeCapabilityForAudit(entry: CapabilityEntry | null): CapabilityEntry | null {
  if (!entry) return null;
  const sanitized: CapabilityEntry = { ...entry };
  if (entry.mcpServer) sanitized.mcpServer = sanitizeMcpServer(entry.mcpServer);
  if (entry.mcpServerOverride) sanitized.mcpServerOverride = sanitizeMcpServer(entry.mcpServerOverride);
  return sanitized;
}

export function sanitizeCapabilityForResponse(entry: CapabilityEntry | null): CapabilityEntry | null {
  return sanitizeCapabilityForAudit(entry);
}

export function sanitizeCapabilityAuditEntry(entry: CapabilityAuditEntry): CapabilityAuditEntry {
  return {
    ...entry,
    before: sanitizeCapabilityForAudit(entry.before),
    after: sanitizeCapabilityForAudit(entry.after),
  };
}

export function sanitizeMcpInstallPreviewForResponse(preview: McpInstallPreview): McpInstallPreview {
  return {
    ...preview,
    entry: sanitizeCapabilityForResponse(preview.entry) ?? preview.entry,
  };
}
