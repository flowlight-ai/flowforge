/**
 * signals/signals toolset (EP1-1b, B6).
 *
 * Migrated from clowder `tools/signals-tools.ts` (sourced from the clowder
 * migration-factory path, now canonical-injected). Five tools (bare `signal_*`
 * names, no `cat_cafe_` prefix, kept verbatim):
 *   - signal_list_inbox:   GET    `/api/signals/inbox`
 *   - signal_get_article:  GET    `/api/signals/articles/${id}` (or by-url variant, see note)
 *   - signal_search:       GET    `/api/signals/search`
 *   - signal_mark_read:    PATCH→POST `/api/signals/articles/${id}` (see note)
 *   - signal_summarize:    derive-orchestration POST `/api/signals/articles/${id}` (see note)
 * Resource family `signal-article`.
 *
 * NOTE(E2b signals): the source reads host env (`CAT_CAFE_API_URL`,
 * `CAT_CAFE_SIGNAL_USER`) and injects an `X-Cat-Cafe-User` signing header on every
 * request. The baseUrl and signing header are host-layer concerns and are NOT
 * ported here — the host injects them when wiring the outbound transport.
 *
 * RECONCILIATION (non-standard fetches):
 *   - `handleSignalMarkRead` issued a `PATCH` with a constant `{status:'read'}`
 *     body (no input-derived keys). The callback port only carries POST/GET, so
 *     the mutation is downgraded to a POST with `bodyKeys: []` — the constant
 *     body is host-layer (see assemble/README §调和法).
 *   - `handleSignalSummarize` is a two-step orchestration (GET article → local
 *     derive summary → PATCH persist). Only the write effect is ported as a POST;
 *     the read-then-derive sequencing is host-layer orchestration.
 *   - `handleSignalGetArticle` selects between `/articles/${id}` and the by-url
 *     route based on which input is present. Only the `\${id}` route is ported;
 *     the shared-link `by-url` variant is not representable as one static route.
 *   - `handleSignalSearch` queried `?q=<query>`; the thin invoker forwards params
 *     by input key, so the search key is forwarded as `query` (renamed from `q`).
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const signalListInboxInputSchema = {
  limit: z.number().int().min(1).max(100).optional().describe('Max inbox items to return (default: 20)'),
  tier: z.enum(['1', '2', '3', '4']).optional().describe('Filter by signal tier (1-4)'),
  source: z.string().min(1).max(200).optional().describe('Filter by source id'),
};

const signalGetArticleInputSchema = {
  id: z.string().min(1).optional().describe('Signal article id'),
  url: z.string().url().optional().describe('Signal article url (alternative to id)'),
};

const signalSearchInputSchema = {
  query: z.string().min(1).max(500).describe('Search query string'),
  limit: z.number().int().min(1).max(100).optional().describe('Max search results (default: 20)'),
  status: z.enum(['inbox', 'read', 'starred', 'archived']).optional().describe('Filter by signal article status'),
  source: z.string().min(1).max(200).optional().describe('Filter by source id'),
  tier: z.enum(['1', '2', '3', '4']).optional().describe('Filter by signal tier (1-4)'),
  dateFrom: z.string().optional().describe('ISO date/time lower bound for fetchedAt'),
  dateTo: z.string().optional().describe('ISO date/time upper bound for fetchedAt'),
};

const signalMarkReadInputSchema = {
  id: z.string().min(1).describe('Signal article id'),
};

const signalSummarizeInputSchema = {
  id: z.string().min(1).describe('Signal article id'),
  maxLength: z.number().int().min(100).max(1200).optional().describe('Maximum summary length (default: 280)'),
};

export const SIGNALS_SERVER_FAMILY = 'signals' as const;
// Admission/certificate evidence: this canonical-injected catalog mirrors clowder's
// `tools/signals-tools.ts` (via `defineMcpMigrationFactory`), now sourced here.
const SIGNALS_REF = 'file:packages/mcp/mcp-server/src/toolsets/signals/signals.ts' as const;

export function buildSignalsToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, SIGNALS_SERVER_FAMILY, [
    {
      name: 'signal_list_inbox',
      description:
        'List recent signal articles from inbox. Use when co-creator asks to check signals, or when you need to browse unread articles. ' +
        'Supports optional limit, tier, and source filters. ' +
        'TIER GUIDE: T1 = critical/breaking, T2 = important, T3 = interesting, T4 = low priority. ' +
        'Returns article IDs needed for other signal tools (get_article, mark_read, start_study).',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: signalListInboxInputSchema,
      resourceFamily: 'signal-article',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: SIGNALS_REF,
      sourceExport: 'handleSignalListInbox',
      authorizationHint: 'local-operator',
      route: { method: 'GET', path: '/api/signals/inbox', paramKeys: ['limit', 'tier', 'source'] },
    },
    {
      name: 'signal_get_article',
      description:
        'Get full signal article detail by id or URL. Returns title, content, source, tier, timestamps, and metadata. ' +
        'Use when you need to read the full content of a specific article. ' +
        'PARAM GUIDE: Use id (from list_inbox/search results) OR url (if co-creator shared a link) — not both.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: signalGetArticleInputSchema,
      resourceFamily: 'signal-article',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: SIGNALS_REF,
      sourceExport: 'handleSignalGetArticle',
      authorizationHint: 'local-operator',
      route: { method: 'GET', path: '/api/signals/articles/${id}', paramKeys: [] },
    },
    {
      name: 'signal_search',
      description:
        'Search signal articles by keyword with optional filters (status, source, tier, date range). ' +
        'Use when looking for articles about a specific topic across all statuses. ' +
        'TIP: Combine with dateFrom/dateTo for time-bounded searches (ISO date format).',
      action: 'read',
      risk: { level: 'read', openWorld: true },
      inputSchema: signalSearchInputSchema,
      resourceFamily: 'signal-article',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: SIGNALS_REF,
      sourceExport: 'handleSignalSearch',
      authorizationHint: 'local-operator',
      route: {
        method: 'GET',
        path: '/api/signals/search',
        paramKeys: ['query', 'limit', 'status', 'source', 'tier', 'dateFrom', 'dateTo'],
      },
    },
    {
      name: 'signal_mark_read',
      description:
        'Mark a signal article as read. Use after you or co-creator have reviewed an article. ' +
        'This removes it from the inbox view.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: signalMarkReadInputSchema,
      resourceFamily: 'signal-article',
      runtimeProfiles: ['full'],
      admissionRef: SIGNALS_REF,
      sourceExport: 'handleSignalMarkRead',
      authorizationHint: 'local-operator',
      route: { method: 'POST', path: '/api/signals/articles/${id}', bodyKeys: [] },
    },
    {
      name: 'signal_summarize',
      description:
        'Generate a concise summary for a signal article and persist it to article frontmatter. ' +
        'Use when an article needs a quick summary for later reference. ' +
        'Default maxLength is 280 chars (tweet-length). Increase for more detailed summaries (max 1200).',
      action: 'derive',
      risk: { level: 'write', openWorld: false },
      inputSchema: signalSummarizeInputSchema,
      resourceFamily: 'signal-article',
      runtimeProfiles: ['full'],
      admissionRef: SIGNALS_REF,
      sourceExport: 'handleSignalSummarize',
      authorizationHint: 'local-operator',
      route: { method: 'POST', path: '/api/signals/articles/${id}', bodyKeys: [] },
    },
  ]);
}