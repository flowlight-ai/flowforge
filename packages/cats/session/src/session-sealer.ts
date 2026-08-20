/**
 * SessionSealerService — F24 Phase B+C 会话封存生命周期 Cordis 服务。
 *
 * 移植自 clowder-ai
 * `packages/api/src/domains/cats/services/session/SessionSealer.ts`
 * （全量移植；R13 一切皆插件改造，`Context` 扩展挂载点：`ctx.catsSessionSealer`）。
 *
 * Manages session lifecycle transitions: active → sealing → sealed.
 *
 * Two methods:
 * - requestSeal(): fast path — CAS status change + clear active pointer
 * - finalize(): slow path — transcript JSONL flush + digest + mark sealed
 *
 * Invoke pipeline is responsible for detecting thresholds and calling requestSeal().
 * SessionSealer is responsible for the lifecycle state machine.
 *
 * Cordis 改造要点（对齐批次 6.4 任务约定）：
 * - clowder 的模块单例 `getEventAuditLog()` 全部替换为 `this.ctx.catsAudit`
 *   （`@flowforge/cats-orchestration` 的 EventAuditLogService，`static inject`
 *   声明依赖；audit append 仍为 `.catch(() => {})` best-effort）
 * - `createModuleLogger` → `this.ctx.logger`
 * - 构造参数 store/transcriptWriter/threadStore/transcriptReader/summaryStore
 *   全部改为走 `ctx`：store=`ctx.catStores.sessionChains()`，
 *   summaryStore=`ctx.catStores.summaries()`（不存在时不启用，与 clowder
 *   可选注入语义一致）；threadStore 的 thread-memory 能力（`getThreadMemory`
 *   / `updateThreadMemory`）按结构探测——flowforge cats-stores 的
 *   IThreadStore 尚未提供该契约，具备能力的 backend 自动启用
 * - transcriptWriter/Reader 在 constructor 里 `ctx.get()` 可选获取（同包
 *   默认 Plugin 挂载顺序 Writer → Reader → Sealer 保证可用；单独挂载
 *   Sealer 时对应 Phase 不启用）
 * - getMaxPromptTokens/handoffConfig 保留 options 注入
 *
 * @module @flowforge/cats-session/sealer
 */

import type { CatId, SealResult, SessionStatus } from '@flowforge/cats-shared'
import { AuditEventTypes } from '@flowforge/cats-shared'
import type { EventAuditLogService } from '@flowforge/cats-orchestration'
import type { ISessionChainStore, ISummaryStore, IThreadStore } from '@flowforge/cats-stores'
import { Context, Service } from '@flowforge/cordis'
import { extractRecentArtifacts } from './artifact-tracking.ts'
import { extractDecisionSignals } from './decision-signals.ts'
import { generateHandoffDigest } from './handoff-digest.ts'
import type { ThreadMemoryV1 } from './thread-memory.ts'
import { buildThreadMemory } from './thread-memory.ts'
import type { TranscriptReaderService } from './transcript-reader.ts'
import { formatEventsChat, formatEventsHandoff } from './transcript-formatter.ts'
import type { ExtractiveDigestV1 } from './transcript-writer.ts'
import { TranscriptWriterService } from './transcript-writer.ts'

const FINALIZE_TIMEOUT_MS = 30_000;

export type SealReason = 'threshold' | 'manual' | 'error' | (string & {});

/**
 * F065 Phase C: Handoff digest configuration.
 * Injectable functions for testability and per-thread resolution.
 */
export interface HandoffConfig {
  getBootstrapDepth: (catId: string) => 'extractive' | 'generative';
  resolveProfile: (threadId: string, catId: string) => Promise<{ apiKey: string; baseUrl: string } | null>;
  fetchFn?: typeof fetch;
}

export interface ISessionSealer {
  /**
   * Request seal of a session. Idempotent: returns accepted=false if already sealing/sealed.
   * Fast path: only changes status + clears active pointer.
   */
  requestSeal(args: { sessionId: string; reason: SealReason }): Promise<SealResult>;

  /**
   * Finalize a sealing session: write transcript, generate digest, mark sealed.
   * Phase B stub: just transitions sealing → sealed.
   * Phase C will add transcript + digest logic.
   */
  finalize(args: { sessionId: string }): Promise<void>;

  /**
   * F118 Hardening: Reconcile sessions stuck in 'sealing' state for a specific cat/thread.
   * Force-seals any session that has been in 'sealing' longer than maxAgeMs.
   * Returns count of reconciled sessions.
   */
  reconcileStuck(catId: string, threadId: string, maxAgeMs?: number): Promise<number>;

  /**
   * F118 Hardening: Global reaper — reconcile ALL sessions stuck in 'sealing' across
   * all cats/threads. Runs at startup and periodically to catch orphaned sealing sessions
   * that would never be visited by per-invoke lazy scanning.
   * Returns total count of reconciled sessions.
   */
  reconcileAllStuck(maxAgeMs?: number): Promise<number>;
}

/**
 * Post-seal hook signature.
 * Called after finalize() completes successfully (status = sealed).
 * Hooks MUST be best-effort (catch their own errors) — a failing hook
 * must not block the seal terminal transition.
 */
export type PostSealHook = (event: {
  sessionId: string;
  catId: string;
  threadId: string;
  ownerUserId: string;
  sealReason: string;
}) => Promise<void>;

/** Cordis-side options（clowder 构造参数中仅保留可注入函数项）。 */
export interface SessionSealerOptions {
  /** KD-5 dynamic cap 输入：per-cat max prompt tokens（缺省 180000）。 */
  getMaxPromptTokens?: (catId: CatId) => number;
  /** F065 Phase C handoff digest 配置（缺省不启用 generative 分支）。 */
  handoffConfig?: HandoffConfig;
}

/**
 * clowder IThreadStore 的 thread-memory 能力子集。flowforge cats-stores 的
 * IThreadStore（批次 2 精简契约）尚未提供 `getThreadMemory` /
 * `updateThreadMemory`；SessionSealer 按结构探测，具备该能力的 backend
 * （如测试注入的扩展实现、未来的 stores 升级）自动启用 F065 Phase B。
 */
interface ThreadMemoryCapableStore extends IThreadStore {
  getThreadMemory(threadId: string): ThreadMemoryV1 | null | Promise<ThreadMemoryV1 | null>;
  updateThreadMemory(threadId: string, memory: ThreadMemoryV1): void | Promise<void>;
}

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) 会话封存器 — mounted by `@flowforge/cats-session`.
     * active → sealing → sealed 生命周期状态机 + 转录落盘 + thread memory
     * 滚动摘要 + handoff 生成摘要。
     */
    catsSessionSealer: SessionSealerService
  }

  interface Events {}
}

/**
 * Cordis service exposing the session sealer at `ctx.catsSessionSealer`.
 *
 * Uses ISessionChainStore (via `ctx.catStores.sessionChains()`) for all state
 * mutations. Optionally uses TranscriptWriter/Reader for Phase C transcript
 * flush; optionally updates ThreadMemory on seal (F065 Phase B); optionally
 * generates a handoff digest via Haiku (F065 Phase C).
 */
export class SessionSealerService extends Service implements ISessionSealer {
  static inject: readonly string[] = ['catStores', 'catsAudit']

  private readonly postSealHooks: PostSealHook[] = [];
  private readonly getMaxPromptTokens?: (catId: CatId) => number;
  private readonly handoffConfig?: HandoffConfig;
  private readonly transcriptWriter?: TranscriptWriterService;
  private readonly transcriptReader?: TranscriptReaderService;

  constructor(ctx: Context, options: SessionSealerOptions = {}) {
    super(ctx, 'catsSessionSealer')
    if (options.getMaxPromptTokens !== undefined) this.getMaxPromptTokens = options.getMaxPromptTokens
    if (options.handoffConfig !== undefined) this.handoffConfig = options.handoffConfig
    // 同包兄弟服务：默认 Plugin 挂载顺序（Writer → Reader → Sealer）保证此
    // 刻已注册；宿主单独挂载 Sealer 时优雅降级（对应 Phase 不启用，与
    // clowder 可选注入语义一致）。
    const writer = ctx.get('catsTranscriptWriter') as TranscriptWriterService | undefined
    if (writer !== undefined) this.transcriptWriter = writer
    const reader = ctx.get('catsTranscriptReader') as TranscriptReaderService | undefined
    if (reader !== undefined) this.transcriptReader = reader
  }

  /** Session chain store（运行时经聚合解析；backend 由宿主挂载）。 */
  private get store(): ISessionChainStore {
    return this.ctx.catStores.sessionChains()
  }

  /** Audit log（inject 声明保证挂载；批次 5 EventAuditLogService）。 */
  private get audit(): EventAuditLogService {
    return this.ctx.catsAudit
  }

  /** 可选 summary store：active backend 未注册时返回 undefined（fail-open）。 */
  private resolveSummaryStore(): ISummaryStore | undefined {
    try {
      return this.ctx.catStores.summaries()
    } catch {
      return undefined
    }
  }

  /** 可选 thread-memory store：按结构探测，不具备能力时返回 undefined。 */
  private resolveThreadMemoryStore(): ThreadMemoryCapableStore | undefined {
    try {
      const store = this.ctx.catStores.threads() as ThreadMemoryCapableStore
      if (typeof store.getThreadMemory === 'function' && typeof store.updateThreadMemory === 'function') {
        return store
      }
      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * F231 AC-C3 / KD-10: Register a hook to fire after session seal finalize.
   * Hooks are called in registration order, best-effort (errors are caught and logged).
   */
  registerPostSealHook(hook: PostSealHook): void {
    this.postSealHooks.push(hook)
  }

  async requestSeal(args: { sessionId: string; reason: SealReason }): Promise<SealResult> {
    const record = await this.store.get(args.sessionId)
    if (!record) {
      return { accepted: false, status: 'sealed' }
    }

    // CAS: only active sessions can be sealed
    // Snapshot status before mutation (memory store returns live reference)
    const currentStatus: SessionStatus = record.status
    if (currentStatus !== 'active') {
      return { accepted: false, status: currentStatus }
    }

    // Transition active → sealing
    const now = Date.now()
    const updated = await this.store.update(args.sessionId, {
      status: 'sealing',
      sealReason: args.reason,
      updatedAt: now,
    })

    if (!updated || updated.status !== 'sealing') {
      // Race condition: another caller got there first
      return { accepted: false, status: updated?.status ?? 'sealed' }
    }

    this.ctx.logger.info(
      `cats-session-sealer: session seal requested ${args.sessionId} ` +
        `(cat=${record.catId} thread=${record.threadId} reason=${args.reason})`,
    )
    this.audit
      .append({
        type: AuditEventTypes.SEAL_REQUESTED,
        threadId: record.threadId,
        data: {
          sessionId: args.sessionId,
          catId: record.catId,
          cliSessionId: record.cliSessionId,
          reason: args.reason,
          seq: record.seq,
        },
      })
      .catch(() => {})

    return {
      accepted: true,
      status: 'sealing',
      sessionId: args.sessionId,
    }
  }

  async finalize(args: { sessionId: string }): Promise<void> {
    const record = await this.store.get(args.sessionId)
    if (!record) return

    // Only finalize sessions in sealing state
    if (record.status !== 'sealing') return

    const now = Date.now()

    let finalizeClean = false
    try {
      finalizeClean = await withTimeout(this.doFinalize(record, now), FINALIZE_TIMEOUT_MS)
    } catch (err) {
      // finalizeClean stays false — timeout or unexpected throw.
      this.audit
        .append({
          type: AuditEventTypes.SEAL_FINALIZE_FAILED,
          threadId: record.threadId,
          data: {
            sessionId: args.sessionId,
            catId: record.catId,
            error: err instanceof Error ? err.message : String(err),
          },
        })
        .catch(() => {})
    }

    // Always attempt terminal transition — even if doFinalize failed/timed out.
    // A sealed session with missing transcript is recoverable; a stuck sealing session is not.
    let sealWriteSucceeded = false
    try {
      await this.store.update(args.sessionId, {
        status: 'sealed',
        sealedAt: now,
        updatedAt: now,
      })
      sealWriteSucceeded = true
      this.ctx.logger.info(
        `cats-session-sealer: session seal finalized ${args.sessionId} ` +
          `(cat=${record.catId} thread=${record.threadId} reason=${record.sealReason} partial=${!finalizeClean})`,
      )
      if (finalizeClean) {
        this.audit
          .append({
            type: AuditEventTypes.SEAL_FINALIZED,
            threadId: record.threadId,
            data: {
              sessionId: args.sessionId,
              catId: record.catId,
              cliSessionId: record.cliSessionId,
              reason: record.sealReason,
              seq: record.seq,
              sealedAt: now,
            },
          })
          .catch(() => {})
      }
    } catch (err) {
      this.audit
        .append({
          type: AuditEventTypes.SEAL_FINALIZE_FAILED,
          threadId: record.threadId,
          data: {
            sessionId: args.sessionId,
            phase: 'terminal_update',
            error: err instanceof Error ? err.message : String(err),
          },
        })
        .catch(() => {})
    }

    // F231 AC-C3 / KD-10: Fire post-seal hooks (distillation trigger, etc.)
    // Only fire when the terminal write succeeded — if it failed the session is
    // still 'sealing' and a retry/reaper will seal it later. Reaper paths
    // (reconcileStuck/reconcileAllStuck) intentionally skip hooks to avoid
    // compounding failures in recovery code. Firing here on failure would also
    // risk double-invocation if the reaper later succeeds.
    if (sealWriteSucceeded && this.postSealHooks.length > 0) {
      const hookEvent = {
        sessionId: args.sessionId,
        catId: record.catId,
        threadId: record.threadId,
        ownerUserId: record.userId,
        sealReason: record.sealReason ?? 'unknown',
      };
      for (const hook of this.postSealHooks) {
        try {
          await hook(hookEvent)
        } catch (err) {
          this.ctx.logger.warn(
            `cats-session-sealer: post-seal hook failed (best-effort, non-blocking) ` +
              `sessionId=${args.sessionId} error=${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }
  }

  /**
   * Reconcile sessions stuck in 'sealing' state.
   * Scans all sessions for the given cat/thread and force-seals any that have been
   * in 'sealing' longer than maxAgeMs. Returns count of reconciled sessions.
   */
  async reconcileStuck(catId: string, threadId: string, maxAgeMs = 5 * 60_000): Promise<number> {
    const sessions = await this.store.getChain(catId as CatId, threadId)
    const now = Date.now()
    let count = 0
    for (const s of sessions) {
      if (s.status === 'sealing' && now - (s.updatedAt ?? s.createdAt) > maxAgeMs) {
        await this.store.update(s.id, {
          status: 'sealed',
          sealReason: 'reconcile_stuck',
          sealedAt: now,
          updatedAt: now,
        })
        this.ctx.logger.info(
          `cats-session-sealer: session force-sealed by stuck reaper ${s.id} ` +
            `(cat=${s.catId} thread=${s.threadId} stuckDurationMs=${now - (s.updatedAt ?? s.createdAt)})`,
        )
        this.audit
          .append({
            type: AuditEventTypes.SEAL_FINALIZE_FAILED,
            threadId: s.threadId,
            data: {
              sessionId: s.id,
              catId: s.catId,
              phase: 'reconcile_stuck',
              stuckDurationMs: now - (s.updatedAt ?? s.createdAt),
            },
          })
          .catch(() => {})
        count++
      }
    }
    return count
  }

  async reconcileAllStuck(maxAgeMs = 5 * 60_000): Promise<number> {
    const sealingIds = await this.store.listSealingSessions()
    if (sealingIds.length === 0) return 0

    const now = Date.now()
    let count = 0
    for (const id of sealingIds) {
      const s = await this.store.get(id)
      if (!s || s.status !== 'sealing') continue
      if (now - (s.updatedAt ?? s.createdAt) > maxAgeMs) {
        await this.store.update(s.id, {
          status: 'sealed',
          sealReason: 'global_reaper',
          sealedAt: now,
          updatedAt: now,
        })
        this.ctx.logger.info(
          `cats-session-sealer: session force-sealed by global reaper ${s.id} ` +
            `(cat=${s.catId} thread=${s.threadId} stuckDurationMs=${now - (s.updatedAt ?? s.createdAt)})`,
        )
        this.audit
          .append({
            type: AuditEventTypes.SEAL_FINALIZE_FAILED,
            threadId: s.threadId,
            data: {
              sessionId: s.id,
              catId: s.catId,
              phase: 'global_reaper',
              stuckDurationMs: now - (s.updatedAt ?? s.createdAt),
            },
          })
          .catch(() => {})
        count++
      }
    }
    return count
  }

  /**
   * Returns true if all best-effort steps succeeded, false if any threw.
   * Callers use this to decide whether to emit SEAL_FINALIZED (clean) or log partial.
   */
  private async doFinalize(
    record: {
      id: string;
      threadId: string;
      catId: string;
      cliSessionId: string;
      seq: number;
      createdAt: number;
      sealReason?: string;
    },
    now: number,
  ): Promise<boolean> {
    let clean = true

    // Phase C: Flush transcript + index + extractive digest
    if (this.transcriptWriter) {
      try {
        await this.transcriptWriter.flush(
          {
            sessionId: record.id,
            threadId: record.threadId,
            catId: record.catId,
            cliSessionId: record.cliSessionId,
            seq: record.seq,
          },
          {
            createdAt: record.createdAt,
            sealedAt: now,
            ...(record.sealReason ? { sealReason: record.sealReason } : {}),
          },
        )
      } catch {
        clean = false
        // best-effort: transcript flush failure doesn't prevent sealing
      }
    }

    // F065 Phase B: Update thread memory after successful digest write
    const threadStore = this.resolveThreadMemoryStore()
    if (threadStore && this.transcriptReader) {
      try {
        const digest = await this.transcriptReader.readDigest(record.id, record.threadId, record.catId)
        if (digest) {
          const existingMemory = await threadStore.getThreadMemory(record.threadId)
          // KD-5 dynamic cap: min(3000, floor(maxPromptTokens * 0.03)), floor 1200
          const maxPrompt = this.getMaxPromptTokens?.(record.catId as CatId) ?? 180000
          const maxTokens = Math.max(1200, Math.min(3000, Math.floor(maxPrompt * 0.03)))

          // VG-3: Extract decision signals from transcript + summary (best-effort)
          const signals = await this.extractSignals(record)

          const fileArtifacts = extractRecentArtifacts({
            filesTouched: (digest as unknown as ExtractiveDigestV1).filesTouched ?? [],
            prTasks: [],
            catId: record.catId,
          })

          const updated = buildThreadMemory(
            existingMemory,
            digest as unknown as ExtractiveDigestV1,
            maxTokens,
            signals,
            fileArtifacts.length > 0 ? fileArtifacts : undefined,
          )
          await threadStore.updateThreadMemory(record.threadId, updated)
        }
      } catch {
        clean = false
        // best-effort: thread memory update failure doesn't prevent sealing
      }
    }

    // F065 Phase C: Generate handoff digest (best-effort, after ThreadMemory)
    if (this.handoffConfig && this.transcriptReader) {
      try {
        const depth = this.handoffConfig.getBootstrapDepth(record.catId)
        if (depth === 'generative') {
          const profile = await this.handoffConfig.resolveProfile(record.threadId, record.catId)
          if (profile?.apiKey) {
            const allEvents = await this.transcriptReader.readAllEvents(record.id, record.threadId, record.catId)
            if (allEvents.length > 0) {
              const handoffSummaries = formatEventsHandoff(allEvents)
              const chatMessages = formatEventsChat(allEvents)
              const extractive = await this.transcriptReader.readDigest(record.id, record.threadId, record.catId)

              const result = await generateHandoffDigest({
                handoffSummaries,
                extractiveDigest: extractive ?? {},
                recentMessages: chatMessages.slice(-8),
                apiKey: profile.apiKey,
                baseUrl: profile.baseUrl,
                ...(this.handoffConfig.fetchFn ? { fetchFn: this.handoffConfig.fetchFn } : {}),
              })

              if (result) {
                const sessionDir = this.transcriptReader.getSessionDir(record.threadId, record.catId, record.id)
                await TranscriptWriterService.writeHandoffDigest(
                  sessionDir,
                  {
                    v: result.v,
                    model: result.model,
                    generatedAt: result.generatedAt,
                  },
                  result.body,
                )
              }
            }
          }
        }
      } catch {
        clean = false
        // best-effort: handoff digest failure doesn't prevent sealing
      }
    }

    return clean
  }

  /**
   * VG-3: Best-effort extraction of decision signals from transcript events + ThreadSummary.
   * Returns undefined if extraction fails or no data available.
   */
  private async extractSignals(record: {
    id: string;
    threadId: string;
    catId: string;
  }): Promise<ReturnType<typeof extractDecisionSignals> | undefined> {
    try {
      const reader = this.transcriptReader
      if (!reader) return undefined

      // Build transcript text from events
      const events = await reader.readAllEvents(record.id, record.threadId, record.catId)
      const chatMessages = formatEventsChat(events)
      const transcriptText = chatMessages.map((m) => m.content).join('\n')
      const transcriptEntries = events.flatMap((event) => {
        const [message] = formatEventsChat([event])
        if (!message) return []
        return [
          {
            content: message.content,
            sourceRef: {
              threadId: record.threadId,
              sessionId: record.id,
              eventNo: event.eventNo,
              ...(event.invocationId ? { invocationId: event.invocationId } : {}),
            },
          },
        ];
      })

      // Get latest ThreadSummary conclusions (if summaryStore available)
      let summaryConclusions: string[] = []
      let summaryOpenQuestions: string[] = []
      const summaryStore = this.resolveSummaryStore()
      if (summaryStore) {
        const summaries = await summaryStore.listByThread(record.threadId)
        const latest = summaries.at(-1)
        if (latest) {
          summaryConclusions = [...latest.conclusions]
          summaryOpenQuestions = [...latest.openQuestions]
        }
      }

      if (!transcriptText && summaryConclusions.length === 0 && summaryOpenQuestions.length === 0) return undefined

      return extractDecisionSignals({ transcriptText, transcriptEntries, summaryConclusions, summaryOpenQuestions })
    } catch {
      // Fail-open: decision extraction failure doesn't affect sealing
      return undefined
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`finalize timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
