/**
 * @flowforge/chat-threads — chat thread domain Cordis plugin (stage-5 batch 1).
 *
 * Mounts four services over `ctx.catStores` (stage-4 ports + Memory/Sqlite
 * backends):
 * - `ThreadService`        → `ctx.chatThreads`   — CRUD / soft delete / restore / purge
 * - `ReadStateService`     → `ctx.chatReadState` — F069/#1200/#1269 monotonic read cursors
 * - `ThreadBranchService`  → `ctx.chatBranch`    — edit-as-branch with rollback
 * - `ThreadExportService`  → `ctx.chatExport`    — markdown export projection
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-stores'   # aggregate + default Memory backend
 * - name: '@flowforge/chat-threads'
 * ```
 *
 * @module @flowforge/chat-threads
 */

import type { Context } from '@flowforge/cordis'
import { ThreadBranchService } from './branch-service.ts'
import { ThreadExportService } from './export-service.ts'
import { ReadStateService } from './read-state-service.ts'
import { ThreadService } from './thread-service.ts'

export { ThreadBranchService } from './branch-service.ts'
export type { BranchFromMessageInput, BranchResult, BranchServiceOptions } from './branch-service.ts'
export { gateForDurableSlot, isV2CursorActive } from './cursor-gate.ts'
export { ThreadExportService } from './export-service.ts'
export type { ThreadExportDocument } from './export-service.ts'
export { ReadStateService } from './read-state-service.ts'
export type { MarkAllReadResult, ReadAckResult } from './read-state-service.ts'
export {
  parseOptionalBoolean,
  projectThreadForListView,
  sanitizeThreadForResponse,
} from './sanitize.ts'
export { ChatThreadsError, ThreadService } from './thread-service.ts'
export type {
  CreateChatThreadInput,
  DeleteChatThreadOptions,
  ListChatThreadsOptions,
  ThreadServiceOptions,
  UpdateChatThreadInput,
} from './thread-service.ts'
export { BRANCH_TITLE_SUFFIX, ThreadErrorCode } from './invariant.ts'

export default function Plugin(ctx: Context) {
  ctx.plugin(ThreadService)
  ctx.plugin(ReadStateService)
  ctx.plugin(ThreadBranchService)
  ctx.plugin(ThreadExportService)
}
