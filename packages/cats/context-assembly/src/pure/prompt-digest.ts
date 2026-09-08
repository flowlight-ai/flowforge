/**
 * Prompt digest (ported from clowder `prompt-digest.ts`).
 *
 * Generates a privacy-first digest of a prompt for audit logs: length + sha256
 * by default. `AUDIT_LOG_INCLUDE_PROMPT_SNIPPETS=true` enables head/tail snippets.
 */

import { sha256Hex } from './sha256-digest.ts';

export interface PromptDigest {
  /** Raw prompt length. */
  length: number;
  /** First 100 chars (only when snippets enabled). */
  head?: string;
  /** Last 100 chars (only when snippets enabled and length > 200). */
  tail?: string;
  /** SHA256 hash first 16 chars (for comparison). */
  hash: string;
}

function includeSnippets(): boolean {
  return process.env.AUDIT_LOG_INCLUDE_PROMPT_SNIPPETS === 'true';
}

export function createPromptDigest(prompt: string): PromptDigest {
  const hash = sha256Hex(prompt).slice(0, 16);
  if (!includeSnippets()) {
    return { length: prompt.length, hash };
  }
  const head = prompt.slice(0, 100);
  const tail = prompt.length > 200 ? prompt.slice(-100) : undefined;
  return {
    length: prompt.length,
    head,
    ...(tail ? { tail } : {}),
    hash,
  };
}