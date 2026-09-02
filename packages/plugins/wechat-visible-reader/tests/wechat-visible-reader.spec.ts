/**
 * wechat-visible-reader 插件测试 — C35（types 解析器 + arm-store + metrics + handlers + native-runner + Service）。
 *
 * 覆盖：parse* 四解析器（成功/失败/超限拒绝）；ArmStore TTL/过期/失效；
 * Metrics 窗口与 layoutPauseRecommended；handlers 授权门禁与参数校验；
 * native-runner 注入执行器（probe/read/navigation/recent + 安全失败回落）；
 * Cordis Service 挂载。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ForgeWeChatVisibleReaderService, {
  WeChatVisibleReaderArmStore,
  WeChatVisibleReaderMetrics,
  createWeChatVisibleReaderHandlers,
  createWeChatVisibleReaderNativeRunner,
  parseWeChatConversationRecentResult,
  parseWeChatNavigationSpikeResult,
  parseWeChatVisibleProbeResult,
  parseWeChatVisibleReadResult,
  type NativeCommandExecutor,
  type WeChatVisibleFailure,
  type WeChatVisibleReadResult,
  type VisibleMessageUnit,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

function successReadResult(): WeChatVisibleReadResult {
  return {
    ok: true,
    captureId: 'cap1',
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: { bundleId: 'com.tencent.xinWeChat', wechatVersion: '3.9.10', windowSize: { width: 1280, height: 800 } },
    layout: { profileId: 'p1', confidence: 0.9, bodyRegion: { x: 0, y: 0, width: 1, height: 1 } },
    messageUnits: [],
    totalChars: 0,
    truncated: false,
    warnings: [],
  };
}

function successReadOutput(): string {
  return JSON.stringify(successReadResult());
}

// ---------------------------------------------------------------------------
// types 解析器
// ---------------------------------------------------------------------------

describe('wechat-visible-reader types', () => {
  it('parseWeChatVisibleProbeResult：成功与失败判别', () => {
    const ok = parseWeChatVisibleProbeResult({
      ok: true,
      wechatVersion: '3.9.10',
      profileId: 'p1',
      windowSize: { width: 1280, height: 800 },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.profileId).toBe('p1');

    const failure = parseWeChatVisibleProbeResult({
      ok: false,
      error: { code: 'wechat_not_running', userAction: '请先启动微信' },
    });
    expect(failure.ok).toBe(false);
  });

  it('parseWeChatVisibleProbeResult：非法输入拒绝', () => {
    expect(() => parseWeChatVisibleProbeResult({ ok: true, wechatVersion: 123 })).toThrow(/invalid native probe result/);
  });

  it('parseWeChatVisibleReadResult：读取成功校验 totalChars 一致性', () => {
    const textUnit: VisibleMessageUnit = {
      bbox: { x: 0, y: 0, width: 1, height: 0.1 },
      ocrConfidence: 0.95,
      layoutConfidence: 0.9,
      presumedSender: 'other',
      blockHash: 'a'.repeat(64),
      blockType: 'text',
      isPartial: false,
      text: '你好',
    };
    const result: WeChatVisibleReadResult = {
      ok: true,
      captureId: 'cap1',
      capturedAt: '2026-01-01T00:00:00.000Z',
      source: { bundleId: 'com.tencent.xinWeChat', wechatVersion: '3.9.10', windowSize: { width: 1280, height: 800 } },
      layout: { profileId: 'p1', confidence: 0.9, bodyRegion: { x: 0, y: 0, width: 1, height: 1 } },
      messageUnits: [textUnit],
      totalChars: 2,
      truncated: false,
      warnings: [],
    };
    expect(parseWeChatVisibleReadResult(result, { maxBlocks: 10, maxChars: 100 })).toEqual(result);
  });

  it('parseWeChatVisibleReadResult：超限 / 字符数不符拒绝', () => {
    const unit: VisibleMessageUnit = {
      bbox: { x: 0, y: 0, width: 1, height: 0.1 },
      ocrConfidence: 0.9,
      layoutConfidence: 0.9,
      presumedSender: 'other',
      blockHash: 'a'.repeat(64),
      blockType: 'text',
      isPartial: false,
      text: 'hi',
    };
    const twoUnits = { ...successReadResult(), messageUnits: [unit, unit], totalChars: 4 };
    expect(() => parseWeChatVisibleReadResult(twoUnits, { maxBlocks: 1, maxChars: 100 })).toThrow(
      /exceeds requested limits/,
    );

    const bad = {
      ...successReadResult(),
      messageUnits: [unit],
      totalChars: 99,
    };
    expect(() => parseWeChatVisibleReadResult(bad, { maxBlocks: 10, maxChars: 100 })).toThrow(
      /text character count is invalid/,
    );
  });

  it('parseWeChatNavigationSpikeResult / parseWeChatConversationRecentResult', () => {
    const spike = parseWeChatNavigationSpikeResult({
      ok: true,
      targetHeaderMatched: true,
      restore: { conversationRestored: true, scrollAnchorRestored: false, frontApplicationRestored: true },
    });
    expect(spike.ok).toBe(true);

    const failure: WeChatVisibleFailure = {
      ok: false,
      error: { code: 'contact_not_found', userAction: '未找到联系人' },
    };
    const recent = parseWeChatConversationRecentResult(failure, { maxBlocks: 30, maxChars: 8000 });
    expect(recent.ok).toBe(false);
    expect(() => parseWeChatConversationRecentResult({ ok: true, bogus: 1 }, { maxBlocks: 1, maxChars: 1 })).toThrow(
      /invalid native recent-conversation result/,
    );
  });
});

// ---------------------------------------------------------------------------
// ArmStore
// ---------------------------------------------------------------------------

describe('WeChatVisibleReaderArmStore', () => {
  it('arm → isArmed + status；过期自动失效；disarm', () => {
    let now = 1_000_000;
    const store = new WeChatVisibleReaderArmStore({ now: () => now });
    expect(store.isArmed()).toBe(false);

    store.arm({ operator: 'owner-1', minutes: 5 });
    expect(store.isArmed()).toBe(true);
    const status = store.status();
    expect(status.armed).toBe(true);
    expect(status.armedBy).toBe('owner-1');
    expect(status.remainingMs).toBe(5 * 60_000);

    now += 5 * 60_000 + 1;
    expect(store.isArmed()).toBe(false);

    store.arm({ operator: 'owner-2', minutes: 1 });
    store.disarm();
    expect(store.isArmed()).toBe(false);
  });

  it('非法 minutes / 空 operator 拒绝', () => {
    const store = new WeChatVisibleReaderArmStore();
    expect(() => store.arm({ operator: 'o', minutes: 0 })).toThrow(RangeError);
    expect(() => store.arm({ operator: 'o', minutes: 31 })).toThrow(RangeError);
    expect(() => store.arm({ operator: '  ', minutes: 5 })).toThrow(/required/);
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

describe('WeChatVisibleReaderMetrics', () => {
  it('记录成功/失败/错误码；layoutPauseRecommended 触发', () => {
    const metrics = new WeChatVisibleReaderMetrics();
    const failure: WeChatVisibleReadResult = {
      ok: false,
      error: { code: 'ocr_low_confidence', userAction: '请重试' },
    };
    metrics.record(failure);
    const early = metrics.snapshot();
    expect(early.totalReadAttempts).toBe(1);
    expect(early.typedErrors.ocr_low_confidence).toBe(1);
    expect(early.recentSuccessRate).toBe(0);

    const success = successReadResult();
    // 填满 20 窗口：19 成功 + 1 失败 → 0.95，不推荐暂停
    for (let index = 0; index < 19; index += 1) metrics.record(success);
    const full = metrics.snapshot();
    expect(full.recentWindowSize).toBe(20);
    expect(full.recentSuccessRate).toBe(0.95);
    expect(full.layoutPauseRecommended).toBe(false);

    // 窗口内全失败 → 推荐暂停
    for (let index = 0; index < 20; index += 1) metrics.record(failure);
    const paused = metrics.snapshot();
    expect(paused.layoutPauseRecommended).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

describe('createWeChatVisibleReaderHandlers', () => {
  function makeDeps() {
    const armStore = new WeChatVisibleReaderArmStore({ now: () => Date.now() });
    const metrics = new WeChatVisibleReaderMetrics();
    const runner = createWeChatVisibleReaderNativeRunner({
      execute: async () => {
        throw new Error('not executed in handler test');
      },
    });
    return { armStore, metrics, runner };
  }

  it('read_visible_conversation：未 arm → authorization_required', async () => {
    const deps = makeDeps();
    const handlers = createWeChatVisibleReaderHandlers(deps);
    const result = await handlers['wechat-visible-reader:read_visible_conversation']!({}, {});
    expect(result.success).toBe(true);
    expect((result.data as { error: { code: string } }).error.code).toBe('authorization_required');
  });

  it('read_visible_conversation：arm 后调用 runner.read 并记录 metrics', async () => {
    const read = vi.fn(async () => successReadResult());
    const deps = makeDeps();
    const handlers = createWeChatVisibleReaderHandlers({
      ...deps,
      runner: { ...deps.runner, read },
    });
    deps.armStore.arm({ operator: 'o', minutes: 5 });
    const result = await handlers['wechat-visible-reader:read_visible_conversation']!({ maxBlocks: 10, maxChars: 100 }, {});
    expect(result.success).toBe(true);
    expect(read).toHaveBeenCalledWith({ maxBlocks: 10, maxChars: 100 });
    expect(deps.metrics.snapshot().totalReadAttempts).toBe(1);
  });

  it('read_conversation_recent：缺 owner 溯源或未确认 → authorization_required', async () => {
    const deps = makeDeps();
    const handlers = createWeChatVisibleReaderHandlers(deps);
    const result = await handlers['wechat-visible-reader:read_conversation_recent']!(
      { contact: '张三', limit: 5, acknowledgeUiNavigation: true, acknowledgeMayMarkRead: true },
      {},
    );
    expect((result.data as { error: { code: string } }).error.code).toBe('authorization_required');
  });

  it('read_conversation_recent：非法 contact/limit → navigation_failed', async () => {
    const deps = makeDeps();
    const handlers = createWeChatVisibleReaderHandlers(deps);
    const ctx = {
      invocation: { catId: 'c', invocationId: 'i', userId: 'u', threadId: 't', userMessageId: 'm' },
    };
    const badContact = await handlers['wechat-visible-reader:read_conversation_recent']!(
      { contact: '', limit: 5, acknowledgeUiNavigation: true, acknowledgeMayMarkRead: true },
      ctx,
    );
    expect((badContact.data as { error: { code: string } }).error.code).toBe('navigation_failed');

    const badLimit = await handlers['wechat-visible-reader:read_conversation_recent']!(
      { contact: '张三', limit: 31, acknowledgeUiNavigation: true, acknowledgeMayMarkRead: true },
      ctx,
    );
    expect((badLimit.data as { error: { code: string } }).error.code).toBe('navigation_failed');
  });

  it('read_conversation_recent：合法输入 → runner.readConversationRecent', async () => {
    let received: { contact: string; limit: number } | undefined;
    const deps = makeDeps();
    const handlers = createWeChatVisibleReaderHandlers({
      ...deps,
      runner: {
        ...deps.runner,
        readConversationRecent: async (options: { contact: string; limit: number }) => {
          received = options;
          return { ok: false as const, error: { code: 'capture_failed' as const, userAction: '' } };
        },
      },
    });
    const ctx = {
      invocation: { catId: 'c', invocationId: 'i', userId: 'u', threadId: 't', userMessageId: 'm' },
    };
    const result = await handlers['wechat-visible-reader:read_conversation_recent']!(
      { contact: '张三', limit: 5, acknowledgeUiNavigation: true, acknowledgeMayMarkRead: true },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(received).toEqual({ contact: '张三', limit: 5 });
  });
});

// ---------------------------------------------------------------------------
// Native runner
// ---------------------------------------------------------------------------

describe('createWeChatVisibleReaderNativeRunner', () => {
  it('read：注入执行器 + 参数透传；输出经 schema 解析', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const execute: NativeCommandExecutor = async (file, args) => {
      calls.push({ file, args: [...args] });
      return { stdout: successReadOutput() };
    };
    const runner = createWeChatVisibleReaderNativeRunner({ execute });
    const result = await runner.read({ maxBlocks: 10, maxChars: 100 });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const first = calls[0];
    expect(first).toBeDefined();
    expect(first?.file).toBe('/injected/cat-cafe-wechat-visible-reader');
    expect(first?.args).toContain('--read');
    expect(first?.args).toContain('--max-blocks');
  });

  it('read：非法 limits → capture_failed 不执行', async () => {
    let executed = false;
    const runner = createWeChatVisibleReaderNativeRunner({
      execute: async () => {
        executed = true;
        return { stdout: successReadOutput() };
      },
    });
    const result = await runner.read({ maxBlocks: 0, maxChars: 100 });
    expect(result.ok).toBe(false);
    expect(executed).toBe(false);
  });

  it('read：native 输出非法 → 安全失败 capture_failed', async () => {
    const runner = createWeChatVisibleReaderNativeRunner({
      execute: async () => ({ stdout: 'not-json' }),
    });
    const result = await runner.read();
    expect(result).toEqual({
      ok: false,
      error: { code: 'capture_failed', userAction: '微信读取失败，请稍后重试。' },
    });
  });

  it('probe / navigationSpike / readConversationRecent：注入执行器透传命令', async () => {
    const calls: Array<{ args: string[] }> = [];
    const execute: NativeCommandExecutor = async (_file, args) => {
      calls.push({ args: [...args] });
      if (args.includes('--probe')) {
        return {
          stdout: JSON.stringify({
            ok: true,
            wechatVersion: '3.9.10',
            profileId: 'p1',
            windowSize: { width: 1280, height: 800 },
          }),
        };
      }
      if (args.includes('--navigation-spike')) {
        return {
          stdout: JSON.stringify({
            ok: true,
            targetHeaderMatched: true,
            restore: { conversationRestored: true, scrollAnchorRestored: false, frontApplicationRestored: true },
          }),
        };
      }
      if (args.includes('--read-conversation-recent')) {
        return {
          stdout: JSON.stringify({
            ...successReadResult(),
            targetHeader: '张三',
            targetHeaderMatched: true,
            restore: { conversationRestored: true, scrollAnchorRestored: false, frontApplicationRestored: true },
          }),
        };
      }
      return { stdout: successReadOutput() };
    };
    const runner = createWeChatVisibleReaderNativeRunner({ execute });

    const probe = await runner.probe();
    expect(probe.ok).toBe(true);

    const spike = await runner.navigationSpike('张三');
    expect(spike.ok).toBe(true);

    const recent = await runner.readConversationRecent({ contact: '张三', limit: 3 });
    expect(recent.ok).toBe(true);

    expect(calls.some((call) => call.args.includes('--probe'))).toBe(true);
    expect(calls.some((call) => call.args.includes('--navigation-spike'))).toBe(true);
    expect(calls.some((call) => call.args.includes('--read-conversation-recent'))).toBe(true);
  });

  it('readConversationRecent：非法 contact/limit → capture_failed', async () => {
    const runner = createWeChatVisibleReaderNativeRunner({
      execute: async () => {
        throw new Error('should not execute');
      },
    });
    expect((await runner.readConversationRecent({ contact: '', limit: 5 })).ok).toBe(false);
    expect((await runner.readConversationRecent({ contact: '张三', limit: 0 })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

describe('ForgeWeChatVisibleReaderService（Cordis 插件）', () => {
  it('挂载 ctx.forgeWeChatVisibleReader + arm 授权 + handlers', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeWeChatVisibleReaderService, {
      execute: async () => {
        throw new Error('not executed');
      },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeWeChatVisibleReader;
    expect(svc).toBeDefined();

    const unarmed = await svc.handlers['wechat-visible-reader:read_visible_conversation']!({}, {});
    expect((unarmed.data as { error: { code: string } }).error.code).toBe('authorization_required');

    svc.arm('owner-1', 5);
    expect(svc.armStore.isArmed()).toBe(true);
    const status = svc.armStore.status();
    expect(status.armedBy).toBe('owner-1');
  });
});
