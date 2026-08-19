/**
 * AutoSummarizerService — 自动讨论纪要 + 任务提取 Cordis 服务。
 *
 * 移植自 clowder-ai `orchestration/AutoSummarizer.ts`（R13 一切皆插件改造）：
 * - clowder-ai 通过构造注入 messageStore/summaryStore；flowforge 经
 *   `ctx.catStores` 聚合解析（inject=['catStores']，Cordis 调度保证依赖就绪）
 * - pattern 匹配关键句式生成纪要（结论/问题），避免额外 LLM spawn 成本
 * - inFlight Set 防同线程并发纪要；异常吞掉返回 null（fire-and-forget 语义）
 * - `Context` 扩展挂载点：`ctx.catsSummarizer`（对齐 24-stage4 计划 T4.5.3）
 *
 * @module @flowforge/cats-orchestration/summarizer
 */

import { Context, Service } from '@flowforge/cordis'
import type { ThreadSummary } from '@flowforge/cats-shared'
import type { StoredMessage } from '@flowforge/cats-stores'
import {
  AUTO_SUMMARY_COOLDOWN_MS,
  AUTO_SUMMARY_MESSAGE_THRESHOLD,
  AUTO_SUMMARY_READ_LIMIT,
  AUTO_SUMMARY_TAIL_MESSAGES,
} from './invariant.ts'
import {
  type ExtractionOptions,
  type ExtractionResult,
  type TaskInvoker,
  extractTasks,
} from './task-extractor.ts'

export interface AutoSummarizerOptions {
  /** 任务提取的 LLM 通道；未配置时 pattern-only 降级（degraded=true）。 */
  taskInvoker?: TaskInvoker
  /** ownerCatId 合法性校验来源（默认空数组 → LLM 提取不信任任何 owner）。 */
  validCatIds?: () => readonly string[]
}

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) 自动纪要 + 任务提取 — mounted by `@flowforge/cats-orchestration`.
     */
    catsSummarizer: AutoSummarizerService
  }
}

/**
 * Cordis service exposing auto-summarization at `ctx.catsSummarizer`.
 */
export class AutoSummarizerService extends Service {
  static inject = ['catStores']

  private readonly inFlight = new Set<string>()
  private readonly taskInvoker: TaskInvoker | null
  private readonly validCatIds: () => readonly string[]

  constructor(ctx: Context, options: AutoSummarizerOptions = {}) {
    super(ctx, 'catsSummarizer')
    this.taskInvoker = options.taskInvoker ?? null
    this.validCatIds = options.validCatIds ?? (() => [])
  }

  /**
   * Check if a thread needs a summary and generate one if so.
   * Returns the created summary, or null if no summary was needed / on error.
   */
  async maybeSummarize(threadId: string): Promise<ThreadSummary | null> {
    if (this.inFlight.has(threadId)) return null
    this.inFlight.add(threadId)
    try {
      const messages = await this.ctx.catStores.messages().getByThread(threadId, AUTO_SUMMARY_READ_LIMIT)
      if (messages.length < AUTO_SUMMARY_MESSAGE_THRESHOLD) return null

      const summaries = await this.ctx.catStores.summaries().listByThread(threadId)
      let recentMessages = messages
      if (summaries.length > 0) {
        const latest = summaries[summaries.length - 1]!
        if (Date.now() - latest.createdAt < AUTO_SUMMARY_COOLDOWN_MS) return null
        // Only re-summarize if significant new messages since last summary (P2-C fix)
        recentMessages = messages.filter((m) => m.timestamp > latest.createdAt)
        if (recentMessages.length < AUTO_SUMMARY_MESSAGE_THRESHOLD) return null
      }

      const input = this.extractSummary(recentMessages, threadId)
      if (input) return await this.ctx.catStores.summaries().create(input)
      return null
    } catch (err) {
      this.ctx.logger.warn('cats-summarizer: auto-summary failed: %o', err)
      return null
    } finally {
      this.inFlight.delete(threadId)
    }
  }

  /**
   * Extract actionable tasks from stored messages (TaskExtractor port).
   * LLM channel + valid cat ids are injected at construction.
   */
  extractTasks(messages: StoredMessage[], options: ExtractionOptions): Promise<ExtractionResult> {
    return extractTasks(messages, this.taskInvoker, this.validCatIds(), options)
  }

  /** Pattern-based summary extraction (conclusions / open questions). */
  private extractSummary(
    messages: StoredMessage[],
    threadId: string,
  ): {
    threadId: string
    topic: string
    conclusions: string[]
    openQuestions: string[]
    createdBy: 'system'
  } | null {
    const catMessages = messages.filter((m) => m.catId && m.content.length > 20)
    if (catMessages.length === 0) return null

    // Extract topic from first substantial message
    const firstMsg = catMessages[0]!.content
    const topic = firstMsg.length > 60 ? `${firstMsg.slice(0, 60)}...` : firstMsg

    const conclusionPatterns = [/决定|确定|选择|采用|使用|实现了|完成了|修复了/]
    const questionPatterns = [/需要|待|TODO|还没|未来|后续|是否/]

    const conclusions: string[] = []
    const openQuestions: string[] = []

    for (const msg of catMessages.slice(-AUTO_SUMMARY_TAIL_MESSAGES)) {
      const sentences = msg.content.split(/[。！？\n]/).filter((s) => s.trim().length > 5)
      for (const s of sentences) {
        const trimmed = s.trim().slice(0, 100)
        if (conclusionPatterns.some((p) => p.test(trimmed)) && conclusions.length < 5) {
          conclusions.push(trimmed)
        } else if (questionPatterns.some((p) => p.test(trimmed)) && openQuestions.length < 3) {
          openQuestions.push(trimmed)
        }
      }
    }

    if (conclusions.length === 0 && openQuestions.length === 0) return null

    return {
      threadId,
      topic: `自动纪要: ${topic}`,
      conclusions: conclusions.length > 0 ? conclusions : ['(暂未提取到明确结论)'],
      openQuestions,
      createdBy: 'system',
    }
  }
}

export type { ExtractedTask, ExtractionOptions, ExtractionResult, TaskInvoker } from './task-extractor.ts'
