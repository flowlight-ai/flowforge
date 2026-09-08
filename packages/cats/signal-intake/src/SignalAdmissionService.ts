/**
 * 信号准入服务：binding 校验 → 声明/结构校验 → 建 MeetingIntake 入账（幂等）。
 * 忠实移植 clowder-ai `domains/signal-intake/SignalAdmissionService.ts`。
 * Host 侧清单经注入式 `SignalAdmissionInventory` 端口（本地接口 + 内存实现），
 * 宿主在 EP4 适配到 flowforge `cats-plugin-inventory`。
 *
 * @flowforge/cats-signal-intake
 */

import { digestCanonical } from './canonical-json.ts'
import { SignalAdmissionError } from './errors.ts'
import type { SignalIngressTraceSink } from './IngressTrace.ts'
import type { MeetingIntakeStore } from './MeetingIntakeStore.ts'
import type { SignalRouteStore } from './SignalRouteStore.ts'
import type { SignalRuntimeLeaseRecord, SignalRuntimeLeaseStore } from './SignalRuntimeLeaseStore.ts'
import type {
  MeetingIntake,
  SignalRuntimeBinding,
} from './contract/signals.ts'
import {
  type EventsPublishInput,
  type EventsPublishResult,
  type SignalDeclaration,
  validateDeclaredEventsPublishInput,
  validateEventsPublishInput,
} from './contract/events-publish.ts'

// ── 注入式 inventory 端口 ──────────────────────────────────────────────

export interface SignalInventoryInstance {
  readonly pluginInstanceId: string
  readonly lifecycleState: 'installed' | 'uninstalled'
  readonly packageDigest: string
  readonly configReadiness: 'ready' | 'not_ready'
  readonly activationState: 'enabled' | 'disabled'
  readonly runtimeState: 'healthy' | 'unhealthy'
}

export interface SignalInventoryGrant {
  readonly pluginInstanceId: string
  readonly grantRevision: number
  readonly effectiveGrants: readonly string[]
}

export interface SignalInventoryPackage {
  readonly pluginId: string
  readonly packageDigest: string
  readonly contractVersion: string
  readonly manifest: {
    readonly signals?: { readonly provides?: readonly SignalDeclaration[] }
  }
  readonly signalSchemas: Readonly<Record<string, unknown>>
}

export interface SignalAdmissionInventory {
  snapshot(): Promise<{
    readonly instances: readonly SignalInventoryInstance[]
    readonly grants: readonly SignalInventoryGrant[]
    readonly packages: readonly SignalInventoryPackage[]
  }>
}

export class SignalAdmissionMemoryInventory implements SignalAdmissionInventory {
  constructor(
    private readonly value: {
      readonly instances?: readonly SignalInventoryInstance[]
      readonly grants?: readonly SignalInventoryGrant[]
      readonly packages?: readonly SignalInventoryPackage[]
    } = {},
  ) {}

  async snapshot() {
    return {
      instances: [...(this.value.instances ?? [])],
      grants: [...(this.value.grants ?? [])],
      packages: [...(this.value.packages ?? [])],
    }
  }
}

// ── 服务 ───────────────────────────────────────────────────────────────

export interface SignalAdmissionServiceOptions {
  readonly inventory: SignalAdmissionInventory
  readonly runtimeLeases: SignalRuntimeLeaseStore
  readonly routes: SignalRouteStore
  readonly intakes: MeetingIntakeStore
  readonly now?: () => number
  readonly createPublicationId?: () => string
  readonly createIntakeId?: () => string
  readonly traces?: SignalIngressTraceSink
}

function matchesBinding(lease: SignalRuntimeLeaseRecord, binding: SignalRuntimeBinding): boolean {
  return (
    lease.leaseId === binding.runtimeLeaseId &&
    lease.sessionId === binding.sessionId &&
    lease.pluginInstanceId === binding.pluginInstanceId &&
    lease.packageDigest === binding.packageDigest &&
    lease.grantRevision === binding.grantRevision
  )
}

function declarationFor(type: string, declarations: readonly SignalDeclaration[]): SignalDeclaration {
  const declaration = declarations.find((candidate) => candidate.type === type)
  if (!declaration) throw new SignalAdmissionError('INVALID_SIGNAL', 'signal is not declared by the admitted package')
  return declaration
}

export function signalSettlementKey(pluginInstanceId: string, input: EventsPublishInput): string {
  return digestCanonical({
    pluginInstanceId,
    signalType: input.signalType,
    idempotencyKey: input.idempotencyKey,
  })
}

export class SignalAdmissionService {
  private readonly now: () => number
  private readonly createPublicationId: () => string
  private readonly createIntakeId: () => string

  constructor(private readonly options: SignalAdmissionServiceOptions) {
    this.now = options.now ?? Date.now
    this.createPublicationId = options.createPublicationId ?? (() => crypto.randomUUID())
    this.createIntakeId = options.createIntakeId ?? (() => crypto.randomUUID())
  }

  async publish(binding: SignalRuntimeBinding, value: unknown): Promise<EventsPublishResult> {
    const structural = validateEventsPublishInput(value)
    if (!structural.valid) {
      await this.trace(binding, 'rejected', undefined, 'INVALID_SIGNAL')
      throw new SignalAdmissionError('INVALID_SIGNAL', 'signal input is structurally invalid')
    }
    try {
      const { input, declaration, packageRecord, route } = await this.authorize(binding, structural.value)
      const validated = validateDeclaredEventsPublishInput(
        packageRecord.manifest.signals?.provides ?? [],
        packageRecord.signalSchemas,
        input,
      )
      if (!validated.valid) throw new SignalAdmissionError('INVALID_SIGNAL', 'signal payload violates installed schema')

      const now = this.now()
      const canonicalDigest = digestCanonical(validated.value)
      const publicationId = this.createPublicationId()
      const intake: MeetingIntake = {
        intakeId: this.createIntakeId(),
        ownerId: route.ownerId,
        routeId: route.routeId,
        routeGeneration: route.generation,
        origin: {
          pluginId: packageRecord.pluginId,
          pluginInstanceId: binding.pluginInstanceId,
          packageDigest: packageRecord.packageDigest,
          contractVersion: packageRecord.contractVersion,
          signalType: validated.value.signalType,
          declaration: {
            epistemicStatus: declaration.epistemicStatus,
            privacyClass: declaration.privacyClass,
            sourceClass: declaration.sourceClass,
          },
        },
        source: structuredClone(validated.value.source),
        occurredAt: validated.value.occurredAt,
        metadata: structuredClone(validated.value.payload),
        ingress: {
          publicationId,
          eventId: validated.value.eventId,
          idempotencyKey: validated.value.idempotencyKey,
          canonicalDigest,
          firstDeliveredAt: now,
        },
        sourceState: 'ready',
        judgmentState: route.initialUnresolved.length === 0 ? 'auto_resolved' : 'unresolved',
        executionState: route.initialUnresolved.length === 0 ? 'queued' : 'idle',
        healthState: 'healthy',
        unresolved: [...route.initialUnresolved],
        choices: {},
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      const result = await this.options.intakes.accept({
        settlementKey: signalSettlementKey(binding.pluginInstanceId, validated.value),
        sourceIdentityKey: digestCanonical({
          pluginInstanceId: binding.pluginInstanceId,
          signalType: validated.value.signalType,
          sourceHandle: validated.value.source.handle,
        }),
        intake,
      })
      if (result.outcome === 'idempotency_conflict') {
        throw new SignalAdmissionError('IDEMPOTENCY_CONFLICT', 'idempotency key is bound to different content')
      }
      if (result.outcome === 'source_identity_conflict') {
        throw new SignalAdmissionError('SOURCE_IDENTITY_CONFLICT', 'source artifact already has an intake')
      }
      const receipt: EventsPublishResult = {
        publicationId: result.intake.ingress.publicationId,
        disposition: result.outcome === 'accepted' ? 'accepted' : 'duplicate',
      }
      await this.trace(binding, receipt.disposition, validated.value.signalType)
      return receipt
    } catch (error) {
      await this.trace(
        binding,
        'rejected',
        structural.value.signalType,
        error instanceof SignalAdmissionError ? error.code : 'INTERNAL_ERROR',
      )
      throw error
    }
  }

  private async trace(
    binding: SignalRuntimeBinding,
    outcome: 'accepted' | 'duplicate' | 'rejected',
    signalType?: string,
    rejectionCode?: string,
  ): Promise<void> {
    try {
      await this.options.traces?.record({
        at: this.now(),
        pluginInstanceId: binding.pluginInstanceId,
        ...(signalType === undefined ? {} : { signalType }),
        outcome,
        ...(rejectionCode === undefined ? {} : { rejectionCode }),
      })
    } catch {
      // Diagnostics cannot roll back or deny durable admission truth.
    }
  }

  private async authorize(binding: SignalRuntimeBinding, input: EventsPublishInput) {
    const snapshot = await this.options.inventory.snapshot()
    const instance = snapshot.instances.find((candidate) => candidate.pluginInstanceId === binding.pluginInstanceId)
    if (!instance || instance.lifecycleState !== 'installed' || instance.packageDigest !== binding.packageDigest) {
      throw new SignalAdmissionError('AUTHORITY_MISMATCH', 'plugin instance/package binding is not current')
    }
    if (
      instance.configReadiness !== 'ready' ||
      instance.activationState !== 'enabled' ||
      instance.runtimeState !== 'healthy'
    ) {
      throw new SignalAdmissionError('PLUGIN_NOT_READY', 'plugin instance is not ready for signal admission')
    }
    const grants = snapshot.grants.find((candidate) => candidate.pluginInstanceId === binding.pluginInstanceId)
    if (!grants) {
      throw new SignalAdmissionError('GRANT_MISSING', 'events.publish is not an effective grant')
    }
    if (grants.grantRevision !== binding.grantRevision) {
      throw new SignalAdmissionError('STALE_GRANT', 'signal binding uses a stale grant revision')
    }
    if (!grants.effectiveGrants.includes('events.publish')) {
      throw new SignalAdmissionError('GRANT_MISSING', 'events.publish is not an effective grant')
    }
    const packageRecord = snapshot.packages.find((candidate) => candidate.packageDigest === binding.packageDigest)
    if (!packageRecord) throw new SignalAdmissionError('AUTHORITY_MISMATCH', 'admitted package is missing')
    const lease = await this.options.runtimeLeases.get(binding.runtimeLeaseId)
    if (!lease || !matchesBinding(lease, binding) || lease.state !== 'live') {
      throw new SignalAdmissionError('RUNTIME_LEASE_MISSING', 'runtime lease is absent, revoked, or mismatched')
    }
    if (lease.expiresAt <= this.now()) {
      throw new SignalAdmissionError('RUNTIME_LEASE_EXPIRED', 'runtime lease expired under the Host clock')
    }
    const route = await this.options.routes.get(packageRecord.pluginId, input.signalType)
    if (!route || route.state !== 'active') {
      throw new SignalAdmissionError('ROUTE_UNAVAILABLE', 'no active Host route admits this signal')
    }
    if (route.generation !== binding.routeGeneration) {
      throw new SignalAdmissionError('STALE_ROUTE', 'signal binding uses a stale Host route generation')
    }
    const declaration = declarationFor(input.signalType, packageRecord.manifest.signals?.provides ?? [])
    return { input, declaration, packageRecord, route }
  }
}