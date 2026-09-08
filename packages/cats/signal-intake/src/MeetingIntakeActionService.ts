/**
 * 会议入站动作服务：confirm→execute-from-source→deliver 编排 + 修复/重试/手导。
 * 忠实移植 clowder-ai `domains/signal-intake/MeetingIntakeActionService.ts`。
 *
 * @flowforge/cats-signal-intake
 */

import type { MeetingArtifactDescriptor, MeetingIntake, MeetingIntakeChoices } from './contract/signals.ts'
import { MeetingIntakeError } from './errors.ts'
import { createMeetingArtifactDescriptor } from './MeetingArtifactResourceService.ts'
import type { MeetingIntakeService } from './MeetingIntakeService.ts'
import type { MeetingIntakeStore } from './MeetingIntakeStore.ts'
import type { SourceAccessLeaseService } from './SourceAccessLeaseService.ts'

export interface ResolvedMeetingArtifact {
  readonly contentType: 'text/plain'
  readonly text: string
  readonly provenance: {
    readonly sourceHandle: string
    readonly trust: 'untrusted_external'
    readonly instructionPolicy: 'data_only'
  }
}

export interface MeetingPresentationRetryReceipt {
  readonly sourceMessageId: string
  readonly triggerMessageId: string
  readonly queueEntryId: string | null
  readonly opportunityId: string
  readonly targetCatId: string
  readonly deduped: boolean
}

/** 交付端口：宿主在 EP2 接线到 cats-invocation + 消息 store。本批次注入内存实现。 */
export interface MeetingArtifactDispatcher {
  deliver(input: { readonly intake: MeetingIntake; readonly artifact: MeetingArtifactDescriptor }): Promise<void>
  retryPresentation(input: {
    readonly intake: MeetingIntake
    readonly clientRequestId: string
  }): Promise<MeetingPresentationRetryReceipt>
}

export interface MeetingIntakeActionServiceOptions {
  readonly store: MeetingIntakeStore
  readonly meeting: MeetingIntakeService
  readonly sources: SourceAccessLeaseService
  readonly dispatcher: MeetingArtifactDispatcher
  readonly now?: () => number
}

type ActionFailure =
  | 'transcript_not_ready'
  | 'auth_required'
  | 'source_deleted'
  | 'route_unavailable'
  | 'execution_failed'

const SOURCE_FAILURE_CODES: Readonly<Record<string, ActionFailure>> = {
  SOURCE_NOT_READY: 'transcript_not_ready',
  SOURCE_AUTH_REQUIRED: 'auth_required',
  SOURCE_DELETED: 'source_deleted',
}
const DISPATCH_FAILURE_CODES: Readonly<Record<string, ActionFailure>> = {
  ROUTE_UNAVAILABLE: 'route_unavailable',
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
}

function sourceFailure(error: unknown): ActionFailure {
  return SOURCE_FAILURE_CODES[errorCode(error)] ?? 'execution_failed'
}

function dispatchFailure(error: unknown): ActionFailure {
  return DISPATCH_FAILURE_CODES[errorCode(error)] ?? 'execution_failed'
}

const REPAIR_BY_CODE: Readonly<
  Record<ActionFailure, { readonly sourceState: MeetingIntake['sourceState'] | null; readonly action: 'retry' | 'regrant' | 'manual_import' }>
> = {
  transcript_not_ready: { sourceState: 'not_ready', action: 'retry' },
  auth_required: { sourceState: 'auth_required', action: 'regrant' },
  source_deleted: { sourceState: 'deleted', action: 'manual_import' },
  route_unavailable: { sourceState: null, action: 'retry' },
  execution_failed: { sourceState: null, action: 'retry' },
}

export class MeetingIntakeActionService {
  private readonly now: () => number

  constructor(private readonly options: MeetingIntakeActionServiceOptions) {
    this.now = options.now ?? Date.now
  }

  async confirm(
    ownerId: string,
    intakeId: string,
    expectedRevision: number,
    choices: MeetingIntakeChoices,
  ): Promise<MeetingIntake> {
    const confirmed = await this.confirmChoices(ownerId, intakeId, expectedRevision, choices)
    return this.executeFromSource(ownerId, confirmed.intakeId, confirmed.revision)
  }

  async confirmChoices(
    ownerId: string,
    intakeId: string,
    expectedRevision: number,
    choices: MeetingIntakeChoices,
  ): Promise<MeetingIntake> {
    await this.requireOwner(ownerId, intakeId, expectedRevision)
    return this.options.meeting.confirm(intakeId, expectedRevision, choices)
  }

  async dismiss(ownerId: string, intakeId: string, expectedRevision: number): Promise<MeetingIntake> {
    await this.requireOwner(ownerId, intakeId, expectedRevision)
    return this.options.meeting.dismiss(intakeId, expectedRevision)
  }

  async retry(ownerId: string, intakeId: string, expectedRevision: number): Promise<MeetingIntake> {
    const current = await this.requireOwner(ownerId, intakeId, expectedRevision)
    if (
      !current.repair ||
      (current.repair.action !== 'retry' && current.repair.action !== 'regrant') ||
      current.judgmentState !== 'confirmed' ||
      current.executionState !== 'failed'
    ) {
      throw new MeetingIntakeError('INVALID_TRANSITION', 'meeting intake is not retryable')
    }
    const queuedNext: MeetingIntake = {
      ...current,
      sourceState: 'ready',
      healthState: 'healthy',
      executionState: 'queued',
      revision: current.revision + 1,
      updatedAt: this.now(),
    }
    delete (queuedNext as { repair?: unknown }).repair
    const queued = await this.write(current, queuedNext)
    return this.executeFromSource(ownerId, intakeId, queued.revision)
  }

  async retryPresentation(
    ownerId: string,
    intakeId: string,
    expectedRevision: number,
    clientRequestId: string,
  ): Promise<{ readonly intake: MeetingIntake; readonly presentationRetry: MeetingPresentationRetryReceipt }> {
    const current = await this.requireOwner(ownerId, intakeId, expectedRevision)
    if (
      current.judgmentState !== 'confirmed' ||
      current.executionState !== 'succeeded' ||
      current.healthState !== 'healthy' ||
      current.sourceState !== 'ready' ||
      !current.choices.destinationHandle
    ) {
      throw new MeetingIntakeError('INVALID_TRANSITION', 'meeting intake has not completed successfully')
    }
    try {
      const presentationRetry = await this.options.dispatcher.retryPresentation({ intake: current, clientRequestId })
      return { intake: current, presentationRetry }
    } catch (error) {
      const code = errorCode(error)
      throw new MeetingIntakeError(
        code === 'ROUTE_UNAVAILABLE' ? 'DESTINATION_UNAVAILABLE' : 'EXECUTION_FAILED',
        code === 'ROUTE_UNAVAILABLE'
          ? 'meeting write-opportunity presentation is unavailable'
          : 'meeting write-opportunity presentation retry failed',
      )
    }
  }

  async markSourceDeleted(ownerId: string, intakeId: string, expectedRevision: number): Promise<MeetingIntake> {
    const current = await this.requireOwner(ownerId, intakeId, expectedRevision)
    return this.fail(current, 'source_deleted')
  }

  async manualImport(
    ownerId: string,
    intakeId: string,
    expectedRevision: number,
    sourceHandle: string,
  ): Promise<MeetingIntake> {
    const current = await this.requireOwner(ownerId, intakeId, expectedRevision)
    if (
      current.repair?.action !== 'manual_import' ||
      current.judgmentState !== 'confirmed' ||
      current.executionState !== 'failed' ||
      !sourceHandle.startsWith('feishu://meeting-artifacts/') ||
      !this.options.sources.supports(sourceHandle)
    ) {
      throw new MeetingIntakeError('INVALID_TRANSITION', 'manual meeting source reference is unavailable or invalid')
    }
    const reboundNext: MeetingIntake = {
      ...current,
      source: { handle: sourceHandle },
      sourceState: 'ready',
      executionState: 'queued',
      revision: current.revision + 1,
      updatedAt: this.now(),
    }
    delete (reboundNext as { repair?: unknown }).repair
    delete (reboundNext as { artifact?: unknown }).artifact
    const rebound = await this.write(current, reboundNext)
    return this.executeFromSource(ownerId, intakeId, rebound.revision)
  }

  private async executeFromSource(ownerId: string, intakeId: string, expectedRevision: number): Promise<MeetingIntake> {
    const current = await this.requireOwner(ownerId, intakeId, expectedRevision)
    const running = await this.start(current)
    let resolved: ResolvedMeetingArtifact
    try {
      const principalId = `meeting-intake:${running.intakeId}`
      const lease = await this.options.sources.issue({
        intakeId: running.intakeId,
        principalId,
        purpose: 'transcript',
      })
      resolved = await this.options.sources.resolve(
        { intakeId: running.intakeId, principalId, purpose: 'transcript', grant: lease.grant },
        new AbortController().signal,
      )
    } catch (error) {
      return this.fail(running, sourceFailure(error))
    }
    const artifact = createMeetingArtifactDescriptor({
      intakeId: running.intakeId,
      sourceHandle: resolved.provenance.sourceHandle,
      contentType: resolved.contentType,
      text: resolved.text,
    })
    const bound = await this.write(running, {
      ...running,
      artifact,
      revision: running.revision + 1,
      updatedAt: this.now(),
    })
    return this.finish(bound, async () => this.options.dispatcher.deliver({ intake: bound, artifact }))
  }

  private async start(current: MeetingIntake): Promise<MeetingIntake> {
    if (
      current.judgmentState !== 'confirmed' ||
      (current.executionState !== 'queued' && current.executionState !== 'failed') ||
      !current.choices.destinationHandle
    ) {
      throw new MeetingIntakeError('INVALID_TRANSITION', 'meeting choices must be confirmed before execution')
    }
    return this.write(current, {
      ...current,
      executionState: 'running',
      revision: current.revision + 1,
      updatedAt: this.now(),
    })
  }

  private async finish(current: MeetingIntake, deliver: () => Promise<void>): Promise<MeetingIntake> {
    try {
      await deliver()
    } catch (error) {
      return this.fail(current, dispatchFailure(error))
    }
    const succeededNext: MeetingIntake = {
      ...current,
      sourceState: 'ready',
      executionState: 'succeeded',
      healthState: 'healthy',
      revision: current.revision + 1,
      updatedAt: this.now(),
    }
    delete (succeededNext as { repair?: unknown }).repair
    return this.write(current, succeededNext)
  }

  private async fail(current: MeetingIntake, code: ActionFailure): Promise<MeetingIntake> {
    const repair = REPAIR_BY_CODE[code]
    return this.write(current, {
      ...current,
      ...(repair.sourceState ? { sourceState: repair.sourceState } : {}),
      executionState: 'failed',
      healthState: 'degraded',
      repair: { code, action: repair.action, observedAt: this.now() },
      revision: current.revision + 1,
      updatedAt: this.now(),
    })
  }

  private async requireOwner(ownerId: string, intakeId: string, expectedRevision: number): Promise<MeetingIntake> {
    const current = await this.options.store.get(intakeId)
    if (!current || current.ownerId !== ownerId) {
      throw new MeetingIntakeError('INTAKE_NOT_FOUND', 'meeting intake not found')
    }
    if (current.revision !== expectedRevision) {
      throw new MeetingIntakeError(
        'REVISION_CONFLICT',
        `expected revision ${expectedRevision}, current ${current.revision}`,
      )
    }
    return current
  }

  private async write(current: MeetingIntake, next: MeetingIntake): Promise<MeetingIntake> {
    const result = await this.options.store.compareAndSet(current.intakeId, current.revision, next)
    if (result.outcome === 'missing') throw new MeetingIntakeError('INTAKE_NOT_FOUND', 'meeting intake not found')
    if (result.outcome === 'revision_conflict') {
      throw new MeetingIntakeError('REVISION_CONFLICT', 'meeting intake changed concurrently')
    }
    return result.intake
  }
}