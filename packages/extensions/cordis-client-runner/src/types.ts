/**
 * `@flowforge/cordis-client-runner` wire-safe vocabulary — the dynamic Cordis
 * types this seam package names, consumed by both the runner and the ui-cordis
 * surface. Ported from the dsh `@deepseek-ai/dsh-api-remotes/client` vocabulary;
 * no Remote namespace and no cordis Service/Context import here, so this module
 * is safe to consume from any browser layer.
 *
 * Identity fields are plain branded strings (the source typed them via brand
 * casts). They are not enumerated here further because their only meaning is
 * "a stable coordinate in the host registry / page live set".
 *
 * @module @flowforge/cordis-client-runner/types
 */

/** One still-open model approval or activation attempt coordinate. */
export type ApprovalRequestId = string
/** The Agent (session) a run is carried out for. */
export type SessionId = string
/** Stable Plugin instance identity. */
export type CordisDynamicPluginId = string
/** Immutable Package source version identity. */
export type CordisDynamicPackageId = string
/** Exact activation of a Plugin instance. */
export type CordisDynamicPluginRunId = string
/** Whether a run is a fresh activation or an update of an existing one. */
export type CordisDynamicRunMode = 'run' | 'update'

/** One immutable Package as the host registry reports it. */
export interface DynamicCordisPackage {
  readonly pluginId: CordisDynamicPluginId
  readonly packageId: CordisDynamicPackageId
  readonly pluginRunId: CordisDynamicPluginRunId
  readonly name: string
}

/** Browser-half source handed to the page for one exact active run. */
export interface DynamicCordisClientSource {
  readonly pluginId: CordisDynamicPluginId
  readonly packageId: CordisDynamicPackageId
  readonly pluginRunId: CordisDynamicPluginRunId
  readonly name: string
  readonly code: string
}

/** Result of starting/attaching a Host half activation. */
export type DynamicCordisHostHalfResult = (
  | { ok: false; message: string }
  | { ok: true; pluginId: CordisDynamicPluginId; packageId: CordisDynamicPackageId; pluginRunId: CordisDynamicPluginRunId; waitingFor: string[]; startedHere: boolean }
) & {
  /** Optional original failure stack when the seam preserved one. */
  stack?: string
}

/** Acknowledge from settling a model-driven approval. */
export interface DynamicCordisResolveAck {
  readonly accepted: boolean
}

/** How a run request or direct activation settles. */
export type DynamicCordisRunResolution =
  | {
    ok: true
    pluginRunId: CordisDynamicPluginRunId
    waitingFor?: string[]
  }
  | {
    ok: false
    reason: 'host-half-failed' | 'client-half-failed'
    pluginRunId?: CordisDynamicPluginRunId
    startedHere?: boolean
    message: string
    stack?: string
  }
  | {
    ok: false
    reason: 'rejected'
  }

/** Full run resolution returned to a direct panel activation. */
export interface DynamicCordisRunResponse {
  readonly ok: boolean
  readonly status?: 'running'
  readonly pluginId?: CordisDynamicPluginId
  readonly packageId?: CordisDynamicPackageId
  readonly pluginRunId?: CordisDynamicPluginRunId
  readonly waitingFor?: readonly string[]
  readonly mode?: CordisDynamicRunMode
  /** Failure text present when `ok` is false. */
  readonly message?: string
}

/** One Package inside a Plugin inventory row. */
export interface DynamicCordisPackageMeta {
  readonly packageId: CordisDynamicPackageId
  readonly name: string
  readonly purpose: string
  readonly hasClientHalf?: boolean
}

/** The active run recorded on an inventory row, when there is one. */
export interface DynamicCordisActiveRun {
  readonly pluginRunId: CordisDynamicPluginRunId
  readonly packageId: CordisDynamicPackageId
}

/** The latest model run attempt recorded on an inventory row. */
export interface DynamicCordisLatestRun {
  readonly approvalRequestId?: ApprovalRequestId
  readonly status: 'awaiting-approval' | 'starting-host' | 'client-pending' | string
  readonly packageId: CordisDynamicPackageId
  readonly mode: CordisDynamicRunMode
  readonly requiresApproval?: boolean
}

/** One stable Plugin row as the page reads it from the host registry. */
export interface DynamicCordisInventoryRow {
  readonly agentId: SessionId
  readonly pluginId: CordisDynamicPluginId
  readonly packages: readonly DynamicCordisPackageMeta[]
  readonly currentPackageId?: CordisDynamicPackageId
  readonly nextPackageId?: CordisDynamicPackageId
  readonly activeRun?: DynamicCordisActiveRun
  readonly latestRun?: DynamicCordisLatestRun
}

/** Reasons a Client activation attempt can fail, shared across the seam. */
export type DynamicCordisHalfFailureReason = 'host-half-failed' | 'client-half-failed'

/** A retract announcement: stop one exact activation. */
export interface DynamicCordisRetracted {
  readonly pluginId: CordisDynamicPluginId
  readonly pluginRunId: CordisDynamicPluginRunId
}

/** One Client inspect query correlation. */
export type CordisInspectRequestId = string