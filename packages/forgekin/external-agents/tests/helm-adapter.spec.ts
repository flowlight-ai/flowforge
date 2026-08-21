/**
 * LLMClientHelmAdapter — T7.9 Helm 事件桥验证。
 *
 * 覆盖：
 * - onStart：messages 截断前 3 条 / null 透传
 * - onReasoning / onStream 原样转发
 * - onEnd：fullResponse 截断 2000 字符 + error 缺省 null
 * - setHelmEmitter / getHelmEmitter 全局管理
 *
 * @module @flowforge/forgekin-external-agents/tests
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getHelmEmitter,
  HelmChatMessage,
  LLMClientHelmAdapter,
  setHelmEmitter,
} from '../src/helm-adapter.js';

/** 记录事件的假发射器 */
class FakeEmitter {
  readonly calls: { name: string; args: unknown[] }[] = [];

  async emitLlmStart(taskId: string, agentName: string, model: string, messages: HelmChatMessage[] | null) {
    this.calls.push({ name: 'start', args: [taskId, agentName, model, messages] });
  }

  async emitLlmReasoning(taskId: string, agentName: string, delta: string) {
    this.calls.push({ name: 'reasoning', args: [taskId, agentName, delta] });
  }

  async emitLlmStream(taskId: string, agentName: string, delta: string) {
    this.calls.push({ name: 'stream', args: [taskId, agentName, delta] });
  }

  async emitLlmEnd(taskId: string, agentName: string, fullResponse: string, tokens: number, error?: string | null) {
    this.calls.push({ name: 'end', args: [taskId, agentName, fullResponse, tokens, error] });
  }
}

let emitter: FakeEmitter;
let adapter: LLMClientHelmAdapter;

beforeEach(() => {
  emitter = new FakeEmitter();
  adapter = new LLMClientHelmAdapter(emitter, 'task-1');
  setHelmEmitter(null);
});

describe('onStart 消息截断', () => {
  it('messages 超过 3 条 → 仅转发前 3 条', async () => {
    const messages = [1, 2, 3, 4, 5].map((i) => ({ role: 'user', content: `m${i}` }));
    await adapter.onStart('writer', 'gpt-4o', messages);
    expect(emitter.calls).toEqual([{
      name: 'start',
      args: ['task-1', 'writer', 'gpt-4o', messages.slice(0, 3)],
    }]);
  });

  it('messages 为 null → 原样转发 null', async () => {
    await adapter.onStart('writer', 'gpt-4o', null);
    expect(emitter.calls[0]!.args[3]).toBeNull();
  });
});

describe('onReasoning / onStream', () => {
  it('原样转发 taskId / agentName / delta', async () => {
    await adapter.onReasoning('writer', '思考中…');
    await adapter.onStream('writer', '增量');
    expect(emitter.calls).toEqual([
      { name: 'reasoning', args: ['task-1', 'writer', '思考中…'] },
      { name: 'stream', args: ['task-1', 'writer', '增量'] },
    ]);
  });
});

describe('onEnd 响应截断', () => {
  it('fullResponse 超过 2000 字符 → 截断至 2000', async () => {
    const long = 'x'.repeat(2500);
    await adapter.onEnd('writer', long, 42, 'boom');
    expect(emitter.calls[0]!.args[2]).toBe('x'.repeat(2000));
    expect(emitter.calls[0]!.args[3]).toBe(42);
    expect(emitter.calls[0]!.args[4]).toBe('boom');
  });

  it('error 缺省 → null（对齐 Python default None）', async () => {
    await adapter.onEnd('writer', 'ok', 7);
    expect(emitter.calls[0]!.args[4]).toBeNull();
  });
});

describe('全局 emitter 管理', () => {
  it('set 后 get 返回同一实例；set(null) 清空', () => {
    expect(getHelmEmitter()).toBeNull();
    setHelmEmitter(emitter);
    expect(getHelmEmitter()).toBe(emitter);
    setHelmEmitter(null);
    expect(getHelmEmitter()).toBeNull();
  });
});
