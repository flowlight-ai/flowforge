/**
 * Claude Code 适配器 — stream-json 事件解析（T6.6）
 *
 * 本地化自 clowder-ai `providers/claude-ndjson-parser.ts`（transformClaudeEvent）：
 * - 去掉 catId 依赖 → 统一 CliEvent（limb 域面向 worktree/invocation）
 * - 去掉 claude-mcp-status 快照（MCP 状态属观察域，组合根可另行消费 system/init 原文）
 * - 保留核心语义：stream_event 增量文本 / thinking 缓冲 / assistant 快照去重 /
 *   result error 分类 / usage 归一化（input + cache_read + cache_creation）
 */

import type { CliAdapter, CliAdapterConfig, CliEvent, CliEventParser, CliSpawnOptions } from './types.js';
import { binaryInPath } from './binary-lookup.js';

/** Claude stream-json 解析状态（每 spawn 一个实例） */
export interface ClaudeStreamState {
  currentMessageId: string | undefined;
  /** 已通过 text_delta 增量发出的消息 id（assistant 快照需跳过重复文本） */
  partialTextMessageIds: Set<string>;
  /** 最近一次 message_start 的输入 token 总量（含 cache） */
  lastTurnInputTokens: number | undefined;
  /** 累积 thinking_delta 直到 content_block_stop */
  thinkingBuffer: string;
}

export function createClaudeStreamState(): ClaudeStreamState {
  return {
    currentMessageId: undefined,
    partialTextMessageIds: new Set(),
    lastTurnInputTokens: undefined,
    thinkingBuffer: '',
  };
}

/** 从 message_start/message_delta 的 usage 归一化输入 token（input + cache_read + cache_creation） */
function extractTotalInputTokens(usage: Record<string, unknown> | undefined): number | undefined {
  if (!usage) return undefined;
  const raw = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const cacheRead = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
  const cacheCreate = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
  const total = raw + cacheRead + cacheCreate;
  return total > 0 ? total : undefined;
}

/** result 事件是否携带错误（is_error 或 subtype !== success） */
export function isClaudeResultErrorEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as Record<string, unknown>;
  return e.type === 'result' && (e.is_error === true || e.subtype !== 'success');
}

/** result/success 的 usage 归一化（对齐 extractClaudeUsage 语义） */
export function extractClaudeUsage(e: Record<string, unknown>): Record<string, unknown> {
  const usage = (e.usage ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const cacheRead = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
  const cacheCreate = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
  const totalInput = extractTotalInputTokens(usage);
  if (totalInput != null) {
    result.inputTokens = totalInput;
    result.lastTurnInputTokens = totalInput;
  }
  if (typeof usage.output_tokens === 'number') result.outputTokens = usage.output_tokens;
  if (cacheRead > 0) result.cacheReadTokens = cacheRead;
  if (cacheCreate > 0) result.cacheCreationTokens = cacheCreate;
  if (typeof e.total_cost_usd === 'number') result.costUsd = e.total_cost_usd;
  if (typeof e.duration_ms === 'number') result.durationMs = e.duration_ms;
  if (typeof e.num_turns === 'number') result.numTurns = e.num_turns;
  // context window 提取（modelUsage / model_usage 两版本兼容）
  const modelUsage = (e.modelUsage ?? e.model_usage) as Record<string, Record<string, unknown>> | undefined;
  if (modelUsage) {
    for (const data of Object.values(modelUsage)) {
      const contextWindow =
        typeof data.contextWindow === 'number'
          ? data.contextWindow
          : typeof data.context_window === 'number'
            ? data.context_window
            : undefined;
      if (contextWindow != null) {
        result.contextWindowSize = contextWindow;
        break;
      }
    }
  }
  return result;
}

const RESULT_ERROR_SUBTYPE_LABELS: Record<string, string> = {
  error_max_turns: 'Max turns exceeded',
  error_max_budget_usd: 'Budget limit reached',
  error_during_execution: 'Execution error',
  error_max_structured_output_retries: 'Structured output retries exceeded',
  success: 'Claude result error',
};

/**
 * 原始 Claude CLI stream-json 事件 → CliEvent | CliEvent[] | null。
 * null 表示跳过（system/hook、result/success、message_start 等无输出事件）。
 */
export function transformClaudeEvent(event: unknown, state: ClaudeStreamState): CliEvent | CliEvent[] | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as Record<string, unknown>;
  const now = (): number => Date.now();

  // stream_event/*（--include-partial-messages 开启时的增量事件）
  if (e.type === 'stream_event') {
    const streamEvent = e.event;
    if (typeof streamEvent !== 'object' || streamEvent === null) return null;
    const s = streamEvent as Record<string, unknown>;

    if (s.type === 'message_start') {
      const message = s.message as Record<string, unknown> | undefined;
      const messageId = message?.id;
      if (typeof messageId === 'string') state.currentMessageId = messageId;
      // 每个 message_start 重置 per-turn tracker，防止跨轮陈旧携带
      state.lastTurnInputTokens = extractTotalInputTokens(
        (message?.usage as Record<string, unknown> | undefined) ?? undefined,
      );
      return null;
    }

    if (s.type === 'message_delta') {
      // 部分网关 message_start 报 0，真实值在 message_delta.usage
      if (state.lastTurnInputTokens == null) {
        const deltaUsage = (s.usage ?? (s.delta as Record<string, unknown> | undefined)?.usage) as
          | Record<string, unknown>
          | undefined;
        state.lastTurnInputTokens = extractTotalInputTokens(deltaUsage);
      }
      return null;
    }

    if (s.type === 'message_stop') {
      state.currentMessageId = undefined;
      // agent_loop 遥测标记：provider 无关的 LLM 调用边界
      return { type: 'agent_loop', timestamp: now() };
    }

    if (s.type === 'content_block_start') {
      const contentBlock = s.content_block as Record<string, unknown> | undefined;
      if (contentBlock?.type === 'thinking') state.thinkingBuffer = '';
      return null;
    }

    if (s.type === 'content_block_delta') {
      const delta = s.delta;
      if (typeof delta !== 'object' || delta === null) return null;
      const d = delta as Record<string, unknown>;
      if (d.type === 'thinking_delta') {
        if (typeof d.thinking === 'string') state.thinkingBuffer += d.thinking;
        return null;
      }
      if (d.type === 'signature_delta') return null;
      if (d.type !== 'text_delta' || typeof d.text !== 'string' || d.text.length === 0) return null;
      if (state.currentMessageId) state.partialTextMessageIds.add(state.currentMessageId);
      return { type: 'text', content: d.text, timestamp: now() };
    }

    if (s.type === 'content_block_stop') {
      if (state.thinkingBuffer.length > 0) {
        const text = state.thinkingBuffer;
        state.thinkingBuffer = '';
        return { type: 'system_info', content: JSON.stringify({ type: 'thinking', text }), timestamp: now() };
      }
      return null;
    }

    return null;
  }

  // system/init → session_init
  if (e.type === 'system' && e.subtype === 'init') {
    const sessionId = e.session_id;
    if (typeof sessionId === 'string') {
      return { type: 'session_init', sessionId, timestamp: now() };
    }
    return null;
  }

  // system/compact_boundary → system_info
  if (e.type === 'system' && e.subtype === 'compact_boundary') {
    const preTokens = typeof e.pre_tokens === 'number' ? e.pre_tokens : undefined;
    return { type: 'system_info', content: JSON.stringify({ type: 'compact_boundary', preTokens }), timestamp: now() };
  }

  // assistant → text / tool_use（多个 content block）
  if (e.type === 'assistant') {
    const message = e.message as Record<string, unknown> | undefined;
    const messageId = typeof message?.id === 'string' ? message.id : undefined;
    const skipFinalText = Boolean(messageId && state.partialTextMessageIds.has(messageId));
    const content = message?.content;
    if (!Array.isArray(content)) return null;
    const hasTextBlock = content.some((block) => {
      if (typeof block !== 'object' || block === null) return false;
      const candidate = block as Record<string, unknown>;
      return candidate.type === 'text' && typeof candidate.text === 'string' && candidate.text.length > 0;
    });

    // <synthetic> 本地合成条目：API/Error 前缀 → error；其余无输出
    if (message?.model === '<synthetic>') {
      const syntheticText = content.find(
        (block) =>
          typeof block === 'object' &&
          block !== null &&
          (block as Record<string, unknown>).type === 'text' &&
          typeof (block as Record<string, unknown>).text === 'string',
      ) as { text?: string } | undefined;
      const text = syntheticText?.text ?? '';
      if (text.startsWith('API Error:') || text.startsWith('Error:')) {
        return { type: 'error', error: text, errorDisposition: 'transient', timestamp: now() };
      }
      return null;
    }

    const messages: CliEvent[] = [];
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
        if (skipFinalText) continue;
        messages.push({ type: 'text', content: b.text, timestamp: now() });
      } else if (b.type === 'tool_use' && typeof b.name === 'string') {
        const msg: CliEvent = {
          type: 'tool_use',
          toolName: b.name,
          toolInput: (b.input as Record<string, unknown>) ?? {},
          timestamp: now(),
        };
        if (typeof b.id === 'string') msg.toolUseId = b.id;
        messages.push(msg);
      }
    }
    // 增量已发完且快照带文本：释放去重标记（thinking/tool 快照不算文本终止）
    if (messageId && skipFinalText && hasTextBlock) {
      state.partialTextMessageIds.delete(messageId);
    }
    // thinking-only 快照兜底 → system_info(thinking)
    if (messages.length === 0) {
      const thinkingBlock = content.find(
        (b) => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'thinking',
      ) as { thinking?: string; text?: string } | undefined;
      if (thinkingBlock) {
        const thinkingText = thinkingBlock.thinking ?? thinkingBlock.text ?? '';
        return { type: 'system_info', content: JSON.stringify({ type: 'thinking', text: thinkingText }), timestamp: now() };
      }
    }
    return messages.length > 0 ? messages : null;
  }

  // rate_limit_event → system_info
  if (e.type === 'rate_limit_event') {
    const utilization = typeof e.utilization === 'number' ? e.utilization : undefined;
    const resetsAt = typeof e.resets_at === 'string' ? e.resets_at : undefined;
    return { type: 'system_info', content: JSON.stringify({ type: 'rate_limit', utilization, resetsAt }), timestamp: now() };
  }

  // result 是调用终止边界：清理增量状态防跨调用泄漏
  if (e.type === 'result') {
    state.partialTextMessageIds.clear();
  }

  // result/error → error（errors 数组为空时用 subtype 兜底）
  if (isClaudeResultErrorEvent(e)) {
    const rawErrors = Array.isArray(e.errors) ? e.errors : [];
    const errors = rawErrors.filter((item): item is string => typeof item === 'string').join('; ');
    const resultText = typeof e.result === 'string' ? e.result : '';
    const subtype = typeof e.subtype === 'string' ? e.subtype : undefined;
    const fallbackError = subtype ? (RESULT_ERROR_SUBTYPE_LABELS[subtype] ?? `Agent error (${subtype})`) : 'Unknown error';
    return {
      type: 'error',
      error: errors || resultText || fallbackError,
      content: JSON.stringify({ errorSubtype: subtype, isError: e.is_error === true }),
      timestamp: now(),
    };
  }

  // result/success、system/hook 等 → 跳过
  return null;
}

/** 默认 Claude Code 适配器配置（对齐 EAC DEFAULT_CONFIGS） */
export const DEFAULT_CLAUDE_ADAPTER_CONFIG: CliAdapterConfig = {
  kind: 'claude',
  binary: 'claude',
  description: 'Anthropic Claude Code — coding & code review',
  defaultTimeoutMs: 120_000,
};

export function createClaudeAdapter(overrides?: Partial<CliAdapterConfig>): CliAdapter {
  const config: CliAdapterConfig = { ...DEFAULT_CLAUDE_ADAPTER_CONFIG, ...overrides };
  return {
    config,
    isAvailable(pathEnv?: string): boolean {
      return binaryInPath(config.binary, pathEnv);
    },
    buildSpawnArgs(options?: CliSpawnOptions): string[] {
      const args = ['-p'];
      if (options?.resumeSessionId) args.push('--resume', options.resumeSessionId);
      args.push('--output-format', 'stream-json', '--include-partial-messages', '--verbose');
      if (options?.extraArgs) args.push(...options.extraArgs);
      if (options?.prompt) args.push(options.prompt);
      return args;
    },
    createParser(): CliEventParser {
      const state = createClaudeStreamState();
      return { transform: (raw) => transformClaudeEvent(raw, state) };
    },
  };
}
