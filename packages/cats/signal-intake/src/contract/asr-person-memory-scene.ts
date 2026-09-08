/**
 * ASR 人物记忆写机会（write-opportunity）契约：反射常量 + 动态场景 schema + 重试载体。
 *
 * 忠实移植 clowder-ai `shared/src/types/memory-write-opportunity.ts`（本地化，
 * 仅保留信号准入域所需子集）。不依赖 @cat-cafe/shared，zod ^4.4.3。
 *
 * @flowforge/cats-signal-intake — contract/asr-person-memory-scene
 */

import { z } from 'zod'

const bounded = (max: number) => z.string().trim().min(1).max(max)
const timestampSchema = z.number().int().nonnegative().finite()
const sha256RevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const writeOpportunityLineageSchema = z.string().regex(/^write_lineage_[a-f0-9]{32}$/)
export const MAX_WRITE_OPPORTUNITY_GENERATION = 0xffff_ffff

/** 稳定可移植生成 ID：96 位 lineage + 有界 32 位 generation。 */
export function writeOpportunityGenerationId(dedupeLineage: string, generation: number): string {
  const lineage = writeOpportunityLineageSchema.parse(dedupeLineage).slice('write_lineage_'.length)
  if (!Number.isInteger(generation) || generation < 1 || generation > MAX_WRITE_OPPORTUNITY_GENERATION) {
    throw new RangeError('write opportunity generation must be a positive uint32')
  }
  return `write_opp_${lineage.slice(0, 24)}${generation.toString(16).padStart(8, '0')}`
}

export const asrTranscriptSourceCoordinateV1Schema = z
  .object({
    kind: z.literal('asr_transcript_segment'),
    artifactId: bounded(240),
    sourceHandle: bounded(1_000),
    sourceRevision: sha256RevisionSchema,
    segment: z
      .object({
        unit: z.literal('utf8_byte'),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      })
      .strict(),
    speaker: z
      .object({
        externalSpeakerId: bounded(160),
        label: bounded(160),
        attributionRevision: sha256RevisionSchema,
        attributionCeiling: z.enum(['unattributed', 'machine_diarized', 'owner_confirmed_mapping']),
      })
      .strict(),
  })
  .strict()
  .refine((value) => value.segment.end > value.segment.start, {
    path: ['segment', 'end'],
    message: 'segment end must be greater than start',
  })

export const asrPersonMemoryWriteOpportunityV1Schema = z
  .object({
    v: z.literal(1),
    opportunityId: z.string().regex(/^write_opp_[a-f0-9]{32}$/),
    reflexId: z.literal('asr-person-memory'),
    reflexVersion: z.literal(1),
    generation: z.number().int().positive().max(MAX_WRITE_OPPORTUNITY_GENERATION),
    producer: z.literal('meeting_artifact'),
    consumer: z
      .object({
        kind: z.literal('cat'),
        catId: bounded(160),
      })
      .strict(),
    scope: z
      .object({
        ownerUserId: bounded(160),
        threadId: bounded(160),
      })
      .strict(),
    observedAt: timestampSchema,
    eligibleAt: timestampSchema,
    expiresAt: timestampSchema,
    sourceCoordinates: z.array(asrTranscriptSourceCoordinateV1Schema).min(1).max(8),
    epistemicCeiling: z.literal('mechanical_observation'),
    destination: z
      .object({
        lane: z.literal('person_memory'),
        proposalContract: z.literal('F276.CaptureCandidate.v1'),
      })
      .strict(),
    dedupeLineage: writeOpportunityLineageSchema,
    rearmPredicate: z.literal('next_eligible_owner_context_after_defer'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.eligibleAt < value.observedAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['eligibleAt'], message: 'eligibleAt precedes observation' })
    }
    if (value.expiresAt <= value.eligibleAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'expiry must follow eligibility' })
    }
    const revisions = new Set(value.sourceCoordinates.map((coordinate) => coordinate.sourceRevision))
    if (revisions.size !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceCoordinates'],
        message: 'one opportunity generation must bind one source revision',
      })
    }
  })

export const asrPersonMemoryDynamicSceneEntryV1Schema = z
  .object({
    v: z.literal(1),
    kind: z.literal('memory_write_opportunity'),
    surface: z.literal('dynamic_context'),
    opportunity: asrPersonMemoryWriteOpportunityV1Schema,
  })
  .strict()

/** 服务端书面、仅引用的载体：重述一个未变的写机会 generation。 */
export const writeOpportunityPresentationRetryCarrierV1Schema = z
  .object({
    v: z.literal(1),
    sourceMessageRef: z
      .object({
        kind: z.literal('message'),
        threadId: bounded(160),
        messageId: bounded(240),
      })
      .strict(),
    sourceOpportunityId: z.string().regex(/^write_opp_[a-f0-9]{32}$/),
  })
  .strict()

export const ASR_PERSON_MEMORY_REFLEX_ENTRY_V1 = Object.freeze({
  v: 1 as const,
  reflexId: 'asr-person-memory' as const,
  version: 1 as const,
  ownerCell: 'memory/private-person-relationship' as const,
  consumer: 'agent_route' as const,
  eligibleDestinationLanes: ['person_memory'] as const,
  producer: 'meeting_artifact' as const,
  predicateRef: 'confirmed-meeting-speaker-map-present' as const,
  predicateRevision: 1 as const,
  sourceCoordinateKinds: ['asr_transcript_segment'] as const,
  epistemicCeiling: 'mechanical_observation' as const,
  allowedDispositions: ['propose', 'defer', 'abstain'] as const,
  immediateTargetByLane: { person_memory: 'F276.CaptureCandidate.v1' as const },
  deferredTargetByLane: { person_memory: 'F276.CaptureCandidate.v1' as const },
  deferredReceiptContract: 'StandingReflex.DeferredWriteOpportunityReceipt.v1' as const,
  eligibleSurfaces: ['dynamic_context'] as const,
  presentationPolicyRef: 'F296.OpportunityPresentation' as const,
  tokenBudget: 160,
  expiryMs: 7 * 24 * 60 * 60 * 1_000,
  rearmPredicate: 'next_eligible_owner_context_after_defer' as const,
  invalidators: ['source_corrected', 'source_forgotten', 'scope_revoked', 'superseded', 'expired'] as const,
  sunsetOwner: 'memory/private-person-relationship' as const,
})

export type AsrPersonMemoryDynamicSceneEntryV1 = z.infer<typeof asrPersonMemoryDynamicSceneEntryV1Schema>
export type AsrPersonMemoryWriteOpportunityV1 = z.infer<typeof asrPersonMemoryWriteOpportunityV1Schema>
export type WriteOpportunityPresentationRetryCarrierV1 = z.infer<
  typeof writeOpportunityPresentationRetryCarrierV1Schema
>

/** 队列消息携带的写机会场景（动态上下文投影）。 */
export interface BoundAsrPersonMemoryScene {
  readonly scene: AsrPersonMemoryDynamicSceneEntryV1
  readonly source: {
    readonly kind: 'message'
    readonly threadId: string
    readonly sourceMessageId: string
    readonly authorUserId: string
    readonly authorRole: 'owner'
    readonly visibility: 'verified_live_owner_message'
  }
}