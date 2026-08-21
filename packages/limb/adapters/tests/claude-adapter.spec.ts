/**
 * claude-adapter — T6.6 Claude Code stream-json 事件解析契约验证。
 *
 * 覆盖：stream_event 增量（message_start/delta/stop、text_delta、thinking 缓冲）、
 * system/init、compact_boundary、assistant 快照（增量去重 / <synthetic> 错误 /
 * thinking-only 兜底）、rate_limit、result/error 分类与 subtype 兜底、usage 归一化、
 * buildSpawnArgs / isAvailable / createParser 有状态性。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createClaudeAdapter,
  createClaudeStreamState,
  extractClaudeUsage,
  isClaudeResultErrorEvent,
  transformClaudeEvent,
} from '../src/claude-adapter.js';

let tmpDir: string | undefined;

async function makeTempDir(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), 'limb-adapters-'));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('transformClaudeEvent — stream_event 增量', () => {
  it('message_start 记录 currentMessageId 与 lastTurnInputTokens，不产出事件', () => {
    const state = createClaudeStreamState();
    const out = transformClaudeEvent(
      {
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: {
            id: 'msg_1',
            usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 },
          },
        },
      },
      state,
    );
    expect(out).toBeNull();
    expect(state.currentMessageId).toBe('msg_1');
    expect(state.lastTurnInputTokens).toBe(125);
  });

  it('message_delta 在 message_start 无 usage 时补全 lastTurnInputTokens', () => {
    const state = createClaudeStreamState();
    transformClaudeEvent({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } }, state);
    const out = transformClaudeEvent(
      { type: 'stream_event', event: { type: 'message_delta', usage: { input_tokens: 50 } } },
      state,
    );
    expect(out).toBeNull();
    expect(state.lastTurnInputTokens).toBe(50);
  });

  it('message_stop 产出 agent_loop 遥测标记并清空 currentMessageId', () => {
    const state = createClaudeStreamState();
    state.currentMessageId = 'msg_1';
    const out = transformClaudeEvent(
      { type: 'stream_event', event: { type: 'message_stop' } },
      state,
    );
    expect(out).toEqual({ type: 'agent_loop', timestamp: expect.any(Number) });
    expect(state.currentMessageId).toBeUndefined();
  });

  it('text_delta 产出 text 增量并登记 partialTextMessageIds', () => {
    const state = createClaudeStreamState();
    state.currentMessageId = 'msg_1';
    const out = transformClaudeEvent(
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } } },
      state,
    );
    expect(out).toEqual({ type: 'text', content: 'hello', timestamp: expect.any(Number) });
    expect(state.partialTextMessageIds.has('msg_1')).toBe(true);
  });

  it('thinking_delta 累积到 content_block_stop 产出 system_info(thinking)', () => {
    const state = createClaudeStreamState();
    transformClaudeEvent(
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } },
      state,
    );
    transformClaudeEvent(
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'let me ' } } },
      state,
    );
    transformClaudeEvent(
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'think' } } },
      state,
    );
    const out = transformClaudeEvent(
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      state,
    );
    expect(out).toEqual({
      type: 'system_info',
      content: JSON.stringify({ type: 'thinking', text: 'let me think' }),
      timestamp: expect.any(Number),
    });
    expect(state.thinkingBuffer).toBe('');
  });

  it('signature_delta / 未知 stream 事件跳过', () => {
    const state = createClaudeStreamState();
    expect(
      transformClaudeEvent({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'sig' } } }, state),
    ).toBeNull();
    expect(transformClaudeEvent({ type: 'stream_event', event: { type: 'ping' } }, state)).toBeNull();
  });
});

describe('transformClaudeEvent — system / assistant / result', () => {
  it('system/init → session_init', () => {
    const state = createClaudeStreamState();
    const out = transformClaudeEvent({ type: 'system', subtype: 'init', session_id: 'sess-1' }, state);
    expect(out).toEqual({ type: 'session_init', sessionId: 'sess-1', timestamp: expect.any(Number) });
  });

  it('system/compact_boundary → system_info', () => {
    const state = createClaudeStreamState();
    const out = transformClaudeEvent({ type: 'system', subtype: 'compact_boundary', pre_tokens: 1234 }, state);
    expect(out).toEqual({
      type: 'system_info',
      content: JSON.stringify({ type: 'compact_boundary', preTokens: 1234 }),
      timestamp: expect.any(Number),
    });
  });

  it('assistant 快照（新消息）产出 text + tool_use 数组', () => {
    const state = createClaudeStreamState();
    const out = transformClaudeEvent(
      {
        type: 'assistant',
        message: {
          id: 'msg_2',
          content: [
            { type: 'text', text: 'final answer' },
            { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'toolu_1' },
          ],
        },
      },
      state,
    );
    expect(out).toEqual([
      { type: 'text', content: 'final answer', timestamp: expect.any(Number) },
      {
        type: 'tool_use',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        toolUseId: 'toolu_1',
        timestamp: expect.any(Number),
      },
    ]);
  });

  it('assistant 快照去重：增量已发过的消息 id 跳过 text 但仍发 tool_use', () => {
    const state = createClaudeStreamState();
    state.partialTextMessageIds.add('msg_1');
    const out = transformClaudeEvent(
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [
            { type: 'text', text: 'already streamed' },
            { type: 'tool_use', name: 'Read', input: { path: '/x' } },
          ],
        },
      },
      state,
    );
    expect(out).toEqual([{ type: 'tool_use', toolName: 'Read', toolInput: { path: '/x' }, timestamp: expect.any(Number) }]);
    // 快照带文本 → 释放去重标记
    expect(state.partialTextMessageIds.has('msg_1')).toBe(false);
  });

  it('assistant <synthetic> API Error → error（transient）', () => {
    const state = createClaudeStreamState();
    const out = transformClaudeEvent(
      {
        type: 'assistant',
        message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error: 429 rate limit' }] },
      },
      state,
    );
    expect(out).toEqual({
      type: 'error',
      error: 'API Error: 429 rate limit',
      errorDisposition: 'transient',
      timestamp: expect.any(Number),
    });
  });

  it('assistant thinking-only 快照兜底 → system_info(thinking)', () => {
    const state = createClaudeStreamState();
    const out = transformClaudeEvent(
      {
        type: 'assistant',
        message: { id: 'msg_3', content: [{ type: 'thinking', thinking: 'hmm' }] },
      },
      state,
    );
    expect(out).toEqual({
      type: 'system_info',
      content: JSON.stringify({ type: 'thinking', text: 'hmm' }),
      timestamp: expect.any(Number),
    });
  });

  it('rate_limit_event → system_info', () => {
    const state = createClaudeStreamState();
    const out = transformClaudeEvent({ type: 'rate_limit_event', utilization: 0.9, resets_at: '12:00' }, state);
    expect(out).toEqual({
      type: 'system_info',
      content: JSON.stringify({ type: 'rate_limit', utilization: 0.9, resetsAt: '12:00' }),
      timestamp: expect.any(Number),
    });
  });

  it('result/error 用 errors 数组 + content 携带 subtype 元数据', () => {
    const state = createClaudeStreamState();
    const out = transformClaudeEvent(
      { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] },
      state,
    );
    expect(out).toEqual({
      type: 'error',
      error: 'boom',
      content: JSON.stringify({ errorSubtype: 'error_during_execution', isError: true }),
      timestamp: expect.any(Number),
    });
  });

  it('result/error 空 errors 时用 subtype 标签兜底', () => {
    const state = createClaudeStreamState();
    const out = transformClaudeEvent({ type: 'result', subtype: 'error_max_turns', is_error: true }, state);
    expect(out).toEqual({
      type: 'error',
      error: 'Max turns exceeded',
      content: JSON.stringify({ errorSubtype: 'error_max_turns', isError: true }),
      timestamp: expect.any(Number),
    });
  });

  it('result/success → null 并清理增量去重状态', () => {
    const state = createClaudeStreamState();
    state.partialTextMessageIds.add('msg_1');
    expect(transformClaudeEvent({ type: 'result', subtype: 'success' }, state)).toBeNull();
    expect(state.partialTextMessageIds.size).toBe(0);
  });
});

describe('extractClaudeUsage / isClaudeResultErrorEvent', () => {
  it('归一化 input + cache_read + cache_creation + contextWindow', () => {
    const usage = extractClaudeUsage({
      usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 30 },
      total_cost_usd: 0.001,
      duration_ms: 1000,
      num_turns: 2,
      modelUsage: { claude: { contextWindow: 200000 } },
    });
    expect(usage).toEqual({
      inputTokens: 125,
      lastTurnInputTokens: 125,
      outputTokens: 30,
      cacheReadTokens: 20,
      cacheCreationTokens: 5,
      costUsd: 0.001,
      durationMs: 1000,
      numTurns: 2,
      contextWindowSize: 200000,
    });
  });

  it('model_usage 下划线版本兼容', () => {
    const usage = extractClaudeUsage({ model_usage: { m: { context_window: 128000 } } });
    expect(usage.contextWindowSize).toBe(128000);
  });

  it('isClaudeResultErrorEvent 识别 is_error / 非 success subtype', () => {
    expect(isClaudeResultErrorEvent({ type: 'result', is_error: true })).toBe(true);
    expect(isClaudeResultErrorEvent({ type: 'result', subtype: 'error_during_execution' })).toBe(true);
    expect(isClaudeResultErrorEvent({ type: 'result', subtype: 'success' })).toBe(false);
    expect(isClaudeResultErrorEvent({ type: 'ping' })).toBe(false);
  });
});

describe('createClaudeAdapter', () => {
  it('默认配置对齐 EAC（binary=claude / 120s 超时）', () => {
    const adapter = createClaudeAdapter();
    expect(adapter.config).toMatchObject({
      kind: 'claude',
      binary: 'claude',
      description: 'Anthropic Claude Code — coding & code review',
      defaultTimeoutMs: 120_000,
    });
  });

  it('buildSpawnArgs 组装 -p/--resume/--output-format/增量/verbose/prompt', () => {
    const adapter = createClaudeAdapter();
    expect(adapter.buildSpawnArgs({ prompt: 'hi', resumeSessionId: 'sess-1' })).toEqual([
      '-p',
      '--resume', 'sess-1',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      'hi',
    ]);
    expect(adapter.buildSpawnArgs()).toEqual(['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose']);
  });

  it('overrides 合并生效', () => {
    const adapter = createClaudeAdapter({ binary: 'claude-custom', defaultTimeoutMs: 60_000 });
    expect(adapter.config.binary).toBe('claude-custom');
    expect(adapter.config.defaultTimeoutMs).toBe(60_000);
  });

  it('isAvailable 基于注入 PATH 探测二进制', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
    const adapter = createClaudeAdapter();
    expect(adapter.isAvailable(dir)).toBe(true);
    expect(adapter.isAvailable(join(tmpdir(), 'no-such-dir'))).toBe(false);
  });

  it('createParser 为有状态解析器：两次 transform 共享状态', () => {
    const adapter = createClaudeAdapter();
    const parser = adapter.createParser();
    parser.transform({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_x' } } });
    expect(parser.transform({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } })).toEqual({
      type: 'text',
      content: 'x',
      timestamp: expect.any(Number),
    });
  });
});
