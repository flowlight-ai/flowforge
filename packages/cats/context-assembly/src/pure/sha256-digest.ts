/**
 * SHA-256 digest helpers (self-contained).
 * Wraps node:crypto for domain-separated digest computation.
 */

import { createHash } from 'node:crypto';

/** SHA-256 over a domain prefix + payload (hex). */
export function domainDigest(domain: string, payload: string): string {
  return createHash('sha256').update(domain, 'utf8').update(payload, 'utf8').digest('hex');
}

/** Plain SHA-256 over a payload (hex), truncated to leading characters. */
export function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}