/**
 * F212 诊断体系单元测试 — T6.5 cli/cli-diagnostics.ts
 * 覆盖（对齐 clowder-ai cli-diagnostics.test.js 断言语义）：
 * - classifyCliError：16 reasonCode 命中 / 空文本 / 未知文本
 * - known reasonCode → 人类化文案 + whitelist safeExcerpt（excerptSource='classifier'）
 * - unknown_raw：#857 消毒 + 非 HOME 绝对路径 redact + stderrEmpty 分派 hint
 * - AC-A6：panic headline 进 publicSummary、stack frame 从 safeExcerpt 剥离
 * - terminalContext：cli_response_timeout / cli_stall_timeout 因果快照
 * - cc_structured：Claude CLI result error 安全源准入
 * - formatCliStderrForLog：LOG_CLI_STDERR=1 env gate
 * - buildCliExitDiagnostic（AC-F1，cwd 刻意 omit）
 * - buildSilentCompletionDiagnostic（Phase G：sessionId 截 8 字符 + 证据 JSON）
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCliDiagnostics,
  buildCliExitDiagnostic,
  buildSilentCompletionDiagnostic,
  classifyCliError,
  formatCliStderrForLog,
} from '../src/cli/cli-diagnostics.js';
import type { CliErrorReasonCode } from '../src/types.js';

const DEBUG_REF = { command: 'codex', exitCode: 1, signal: null };

function collectDiagnostics(rawText: string, extra: Record<string, unknown> = {}) {
  return buildCliDiagnostics({ rawText, debugRef: DEBUG_REF, ...extra });
}

describe('classifyCliError', () => {
  it('空文本 / 未知文本返回 undefined', () => {
    expect(classifyCliError('')).toBeUndefined();
    expect(classifyCliError('   ')).toBeUndefined();
    expect(classifyCliError('some totally random output')).toBeUndefined();
  });

  it.each([
    ['invalid_thinking_signature', 'Invalid signature in thinking block'],
    ['missing_rollout', 'error: no rollout found'],
    ['session_not_found', 'Session not found'],
    ['upstream_policy_reject', 'flagged for possible cybersecurity risk'],
    ['model_not_found', 'Unknown model "gpt-99"'],
    ['auth_failed', '401 Unauthorized'],
    ['server_overloaded', '529 Overloaded — not your usage limit'],
    ['quota_exceeded', 'rate limit exceeded (429)'],
    ['network_error', 'fetch failed: ECONNREFUSED'],
    ['invalid_config', 'Error loading config.toml'],
    ['spawn_failed', 'spawn codex ENOENT'],
    ['context_window_exceeded', 'maximum context length exceeded'],
    ['tool_call_parse_failed', "The model's tool call could not be parsed"],
  ] satisfies Array<[CliErrorReasonCode, string]>)('识别 %s', (code, text) => {
    expect(classifyCliError(text)).toBe(code);
  });
});

describe('buildCliDiagnostics — known reasonCode (AC-A1)', () => {
  it('人类化 summary/hint + whitelist safeExcerpt（excerptSource=classifier）', () => {
    const d = collectDiagnostics('API key invalid: Unauthorized from provider', {});
    expect(d.reasonCode).toBe('auth_failed');
    expect(d.publicSummary).toContain('API 认证失败');
    expect(d.publicHint.length).toBeGreaterThan(0);
    expect(d.safeExcerpt).toContain('Unauthorized');
    expect(d.excerptSource).toBe('classifier');
    expect(d.debugRef).toEqual(DEBUG_REF);
  });

  it('safeExcerpt 从 classifier headline 行取窗口（headline + 上下文行）', () => {
    const text = ['line one', 'line two', 'error: Unauthorized', 'line four', 'line five'].join('\n');
    const d = collectDiagnostics(text, {});
    expect(d.reasonCode).toBe('auth_failed');
    expect(d.safeExcerpt).toContain('Unauthorized');
    expect(d.safeExcerpt).toContain('line four');
  });

  it('unknown_raw 关闭：safeExcerptRawText 提供时只从中取摘要', () => {
    const d = collectDiagnostics('Unhandled: Unauthorized at /srv/app', { safeExcerptRawText: 'other stream text' });
    // 分类仍走 rawText；但摘要源被限制 → requireClassifierMatch 失败 → 无 safeExcerpt
    expect(d.reasonCode).toBe('auth_failed');
    expect(d.safeExcerpt).toBeUndefined();
  });
});

describe('buildCliDiagnostics — unknown_raw (AC-A5 / #857)', () => {
  it('未知文本 → 未识别 summary + sanitized safeExcerpt', () => {
    const d = collectDiagnostics('weird output with token sk-abcdefghijklmnopqrstuvwxyz123456', {});
    expect(d.reasonCode).toBeUndefined();
    expect(d.publicSummary).toBe('未识别的 CLI 错误');
    expect(d.safeExcerpt).toContain('[TOKEN_REDACTED]');
    expect(d.safeExcerpt).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(d.excerptSource).toBe('unknown_raw');
  });

  it('非 HOME 绝对路径被 redact（Unix /srv 与 Windows D:\\work）', () => {
    const d = collectDiagnostics('failed at /srv/app/secrets/config.json on D:\\work\\repo\\main.ts', {});
    expect(d.safeExcerpt).not.toContain('/srv/app');
    expect(d.safeExcerpt).not.toContain('D:\\work');
    expect(d.safeExcerpt).toContain('[PATH_REDACTED]');
  });

  it('stderrEmpty=true → 空 stderr 诚实 hint；false → env-summary hint', () => {
    const empty = collectDiagnostics('opaque failure', { stderrEmpty: true });
    expect(empty.publicHint).toContain('没有输出 stderr');
    const hasStderr = collectDiagnostics('opaque failure', { stderrEmpty: false });
    expect(hasStderr.publicHint).toContain('env-summary');
    expect(hasStderr.publicHint).not.toContain('LOG_CLI_STDERR');
  });

  it('safeExcerptRawText 提供且未知 → unknown_raw 保持关闭', () => {
    const d = collectDiagnostics('opaque failure', { safeExcerptRawText: 'restricted stream' });
    expect(d.safeExcerpt).toBeUndefined();
    expect(d.excerptSource).toBeUndefined();
  });
});

describe('buildCliDiagnostics — AC-A6 panic headline', () => {
  it('panic headline 优先进 publicSummary；stack frame 剥离', () => {
    const text = [
      'thread "main" panicked at src/tmux.rs:42:9:',
      'assertion failed',
      'stack backtrace:',
      '   0: rust_begin_unwind',
      '   1: flowforge::main',
    ].join('\n');
    const d = collectDiagnostics(text, {});
    expect(d.publicSummary).toContain('CLI panic —');
    expect(d.publicSummary).toContain('thread "main" panicked at');
    // 摘要中无 stack frame 行
    expect(d.publicSummary).not.toContain('rust_begin_unwind');
  });
});

describe('buildCliDiagnostics — cc_structured (AC-D3)', () => {
  it('unknown reasonCode + structured result error → Claude Code 报告分支', () => {
    const d = collectDiagnostics('some unrelated noise', {
      structuredErrorText: "The model's tool call could not be parsed",
    });
    expect(d.reasonCode).toBeUndefined();
    expect(d.publicSummary).toContain('Claude Code 报告');
    expect(d.publicSummary).toContain('tool call could not be parsed');
    expect(d.safeExcerpt).toContain('tool call could not be parsed');
    expect(d.excerptSource).toBe('cc_structured');
  });

  it('structuredErrorText 为空时回落 unknown_raw', () => {
    const d = collectDiagnostics('opaque failure', { structuredErrorText: '   ' });
    expect(d.publicSummary).toBe('未识别的 CLI 错误');
    expect(d.safeExcerpt).toContain('opaque failure');
  });
});

describe('buildCliDiagnostics — terminalContext 超时因果快照', () => {
  it('response_timeout：reasonCode + 配置/静默秒数 + debugRef 无 exitCode', () => {
    const d = buildCliDiagnostics({
      rawText: '',
      debugRef: { command: 'claude', signal: null },
      terminalContext: {
        kind: 'response_timeout',
        configuredTimeoutMs: 120_000,
        observedSilenceDurationMs: 130_000,
        processAliveAtTimeout: true,
        postKillExitCode: 137,
        postKillSignal: 'SIGKILL',
        signalsSent: ['SIGINT', 'SIGTERM'],
        finalStage: 'kill',
      },
    });
    expect(d.reasonCode).toBe('cli_response_timeout');
    expect(d.publicSummary).toContain('CLI 响应超时');
    expect(d.publicHint).toContain('配置阈值 120s');
    expect(d.publicHint).toContain('实际静默 130s');
    expect(d.debugRef.exitCode).toBeUndefined();
  });

  it('stall_timeout：kind 映射 cli_stall_timeout', () => {
    const d = buildCliDiagnostics({
      rawText: 'stale',
      debugRef: { command: 'codex', signal: null },
      terminalContext: {
        kind: 'stall_timeout',
        configuredTimeoutMs: 60_000,
        observedSilenceDurationMs: 61_000,
        processAliveAtTimeout: true,
        postKillExitCode: null,
        postKillSignal: 'SIGTERM',
        signalsSent: ['SIGINT'],
        finalStage: 'terminate',
      },
    });
    expect(d.reasonCode).toBe('cli_stall_timeout');
    expect(d.publicSummary).toContain('CLI 长时间无响应');
  });
});

describe('formatCliStderrForLog（AC-A7 / OQ-2 env gate）', () => {
  const ORIGINAL = process.env.LOG_CLI_STDERR;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LOG_CLI_STDERR;
    else process.env.LOG_CLI_STDERR = ORIGINAL;
  });

  it('LOG_CLI_STDERR 未设或非 1 → null（不写日志）', () => {
    delete process.env.LOG_CLI_STDERR;
    expect(formatCliStderrForLog('some stderr')).toBeNull();
    process.env.LOG_CLI_STDERR = '0';
    expect(formatCliStderrForLog('some stderr')).toBeNull();
  });

  it('LOG_CLI_STDERR=1 + 空 stderr → null', () => {
    process.env.LOG_CLI_STDERR = '1';
    expect(formatCliStderrForLog('   ')).toBeNull();
  });

  it('LOG_CLI_STDERR=1 + 有内容 → 消毒 + 尾 1000 字符', () => {
    process.env.LOG_CLI_STDERR = '1';
    const long = `${'x'.repeat(2000)} sk-abcdefghijklmnopqrstuvwxyz123456`;
    const out = formatCliStderrForLog(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(1000);
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });
});

describe('buildCliExitDiagnostic（AC-F1）', () => {
  it('字段齐全；cwd 刻意不存在；stderrEmpty 由长度计算', () => {
    const payload = buildCliExitDiagnostic({
      invocationId: 'inv-7',
      command: 'codex',
      exitCode: 1,
      signal: null,
      reasonCode: 'auth_failed',
      stderrLength: 0,
      streamErrorCount: 2,
    });
    expect(payload).toEqual({
      invocationId: 'inv-7',
      command: 'codex',
      exitCode: 1,
      signal: null,
      reasonCode: 'auth_failed',
      stderrEmpty: true,
      streamErrorCount: 2,
    });
    expect('cwd' in payload).toBe(false);
  });

  it('缺省字段：invocationId null / reasonCode null', () => {
    const payload = buildCliExitDiagnostic({
      command: 'claude',
      exitCode: 0,
      signal: null,
      stderrLength: 10,
      streamErrorCount: 0,
    });
    expect(payload.invocationId).toBeNull();
    expect(payload.reasonCode).toBeNull();
    expect(payload.stderrEmpty).toBe(false);
  });
});

describe('buildSilentCompletionDiagnostic（Phase G）', () => {
  it('sessionId 只暴露前 8 字符；eventTypes 排序去重；safeExcerpt 为 JSON 证据', () => {
    const d = buildSilentCompletionDiagnostic({
      command: 'opencode',
      invocationId: 'inv-9',
      eventCount: 3,
      eventTypes: ['step_start', 'step_start', 'message'],
      model: 'deepseek-chat',
      sessionId: 'abcdefghijklmnopqrstuvwxyz',
      exitCode: 0,
      stderrPresent: false,
    });
    expect(d.reasonCode).toBe('silent_completion');
    expect(d.publicSummary).toContain('无文字输出');
    expect(d.debugRef.exitCode).toBe(0);
    expect(d.excerptSource).toBe('cc_structured');
    const evidence = JSON.parse(d.safeExcerpt ?? '{}') as Record<string, unknown>;
    expect(evidence.eventCount).toBe(3);
    expect(evidence.eventTypes).toEqual(['message', 'step_start']);
    expect(evidence.sessionIdPrefix).toBe('abcdefgh');
    expect(evidence.sessionId).toBeUndefined();
  });

  it('大量 eventTypes 时截断并标记 eventTypesTruncated', () => {
    const types = Array.from({ length: 20 }, (_, i) => `type-${i}`);
    const d = buildSilentCompletionDiagnostic({
      command: 'codex',
      eventCount: 20,
      eventTypes: types,
      stderrPresent: true,
    });
    const evidence = JSON.parse(d.safeExcerpt ?? '{}') as Record<string, unknown>;
    expect((evidence.eventTypes as string[]).length).toBeLessThanOrEqual(10);
    expect(evidence.eventTypesTruncated).toBe(true);
  });

  it('stderrExcerpt 走消毒；exitCode 缺省 0', () => {
    const d = buildSilentCompletionDiagnostic({
      command: 'claude',
      eventCount: 1,
      eventTypes: ['init'],
      stderrPresent: true,
      stderrExcerpt: 'token sk-abcdefghijklmnopqrstuvwxyz123456 leaked',
    });
    expect(d.debugRef.exitCode).toBe(0);
    expect(d.safeExcerpt).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });
});
