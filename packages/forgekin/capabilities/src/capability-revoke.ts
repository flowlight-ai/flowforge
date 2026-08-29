/**
 * Capability Revoke — 外部能力吊销（禁用 + 审计动作标记）。
 *
 * 移植自 clowder-ai `config/capabilities/capability-revoke.ts`。
 * 内置（cat-cafe source）能力不可吊销。
 */

import type { CapabilityEntry } from '@flowforge/cats-shared';

export interface RevokeResult {
  entry: CapabilityEntry;
  revokedBy: string;
  revokedAt: string;
  auditAction: 'revoke';
}

export function revokeCapability(entry: CapabilityEntry, revoker: string): RevokeResult {
  if (entry.source === 'cat-cafe') {
    throw new Error(`cannot revoke cat-cafe source capability: ${entry.id}`);
  }

  return {
    entry: { ...entry, enabled: false },
    revokedBy: revoker,
    revokedAt: new Date().toISOString(),
    auditAction: 'revoke',
  };
}
