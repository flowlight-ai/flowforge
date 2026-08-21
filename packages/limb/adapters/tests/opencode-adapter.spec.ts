/**
 * opencode-adapter — T6.6 opencode `run --format json` 事件解析契约验证。
 *
 * 覆盖：step_start、text（含 reasoning 型 part）、独立 reasoning、tool_use、
 * error、step_finish usage 归一化（input + cache.read + cache.write）、
 * buildSpawnArgs / isAvailable。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenCodeAdapter, transformOpenCodeEvent } from '../src/opencode-adapter.js';

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

describe('transformOpenCodeEvent', () => {
  it('step_start → session_init', () => {
    expect(transformOpenCodeEvent({ type: 'step_start', sessionID: 'sess-1' })).toEqual({
      type: 'session_init',
      sessionId: 'sess-1',
      timestamp: expect.any(Number),
    });
  });

  it('text → text', () => {
    expect(transformOpenCodeEvent({ type: 'text', part: { type: 'text', text: 'hello' } })).toEqual({
      type: 'text',
      content: 'hello',
      timestamp: expect.any(Number),
    });
  });

  it('text part.type=reasoning → system_info(thinking)', () => {
    expect(transformOpenCodeEvent({ type: 'text', part: { type: 'reasoning', text: 'hmm' } })).toEqual({
      type: 'system_info',
      content: JSON.stringify({ type: 'thinking', text: 'hmm' }),
      timestamp: expect.any(Number),
    });
  });

  it('独立 reasoning 事件 → system_info(thinking)', () => {
    expect(transformOpenCodeEvent({ type: 'reasoning', part: { text: 'deep thought' } })).toEqual({
      type: 'system_info',
      content: JSON.stringify({ type: 'thinking', text: 'deep thought' }),
      timestamp: expect.any(Number),
    });
  });

  it('空 text / reasoning → null', () => {
    expect(transformOpenCodeEvent({ type: 'text', part: { text: '' } })).toBeNull();
    expect(transformOpenCodeEvent({ type: 'reasoning', part: { text: '' } })).toBeNull();
  });

  it('tool_use → tool_use（callID → toolUseId）', () => {
    expect(
      transformOpenCodeEvent({
        type: 'tool_use',
        part: { tool: 'bash', callID: 'call-1', state: { input: { cmd: 'ls' } } },
      }),
    ).toEqual({
      type: 'tool_use',
      toolName: 'bash',
      toolInput: { cmd: 'ls' },
      toolUseId: 'call-1',
      timestamp: expect.any(Number),
    });
  });

  it('error → error（data.message 优先）', () => {
    expect(transformOpenCodeEvent({ type: 'error', error: { data: { message: 'boom' } } })).toEqual({
      type: 'error',
      error: 'boom',
      timestamp: expect.any(Number),
    });
    expect(transformOpenCodeEvent({ type: 'error', error: { name: 'EINVAL' } })).toEqual({
      type: 'error',
      error: 'EINVAL',
      timestamp: expect.any(Number),
    });
  });

  it('step_finish usage → agent_loop（input + cache.read + cache.write 归一化）', () => {
    expect(
      transformOpenCodeEvent({
        type: 'step_finish',
        part: {
          tokens: { input: 100, output: 30, total: 160, cache: { read: 20, write: 10 } },
          cost: 0.002,
        },
      }),
    ).toEqual({
      type: 'agent_loop',
      timestamp: expect.any(Number),
      metadata: {
        provider: 'opencode',
        model: '',
        usage: {
          inputTokens: 130,
          lastTurnInputTokens: 130,
          outputTokens: 30,
          totalTokens: 160,
          cacheReadTokens: 20,
          cacheCreationTokens: 10,
          costUsd: 0.002,
        },
      },
    });
  });

  it('step_finish 无遥测数据 → null（不产出空标记）', () => {
    expect(transformOpenCodeEvent({ type: 'step_finish', part: {} })).toBeNull();
  });

  it('未知事件 / 非对象 → null', () => {
    expect(transformOpenCodeEvent({ type: 'unknown' })).toBeNull();
    expect(transformOpenCodeEvent(null)).toBeNull();
    expect(transformOpenCodeEvent('raw')).toBeNull();
  });
});

describe('createOpenCodeAdapter', () => {
  it('默认配置对齐 EAC', () => {
    const adapter = createOpenCodeAdapter();
    expect(adapter.config).toMatchObject({ kind: 'opencode', binary: 'opencode', defaultTimeoutMs: 120_000 });
  });

  it('buildSpawnArgs 组装 run [--continue ID] [-m model] [prompt] --format json', () => {
    const adapter = createOpenCodeAdapter();
    expect(adapter.buildSpawnArgs({ prompt: 'hi' })).toEqual(['run', 'hi', '--format', 'json']);
    expect(adapter.buildSpawnArgs({ prompt: 'hi', resumeSessionId: 'sess-1', model: 'provider/m' })).toEqual([
      'run', '--continue', 'sess-1', '-m', 'provider/m', 'hi', '--format', 'json',
    ]);
  });

  it('isAvailable 基于注入 PATH 探测二进制', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'opencode'), '#!/bin/sh\n', { mode: 0o755 });
    const adapter = createOpenCodeAdapter();
    expect(adapter.isAvailable(dir)).toBe(true);
    expect(adapter.isAvailable(join(tmpdir(), 'no-such-dir'))).toBe(false);
  });

  it('createParser 直接透传 transformOpenCodeEvent', () => {
    const adapter = createOpenCodeAdapter();
    const parser = adapter.createParser();
    expect(parser.transform({ type: 'step_start', sessionID: 's' })).toEqual({
      type: 'session_init',
      sessionId: 's',
      timestamp: expect.any(Number),
    });
  });
});
