/**
 * `@flowforge/ui-cordis` — pure-logic, injectable-seam port of the dsh
 * `@deepseek-ai/dsh-client-ui-cordis` client half (A8/D50).
 *
 * Ported scope: the replay-stable lifecycle card models (`cordisDefineCard` /
 * `cordisRunCard` / `cordisActionCard`), the visible-status derivation
 * (`cordisVisibleStatus` / `packageOf`), the frame-wide plugin inventory
 * observable (`createCordisInventory`, single-flight reads with reconnect
 * reset), the per-session run-card supersession index
 * (`CordisRunCardRegistry` / `cordisToolViewKey`), the seam seams
 * (`HostObservable`, `ToolCallViewModelBlock`, `CordisDynamicPort`), and the
 * localizable copy (`zh` / `en` / `CordisKey`).
 *
 * The React/DOM rendering glue (rows, panel, slot registration, and the
 * `inputTriggers` `@pluginId` slash source) lives on the host surface, not
 * here. Zero `@deepseek-ai/*` / `@cat-cafe/*` / `@clowder-ai/*` references and
 * no cordis Service/Context feathers.
 *
 * @module @flowforge/ui-cordis
 */

export { CordisRunCardRegistry, cordisToolViewKey } from './run-card-index.ts'
export type {
  CordisRunCardPointer,
  CordisRunCardStore,
  CordisToolViewKey,
} from './run-card-index.ts'
export { createCordisInventory } from './inventory.ts'
export type { CordisInventory, CordisInventorySnapshot } from './inventory.ts'
export type { HostObservable } from './observable.ts'
export type {
  ToolCallContentItem,
  ToolCallViewModelBlock,
  ToolCallViewModelBlockRunning,
  ToolCallViewModelBlockSettled,
} from './block.ts'
export type { CordisDynamicPort, CordisActionResult, CordisInventoryRow } from './dynamic-port.ts'
export { cordisActionCard, cordisDefineCard, cordisRunCard } from './card-model.ts'
export type { CordisActionCard, CordisDefineCard, CordisRunCard, CordisToolState } from './card-model.ts'
export { cordisVisibleStatus, packageOf } from './status.ts'
export type { CordisVisibleStatus } from './status.ts'
export { dictionaries, en, NS, zh } from './locales.ts'
export type { CordisKey } from './locales.ts'

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
} from './events.ts'

/** Default export mirrors the inventory factory for drop-in usage. */
export { createCordisInventory as default } from './inventory.ts'