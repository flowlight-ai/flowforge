/**
 * signals/signal-study toolset (EP1-1b, B6).
 *
 * Migrated from clowder `tools/signal-study-tools.ts` (sourced from the clowder
 * migration-factory path, now canonical-injected). Seven tools (bare
 * `signal_study_*`/`signal_*` names, kept verbatim):
 *   - signal_update_article: PATCH→POST `/api/signals/articles/${id}`
 *   - signal_delete_article: POST `/api/signals/articles/batch`
 *   - signal_link_thread:    POST `/api/signals/articles/${articleId}/threads` (unlink branch → DELETed)
 *   - signal_start_study:    orchestration POST `/api/signals/articles/${articleId}/threads`
 *   - signal_save_notes:     PATCH→POST `/api/signals/articles/${id}`
 *   - signal_list_studies:   GET `/api/signals/articles/${articleId}/study`
 *   - signal_generate_podcast: POST `/api/signals/articles/${articleId}/podcast`
 * Resource families `signal-article` / `signal-study` (per-tool).
 *
 * NOTE(E2b signals): same as signals.ts — host env (`CAT_CAFE_API_URL`,
 * `CAT_CAFE_SIGNAL_USER`) and the `X-Cat-Cafe-User` signing header are host-layer
 * concerns, NOT ported; the host injects baseUrl + signing header on the outbound
 * transport.
 *
 * RECONCILIATION (non-standard fetches):
 *   - `handleUpdateArticle` / `handleSaveNotes` issued `PATCH`; downgraded to POST
 *     (assemble/README §调和法). `handleSaveNotes` also runs a study-GET before the
 *     PATCH and writes the body key as `note` from input `notes` — the thin invoker
 *     forwards body by input key, so the field is forwarded as `notes` (renamed).
 *   - `handleLinkThread` branches on `action`: `unlink` → DELETE the thread link,
 *     `link` (default) → POST. Only the link POST is ported as one static route;
 *     the unlink DELETed variant is host-layer.
 *   - `handleStartStudy` is a two-step orchestration (GET article → optional link
 *     thread → format). Only its write effect (link thread POST) is ported; the
 *     read+format portion is host-layer orchestration.
 *   - `handleListStudies` only fetches the per-article study route when `articleId`
 *     is present (the cross-article branch returns a static string, no fetch).
 *   - `signal_delete_article` sends a constant `action:'delete'` alongside `ids`;
 *     only the input-derived `ids` is forwarded, the constant is host-layer.
 *   - `signal_generate_podcast` vets `speakers` only in its reply text; the body is
 *     `{mode}` so only `mode` is forwarded.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const signalUpdateArticleInputSchema = {
  id: z.string().min(1).describe('Article ID'),
  status: z.enum(['inbox', 'read', 'archived', 'starred']).optional().describe('New status'),
  tags: z.array(z.string()).optional().describe('Replace tags'),
  note: z.string().optional().describe('co-creator个人备注'),
};

const signalDeleteArticleInputSchema = {
  ids: z.array(z.string().min(1)).min(1).describe('Article IDs to soft-delete'),
};

const signalLinkThreadInputSchema = {
  articleId: z.string().min(1).describe('Article ID'),
  threadId: z.string().min(1).describe('Thread ID to link/unlink'),
  action: z.enum(['link', 'unlink']).optional().default('link').describe('Link or unlink'),
};

const signalStartStudyInputSchema = {
  articleId: z.string().min(1).describe('Article ID to study'),
  threadId: z.string().optional().describe('Thread to link (omit for no thread link)'),
};

const signalSaveNotesInputSchema = {
  articleId: z.string().min(1).describe('Article ID'),
  notes: z.string().min(1).describe('Markdown study notes'),
  participants: z.array(z.string()).optional().describe('Cat IDs who participated'),
};

const signalListStudiesInputSchema = {
  articleId: z.string().optional().describe('Filter by article'),
  kind: z.enum(['note', 'podcast', 'research-report']).optional().describe('Filter by artifact kind'),
  limit: z.number().int().min(1).max(50).optional().describe('Max results'),
};

const signalGeneratePodcastInputSchema = {
  articleId: z.string().min(1).describe('Article ID'),
  mode: z.enum(['essence', 'deep']).describe('Podcast mode: essence (2-3 min) or deep (10 min)'),
  speakers: z.array(z.string()).optional().describe('Cat IDs for voices (1-3)'),
};

export const SIGNAL_STUDY_SERVER_FAMILY = 'signals' as const;
// Admission/certificate evidence: mirrors clowder `tools/signal-study-tools.ts`.
const SIGNAL_STUDY_REF = 'file:packages/mcp/mcp-server/src/toolsets/signals/signal-study.ts' as const;

export function buildSignalStudyToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, SIGNAL_STUDY_SERVER_FAMILY, [
    {
      name: 'signal_update_article',
      description:
        'Update article fields: status, tags, or note. Use for managing articles from chat. ' +
        'STATUS VALUES: inbox (unread), read, starred (important), archived (done). ' +
        'TIP: Use tags for categorization (e.g. ["ai", "infrastructure"]) and note for co-creator personal remarks.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: signalUpdateArticleInputSchema,
      resourceFamily: 'signal-article',
      runtimeProfiles: ['full'],
      admissionRef: SIGNAL_STUDY_REF,
      sourceExport: 'handleUpdateArticle',
      authorizationHint: 'local-operator',
      route: { method: 'POST', path: '/api/signals/articles/${id}', bodyKeys: ['status', 'tags', 'note'] },
    },
    {
      name: 'signal_delete_article',
      description:
        'Soft-delete one or more articles. Use when co-creator wants to clean up garbage or irrelevant signals. ' +
        'Accepts multiple IDs for batch deletion. Articles are soft-deleted (recoverable).',
      action: 'close',
      risk: { level: 'destructive', openWorld: false },
      inputSchema: signalDeleteArticleInputSchema,
      resourceFamily: 'signal-article',
      runtimeProfiles: ['full'],
      admissionRef: SIGNAL_STUDY_REF,
      sourceExport: 'handleDeleteArticle',
      authorizationHint: 'local-operator',
      route: { method: 'POST', path: '/api/signals/articles/batch', bodyKeys: ['ids'] },
    },
    {
      name: 'signal_link_thread',
      description:
        'Link or unlink a Signal article to/from a thread for Study association. ' +
        'Use when starting to discuss an article in a specific thread, so the study context is trackable. ' +
        'Default action is "link"; pass action="unlink" to remove the association.',
      action: 'command',
      risk: { level: 'destructive', openWorld: false },
      inputSchema: signalLinkThreadInputSchema,
      resourceFamily: 'signal-article',
      runtimeProfiles: ['full'],
      admissionRef: SIGNAL_STUDY_REF,
      sourceExport: 'handleLinkThread',
      authorizationHint: 'local-operator',
      route: { method: 'POST', path: '/api/signals/articles/${articleId}/threads', bodyKeys: ['threadId'] },
    },
    {
      name: 'signal_start_study',
      description:
        'Start studying a Signal article. Returns full article content for context injection and optionally links a thread. ' +
        'WORKFLOW: start_study → read and discuss → save_notes → optionally generate_podcast. ' +
        'Use this as the entry point for deep-diving into an article.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: signalStartStudyInputSchema,
      resourceFamily: 'signal-study',
      runtimeProfiles: ['full'],
      admissionRef: SIGNAL_STUDY_REF,
      sourceExport: 'handleStartStudy',
      authorizationHint: 'local-operator',
      route: { method: 'POST', path: '/api/signals/articles/${articleId}/threads', bodyKeys: ['threadId'] },
    },
    {
      name: 'signal_save_notes',
      description:
        'Save study notes for an article. Notes should include insights, reflections, and open questions from the study session. ' +
        'Use after discussing/analyzing an article. Include participants array to credit who studied it.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: signalSaveNotesInputSchema,
      resourceFamily: 'signal-study',
      runtimeProfiles: ['full'],
      admissionRef: SIGNAL_STUDY_REF,
      sourceExport: 'handleSaveNotes',
      authorizationHint: 'local-operator',
      route: { method: 'POST', path: '/api/signals/articles/${id}', bodyKeys: ['notes'] },
    },
    {
      name: 'signal_list_studies',
      description:
        'List study artifacts (notes, podcasts, research reports) for an article. ' +
        'Use to check what study work has already been done on an article. ' +
        'TIP: Pass articleId to narrow results to a specific article; omit to list studies across all articles.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: signalListStudiesInputSchema,
      resourceFamily: 'signal-article',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: SIGNAL_STUDY_REF,
      sourceExport: 'handleListStudies',
      authorizationHint: 'local-operator',
      route: { method: 'GET', path: '/api/signals/articles/${articleId}/study', paramKeys: ['kind', 'limit'] },
    },
    {
      name: 'signal_generate_podcast',
      description:
        'Generate a podcast from an article study. ' +
        'MODE SELECTION: essence = 2-3 min quick overview, deep = 10 min thorough analysis. ' +
        'Optional speakers param takes cat IDs for voice assignments (1-3 speakers). ' +
        'Returns an artifact ID and state (queued → processing → complete).',
      action: 'derive',
      risk: { level: 'write', openWorld: true },
      inputSchema: signalGeneratePodcastInputSchema,
      resourceFamily: 'signal-study',
      runtimeProfiles: ['full'],
      admissionRef: SIGNAL_STUDY_REF,
      sourceExport: 'handleGeneratePodcast',
      authorizationHint: 'local-operator',
      route: {
        method: 'POST',
        path: '/api/signals/articles/${articleId}/podcast',
        bodyKeys: ['mode'],
      },
    },
  ]);
}