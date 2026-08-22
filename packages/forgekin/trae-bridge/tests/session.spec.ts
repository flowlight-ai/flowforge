/**
 * session — Trae 会话管理契约验证（对齐 Python session.py）。
 *
 * @module @flowforge/forgekin-trae-bridge/tests
 */

import { describe, expect, it } from 'vitest';
import { makeTraeClientConfig } from '../src/config.js';
import { TraeSession, TraeSessionManager, type SessionMemoryStore } from '../src/session.js';

/** 内存版持久化存储（模拟 MemoryManager） */
function makeMemoryStore(): SessionMemoryStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async save(scope: string, key: string, value: unknown): Promise<void> {
      data.set(`${scope}:${key}`, value);
    },
    async retrieve(scope: string, key: string): Promise<unknown[]> {
      const value = data.get(`${scope}:${key}`);
      return value === undefined ? [] : [{ value }];
    },
  };
}

describe('TraeSession', () => {
  const config = makeTraeClientConfig();

  it('addMessage 追加消息 + role 校验', () => {
    const session = new TraeSession('s1', config);
    session.addMessage('user', 'hello');
    session.addMessage('assistant', 'hi there');
    expect(session.getContext()).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(() => session.addMessage('tool', 'x')).toThrow(TypeError);
  });

  it('getContext 返回副本（修改不影响会话）', () => {
    const session = new TraeSession('s1', config);
    session.addMessage('user', 'a');
    const copy = session.getContext();
    copy.push({ role: 'user', content: 'b' });
    expect(session.getContext()).toHaveLength(1);
  });

  it('clear 清空历史', () => {
    const session = new TraeSession('s1', config);
    session.addMessage('user', 'a');
    session.clear();
    expect(session.getContext()).toEqual([]);
  });

  it('save/load 经 SessionMemoryStore 往返', async () => {
    const store = makeMemoryStore();
    const session = new TraeSession('s1', config);
    session.setMemoryStore(store);
    session.addMessage('user', '问题');
    session.addMessage('assistant', '回答');
    await session.save();

    const restored = new TraeSession('s1', config);
    restored.setMemoryStore(store);
    await restored.load();
    expect(restored.getContext()).toEqual([
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' },
    ]);
  });

  it('未注入存储时 save/load 静默跳过', async () => {
    const session = new TraeSession('s1', config);
    session.addMessage('user', 'a');
    await session.save(); // 不抛错
    await session.load();
    expect(session.getContext()).toHaveLength(1);
  });

  it('session_persistence=false 时不持久化', async () => {
    const store = makeMemoryStore();
    const session = new TraeSession('s1', makeTraeClientConfig({ session_persistence: false }));
    session.setMemoryStore(store);
    session.addMessage('user', 'a');
    await session.save();
    expect(store.data.size).toBe(0);
  });

  it('toDict / fromDict 往返', () => {
    const session = new TraeSession('s1', config);
    session.addMessage('user', 'a');
    const restored = TraeSession.fromDict(session.toDict(), config);
    expect(restored.sessionId).toBe('s1');
    expect(restored.getContext()).toEqual([{ role: 'user', content: 'a' }]);
  });
});

describe('TraeSessionManager', () => {
  const config = makeTraeClientConfig();

  it('createSession 已存在时返回现有会话', () => {
    const manager = new TraeSessionManager(config);
    const s1 = manager.createSession('task-1');
    const s2 = manager.createSession('task-1');
    expect(s2).toBe(s1);
  });

  it('getSession / closeSession / listSessions / closeAll', async () => {
    const manager = new TraeSessionManager(config);
    manager.createSession('a');
    manager.createSession('b');
    expect(manager.listSessions().sort()).toEqual(['a', 'b']);
    expect(manager.getSession('a')).not.toBeNull();
    expect(manager.getSession('zzz')).toBeNull();

    manager.closeSession('a');
    expect(manager.getSession('a')).toBeNull();

    await manager.closeAll();
    expect(manager.listSessions()).toEqual([]);
  });

  it('setMemoryStore 后新建会话自动继承', async () => {
    const store = makeMemoryStore();
    const manager = new TraeSessionManager(config);
    manager.setMemoryStore(store);
    const session = manager.createSession('s1');
    session.addMessage('user', 'x');
    await session.save();
    expect(store.data.size).toBe(1);
  });
});
