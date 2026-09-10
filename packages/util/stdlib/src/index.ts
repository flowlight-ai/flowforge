/**
 * Zero-dependency pure stdlib helpers, ported from the clowder-ai `utils` layer
 * (B9 inventory). Each module only depends on Node built-ins, so this package
 * is safe to ship and reuse anywhere in the monorepo.
 *
 * @module @flowforge/util-stdlib
 */

export {
  readJsonlTail,
  type ReadJsonlTailOptions,
} from './jsonl-tail.ts'
export {
  normalizeJsonUnicode,
} from './json-unicode.ts'
export {
  normalizeErrorMessage,
} from './normalize-error.ts'
export {
  tcpProbe,
} from './tcp-probe.ts'
export {
  initRepoIdentity,
  isSameRepo,
} from './is-same-repo.ts'
export {
  scoreKeywordRelevance,
  tokenizeKeyword,
} from './keyword-relevance.ts'
export {
  createPinnedRequestOptions,
  fetchExternalUrlPinned,
  resolveExternalUrl,
  validateExternalUrl,
  validateExternalUrlResolved,
  type DnsLookup,
  type PinnedFetchOptions,
  type PinnedFetchResult,
  type PinnedRequestOptions,
  type ResolvedExternalUrl,
} from './url-safety.ts'