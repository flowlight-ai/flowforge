/**
 * gemini-adapter — T6.6 Gemini CLI `-o stream-json` 事件解析契约验证。
 *
 * 覆盖：init → session_init、message(assistant) → text、tool_use、result 错误分类、
 * 已知 candidates 崩溃标记、extractGeminiErrorMessage、buildSpawnArgs / isAvailable。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createGeminiAdapter,
  extractGeminiErrorMessage,
  isGeminiResultErrorEvent,
  isKnownGeminiCandidatesCrash,
  transformGeminiEvent,
} from '../src/gemini-adapter.js';

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

describe('transformGeminiEvent', () => {
  it('init → session_init', () => {
    expect(transformGeminiEvent({ type: 'init', session_id: 'sess-1' })).toEqual({
      type: 'session_init',
      sessionId: 'sess-1',
      timestamp: expect.any(Number),
    });
  });

  it('init 无 session_id → null', () => {
    expect(transformGeminiEvent({ type: 'init' })).toBeNull();
  });

  it('message role=assistant → text', () => {
    expect(transformGeminiEvent({ type: 'message', role: 'assistant', content: 'hi' })).toEqual({
      type: 'text',
      content: 'hi',
      timestamp: expect.any(Number),
    });
  });

  it('message role=user / content 非字符串 → null', () => {
    expect(transformGeminiEvent({ type: 'message', role: 'user', content: 'hi' })).toBeNull();
    expect(transformGeminiEvent({ type: 'message', role: 'assistant', content: 42 })).toBeNull();
  });

  it('tool_use → tool_use（含 parameters）', () => {
    expect(transformGeminiEvent({ type: 'tool_use', tool_name: 'Bash', parameters: { cmd: 'ls' } })).toEqual({
      type: 'tool_use',
      toolName: 'Bash',
      toolInput: { cmd: 'ls' },
      timestamp: expect.any(Number),
    });
  });

  it('result/success → null（成功终止事件跳过）', () => {
    expect(transformGeminiEvent({ type: 'result', status: 'success' })).toBeNull();
  });

  it('result 非 success（string error）→ error', () => {
    expect(transformGeminiEvent({ type: 'result', status: 'error', error: 'boom' })).toEqual({
      type: 'error',
      error: 'boom',
      timestamp: expect.any(Number),
    });
  });

  it('result 非 success（object error.message）→ error', () => {
    expect(transformGeminiEvent({ type: 'result', status: 'error', error: { message: 'nested boom' } })).toEqual({
      type: 'error',
      error: 'nested boom',
      timestamp: expect.any(Number),
    });
  });

  it('result 非 success 但无 message → null（交 exit 诊断兜底）', () => {
    expect(transformGeminiEvent({ type: 'result', status: 'error' })).toBeNull();
    expect(transformGeminiEvent({ type: 'result', status: 'error', error: { code: 5 } })).toBeNull();
  });

  it('非对象输入跳过', () => {
    expect(transformGeminiEvent(null)).toBeNull();
    expect(transformGeminiEvent('raw')).toBeNull();
  });
});

describe('gemini 辅助判定', () => {
  it('isGeminiResultErrorEvent', () => {
    expect(isGeminiResultErrorEvent({ type: 'result', status: 'error' })).toBe(true);
    expect(isGeminiResultErrorEvent({ type: 'result', status: 'success' })).toBe(false);
    expect(isGeminiResultErrorEvent({ type: 'message' })).toBe(false);
  });

  it('extractGeminiErrorMessage 兼容 string / object.message / 空白', () => {
    expect(extractGeminiErrorMessage('  boom  ')).toBe('boom');
    expect(extractGeminiErrorMessage({ message: 'obj boom' })).toBe('obj boom');
    expect(extractGeminiErrorMessage({ code: 5 })).toBeNull();
    expect(extractGeminiErrorMessage('   ')).toBeNull();
    expect(extractGeminiErrorMessage(42)).toBeNull();
  });

  it('isKnownGeminiCandidatesCrash 识别 candidates 崩溃文本', () => {
    const crash = { type: 'result', status: 'error', error: "Cannot read properties of undefined (reading 'candidates')" };
    expect(isKnownGeminiCandidatesCrash(crash)).toBe(true);
    expect(isKnownGeminiCandidatesCrash({ type: 'result', status: 'error', error: 'other' })).toBe(false);
    expect(isKnownGeminiCandidatesCrash({ type: 'result', status: 'success' })).toBe(false);
  });
});

describe('createGeminiAdapter', () => {
  it('默认配置对齐 EAC', () => {
    const adapter = createGeminiAdapter();
    expect(adapter.config).toMatchObject({ kind: 'gemini', binary: 'gemini', defaultTimeoutMs: 120_000 });
  });

  it('buildSpawnArgs 组装 [--resume ID] [-m model] -p prompt -o stream-json', () => {
    const adapter = createGeminiAdapter();
    expect(adapter.buildSpawnArgs({ prompt: 'hi', model: 'gemini-2.5-pro' })).toEqual([
      '-m', 'gemini-2.5-pro',
      '-p', 'hi',
      '-o', 'stream-json',
    ]);
    expect(adapter.buildSpawnArgs({ prompt: 'hi', resumeSessionId: 'sess-1' })).toEqual([
      '--resume', 'sess-1',
      '-p', 'hi',
      '-o', 'stream-json',
    ]);
    expect(adapter.buildSpawnArgs()).toEqual(['-p', '-o', 'stream-json']);
  });

  it('isAvailable 基于注入 PATH 探测二进制', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'gemini'), '#!/bin/sh\n', { mode: 0o755 });
    const adapter = createGeminiAdapter();
    expect(adapter.isAvailable(dir)).toBe(true);
    expect(adapter.isAvailable(join(tmpdir(), 'no-such-dir'))).toBe(false);
  });

  it('createParser 直接透传 transformGeminiEvent', () => {
    const adapter = createGeminiAdapter();
    const parser = adapter.createParser();
    expect(parser.transform({ type: 'init', session_id: 's' })).toEqual({
      type: 'session_init',
      sessionId: 's',
      timestamp: expect.any(Number),
    });
  });
});
