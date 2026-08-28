/**
 * @flowforge/cats-human-disposition — ledger key 派生（F281）。
 *
 * TS 移植自 clowder-ai `domains/human-disposition/human-disposition-keys.ts`：
 * owner 维度 base64url 编码（1..500 字符校验），receipts hash / episodes zset / subject zset。
 *
 * @module @flowforge/cats-human-disposition/keys
 */

function encodeKeyPart(value: string, label: string): string {
  const canonical = value.trim();
  if (canonical.length === 0 || canonical.length > 500) {
    throw new Error(`${label} must contain 1..500 characters`);
  }
  return Buffer.from(canonical, 'utf8').toString('base64url');
}

export const HumanDispositionKeys = {
  receipts(ownerUserId: string): string {
    return `human-disposition:receipts:${encodeKeyPart(ownerUserId, 'ownerUserId')}`;
  },

  episodes(ownerUserId: string): string {
    return `human-disposition:episodes:${encodeKeyPart(ownerUserId, 'ownerUserId')}`;
  },

  subject(ownerUserId: string, subjectRef: string): string {
    return `human-disposition:subject:${encodeKeyPart(ownerUserId, 'ownerUserId')}:${encodeKeyPart(subjectRef, 'subjectRef')}`;
  },
};
