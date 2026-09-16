/**
 * memory/evidence toolset (EP1-1b, B5).
 *
 * Migrated from clowder `tools/evidence-tools.ts` (F102 Phase D / F209 recall
 * optimization). One tool (`cat_cafe_search_evidence`, handler
 * `handleSearchEvidence`). The source also references helper-only modules
 * `evidence-coverage-nudge.ts` / `evidence-coverage-response.ts`; those export
 * formatting/rendering helpers, NOT tools, so they are not ported as separate
 * groups — their intent is folded into this evidence group.
 *
 * Resource family `evidence-navigation`. The handler performs a direct `fetch`
 * GET against `/api/evidence/search` (public route, no callback auth), so this
 * is reconciled as a GET route whose query params mirror the input keys.
 *
 * NOTE(E2b memory): the source injects `x-cat-cafe-user` / `x-cat-cafe-thread-id`
 * headers and a `currentThreadId` query param read from host env vars; those are
 * host-layer concerns and are intentionally not part of the ported param set.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const searchEvidenceInputSchema = {
  query: z.string().min(1).max(2_000).describe('Search query for project knowledge (max 2,000 characters)'),
  limit: z.number().int().min(1).max(20).optional().describe('Max results (default 5)'),
  scope: z
    .enum(['docs', 'memory', 'threads', 'sessions', 'all'])
    .optional()
    .describe(
      'Collection scope: docs (features/ADRs/plans/lessons), threads/sessions (chat history), all (everything)',
    ),
  mode: z
    .enum(['lexical', 'semantic', 'hybrid'])
    .optional()
    .describe('Retrieval mode: lexical (BM25, default), semantic (vector), hybrid (both + rerank)'),
  depth: z.enum(['summary', 'raw']).optional().describe('Result depth: summary (default) or raw detail'),
  dateFrom: z.string().optional().describe('ISO8601 date filter, inclusive lower bound (e.g. 2026-03-15)'),
  dateTo: z.string().optional().describe('ISO8601 date filter, inclusive upper bound (e.g. 2026-03-20)'),
  contextWindow: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Number of surrounding passages to include per match (like grep -C). Only effective with depth=raw'),
  threadId: z
    .string()
    .optional()
    .describe(
      'Filter results to a specific thread. Only returns evidence from that thread digest. For reading raw messages, use get_thread_context instead.',
    ),
  dimension: z
    .enum(['project', 'global', 'library', 'collection', 'all'])
    .optional()
    .describe(
      'Knowledge dimension: project (default, local docs), library (all registered collections incl. external), collection (specific collections via collections param), all (DEPRECATED legacy alias for project+global — use library or collection for multi-collection search)',
    ),
  collections: z
    .string()
    .optional()
    .describe(
      'Comma-separated collection IDs to search (e.g. "world:lexander,global:methods"). Only effective with dimension=collection',
    ),
  explain: z
    .boolean()
    .optional()
    .describe('When true, include rankingFactors (bm25Score, consumptionPrior, mmrPenalty) on each result'),
  intent: z
    .enum(['topk', 'coverage'])
    .optional()
    .describe(
      'Search intent: topk (default, ranked list) or coverage (exhaustive multi-scope search with coverage matrix output). Use coverage for "哪些/所有/历史上" style source-map queries.',
    ),
  coverage_offset: z
    .number()
    .int()
    .min(0)
    .max(49)
    .optional()
    .describe(
      'Continuation offset from a truncated coverage response drill pointer. Only effective with intent=coverage.',
    ),
  include_expansion: z
    .boolean()
    .optional()
    .describe(
      'F256 Phase B: Include expansion hints ("Related directions") in topk results. Default true. Set false to suppress.',
    ),
};

export const EVIDENCE_SERVER_FAMILY = 'memory' as const;
// F209 (evidence recall optimization) governs the unified search_evidence entry point.
const F209 = 'file:docs/features/F209-evidence-recall-optimization.md' as const;

export function buildEvidenceToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, EVIDENCE_SERVER_FAMILY, [
    {
      name: 'cat_cafe_search_evidence',
      description:
        'Search project knowledge base — features, decisions, architecture maps, plans, lessons, session history. ' +
        'Use when: semantically finding project knowledge, tracing a topic across docs or threads, or building a bounded coverage/source map. ' +
        'NOT for: resolving a known exact anchor (use cat_cafe_graph_resolve), scanning recent items without a query (use cat_cafe_list_recent), or reading raw messages from a known thread (use get_thread_context). ' +
        'Output: ranked evidence summaries with typed match, authority, freshness, provenance, degradation, and continuation metadata; this is read-only. ' +
        'GOTCHA: matchRank is rank position, not trust; authority is document reliability, and broad coverage requires separate docs + threads searches instead of treating one all-scope query as exhaustive. ' +
        'Semantic/fuzzy find entry point for memory recall. For precise anchors (F186, ADR-019), prefer cat_cafe_graph_resolve; for zero-prior scanning, prefer cat_cafe_list_recent; when unsure, start here with mode=hybrid. ' +
        'Supports scope (docs/threads/all), mode (lexical/semantic/hybrid), and depth (summary/raw). ' +
        'QUERY CONTRACT: query has max 2,000 characters; overlong input fails validation instead of being truncated. ' +
        'THREAD FILTER CONTRACT: threadId is enforced at the final response boundary; results can only come from that thread, and empty responses state whether the filter was authoritative or degraded. Related-direction expansion is suppressed for exact thread searches. ' +
        'COVERAGE CONTRACT: caller scope is executed exactly; coverage limit has max 20; latency is bounded; serialized output has a declared budget with explicit truncation and a continuation drill pointer. ' +
        'At the 15s API deadline coverage returns an explicit partial/degraded result; the MCP HTTP caller cancels any request that outlives that boundary plus transport grace. ' +
        'SCOPE STRATEGY (decide first!): ' +
        'docs = 结论/真相源 (features, ADRs, architecture maps, plans, lessons). ' +
        'threads = 讨论过程 (who said what, original context). ' +
        "all = broad scan only — docs dominate due to higher BM25 density, so don't rely on all for finding threads. " +
        'Rule of thumb: "要结论 → docs, 要过程 → threads, 要全貌 → both separately". ' +
        'MODE SELECTION: lexical (default) = BM25 keyword match, best for Feature IDs / exact terms (F042, Redis). ' +
        'hybrid = BM25 + vector NN + RRF fusion, RECOMMENDED for most searches — finds both exact AND semantic matches. ' +
        'semantic = pure vector nearest-neighbor, best for cross-language (English query → Chinese docs) or synonym matching. ' +
        'TIP: When unsure, use mode=hybrid. For broad surveys, add one semantic query as blind-spot insurance (hybrid misses cross-language synonyms). ' +
        'QUERY TIPS: Feature IDs (F102, F163) are strong anchors — use them when available. ' +
        'Mix Chinese + English keywords for better recall (记忆 + memory). ' +
        'Split broad topics into 2-3 targeted queries from different angles (e.g. "how it was built" vs "how it is governed"). ' +
        'Watch for antonym gaps: searching 记忆 misses 失忆/压缩/丢失 — search the opposite angle separately if needed. ' +
        'SEARCH TIPS — coverage/source-map tasks: this is not an exhaustive all-mentions entrypoint. If the user asks "哪些 / 所有 / 历史上 / 提过 / 沉淀", follow the memory-search-best-practices skill: expand terms yourself, search docs + threads separately, then drill into canonical docs/source threads and report coverage gaps. ' +
        'READING RESULTS: matchRank = rank-based match position, retrievalScore = store score when available, authority = document reliability, updated = source freshness. These are independent axes. ' +
        'RANKING (F200 live): Results are consumption-weighted — docs that cats actually read/used after searching rank higher. Constitutional docs (ADR/lesson/canon) never get demoted. New docs have 14-day grace period. Near-duplicates are MMR-deduplicated for diversity. No action needed — ranking is automatic. ' +
        'DEPTH: Start with summary (default). Use depth=raw only after narrowing scope to drill into specific passages. ' +
        'BOUNDARY: Use this tool to FIND information across the project. For READING raw messages in a specific thread, use get_thread_context instead. ' +
        'F188 PHASE F 7-TOOL FAMILY (cross-reference, choose by scenario): ' +
        'precise anchor + relations → cat_cafe_graph_resolve; ' +
        'zero-prior / scan recent → cat_cafe_list_recent; ' +
        'this tool (search_evidence) = semantic/fuzzy find; ' +
        'session drill-down → list_session_chain / read_session_digest / read_session_events / read_invocation_detail. ' +
        'When this tool returns no results or only low match-rank hits, payload appends a deterministic nudge pointing to graph_resolve/list_recent (KD-7).',
      action: 'read',
      risk: { level: 'read', openWorld: true },
      inputSchema: searchEvidenceInputSchema,
      resourceFamily: 'evidence-navigation',
      runtimeProfiles: ['full', 'readonly', 'desktop:fable-phase0', 'desktop:cloud-pro-phase0'],
      admissionRef: F209,
      sourceExport: 'handleSearchEvidence',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/evidence/search',
        paramKeys: [
          'query',
          'limit',
          'scope',
          'mode',
          'depth',
          'dateFrom',
          'dateTo',
          'contextWindow',
          'threadId',
          'dimension',
          'collections',
          'explain',
          'intent',
          'coverage_offset',
          'include_expansion',
        ],
      },
    },
  ]);
}