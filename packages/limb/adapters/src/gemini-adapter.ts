/**
 * Gemini CLI 适配器 — `-o stream-json` 事件解析（T6.6）
 *
 * 本地化自 clowder-ai `providers/gemini-event-parser.ts`：
 * - init → session_init；message(role=assistant) → text；tool_use → tool_use；
 *   result 非 success → error（error.message 提取）；已知 candidates 崩溃文本标记
 */

import type { CliAdapter, CliAdapterConfig, CliEvent, CliEventParser, CliSpawnOptions } from './types.js';
import { binaryInPath } from './binary-lookup.js';

const KNOWN_POST_RESPONSE_CANDIDATES_CRASH = "Cannot read properties of undefined (reading 'candidates')";

/** 原始 Gemini CLI stream-json 事件 → CliEvent | null */
export function transformGeminiEvent(event: unknown): CliEvent | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as Record<string, unknown>;
  const now = (): number => Date.now();

  // init → session_init
  if (e.type === 'init') {
    const sessionId = e.session_id;
    if (typeof sessionId === 'string') {
      return { type: 'session_init', sessionId, timestamp: now() };
    }
    return null;
  }

  // message with role:"assistant" → text
  if (e.type === 'message' && e.role === 'assistant') {
    const content = e.content;
    if (typeof content === 'string') {
      return { type: 'text', content, timestamp: now() };
    }
    return null;
  }

  // tool_use → tool_use
  if (e.type === 'tool_use') {
    const toolName = e.tool_name;
    if (typeof toolName === 'string') {
      return {
        type: 'tool_use',
        toolName,
        toolInput: (e.parameters as Record<string, unknown>) ?? {},
        timestamp: now(),
      };
    }
    return null;
  }

  // result 非 success → error（无 message 时交 exit 诊断兜底）
  if (e.type === 'result' && e.status !== 'success') {
    const message = extractGeminiErrorMessage(e.error);
    if (!message) return null;
    return { type: 'error', error: message, timestamp: now() };
  }

  // 其余（message/user、tool_result、result/success）→ 跳过
  return null;
}

export function isGeminiResultErrorEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as Record<string, unknown>;
  return e.type === 'result' && e.status !== 'success';
}

export function extractGeminiErrorMessage(rawError: unknown): string | null {
  if (typeof rawError === 'string') {
    const value = rawError.trim();
    return value.length > 0 ? value : null;
  }
  if (typeof rawError === 'object' && rawError !== null) {
    const message = (rawError as Record<string, unknown>).message;
    if (typeof message === 'string') {
      const value = message.trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** 已知 Gemini CLI 崩溃文本：响应后读 candidates 未定义 */
export function isKnownGeminiCandidatesCrash(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as Record<string, unknown>;
  if (e.type !== 'result' || e.status === 'success') return false;
  const message = extractGeminiErrorMessage(e.error);
  return message?.includes(KNOWN_POST_RESPONSE_CANDIDATES_CRASH) ?? false;
}

/** 默认 Gemini CLI 适配器配置 */
export const DEFAULT_GEMINI_ADAPTER_CONFIG: CliAdapterConfig = {
  kind: 'gemini',
  binary: 'gemini',
  description: 'Google Gemini CLI — multimodal coding & review',
  defaultTimeoutMs: 120_000,
};

export function createGeminiAdapter(overrides?: Partial<CliAdapterConfig>): CliAdapter {
  const config: CliAdapterConfig = { ...DEFAULT_GEMINI_ADAPTER_CONFIG, ...overrides };
  return {
    config,
    isAvailable(pathEnv?: string): boolean {
      return binaryInPath(config.binary, pathEnv);
    },
    buildSpawnArgs(options?: CliSpawnOptions): string[] {
      // gemini -p "prompt" -o stream-json（ACP 模式由组合根以 extraArgs 追加）
      const args: string[] = [];
      if (options?.resumeSessionId) args.push('--resume', options.resumeSessionId);
      if (options?.model) args.push('-m', options.model);
      args.push('-p');
      if (options?.prompt) args.push(options.prompt);
      args.push('-o', 'stream-json');
      if (options?.extraArgs) args.push(...options.extraArgs);
      return args;
    },
    createParser(): CliEventParser {
      return { transform: (raw) => transformGeminiEvent(raw) };
    },
  };
}
