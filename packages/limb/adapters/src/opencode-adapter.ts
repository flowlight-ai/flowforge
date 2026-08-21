/**
 * opencode 适配器 — `run --format json` NDJSON 事件解析（T6.6）
 *
 * 本地化自 clowder-ai `providers/opencode-event-transform.ts`：
 * - step_start → session_init；text → text（part.type='reasoning' → thinking）；
 *   reasoning → system_info(thinking)；tool_use → tool_use；error → error；
 *   step_finish → agent_loop（usage 归一化：input + cache.read + cache.write）
 */

import type { CliAdapter, CliAdapterConfig, CliEvent, CliEventParser, CliSpawnOptions } from './types.js';
import { binaryInPath } from './binary-lookup.js';

interface OpenCodeEvent {
  type: string;
  timestamp?: number;
  sessionID?: string;
  part?: {
    type?: string;
    text?: string;
    tool?: string;
    callID?: string;
    state?: { input?: Record<string, unknown>; [key: string]: unknown };
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: { read?: number; write?: number };
    };
    cost?: number;
    [key: string]: unknown;
  };
  error?: {
    name?: string;
    data?: { message?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function isOpenCodeEvent(event: unknown): event is OpenCodeEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as Record<string, unknown>;
  return typeof e.type === 'string';
}

/** 原始 opencode NDJSON 事件 → CliEvent | null */
export function transformOpenCodeEvent(event: unknown): CliEvent | null {
  if (!isOpenCodeEvent(event)) return null;
  const ts = typeof event.timestamp === 'number' ? event.timestamp : Date.now();

  switch (event.type) {
    case 'step_start':
      return { type: 'session_init', sessionId: event.sessionID ?? 'unknown', timestamp: ts };

    case 'text': {
      const text = event.part?.text;
      if (typeof text !== 'string' || text.length === 0) return null;
      // reasoning 型文本路由到 thinking
      if (event.part?.type === 'reasoning') {
        return { type: 'system_info', content: JSON.stringify({ type: 'thinking', text }), timestamp: ts };
      }
      return { type: 'text', content: text, timestamp: ts };
    }

    // 独立 reasoning 事件（思考模型）
    case 'reasoning': {
      const reasoningText = event.part?.text;
      if (typeof reasoningText !== 'string' || reasoningText.length === 0) return null;
      return { type: 'system_info', content: JSON.stringify({ type: 'thinking', text: reasoningText }), timestamp: ts };
    }

    case 'tool_use': {
      const msg: CliEvent = {
        type: 'tool_use',
        toolName: event.part?.tool ?? 'unknown',
        toolInput: event.part?.state?.input ?? {},
        timestamp: ts,
      };
      if (typeof event.part?.callID === 'string') msg.toolUseId = event.part.callID;
      return msg;
    }

    case 'error': {
      const errorMsg = event.error?.data?.message ?? event.error?.name ?? 'opencode error';
      return { type: 'error', error: errorMsg, timestamp: ts };
    }

    case 'step_finish': {
      // usage 归一化：opencode 把缓存 token 单独报在 cache.{read,write}
      const tokens = event.part?.tokens;
      const freshInput = typeof tokens?.input === 'number' ? tokens.input : undefined;
      const cacheRead = typeof tokens?.cache?.read === 'number' ? tokens.cache.read : undefined;
      const cacheWrite = typeof tokens?.cache?.write === 'number' ? tokens.cache.write : undefined;
      const outputTokens = typeof tokens?.output === 'number' ? tokens.output : undefined;
      const totalTokens = typeof tokens?.total === 'number' ? tokens.total : undefined;
      const costUsd = typeof event.part?.cost === 'number' ? event.part.cost : undefined;
      const totalInputTokens =
        freshInput != null || cacheRead != null || cacheWrite != null
          ? (freshInput ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
          : undefined;
      // 无遥测数据时不产出空 agent_loop 标记
      if (totalInputTokens == null && outputTokens == null && totalTokens == null) return null;
      return {
        type: 'agent_loop',
        timestamp: ts,
        metadata: {
          provider: 'opencode',
          model: '',
          usage: {
            ...(totalInputTokens != null
              ? { inputTokens: totalInputTokens, lastTurnInputTokens: totalInputTokens }
              : {}),
            ...(outputTokens != null ? { outputTokens } : {}),
            ...(totalTokens != null ? { totalTokens } : {}),
            ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
            ...(cacheWrite ? { cacheCreationTokens: cacheWrite } : {}),
            ...(costUsd != null ? { costUsd } : {}),
          },
        },
      };
    }

    default:
      return null;
  }
}

/** 默认 opencode 适配器配置 */
export const DEFAULT_OPENCODE_ADAPTER_CONFIG: CliAdapterConfig = {
  kind: 'opencode',
  binary: 'opencode',
  description: 'Open-source coding agent',
  defaultTimeoutMs: 120_000,
};

export function createOpenCodeAdapter(overrides?: Partial<CliAdapterConfig>): CliAdapter {
  const config: CliAdapterConfig = { ...DEFAULT_OPENCODE_ADAPTER_CONFIG, ...overrides };
  return {
    config,
    isAvailable(pathEnv?: string): boolean {
      return binaryInPath(config.binary, pathEnv);
    },
    buildSpawnArgs(options?: CliSpawnOptions): string[] {
      const args = ['run'];
      if (options?.resumeSessionId) args.push('--continue', options.resumeSessionId);
      if (options?.model) args.push('-m', options.model);
      if (options?.prompt) args.push(options.prompt);
      args.push('--format', 'json');
      if (options?.extraArgs) args.push(...options.extraArgs);
      return args;
    },
    createParser(): CliEventParser {
      return { transform: (raw) => transformOpenCodeEvent(raw) };
    },
  };
}
