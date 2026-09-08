/**
 * ConnectorCommandLayer 契约测试。
 * 真实 Memory 绑定存储 + 真实 threadStore 假实现驱动各命令分派，
 * 断言 CommandResult 的 kind / response / 边效应。禁 Mock。
 */

import { describe, expect, it } from 'vitest';

import {
  ConnectorCommandLayer,
  MemoryConnectorPermissionStore,
  MemoryConnectorThreadBindingStore,
  type ConnectorCommandLayerDeps,
} from '../src/index.ts';
import { CatRegistry } from '@flowforge/cats-shared';

interface ThreadRecord {
  id: string;
  userId: string;
  title?: string;
  createdAt?: number;
  preferredCats?: string[];
}

/** 真实语义的内存 threadStore 假实现（非 mock，可按需注入外部状态）。 */
class FakeThreadStore {
  private threads = new Map<string, ThreadRecord>();
  private messages: Array<{ threadId: string; catId: string | null; userId?: string; content: string; timestamp: number }> = [];
  private seq = 0;

  create(userId: string, title?: string): ThreadRecord {
    this.seq++;
    const id = `th-${String(this.seq).padStart(3, '0')}`;
    const rec: ThreadRecord = { id, userId, title, createdAt: 1000 + this.seq };
    this.threads.set(id, rec);
    return rec;
  }
  get(id: string): ThreadRecord | null {
    return this.threads.get(id) ?? null;
  }
  list(userId: string): ThreadRecord[] {
    return [...this.threads.values()].filter((t) => t.userId === userId);
  }
  updatePreferredCats(threadId: string, catIds: string[]): void {
    const t = this.threads.get(threadId);
    if (t) t.preferredCats = catIds;
  }
  appendMsg(threadId: string, catId: string | null, content: string, timestamp: number, userId?: string): void {
    this.messages.push({ threadId, catId, content, timestamp, userId });
  }
  getByThreadBefore(threadId: string, _before: number, limit?: number) {
    const msgs = this.messages.filter((m) => m.threadId === threadId);
    // 返回按 timestamp 升序（调用方 splitRounds 假定时间升序）
    return msgs.slice(-(limit ?? msgs.length));
  }
}

/**
 * 结构等价的双重：normalizeCatId 仅消费 `has` / `getAllConfigs`，这里提供
 * 真实配置（displayName/nickname/mentionPatterns），匹配逻辑（would-be unit）
 * 即为 cats-shared 的真实 normalizeCatId。Cordis Service 上下文由宿主注入。
 */
function makeCatRegistry(): CatRegistry {
  const configs: Record<string, { displayName: string; nickname?: string }> = {
    'cat-a': { displayName: '宪宪', nickname: 'xian' },
  };
  const fake = {
    has: (id: string) => id in configs,
    getAllConfigs: () => configs,
  };
  return fake as unknown as CatRegistry;
}

function makeLayer(over: Partial<ConnectorCommandLayerDeps> = {}) {
  const ts = new FakeThreadStore();
  const bindingStore = new MemoryConnectorThreadBindingStore();
  const permissionStore = new MemoryConnectorPermissionStore();
  const deps: ConnectorCommandLayerDeps = {
    bindingStore,
    threadStore: ts,
    frontendBaseUrl: 'https://app',
    permissionStore,
    messageStore: { getByThreadBefore: (t, b, l) => ts.getByThreadBefore(t, b, l) },
    ...over,
  };
  return { layer: new ConnectorCommandLayer(deps), bindingStore, ts, permissionStore, deps };
}

describe('ConnectorCommandLayer', () => {
  it('非命令文本返回 not-command', async () => {
    const { layer } = makeLayer();
    const r = await layer.handle('feishu', 'chat-1', 'u-1', '今天天气如何');
    expect(r.kind).toBe('not-command');
  });

  it('/new 创建线程并绑定', async () => {
    const { layer, bindingStore } = makeLayer();
    const r = await layer.handle('feishu', 'chat-1', 'u-1', '/new 测试线程');
    expect(r.kind).toBe('new');
    expect(r.newActiveThreadId).toBeDefined();
    expect((await bindingStore.getByExternal('feishu', 'chat-1'))?.threadId).toBe(r.newActiveThreadId);
    expect(r.response).toContain('测试线程');
  });

  it('/where 报告当前绑定线程', async () => {
    const { layer, bindingStore, ts } = makeLayer();
    await layer.handle('feishu', 'chat-1', 'u-1', '/new');
    const created = (await bindingStore.getByExternal('feishu', 'chat-1'))!;
    const r = await layer.handle('feishu', 'chat-1', 'u-1', '/where');
    expect(r.kind).toBe('where');
    expect(r.response).toContain(created.threadId);
    expect(ts.get(created.threadId)!.title).toBeUndefined();
  });

  it('/threads 列出并按序号切换', async () => {
    const { layer, bindingStore } = makeLayer();
    await layer.handle('feishu', 'chat-1', 'u-1', '/new A');
    await layer.handle('feishu', 'chat-1', 'u-1', '/new B');
    const list = await layer.handle('feishu', 'chat-1', 'u-1', '/threads');
    expect(list.kind).toBe('threads');
    expect(list.response).toContain('A');
    expect(list.response).toContain('B');

    const use = await layer.handle('feishu', 'chat-1', 'u-1', '/use 2');
    expect(use.kind).toBe('use');
    expect((await bindingStore.getByExternal('feishu', 'chat-1'))?.threadId).toBe(use.newActiveThreadId);
  });

  it('/use 无输入返回用法错误', async () => {
    const { layer } = makeLayer();
    const r = await layer.handle('feishu', 'chat-1', 'u-1', '/use');
    expect(r.kind).toBe('use');
    expect(r.response).toContain('用法');
  });

  it('/thread 切换并转发内容', async () => {
    const { layer, bindingStore, ts } = makeLayer();
    await layer.handle('feishu', 'chat-1', 'u-1', '/new A');
    const first = (await bindingStore.getByExternal('feishu', 'chat-1'))!.threadId;
    await layer.handle('feishu', 'chat-1', 'u-1', '/new B');
    const r = await layer.handle('feishu', 'chat-1', 'u-1', `/thread ${first} 你好`);
    expect(r.kind).toBe('thread');
    expect(r.newActiveThreadId).toBe(first);
    expect(r.forwardContent).toBe('你好');
    expect(ts.get(first)!.title).toBe('A');
  });

  it('/unbind 解绑后返回引导', async () => {
    const { layer, bindingStore } = makeLayer();
    await layer.handle('feishu', 'chat-1', 'u-1', '/new');
    const r = await layer.handle('feishu', 'chat-1', 'u-1', '/unbind');
    expect(r.kind).toBe('unbind');
    expect(await bindingStore.getByExternal('feishu', 'chat-1')).toBeNull();
  });

  it('/allow-group 仅管理员可用', async () => {
    const { layer, permissionStore } = makeLayer();
    // 非管理员
    const denied = await layer.handle('feishu', 'chat-g', 'u-1', '/allow-group', 'u-nonadmin');
    expect(denied.response).toContain('仅管理员');
    expect(await permissionStore.listAllowedGroups('feishu')).toHaveLength(0);
  });

  it('/allow-group 管理员加入默认群白名单', async () => {
    const { layer, permissionStore } = makeLayer();
    await permissionStore.setAdminOpenIds('feishu', ['u-admin']);
    const r = await layer.handle('feishu', 'chat-g', 'u-admin', '/allow-group', 'u-admin');
    expect(r.kind).toBe('allow-group');
    expect(await permissionStore.listAllowedGroups('feishu')).toHaveLength(1);
  });

  it('/history 命中消息存储并聚合轮次', async () => {
    const { layer, ts } = makeLayer();
    const created = await layer.handle('feishu', 'chat-1', 'u-1', '/new');
    const threadId = created.newActiveThreadId!;
    ts.appendMsg(threadId, null, 'user q', 2000, 'u-1');
    ts.appendMsg(threadId, 'cat-a', 'cat a', 2001);
    ts.appendMsg(threadId, null, 'user q2', 3000, 'u-1');
    ts.appendMsg(threadId, 'cat-a', 'cat a2', 3001);
    const r = await layer.handle('feishu', 'chat-1', 'u-1', '/history 2');
    expect(r.kind).toBe('history');
    expect(r.response).toContain('user q2');
    // 保底：响应非空
    expect(r.response.length).toBeGreaterThan(0);
  });

  it('/focus 设置首选猫', async () => {
    const { layer, ts } = makeLayer({ catRegistry: makeCatRegistry() });
    const created = await layer.handle('feishu', 'chat-1', 'u-1', '/new');
    const threadId = created.newActiveThreadId!;
    const r = await layer.handle('feishu', 'chat-1', 'u-1', '/focus 宪宪');
    expect(r.kind).toBe('focus');
    expect(ts.get(threadId)?.preferredCats).toEqual(['cat-a']);
  });

  it('/ask 定向路由', async () => {
    const { layer } = makeLayer({ catRegistry: makeCatRegistry() });
    await layer.handle('feishu', 'chat-1', 'u-1', '/new');
    const r = await layer.handle('feishu', 'chat-1', 'u-1', '/ask 宪宪 帮我检查');
    expect(r.kind).toBe('ask');
    expect(r.targetCatId).toBe('cat-a');
    expect(r.forwardContent).toBe('帮我检查');
  });

  it('/commands 返回命令列表', async () => {
    const { layer } = makeLayer();
    const r = await layer.handle('feishu', 'chat-1', 'u-1', '/commands');
    expect(r.kind).toBe('commands');
    expect(r.response).toContain('可用命令');
  });
});