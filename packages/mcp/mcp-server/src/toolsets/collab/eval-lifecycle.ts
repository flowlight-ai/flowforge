/**
 * collab/eval-lifecycle toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/eval-lifecycle-tools.ts`. Two handlers:
 *   - record_eval_lifecycle: POST `/api/eval-verdicts/${verdictId}/lifecycle-events`
 *   - propose_eval_repair:    POST `/api/callbacks/propose-eval-repair`
 * Resource family `eval-feedback`.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const nonEmpty = z.string().trim().min(1);
const commitSha = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const refKind = z.enum(['verdict', 'message', 'task', 'plan', 'commit', 'pull_request', 'reeval', 'sla', 'other']);
const lifecycleRef = z.discriminatedUnion('availability', [
  z.object({ kind: refKind, availability: z.literal('available'), value: nonEmpty }).strict(),
  z.object({ kind: refKind, availability: z.literal('unavailable'), unavailableReason: nonEmpty }).strict(),
]);

const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('plan_action') }).strict(),
  z.object({ type: z.literal('record_main_landed'), commitSha }).strict(),
  z.object({ type: z.literal('record_live_active'), commitSha }).strict(),
  z.object({ type: z.literal('request_reeval') }).strict(),
  z.object({ type: z.literal('record_reeval_result'), result: z.enum(['passed', 'failed']) }).strict(),
]);

const agentKeyCatId = nonEmpty
  .optional()
  .describe(
    'Persistent-agent identity selector. Required for shared agent-key MCP variants; ignored under invocation auth.',
  );

const recordEvalLifecycleInputSchema = {
  verdictId: nonEmpty.describe('Immutable verdictId whose stable case receives the writeback.'),
  eventId: nonEmpty.describe('Stable idempotency key for this exact lifecycle fact.'),
  expectedSequence: z.number().int().nonnegative().describe('Current canonical case sequence.'),
  reason: nonEmpty.describe('Evidence-based reason for this lifecycle fact.'),
  refs: z.array(lifecycleRef).min(1).describe('Caller evidence; server adds main/live verification refs.'),
  action: action.describe('Owner/eval action. Main/live facts are independently verified by the API.'),
  agentKeyCatId,
};

const proposeEvalRepairInputSchema = {
  caseActionRef: nonEmpty.max(500).describe('Opaque F266 case/action ref emitted by the canonical reconciler.'),
  clientMessageId: nonEmpty.max(240).describe('Retry-stable idempotency key; never treated as identity or authority.'),
};

export const EVAL_LIFECYCLE_SERVER_FAMILY = 'collab' as const;
const F266 = 'file:docs/features/F266-eval-lifecycle-closure.md' as const;
const F313 = 'file:docs/features/F313-analysis-to-outcome-closure-command.md' as const;

export function buildEvalLifecycleToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, EVAL_LIFECYCLE_SERVER_FAMILY, [
    {
      name: 'cat_cafe_record_eval_lifecycle',
      description:
        'Write one authenticated fact to an actionable eval finding stable-case lifecycle. ' +
        'Use when: the assigned owner records an action plan, verified main/live commit, or requests re-evaluation; the pinned eval cat records pass/fail. ' +
        'NOT for: acknowledging without a durable task/F167 lease, caller-authored actor/SLA, suppressing on behalf of operator, fabricating runtime activation, or creating a second task for a repeated verdict cycle. ' +
        'Output: appended/duplicate/conflict plus the replayed stable-case projection with task, lease, main, live, and re-eval state. ' +
        'GOTCHA: main and live are separate server-verified facts; use the same commit and current case sequence.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: recordEvalLifecycleInputSchema,
      resourceFamily: 'eval-feedback',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F266,
      sourceExport: 'handleRecordEvalLifecycle',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/eval-verdicts/${verdictId}/lifecycle-events',
        bodyKeys: ['eventId', 'expectedSequence', 'reason', 'refs', 'action'],
      },
    },
    {
      name: 'cat_cafe_propose_eval_repair',
      description:
        'Submit one canonical F266 case/action ref to the shared F246 Approval lifecycle. ' +
        'Use when: the F266 reconciler exposed an actionable repair cycle that requires owner approval. ' +
        'NOT for: observe/insufficient findings, caller-authored owner/target/permission data, direct Task/F167 lease creation, or mutation. ' +
        'Output: published/not_required/blocked with a canonical proposal ref. ' +
        'GOTCHA: clientMessageId is idempotency only; invocation principal and Approval origin are derived by the server.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: proposeEvalRepairInputSchema,
      resourceFamily: 'eval-feedback',
      runtimeProfiles: ['full'],
      admissionRef: F313,
      sourceExport: 'handleProposeEvalRepair',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/propose-eval-repair',
        bodyKeys: ['caseActionRef', 'clientMessageId'],
      },
    },
  ]);
}