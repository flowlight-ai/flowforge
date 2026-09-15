/**
 * collab/publish-verdict toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/publish-verdict-tool.ts` plus the pure-file
 * constants it imports (`publish-verdict-*-source-refs.ts`,
 * `publish-verdict-friction-findings.ts`, `publish-verdict-refresh-action.ts`),
 * all inlined here with no `@cat-cafe/shared` dependency. The single tool maps to
 * the canonical publish route with a `${domainId}` template; the `refresh_pr`
 * lifecycle branch and the long-running transport settings are host-layer
 * concerns (not ported). Resource family `eval-feedback`.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

// ─── inlined eval-lifecycle refresh action ───────────────────────────
const publishVerdictRefreshActionShape = z
  .object({
    kind: z.literal('refresh_pr'),
    verdictId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    expectedHeadSha: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .describe(
    'Lifecycle transition for an already-open auto-verdict PR. refresh_pr exact-head rebases onto latest main and recomputes only the derived measurement census.',
  );

// ─── inlined source-refs shapes (publish-verdict-*-source-refs.ts) ─────────
const a2aSourceRefsShape = z
  .object({
    kind: z.literal('a2a-snapshot-attribution').optional(),
    snapshotName: z
      .string()
      .min(1)
      .describe('Basename of sanitized eval snapshot YAML inside <harnessFeedbackRoot>/snapshots/.'),
    attributionName: z
      .string()
      .min(1)
      .describe('Basename of sanitized attribution YAML inside <harnessFeedbackRoot>/attributions/.'),
  })
  .describe('eval:a2a sourceRefs — basenames only (path separators / .. rejected by API).');

const capabilityWakeupSourceRefsShape = z
  .object({
    kind: z.literal('capability-wakeup-trial-window'),
    capability: z
      .string()
      .min(1)
      .refine((v) => !/[\r\n]/.test(v), 'capability must not contain newlines (markdown bullet injection)')
      .describe('Capability the verdict is about (e.g. rich-messaging / workspace-navigator / browser-preview).'),
    windowStartMs: z.number().finite().describe('Inclusive — trials with timeSpan.startMs >= this qualify (epoch ms).'),
    windowEndMs: z
      .number()
      .finite()
      .describe('Exclusive — trials with timeSpan.startMs < this qualify. Must be > windowStartMs.'),
    sessionIds: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        'REQUIRED non-empty — session IDs to replay (PR-2 narrowed; global window scan deferred to future PR).',
      ),
    ruleIds: z
      .array(z.string().min(1))
      .optional()
      .describe('Optional narrowing — restrict to specific rule IDs in the static capability-wakeup-rules registry.'),
  })
  .describe(
    'eval:capability-wakeup sourceRefs — replayable selector (window edges + sessionIds required).',
  );

const taskOutcomeVerdictShape = z.enum([
  'success',
  'corrected_success',
  'needs_investigation',
  'harness_fix_needed',
  'routing_failure',
  'taste_mismatch',
  'abandoned',
]);

const taskOutcomeSourceRefsShape = z
  .object({
    kind: z.literal('task-outcome-snapshot'),
    windowStartMs: z.number().finite().describe('Inclusive epoch ms window start for task-outcome episode replay.'),
    windowEndMs: z
      .number()
      .finite()
      .describe('Exclusive epoch ms window end for task-outcome episode replay. Must be > windowStartMs.'),
    databasePath: z
      .string()
      .min(1)
      .optional()
      .describe('Optional DB path override for replay; PR1 schema-only surface, real generator lands in PR2.'),
    evidenceCatId: z
      .string()
      .min(1)
      .optional()
      .describe('Optional evidence anchor catId for cross-thread linking; PR1 schema-only surface.'),
    episodeVerdicts: z
      .array(
        z.object({
          episodeId: z.string().min(1).describe('Task Outcome episodeId selected by this replay window.'),
          verdict: taskOutcomeVerdictShape.describe('7-class per-episode task outcome verdict assigned by eval cat.'),
        }),
      )
      .min(1)
      .optional()
      .describe(
        'Optional explicit per-episode writeback list. Exact same-value replays are idempotent for replacement publishes; a different value is rejected to preserve audit history.',
      ),
  })
  .describe('eval:task-outcome sourceRefs — replay window selector with optional episode verdict writeback.');

const memorySourceRefsShape = z
  .object({
    kind: z.literal('memory-recall-snapshot'),
    windowDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .describe('Inclusive window in days [1, 90] — recall API ceiling (packages/api/src/routes/recall-metrics.ts).'),
    catId: z
      .string()
      .min(1)
      .refine((v) => !/[\r\n]/.test(v), 'catId must not contain newlines (markdown bullet injection)')
      .optional()
      .describe('Optional — restrict to a specific cat id (matches RecallMetricsComputer filters.catId).'),
    toolName: z
      .string()
      .min(1)
      .refine((v) => !/[\r\n]/.test(v), 'toolName must not contain newlines (markdown bullet injection)')
      .optional()
      .describe('Optional — restrict to a specific recall tool (e.g. cat_cafe_search_evidence).'),
  })
  .describe('eval:memory sourceRefs — replayable recall metrics selector (windowDays + optional filters).');

// ─── inlined SOP trace source refs (publish-verdict-sop-source-refs.ts) ─────
const sopGitShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'must be a full 40-character Git SHA');
const sopDiffContextSchema = z.object({
  baseSha: sopGitShaSchema,
  headSha: sopGitShaSchema,
  files: z.array(
    z.object({
      path: z.string().min(1),
      addedLines: z.array(z.string()),
    }),
  ),
});
const sopDesignGateReviewPacketSchema = z.object({
  exactHeadSha: sopGitShaSchema,
  riskClaims: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['consumer_delta', 'authority_delta', 'preservation_boundary_delta']),
      summary: z.string(),
      canonicalSource: z.string(),
      consumerEvidence: z.string(),
      claimGuard: z.object({
        command: z.string(),
        redWhen: z.string(),
      }),
    }),
  ),
  targetedSelfCheckReceipts: z.array(
    z.object({
      claimId: z.string(),
      headSha: sopGitShaSchema,
      command: z.string(),
      exitCode: z.number().int(),
    }),
  ),
});
const sopSourceRefsShape = z
  .object({
    kind: z.literal('sop-trace-eval'),
    sopDefinitionId: z
      .string()
      .min(1)
      .describe(
        'SOP definition to evaluate against (e.g. "development"). Must match a known definition in the catalog.',
      ),
    trace: z
      .object({
        sessionId: z.string().min(1),
        sopDefinitionId: z.string().min(1),
        observedStage: z.string().min(1),
        commands: z.array(
          z.object({
            command: z.string().min(1),
            cwd: z.string().optional(),
            exitCode: z.number().int().optional(),
            eventNo: z.number().int().min(0).optional(),
            timestamp: z.number().finite().optional(),
            stdout: z.string().optional(),
            summary: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
        changedFiles: z.array(z.string().min(1)),
        changedFileEvents: z
          .array(
            z
              .object({
                path: z.string().min(1),
                eventNo: z.number().int().min(0).optional(),
                timestamp: z.number().finite().optional(),
              })
              .refine((event) => event.eventNo !== undefined || event.timestamp !== undefined, {
                message: 'changedFileEvents require eventNo or timestamp',
              }),
          )
          .optional(),
        envSnapshot: z.record(z.string(), z.string().or(z.undefined())),
        gitState: z.object({
          branch: z.string().min(1),
          ahead: z.number().int().min(0),
          behind: z.number().int().min(0),
          clean: z.boolean(),
          worktreeRoot: z.string().optional(),
        }),
        handles: z.object({
          author: z.string().optional(),
          reviewer: z.string().optional(),
          guardian: z.string().optional(),
        }),
        shaContext: z.record(z.string(), z.string()),
        diffContext: sopDiffContextSchema.optional(),
        designGateReviewPacket: sopDesignGateReviewPacketSchema.optional(),
      })
      .superRefine((trace, ctx) => {
        const changedFileEvents = trace.changedFileEvents ?? [];
        if (changedFileEvents.length > 0) {
          const graphCommands = trace.commands.filter(
            (command) =>
              /\b(?:pnpm\s+convention-graph:code-consumers|cat-cafe-convention-graph\s+code-consumers)\b/.test(
                command.command,
              ),
          );
          if (graphCommands.length > 0) {
            for (const [index, changedFileEvent] of changedFileEvents.entries()) {
              if (
                graphCommands.some(
                  (command) =>
                    (command.eventNo !== undefined && changedFileEvent.eventNo !== undefined) ||
                    (command.timestamp !== undefined && changedFileEvent.timestamp !== undefined),
                )
              )
                continue;
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['changedFileEvents', index],
                message: 'convention graph commands and changedFileEvents require shared eventNo or timestamp',
              });
            }
          }
        }

        const diffContext = trace.diffContext;
        const packet = trace.designGateReviewPacket;
        if (!diffContext) {
          if (packet) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['designGateReviewPacket'],
              message: 'designGateReviewPacket requires diffContext exact HEAD evidence',
            });
          }
          return;
        }

        if (diffContext.baseSha === diffContext.headSha) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['diffContext', 'headSha'],
            message: 'diffContext baseSha and headSha must differ',
          });
        }

        const diffPaths = diffContext.files.map((file) => file.path);
        if (new Set(diffPaths).size !== diffPaths.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['diffContext', 'files'],
            message: 'diffContext file paths must be unique',
          });
        }
        const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();
        const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
          left.length === right.length && left.every((value, index) => value === right[index]);
        if (!sameStrings(sortedUnique(trace.changedFiles), sortedUnique(diffPaths))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['diffContext', 'files'],
            message: 'diffContext files and changedFiles must describe the same path set',
          });
        }

        if (!packet) return;
        if (packet.exactHeadSha !== diffContext.headSha) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['designGateReviewPacket', 'exactHeadSha'],
            message: 'designGateReviewPacket exactHeadSha must match diffContext headSha exact HEAD',
          });
        }
        const claimIds = packet.riskClaims.map((claim) => claim.id);
        if (new Set(claimIds).size !== claimIds.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['designGateReviewPacket', 'riskClaims'],
            message: 'design-gate risk claim ids must be unique',
          });
        }
      })
      .describe('Full SopTrace data for deterministic replay. See eval cat invocation instructions for field details.'),
  })
  .describe('eval:sop sourceRefs — replayable SOP trace selector (sopDefinitionId + embedded trace).');

const frictionRollupSourceRefsShape = z
  .object({
    kind: z.literal('friction-rollup-snapshot'),
    windowStartMs: z.number().finite().describe('Inclusive epoch ms window start for friction signal collection.'),
    windowEndMs: z
      .number()
      .finite()
      .describe('Exclusive epoch ms window end for friction signal collection. Must be > windowStartMs.'),
    topN: z.number().int().min(1).optional().describe('Optional deep-dive quota for the rollup report (producer default 10).'),
    tokenCap: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Optional hard token ceiling for the serialized rollup report (producer default 4000).'),
  })
  .describe('eval:friction sourceRefs — replayable rollup window selector (window + optional topN/tokenCap).');

const anchorTelemetrySourceRefsShape = z
  .object({
    kind: z.literal('anchor-telemetry-snapshot'),
    windowStartMs: z.number().finite().describe('Inclusive epoch ms window start for anchor telemetry rollup.'),
    windowEndMs: z
      .number()
      .finite()
      .describe('Exclusive epoch ms window end for anchor telemetry rollup. Must be > windowStartMs.'),
  })
  .describe('eval:anchor-first sourceRefs — replayable anchor telemetry rollup window selector.');

const qcMetricsSourceRefsShape = z
  .object({
    kind: z.literal('qc-metrics-rollup'),
    windowStartMs: z.number().finite().describe('Inclusive epoch ms window start for QC metrics rollup.'),
    windowEndMs: z
      .number()
      .finite()
      .describe('Exclusive epoch ms window end for QC metrics rollup. Must be > windowStartMs.'),
  })
  .describe('eval:qc sourceRefs — replayable QC metrics rollup window selector.');

// ─── inlined freshness / trajectory-inspector source refs ──────────────────
const freshnessReplaySourceRefsShape = z
  .object({
    kind: z.literal('freshness-closure-replay'),
    windowStartMs: z.number().finite().describe('Inclusive epoch ms window start for durable closure replay.'),
    windowEndMs: z.number().finite().describe('Exclusive epoch ms window end; API enforces ordering and 31-day cap.'),
    threadIds: z
      .array(
        z
          .string()
          .min(1)
          .refine((value) => !/[\r\n]/.test(value), 'id must not contain newlines'),
      )
      .min(1)
      .max(50)
      .optional()
      .describe('Optional live-closure thread narrowing.'),
  })
  .strict()
  .describe('eval:freshness sourceRefs — server-resolved durable closure and structural fixture replay.');

const trajectoryInspectorSourceRefsShape = z
  .object({
    kind: z.literal('trajectory-inspector-window'),
    windowStartMs: z.number().int().nonnegative().describe('Inclusive owner-scoped transcript window start.'),
    windowEndMs: z.number().int().positive().describe('Exclusive owner-scoped transcript window end.'),
  })
  .strict()
  .superRefine((selector, ctx) => {
    if (selector.windowEndMs <= selector.windowStartMs) {
      ctx.addIssue({ code: 'custom', path: ['windowEndMs'], message: 'windowEndMs must exceed windowStartMs' });
    }
    if (selector.windowEndMs - selector.windowStartMs > 31 * 24 * 60 * 60 * 1_000) {
      ctx.addIssue({ code: 'custom', path: ['windowEndMs'], message: 'window must not exceed 31 days' });
    }
  })
  .describe(
    'eval:trajectory-inspector sourceRefs — bounded server-resolved transcript window; caller-authored episodes are forbidden.',
  );

const designGateSourceRefsShape = z
  .object({
    kind: z.literal('design-gate-episode-source-map'),
    sourceMapId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
      .describe('Server-owned source map id under docs/harness-feedback/design-gate/source-maps/.'),
  })
  .strict()
  .describe('eval:design-gate sourceRefs — canonical episode source-map selector.');

const sourceRefsShape = z
  .union([
    a2aSourceRefsShape,
    capabilityWakeupSourceRefsShape,
    taskOutcomeSourceRefsShape,
    memorySourceRefsShape,
    sopSourceRefsShape,
    frictionRollupSourceRefsShape,
    anchorTelemetrySourceRefsShape,
    qcMetricsSourceRefsShape,
    freshnessReplaySourceRefsShape,
    designGateSourceRefsShape,
    trajectoryInspectorSourceRefsShape,
  ])
  .describe(
    'Discriminated union by `kind` field. a2a kind is the backward-compatible default; replayable selectors are wired for capability wakeup, memory, task outcome, SOP, friction, anchor telemetry, QC metrics, F254 freshness closures, F303 design-gate episodes, and F299 trajectory-inspector windows.',
  );

// ─── inlined friction findings (publish-verdict-friction-findings.ts) ───────
const approvalRequirementShape = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('required'),
      reason: z.enum(['repair', 'accept_no_change', 'extend_budget', 'change_scope', 'change_owner']),
    })
    .strict(),
  z.object({ kind: z.literal('not_required') }).strict(),
]);

const frictionAnalysisFindingShape = z
  .object({
    candidateRef: z.string().min(1),
    findingKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
    analysisDisposition: z.enum(['repair', 'no_repair', 'observe', 'insufficient']),
    approvalRequirement: approvalRequirementShape,
    interventionKind: z.enum(['fix', 'build', 'delete_sunset']).optional(),
    rationale: z.string().min(1),
    uncertainty: z.enum(['low', 'medium', 'high']),
    falsifier: z.object({ condition: z.string().min(1), evidenceRef: z.string().min(1) }).strict(),
    withdrawalCondition: z.string().min(1),
    measurementResultRef: z.string().min(1),
    sourceSignalRefs: z.array(z.string().min(1)).min(1),
    repairTargetHint: z
      .object({
        featureId: z.string().regex(/^F\d{3}$/),
        componentId: z.string().min(1).optional(),
      })
      .strict()
      .describe('Untrusted feature/component hint only; owner/version/resolutionRef/resolvedAt are server-derived.'),
  })
  .strict()
  .superRefine((finding, ctx) => {
    if (finding.analysisDisposition === 'repair') {
      if (!finding.interventionKind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['interventionKind'],
          message: 'repair requires interventionKind',
        });
      }
      if (finding.approvalRequirement.kind !== 'required' || finding.approvalRequirement.reason !== 'repair') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['approvalRequirement'],
          message: 'repair requires Approval',
        });
      }
    } else if (finding.interventionKind !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['interventionKind'],
        message: 'non-repair cannot carry interventionKind',
      });
    }
  });

const frictionAnalysisFindingsShape = z
  .array(frictionAnalysisFindingShape)
  .min(1)
  .optional()
  .describe(
    'eval:friction only. One typed judgment per actionable candidate. Caller supplies target hints; API resolves owner/version/evidence refs.',
  );

// ─── verdict packet + main input schema ────────────────────────────────────
const verdictPacketShape = z
  .object({
    id: z.string().min(1),
    domainId: z.string().min(1),
    createdAt: z.string().min(1),
    phenomenon: z.string().min(1),
    verdict: z.enum(['fix', 'build', 'keep_observe', 'delete_sunset']),
  })
  .passthrough()
  .describe(
    'VerdictHandoffPacket — 12 fields total (id, domainId, createdAt, phenomenon, harnessUnderEval, evidencePacket, dailyTrend, rootCauseHypothesis, verdict, ownerAsk, acceptanceReevalPlan, counterarguments; governance optional except delete_sunset). See instructions in your eval cat invocation packet for full schema.',
  );

const publishVerdictInputSchema = {
  domainId: z.string().min(1).describe('Your assigned registered eval domain. Must match packet.domainId.'),
  packet: verdictPacketShape.optional(),
  sourceRefs: sourceRefsShape.optional(),
  analysisFindings: frictionAnalysisFindingsShape,
  action: publishVerdictRefreshActionShape.optional(),
  agentKeyCatId: z
    .string()
    .min(1)
    .optional()
    .describe('Persistent-agent identity selector. Required for shared Antigravity MCP.'),
};

export const PUBLISH_VERDICT_SERVER_FAMILY = 'collab' as const;
const F192 = 'file:docs/features/F192-publish-verdict.md' as const;

export function buildPublishVerdictToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, PUBLISH_VERDICT_SERVER_FAMILY, [
    {
      name: 'cat_cafe_publish_verdict',
      description:
        'Publish a converged eval-domain verdict as a structured commit and auto-PR. ' +
        'Use when: your analysis has converged for the eval domain assigned to you. ' +
        'NOT for: manually writing verdict files or running git add/commit/push; this tool owns that publish lifecycle. ' +
        'For initial publish, pass packet + sourceRefs. For an open auto-verdict PR whose base moved, pass action={kind:"refresh_pr", verdictId, expectedHeadSha}; do not replay packet/writeback. ' +
        'Output: validates the packet, generates evidence in an isolated worktree, pushes verdict/auto/<domain-slug>/<verdict-id>, opens an auto-PR, and returns { commitSha, prUrl }. ' +
        'GOTCHA: wired domains include eval:a2a plus replayable capability-wakeup, memory, SOP, task-outcome, friction, anchor-first, freshness, QC, and design-gate generators. Unregistered or runtime-unwired domains return 501. ' +
        'GOTCHA: catId must match the registered eval cat for the domain (or its OQ-20 Redis override); 403 not_allowed otherwise. ' +
        'GOTCHA: every evidencePacket.metricRefs entry must resolve against the selected domain glossary; unknown refs return 400 before any evidence branch or PR is created. ' +
        'GOTCHA: refresh_pr verifies exact HEAD, auto-verdict provenance, target-only diff scope, and only auto-resolves the derived measurement census conflict; any other conflict fails closed. ' +
        'GOTCHA: replacement publishes may repeat an exact stored episode verdict, but refresh_pr is preferred when the existing PR only needs a current-base census refresh.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: publishVerdictInputSchema,
      resourceFamily: 'eval-feedback',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F192,
      sourceExport: 'handlePublishVerdict',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/eval-domains/${domainId}/publish-verdict',
        bodyKeys: ['packet', 'sourceRefs', 'analysisFindings'],
      },
    },
  ]);
}