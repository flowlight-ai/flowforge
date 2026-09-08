/**
 * 信号准入域测试夹具：构造合法的 MeetingIntake / 路由 / 租约 / 清单快照。
 *
 * @flowforge/cats-signal-intake — tests/fixtures
 */

import type { MeetingIntake, SignalRouteRecord, SignalRuntimeBinding } from '../src/contract/signals.ts'
import type { SignalRuntimeLeaseRecord } from '../src/SignalRuntimeLeaseStore.ts'
import { createHash } from 'node:crypto'

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function makeArtifact(overrides: Partial<MeetingIntake['artifact']> = {}): NonNullable<MeetingIntake['artifact']> {
  const sourceRevision = `sha256:${'a'.repeat(64)}`
  return {
    contentType: 'text/plain',
    resourceRef: `meeting-artifact://intakes/intake-1?revision=${sourceRevision}`,
    sourceHandle: 'minute://obcn123456',
    sourceRevision,
    byteLength: 120,
    trust: 'untrusted_external',
    instructionPolicy: 'data_only',
    ...overrides,
  } as NonNullable<MeetingIntake['artifact']>
}

export function makeRoute(overrides: Partial<SignalRouteRecord> = {}): SignalRouteRecord {
  return {
    routeId: 'route-1',
    ownerId: 'owner-1',
    pluginId: 'plugin-feishu',
    signalType: 'feishu.meeting.occurred',
    generation: 1,
    state: 'active',
    workflowKind: 'meeting-intake',
    initialUnresolved: ['speakers', 'destination'],
    updatedAt: 1_000,
    ...overrides,
  } as SignalRouteRecord
}

export function makeLease(overrides: Partial<SignalRuntimeLeaseRecord> = {}): SignalRuntimeLeaseRecord {
  return {
    leaseId: 'lease-1',
    sessionId: 'session-1',
    pluginInstanceId: 'instance-1',
    packageDigest: 'pkg-digest-1',
    grantRevision: 1,
    state: 'live',
    expiresAt: 9_999_999,
    ...overrides,
  } as SignalRuntimeLeaseRecord
}

export function makeBinding(overrides: Partial<SignalRuntimeBinding> = {}): SignalRuntimeBinding {
  return {
    pluginInstanceId: 'instance-1',
    packageDigest: 'pkg-digest-1',
    sessionId: 'session-1',
    runtimeLeaseId: 'lease-1',
    grantRevision: 1,
    routeGeneration: 1,
    ...overrides,
  } as SignalRuntimeBinding
}

export function makeIntake(overrides: Partial<MeetingIntake> = {}): MeetingIntake {
  const sourceHandle = 'minute://obcn123456'
  return {
    intakeId: 'intake-1',
    ownerId: 'owner-1',
    routeId: 'route-1',
    routeGeneration: 1,
    origin: {
      pluginId: 'plugin-feishu',
      pluginInstanceId: 'instance-1',
      packageDigest: 'pkg-digest-1',
      contractVersion: '1.0',
      signalType: 'feishu.meeting.occurred',
      declaration: {
        epistemicStatus: 'observation',
        privacyClass: 'content-adjacent',
        sourceClass: 'remote-service',
      },
    },
    source: { handle: sourceHandle },
    occurredAt: '2026-09-08T00:00:00Z',
    metadata: { transcriptId: 'obcn123456' },
    ingress: {
      publicationId: 'pub-1',
      eventId: 'evt-1',
      idempotencyKey: 'idem-1',
      canonicalDigest: digest({ sourceHandle }),
      firstDeliveredAt: 1_000,
    },
    sourceState: 'ready',
    judgmentState: 'unresolved',
    executionState: 'idle',
    healthState: 'healthy',
    unresolved: ['speakers', 'destination'],
    choices: {},
    revision: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  } as MeetingIntake
}

export function makeInventorySnapshot() {
  return {
    instances: [
      {
        pluginInstanceId: 'instance-1',
        lifecycleState: 'installed' as const,
        packageDigest: 'pkg-digest-1',
        configReadiness: 'ready' as const,
        activationState: 'enabled' as const,
        runtimeState: 'healthy' as const,
      },
    ],
    grants: [
      {
        pluginInstanceId: 'instance-1',
        grantRevision: 1,
        effectiveGrants: ['events.publish'],
      },
    ],
    packages: [
      {
        pluginId: 'plugin-feishu',
        packageDigest: 'pkg-digest-1',
        contractVersion: '1.0',
        manifest: {
          signals: {
            provides: [
              {
                type: 'feishu.meeting.occurred',
                schemaRef: '#/signals/feishu.meeting.occurred',
                epistemicStatus: 'observation' as const,
                privacyClass: 'content-adjacent' as const,
                sourceClass: 'remote-service' as const,
              },
            ],
          },
        },
        signalSchemas: {
          '#/signals/feishu.meeting.occurred': {
            type: 'object',
            required: ['payload', 'source'],
            properties: {
              payload: { type: 'object', required: ['transcriptId'] },
              source: { type: 'object', required: ['handle'] },
            },
            additionalProperties: false,
          },
        },
      },
    ],
  }
}