/**
 * @flowforge/cats-orchestration — Forgekin (cats) 编排域 Cordis 插件
 * （批次 5：clowder-ai 六编排域全量移植，R13 一切皆插件）。
 *
 * Architecture（对齐 dsh 范式）：
 * - `EventAuditLogService extends Service` → `ctx.catsAudit`
 *   （append-only NDJSON 按日分片审计日志）
 * - `AutoSummarizerService extends Service` → `ctx.catsSummarizer`
 *   （自动讨论纪要 + TaskExtractor 任务提取，LLM 失败 pattern 降级）
 * - `FreshnessService extends Service` → `ctx.catsFreshness`
 *   （F254 副作用新鲜度闸门：forward/held）
 * - `UsageAggregatorService extends Service` → `ctx.catsToolUsage`
 *   （F150/F188 工具用量遥测 + 聚合，进程内计数替代 Redis）
 * - `DossierDistillationService extends Service` → `ctx.catsDistiller`
 *   （F208 经验 → dossier 蒸馏管线，KD-17 幂等 + baseHash stale-write lock）
 * - `DutyBriefingService extends Service` → `ctx.catsDutyBriefing`
 *   （F233 值班简报 collect → aggregate → render → deliver）
 * - 纯函数模块：`./task-extractor.ts`、`./dossier-applier.ts`、
 *   `./duty-briefing.ts` 内聚合器/渲染器（零 Cordis 依赖，可独立单测）
 * - 持久化经 `ctx.catStores`（summaries / deliveryCursors /
 *   dossierObservations / dossierDistillationProposals / messages 等）
 *
 * Consumers load the default plugin:
 * ```ts
 * import CatsOrchestration from '@flowforge/cats-orchestration'
 * ctx.plugin(CatsOrchestration)
 * // ctx.catsAudit / ctx.catsSummarizer / ctx.catsFreshness /
 * // ctx.catsToolUsage / ctx.catsDistiller / ctx.catsDutyBriefing ready
 * ```
 *
 * @module @flowforge/cats-orchestration
 */

import type { Context } from '@flowforge/cordis'
import { EventAuditLogService } from './audit-log.ts'
import { AutoSummarizerService } from './auto-summarizer.ts'
import { DutyBriefingService } from './duty-briefing.ts'
import { DossierDistillationService } from './distillation.ts'
import { FreshnessService } from './freshness.ts'
import { UsageAggregatorService } from './tool-usage.ts'

// Re-export audit log service + types.
export { EventAuditLogService } from './audit-log.ts'
export type { EventAuditLogOptions } from './audit-log.ts'

// Re-export auto summarizer + task extractor.
export { AutoSummarizerService } from './auto-summarizer.ts'
export type { AutoSummarizerOptions } from './auto-summarizer.ts'
export {
  extractByPatterns,
  extractTasks,
  toCreateTaskInputs,
} from './task-extractor.ts'
export type {
  ExtractedTask,
  ExtractionOptions,
  ExtractionResult,
  TaskInvoker,
} from './task-extractor.ts'

// Re-export freshness gate.
export { FreshnessService } from './freshness.ts'

// Re-export tool usage telemetry + classify helpers.
export { UsageAggregatorService, classifyTool, isMcpToolName } from './tool-usage.ts'

// Re-export distillation pipeline + pure applier.
export { DossierDistillationService } from './distillation.ts'
export type { ApplyProposalOutcome } from './distillation.ts'
export {
  computeFileHash,
  DOSSIER_RELATIVE_PATH,
  prepareDraft,
} from './dossier-applier.ts'
export type {
  ApplyDraftError,
  ApplyDraftOutcome,
  ApplyDraftResult,
} from './dossier-applier.ts'

// Re-export duty briefing (service + pure aggregator/renderer).
export { DutyBriefingService } from './duty-briefing.ts'
export {
  aggregateDutyBriefing,
  renderBriefingCard,
} from './duty-briefing.ts'
export type {
  AggregatorMentionCandidate,
  AggregatorTask,
  AggregatorZombie,
  DutyBriefingInput,
  DutyBriefingOptions,
  GenerateOutcome,
  GenerateResult,
} from './duty-briefing.ts'

// Re-export shared invariants (thresholds centralised, F233 Phase A).
export * from './invariant.ts'

// Re-export shared types consumed by the six services (one-stop imports).
export type {
  AuditEvent,
  AuditEventInput,
  BallEntry,
  DutyBriefing,
  FreshnessCheckInput,
  FreshnessDecision,
  RichCardBlock,
  SkillLoadedEvent,
  ThreadSummary,
  ToolCategory,
  ToolClassification,
  ToolEvent,
  ToolUsageEntry,
  ToolUsageReport,
} from '@flowforge/cats-shared'
export type { StoredMessage } from '@flowforge/cats-stores'

/**
 * Default Cordis plugin: mounts all six orchestration services.
 *
 * Each service declares its own `static inject` (`catStores` where needed)
 * so Cordis schedules them after the `ctx.catStores` aggregate is live.
 * Options-bearing services (audit / summarizer / duty-briefing) accept
 * per-service constructor options; hosts needing custom options should
 * register those services individually via `ctx.plugin(Class, options)`.
 */
export default function Plugin(ctx: Context) {
  ctx.plugin(EventAuditLogService)
  ctx.plugin(AutoSummarizerService)
  ctx.plugin(FreshnessService)
  ctx.plugin(UsageAggregatorService)
  ctx.plugin(DossierDistillationService)
  ctx.plugin(DutyBriefingService)
}
