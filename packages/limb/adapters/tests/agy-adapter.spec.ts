/**
 * agy-adapter — T6.6 AGY `--print` plain text 分类契约验证。
 *
 * 覆盖：classifyAgyPlainText 四错误（timeout / missing_session / auth_required /
 * missing_model）+ text / empty / resumed 轨迹替换（F210 H2b fail-open）、
 * conversation id 与模型 label 提取、buildSpawnArgs / parsePlainText / isAvailable。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyAgyPlainText,
  createAgyAdapter,
  extractAgyCliConversationId,
  extractAgyCliSelectedModelLabel,
} from '../src/agy-adapter.js';

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

describe('classifyAgyPlainText — 文本与空', () => {
  it('普通 stdout → text（trim）', () => {
    expect(classifyAgyPlainText({ stdout: '  hello world\n' })).toEqual({ kind: 'text', content: 'hello world' });
  });

  it('空 stdout / stderr → empty', () => {
    expect(classifyAgyPlainText({ stdout: '  ' })).toEqual({ kind: 'empty' });
  });

  it('剥离 fresh conversation warning 前缀', () => {
    expect(
      classifyAgyPlainText({ stdout: 'Warning: conversation "agy-123" not found.\nreply text' }),
    ).toEqual({ kind: 'text', content: 'reply text' });
  });

  it('resumed + 空 stdout + resumedFinalText → text(replace)', () => {
    expect(
      classifyAgyPlainText({ stdout: '', resumed: true, resumedFinalText: 'final from trajectory' }),
    ).toEqual({ kind: 'text', content: 'final from trajectory', textMode: 'replace' });
  });

  it('resumed + stdout + resumedFinalText → final 替换 stdout 重放', () => {
    expect(
      classifyAgyPlainText({ stdout: '[1] old replay [2]', resumed: true, resumedFinalText: '本轮 final' }),
    ).toEqual({ kind: 'text', content: '本轮 final', textMode: 'replace' });
  });

  it('resumed + stdout 无 final → fail-open 保留 stdout', () => {
    expect(
      classifyAgyPlainText({ stdout: 'plain replay', resumed: true, resumedFinalText: '   ' }),
    ).toEqual({ kind: 'text', content: 'plain replay', textMode: 'replace' });
  });
});

describe('classifyAgyPlainText — 错误分类', () => {
  it('timeout 文本 → error(timeout)', () => {
    expect(classifyAgyPlainText({ stdout: 'Error: timed out waiting for response.' })).toMatchObject({
      kind: 'error',
      errorKind: 'timeout',
    });
  });

  it('auth prompt + OAuth URL → auth_required', () => {
    expect(
      classifyAgyPlainText({
        stdout: 'Authentication required. Please visit the URL to log in:\nhttps://accounts.google.com/o/oauth2/auth/...',
      }),
    ).toMatchObject({ kind: 'error', errorKind: 'auth_required' });
  });

  it('auth prompt + wait + interrupted → auth_required', () => {
    expect(
      classifyAgyPlainText({
        stdout: [
          'Authentication required. Please visit the URL to log in:',
          'Waiting for authentication (timeout 300s)...',
          'Error: authentication interrupted.',
        ].join('\n'),
      }),
    ).toMatchObject({ kind: 'error', errorKind: 'auth_required' });
  });

  it('auth prompt 无 URL/wait → 不误判', () => {
    expect(classifyAgyPlainText({ stdout: 'Authentication required. Please visit the URL to log in:' })).toEqual({
      kind: 'text',
      content: 'Authentication required. Please visit the URL to log in:',
    });
  });

  it('missing_model（neither PlanModel）→ error(missing_model)', () => {
    expect(
      classifyAgyPlainText({ stdout: 'Error: failed to construct executor: neither PlanModel nor RequestedModel specified' }),
    ).toMatchObject({ kind: 'error', errorKind: 'missing_model' });
  });

  it('missing_model（/model 提示）→ error(missing_model)', () => {
    expect(
      classifyAgyPlainText({ stdout: 'E... no default model. Please use the /model command to select one.' }),
    ).toMatchObject({ kind: 'error', errorKind: 'missing_model' });
  });

  it('resumed + conversation not found → missing_session（优先于其他分类）', () => {
    expect(
      classifyAgyPlainText({
        stdout: 'Warning: conversation "agy-123" not found.\nError: timed out waiting for response.',
        resumed: true,
      }),
    ).toEqual({
      kind: 'error',
      errorKind: 'missing_session',
      error: 'No conversation found with session ID: agy-123',
    });
  });

  it('resumed + 日志行 not found → missing_session（agyLogText 兜底）', () => {
    expect(
      classifyAgyPlainText({ stdout: '', resumed: true, agyLogText: 'Conversation 456 not found, ignoring --conversation flag' }),
    ).toMatchObject({ kind: 'error', errorKind: 'missing_session' });
  });

  it('非 resumed 时不判 missing_session（warning 行剥离后为空 → empty）', () => {
    expect(classifyAgyPlainText({ stdout: 'Warning: conversation "agy-123" not found.\n' })).toEqual({ kind: 'empty' });
  });
});

describe('extractAgyCliConversationId / SelectedModelLabel', () => {
  it('提取 conversation UUID（多个取最后）', () => {
    const log =
      'Created conversation 11111111-1111-1111-1111-111111111111\n' +
      'Print mode: conversation=22222222-2222-2222-2222-222222222222\n';
    expect(extractAgyCliConversationId(log)).toBe('22222222-2222-2222-2222-222222222222');
    expect(extractAgyCliConversationId('no id here')).toBeNull();
  });

  it('提取选中模型 label', () => {
    const log = 'Propagating selected model override to backend: label="antigravity-2.5-mini"';
    expect(extractAgyCliSelectedModelLabel(log)).toBe('antigravity-2.5-mini');
    expect(extractAgyCliSelectedModelLabel('nothing')).toBeNull();
  });
});

describe('createAgyAdapter', () => {
  it('默认配置对齐 EAC', () => {
    const adapter = createAgyAdapter();
    expect(adapter.config).toMatchObject({ kind: 'agy', binary: 'agy', defaultTimeoutMs: 120_000 });
  });

  it('buildSpawnArgs 组装 --print [--conversation] [--model] [--print-timeout] [prompt]', () => {
    const adapter = createAgyAdapter();
    expect(adapter.buildSpawnArgs({ prompt: 'hi' })).toEqual(['--print', 'hi']);
    expect(adapter.buildSpawnArgs({ prompt: 'hi', resumeSessionId: 'sess-1', model: 'm1', timeoutMs: 90_000 })).toEqual([
      '--print', '--conversation', 'sess-1', '--model', 'm1', '--print-timeout', '90', 'hi',
    ]);
  });

  it('createParser 恒空（print 模式无流式事件）', () => {
    const adapter = createAgyAdapter();
    expect(adapter.createParser().transform({ type: 'whatever' })).toBeNull();
  });

  it('parsePlainText 委托 classifyAgyPlainText（简化输入）', () => {
    const adapter = createAgyAdapter();
    expect(adapter.parsePlainText?.('Error: timed out waiting for response.')).toMatchObject({
      kind: 'error',
      errorKind: 'timeout',
    });
    expect(adapter.parsePlainText?.('reply')).toEqual({ kind: 'text', content: 'reply' });
  });

  it('isAvailable 基于注入 PATH 探测二进制', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'agy'), '#!/bin/sh\n', { mode: 0o755 });
    const adapter = createAgyAdapter();
    expect(adapter.isAvailable(dir)).toBe(true);
    expect(adapter.isAvailable(join(tmpdir(), 'no-such-dir'))).toBe(false);
  });
});
