/**
 * collab/callback toolset (EP1-1b, B4).
 *
 * Migrated from clowder `tools/callback-tools.ts` (the `callbackTools` array's 49
 * directly defined tools; the person-memory / memory-cue sub-toolsets spread into
 * that array from their own files are NOT ported here — they belong to the memory
 * family). This is the last and largest collab tool group.
 *
 * All 47 handlers converge on `callbackPost` / `callbackGet` except one:
 * `handleSetReadMode` (cat_cafe_set_read_mode) writes a session-scoped mode file
 * on the MCP node directly (`/tmp/cat-cafe-anchor-mode-${invocationId}`) rather
 * than issuing an outbound callback. It is reconciled here as a synthetic POST
 * route (`/api/callbacks/set-read-mode`) so the host transport may optionally
 * implement the anchor-mode side effect; the descriptor-route mapping stays
 * uniform across the group.
 *
 * `handleCrossPostMessage` reuses the shared `_executePostMessage` primitive, so
 * its outbound path is the same `/api/callbacks/post-message` endpoint as
 * `cat_cafe_post_message`.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared credential-selector schema.
// ─────────────────────────────────────────────────────────────────────────────
const agentKeyCatId = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Persistent-agent identity selector. Required for shared Antigravity MCP (antigravity or antig-opus) so agent-key auth uses the matching sidecar key; otherwise callback config fails closed. Ignored when full invocation credentials are present.',
  );

// ─────────────────────────────────────────────────────────────────────────────
// local-review anchor schema family (from @cat-cafe/shared local-review.ts).
// ─────────────────────────────────────────────────────────────────────────────
const REVIEW_SUBJECT_REF = /^[a-z][a-z0-9_-]*:[^\s]{1,220}$/;

const localReviewVerdictSchema = z.enum(['approved', 'changes_requested', 'commented']);

const reviewSubjectRefSchema = z
  .string()
  .regex(REVIEW_SUBJECT_REF)
  .describe('Stable local-review subject, for example pr:owner/repo#123.');

const acceptedSourceRefSchema = z
  .string()
  .min(1)
  .max(300)
  .describe('Accepted feature-document path or immutable threadId#messageId source.');

const acceptedRevisionSchema = z
  .string()
  .min(1)
  .max(200)
  .describe('Exact feature Git OID or immutable source message id.');

const reviewedHeadShaSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
  .describe(
    'Reviewer-authored exact lowercase 40- or 64-character Git OID. Required with localReviewVerdict; merge-gate compares it with the current HEAD.',
  );

const coordinationSchema = z
  .object({
    phase: z
      .enum(['active', 'terminal'])
      .describe('active continues coordination; terminal closes it after one final routed delivery.'),
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional()
      .describe('Existing coordination id to continue explicitly. Usually omit: the server mints/inherits it.'),
    subjectRef: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .optional()
      .describe('Stable action subject. A different subject starts a new coordination generation.'),
  })
  .optional();

// ─────────────────────────────────────────────────────────────────────────────
// action-successor schema family (from @cat-cafe/shared action-subject-ref.ts /
// action-successor.ts / executable-action-successor.ts).
// ─────────────────────────────────────────────────────────────────────────────
const ACTION_SUBJECT_REF_DESCRIPTION =
  'subjectRef must use pr:<owner>/<repo>#<positive-number> (for example pr:zts212653/cat-cafe#2943) ' +
  'or subject:<namespace>:<opaque-id>. GitHub URL forms and SHA suffixes such as github:owner/repo#2943@abc123 are invalid.';

const ACTION_SUBJECT_REF_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: U+001F is the identity-key delimiter and must be excluded explicitly.
  /^(?:pr:[^/\s\x1f]+\/[^#\s\x1f]+#[1-9]\d*|subject:[a-z][a-z0-9_-]{0,63}:[^\s\x1f]{1,200})$/i;

const actionSubjectRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(ACTION_SUBJECT_REF_PATTERN, ACTION_SUBJECT_REF_DESCRIPTION)
  .describe(ACTION_SUBJECT_REF_DESCRIPTION);

const EXECUTABLE_ACTION_SUCCESSOR_CONTRACT_DESCRIPTION =
  'Direct executable action custody is closed to implement + implementer + task_done. ' +
  'Local cat review uses an ordinary durable handoff with localReviewVerdict + reviewedHeadSha + accepted-source fields; external review enters through an approved proposedAction and records its verdict through the external-review contract. ' +
  'review/reviewer, merge/pr_merged, and every other reserved pair are unavailable on direct carriers.';

const ACTION_SUCCESSOR_ACTION_FAMILIES = [
  'review',
  'merge',
  'investigate',
  'implement',
  'verify',
  'vision_guard',
] as const;

const ACTION_SUCCESSOR_SLOTS = [
  'reviewer',
  'merge_owner',
  'investigator',
  'implementer',
  'verifier',
  'vision_guardian',
] as const;

type ActionSuccessorActionFamily = (typeof ACTION_SUCCESSOR_ACTION_FAMILIES)[number];
type ActionSuccessorSlot = (typeof ACTION_SUCCESSOR_SLOTS)[number];

const canonicalGitObjectIdSchema = z.string().regex(
  /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/,
  'expected a canonical 40- or 64-character lowercase Git OID',
);

const actionTerminalPredicateInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pr_merged') }).strict(),
  z.object({ kind: z.literal('review_delivered'), headSha: canonicalGitObjectIdSchema }).strict(),
  z.object({ kind: z.literal('ci_passed'), headSha: canonicalGitObjectIdSchema }).strict(),
  z
    .object({
      kind: z.literal('test_passed'),
      commandDigest: z.string().trim().min(1).max(128),
      revisionSha: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal('durable_verdict'),
      verdictRef: z.string().trim().min(1).max(300),
      freshnessKey: z.string().trim().min(1).max(200),
    })
    .strict(),
  z.object({ kind: z.literal('task_done') }).strict(),
]);

const ACTION_SLOTS: Record<ActionSuccessorActionFamily, ReadonlySet<ActionSuccessorSlot>> = {
  review: new Set(['reviewer']),
  merge: new Set(['reviewer', 'merge_owner', 'vision_guardian']),
  investigate: new Set(['investigator', 'reviewer']),
  implement: new Set(['implementer']),
  verify: new Set(['verifier', 'reviewer']),
  vision_guard: new Set(['vision_guardian']),
};

function isAllowedActionSuccessorSlot(
  actionFamily: ActionSuccessorActionFamily,
  successorSlot: string,
): successorSlot is ActionSuccessorSlot {
  return ACTION_SLOTS[actionFamily].has(successorSlot as ActionSuccessorSlot);
}

const actionSuccessorMetadataObjectSchema = z.object({
  subjectRef: actionSubjectRefSchema,
  actionFamily: z.enum(ACTION_SUCCESSOR_ACTION_FAMILIES),
  successorSlot: z.enum(ACTION_SUCCESSOR_SLOTS),
  mode: z.enum(['single', 'parallel']),
  parallelIntent: z.string().min(1).max(120).optional(),
  claimOrigin: z
    .enum(['structured_transfer', 'existing_standing'])
    .optional()
    .describe('Defaults to structured_transfer; existing_standing reuses the same custody CAS after grounding.'),
  groundingEvidenceRef: z
    .string()
    .min(1)
    .max(300)
    .optional()
    .describe('Required durable grounding evidence when claimOrigin=existing_standing.'),
  terminalPredicate: actionTerminalPredicateInputSchema
    .optional()
    .describe('Typed completion parameters; server catalog owns predicate semantics and subject binding.'),
  replace: z
    .object({
      leaseId: z.string().min(1).max(200),
      expectedGeneration: z.number().int().positive(),
    })
    .optional(),
  returnToPredecessor: z
    .object({
      leaseId: z.string().min(1).max(200),
      expectedGeneration: z.number().int().positive(),
      groundingEvidenceRef: z
        .string()
        .min(1)
        .max(300)
        .describe('Evidence that the current holder is not the correct owner.'),
    })
    .describe(
      'Reject current custody: single mode atomically returns to the predecessor; parallel mode terminates only the rejecting holder.',
    )
    .optional(),
});

type ActionSuccessorMetadataValue = z.infer<typeof actionSuccessorMetadataObjectSchema>;

function refineActionSuccessorMetadata(value: ActionSuccessorMetadataValue, ctx: z.RefinementCtx): void {
  if (!isAllowedActionSuccessorSlot(value.actionFamily, value.successorSlot)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['successorSlot'],
      message: `successor slot ${value.successorSlot} is not allowed for ${value.actionFamily}`,
    });
  }
  if (value.mode === 'parallel' && !value.parallelIntent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parallelIntent'],
      message: 'parallel action requires explicit parallelIntent',
    });
  }
  if (value.mode === 'single' && value.parallelIntent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parallelIntent'],
      message: 'single action cannot declare parallel intent',
    });
  }
  if (value.claimOrigin === 'existing_standing' && !value.groundingEvidenceRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['groundingEvidenceRef'],
      message: 'existing-standing claim requires groundingEvidenceRef',
    });
  }
  if (value.claimOrigin === 'existing_standing' && value.mode !== 'single') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['claimOrigin'],
      message: 'existing-standing claim requires single mode',
    });
  }
  if (value.returnToPredecessor && value.replace) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['returnToPredecessor'],
      message: 'return-to-predecessor and replace are mutually exclusive',
    });
  }
  if (value.returnToPredecessor && value.claimOrigin === 'existing_standing') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['claimOrigin'],
      message: 'return-to-predecessor is only valid for a structured transfer',
    });
  }
  if (!value.returnToPredecessor && !value.terminalPredicate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['terminalPredicate'],
      message: 'new action custody requires a typed terminalPredicate',
    });
  }
}

const executableTerminalPredicateSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('task_done') })]);
const executableActionSuccessorMetadataObjectSchema = actionSuccessorMetadataObjectSchema.extend({
  actionFamily: z.literal('implement'),
  successorSlot: z.literal('implementer'),
  terminalPredicate: executableTerminalPredicateSchema.optional(),
});

const executableActionSuccessorMetadataSchema = executableActionSuccessorMetadataObjectSchema.superRefine(
  (value, ctx) => {
    refineActionSuccessorMetadata(value, ctx);
    const kind = value.terminalPredicate?.kind;
    if (kind && kind !== 'task_done') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminalPredicate'],
        message: `${kind} is not executable for ${value.actionFamily}`,
      });
    }
  },
).describe(EXECUTABLE_ACTION_SUCCESSOR_CONTRACT_DESCRIPTION);

const PROPOSED_ACTION_EXECUTABLE_CONTRACT_DESCRIPTION =
  'Executable proposed action pairs are closed: external review + reviewer + review_delivered requires pr:<owner>/<repo>#<positive-number>; ' +
  'implement + implementer + task_done requires subject:task:<taskId>. Local cat review uses an ordinary durable handoff with localReviewVerdict + reviewedHeadSha + accepted-source fields.';

// ─────────────────────────────────────────────────────────────────────────────
// custody / entrusted-work schema family (from @cat-cafe/shared growing.ts /
// entrusted-work-actions.ts).
// ─────────────────────────────────────────────────────────────────────────────
const boundedRef = z.string().trim().min(1).max(1_000);
const boundedText = z.string().trim().min(1).max(4_000);
const revisionSchema = z.number().int().positive();
const timestampSchema = z.number().int().nonnegative().finite();

const growingSourceMessageRevisionV1Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const businessTimeFactSchema = z.object({ value: timestampSchema, sourceRef: boundedRef }).strict();

const entrustedWorkV1Schema = z
  .object({
    revision: revisionSchema,
    admission: z.discriminatedUnion('basis', [
      z
        .object({
          basis: z.literal('explicit_entrustment'),
          sourceRefs: z.array(boundedRef).min(1).max(64),
          idempotencyKey: boundedRef,
          receiptRef: boundedRef,
          admittedAt: timestampSchema,
        })
        .strict(),
      z
        .object({
          basis: z.literal('accepted_offer'),
          sourceRefs: z.array(boundedRef).min(1).max(64),
          idempotencyKey: boundedRef,
          receiptRef: boundedRef,
          admittedAt: timestampSchema,
        })
        .strict(),
      z
        .object({
          basis: z.literal('authorized_source'),
          authorityRef: boundedRef,
          sourceRefs: z.array(boundedRef).min(1).max(64),
          idempotencyKey: boundedRef,
          receiptRef: boundedRef,
          admittedAt: timestampSchema,
        })
        .strict(),
    ]),
    intendedOutcome: boundedText,
    time: z
      .object({
        businessDeadline: businessTimeFactSchema.optional(),
        reviewBy: businessTimeFactSchema.optional(),
      })
      .strict(),
    artifactRefs: z.array(boundedRef).max(64),
    closure: z.discriminatedUnion('state', [
      z
        .object({
          state: z.literal('open'),
          condition: boundedText,
          expectedSignal: boundedRef,
          evidenceRefs: z.array(boundedRef).max(64),
        })
        .strict(),
      z
        .object({
          state: z.literal('satisfied'),
          condition: boundedText,
          expectedSignal: boundedRef,
          evidenceRefs: z.array(boundedRef).min(1).max(64),
        })
        .strict(),
      z
        .object({
          state: z.literal('cancelled'),
          condition: boundedText,
          expectedSignal: boundedRef,
          evidenceRefs: z.array(boundedRef).max(64),
          disposition: z
            .object({
              kind: z.literal('cancelled'),
              actorKind: z.enum(['human', 'owner']),
              actorRef: boundedRef,
              authorityRef: boundedRef,
              dispositionRef: boundedRef,
              disposedAt: timestampSchema,
            })
            .strict(),
        })
        .strict(),
      z
        .object({
          state: z.literal('abandoned'),
          condition: boundedText,
          expectedSignal: boundedRef,
          evidenceRefs: z.array(boundedRef).max(64),
          disposition: z
            .object({
              kind: z.literal('abandoned'),
              actorKind: z.enum(['human', 'owner']),
              actorRef: boundedRef,
              authorityRef: boundedRef,
              dispositionRef: boundedRef,
              disposedAt: timestampSchema,
            })
            .strict(),
        })
        .strict(),
    ]),
  })
  .strict();

const custodyAdmissionRequestV1Schema = z.discriminatedUnion('basis', [
  z
    .object({
      basis: z.literal('explicit_entrustment'),
      sourceRefs: z.array(boundedRef).min(1).max(64),
      intendedOutcome: boundedText.optional(),
      timeHints: z
        .array(boundedText)
        .max(16)
        .optional()
        .describe('Verbatim source wording only; never canonical Task time and never sufficient for Schedule'),
      idempotencyKey: boundedRef,
    })
    .strict(),
  z
    .object({
      basis: z.literal('accepted_offer'),
      sourceRefs: z.array(boundedRef).min(1).max(64),
      intendedOutcome: boundedText.optional(),
      timeHints: z
        .array(boundedText)
        .max(16)
        .optional()
        .describe('Verbatim source wording only; never canonical Task time and never sufficient for Schedule'),
      offerId: boundedRef,
      sourceMessageRevision: growingSourceMessageRevisionV1Schema,
      idempotencyKey: boundedRef,
    })
    .strict(),
  z
    .object({
      basis: z.literal('authorized_source'),
      sourceRefs: z.array(boundedRef).min(1).max(64),
      intendedOutcome: boundedText.optional(),
      timeHints: z
        .array(boundedText)
        .max(16)
        .optional()
        .describe('Verbatim source wording only; never canonical Task time and never sufficient for Schedule'),
      authorityProvenance: z
        .object({
          grantRef: boundedRef,
          grantRevision: z.union([boundedRef, z.number().int().positive()]),
          producerRef: boundedRef,
          grantOwnerRef: boundedRef,
          grantOwnerRevision: z.union([boundedRef, z.number().int().positive()]),
          sourceRef: boundedRef,
          sourceRevision: z.union([boundedRef, z.number().int().positive()]),
          matchedScope: boundedRef,
          admissionAuthority: z.literal('task_admit_or_resume'),
          idempotencySource: z.enum(['source_ref_and_revision', 'producer_event_ref_and_revision']),
        })
        .strict(),
      idempotencyKey: boundedRef,
    })
    .strict(),
]);

const entrustedWorkClosureSpecV1Schema = z.object({ condition: boundedText, expectedSignal: boundedRef }).strict();

const entrustedWorkTerminalClosureV1Schema = entrustedWorkV1Schema.shape.closure.refine(
  (closure) => closure.state !== 'open',
  { message: 'closure action must be terminal' },
);

const entrustedWorkTerminalActionV1Schema = z
  .object({
    expectedRevision: z.number().int().positive(),
    closure: entrustedWorkTerminalClosureV1Schema,
  })
  .strict();

const entrustedWorkUpdateActionV1Schema = z
  .object({
    taskId: boundedRef,
    expectedRevision: z.number().int().positive(),
    time: z
      .object({
        businessDeadline: businessTimeFactSchema.nullable().optional(),
        reviewBy: businessTimeFactSchema.nullable().optional(),
      })
      .strict()
      .optional(),
    artifactRefs: z.array(boundedRef).max(64).optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// SOP definition constants (from @cat-cafe/shared sop-definition.generated.ts).
// ─────────────────────────────────────────────────────────────────────────────
const SOP_DEFINITION_IDS = ['development'] as const;
const DEVELOPMENT_SOP_STAGE_IDS = [
  'kickoff',
  'impl',
  'quality_gate',
  'fresh_context',
  'review',
  'merge',
  'completion',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Modular input schemas (field-name → zod shape).
// ─────────────────────────────────────────────────────────────────────────────
const postMessageInputSchema = {
  content: z.string().min(1).describe('The message content to post'),
  streamDisposition: z
    .enum(['independent', 'replace_final'])
    .optional()
    .default('independent')
    .describe(
      'How this callback relates to the provider final response. "independent" (DEFAULT) preserves a later final as a separate durable message. Use "replace_final" only when this callback is the canonical replacement for the same logical final response; route persistence then keeps one bubble and merges stream metadata into it.',
    ),
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Target thread ID. Required for agent-key auth (persistent agent with no default thread). Omit for invocation auth (defaults to invocation thread).',
    ),
  replyTo: z.string().optional().describe('Optional message ID to reply to'),
  clientMessageId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Optional idempotency key for at-least-once delivery de-duplication'),
  targetCats: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional explicit target cat IDs. Merged with @mentions parsed from content. Use get_thread_cats to discover valid catIds.',
    ),
  coordination: coordinationSchema.describe(
    'Invocation-token same-thread coordination lifecycle. Use active for a real handoff and terminal for the final result. A courtesy reply to terminal is persisted without waking the prior cat.',
  ),
  localReviewVerdict: localReviewVerdictSchema
    .optional()
    .describe(
      'Durable local-review fact. Requires clientMessageId, exact reviewedHeadSha, reviewSubjectRef, acceptedSourceRef, acceptedRevision, and an ordinary routed @author handoff.',
    ),
  reviewedHeadSha: reviewedHeadShaSchema.optional(),
  reviewSubjectRef: reviewSubjectRefSchema.optional(),
  acceptedSourceRef: acceptedSourceRefSchema.optional(),
  acceptedRevision: acceptedRevisionSchema.optional(),
  action: executableActionSuccessorMetadataSchema
    .optional()
    .describe(
      'Optional same-thread structured successor identity. New dispatches require mode=single; a parallel holder may use returnToPredecessor with one predecessor target to record only its rejected-ownership terminal. Requires explicit clientMessageId and exactly one targetCats entry.',
    ),
  agentKeyCatId,
  acknowledgeHeld: z
    .boolean()
    .optional()
    .describe(
      'F254 Freshness Gate escape hatch. Set to true to force-send your message even when the thread has unseen messages. Use only after reviewing the held envelope previews.',
    ),
};

const getPendingMentionsInputSchema = {
  includeAcked: z
    .boolean()
    .optional()
    .describe('When true, include acknowledged mentions for explicit history review.'),
  responseMode: z
    .enum(['anchor', 'full'])
    .optional()
    .describe(
      'Response projection mode. "anchor" (DEFAULT): head+tail excerpt with requiresDrill flag. "full": complete mention body (no truncation). Prefer anchor unless you need the full message.',
    ),
  agentKeyCatId: agentKeyCatId,
};

const ackMentionsInputSchema = {
  upToMessageId: z
    .string()
    .min(1)
    .describe(
      'The message ID up to which mentions have been processed. Must be within the last fetched pending window.',
    ),
  agentKeyCatId: agentKeyCatId,
};

const getThreadContextInputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(100)
    .describe('Number of recent messages to retrieve (default: 100, max: 200)'),
  cursor: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe('Opaque nextCursor from the immediately preceding read with the same thread, filters, and mode.'),
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe('Optional: read messages from a different thread. Omit to read the current thread.'),
  messageId: z
    .string()
    .min(1)
    .optional()
    .describe('Optional: open a bounded context window around a specific message in the selected thread.'),
  before: z
    .number()
    .int()
    .min(0)
    .max(50)
    .optional()
    .describe('When messageId is set, number of messages before the target to include (default: 3).'),
  after: z
    .number()
    .int()
    .min(0)
    .max(50)
    .optional()
    .describe('When messageId is set, number of messages after the target to include (default: 3).'),
  catId: z.string().min(1).optional().describe("Optional: filter by speaker catId, or pass 'user' for human messages."),
  keyword: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional: filter and rank messages by keyword relevance. Multi-word keywords are tokenized and scored (0-1).',
    ),
  responseMode: z
    .enum(['anchor', 'full'])
    .optional()
    .describe(
      'Response projection mode. "anchor" (DEFAULT): token-lean previews with drillDown pointers. "full": complete message bodies inside a bounded aggregate page.',
    ),
  agentKeyCatId,
};

const getWorkflowSopInputSchema = {
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe('Thread whose linked canonical workflow SOP should be read. Omit for the current invocation thread.'),
  agentKeyCatId,
};

const getMessageInputSchema = {
  messageId: z.string().min(1).describe('The exact message ID to look up'),
  contextCount: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe('Number of messages before and after to include for context (0-10, default 0)'),
  mode: z.enum(['preview', 'full']).optional().describe('preview (default, bounded excerpt) or full (complete content).'),
  agentKeyCatId,
};

const getThreadCatsInputSchema = {};

const listThreadsInputSchema = {
  limit: z.number().int().min(1).max(200).optional().default(20).describe('Max threads to return (default: 20).'),
  activeSince: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional Unix timestamp in ms; only include threads active at/after this time.'),
  keyword: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Optional: filter threads whose title or threadId contains this keyword (case-insensitive).'),
  agentKeyCatId,
};

const listLabelsInputSchema = {
  limit: z.number().int().min(1).max(50).optional().default(50).describe('Max labels to return (default: 50).'),
  agentKeyCatId,
};

const featIndexInputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Max feature entries to return (default: 20, max: 100).'),
  featId: z.string().min(1).optional().describe('Optional exact feature ID match (case-insensitive), e.g. F043.'),
  query: z
    .string()
    .min(1)
    .optional()
    .describe('Optional fuzzy substring search over featId/name/status (case-insensitive).'),
  agentKeyCatId,
};

const crossPostMessageInputSchema = {
  threadId: z.string().min(1).describe('Target thread ID to post into'),
  content: z
    .string()
    .min(1)
    .describe(
      'The message content to post. Do not copy a literal [爪感差: ...] marker across threads; reference its sourceMessageId instead.',
    ),
  targetCats: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Cat handles to route the cross-thread notification to (triggers their session in the target thread).',
    ),
  replyTo: z.string().optional().describe('Optional message ID to reply to'),
  clientMessageId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Optional idempotency key for at-least-once delivery de-duplication'),
  effectClass: z
    .enum(['fyi', 'coordinate', 'investigate', 'assign_work'])
    .optional()
    .describe(
      'Effect-class of the cross-thread dispatch. fyi/coordinate/investigate → auto-deliver (default). assign_work → held as a DispatchProposal pending operator approval.',
    ),
  coordination: coordinationSchema.describe(
    'F167 invocation-token cross-hop coordination lifecycle. Use phase=active for Claim/work hops and phase=terminal for Release/final handoff.',
  ),
  localReviewVerdict: localReviewVerdictSchema
    .optional()
    .describe(
      'Durable local-review fact. Requires clientMessageId, exact reviewedHeadSha, reviewSubjectRef, acceptedSourceRef, acceptedRevision, and ordinary targetCats or a line-start @author.',
    ),
  reviewedHeadSha: reviewedHeadShaSchema.optional(),
  reviewSubjectRef: reviewSubjectRefSchema.optional(),
  acceptedSourceRef: acceptedSourceRefSchema.optional(),
  acceptedRevision: acceptedRevisionSchema.optional(),
  action: executableActionSuccessorMetadataSchema
    .optional()
    .describe('Optional durable subject/action/slot successor identity for this cross-thread dispatch.'),
  proposedAction: z
    .object({
      subjectRef: z.string(),
      actionFamily: z.enum(['review', 'implement']),
      successorSlot: z.enum(['reviewer', 'implementer']),
      mode: z.enum(['single', 'parallel']),
      parallelIntent: z.string().trim().min(1).max(120).optional(),
      claimOrigin: z.literal('structured_transfer').optional(),
      terminalPredicate: z
        .object({
          kind: z.enum(['review_delivered', 'task_done']),
          headSha: canonicalGitObjectIdSchema.optional(),
        })
        .strict(),
    })
    .strict()
    .optional()
    .describe(
      'Server-validated action identity proposed for operator approval with effectClass="assign_work". Use when new cross-thread responsibility must be reviewed before F167 custody exists. ' +
        PROPOSED_ACTION_EXECUTABLE_CONTRACT_DESCRIPTION,
    ),
  agentKeyCatId,
  acknowledgeHeld: z
    .boolean()
    .optional()
    .describe('F254 Freshness Gate escape hatch. Force-send despite unseen messages in the target thread.'),
};

const listTasksInputSchema = {
  threadId: z.string().min(1).optional().describe('Optional thread ID filter'),
  catId: z.string().min(1).optional().describe('Optional owner catId filter'),
  status: z.enum(['todo', 'doing', 'blocked', 'done']).optional().describe('Optional task status filter'),
  kind: z
    .enum(['work', 'pr_tracking'])
    .optional()
    .describe('Optional task kind filter (work = manual tasks, pr_tracking = PR automation)'),
  taskId: z.string().min(1).optional().describe('Pass a taskId to retrieve that task with its full (untruncated) why field'),
  agentKeyCatId,
};

const dispatchGateSchema = z
  .object({
    status: z.enum(['dispatched', 'not_dispatched']).describe('Dispatch gate resolution'),
    dispatchedThreadId: z.string().optional().describe('Thread ID you dispatched to (required when status=dispatched)'),
    dispatchedMessageId: z.string().optional().describe('Message ID of the cross-post (required when status=dispatched)'),
    reason: z.string().optional().describe('Why you chose not to dispatch (required when status=not_dispatched)'),
  })
  .refine(
    (gate) => {
      if (gate.status === 'dispatched') return !!gate.dispatchedThreadId && !!gate.dispatchedMessageId;
      if (gate.status === 'not_dispatched') return !!gate.reason;
      return true;
    },
    { message: 'dispatched requires BOTH dispatchedThreadId AND dispatchedMessageId; not_dispatched requires reason.' },
  )
  .optional()
  .describe(
    'Dispatch gate decision. Required when task references features outside your current scope. If omitted and external F-IDs detected, task is created with dispatchGate.status="missing".',
  );

const updateTaskInputSchema = {
  taskId: z.string().min(1).describe('The ID of the task to update'),
  status: z
    .enum(['todo', 'doing', 'blocked', 'done'])
    .optional()
    .describe(
      'New task status. Entrusted work rejects status=done here; its Task owner requires an evidence-backed typed closure action.',
    ),
  why: z.string().max(1000).optional().describe('Optional note explaining the status change'),
  dispatchGate: dispatchGateSchema.describe('Resolve a previously-missing dispatch gate on this task.'),
  agentKeyCatId,
};

const admitEntrustedWorkInputSchema = {
  title: z.string().trim().min(1).max(200).describe('Title for the canonical entrusted-work Task'),
  why: z.string().max(1000).optional().describe('Why this work was entrusted and why the Task owns it'),
  admission: custodyAdmissionRequestV1Schema.describe(
    'Explicit, accepted-offer, or registered-source admission basis with stable source and idempotency coordinates',
  ),
  closure: entrustedWorkClosureSpecV1Schema
    .optional()
    .describe('Required closure condition and expected signal; omission returns needs_clarification'),
  time: entrustedWorkV1Schema.shape.time
    .optional()
    .describe(
      'Canonical source-backed businessDeadline/reviewBy facts. Required when the source states an unambiguous time.',
    ),
  artifactRefs: z.array(z.string().trim().min(1).max(1000)).max(64).optional(),
  agentKeyCatId,
};

const closeEntrustedWorkInputSchema = {
  taskId: z.string().min(1).describe('Entrusted-work Task ID'),
  expectedRevision: entrustedWorkTerminalActionV1Schema.shape.expectedRevision.describe(
    'Current entrusted-work revision used for compare-and-set closure',
  ),
  closure: entrustedWorkTerminalActionV1Schema.shape.closure.describe(
    'Evidence-backed satisfied closure or typed cancelled/abandoned disposition',
  ),
  agentKeyCatId,
};

const updateEntrustedWorkInputSchema = {
  taskId: entrustedWorkUpdateActionV1Schema.shape.taskId.describe('Entrusted-work Task ID'),
  expectedRevision: entrustedWorkUpdateActionV1Schema.shape.expectedRevision.describe(
    'Current entrusted-work revision used for compare-and-set update',
  ),
  time: entrustedWorkUpdateActionV1Schema.shape.time.describe(
    'Optional businessDeadline/reviewBy patch; null clears one exact Task-owned time fact',
  ),
  artifactRefs: entrustedWorkUpdateActionV1Schema.shape.artifactRefs.describe(
    'Optional complete replacement of canonical Artifact refs; values are deduplicated and sorted',
  ),
  agentKeyCatId,
};

const offerCustodyInputSchema = {
  sourceMessageId: z.string().trim().min(1).max(1_000).describe('Exact source message to carry the offer'),
  reasonCode: z
    .enum(['future_deliverable', 'follow_up_commitment', 'time_bound_obligation'])
    .describe('Bounded recognition reason; venting and casual mentions are intentionally absent'),
  agentKeyCatId,
};

const retryCustodyAdmissionInputSchema = {
  sourceMessageId: z.string().trim().min(1).max(1_000),
  sourceMessageRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  offerId: z.string().trim().min(1).max(1_000),
  title: z.string().trim().min(1).max(200),
  why: z.string().max(1_000).optional(),
  intendedOutcome: z.string().trim().min(1).max(4_000),
  closure: entrustedWorkClosureSpecV1Schema,
  time: entrustedWorkV1Schema.shape.time.optional(),
  artifactRefs: z.array(z.string().trim().min(1).max(1_000)).max(64).optional(),
  agentKeyCatId,
};

const createTaskInputSchema = {
  title: z.string().min(1).max(200).describe('Task title — what needs to be done'),
  why: z.string().max(1000).optional().describe('Why this task matters (context for whoever picks it up)'),
  ownerCatId: z
    .string()
    .min(1)
    .optional()
    .describe('Cat ID to assign the task to (optional, defaults to unassigned).'),
  relatedFeatureId: z
    .string()
    .regex(/^F\d+$/)
    .optional()
    .describe(
      'Feature ID this task relates to (e.g. "F193"). Optional explicit override — system also auto-extracts F-IDs from title+why.',
    ),
  currentFeatureId: z
    .string()
    .regex(/^F\d+$/)
    .optional()
    .describe('The feature ID of your current thread/scope (e.g. "F209"). Used to determine which detected F-IDs are "external".'),
  dispatchGate: dispatchGateSchema.describe(
    'Dispatch gate decision. If omitted and external F-IDs detected, task is created with dispatchGate.status="missing".',
  ),
  agentKeyCatId,
};

const createRichBlockInputSchema = {
  block: z.string().min(1).describe('JSON string of the rich block object. Must include id, kind, v:1, and kind-specific fields.'),
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe('Target thread ID. Required for agent-key auth because persistent MCP has no invocation thread.'),
  agentKeyCatId,
};

const generateDocumentInputSchema = {
  markdown: z.string().min(1).describe('Full Markdown content for the document. Supports headings, tables, lists, code blocks, etc.'),
  format: z.enum(['pdf', 'docx', 'md']).describe('Output format. Recommend "docx" (most compatible). "pdf" needs LaTeX, "md" always works.'),
  baseName: z
    .string()
    .min(1)
    .max(200)
    .describe('Display name without extension (e.g. "调研报告"). Will appear as filename in IM.'),
  agentKeyCatId,
};

const registerPrTrackingInputSchema = {
  repoFullName: z.string().min(1).describe('Repository full name in owner/repo format (e.g. "zts212653/cat-cafe")'),
  prNumber: z.number().int().positive().describe('PR number'),
  when: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('pr_head_changed') }).strict(),
        z
          .object({ kind: z.literal('pr_review_result_available'), triggerCommentId: z.number().int().positive().optional() })
          .strict(),
        z.object({ kind: z.literal('pr_review_decision_changed') }).strict(),
        z.object({ kind: z.literal('pr_review_thread_changed'), reviewThreadIds: z.array(z.string().min(1)).min(1).max(20) }).strict(),
        z.object({ kind: z.literal('pr_ci_terminal') }).strict(),
        z.object({ kind: z.literal('pr_became_conflicting') }).strict(),
      ]),
    )
    .min(1)
    .max(4)
    .describe('One to four typed conditions, evaluated as flat any-of against a server-frozen live baseline.'),
  nextStep: z.string().min(1).max(500).describe('What to do after a match. Display-only text; never parsed as wake policy.'),
  expiresAt: z
    .number()
    .int()
    .positive()
    .describe('Unix timestamp in milliseconds when responsibility expires without deleting history.'),
  agentKeyCatId,
};

const registerIssueTrackingInputSchema = {
  repoFullName: z.string().min(1).describe('Repository full name in owner/repo format (e.g. "zts212653/cat-cafe")'),
  issueNumber: z.number().int().positive().describe('Issue number'),
  when: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('issue_comment_added') }).strict(),
        z.object({ kind: z.literal('issue_author_commented') }).strict(),
      ]),
    )
    .min(1)
    .max(4)
    .describe('One to four typed issue conditions, evaluated as flat any-of against a server-frozen baseline.'),
  nextStep: z.string().min(1).max(500).describe('What to do after a match. Display-only text; never parsed as wake policy.'),
  expiresAt: z.number().int().positive().describe('Unix timestamp in milliseconds when responsibility expires.'),
  agentKeyCatId,
};

const unregisterTrackingInputSchema = {
  subjectKey: z
    .string()
    .min(1)
    .describe('Subject key to unregister. Format: "pr:{owner/repo}#{num}" or "issue:{owner/repo}#{num}"'),
  agentKeyCatId,
};

const communityAwaitExternalInputSchema = {
  subjectKey: z
    .string()
    .min(1)
    .describe('Community case subject key. Format: "issue:{owner/repo}#{number}" or "pr:{owner/repo}#{number}".'),
  reason: z.string().max(500).optional().describe('Optional free-text reason describing what you are waiting for.'),
  agentKeyCatId,
};

const communityGuardianRequestInputSchema = {
  caseId: z.string().min(1).describe('Internal Community Issue case ID for the accepted intake case.'),
  author: z.string().min(1).describe('Author catId. Must match the server-trusted callback or agent-key principal making this request.'),
  reviewer: z.string().min(1).describe('Independent reviewer catId to exclude, together with the author, from Guardian selection.'),
  agentKeyCatId,
};

const communityGuardianSignoffInputSchema = {
  caseId: z.string().min(1).describe('Internal Community Issue case ID returned by the intake board or request-guardian endpoint.'),
  signoffToken: z.string().min(1).describe('One-time Guardian signoff token returned by the request-guardian endpoint.'),
  checklist: z
    .array(
      z.object({
        id: z.string().min(1).describe('Stable checklist item ID from the current Guardian assignment.'),
        label: z.string().min(1).describe('Human-readable checklist item label from the current assignment.'),
        required: z.boolean().describe('Whether this checklist item is required for approval.'),
        evidence: z.string().min(1).optional().describe('Concrete evidence supporting this checklist item.'),
        verifiedAt: z.number().int().nonnegative().optional().describe('Unix timestamp in milliseconds when the Guardian verified this item.'),
        verifiedBy: z.string().min(1).optional().describe('Guardian catId that verified this checklist item.'),
      }),
    )
    .describe('The complete current Guardian checklist, with concrete evidence for every required item.'),
  approved: z.boolean().describe('True only when every required intake condition is satisfied.'),
  reason: z.string().min(1).max(1000).optional().describe('Required context when the Guardian rejects the intake.'),
  agentKeyCatId,
};

const updateWorkflowInputSchema = {
  backlogItemId: z
    .string()
    .min(1)
    .optional()
    .describe('The backlog item ID. Optional — when omitted, server resolves from featureId via thread binding or user backlog scan.'),
  taskId: z
    .string()
    .min(1)
    .optional()
    .describe('Durable same-thread work task to import into Mission Hub when no backlog item exists.'),
  featureId: z.string().min(1).describe('Feature ID (e.g. "F073"). Used as the primary identifier when backlogItemId is omitted.'),
  sopDefinitionId: z.enum(SOP_DEFINITION_IDS).optional().describe('SOP definition id. Defaults to "development" for existing workflows.'),
  stage: z.enum(DEVELOPMENT_SOP_STAGE_IDS).optional().describe('Current SOP stage'),
  batonHolder: z.string().min(1).optional().describe('Unique handle of the cat currently holding the baton (a valid registered catId)'),
  nextSkill: z.string().nullable().optional().describe('Suggested skill to load next (e.g. "tdd", "quality-gate"), or null'),
  resumeCapsule: z
    .object({
      goal: z.string().optional().describe('What we are building'),
      done: z.array(z.string()).optional().describe('What has been completed'),
      currentFocus: z.string().optional().describe('What we are working on right now'),
    })
    .optional()
    .describe('Resume capsule for cold start / context recovery'),
  checks: z
    .object({
      remoteMainSynced: z.enum(['attested', 'verified', 'unknown']).optional(),
      qualityGatePassed: z.enum(['attested', 'verified', 'unknown']).optional(),
      reviewApproved: z.enum(['attested', 'verified', 'unknown']).optional(),
      visionGuardDone: z.enum(['attested', 'verified', 'unknown']).optional(),
    })
    .optional()
    .describe('SOP checkpoint attestations'),
  expectedVersion: z
    .number()
    .int()
    .optional()
    .describe('CAS: reject if current version does not match (for concurrent update safety)'),
  agentKeyCatId,
};

const multiMentionInputSchema = {
  targets: z.array(z.string().min(1)).min(1).max(3).describe('Cat IDs to invoke in parallel (max 3). Use get_thread_cats to discover valid catIds.'),
  question: z.string().min(1).max(5000).describe('The question or request for the target cats'),
  callbackTo: z.string().min(1).describe('Cat ID to route all responses back to (required, usually yourself).'),
  context: z.string().max(5000).optional().describe('Additional context to include for the targets'),
  idempotencyKey: z.string().min(1).max(200).optional().describe('Idempotency key to prevent duplicate dispatches within the same thread'),
  timeoutMinutes: z.number().int().min(3).max(20).optional().describe('Timeout in minutes (default 8, range 3-20)'),
  searchEvidenceRefs: z
    .array(z.string())
    .optional()
    .describe('References to searches you performed before calling this tool (required unless overrideReason provided).'),
  overrideReason: z.string().min(1).max(500).optional().describe('Why you are skipping search evidence (required if searchEvidenceRefs omitted)'),
  triggerType: z
    .enum(['high-impact', 'cross-domain', 'uncertain', 'info-gap', 'recon'])
    .optional()
    .describe('Which meta-thinking trigger motivated this call'),
  action: executableActionSuccessorMetadataSchema
    .optional()
    .describe('Optional durable action identity for successor work. Action-scoped calls require idempotencyKey.'),
  agentKeyCatId,
};

const startVoteInputSchema = {
  question: z.string().min(1).max(500).describe('The voting question'),
  options: z.array(z.string().min(1).max(100)).min(2).max(20).describe('Voting options (at least 2)'),
  voters: z.array(z.string().min(1).max(50)).min(1).max(20).describe('CatIds of voters. Use get_thread_cats to discover valid catIds.'),
  anonymous: z.boolean().optional().describe('Anonymous voting (default: false)'),
  timeoutSec: z.number().int().min(10).max(600).optional().describe('Timeout in seconds (default: 120)'),
  agentKeyCatId,
};

const updateBootcampStateInputSchema = {
  threadId: z.string().min(1).describe('Thread ID of the bootcamp thread'),
  phase: z
    .enum([
      'phase-1-intro',
      'phase-2-env-check',
      'phase-3-config-help',
      'phase-4-task-select',
      'phase-5-kickoff',
      'phase-6-design',
      'phase-7-dev',
      'phase-7.5-add-teammate',
      'phase-8-collab',
      'phase-9-complete',
      'phase-10-retro',
      'phase-11-farewell',
    ])
    .optional()
    .describe('New bootcamp phase to advance to'),
  leadCat: z.string().optional().describe('Selected lead cat ID (a valid registered catId)'),
  selectedTaskId: z.string().max(50).optional().describe('Selected task ID (e.g. "Q1", "Q7")'),
  envCheck: z
    .record(z.string(), z.object({ ok: z.boolean(), version: z.string().optional(), note: z.string().optional() }))
    .optional()
    .describe('Environment check results (usually auto-set by bootcamp-env-check)'),
  advancedFeatures: z
    .record(z.string(), z.enum(['available', 'unavailable', 'skipped']))
    .optional()
    .describe('Advanced feature status: TTS, ASR, Pencil'),
  guideStep: z
    .enum(['open-hub', 'click-add-member', 'fill-form', 'mention-teammate', 'return-to-chat', 'done'])
    .nullable()
    .optional()
    .describe('Sub-step for the add-teammate guide overlay. Set to "open-hub" when advancing to phase-7.5-add-teammate. Set to null to clear.'),
  completedAt: z.number().optional().describe('Timestamp when bootcamp was completed (Phase 11)'),
  agentKeyCatId,
};

const bootcampEnvCheckInputSchema = {
  threadId: z.string().min(1).describe('Thread ID — results are auto-stored in bootcampState.envCheck'),
  agentKeyCatId,
};

const proposeThreadInputSchema = {
  title: z.string().min(1).max(200).describe('Title for the proposed thread (user can edit before approving)'),
  reason: z.string().min(1).max(1000).describe('Why a new thread is needed (shown to the user on the proposal card)'),
  preferredCats: z.array(z.string().min(1)).max(10).optional().describe('Optional cat IDs to preselect for the new thread (e.g. ["codex","gemini"])'),
  initialMessage: z
    .string()
    .max(4000)
    .optional()
    .describe('Optional first message body posted as the source cat into the new thread on approve.'),
  reportingMode: z
    .enum(['none', 'final-only', 'state-transitions', 'blocking-ack'])
    .optional()
    .describe('Optional F128 reporting contract for the sub-thread. final-only is the default.'),
  declaredWorkMode: z
    .enum(['subtask', 'parallel', 'investigation', 'standalone'])
    .optional()
    .describe('Optional F277 placement role. subtask / parallel / investigation / standalone.'),
  parentThreadId: z.string().min(1).optional().describe('Optional parent thread ID. Defaults to the current thread.'),
  projectPath: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe('Optional absolute project directory the child thread belongs to. Invalid/non-existent paths are rejected (400).'),
  clientRequestId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Optional idempotency key. Resending with the same value returns the same proposalId.'),
  agentKeyCatId,
};

const withdrawThreadProposalInputSchema = {
  proposalId: z.string().min(1).max(200).describe('Exact pending F128 proposal ID created by this authenticated cat'),
  agentKeyCatId,
};

const proposeSessionHandoffInputSchema = {
  done: z.string().min(1).max(2000).describe('五件套·已完成：这个 session 你做完了什么（让续接的你一眼看清进展，别重新摸索）'),
  nextSteps: z.string().min(1).max(2000).describe('五件套·下一步：续接的你从哪里继续、第一步具体做什么'),
  worktreeBranch: z.string().max(200).optional().describe('五件套·worktree/分支（可选）：当前工作的 worktree 路径或分支名'),
  commits: z.array(z.string().min(1).max(100)).max(50).optional().describe('五件套·commits（可选）：相关 commit SHA 列表'),
  gotchas: z.string().max(2000).optional().describe('五件套·坑/注意（可选）：续接的你最容易踩的坑、不可逆点、待验证假设'),
  clientRequestId: z.string().min(1).max(200).optional().describe('Optional idempotency key. Resending with the same value returns the same proposalId.'),
  agentKeyCatId,
};

const readProfileInputSchema = { agentKeyCatId };

const proposeProfileUpdateInputSchema = {
  afterContent: z
    .string()
    .min(1)
    .max(20000)
    .describe('The COMPLETE new persona primer content (whole-file replacement, NOT a diff/patch).'),
  rationale: z.string().min(1).max(1000).describe('Why this update — shown to the operator on the confirmation card.'),
  signalKind: z
    .enum(['cat-declared', 'cvo-instructed'])
    .describe("Where the relationship signal came from (provenance). 'cat-declared' = you observed/inferred it; 'cvo-instructed' = the operator explicitly asked you to remember it."),
  sourceMessageId: z.string().min(1).optional().describe('Optional exact message ID assertion.'),
  clientRequestId: z.string().min(1).max(200).optional().describe('Optional idempotency key. Resending with the same value returns the same proposalId.'),
  agentKeyCatId,
};

const proposeEntityInputSchema = {
  entityId: z.string().min(1).max(200).describe('Entity ID in type:name format (e.g. "concept:未婚喵", "feature:F260")'),
  entityType: z.enum(['person', 'cat', 'feature', 'concept', 'external']).describe('Entity type from registry taxonomy'),
  canonicalName: z.string().min(1).max(200).describe('Human-readable canonical name'),
  aliases: z.array(z.string().min(1).max(200)).min(1).max(20).describe('Aliases to register for matching (at least one required)'),
  stance: z
    .enum(['endorsed', 'rejected', 'critique_target', 'deliverable_only', 'unknown'])
    .describe('Stance: endorsed / rejected / critique_target / deliverable_only / unknown'),
  visibilityScope: z.literal('workspace').describe('Visibility: only "workspace" accepted (KD-7 gate)'),
  provenance: z
    .array(
      z.object({
        source: z.string().min(1).max(200).describe('Provenance source (e.g. "cat-proposed", "nudge")'),
        anchor: z.string().min(1).max(500).optional().describe('Thread/message anchor for traceability'),
        note: z.string().max(500).optional().describe('Optional note'),
        date: z.string().max(20).optional().describe('ISO date (YYYY-MM-DD)'),
      }),
    )
    .min(1)
    .max(10)
    .describe('Provenance chain — at least one entry with source; include thread anchor for traceability'),
  rationale: z.string().min(1).max(1000).describe('Why this entity should be in the registry — shown to operator in Approval Hub'),
  clientRequestId: z.string().min(1).max(200).optional().describe('Optional idempotency key. Resending with the same value returns the same proposalId.'),
  agentKeyCatId,
};

const proposeTasteInputSchema = {
  scene: z.string().min(1).max(2000).describe('The situation/context where this taste signal emerged — what was happening, what triggered it'),
  quote: z
    .string()
    .min(1)
    .max(2000)
    .describe('The exact or near-exact quote/expression that carries the taste signal — preserve the original language and nuance'),
  tags: z.array(z.string().min(1).max(50)).min(1).max(10).describe('1-10 tags capturing the taste signal essence'),
  dimension: z
    .enum([
      'relationship-stance',
      'cognitive-honesty',
      'architecture-aesthetics',
      'visual-quality',
      'authentic-expression',
      'system-philosophy',
      'creative-craft',
    ])
    .describe('Which taste dimension this signal belongs to.'),
  privacy: z
    .enum(['public', 'sensitive'])
    .describe('public: vignette goes to docs/taste/vignettes/. sensitive: vignette goes to private/taste/.'),
  sourceMessageId: z.string().min(1).optional().describe('Message ID where the taste signal was observed'),
  clientRequestId: z.string().min(1).max(200).optional().describe('Idempotency key — same clientRequestId returns cached proposal'),
  agentKeyCatId,
};

const updateGuideStateInputSchema = {
  threadId: z.string().min(1).describe('Thread ID where the guide is being offered/active'),
  guideId: z.string().min(1).describe('Guide ID (e.g. "add-member")'),
  status: z
    .enum(['offered', 'awaiting_choice', 'completed', 'cancelled'])
    .describe('Target guide status. Use cat_cafe_start_guide for →active.'),
  currentStep: z.number().int().min(0).optional().describe('Current step index (only when status=active)'),
  agentKeyCatId,
};

const getAvailableGuidesInputSchema = { agentKeyCatId };

const holdBallInputSchema = {
  reason: z.string().min(1).max(500).describe('Why you need to hold the ball (e.g. "tests still running")'),
  nextStep: z.string().min(1).max(500).describe('What you will do when re-invoked (e.g. "check test results, then @ author")'),
  wakeAfterMs: z
    .number()
    .int()
    .min(5000)
    .max(3600000)
    .optional()
    .describe('Delay in ms before system re-invokes you (5s–1h). Mutually exclusive with wakeWhen.'),
  wakeWhen: z
    .object({
      command: z.string().min(1).describe('Shell command to run (e.g. "pnpm gate", "pnpm test")'),
      cwd: z.string().optional().describe('Working directory for the command (defaults to project root)'),
      timeoutMs: z.number().int().min(1000).max(3600000).optional().describe('Timeout in ms (default 10min, max 1h).'),
    })
    .optional()
    .describe('Run a shell command and wake when it completes. Mutually exclusive with wakeAfterMs.'),
  waitSourceRef: z
    .object({
      kind: z
        .enum(['github_issue', 'github_comment', 'thread_message', 'task', 'reporter_handle', 'managed_command'])
        .describe('What type of external condition you are waiting on'),
      value: z.string().min(1).describe('Primary identifier (e.g. "#123", "thread-abc", "task-xyz")'),
      anchorRef: z.string().min(1).optional().describe('Durable anchor id — REQUIRED for reporter_handle kind'),
      expectedSignal: z.string().min(1).describe('What signal will indicate the wait is over.'),
      slaUntilMs: z.number().int().positive().describe('SLA deadline in ms from epoch. Must be ≤ now + 3_600_000 (1h). No SLA = no hold.'),
    })
    .optional()
    .describe('REQUIRED when using wakeAfterMs — structured declaration of what external condition justifies the timer.'),
  agentKeyCatId,
};

const completeHoldInputSchema = {
  disposition: z
    .enum(['handled', 'completed'])
    .describe('handled = wake consumed; completed = wake work completed. Both terminalize the exact original hold.'),
  agentKeyCatId,
};

const readModeInputSchema = {
  mode: z
    .enum(['anchor', 'full'])
    .describe(
      'Session-level mode for cc native Read/Grep/Glob output. "anchor" = PostToolUse hook replaces output with locator. "full" = pass-through. Default is full.',
    ),
  agentKeyCatId,
};

const getThreadMetadataInputSchema = { agentKeyCatId };

const setThreadMetadataInputSchema = {
  title: z.string().min(1).optional().describe('Update thread title (replaces existing)'),
  labels: z.array(z.string()).optional().describe('Update thread labels (replaces entire array)'),
  worktrees: z.array(z.string()).optional().describe('Worktree paths to add (append + dedupe)'),
  prs: z.array(z.object({ repo: z.string().min(1), number: z.number().int().positive() })).optional().describe('PRs to add (append + dedupe)'),
  issues: z
    .array(z.object({ repo: z.string().min(1), number: z.number().int().positive() }))
    .optional()
    .describe('Issues to add (append + dedupe)'),
  features: z.array(z.string()).optional().describe('Feature IDs to add (append + dedupe)'),
  notes: z.record(z.string(), z.string().nullable()).optional().describe('Free-form KV notes: string value sets key, null deletes key'),
  removeWorktrees: z.array(z.string()).optional().describe('Worktree paths to remove'),
  removePrs: z.array(z.object({ repo: z.string().min(1), number: z.number().int().positive() })).optional().describe('PRs to remove'),
  removeIssues: z.array(z.object({ repo: z.string().min(1), number: z.number().int().positive() })).optional().describe('Issues to remove'),
  removeFeatures: z.array(z.string()).optional().describe('Feature IDs to remove'),
  agentKeyCatId,
};

// ─────────────────────────────────────────────────────────────────────────────
// Resource-family + evidence anchors.
// ─────────────────────────────────────────────────────────────────────────────
const FAMILY = {
  threadMessage: 'thread-message',
  taskWorkflow: 'task-workflow',
  labelTaxonomy: 'label-taxonomy',
  sourceCustody: 'source-custody',
  artifactSurface: 'artifact-surface',
  trackingReview: 'tracking-review',
  communityCase: 'community-case',
  collaborationOrchestration: 'collaboration-orchestration',
  guideBootcamp: 'guide-bootcamp',
  threadProposal: 'thread-proposal',
  sessionHandoff: 'session-handoff',
  identityProposal: 'identity-proposal',
  runtimeControl: 'runtime-control',
} as const;

const F079 = 'file:docs/features/F079-voting-system.md';
const F086 = 'file:docs/features/F086-cat-orchestration-multi-mention.md';
const F087 = 'file:docs/features/F087-cvo-bootcamp.md';
const F088 = 'file:docs/features/F088-multi-platform-chat-gateway.md';
const F128 = 'file:docs/features/F128-cat-create-thread.md';
const F155 = 'file:docs/features/F155-scene-guidance-engine.md';
const F167 = 'file:docs/features/F167-a2a-chain-quality.md';
const F168 = 'file:docs/features/F168-community-ops-board.md';
const F192 = 'file:docs/features/F192-socio-technical-harness-eval.md';
const F193 = 'file:docs/features/F193-cross-thread-routing.md';
const F202 = 'file:docs/features/F202-plugin-framework.md';
const F221 = 'file:docs/features/F221-taste-lane.md';
const F225 = 'file:docs/features/F225-cat-initiated-session-handoff.md';
const F231 = 'file:docs/features/F231-user-profile-capsule.md';
const F236 = 'file:docs/features/F236-anchor-first-context-entry.md';
const F260 = 'file:docs/features/F260-write-side-autopsy-entity-deref.md';
const F310 = 'file:docs/features/F310-growing-real-delegation.md';
// F280 (server-bound typed wait registration) has no standalone feature doc;
// hold_ball is governed by the ball-custody contract (F229).
const F280 = 'file:docs/features/F229-cat-ball-concierge.md';

const FULL = ['full'] as const;
const FULL_AGENT = ['full', 'agent-key'] as const;
const FULL_DESKTOP = ['full', 'agent-key', 'desktop:fable-phase0', 'desktop:cloud-pro-phase0'] as const;

export const CALLBACK_SERVER_FAMILY = 'collab' as const;

export function buildCallbackToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, CALLBACK_SERVER_FAMILY, [
    {
      name: 'cat_cafe_post_message',
      description:
        "Post a proactive async message to the caller's authorized target, optionally waking one cat as an ordinary notification or a fenced same-thread structured single successor. " +
        'Principal contract: invocation-token registration uses the current thread and omits threadId; agent-key-only registration requires threadId because it has no current invocation thread. ' +
        'Use when: sharing a mid-task update, routing one ordinary @ notification, or handing one named external action to one successor with action.mode="single". ' +
        'NOT for: invocation-token delivery to another thread (use cross_post_message) or deliberate independent multi-cat review/ideation (use multi_mention with mode="parallel"). ' +
        'Output: the message is persisted in the principal-selected thread; routed targets are queued, and action conflicts return safe_wait without creating work. ' +
        'GOTCHA: action requires explicit clientMessageId + exactly one targetCats entry; ordinary single-cat notifications do not need action. ' +
        'GOTCHA: structured action metadata currently requires invocation-token auth; agent-key callers fail closed with the non-retryable action_agent_key_unsupported status. ' +
        'GOTCHA: This tool uses callback credentials that expire — if it fails with 401, fall back to line-start @mention in your response text.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: postMessageInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL_DESKTOP,
      admissionRef: F193,
      sourceExport: 'handlePostMessage',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/post-message',
        bodyKeys: [
          'content',
          'streamDisposition',
          'threadId',
          'replyTo',
          'clientMessageId',
          'targetCats',
          'coordination',
          'localReviewVerdict',
          'reviewedHeadSha',
          'reviewSubjectRef',
          'acceptedSourceRef',
          'acceptedRevision',
          'action',
          'acknowledgeHeld',
        ],
      },
    },
    {
      name: 'cat_cafe_get_pending_mentions',
      description:
        'Get recent messages that @-mention you. Use at session start to check if anyone is trying to get your attention. ' +
        'TIP: Call this early in your session, then call ack_mentions after processing to avoid seeing the same mentions next session.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: getPendingMentionsInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL,
      admissionRef: F236,
      sourceExport: 'handleGetPendingMentions',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/pending-mentions', paramKeys: ['includeAcked', 'responseMode'] },
    },
    {
      name: 'cat_cafe_ack_mentions',
      description:
        'Acknowledge that you have processed mentions up to a specific message ID. ' +
        'Call this AFTER processing mentions from get_pending_mentions to avoid seeing them again in future sessions. ' +
        'GOTCHA: Pass the message ID of the LAST mention you processed, not the first.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: ackMentionsInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL,
      admissionRef: F236,
      sourceExport: 'handleAckMentions',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/ack-mentions', bodyKeys: ['upToMessageId'] },
    },
    {
      name: 'cat_cafe_get_thread_context',
      description:
        'Read messages from one thread, with token-lean anchor previews by default and optional full bodies, ranked keywords, or a bounded window around messageId. ' +
        'Use when: browsing the current conversation, reading a different known threadId, finding relevant messages inside that thread, opening context around a known messageId, or a freshness notice asks you to catch up. ' +
        'NOT for: finding features, decisions, plans, lessons, or unknown threads across project knowledge; use search_evidence or list_threads first. ' +
        'Output: a bounded aggregate envelope with threadId, ordered messages, hasMore, and nextCursor when continuation is required.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: getThreadContextInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL_DESKTOP,
      admissionRef: F236,
      sourceExport: 'handleGetThreadContext',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/callbacks/thread-context',
        paramKeys: ['limit', 'cursor', 'threadId', 'messageId', 'before', 'after', 'catId', 'keyword', 'responseMode'],
      },
    },
    {
      name: 'cat_cafe_get_workflow_sop',
      description:
        'Read the complete canonical workflow SOP linked to an owner-visible thread. ' +
        'Use when: cat_cafe_get_thread_context returns an oversized workflowSop anchor and you need the resume capsule or checks. ' +
        'NOT for: updating workflow state (use cat_cafe_update_workflow), browsing messages, or guessing a backlog item from a feature ID. ' +
        'Output: threadId, backlogItemId, and the persisted workflowSop including resumeCapsule, checks, version, and update provenance. ' +
        'GOTCHA: thread ownership is resolved from callback or agent-key identity; agent-key callers must provide threadId and the matching agentKeyCatId.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: getWorkflowSopInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL_DESKTOP,
      admissionRef: F236,
      sourceExport: 'handleGetWorkflowSop',
      authorizationHint: 'read-only',
      standaloneKind: 'progressive-disclosure',
      route: { method: 'GET', path: '/api/callbacks/get-workflow-sop', paramKeys: ['threadId'] },
    },
    {
      name: 'cat_cafe_get_message',
      description:
        'Look up a single message by its messageId. Use when you receive a message with replyTo — ' +
        'call this to read the original quoted message and its surrounding context. ' +
        'Returns the message content, sender, timestamp, and optionally N nearby messages for context. ' +
        'PARAM GUIDE: messageId = required exact ID. contextCount = number of messages before/after to include (default 0, max 10). ' +
        'mode = "preview" (default — bounded excerpt that saves context) or "full" (complete original content).',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: getMessageInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL_DESKTOP,
      admissionRef: F236,
      sourceExport: 'handleGetMessage',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/get-message', paramKeys: ['messageId', 'contextCount', 'mode'] },
    },
    {
      name: 'cat_cafe_get_thread_cats',
      description:
        'Discover which cats are in the current thread: participants (with activity stats), routable cats, and availability. ' +
        'Use BEFORE multi_mention / start_vote / @mentions to find valid catIds — do NOT guess catIds from memory. ' +
        'Returns: participants (catId, displayName, lastMessageAt, messageCount), routableNow, routableNotJoined, notRoutable.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: getThreadCatsInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL,
      admissionRef: F193,
      sourceExport: 'handleGetThreadCats',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/thread-cats', paramKeys: [] },
    },
    {
      name: 'cat_cafe_list_threads',
      description:
        'List thread summaries for discovery. Use when you need to find a thread by keyword or see recent activity. ' +
        'Returns thread IDs, titles, and activity timestamps. ' +
        'Use activeSince (Unix ms) to filter to recently active threads. Use keyword to search by title.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listThreadsInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL_DESKTOP,
      admissionRef: F193,
      sourceExport: 'handleListThreads',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/list-threads', paramKeys: ['limit', 'activeSince', 'keyword'] },
    },
    {
      name: 'cat_cafe_list_labels',
      description:
        'List user-defined thread labels (id, name, color). Use when you need to know which labels exist ' +
        'before suggesting label assignments for threads. Returns all labels sorted by sortOrder.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listLabelsInputSchema,
      resourceFamily: FAMILY.labelTaxonomy,
      runtimeProfiles: FULL_AGENT,
      admissionRef: F193,
      sourceExport: 'handleListLabels',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/list-labels', paramKeys: ['limit'] },
    },
    {
      name: 'cat_cafe_feat_index',
      description:
        'Lookup feature index entries by featId or query. Returns featId, name, status, and linked threadIds. ' +
        'Use when you need to find which thread(s) a feature is discussed in, or check feature status. ' +
        'PARAM GUIDE: featId = exact match (e.g. "F043"), query = fuzzy substring over all fields.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: featIndexInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL,
      admissionRef: F236,
      sourceExport: 'handleFeatIndex',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/feat-index', paramKeys: ['limit', 'featId', 'query'] },
    },
    {
      name: 'cat_cafe_cross_post_message',
      description:
        'Post a message to a specific thread by threadId (cross-thread notification). ' +
        'Use when you need to notify a different thread about something relevant. ' +
        'NOT for: posting to your own current thread (use post_message instead). ' +
        'Output: message appears in the target thread as a new message visible to all participants. ' +
        'ROUTING: You MUST include routing credentials to wake the target cat — either set `targetCats` array with the recipient catId(s), OR put a line-start `@handle` in content. ' +
        'Messages without routing (no targetCats, no line-start @) will be REJECTED (F193 AC-A4). ' +
        'GOTCHA: Requires threadId — use feat_index/list_threads plus thread truth to verify the exact owning thread.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: crossPostMessageInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL_DESKTOP,
      admissionRef: F193,
      sourceExport: 'handleCrossPostMessage',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/post-message',
        bodyKeys: [
          'threadId',
          'content',
          'replyTo',
          'clientMessageId',
          'targetCats',
          'effectClass',
          'coordination',
          'localReviewVerdict',
          'reviewedHeadSha',
          'reviewSubjectRef',
          'acceptedSourceRef',
          'acceptedRevision',
          'action',
          'proposedAction',
          'acknowledgeHeld',
        ],
      },
    },
    {
      name: 'cat_cafe_list_tasks',
      description:
        'List tasks with optional threadId/catId/status filters for global task discovery. ' +
        'Use when you need to see what tasks exist, who owns them, or what is blocked. ' +
        'TIP: Filter by status="blocked" to find tasks that need attention.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listTasksInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F193,
      sourceExport: 'handleListTasks',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/list-tasks', paramKeys: ['threadId', 'catId', 'status', 'kind', 'taskId'] },
    },
    {
      name: 'cat_cafe_update_task',
      description:
        'Update a task you own: mark as doing/blocked/done, or resolve a missing dispatch gate. ' +
        'Entrusted work cannot be marked done through this generic tool; use its typed, evidence-backed closure action. ' +
        'GOTCHA: You can only update tasks assigned to you (your catId). ' +
        'TIP: Include a "why" note when marking as blocked — it helps others understand the situation. ' +
        'F193-E1: Pass dispatchGate to resolve a "missing" dispatch gate.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: updateTaskInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F310,
      sourceExport: 'handleUpdateTask',
      authorizationHint: 'callback-owner',
      standaloneKind: 'side-effect-boundary',
      route: { method: 'POST', path: '/api/callbacks/update-task', bodyKeys: ['taskId', 'status', 'why', 'dispatchGate'] },
    },
    {
      name: 'cat_cafe_admit_entrusted_work',
      description:
        'Ask the canonical Task owner to admit or resume explicitly entrusted work. ' +
        'The same idempotencyKey always returns the same Task coordinates; it never creates a sibling Task. ' +
        'Accepted offers remain pending until this action returns a typed admitted/resumed/needs_clarification result. ' +
        'Authorized-source admission fails closed unless its producer grant is registered and current.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: admitEntrustedWorkInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F310,
      sourceExport: 'handleAdmitEntrustedWork',
      authorizationHint: 'callback-owner',
      standaloneKind: 'authority-boundary',
      route: { method: 'POST', path: '/api/callbacks/admit-entrusted-work', bodyKeys: ['title', 'why', 'admission', 'closure', 'time', 'artifactRefs'] },
    },
    {
      name: 'cat_cafe_close_entrusted_work',
      description:
        'Close entrusted work through the canonical Task owner using the current revision. ' +
        'Satisfied closure requires evidence; cancelled or abandoned closure requires typed actor, authority, disposition, and time provenance. ' +
        'Generic update_task status=done is intentionally rejected for entrusted work.',
      action: 'complete',
      risk: { level: 'write', openWorld: false },
      inputSchema: closeEntrustedWorkInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F310,
      sourceExport: 'handleCloseEntrustedWork',
      authorizationHint: 'callback-owner',
      standaloneKind: 'destructive-boundary',
      route: { method: 'POST', path: '/api/callbacks/close-entrusted-work', bodyKeys: ['taskId', 'expectedRevision', 'closure'] },
    },
    {
      name: 'cat_cafe_update_entrusted_work',
      description:
        'Update the current open entrusted-work Task using its exact revision. ' +
        'Use this after canonical business time or Artifact ownership becomes known; the same Task remains the owner and its revision advances once. ' +
        'Artifact refs replace the canonical set and are deduplicated/sorted; null clears one time fact. ' +
        'No-op, stale, foreign-owner, and terminal updates fail closed; generic update_task remains forbidden.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: updateEntrustedWorkInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F310,
      sourceExport: 'handleUpdateEntrustedWork',
      authorizationHint: 'callback-owner',
      standaloneKind: 'authority-boundary',
      route: { method: 'POST', path: '/api/callbacks/update-entrusted-work', bodyKeys: ['taskId', 'expectedRevision', 'time', 'artifactRefs'] },
    },
    {
      name: 'cat_cafe_offer_custody',
      description:
        'Use when: the exact source conversation contains a plausible future obligation but the human has not explicitly entrusted it. ' +
        'NOT for: explicit entrustment or registered authorized sources (use cat_cafe_admit_entrusted_work), venting/casual mentions (make no durable mutation), or creating a global reminder. ' +
        'Output: records or rereads one source-owned custodyOfferV1 bound to the immutable message revision; terminal replay never opens a second prompt. ' +
        'GOTCHA: this is only an offer. No Task, Schedule, or Needs Me item exists until the human accepts.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: offerCustodyInputSchema,
      resourceFamily: FAMILY.sourceCustody,
      runtimeProfiles: FULL_AGENT,
      admissionRef: F310,
      sourceExport: 'handleOfferCustody',
      authorizationHint: 'callback-owner',
      standaloneKind: 'resource-entry',
      route: { method: 'POST', path: '/api/callbacks/custody-offers', bodyKeys: ['sourceMessageId', 'reasonCode'] },
    },
    {
      name: 'cat_cafe_retry_custody_admission',
      description:
        'Use when: an accepted source-owned custody offer currently has a typed needs_clarification result and the same conversation now supplies the missing Task contract. ' +
        'NOT for: pending/declined/dismissed offers, a different source revision, or explicit new work (use cat_cafe_admit_entrusted_work). ' +
        'Output: retries the canonical Task owner with the offer original idempotency key and updates only the exact source admission result. ' +
        'GOTCHA: stale refs and key/state mismatches fail closed; never create a sibling Task.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: retryCustodyAdmissionInputSchema,
      resourceFamily: FAMILY.sourceCustody,
      runtimeProfiles: FULL_AGENT,
      admissionRef: F310,
      sourceExport: 'handleRetryCustodyAdmission',
      authorizationHint: 'callback-owner',
      standaloneKind: 'resource-entry',
      route: {
        method: 'POST',
        path: '/api/callbacks/custody-offers/retry-admission',
        bodyKeys: ['sourceMessageId', 'sourceMessageRevision', 'offerId', 'title', 'why', 'intendedOutcome', 'closure', 'time', 'artifactRefs'],
      },
    },
    {
      name: 'cat_cafe_create_task',
      description:
        'Create a new 🧶 毛线球 (yarn ball) task in the current thread. ' +
        'Use when: user says "建个毛线球", "记一下任务", "track this", or you identify persistent work items across sessions. ' +
        'NOT for: temporary execution steps (use PlanBoard/TodoWrite), NOT for inline checklists in a message (use create_rich_block with kind:"checklist"). ' +
        'Output: task appears in the thread 🧶 毛线球 panel, persists across sessions, visible to all cats and co-creator. ' +
        'F193-E1 DISPATCH GATE: If your task references an external F-number, provide dispatchGate. If you omit dispatchGate and external F-IDs are detected, a warning is returned.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: createTaskInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F193,
      sourceExport: 'handleCreateTask',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/create-task', bodyKeys: ['title', 'why', 'ownerCatId', 'relatedFeatureId', 'dispatchGate'] },
    },
    {
      name: 'cat_cafe_create_rich_block',
      description:
        'Create a rich block (card, diff, checklist, file, media_gallery, audio, interactive, or html_widget) attached to the current message. ' +
        'Use card for status/decisions, diff for code changes, checklist for inline todos, file for existing documents/audio/video, media_gallery for images, audio for voice, interactive for user selection/confirmation, html_widget for custom inline HTML. ' +
        'Output: block rendered inline in the current message. ' +
        'GOTCHA: The block JSON must use "kind" (NOT "type") and include "v": 1 and a unique "id". ' +
        'GOTCHA: Call get_rich_block_rules first if you haven loaded the full schema yet in this session.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: createRichBlockInputSchema,
      resourceFamily: FAMILY.artifactSurface,
      runtimeProfiles: FULL,
      admissionRef: F192,
      sourceExport: 'handleCreateRichBlock',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/create-rich-block', bodyKeys: ['block', 'threadId'] },
    },
    {
      name: 'cat_cafe_generate_document',
      description:
        'Generate a document (PDF/DOCX/MD) from Markdown and deliver to IM platforms (Feishu/Telegram). ' +
        'Use when: user asks to "生成报告", "导出文档", "发PDF", "写份文档给我", "export to DOCX", or any document generation request. ' +
        'NOT for: sending an existing file you already have (use create_rich_block with kind:"file" + url pointing to /uploads/). ' +
        'Output: file saved to /uploads/, attached as file RichBlock, automatically delivered to bound IM chats. ' +
        'Degradation: PDF needs LaTeX engine → falls back to DOCX → falls back to MD.',
      action: 'derive',
      risk: { level: 'write', openWorld: false },
      inputSchema: generateDocumentInputSchema,
      resourceFamily: FAMILY.artifactSurface,
      runtimeProfiles: FULL,
      admissionRef: F088,
      sourceExport: 'handleGenerateDocument',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/generate-document', bodyKeys: ['markdown', 'format', 'baseName'] },
    },
    {
      name: 'cat_cafe_register_pr_tracking',
      description:
        'Register one explicit, bounded PR wait for the current task owner. ' +
        'Use when: you can name the exact typed GitHub condition that changes your next action, such as a new HEAD, review result, terminal executable CI, anchored review thread change, or new conflict. ' +
        'NOT for: generic PR activity, bare @codex review chatter, arbitrary comments, another cat responsibility, or a different PR subject. ' +
        'GOTCHA: `when` is 1–4 flat any-of typed predicates. `nextStep` is display-only and never parsed. `expiresAt` is required and does not delete task history.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: registerPrTrackingInputSchema,
      resourceFamily: FAMILY.trackingReview,
      runtimeProfiles: FULL,
      admissionRef: F280,
      sourceExport: 'handleRegisterPrTracking',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/register-pr-tracking', bodyKeys: ['repoFullName', 'prNumber', 'when', 'nextStep', 'expiresAt'] },
    },
    {
      name: 'cat_cafe_register_issue_tracking',
      description:
        'Register one explicit, bounded GitHub issue wait for the current task owner. ' +
        'Use when: you can name the exact typed issue condition that changes your next action: any new comment, or a comment by the exact issue author. ' +
        'NOT for: generic issue activity, actor-type guessing, source prose, another cat responsibility, or a different issue subject. ' +
        'GOTCHA: `when` is a bounded typed predicate set. `nextStep` is display-only and never parsed. `expiresAt` is required.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: registerIssueTrackingInputSchema,
      resourceFamily: FAMILY.trackingReview,
      runtimeProfiles: FULL,
      admissionRef: F202,
      sourceExport: 'handleRegisterIssueTracking',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/register-issue-tracking', bodyKeys: ['repoFullName', 'issueNumber', 'when', 'nextStep', 'expiresAt'] },
    },
    {
      name: 'cat_cafe_unregister_tracking',
      description:
        'Unregister a PR or issue tracking task by subjectKey. Stops all automated notifications ' +
        '(review feedback, CI/CD, conflict detection, issue comments) for this subject. ' +
        'Format: "pr:{owner/repo}#{num}" or "issue:{owner/repo}#{num}".',
      action: 'close',
      risk: { level: 'destructive', openWorld: false },
      inputSchema: unregisterTrackingInputSchema,
      resourceFamily: FAMILY.trackingReview,
      runtimeProfiles: FULL,
      admissionRef: F202,
      sourceExport: 'handleUnregisterTracking',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/unregister-tracking', bodyKeys: ['subjectKey'] },
    },
    {
      name: 'cat_cafe_community_await_external',
      description:
        'Declare that you (the case owner) are waiting for an external response on a community case. ' +
        'WHEN: After responding to an issue/PR and explicitly waiting for the reporter or contributor to reply. ' +
        'EFFECT WHILE WAITING: Maintainer (OWNER/MEMBER) activity → silently logged, no wake. ' +
        'External actor (reporter, contributor) activity → auto-restores case to in_progress + wakes you. ' +
        'Provide the subjectKey in "issue:{owner/repo}#{number}" format.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: communityAwaitExternalInputSchema,
      resourceFamily: FAMILY.communityCase,
      runtimeProfiles: FULL,
      admissionRef: F168,
      sourceExport: 'handleCommunityAwaitExternal',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/community-issues/${subjectKey}/await-external',
        bodyKeys: ['reason'],
      },
    },
    {
      name: 'cat_cafe_community_request_guardian',
      description:
        'Request the canonical independent Guardian assignment for an accepted community intake case. ' +
        'Use when: the named reviewer has completed review and the accepted case needs its mandatory Guardian before merge. ' +
        'NOT for: choosing, reassigning, or bypassing a Guardian, or requesting on behalf of another author. ' +
        'Output: the durable Guardian assignment plus its one-time signoff token. ' +
        'GOTCHA: author must match the authenticated callback or agent-key principal.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: communityGuardianRequestInputSchema,
      resourceFamily: FAMILY.communityCase,
      runtimeProfiles: FULL_AGENT,
      admissionRef: F168,
      sourceExport: 'handleCommunityRequestGuardian',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/community-issues/${caseId}/request-guardian',
        bodyKeys: ['author', 'reviewer'],
      },
    },
    {
      name: 'cat_cafe_community_guardian_signoff',
      description:
        "Persist the system-assigned intake Guardian's evidence-backed checklist and approve/reject verdict. " +
        'Use only after independently verifying vision alignment, test coverage, doc/spec sync, no regression, and design fidelity when applicable. ' +
        'NOT for requesting, choosing, or reassigning a Guardian, and never for bypassing a failed checklist. ' +
        'The server derives Guardian identity from callback or agent-key auth; never put catId or credentials in the body. ' +
        'Requires the internal caseId and signoffToken returned by request-guardian. ' +
        'Output: the durable Guardian signoff state for the community case.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: communityGuardianSignoffInputSchema,
      resourceFamily: FAMILY.communityCase,
      runtimeProfiles: FULL_AGENT,
      admissionRef: F168,
      sourceExport: 'handleCommunityGuardianSignoff',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/community-issues/${caseId}/guardian-signoff',
        bodyKeys: ['signoffToken', 'checklist', 'approved', 'reason'],
      },
    },
    {
      name: 'cat_cafe_update_workflow',
      description:
        'Update the SOP workflow stage for a Feature (Mission Hub bulletin board). ' +
        'Use to record current stage, baton holder, resume capsule, and checks. ' +
        'When no backlog item exists, one same-user same-thread work task with explicit relatedFeatureId is imported deterministically. ' +
        'This is information sharing, not flow control — cats decide their own actions. ' +
        'STAGE VALUES: kickoff → impl → quality_gate → [fresh_context] → review → merge → completion. ' +
        'TIP: Always set resumeCapsule when updating stage — it helps the next cat cold-start.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: updateWorkflowInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F310,
      sourceExport: 'handleUpdateWorkflow',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/update-workflow-sop',
        bodyKeys: [
          'featureId',
          'backlogItemId',
          'taskId',
          'sopDefinitionId',
          'stage',
          'batonHolder',
          'nextSkill',
          'resumeCapsule',
          'checks',
          'expectedVersion',
        ],
      },
    },
    {
      name: 'cat_cafe_multi_mention',
      description:
        'Fan out to and collect responses from up to 3 cats, with explicit parallel action leases when the reviews are intentionally independent. ' +
        'Use when: deliberate independent multi-cat review/ideation needs aggregation. ' +
        'NOT for: a new same-thread single successor (use post_message with action.mode="single") or simple cross-thread notification (use cross_post_message). ' +
        'Output: returns request/status immediately; admitted responses are aggregated and routed to callbackTo, while conflicts return safe_wait. ' +
        'REQUIRES: searchEvidenceRefs (list what you searched first) OR overrideReason (why you are skipping search).',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: multiMentionInputSchema,
      resourceFamily: FAMILY.collaborationOrchestration,
      runtimeProfiles: FULL,
      admissionRef: F086,
      sourceExport: 'handleMultiMention',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/multi-mention',
        bodyKeys: [
          'targets',
          'question',
          'callbackTo',
          'context',
          'idempotencyKey',
          'timeoutMinutes',
          'searchEvidenceRefs',
          'overrideReason',
          'triggerType',
          'action',
        ],
      },
    },
    {
      name: 'cat_cafe_start_vote',
      description:
        'Start a voting session in the current thread for collective decision-making (e.g. "REST vs GraphQL?"). ' +
        'Use when a multi-cat discussion needs a bounded decision, tradeoff vote, or option ranking instead of another round of @ replies. ' +
        'Output: vote prompt message is posted, voters are notified, and the vote result is summarized when all voters respond or timeout expires. ' +
        'Auto-closes when all voters have voted or timeout expires (default 120s). ' +
        'GOTCHA: voters must be valid registered catIds (use get_thread_cats to discover them). Options need at least 2 choices.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: startVoteInputSchema,
      resourceFamily: FAMILY.collaborationOrchestration,
      runtimeProfiles: FULL,
      admissionRef: F079,
      sourceExport: 'handleStartVote',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/start-vote', bodyKeys: ['question', 'options', 'voters', 'anonymous', 'timeoutSec'] },
    },
    {
      name: 'cat_cafe_update_bootcamp_state',
      description:
        'Update the bootcamp training state for a thread. Use to advance phase, set lead cat, ' +
        'record task selection, store env check results, or mark completion. ' +
        'Fields are merged into existing state — only send what changed. ' +
        'GOTCHA: Only use this during bootcamp threads. Phase values must follow the sequence.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: updateBootcampStateInputSchema,
      resourceFamily: FAMILY.guideBootcamp,
      runtimeProfiles: FULL,
      admissionRef: F087,
      sourceExport: 'handleUpdateBootcampState',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/update-bootcamp-state',
        bodyKeys: ['threadId', 'phase', 'leadCat', 'selectedTaskId', 'envCheck', 'advancedFeatures', 'guideStep', 'completedAt'],
      },
    },
    {
      name: 'cat_cafe_bootcamp_env_check',
      description:
        'Run environment check for bootcamp (Node.js, pnpm, Git, Claude CLI, MCP, TTS, ASR, Pencil). ' +
        'Results are automatically stored in the thread bootcampState.envCheck. ' +
        'Returns the full check results for display to the user. Only use during bootcamp phase-2-env-check.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: bootcampEnvCheckInputSchema,
      resourceFamily: FAMILY.guideBootcamp,
      runtimeProfiles: FULL,
      admissionRef: F087,
      sourceExport: 'handleBootcampEnvCheck',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/bootcamp-env-check', bodyKeys: ['threadId'] },
    },
    {
      name: 'cat_cafe_propose_thread',
      description:
        'Propose a new thread to the user. Returns proposalId, NOT a threadId — the thread is only created after the user approves the proposal card. Use sparingly: ' +
        'only when a clearly separable, long-running discussion genuinely deserves its own thread, or when the owner asks for "新开一个 thread". ' +
        'Do NOT use to escape the current conversation, to split routine tasks, or proactively without an obvious need. ' +
        'parentThreadId defaults to the current thread. After proposing, continue your current work — do not assume the thread exists until the user approves.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: proposeThreadInputSchema,
      resourceFamily: FAMILY.threadProposal,
      runtimeProfiles: FULL,
      admissionRef: F128,
      sourceExport: 'handleProposeThread',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/propose-thread',
        bodyKeys: ['title', 'reason', 'preferredCats', 'initialMessage', 'reportingMode', 'declaredWorkMode', 'parentThreadId', 'projectPath', 'clientRequestId'],
      },
    },
    {
      name: 'cat_cafe_withdraw_thread_proposal',
      description:
        'Withdraw one exact F128 thread proposal created by the current authenticated cat. ' +
        'Use when: your own proposal is still pending and you have determined the proposed thread should not be created. ' +
        'Output: the canonical withdrawn status; retrying the same withdrawn proposal is idempotent. ' +
        'NOT for: rejecting a proposal as the user, withdrawing another cat proposal, editing a proposal, or undoing an approved thread.',
      action: 'close',
      risk: { level: 'write', openWorld: false },
      inputSchema: withdrawThreadProposalInputSchema,
      resourceFamily: FAMILY.threadProposal,
      runtimeProfiles: FULL,
      admissionRef: F128,
      sourceExport: 'handleWithdrawThreadProposal',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/withdraw-thread-proposal', bodyKeys: ['proposalId'] },
    },
    {
      name: 'cat_cafe_propose_session_handoff',
      description:
        'Propose handing off your CURRENT session to a fresh continuation of yourself, at a clean breakpoint. ' +
        'Use when you just hit a natural seam — last commit landed, tests green, next step is clear — and context is getting heavy. ' +
        'Returns a proposalId, NOT a sealed session — the seal only happens after the owner approves the confirmation card. ' +
        'Write the 五件套 note for the FUTURE you (same thread, same cat, seq+1): done + nextSteps required; worktreeBranch / commits / gotchas optional. ' +
        'Use sparingly — only at genuinely clean breakpoints.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: proposeSessionHandoffInputSchema,
      resourceFamily: FAMILY.sessionHandoff,
      runtimeProfiles: FULL,
      admissionRef: F225,
      sourceExport: 'handleProposeSessionHandoff',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/propose-session-handoff',
        bodyKeys: ['done', 'nextSteps', 'worktreeBranch', 'commits', 'gotchas', 'clientRequestId'],
      },
    },
    {
      name: 'cat_cafe_read_profile',
      description:
        'Read YOUR CURRENT authenticated relationship persona primer through the stable cat-cafe-profile://relationship/current URI. ' +
        'Use when: L0 shows that URI, you are starting a session and need relationship context, or you need to verify the currently effective primer before proposing an update. ' +
        'NOT for: searching project knowledge or old threads (use search_evidence), reading arbitrary workspace files (use read_file_slice). ' +
        'Output: the current persona relationshipKey and complete primer content; this is read-only and does not change profile state.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: readProfileInputSchema,
      resourceFamily: FAMILY.identityProposal,
      runtimeProfiles: FULL_DESKTOP,
      admissionRef: F231,
      sourceExport: 'handleReadProfile',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/profile', paramKeys: [] },
    },
    {
      name: 'cat_cafe_propose_profile_update',
      description:
        'Propose an update to YOUR CURRENT authenticated relationship-persona primer — the "养熟循环" digest entry point (F231 KD-12/KD-18). ' +
        'Output: returns a proposalId, NOT a written file; the primer is only written after operator approval. ' +
        'Use when: the content is a durable fact about the authenticated person or this persona-operator relationship. ' +
        'NOT for reusable judgments about output quality (use cat_cafe_propose_taste), repeated operational rules (use code-as-harness), or one-off context. ' +
        'afterContent is the COMPLETE new primer (whole-file replacement, not a diff).',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: proposeProfileUpdateInputSchema,
      resourceFamily: FAMILY.identityProposal,
      runtimeProfiles: FULL,
      admissionRef: F231,
      sourceExport: 'handleProposeProfileUpdate',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/propose-profile-update',
        bodyKeys: ['afterContent', 'rationale', 'signalKind', 'sourceMessageId', 'clientRequestId'],
      },
    },
    {
      name: 'cat_cafe_propose_entity',
      description:
        'Propose a workspace entity for the registry. Returns a proposalId — the entity is only registered after the operator approves in the Approval Hub. ' +
        'Use when: (1) responding to a registration nudge with pre-filled params; (2) the operator explicitly requests entity registration; or (3) the current turn verified a durable workspace name/handle/alias mapping. ' +
        'NOT for an unverified bare proper name, bulk proper-noun extraction, or owner-private facts (use cat_cafe_propose_person_memory). ' +
        'GOTCHA: correcting a pending/private F276 card is not an Entity mutation.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: proposeEntityInputSchema,
      resourceFamily: FAMILY.identityProposal,
      runtimeProfiles: FULL,
      admissionRef: F260,
      sourceExport: 'handleProposeEntity',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/propose-entity',
        bodyKeys: ['entityId', 'entityType', 'canonicalName', 'aliases', 'stance', 'visibilityScope', 'provenance', 'rationale', 'clientRequestId'],
      },
    },
    {
      name: 'cat_cafe_propose_taste',
      description:
        'Propose a taste vignette capturing an operator preference/aesthetic signal (F221 Taste Capture Loop). ' +
        'Output: returns a proposalId; the vignette is only written after operator approval. ' +
        'Use when: the content is a reusable judgment about what makes output, design, expression, architecture, or system behavior good or bad. ' +
        'NOT for durable personal facts (use cat_cafe_propose_profile_update), repeated operational rules (use code-as-harness), or transient reactions. ' +
        'GOTCHA: relationship-stance stores a reusable stance such as partner-not-tool, not a personal fact about the current operator.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: proposeTasteInputSchema,
      resourceFamily: FAMILY.identityProposal,
      runtimeProfiles: FULL,
      admissionRef: F221,
      sourceExport: 'handleProposeTaste',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/propose-taste',
        bodyKeys: ['scene', 'quote', 'tags', 'dimension', 'privacy', 'sourceMessageId', 'clientRequestId'],
      },
    },
    {
      name: 'cat_cafe_update_guide_state',
      description:
        'Update the guide session state for a thread after you have already decided a guided flow is appropriate. ' +
        'This is not a raw-text trigger path: do not infer guide offers from `/guide` or keywords alone. ' +
        'First call creates state (status must be "offered"). Subsequent calls must follow valid non-start transitions. ' +
        'Do not use this tool to enter "active" — call cat_cafe_start_guide. One active guide per thread.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: updateGuideStateInputSchema,
      resourceFamily: FAMILY.guideBootcamp,
      runtimeProfiles: FULL,
      admissionRef: F155,
      sourceExport: 'handleUpdateGuideState',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/update-guide-state', bodyKeys: ['threadId', 'guideId', 'status', 'currentStep'] },
    },
    {
      name: 'cat_cafe_get_available_guides',
      description:
        'Fetch the current catalog of guides that are actually available in this thread context. ' +
        'Use this after you decide a user likely needs a step-by-step walkthrough instead of a plain explanation. ' +
        'Returns guide IDs, names, descriptions, categories, priorities, and estimated times so you can recommend the best-fit guide. ' +
        'On confirmation, call cat_cafe_start_guide with the chosen guideId.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: getAvailableGuidesInputSchema,
      resourceFamily: FAMILY.guideBootcamp,
      runtimeProfiles: FULL,
      admissionRef: F155,
      sourceExport: 'handleGetAvailableGuides',
      authorizationHint: 'read-only',
      route: { method: 'POST', path: '/api/callbacks/get-available-guides', bodyKeys: [] },
    },
    {
      name: 'cat_cafe_start_guide',
      description:
        'Start an interactive guided flow on the Console frontend. ' +
        'Requires the guide to be in "offered" or "awaiting_choice" state (call cat_cafe_update_guide_state first). ' +
        'Transitions guide to "active" and emits socket event for frontend overlay.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: { guideId: z.string().min(1).describe('Guide flow ID (e.g. "add-member")'), agentKeyCatId },
      resourceFamily: FAMILY.guideBootcamp,
      runtimeProfiles: FULL,
      admissionRef: F155,
      sourceExport: 'handleStartGuide',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/start-guide', bodyKeys: ['guideId'] },
    },
    {
      name: 'cat_cafe_guide_control',
      description:
        'Control an active guide session. Requires guide to be in "active" state. ' +
        'Actions: "next" (advance), "skip" (skip step), "exit" (cancel guide). ' +
        'Use this only after a guide has been explicitly started; forward-only — no back.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: { action: z.enum(['next', 'skip', 'exit']).describe('Guide control action'), agentKeyCatId },
      resourceFamily: FAMILY.guideBootcamp,
      runtimeProfiles: FULL,
      admissionRef: F155,
      sourceExport: 'handleGuideControl',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/guide-control', bodyKeys: ['action'] },
    },
    {
      name: 'cat_cafe_hold_ball',
      description:
        'Declare a bounded ball hold: keep the ball while waiting for a short, predictable condition, then get auto-re-invoked with your context. ' +
        'Use when: ball is clearly yours + nobody else can advance + short predictable wait + you know exactly what to do next. ' +
        'NOT for: waiting for co-creator/user OR another cat to reply / answer / decide → @co-creator or @ that cat. ' +
        'This is the #1 misuse — hold_ball is NOT a way to "stay alive" until a person replies. ' +
        'Output: system schedules a one-shot wake-up after wakeAfterMs; you get re-invoked with reason + nextStep. ' +
        'GOTCHA: max 3 holds per (thread, cat) within a rolling ~1h window. Hold is an EXCEPTION state, not a default exit. ' +
        'NEW (F167 Phase P): wakeWhen — instead of a timed delay, specify a shell command to run. wakeWhen and wakeAfterMs are MUTUALLY EXCLUSIVE.',
      action: 'wait',
      risk: { level: 'write', openWorld: false },
      inputSchema: holdBallInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F167,
      sourceExport: 'handleHoldBall',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/hold-ball', bodyKeys: ['reason', 'nextStep', 'wakeAfterMs', 'wakeWhen', 'waitSourceRef'] },
    },
    {
      name: 'cat_cafe_complete_managed_hold',
      description:
        'Terminally dispose the exact managed hold wake bound to this invocation. ' +
        'Use when: the current turn was triggered by a managed hold wake and its requested work is actually handled/completed. ' +
        'NOT for: ordinary holds, unfinished work, re-hold, a structured event wait, transfer, or unrelated task completion. ' +
        'Output: marks the exact F264 target receipt handled and terminalizes the original F167 hold ball.',
      action: 'complete',
      risk: { level: 'write', openWorld: false },
      inputSchema: completeHoldInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F167,
      sourceExport: 'handleCompleteManagedHold',
      authorizationHint: 'callback-owner',
      standaloneKind: 'authority-boundary',
      route: { method: 'POST', path: '/api/callbacks/complete-managed-hold', bodyKeys: ['disposition'] },
    },
    {
      name: 'cat_cafe_complete_a2a_dispatch',
      description:
        'Terminally dispose the exact ordinary A2A dispatch bound to this invocation. ' +
        'Use when: the current turn was triggered by a same-thread or queued agent handoff and its requested work is actually handled/completed. ' +
        'NOT for: user turns, managed holds, unfinished work, re-hold, event wait, transfer, or unrelated task completion. ' +
        'Output: terminalizes the exact F167 dispatch ball.',
      action: 'complete',
      risk: { level: 'write', openWorld: false },
      inputSchema: completeHoldInputSchema,
      resourceFamily: FAMILY.taskWorkflow,
      runtimeProfiles: FULL,
      admissionRef: F167,
      sourceExport: 'handleCompleteA2ADispatch',
      authorizationHint: 'callback-owner',
      standaloneKind: 'authority-boundary',
      route: { method: 'POST', path: '/api/callbacks/complete-a2a-dispatch', bodyKeys: ['disposition'] },
    },
    {
      name: 'cat_cafe_set_read_mode',
      description:
        'Set session-level mode for cc native Read/Grep/Glob output (F236 Phase C). ' +
        '"anchor" mode: PostToolUse hook replaces tool output with a locator (file path + total lines + drill pointer) — saves context tokens. ' +
        '"full" mode: pass-through, original output unchanged (default). ' +
        'GOTCHA: Mode is per-invocation (scoped to the current Clowder AI session, cleaned up on session end). ' +
        'GOTCHA: Requires Clowder AI managed session (CAT_CAFE_INVOCATION_ID).',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: readModeInputSchema,
      resourceFamily: FAMILY.runtimeControl,
      runtimeProfiles: FULL,
      admissionRef: F236,
      sourceExport: 'handleSetReadMode',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callbacks/set-read-mode', bodyKeys: ['mode'] },
    },
    {
      name: 'cat_cafe_get_thread_metadata',
      description:
        'Read low-frequency metadata anchors for the current thread: worktree paths, associated PRs/issues, ' +
        'feature links, labels, title, and free-form notes. Call at session start or handoff to recover context. ' +
        'Returns all metadata fields; missing fields are omitted (not null).',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: getThreadMetadataInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL,
      admissionRef: F193,
      sourceExport: 'handleGetThreadMetadata',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/thread-metadata', paramKeys: [] },
    },
    {
      name: 'cat_cafe_set_thread_metadata',
      description:
        'Write low-frequency metadata anchors for the current thread. Merge semantics: ' +
        'title/labels REPLACE; worktrees/prs/issues/features APPEND with dedupe (use remove* fields to remove); notes MERGE (null deletes key). ' +
        'WHEN: after creating a worktree, PR, or issue association — NOT for dynamic state. ' +
        'SCOPE: current thread only (no threadId param); cross-thread writes are impossible.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: setThreadMetadataInputSchema,
      resourceFamily: FAMILY.threadMessage,
      runtimeProfiles: FULL,
      admissionRef: F193,
      sourceExport: 'handleSetThreadMetadata',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/set-thread-metadata',
        bodyKeys: [
          'title',
          'labels',
          'worktrees',
          'prs',
          'issues',
          'features',
          'notes',
          'removeWorktrees',
          'removePrs',
          'removeIssues',
          'removeFeatures',
        ],
      },
    },
  ]);
}