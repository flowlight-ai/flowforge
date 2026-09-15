/**
 * collab/auto-dream toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/auto-dream-tools.ts`. The handlers converged on
 * four callback routes:
 *   - settle_present_loop:  POST `/api/callbacks/auto-dream/settle`
 *   - read_diary:           GET  `/api/callbacks/auto-dream/diaries/${diaryId}`
 *   - list_diaries:         GET  `/api/callbacks/auto-dream/diaries` (query filters)
 *   - preview_cat_life:     POST `/api/callbacks/auto-dream/life-settings/preview`
 * Resource family `cat-life`. The nested F255 shapes that clowder sourced from
 * `@cat-cafe/shared` are reconstructed inline as zod-v4 objects (no cat-cafe dep).
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const dreamIdSchema = z.string().regex(/^dream_.+$/);
const dreamRunIdSchema = z.string().regex(/^dreamrun_.+$/);

const diaryDraftSchema = z
  .object({
    entryKind: z.string().min(1),
    traceKind: z.string().min(1),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    headline: z.string().trim().min(1).max(80),
  })
  .strict();

const sleepPostureDraftSchema = z
  .object({
    lastRoom: z.string().trim().min(1).max(1_000).optional(),
    curiosity: z.string().trim().min(1).max(2_000).optional(),
    unfinishedThought: z.string().trim().min(1).max(4_000).optional(),
    selfPromise: z.string().trim().min(1).max(2_000).optional(),
  })
  .passthrough();

const seedDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('adopt') }).passthrough(),
  z.object({ kind: z.literal('rewrite') }).passthrough(),
  z.object({ kind: z.literal('reject') }).passthrough(),
  z.object({ kind: z.literal('originate') }).passthrough(),
]);

const proactiveIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('silence') }).passthrough(),
  z.object({ kind: z.literal('body_language') }).passthrough(),
  z.object({ kind: z.literal('message') }).passthrough(),
]);

const catLifeSettingsInputSchema = z.object({ enabled: z.boolean().optional() }).passthrough();

const agentKeyCatIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Persistent-agent identity selector for owner-scoped diary reads; ignored under invocation auth.');

const settlePresentLoopToolInputSchema = {
  runId: dreamRunIdSchema.describe('Present Loop run identifier supplied by the hidden wake prompt.'),
  outcome: z
    .enum(['diary', 'quiet', 'daze'])
    .describe('Terminal private-time outcome; diary requires a diary draft, while quiet and daze forbid one.'),
  diary: diaryDraftSchema
    .optional()
    .describe('Cat-authored diary draft; required only when outcome is diary and forbidden otherwise.'),
  sleepPosture: sleepPostureDraftSchema
    .optional()
    .describe('Optional cat-authored continuity for the next wake. An explicitly empty object is valid.'),
  seedDecision: seedDecisionSchema
    .optional()
    .describe('Optional cat-only adopt, rewrite, reject, or originate decision for one private cue/seed.'),
  intent: proactiveIntentSchema
    .optional()
    .describe('Optional silence, body-language, or canonical-message intent with one reversible first action.'),
};

const readDiaryToolInputSchema = {
  diaryId: dreamIdSchema,
  agentKeyCatId: agentKeyCatIdSchema,
};

const listDiariesToolInputSchema = {
  catId: z.string().min(1).max(120).optional().describe('Filter diaries within the authenticated owner by author cat.'),
  includeArchived: z.boolean().optional().describe('Include archived pages; defaults to false.'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum pages to return; defaults to 20.'),
  agentKeyCatId: agentKeyCatIdSchema,
};

const previewCatLifeSettingsToolInputSchema = {
  catId: z.string().trim().min(1).max(120).describe('Cat whose private-time rhythm is being previewed.'),
  settings: catLifeSettingsInputSchema.describe(
    'Worldview-level rhythm, local wake time, IANA timezone, and optional quiet hours. Raw cron is intentionally unsupported.',
  ),
};

export const AUTO_DREAM_SERVER_FAMILY = 'collab' as const;

export function buildAutoDreamToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, AUTO_DREAM_SERVER_FAMILY, [
    {
      name: 'cat_cafe_settle_present_loop',
      description:
        'Settle the current F255 private-time wake as diary, quiet, or daze, with optional sleep posture, seed decision, and proactive intent. ' +
        'Use when: the hidden Present Loop wake prompt gives you a runId and your private time reaches a natural stopping point. ' +
        "NOT for: ordinary task completion, system-written summaries, another cat's run, or creating a diary outside a live wake. " +
        'Output: the terminal run plus any diary, continuity, owned-seed, intent, visit, and canonical-message references. ' +
        'GOTCHA: invocation callback auth is mandatory and supplies owner, cat, and thread identity; quiet and daze must not include a diary.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: settlePresentLoopToolInputSchema,
      resourceFamily: 'cat-life',
      runtimeProfiles: ['full'],
      admissionRef: 'file:docs/features/F255-private-time-wake.md',
      sourceExport: 'handleSettlePresentLoop',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/auto-dream/settle',
        bodyKeys: ['runId', 'outcome', 'diary', 'sleepPosture', 'seedDecision', 'intent'],
      },
    },
    {
      name: 'cat_cafe_read_diary',
      description:
        'Read one immutable F255 diary page owned by the authenticated user, including provenance and historical-time markers. ' +
        'Use when: evidence search returns a cat_cafe_read_diary drill-down or you already have an exact dream_ diaryId. ' +
        "NOT for: semantic discovery (use search_evidence), guessing another user's pages, or treating an old page as a current belief. " +
        'Output: the full page or not-found without cross-owner disclosure. ' +
        'GOTCHA: diary text is an uncleaned historical scene; check provenance before reusing its claims.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: readDiaryToolInputSchema,
      resourceFamily: 'cat-life',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: 'file:docs/features/F255-private-time-wake.md',
      sourceExport: 'handleReadDiary',
      authorizationHint: 'read-only',
      standaloneKind: 'progressive-disclosure',
      route: { method: 'GET', path: '/api/callbacks/auto-dream/diaries/${diaryId}', paramKeys: [] },
    },
    {
      name: 'cat_cafe_list_diaries',
      description:
        'List recent F255 diary pages for the authenticated owner, optionally filtered by author cat and archive status. ' +
        'Use when: browsing the diary as a book or locating a recent page before exact read. ' +
        'NOT for: project-wide semantic recall, ranking cats, or inferring productivity from page counts. ' +
        'Output: bounded diary metadata plus the owner-scoped reportification warning, which is observability only. ' +
        'GOTCHA: archived pages are omitted unless includeArchived=true; catId filters authorship inside the current owner only.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listDiariesToolInputSchema,
      resourceFamily: 'cat-life',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: 'file:docs/features/F255-private-time-wake.md',
      sourceExport: 'handleListDiaries',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/callbacks/auto-dream/diaries',
        paramKeys: ['catId', 'includeArchived', 'limit'],
      },
    },
    {
      name: 'cat_cafe_preview_cat_life_settings',
      description:
        'Preview one cat’s F255 private-time rhythm and attach a user-confirmation card without changing configuration. ' +
        'Use when: the user asks in natural language to give a cat a bedtime, gentle rhythm, weekend rhythm, custom weekdays, or quiet hours. ' +
        'NOT for: raw cron or generic Schedule task creation, reading diaries, or silently enabling Present Loop. ' +
        'Output: a cost-and-next-wake preview plus an interactive confirm/cancel block attached to the current response. ' +
        'GOTCHA: preview and cancel create no active task; only the user-confirmed fixed decision callback writes F255 config—never substitute schedule tools.',
      action: 'derive',
      risk: { level: 'write', openWorld: false },
      inputSchema: previewCatLifeSettingsToolInputSchema,
      resourceFamily: 'cat-life',
      runtimeProfiles: ['full'],
      admissionRef: 'file:docs/features/F255-private-time-wake.md',
      sourceExport: 'handlePreviewCatLifeSettings',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/auto-dream/life-settings/preview',
        bodyKeys: ['catId', 'settings'],
      },
    },
  ]);
}