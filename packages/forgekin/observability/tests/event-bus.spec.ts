/**
 * 事件总线 — T7.12 EventBus + EventBusBridge 契约验证。
 *
 * 移植自 `events/event_bus.py` + `core/event_bridge.py`：
 *   - EventBus：发布订阅 / "*" 通配 / filter 过滤 / unsubscribe /
 *     请求响应（respond + request / async 处理器 / 超时）
 *   - EventBusBridge：双向转发 + `_source`/`_bridged` 标记 + 运行时增类型
 *
 * @module @flowforge/forgekin-observability/tests
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRIDGED_EVENTS,
  EventBus,
  EventBusBridge,
  type EventRecord,
} from '../src/event-bus.js';

describe('EventBus 发布订阅', () => {
  it('emit 触发订阅者并携带 type/payload/task_id/timestamp', () => {
    const bus = new EventBus();
    let received: EventRecord | undefined;
    bus.subscribe('task.completed', (e) => {
      received = e;
    });
    bus.emit('t-1', 'task.completed', { ok: true });
    expect(received?.type).toBe('task.completed');
    expect(received?.payload).toEqual({ ok: true });
    expect(received?.task_id).toBe('t-1');
    expect(typeof received?.timestamp).toBe('string');
  });

  it('"*" 通配订阅接收所有事件', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe('*', (e) => {
      seen.push(e.type);
    });
    bus.emit('', 'a.b', {});
    bus.emit('', 'c.d', {});
    expect(seen).toEqual(['a.b', 'c.d']);
  });

  it('filter 谓词控制回调触发', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(
      'task.completed',
      (e) => {
        seen.push(e.payload['mode'] as string);
      },
      (e) => e.payload['mode'] === 'auto',
    );
    bus.emit('', 'task.completed', { mode: 'auto' });
    bus.emit('', 'task.completed', { mode: 'manual' });
    expect(seen).toEqual(['auto']);
  });

  it('unsubscribe 按引用移除回调', () => {
    const bus = new EventBus();
    let count = 0;
    const cb = () => {
      count += 1;
    };
    bus.subscribe('x', cb);
    expect(bus.unsubscribe('x', cb)).toBe(true);
    bus.emit('', 'x', {});
    expect(count).toBe(0);
    expect(bus.unsubscribe('x', cb)).toBe(false);
  });

  it('subscriber_count 统计订阅总数', () => {
    const bus = new EventBus();
    bus.subscribe('a', () => {});
    bus.subscribe('a', () => {});
    bus.subscribe('b', () => {});
    expect(bus.subscriber_count).toBe(3);
  });

  it('async 回调不阻塞发射方（fire-and-forget，对齐 ensure_future）', async () => {
    const bus = new EventBus();
    let done = false;
    bus.subscribe('slow', async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    bus.emit('', 'slow', {});
    expect(done).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(true);
  });
});

describe('EventBus 请求响应', () => {
  it('respond + request 返回响应值', async () => {
    const bus = new EventBus();
    bus.respond('llm.generate', (e) => ({
      result: 'ok',
      req: e.payload['prompt'],
    }));
    const resp = await bus.request('llm.generate', { prompt: 'hi' }, 1);
    expect(resp).toEqual({ result: 'ok', req: 'hi' });
  });

  it('async 响应处理器同样可解析', async () => {
    const bus = new EventBus();
    bus.respond('ping', async () => 'pong');
    await expect(bus.request('ping', {}, 1)).resolves.toBe('pong');
  });

  it('超时无响应抛出 Error（对齐 asyncio.TimeoutError）', async () => {
    const bus = new EventBus();
    await expect(bus.request('nobody', {}, 0.05)).rejects.toThrow('timeout');
  });
});

describe('EventBusBridge 跨项目桥', () => {
  it('DEFAULT_BRIDGED_EVENTS 含 8 类任务/模型/工作流事件', () => {
    expect(DEFAULT_BRIDGED_EVENTS.size).toBe(8);
    expect(DEFAULT_BRIDGED_EVENTS.has('task.created')).toBe(true);
    expect(DEFAULT_BRIDGED_EVENTS.has('task.cancelled')).toBe(true);
    expect(DEFAULT_BRIDGED_EVENTS.has('model.failover')).toBe(true);
    expect(DEFAULT_BRIDGED_EVENTS.has('workflow.stage_done')).toBe(true);
  });

  it('start 后 ff → peer 转发（payload 加 _source=flowforge/_bridged）', () => {
    const ff = new EventBus();
    const peer = new EventBus();
    const bridge = new EventBusBridge(ff, peer);
    bridge.start();
    expect(bridge.is_running).toBe(true);

    const got: EventRecord[] = [];
    peer.subscribe('task.completed', (e) => {
      got.push(e);
    });
    ff.emit('t-9', 'task.completed', { ok: true });
    expect(got).toHaveLength(1);
    expect(got[0]?.payload).toEqual({ ok: true, _source: 'flowforge', _bridged: true });
    expect(got[0]?.task_id).toBe('t-9');
  });

  it('start 后 peer → ff 转发（_source=peer）', () => {
    const ff = new EventBus();
    const peer = new EventBus();
    const bridge = new EventBusBridge(ff, peer);
    bridge.start();

    const got: EventRecord[] = [];
    ff.subscribe('task.created', (e) => {
      got.push(e);
    });
    peer.emit('t-10', 'task.created', { hello: 1 });
    expect(got[0]?.payload).toEqual({ hello: 1, _source: 'peer', _bridged: true });
  });

  it('未桥接类型不转发；stop 后不再转发', () => {
    const ff = new EventBus();
    const peer = new EventBus();
    const bridge = new EventBusBridge(ff, peer);
    bridge.start();

    const got: EventRecord[] = [];
    peer.subscribe('custom.only', (e) => {
      got.push(e);
    });
    ff.emit('', 'custom.only', {});
    expect(got).toHaveLength(0);

    bridge.stop();
    expect(bridge.is_running).toBe(false);
    ff.emit('', 'task.completed', {});
    expect(got).toHaveLength(0);
  });

  it('add_bridged_type 运行时新增（幂等）', () => {
    const ff = new EventBus();
    const peer = new EventBus();
    const bridge = new EventBusBridge(ff, peer);
    bridge.start();

    const got: EventRecord[] = [];
    peer.subscribe('custom.only', (e) => {
      got.push(e);
    });
    bridge.add_bridged_type('custom.only');
    bridge.add_bridged_type('custom.only');
    ff.emit('', 'custom.only', { x: 1 });
    expect(got).toHaveLength(1);
    expect(bridge.bridged_types.has('custom.only')).toBe(true);
  });

  it('peer 为 null 时单向模式（不抛错，默认 8 类）', () => {
    const ff = new EventBus();
    const bridge = new EventBusBridge(ff);
    bridge.start();
    expect(bridge.is_running).toBe(true);
    expect(bridge.bridged_types.size).toBe(8);
    ff.emit('', 'task.created', {});
  });
});
