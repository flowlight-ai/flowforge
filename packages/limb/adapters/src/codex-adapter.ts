/**
 * Codex 适配器 — `codex exec --json` 事件解析（T6.6）
 *
 * 本地化自 clowder-ai `providers/codex-event-transform.ts` 核心映射：
 * - 去掉签名剥离/图像扫描/GitHub App 审批分类等重度业务（组合根需要时另行装配）
 * - 保留核心语义：thread.started → session_init；item.started command_execution/mcp_tool_call
 *   → tool_use；item.completed agent_message → text（多轮 \n\n 分隔）；todo_list →
 *   system_info(task_progress)；mcp_tool_call completed → tool_result（含 ok/error/unknown）；
 *   file_change → tool_use；reasoning → thinking；error → warning；turn.* 终态追踪
 */

import type { CliAdapter, CliAdapterConfig, CliEvent, CliEventParser, CliSpawnOptions } from './types.js';
import { binaryInPath } from './binary-lookup.js';

/** Codex 流状态（每 spawn 一个实例）：多轮文本分隔 + 终态追踪 */
export interface CodexStreamState {
  hadPriorTextTurn: boolean;
  /** 最近一次 turn 的终态（仅最终成功流可发签名——此处仅用于语义追踪） */
  lastTurnTerminal?: 'successful' | 'non_success';
  finalizeEmitted: boolean;
}

export function createCodexStreamState(): CodexStreamState {
  return { hadPriorTextTurn: false, finalizeEmitted: false };
}

function normalizeTaskStatus(raw: string): 'pending' | 'in_progress' | 'completed' {
  const value = raw.toLowerCase();
  if (value === 'completed' || value === 'done') return 'completed';
  if (value === 'in_progress' || value === 'running') return 'in_progress';
  return 'pending';
}

/**
 * 原始 Codex CLI NDJSON 事件 → CliEvent | CliEvent[] | null。
 * null 表示跳过（turn.started/turn.completed 等控制事件）。
 */
export function transformCodexEvent(
  event: unknown,
  state?: CodexStreamState,
): CliEvent | CliEvent[] | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as Record<string, unknown>;
  const now = (): number => Date.now();

  if (state) {
    if (e.type === 'turn.completed') {
      state.lastTurnTerminal = e.status === undefined || e.status === 'completed' ? 'successful' : 'non_success';
    } else if (e.type === 'turn.failed') {
      state.lastTurnTerminal = 'non_success';
    } else if (
      e.type === 'turn.started' ||
      e.type === 'item.started' ||
      e.type === 'item.updated' ||
      e.type === 'item.completed'
    ) {
      delete state.lastTurnTerminal;
    }
  }

  if (e.type === 'thread.started') {
    const threadId = e.thread_id;
    if (typeof threadId !== 'string') return null;
    return { type: 'session_init', sessionId: threadId, timestamp: now() };
  }

  // todo_list（started/updated/completed）→ system_info(task_progress)，优先于 item 分支
  const isTodoList =
    (e.type === 'item.started' || e.type === 'item.updated' || e.type === 'item.completed') &&
    (e.item as Record<string, unknown> | undefined)?.type === 'todo_list';
  if (isTodoList) {
    const todoItem = e.item as Record<string, unknown>;
    const rawItems = Array.isArray(todoItem.todo_items)
      ? (todoItem.todo_items as Array<Record<string, unknown>>)
      : Array.isArray(todoItem.items)
        ? (todoItem.items as Array<Record<string, unknown>>)
        : [];
    const tasks = rawItems.map((t, i) => {
      const subject = typeof t.content === 'string' ? t.content : typeof t.text === 'string' ? t.text : '';
      const rawStatus =
        typeof t.status === 'string'
          ? t.status
          : typeof t.completed === 'boolean'
            ? t.completed
              ? 'completed'
              : 'pending'
            : 'pending';
      return {
        id: typeof t.id === 'string' ? t.id : `task-${i}`,
        subject: subject.slice(0, 120),
        status: normalizeTaskStatus(rawStatus),
      };
    });
    return {
      type: 'system_info',
      content: JSON.stringify({ type: 'task_progress', action: 'snapshot', tasks }),
      timestamp: now(),
    };
  }

  if (e.type === 'item.started') {
    const item = e.item as Record<string, unknown> | undefined;
    // mcp_tool_call started → tool_use
    if (item?.type === 'mcp_tool_call') {
      const server = typeof item.server === 'string' ? item.server : 'unknown';
      const tool = typeof item.tool === 'string' ? item.tool : 'unknown';
      const args =
        typeof item.arguments === 'object' && item.arguments !== null
          ? (item.arguments as Record<string, unknown>)
          : {};
      const msg: CliEvent = {
        type: 'tool_use',
        toolName: `mcp:${server}/${tool}`,
        toolInput: args,
        timestamp: now(),
      };
      if (typeof item.id === 'string') msg.toolUseId = item.id;
      return msg;
    }
    // command_execution started → tool_use
    if (item?.type !== 'command_execution') return null;
    const command = item.command;
    if (typeof command !== 'string') return null;
    return { type: 'tool_use', toolName: 'command_execution', toolInput: { command }, timestamp: now() };
  }

  if (e.type === 'error') {
    const message = e.message;
    if (typeof message !== 'string') return null;
    const text = message.trim();
    // Reconnecting… 行是 UI 进度流，不是错误
    if (text.startsWith('Reconnecting...')) {
      return { type: 'system_info', content: text, timestamp: now() };
    }
    // 其余错误由调用方（spawn 退出诊断）收集，此处不产出事件
    return null;
  }

  if (e.type === 'turn.completed') return null;

  if (e.type !== 'item.completed') return null;

  const item = e.item as Record<string, unknown> | undefined;

  // agent_message → text（多轮间 \n\n 分隔）
  if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text.trim().length > 0) {
    const prefix = state?.hadPriorTextTurn ? '\n\n' : '';
    if (state) state.hadPriorTextTurn = true;
    return { type: 'text', content: prefix + item.text, timestamp: now() };
  }

  // command_execution completed → tool_result
  if (item?.type === 'command_execution') {
    const command = typeof item.command === 'string' ? item.command : '';
    const status = typeof item.status === 'string' ? item.status : 'completed';
    const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null;
    const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
    const sections: string[] = [];
    if (command) sections.push(`command: ${command}`);
    sections.push(`status: ${status}`);
    if (exitCode !== null) sections.push(`exit_code: ${exitCode}`);
    const trimmedOutput = output.trimEnd();
    if (trimmedOutput) sections.push(trimmedOutput);
    return { type: 'tool_result', content: sections.join('\n'), timestamp: now() };
  }

  // file_change completed → tool_use
  if (item?.type === 'file_change') {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const status = typeof item.status === 'string' ? item.status : 'completed';
    return { type: 'tool_use', toolName: 'file_change', toolInput: { status, changes }, timestamp: now() };
  }

  // mcp_tool_call completed → tool_result（status → ok/error/unknown）
  if (item?.type === 'mcp_tool_call') {
    const server = typeof item.server === 'string' ? item.server : 'unknown';
    const tool = typeof item.tool === 'string' ? item.tool : 'unknown';
    const status = typeof item.status === 'string' ? item.status : 'completed';
    const result = item.result as Record<string, unknown> | undefined;
    const itemError = item.error as Record<string, unknown> | undefined;
    const contentArr = Array.isArray(result?.content) ? result.content : [];
    const typed = contentArr as Array<Record<string, unknown>>;
    const textParts = typed
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string);
    const resultError =
      typeof result?.Err === 'string'
        ? result.Err
        : (status === 'failed' || status === 'error') && typeof itemError?.message === 'string'
          ? itemError.message
          : status === 'failed' || status === 'error'
            ? textParts.length === 1
              ? textParts[0]
              : undefined
            : undefined;
    const visibleTextParts = textParts.length > 0 ? textParts : resultError ? [resultError] : [];
    const toolLabel = `mcp:${server}/${tool}`;
    const toolResultStatus: 'ok' | 'error' | 'unknown' =
      status === 'completed' ? 'ok' : status === 'failed' || status === 'error' ? 'error' : 'unknown';
    const msg: CliEvent = {
      type: 'tool_result',
      content: `${toolLabel} (${status})\n${visibleTextParts.join('\n')}`.trim(),
      toolName: toolLabel,
      toolResultStatus,
      timestamp: now(),
    };
    if (typeof item.id === 'string') msg.toolUseId = item.id;
    return msg;
  }

  // web_search → system_info（仅计数，不记录查询词——隐私）
  if (item?.type === 'web_search') {
    return { type: 'system_info', content: JSON.stringify({ type: 'web_search', count: 1 }), timestamp: now() };
  }

  // reasoning → system_info(thinking)
  if (item?.type === 'reasoning' && typeof item.text === 'string' && item.text.length > 0) {
    return { type: 'system_info', content: JSON.stringify({ type: 'thinking', text: item.text }), timestamp: now() };
  }

  // item-level error → system_info(warning)
  if (item?.type === 'error' && typeof item.message === 'string') {
    return { type: 'system_info', content: JSON.stringify({ type: 'warning', message: item.message }), timestamp: now() };
  }

  return null;
}

/** 默认 Codex 适配器配置（对齐 EAC DEFAULT_CONFIGS） */
export const DEFAULT_CODEX_ADAPTER_CONFIG: CliAdapterConfig = {
  kind: 'codex',
  binary: 'codex',
  description: 'OpenAI Codex CLI — code generation',
  defaultTimeoutMs: 120_000,
};

export function createCodexAdapter(overrides?: Partial<CliAdapterConfig>): CliAdapter {
  const config: CliAdapterConfig = { ...DEFAULT_CODEX_ADAPTER_CONFIG, ...overrides };
  return {
    config,
    isAvailable(pathEnv?: string): boolean {
      return binaryInPath(config.binary, pathEnv);
    },
    buildSpawnArgs(options?: CliSpawnOptions): string[] {
      // exec_json 模式（clowder 验证过的 --ignore-user-config + 空 MCP 硬围栏）
      const args = ['exec'];
      if (options?.resumeSessionId) {
        args.push('resume', options.resumeSessionId);
      }
      args.push('--json', '--ignore-user-config');
      if (options?.extraArgs) args.push(...options.extraArgs);
      if (options?.prompt) args.push(options.prompt);
      return args;
    },
    createParser(): CliEventParser {
      const state = createCodexStreamState();
      return {
        transform: (raw) => transformCodexEvent(raw, state),
        finalize: () => {
          // 终态语义仅用于遥测；本包不产出签名文本
          state.finalizeEmitted = true;
          return null;
        },
      };
    },
  };
}
