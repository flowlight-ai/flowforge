/**
 * 会议产物资源契约：读取视图、输入校验、资源错误码、幂等键。
 * 忠实移植 clowder-ai `domains/signal-intake/meeting-artifact-resource-contract.ts`。
 * 交付载体读取经本地 `MeetingArtifactCarrierReader` 端口注入（见下）。
 *
 * @flowforge/cats-signal-intake
 */

import type { MeetingArtifactDescriptor } from './contract/signals.ts'
import type { MeetingIntakeStore } from './MeetingIntakeStore.ts'
import type { SourceAccessLeaseService } from './SourceAccessLeaseService.ts'

export type MeetingArtifactReadView = 'overview' | 'outline' | 'content'

/** 经本地端口注入的会议产物载体读取面（宿主在 EP2 接线到 flowforge 消息 store）。 */
export interface MeetingArtifactCarrierRecord {
  readonly userId: string
  readonly threadId: string
  readonly source?: { readonly connector: string }
  readonly mentions: readonly string[]
  readonly extra?: {
    readonly meetingArtifact?: {
      readonly resourceRef: string
      readonly sourceRevision: string
    }
  }
}

export interface MeetingArtifactCarrierReader {
  getByIdempotencyKey(
    ownerId: string,
    threadId: string,
    idempotencyKey: string,
  ): Promise<MeetingIntakeCarrierResolved | null>
}

export interface MeetingIntakeCarrierResolved {
  readonly userId: string
  readonly threadId: string
  readonly connectorFromSource?: string
  readonly mentions: readonly string[]
  readonly meetingArtifact?: {
    readonly resourceRef: string
    readonly sourceRevision: string
  }
}

export function meetingArtifactCarrierIdempotencyKey(
  intakeId: string,
  sourceRevision: MeetingArtifactDescriptor['sourceRevision'],
): string {
  return `meeting-artifact:${intakeId}:${sourceRevision}`
}

export interface MeetingArtifactReadInput {
  readonly ownerId: string
  readonly threadId: string
  readonly catId: string
  readonly resourceRef: string
  readonly view: MeetingArtifactReadView
  readonly maxChars: number
  readonly maxTokens: number
  readonly cursor?: string
  readonly speakers?: readonly string[]
  readonly startTimeMs?: number
  readonly endTimeMs?: number
}

export function validateMeetingArtifactReadInput(input: MeetingArtifactReadInput): void {
  if (
    !Number.isSafeInteger(input.maxChars) ||
    input.maxChars < 1 ||
    input.maxChars > 12_000 ||
    !Number.isSafeInteger(input.maxTokens) ||
    input.maxTokens < 1 ||
    input.maxTokens > 3_000 ||
    (input.speakers !== undefined &&
      (input.speakers.length < 1 ||
        input.speakers.length > 16 ||
        input.speakers.some((speaker) => !speaker.trim() || speaker.length > 128))) ||
    (input.startTimeMs !== undefined && (!Number.isSafeInteger(input.startTimeMs) || input.startTimeMs < 0)) ||
    (input.endTimeMs !== undefined && (!Number.isSafeInteger(input.endTimeMs) || input.endTimeMs < 0)) ||
    (input.startTimeMs !== undefined && input.endTimeMs !== undefined && input.startTimeMs > input.endTimeMs)
  ) {
    throw new MeetingArtifactResourceError('INVALID_READ_REQUEST', 'meeting artifact read bounds are invalid')
  }
}

export type MeetingArtifactResourceErrorCode =
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_FORBIDDEN'
  | 'RESOURCE_REVISION_MISMATCH'
  | 'SOURCE_REVISION_CHANGED'
  | 'INVALID_READ_REQUEST'
  | 'INVALID_CURSOR'

export class MeetingArtifactResourceError extends Error {
  constructor(
    readonly code: MeetingArtifactResourceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MeetingArtifactResourceError'
  }
}

export interface MeetingArtifactResourceServiceOptions {
  readonly intakes: Pick<MeetingIntakeStore, 'get'>
  readonly sources: SourceAccessLeaseService
  readonly messages: MeetingArtifactCarrierReader
}