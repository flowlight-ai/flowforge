/**
 * LimbOutboundDeliveryHook — T6.3 群聊 → 四肢出站投递契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbOutboundDeliveryHook.ts` 语义）：
 * - display（表情 scene）+ speaker（TTS 语音）两条 physical_limb.execute 指令
 * - 仅投递绑定 catId 的节点；Limb 拒绝（refusal）向上抛错
 * - triggerMessageId 驱动的 120s 去重：in-flight 与近期完成的重试合并
 * - 4096 code-point 上限；无 triggerMessageId 直接投递
 *
 * @module @flowforge/limb-observation/tests
 */

import { describe, expect, it } from 'vitest';
import { MemoryLimbEmbodimentBindingStore } from '@flowforge/limb-embodiment';
import { LimbOutboundDeliveryHook } from '../src/limb-outbound-delivery-hook.js';

const NOW = Date.parse('2026-08-01T09:16:00.000Z');

async function createBindingStore() {
  const bindingStore = new MemoryLimbEmbodimentBindingStore();
  await bindingStore.put({
    nodeId: 'stackchan-home',
    userId: 'default-user',
    threadId: 'thread-stackchan',
    catId: 'codex-sol',
    expressionRef: 'yanyan:replying',
    voiceProfileRef: 'yanyan:local',
    volumePercent: 35,
    updatedAt: NOW,
  });
  return bindingStore;
}

interface InvokeCall {
  nodeId: string;
  command: string;
  params: Record<string, unknown>;
  context: unknown;
}

describe('LimbOutboundDeliveryHook 出站投递', () => {
  it('display + speaker 两条指令，参数与上下文正确', async () => {
    const bindingStore = await createBindingStore();
    const invoked: InvokeCall[] = [];
    let id = 0;
    const hook = new LimbOutboundDeliveryHook({
      bindingStore,
      now: () => NOW,
      createId: () => `generated-${++id}`,
      limbRegistry: {
        async invoke(nodeId, command, params, context) {
          invoked.push({ nodeId, command, params, context });
          return { success: true };
        },
      },
    });

    await hook.deliver('thread-stackchan', '我在这里。', 'codex-sol', 'message-transcript-1');

    expect(invoked).toHaveLength(2);
    expect(invoked[0]!.nodeId).toBe('stackchan-home');
    expect(invoked[0]!.command).toBe('physical_limb.execute');
    expect((invoked[0]!.params.instruction as { payload: unknown }).payload).toEqual({
      expression: 'yanyan:replying',
      expressionSource: { kind: 'play', ref: 'message-transcript-1' },
    });
    expect((invoked[1]!.params.instruction as { payload: unknown }).payload).toEqual({
      text: '我在这里。',
      voiceProfileRef: 'yanyan:local',
      volumePercent: 35,
    });
    expect(invoked[1]!.context).toMatchObject({
      catId: 'codex-sol',
      threadId: 'thread-stackchan',
      userMessageId: 'message-transcript-1',
    });
  });

  it('非绑定 catId 不投递；Limb 拒绝时向上抛错', async () => {
    const bindingStore = await createBindingStore();
    const invoked: InvokeCall[] = [];
    const hook = new LimbOutboundDeliveryHook({
      bindingStore,
      now: () => NOW,
      createId: () => 'generated',
      limbRegistry: {
        async invoke(nodeId, command, params, context) {
          invoked.push({ nodeId, command, params, context });
          return { success: true };
        },
      },
    });

    await hook.deliver('thread-stackchan', '不该说', 'fable5', 'message-2');
    expect(invoked).toHaveLength(0);

    const refusing = new LimbOutboundDeliveryHook({
      bindingStore,
      now: () => NOW,
      createId: () => 'generated',
      limbRegistry: {
        async invoke() {
          return { success: false, error: 'lease lost' };
        },
      },
    });
    await expect(refusing.deliver('thread-stackchan', '我在这里。', 'codex-sol', 'message-1')).rejects.toThrow(
      'lease lost',
    );
  });

  it('同 node/消息/内容 120s 内去重：in-flight 与近期完成的重试合并', async () => {
    const bindingStore = await createBindingStore();
    let releaseFirstAction: (() => void) | undefined;
    const firstActionGate = new Promise<void>((resolve) => {
      releaseFirstAction = resolve;
    });
    let idCount = 0;
    let invokeCount = 0;
    const hook = new LimbOutboundDeliveryHook({
      bindingStore,
      now: () => NOW,
      createId: () => `generated-${++idCount}`,
      limbRegistry: {
        async invoke() {
          invokeCount += 1;
          if (invokeCount === 1) await firstActionGate;
          return { success: true };
        },
      },
    });

    const first = hook.deliver('thread-stackchan', '不要复读我。', 'codex-sol', 'message-transcript-1');
    await new Promise((resolve) => setImmediate(resolve));
    const overlappingRetry = hook.deliver('thread-stackchan', '不要复读我。', 'codex-sol', 'message-transcript-1');
    releaseFirstAction?.();
    await Promise.all([first, overlappingRetry]);
    await hook.deliver('thread-stackchan', '不要复读我。', 'codex-sol', 'message-transcript-1');

    expect(invokeCount).toBe(2); // 一个逻辑回复 = 一次 display + 一次 speaker
  });

  it('去重失败后清理缓存，重试可再次投递', async () => {
    const bindingStore = await createBindingStore();
    let attempts = 0;
    const hook = new LimbOutboundDeliveryHook({
      bindingStore,
      now: () => NOW,
      createId: () => 'generated',
      limbRegistry: {
        async invoke() {
          attempts += 1;
          if (attempts === 1) return { success: false, error: 'lease lost' };
          return { success: true };
        },
      },
    });

    await expect(hook.deliver('thread-stackchan', '再来一次。', 'codex-sol', 'message-1')).rejects.toThrow(
      'lease lost',
    );
    await expect(hook.deliver('thread-stackchan', '再来一次。', 'codex-sol', 'message-1')).resolves.toBeUndefined();
    expect(attempts).toBe(3); // 首次 display 失败 + 重试 display/speaker 成功
  });

  it('超过 4096 code-point 拒绝投递', async () => {
    const bindingStore = await createBindingStore();
    const invoked: InvokeCall[] = [];
    const hook = new LimbOutboundDeliveryHook({
      bindingStore,
      now: () => NOW,
      createId: () => 'generated',
      limbRegistry: {
        async invoke(nodeId, command, params, context) {
          invoked.push({ nodeId, command, params, context });
          return { success: true };
        },
      },
    });

    await expect(
      hook.deliver('thread-stackchan', '长'.repeat(4_097), 'codex-sol', 'message-1'),
    ).rejects.toThrow('4096');
    expect(invoked).toHaveLength(0);
  });

  it('无 triggerMessageId 时直接投递（不做去重）', async () => {
    const bindingStore = await createBindingStore();
    const invoked: InvokeCall[] = [];
    const hook = new LimbOutboundDeliveryHook({
      bindingStore,
      now: () => NOW,
      createId: () => 'generated',
      limbRegistry: {
        async invoke(nodeId, command, params, context) {
          invoked.push({ nodeId, command, params, context });
          return { success: true };
        },
      },
    });

    await hook.deliver('thread-stackchan', '主动播报。', 'codex-sol');
    await hook.deliver('thread-stackchan', '主动播报。', 'codex-sol');

    expect(invoked).toHaveLength(4); // 每次完整 display + speaker
    expect(invoked[0]!.context).not.toHaveProperty('userMessageId');
  });

  it('空内容或缺少 catId 直接跳过', async () => {
    const bindingStore = await createBindingStore();
    const invoked: InvokeCall[] = [];
    const hook = new LimbOutboundDeliveryHook({
      bindingStore,
      now: () => NOW,
      createId: () => 'generated',
      limbRegistry: {
        async invoke(nodeId, command, params, context) {
          invoked.push({ nodeId, command, params, context });
          return { success: true };
        },
      },
    });

    await hook.deliver('thread-stackchan', '', 'codex-sol', 'message-1');
    await hook.deliver('thread-stackchan', '内容', undefined, 'message-2');
    expect(invoked).toHaveLength(0);
  });
});
