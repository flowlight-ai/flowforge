/**
 * Message Bundle projection digest (self-contained port of clowder
 * `MessageBundleProjectionDigest.ts`).
 */

import { domainDigest } from '../pure/sha256-digest.ts';
import { canonicalJson } from '../pure/canonical-json.ts';
import type { RichBlock } from '../contract/message-bundle.ts';
import {
  MESSAGE_BUNDLE_CLI_QUOTE_DIGEST_DOMAIN,
  MESSAGE_BUNDLE_CLI_QUOTE_DIGEST_DOMAIN_V2,
  MESSAGE_BUNDLE_QUOTE_DIGEST_DOMAIN,
  MESSAGE_BUNDLE_QUOTE_DIGEST_DOMAIN_V2,
  MESSAGE_BUNDLE_QUOTE_DIGEST_DOMAIN_V3,
  MESSAGE_BUNDLE_RICH_BLOCK_DIGEST_DOMAIN,
} from '../contract/message-bundle.ts';

export function digestMessageBundleQuoteProjection(projection: string): string {
  return domainDigest(MESSAGE_BUNDLE_QUOTE_DIGEST_DOMAIN, projection);
}

export function digestMessageBundleQuoteProjectionV2(projection: string): string {
  return domainDigest(MESSAGE_BUNDLE_QUOTE_DIGEST_DOMAIN_V2, projection);
}

export function digestMessageBundleQuoteProjectionV3(projection: string): string {
  return domainDigest(MESSAGE_BUNDLE_QUOTE_DIGEST_DOMAIN_V3, projection);
}

export function digestMessageBundleCliQuoteProjection(projection: string): string {
  return domainDigest(MESSAGE_BUNDLE_CLI_QUOTE_DIGEST_DOMAIN, projection);
}

export function digestMessageBundleCliQuoteProjectionV2(projection: string): string {
  return domainDigest(MESSAGE_BUNDLE_CLI_QUOTE_DIGEST_DOMAIN_V2, projection);
}

export function digestMessageBundleRichBlockProjection(block: RichBlock): string {
  return domainDigest(MESSAGE_BUNDLE_RICH_BLOCK_DIGEST_DOMAIN, canonicalJson(block));
}