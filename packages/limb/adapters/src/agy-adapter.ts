/**
 * AGY（Antigravity）适配器 — `--print` plain text 分类（T6.6）
 *
 * 本地化自 clowder-ai `providers/antigravity-cli-event-parser.ts`：
 * - AGY print 模式不产出 NDJSON，只有最终 stdout 文本；部分故障也以纯文本/日志行返回
 * - 分类四错误：timeout（--print-timeout 文本）/ missing_session（resume 时 conversation not found）/
 *   auth_required（OAuth 登录提示）/ missing_model（账号侧无默认模型，提示 /model）
 * - resumed 轨迹替换（F210 H2b）：resumedFinalText 非空时替换 stdout 重放，避免
 *   `--conversation` 累加重放；提取失败 fail-open 保留 stdout
 */

import type { CliAdapter, CliAdapterConfig, CliEvent, CliEventParser, CliPlainTextResult, CliSpawnOptions } from './types.js';
import { binaryInPath } from './binary-lookup.js';

/** AGY plain text 分类输入（对齐 AntigravityCliPlainTextInput） */
export interface AgyCliPlainTextInput {
  stdout: string;
  stderr?: string;
  /** resume 续跑轮次（缺省 false） */
  resumed?: boolean;
  agyLogText?: string;
  /** resumed turn 从轨迹库提取的本轮 final answer；非空时替换 stdout 重放 */
  resumedFinalText?: string | null;
}

/** 原始 stdout/stderr → 分类结果（missing_session 判定优先于其余错误） */
export function classifyAgyPlainText(input: AgyCliPlainTextInput): CliPlainTextResult {
  const missingConversationId = input.resumed
    ? extractAgyConversationNotFoundWarning(input.stdout) ??
      extractAgyConversationNotFoundWarning(input.agyLogText ?? '')
    : null;
  if (input.resumed && missingConversationId) {
    return {
      kind: 'error',
      errorKind: 'missing_session',
      error: `No conversation found with session ID: ${missingConversationId}`,
    };
  }

  const trimmedStdout = stripFreshConversationWarning(input.stdout).trim();
  const diagnosticText = `${trimmedStdout}\n${(input.stderr ?? '').trim()}`;

  if (isAgyPrintTimeoutOutput(trimmedStdout)) {
    return {
      kind: 'error',
      errorKind: 'timeout',
      error: 'AGY CLI 响应超时：agy --print-timeout 返回了 timeout 文本但进程可能仍是 exit 0。',
    };
  }

  if (isAgyAuthRequiredDiagnostic(diagnosticText)) {
    return { kind: 'error', errorKind: 'auth_required', error: formatAgyAuthRequiredError() };
  }

  if (isAgyMissingModelDiagnostic(diagnosticText)) {
    return { kind: 'error', errorKind: 'missing_model', error: formatAgyMissingModelError() };
  }

  const resumedFinalText = input.resumed ? input.resumedFinalText?.trim() : undefined;
  const hasResumedFinal = Boolean(resumedFinalText && resumedFinalText.length > 0);

  if (trimmedStdout.length === 0) {
    // resumed 轮 stdout 为空但轨迹提取到有效 final → 用 final（不当 empty 丢弃有效回复）
    if (hasResumedFinal) {
      return { kind: 'text', content: resumedFinalText as string, textMode: 'replace' };
    }
    return { kind: 'empty' };
  }

  if (input.resumed) {
    // 轨迹提取到本轮 final → 替换 stdout 重放；否则 fail-open 保留 stdout
    return {
      kind: 'text',
      content: hasResumedFinal ? (resumedFinalText as string) : trimmedStdout,
      textMode: 'replace',
    };
  }
  return { kind: 'text', content: trimmedStdout };
}

/** 从日志文本提取 AGY conversation UUID（多个时取最后出现的） */
export function extractAgyCliConversationId(logText: string): string | null {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const re = new RegExp(
    `(?:Created conversation|Print mode: conversation=|Streaming conversation|Sending user message to conversation|Forwarding user message to conversation)\\s*(${uuid})`,
    'gi',
  );
  let conversationId: string | null = null;
  for (const match of logText.matchAll(re)) {
    conversationId = match[1] ?? conversationId;
  }
  return conversationId;
}

/** 从日志文本提取账号侧选中模型 label（/model 命令后 Propagating... 行） */
export function extractAgyCliSelectedModelLabel(logText: string): string | null {
  const re = /\bPropagating selected model override to backend:\s*label="([^"\r\n]+)"/gi;
  let selectedModel: string | null = null;
  for (const match of logText.matchAll(re)) {
    selectedModel = match[1] ?? selectedModel;
  }
  return selectedModel;
}

function isAgyPrintTimeoutOutput(stdout: string): boolean {
  return /^Error:\s*timed out waiting for response\.?$/i.test(stdout.trim());
}

function stripFreshConversationWarning(stdout: string): string {
  return stdout.replace(/^Warning:\s*conversation\s+"agy-[^"\r\n]+"\s+not found\.\r?\n/i, '');
}

function extractAgyConversationNotFoundWarning(text: string): string | null {
  const stdoutMatch = text.match(/^Warning:\s*conversation\s+"([^"\r\n]+)"\s+not found\./im);
  if (stdoutMatch?.[1]) return stdoutMatch[1];

  const logMatch = text.match(/\bConversation\s+([^\s,]+)\s+not found,\s+ignoring\s+--conversation\s+flag\b/i);
  return logMatch?.[1] ?? null;
}

function isAgyMissingModelDiagnostic(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^(?:Error:|E\.\.\.)\s*(?:failed to construct executor:\s*)?neither PlanModel nor RequestedModel specified\b/im.test(
      trimmed,
    ) || /^(?:Error:|E\.\.\.).*\bPlease use the \/model command\b/im.test(trimmed)
  );
}

function isAgyAuthRequiredDiagnostic(text: string): boolean {
  const trimmed = text.trim();
  const hasAuthPrompt = /^Authentication required\.\s+Please visit the URL to log in:/im.test(trimmed);
  const hasGoogleOAuthUrl = /^\s*https:\/\/accounts\.google\.com\/o\/oauth2\/auth\b/im.test(trimmed);
  const hasAuthWait = /^Waiting for authentication \(timeout \d+s\)\.\.\./im.test(trimmed);
  const hasAuthInterrupted = /^Error:\s*authentication interrupted\.?$/im.test(trimmed);

  return hasAuthPrompt && (hasGoogleOAuthUrl || (hasAuthWait && hasAuthInterrupted));
}

function formatAgyAuthRequiredError(): string {
  return [
    'AGY CLI profile is not authenticated.',
    'Run `agy` with the same HOME/profile and complete login before unattended use.',
    'For isolated AGY profiles, each profile HOME must be onboarded separately.',
  ].join(' ');
}

function formatAgyMissingModelError(): string {
  return [
    'AGY CLI 没有可用的账号侧默认模型。',
    'AGY CLI 没有已验证的 --model/env per-call 模型覆盖；请先运行 `agy` 进入交互模式，用 `/model` 选择默认模型后再重试。',
  ].join(' ');
}

/** 默认 AGY 适配器配置（对齐 EAC DEFAULT_CONFIGS） */
export const DEFAULT_AGY_ADAPTER_CONFIG: CliAdapterConfig = {
  kind: 'agy',
  binary: 'agy',
  description: 'Antigravity CLI — agentic coding & browser automation',
  defaultTimeoutMs: 120_000,
};

export function createAgyAdapter(overrides?: Partial<CliAdapterConfig>): CliAdapter {
  const config: CliAdapterConfig = { ...DEFAULT_AGY_ADAPTER_CONFIG, ...overrides };
  return {
    config,
    isAvailable(pathEnv?: string): boolean {
      return binaryInPath(config.binary, pathEnv);
    },
    buildSpawnArgs(options?: CliSpawnOptions): string[] {
      // agy --print [--conversation ID] [--model label] [--print-timeout S] [prompt]
      const args = ['--print'];
      if (options?.resumeSessionId) args.push('--conversation', options.resumeSessionId);
      if (options?.model) args.push('--model', options.model);
      if (options?.timeoutMs != null) {
        args.push('--print-timeout', String(Math.max(1, Math.round(options.timeoutMs / 1000))));
      }
      if (options?.prompt) args.push(options.prompt);
      if (options?.extraArgs) args.push(...options.extraArgs);
      return args;
    },
    // print 模式无流式事件：解析器恒空（事件由 parsePlainText 分类消费）
    createParser(): CliEventParser {
      return {
        transform(): CliEvent | null {
          return null;
        },
      };
    },
    parsePlainText(stdout: string, stderr?: string): CliPlainTextResult {
      return classifyAgyPlainText(stderr !== undefined ? { stdout, stderr } : { stdout });
    },
  };
}
