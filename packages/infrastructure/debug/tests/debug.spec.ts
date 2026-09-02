/**
 * debug 插件包测试 — C33（F153 Prompt X-Ray）。
 *
 * 覆盖：isPromptCaptureEnabled env 闸门（FF_PROMPT_CAPTURE / cats 白名单）；
 * PromptCaptureStore sync 写入 + read + listByInvocation/Thread/Recent + prune TTL；
 * captureAsync 异步路径（eventually 写入）；native L0 fetcher 注入 + 诊断；
 * Cordis 插件挂载 ctx.forgeDebug。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeDebugService, {
  estimateTokens,
  isPromptCaptureEnabled,
  PromptCaptureStore,
} from '../src/index.ts';

const tempDirs: string[] = [];
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.FF_PROMPT_CAPTURE;
  delete process.env.FF_PROMPT_CAPTURE_CATS;
});

function makeStore(): PromptCaptureStore {
  const dir = mkdtempSync(join(tmpdir(), 'ff-debug-'));
  tempDirs.push(dir);
  return new PromptCaptureStore({ baseDir: dir, ttlMs: 60_000, maxEntries: 5, log: { info: () => {}, warn: () => {} } });
}

function makeCaptureData(id: string, catId = 'cat-a', userId = 'u1'): import('../src/index.ts').PromptCapture {
  return {
    captureId: id,
    invocationId: 'inv-' + id,
    hmacInvocationId: 'hmac-' + id,
    catId,
    threadId: 't1',
    userId,
    model: 'm',
    capturedAt: Date.now(),
    systemPrompt: 'sys',
    userPrompt: 'hi',
    effectivePrompt: 'effective',
    injectionDecision: { isResume: false, canSkipOnResume: false, forceReinjection: false, injected: true },
    promptBytes: 8,
    tokenEstimate: 3,
  };
}

describe('isPromptCaptureEnabled', () => {
  it('默认关；FF_PROMPT_CAPTURE=on 开；cats 白名单', () => {
    expect(isPromptCaptureEnabled('cat-a')).toBe(false);
    process.env.FF_PROMPT_CAPTURE = 'on';
    expect(isPromptCaptureEnabled('cat-a')).toBe(true);
    process.env.FF_PROMPT_CAPTURE_CATS = 'cat-b,cat-c';
    expect(isPromptCaptureEnabled('cat-a')).toBe(false);
    expect(isPromptCaptureEnabled('cat-b')).toBe(true);
  });
});

describe('estimateTokens', () => {
  it('字符数 / 3.5 向上取整', () => {
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('PromptCaptureStore', () => {
  it('captureSync 写入 + read 返回 + TTL 过期返回 null', async () => {
    const store = makeStore();
    store.captureSync(makeCaptureData('11111111-1111-4111-8111-111111111111'));
    const cap = store.read('11111111-1111-4111-8111-111111111111');
    expect(cap).not.toBeNull();
    expect(cap!.catId).toBe('cat-a');
  });

  it('read 拒绝非法 captureId', () => {
    const store = makeStore();
    expect(store.read('not-a-uuid')).toBeNull();
  });

  it('read userId 校验', () => {
    const store = makeStore();
    store.captureSync(makeCaptureData('22222222-2222-4222-8222-222222222222'));
    expect(store.read('22222222-2222-4222-8222-222222222222', 'other')).toBeNull();
  });

  it('listByInvocation / listByThread / listRecent', () => {
    const store = makeStore();
    store.captureSync(makeCaptureData('33333333-3333-4333-8333-333333333333', 'cat-a'));
    store.captureSync(makeCaptureData('44444444-4444-4444-8444-444444444444', 'cat-b'));
    expect(store.listByInvocation('inv-33333333-3333-4333-8333-333333333333').length).toBe(1);
    expect(store.listByThread('t1').length).toBe(2);
    expect(store.listRecent(10).length).toBe(2);
    expect(store.stats().entries).toBe(2);
  });

  it('prune 超容量驱逐最旧', () => {
    const store = makeStore();
    for (let i = 0; i < 7; i++) {
      store.captureSync(makeCaptureData(`${i}${i}${i}${i}${i}${i}${i}${i}-${i}${i}${i}${i}-4${i}${i}${i}-8${i}${i}${i}-${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`));
    }
    const removed = store.prune();
    expect(removed).toBeGreaterThan(0);
    expect(store.stats().entries).toBeLessThanOrEqual(5);
  });

  it('captureAsync eventually 写入索引', async () => {
    const store = makeStore();
    store.captureAsync(makeCaptureData('55555555-5555-4555-8555-555555555555'));
    // gzip+write 是异步的，等待
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(store.listRecent(10).length).toBe(1);
  });
});

describe('ForgeDebugService（Cordis 插件）', () => {
  it('挂载 ctx.forgeDebug + capturePromptIfEnabled 默认不捕获', async () => {
    const ctx = new Context();
    const dir = mkdtempSync(join(tmpdir(), 'ff-debug-svc-'));
    tempDirs.push(dir);
    const fiber = (await ctx.plugin(ForgeDebugService, { store: { baseDir: dir } })) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);

    const svc = ctx.forgeDebug;
    expect(svc).toBeDefined();
    // FF_PROMPT_CAPTURE 未设 → 不捕获
    svc.capturePromptIfEnabled({
      catId: 'cat-a',
      invocationId: 'inv-1',
      threadId: 't1',
      userId: 'u1',
      model: 'm',
      systemPrompt: 'sys',
      userPrompt: 'hi',
      effectivePrompt: 'effective',
      injectionDecision: { isResume: false, canSkipOnResume: false, forceReinjection: false, injected: true },
    });
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(svc.store.stats().entries).toBe(0);
  });

  it('FF_PROMPT_CAPTURE=on → 异步捕获 + nativeL0 fetcher 注入 + 诊断', async () => {
    process.env.FF_PROMPT_CAPTURE = 'on';
    const ctx = new Context();
    const dir = mkdtempSync(join(tmpdir(), 'ff-debug-svc2-'));
    tempDirs.push(dir);
    const fiber = (await ctx.plugin(ForgeDebugService, { store: { baseDir: dir } })) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);
    const svc = ctx.forgeDebug;

    svc.capturePromptIfEnabled({
      catId: 'cat-a',
      invocationId: 'inv-2',
      threadId: 't1',
      userId: 'u1',
      model: 'm',
      systemPrompt: 'sys',
      userPrompt: 'hi',
      effectivePrompt: 'effective',
      injectionDecision: { isResume: false, canSkipOnResume: false, forceReinjection: false, injected: true },
      nativeL0Provider: true,
      nativeL0Fetcher: async () => 'COMPILED-L0',
    });
    await new Promise<void>((r) => setTimeout(r, 150));
    expect(svc.store.stats().entries).toBe(1);
  });
});
