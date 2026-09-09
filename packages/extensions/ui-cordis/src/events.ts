/**
 * Client-safe dynamic Cordis vocabulary for the ui-cordis surface.
 *
 * Every identity/card/panel type is re-exported from the sister seam package
 * `@flowforge/cordis-client-runner` (which already owns the wire-safe vocabulary
 * once provided by `@deepseek-ai/dsh-api-remotes/client` and the runner's live
 * set / activity types once provided by `@deepseek-ai/dsh-cordis-client-runner`).
 * No Remote namespace, no cordis Service/Context import here.
 *
 * @module @flowforge/ui-cordis/events
 */

export type {
  ApprovalRequestId,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  DynamicCordisInventoryRow,
  DynamicCordisLivePackage,
  DynamicCordisPackage,
  DynamicCordisRetracted,
  SessionId,
} from '@flowforge/cordis-client-runner'

export type { CordisRunActivity, CordisUserRunRequest } from '@flowforge/cordis-client-runner'