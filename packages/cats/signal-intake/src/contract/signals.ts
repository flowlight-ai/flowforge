/**
 * 信号准入域契约类型（本地）：会议入站 / 会议产物 / 信号路由 / 运行时绑定。
 *
 * 忠实移植 clowder-ai `shared/src/types/{meeting-intake,signal-ingress}.ts`，
 * 域类型不在 @flowforge/cats-shared，故在包内定义。`CatId` 复用
 * @flowforge/cats-shared（唯一运行时 workspace 依赖）。
 *
 * @flowforge/cats-signal-intake — contract/signals
 */

import type { CatId } from '@flowforge/cats-shared'

export type { CatId }

export type MeetingIntakeJudgmentField = 'speakers' | 'context' | 'destination' | 'outputs'

export type MeetingIntakeSourceState = 'ready' | 'not_ready' | 'auth_required' | 'deleted'
export type MeetingIntakeJudgmentState = 'unresolved' | 'confirmed' | 'auto_resolved' | 'dismissed'
export type MeetingIntakeExecutionState = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'
export type MeetingIntakeHealthState = 'healthy' | 'degraded'
export type MeetingIntakeRepairAction = 'retry' | 'regrant' | 'manual_import'
export type MeetingIntakeOutput = 'minutes' | 'decisions' | 'roadmap' | 'tasks'

export interface MeetingIntakeRepair {
  readonly code: 'transcript_not_ready' | 'auth_required' | 'source_deleted' | 'route_unavailable' | 'execution_failed'
  readonly action: MeetingIntakeRepairAction
  readonly observedAt: number
  readonly safeDetail?: string
}

export interface MeetingIntakeChoices {
  readonly speakerMap?: Readonly<Record<string, string>>
  readonly context?: string
  readonly destinationHandle?: string
  readonly outputs?: readonly MeetingIntakeOutput[]
}

export interface MeetingIntakeSignalOrigin {
  readonly pluginId: string
  readonly pluginInstanceId: string
  readonly packageDigest: string
  readonly contractVersion: string
  readonly signalType: string
  readonly declaration: {
    readonly epistemicStatus: 'observation' | 'inference'
    readonly privacyClass: 'behavioral' | 'content-adjacent' | 'content'
    readonly sourceClass: 'os-metadata' | 'accessibility-api' | 'remote-service'
  }
}

export interface MeetingIntakeIngress {
  readonly publicationId: string
  readonly eventId: string
  readonly idempotencyKey: string
  readonly canonicalDigest: string
  readonly firstDeliveredAt: number
}

/** 会话产物描述：Host 对来源字节的有界投影，永不是转写权威。 */
export interface MeetingArtifactDescriptor {
  readonly contentType: 'text/plain'
  readonly resourceRef: string
  readonly sourceHandle: string
  readonly sourceRevision: `sha256:${string}`
  readonly byteLength: number
  readonly trust: 'untrusted_external'
  readonly instructionPolicy: 'data_only'
}

/** 可持续、仅来源引用（source-ref-only）的工作流真值。转写字节永不属于此处。 */
export interface MeetingIntake {
  readonly intakeId: string
  readonly ownerId: string
  readonly routeId: string
  readonly routeGeneration: number
  readonly origin: MeetingIntakeSignalOrigin
  readonly source: { readonly handle: string }
  readonly occurredAt: string
  readonly metadata: Readonly<Record<string, unknown>>
  readonly ingress: MeetingIntakeIngress
  readonly sourceState: MeetingIntakeSourceState
  readonly judgmentState: MeetingIntakeJudgmentState
  readonly executionState: MeetingIntakeExecutionState
  readonly healthState: MeetingIntakeHealthState
  readonly unresolved: readonly MeetingIntakeJudgmentField[]
  readonly choices: MeetingIntakeChoices
  readonly artifact?: MeetingArtifactDescriptor
  readonly repair?: MeetingIntakeRepair
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export function meetingIntakeNeedsAttention(intake: MeetingIntake): boolean {
  return intake.judgmentState === 'unresolved' || intake.healthState === 'degraded'
}

/** Host 拥有的权威：信号在传输解码后附加到插件信号。 */
export interface SignalRuntimeBinding {
  readonly pluginInstanceId: string
  readonly packageDigest: string
  readonly sessionId: string
  readonly runtimeLeaseId: string
  readonly grantRevision: number
  readonly routeGeneration: number
}

export type SignalRouteState = 'active' | 'suspended' | 'revoked'

/** 路由是 Host 配置，绝不接受插件输入。 */
export interface SignalRouteRecord {
  readonly routeId: string
  readonly ownerId: string
  readonly pluginId: string
  readonly signalType: string
  readonly generation: number
  readonly state: SignalRouteState
  readonly workflowKind: 'meeting-intake'
  readonly initialUnresolved: readonly MeetingIntakeJudgmentField[]
  readonly updatedAt: number
}

export type { CatId as SignalIntakeCatId }