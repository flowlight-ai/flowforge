/**
 * collab/paw-feel-disposition toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/paw-feel-disposition-tools.ts` (F278). The F278
 * responsibility-inbox enums clowder imported from `@cat-cafe/shared` are inlined
 * here as zod-v4 enums. Three handlers:
 *   - capture: POST `/api/callbacks/paw-feel-capture-intent`
 *   - list:    GET  `/api/callbacks/paw-feel-inbox`
 *   - triage:  POST `/api/callbacks/paw-feel-bundle-triage`
 * Resource family `eval-feedback`.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const PAW_FEEL_DISPOSITION_STATES = [
  'new',
  'seen',
  'route_pending',
  'routed',
  'closed',
  'duplicate',
  'no_action',
  'fix',
  'signature_waiting',
  'blocked',
] as const;
const PAW_FEEL_INBOX_SORTS = ['newest', 'oldest'] as const;
const PAW_FEEL_NO_ACTION_REASONS = [
  'working_as_intended',
  'insufficient_evidence',
  'out_of_scope',
  'superseded',
  'not_actionable',
  'parser_false_positive',
] as const;

const nonEmpty = z.string().trim().min(1);
const agentKeyCatIdSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    'Persistent-agent identity selector. Required for shared agent-key MCP variants; ignored under invocation auth.',
  );

const terminalActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('duplicate'),
      duplicateOf: nonEmpty.describe('Existing canonical signalId that this report duplicates.'),
    })
    .strict(),
  z
    .object({
      type: z.literal('no_action'),
      reasonCode: z.enum(PAW_FEEL_NO_ACTION_REASONS).describe('Canonical reason this report needs no action.'),
    })
    .strict(),
  z
    .object({
      type: z.literal('fix'),
      leaseId: nonEmpty.describe(
        'Active F167 implement/task_done lease whose owner, task, and custody are authoritative.',
      ),
    })
    .strict(),
]);

const bundleActionSchema = z.discriminatedUnion('type', [
  ...terminalActionSchema.options,
  z
    .object({
      type: z.literal('request_signature'),
      action: terminalActionSchema.describe('Exact terminal candidate that an independent cat must sign.'),
      preferredSignerCatId: nonEmpty
        .optional()
        .describe('Optional routing preference; any legal independent signer can recover the request.'),
    })
    .strict(),
  z
    .object({
      type: z.literal('block'),
      blockerCode: nonEmpty.describe('Stable machine-readable blocker category.'),
      blockerRef: nonEmpty.describe('Auditable reference proving the blocker.'),
    })
    .strict(),
]);

const bundleMemberSchema = z
  .object({
    signalId: nonEmpty.describe('Exact signalId returned in the listed bundle snapshot.'),
    expectedSequence: z.number().int().nonnegative().describe('CAS sequence returned for this signal.'),
  })
  .strict();

const listPawFeelInboxInputSchema = {
  states: z.array(z.enum(PAW_FEEL_DISPOSITION_STATES)).min(1).optional().describe('Optional state filter.'),
  sourceCatId: nonEmpty.optional().describe('Optional reporting-cat filter.'),
  sourceMessageId: nonEmpty.optional().describe('Optional exact original-message filter.'),
  overdueOnly: z.boolean().optional().describe('Return only active reports at least 72h old.'),
  limit: z.number().int().min(1).max(50).optional().describe('Review bundles per page; defaults to 50.'),
  cursor: nonEmpty.optional().describe('Opaque bundle-level nextCursor from a previous page.'),
  sort: z.enum(PAW_FEEL_INBOX_SORTS).optional().describe('Newest or oldest active bundles first.'),
  agentKeyCatId: agentKeyCatIdSchema,
};

const capturePawFeelInputSchema = {};

const triagePawFeelInputSchema = {
  bundleKey: nonEmpty.describe('Authoritative bundleKey returned by cat_cafe_list_paw_feel_inbox.'),
  membershipToken: nonEmpty.describe('Server-authenticated exact membership snapshot returned with the bundle.'),
  eventIdPrefix: nonEmpty.describe('Stable idempotency prefix for this one bundle confirmation.'),
  members: z
    .array(bundleMemberSchema)
    .min(1)
    .max(50)
    .describe('Exact signalId + sequence snapshot returned in the review bundle.'),
  action: bundleActionSchema.describe(
    'One common terminal action, durable independent-signature request, or explicit blocker.',
  ),
  exceptions: z
    .array(
      z
        .object({
          signalId: nonEmpty.describe('Bundle member whose action differs from the common action.'),
          action: bundleActionSchema.describe('Replacement action for this one member.'),
        })
        .strict(),
    )
    .max(50)
    .optional()
    .describe('Only members whose action differs from the common action. O(exceptions).'),
  agentKeyCatId: agentKeyCatIdSchema,
};

export const PAW_FEEL_DISPOSITION_SERVER_FAMILY = 'collab' as const;
const F278 = 'file:docs/features/F278-paw-feel-inbox.md' as const;

export function buildPawFeelDispositionToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, PAW_FEEL_DISPOSITION_SERVER_FAMILY, [
    {
      name: 'cat_cafe_capture_paw_feel',
      description:
        'Declare that the current authenticated invocation will include an intentional paw-feel report in its normal final response. ' +
        'Use when: this turn encountered real tool/runtime friction and the final response will contain each intentional marker on its own standalone line. ' +
        'NOT for: supplying symptom prose, copying a marker, agent-key sessions without an invocation, or capturing another cat. Agent-key sessions leave the standalone source marker without calling this tool; bounded append compatibility keeps it visible as ambiguous. ' +
        'Output: a short-lived server-owned intent; after the final response persists, the sidecar binds its generated sourceMessageId and writes confirmed typed rows. ' +
        'GOTCHA: call before the final response; no future message ID or marker body is accepted, and inline/fenced/blockquote examples remain legacy-ambiguous rather than typed-confirmed.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: capturePawFeelInputSchema,
      resourceFamily: 'eval-feedback',
      runtimeProfiles: ['full'],
      admissionRef: F278,
      sourceExport: 'handleCapturePawFeel',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/paw-feel-capture-intent', bodyKeys: [] },
    },
    {
      name: 'cat_cafe_list_paw_feel_inbox',
      description:
        'List the F278 responsibility inbox as deterministic contextual review bundles with all raw reports preserved. ' +
        'Use when: you are the named duty cat reviewing original evidence, aging reports, or prior dispositions. ' +
        'NOT for: semantic problem-family counts, copying marker bodies, or treating transport receipt as a fix. ' +
        'Output: bundles, raw occurrences, unique sources, historical/post-activation intake, ambiguity counts, duty evidence, and bundle-level pagination. ' +
        'GOTCHA: problemFamilies is unavailable until an authoritative grouping contract exists.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listPawFeelInboxInputSchema,
      resourceFamily: 'eval-feedback',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F278,
      sourceExport: 'handleListPawFeelInbox',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/callbacks/paw-feel-inbox',
        paramKeys: ['states', 'sourceCatId', 'sourceMessageId', 'overdueOnly', 'limit', 'cursor', 'sort'],
      },
    },
    {
      name: 'cat_cafe_triage_paw_feel',
      description:
        'Confirm one authoritative F278 bundle in O(1) common action plus O(exceptions) member splits. ' +
        'Use when: you reviewed the bundle source evidence and can choose a terminal action, a verified repair binding, an independent-signature request, or an explicit blocker. ' +
        'NOT for: routine owner-thread discovery, old routed/closed commands, guessing an owner, or signing your own report terminal. ' +
        'Output: ordered appended/duplicate/conflict/rejected results plus duty-receipt status; a signature request remains active and keeps the receipt open until an independent signer finishes it or an explicit blocker is recorded. ' +
        'GOTCHA: member IDs, sequences, and membershipToken form the exact list snapshot; late members remain untouched.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: triagePawFeelInputSchema,
      resourceFamily: 'eval-feedback',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F278,
      sourceExport: 'handleTriagePawFeel',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/paw-feel-bundle-triage',
        bodyKeys: ['bundleKey', 'membershipToken', 'eventIdPrefix', 'members', 'action', 'exceptions'],
      },
    },
  ]);
}