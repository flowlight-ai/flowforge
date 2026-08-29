/**
 * Version Lock — F146-C AC-C2：安装时的版本锁记录构造。
 *
 * 移植自 clowder-ai `config/capabilities/version-lock.ts`。
 */

import type { LockVersion } from '@flowforge/cats-shared';

interface LockVersionInput {
  source: LockVersion['source'];
  version: string;
  channel?: string;
  installedBy: string;
}

export function buildLockVersion(input: LockVersionInput): LockVersion {
  if (!input.version) {
    throw new Error('version is required');
  }
  return {
    source: input.source,
    version: input.version,
    ...(input.channel ? { channel: input.channel } : {}),
    installedAt: new Date().toISOString(),
    installedBy: input.installedBy,
  };
}
