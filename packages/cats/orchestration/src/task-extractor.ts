/**
 * TaskExtractor — 从会话历史提取可执行任务的纯函数模块。
 *
 * 移植自 clowder-ai `orchestration/TaskExtractor.ts`：
 * - clowder-ai 直接依赖 AgentService（LLM spawn）；flowforge 将 LLM 调用抽象为
 *   注入的 `TaskInvoker`（同步收集文本分片），由宿主插件决定具体 LLM 通道
 * - LLM 失败 / 返回非 JSON → pattern 匹配降级（degraded=true，不静默）
 * - catId 合法性校验改为注入的 `validCatIds()`（clowder-ai 用 catRegistry 单例）
 *
 * @module @flowforge/cats-orchestration/task-extractor
 */

import type { CatId } from '@flowforge/cats-shared'
import type { CreateTaskInput, StoredMessage } from '@flowforge/cats-stores'
import { TASK_EXTRACTOR_MAX_MESSAGES } from './invariant.ts'

/** 注入的 LLM 调用通道：消费 prompt，产出文本分片流（对齐 AgentService.invoke 形状）。 */
export type TaskInvoker = (prompt: string) => AsyncIterable<{ type: string; content?: string; error?: string }>

export interface ExtractedTask {
  title: string
  why: string
  ownerCatId?: CatId | null
  sourceMessageId?: string
}

export interface ExtractionOptions {
  threadId: string
  userId: string
  signal?: AbortSignal
  /** Max messages to analyze (default: 50). */
  maxMessages?: number
}

export interface ExtractionResult {
  tasks: ExtractedTask[]
  /** True if LLM failed and we fell back to pattern matching. */
  degraded: boolean
  /** Reason for degradation. */
  reason?: string
}

/** Format messages for LLM context. */
function formatMessagesForExtraction(messages: StoredMessage[]): string {
  return messages
    .map((m, i) => {
      const speaker = m.catId ? `[${m.catId}]` : '[User]'
      return `(msg-${i}) ${speaker}: ${m.content}`
    })
    .join('\n\n')
}

/** Normalize sourceIndex: number / "3" / "msg-3" / undefined. */
function normalizeSourceIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string') {
    const msgMatch = value.match(/^msg-(\d+)$/i)
    if (msgMatch) return parseInt(msgMatch[1]!, 10)
    const num = parseInt(value, 10)
    if (!Number.isNaN(num) && num >= 0) return num
  }
  return null
}

/** Parse LLM JSON response into ExtractedTask[]. */
function parseExtractedTasks(
  response: string,
  messages: StoredMessage[],
  validCatIds: readonly string[],
): ExtractedTask[] | null {
  const jsonMatch = response.match(/\[[\s\S]*?\]/)
  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      title?: unknown
      why?: unknown
      ownerCatId?: unknown
      sourceIndex?: unknown
    }>

    return parsed
      .filter(
        (item): item is { title: string; why: string; ownerCatId?: unknown; sourceIndex?: unknown } =>
          typeof item.title === 'string' && typeof item.why === 'string',
      )
      .map((item) => {
        const task: ExtractedTask = {
          title: item.title.slice(0, 200),
          why: item.why.slice(0, 500),
        }
        if (typeof item.ownerCatId === 'string' && validCatIds.includes(item.ownerCatId)) {
          task.ownerCatId = item.ownerCatId as CatId
        }
        const idx = normalizeSourceIndex(item.sourceIndex)
        if (idx !== null && messages[idx]) {
          task.sourceMessageId = messages[idx]?.id
        }
        return task
      })
  } catch {
    return null
  }
}

/** Fallback pattern matching for TODO/task extraction. */
export function extractByPatterns(messages: StoredMessage[]): ExtractedTask[] {
  const tasks: ExtractedTask[] = []
  const patterns = [
    /- \[ \] (.+)/g, // Markdown checkbox
    /TODO:?\s*(.+)/gi, // TODO: or TODO
    /#task\s+(.+)/gi, // #task tag
    /Action Item:?\s*(.+)/gi, // Action item
  ]

  for (const msg of messages) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(msg.content)) !== null) {
        const title = match[1]?.trim()
        if (title && title.length > 3 && title.length < 200) {
          tasks.push({ title, why: 'Extracted from conversation', sourceMessageId: msg.id })
        }
      }
    }
  }
  return tasks
}

/** Build the extraction prompt (valid cat ids interpolated for ownerCatId assignment). */
function buildExtractionPrompt(contextText: string, validCatIds: readonly string[]): string {
  return `You are a task extraction assistant. Analyze the following conversation and extract actionable tasks.

For each task, provide:
- title: A concise, actionable title (max 100 chars)
- why: Brief explanation of why this task is needed (max 200 chars)
- ownerCatId: If someone is clearly assigned, use one of: ${validCatIds
    .map((id) => `"${id}"`)
    .join(', ')}. Otherwise null.
- sourceIndex: The message index (msg-N) that originated this task

Return a JSON array. Example:
[
  {"title": "Implement user auth", "why": "Security requirement", "ownerCatId": null, "sourceIndex": 3},
  {"title": "Add unit tests", "why": "Ensure code quality", "ownerCatId": null, "sourceIndex": 5}
]

If no tasks are found, return an empty array: []

Conversation:
${contextText}

Extract tasks as JSON:`
}

/**
 * Extract tasks from conversation history.
 * Uses the injected LLM invoker with pattern-matching fallback; when no
 * invoker is configured, runs pattern-only extraction (degraded).
 */
export async function extractTasks(
  messages: StoredMessage[],
  invoker: TaskInvoker | null,
  validCatIds: readonly string[],
  options: ExtractionOptions,
): Promise<ExtractionResult> {
  const { signal, maxMessages = TASK_EXTRACTOR_MAX_MESSAGES } = options

  if (messages.length === 0) return { tasks: [], degraded: false }

  const recentMessages = messages.slice(-maxMessages)
  const contextText = formatMessagesForExtraction(recentMessages)

  if (signal?.aborted) {
    return { tasks: [], degraded: true, reason: 'Aborted before extraction' }
  }

  if (!invoker) {
    return {
      tasks: extractByPatterns(recentMessages),
      degraded: true,
      reason: 'No LLM invoker configured, used pattern matching',
    }
  }

  try {
    const prompt = buildExtractionPrompt(contextText, validCatIds)
    let fullResponse = ''

    for await (const msg of invoker(prompt)) {
      if (signal?.aborted) {
        return { tasks: [], degraded: true, reason: 'Aborted during extraction' }
      }
      if (msg.type === 'text' && msg.content) fullResponse += msg.content
      if (msg.type === 'error') throw new Error(msg.error ?? 'LLM error')
    }

    const parsed = parseExtractedTasks(fullResponse, recentMessages, validCatIds)
    if (parsed) return { tasks: parsed, degraded: false }

    const patternTasks = extractByPatterns(recentMessages)
    return { tasks: patternTasks, degraded: true, reason: 'LLM response was not valid JSON, used pattern matching' }
  } catch (err) {
    const patternTasks = extractByPatterns(recentMessages)
    return {
      tasks: patternTasks,
      degraded: true,
      reason: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/** Convert extracted tasks to CreateTaskInput for storage. */
export function toCreateTaskInputs(
  extracted: ExtractedTask[],
  threadId: string,
  createdBy: CatId | 'user',
): CreateTaskInput[] {
  return extracted.map((task) => {
    const base: CreateTaskInput = {
      threadId,
      title: task.title,
      userId: createdBy === 'user' ? 'user' : (createdBy as string),
      catId: task.ownerCatId ?? null,
      description: task.why,
      status: 'todo',
      kind: 'work',
      ...(task.sourceMessageId ? { metadata: { sourceMessageId: task.sourceMessageId } } : {}),
    }
    return base
  })
}
