/**
 * @flowforge/cats-session — Forgekin (cats) 会话转录域 Cordis 插件
 * （批次 6.3：clowder-ai session 转录 Writer/Reader 全量移植，R13 一切皆插件；
 *  批次 6.4：SessionSealer 移植为 `ctx.catsSessionSealer`）。
 *
 * Architecture（对齐 dsh 范式）：
 * - `TranscriptWriterService extends Service` → `ctx.catsTranscriptWriter`
 *   （F24 Phase C：内存缓冲调用事件，seal 时落盘 events.jsonl +
 *   events.live.jsonl 崩溃恢复副本 + index.json 稀疏索引 +
 *   digest.extractive.json 规则式抽取摘要）
 * - `TranscriptReaderService extends Service` → `ctx.catsTranscriptReader`
 *   （F24 Phase D：分页读取已 seal 转录、摘要读取、全文检索、
 *   invocation 事件过滤、handoff 摘要解析）
 * - `SessionSealerService extends Service` → `ctx.catsSessionSealer`
 *   （F24 Phase B+C + F118 reaper + F065 thread memory/handoff：
 *   active → sealing → sealed 状态机、requestSeal CAS 快路径、
 *   finalize 慢路径（转录 flush + thread memory 更新 + handoff 生成
 *   摘要，三段 best-effort、终态必转 sealed）、reconcileStuck /
 *   reconcileAllStuck 卡死回收、postSealHooks）
 * - 纯函数模块：`./capsule.ts`（协作连续性胶囊，零依赖）、
 *   `./text-sanitize.ts`（泄漏 tool_uses payload 剥离，零依赖）、
 *   `./thread-memory.ts`（F065 Phase B 滚动线程记忆合并）、
 *   `./decision-signals.ts`（F148 VG-3 决策信号正则抽取）、
 *   `./transcript-formatter.ts`（F98 chat/handoff 视图格式化）、
 *   `./handoff-digest.ts`（F065 Phase C Haiku 生成式交接摘要）、
 *   `./artifact-tracking.ts`（F148 Phase G 近期产物提取）
 * - 持久化直接走文件系统（`<dataDir>/threads/<threadId>/<catId>/
 *   sessions/<sessionId>/`），不依赖 cats-stores；会话链状态走
 *   `ctx.catStores.sessionChains()`，审计走 `ctx.catsAudit`
 *
 * Consumers load the default plugin:
 * ```ts
 * import CatsSession from '@flowforge/cats-session'
 * ctx.plugin(CatsSession)
 * // ctx.catsTranscriptWriter / ctx.catsTranscriptReader / ctx.catsSessionSealer ready
 * ```
 *
 * @module @flowforge/cats-session
 */

import type { Context } from '@flowforge/cordis'
import { SessionSealerService } from './session-sealer.ts'
import { TranscriptReaderService } from './transcript-reader.ts'
import { TranscriptWriterService } from './transcript-writer.ts'

// Re-export transcript writer service + types.
export { TranscriptWriterService } from './transcript-writer.ts'
export type {
  BufferedEvent,
  DigestNoiseKind,
  DigestNoiseSummary,
  ExtractiveDigestV1,
  HandoffDigestMeta,
  TranscriptSessionInfo,
  TranscriptWriterOptions,
} from './transcript-writer.ts'

// Re-export transcript reader service + types.
export { TranscriptReaderService } from './transcript-reader.ts'
export type {
  HandoffDigestResult,
  ReadEventsResult,
  SearchHit,
  TranscriptEvent,
  TranscriptIndex,
  TranscriptReaderOptions,
} from './transcript-reader.ts'

// Re-export session sealer service + types (batch 6.4).
export { SessionSealerService } from './session-sealer.ts'
export type {
  HandoffConfig,
  ISessionSealer,
  PostSealHook,
  SealReason,
  SessionSealerOptions,
} from './session-sealer.ts'

// Re-export thread memory merger + rolling-memory types (F065 Phase B).
export { buildThreadMemory, estimateTokens, formatPromptTimeRange } from './thread-memory.ts'
export type { ThreadMemorySourceRef, ThreadMemoryV1 } from './thread-memory.ts'

// Re-export decision signal extraction (F148 VG-3).
export { extractDecisionSignals } from './decision-signals.ts'
export type { DecisionSignals, DecisionSignalsInput } from './decision-signals.ts'

// Re-export transcript formatters (F98 chat/handoff views).
export { formatEventsChat, formatEventsHandoff } from './transcript-formatter.ts'
export type { ChatMessage, HandoffInvocationSummary } from './transcript-formatter.ts'

// Re-export handoff digest generator (F065 Phase C, LLM fetch).
export { buildPromptContent, generateHandoffDigest, SYSTEM_PROMPT } from './handoff-digest.ts'
export type { GenerateHandoffDigestOptions, HandoffDigestOutput } from './handoff-digest.ts'

// Re-export artifact extraction (F148 Phase G).
export { extractRecentArtifacts, sortAndCapArtifacts } from './artifact-tracking.ts'
export type { ArtifactExtractionInput, RecentArtifact } from './artifact-tracking.ts'

// Re-export collaboration continuity capsule (pure functions, zero deps).
export {
  buildCapsuleFromRouteState,
  completeCapsuleForCompact,
  completeCapsuleForSeal,
  extractContinuityCapsuleFromAgentMessage,
  extractContinuityCapsuleFromSystemInfo,
  formatContinuationPrompt,
  isCollaborationContinuityCapsuleV1,
  isRouteStateContinuityCapsule,
} from './capsule.ts'
export type {
  CollaborationContinuityCapsuleV1,
  ContinuityBallState,
  ContinuityMode,
  ContinuityReason,
  RouteStateCapsuleInput,
  RouteStateContinuityCapsule,
} from './capsule.ts'

// Re-export leaked tool-call payload sanitizer (pure functions, zero deps).
export { createLeakedToolCallStreamStripper, stripLeakedToolCallPayload } from './text-sanitize.ts'
export type { LeakedToolCallStreamStripper } from './text-sanitize.ts'

// Re-export shared invariants (thresholds centralised).
export * from './invariant.ts'

/**
 * Default Cordis plugin: mounts the session transcript writer + reader +
 * sealer. The sealer `static inject = ['catStores', 'catsAudit']`, so hosts
 * must also mount `@flowforge/cats-stores`（含一个 backend，如 memory）与
 * `@flowforge/cats-orchestration`（EventAuditLogService）。
 *
 * Both transcript services default `dataDir` to `data/transcripts` (overridable
 * via the `CATS_TRANSCRIPT_DIR` environment variable). Hosts needing a custom
 * directory or index stride should register the services individually via
 * `ctx.plugin(TranscriptWriterService, { dataDir, indexStride })` and
 * `ctx.plugin(TranscriptReaderService, { dataDir })` (both must share the
 * same `dataDir`), then `ctx.plugin(SessionSealerService, sealerOptions)`.
 *
 * 挂载顺序保证 Writer/Reader 先于 Sealer 注册（Sealer 的 constructor
 * `ctx.get()` 兄弟服务），await 逐个挂载以固化该顺序。
 */
export default async function Plugin(ctx: Context) {
  await ctx.plugin(TranscriptWriterService)
  await ctx.plugin(TranscriptReaderService)
  await ctx.plugin(SessionSealerService)
}
