/**
 * ConnectorRouter 契约测试。
 * 真实 Memory 绑定存储 + 真实 messageStore/threadStore 假实现 +
 * 真实 mention 解析驱动，断言路由、绑定创建、去重、命令拦截与权限拦截。
 * 禁 Mock。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { registerConnectorDefinition } from '@flowforge/cats-shared';
import {
  ConnectorCommandLayer,
  ConnectorRouter,
  InboundMessageDedup,
  MemoryConnectorPermissionStore,
  MemoryConnectorThreadBindingStore,
  silentLogger,
  type ConnectorRouterOptions,
  type IOutboundAdapter,
} from '../src/index.ts';

class FakeMessageStore {
  entries: Array<Record<string, unknown>> = [];
  seq = 0;
  async append(input: object): Promise<{ id: string }> {
    this.seq++;
    this.entries.push({ id: `msg-${this.seq}`, ...input });
    return { id: `msg-${this.seq}` };
  }
}

class FakeThreadStore {
  threadSeq = 0;
  hubStates: Array<Record<string, unknown>> = [];
  async create(_userId: string, title?: string): Promise<{ id: string }> {
    this.threadSeq++;
    return { id: `t-${this.threadSeq}`, title };
  }
  async updateConnectorHubState(threadId: string, state: Record<string, unknown>): Promise<void> {
    this.hubStates.push({ threadId, ...state });
  }
}

class RecordingAdapter implements IOutboundAdapter {
  readonly connectorId = 'feishu';
  readonly sent: string[] = [];
  async sendReply(externalChatId: string, content: string): Promise<void> {
    this.sent.push(content);
  }
  async sendFormattedReply(_c: string, env: { body: string }): Promise<void> {
    this.sent.push(env.body);
  }
}

function makeRouter(over: Partial<ConnectorRouterOptions> = {}) {
  const bindingStore = new MemoryConnectorThreadBindingStore();
  const dedup = new InboundMessageDedup();
  const messageStore = new FakeMessageStore();
  const threadStore = new FakeThreadStore();
  const triggers: string[] = [];
  const adapters = new Map<string, IOutboundAdapter>();
  const adapter = new RecordingAdapter();
  adapters.set('feishu', adapter);

  const permissionStore = new MemoryConnectorPermissionStore();
  const commandLayer = new ConnectorCommandLayer({
    bindingStore,
    threadStore: { create: (u, t) => threadStore.create(u, t), get: async () => null, list: async () => [] },
    frontendBaseUrl: 'https://app',
    permissionStore,
  });

  const opts: ConnectorRouterOptions = {
    bindingStore,
    dedup,
    messageStore,
    threadStore,
    invokeTrigger: {
      trigger: async (...args) => {
        triggers.push(args.join('|'));
        return 'dispatched';
      },
    },
    defaultUserId: 'u-1',
    defaultCatId: 'cat-default',
    log: silentLogger,
    commandLayer,
    permissionStore,
    adapters,
    mentionPatterns: new Map<string, string[]>(),
    ...over,
  };
  const router = new ConnectorRouter(opts);
  return { router, bindingStore, messageStore, threadStore, triggers, adapter, permissionStore };
}

beforeEach(() => {
  registerConnectorDefinition({
    id: 'feishu',
    displayName: 'Feishu',
    icon: { type: 'svg', iconId: 'feishu' },
    themeColor: '#3370ff',
    description: 'Test connector',
  });
});

describe('ConnectorRouter', () => {
  it('新消息创建 + 绑定 + 写消息 + 触发（去重启用）', async () => {
    const { router, bindingStore, messageStore, triggers } = makeRouter();
    const r = await router.route('feishu', 'chat-1', '你好', 'm1', undefined, { id: 's1' });
    expect(r.kind).toBe('routed');
    expect(messageStore.entries).toHaveLength(1);
    expect(messageStore.entries[0]).toMatchObject({ threadId: r.threadId, source: { connector: 'feishu' } });
    const binding = await bindingStore.getByExternal('feishu', 'chat-1');
    expect(binding?.threadId).toBe(r.threadId);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toContain('cat-default');
  });

  it('重复 externalMessageId 被跳过（webhook 重试）', async () => {
    const { router, triggers } = makeRouter();
    await router.route('feishu', 'chat-1', '你好', 'dup-1');
    const r2 = await router.route('feishu', 'chat-1', '你好', 'dup-1');
    expect(r2).toEqual({ kind: 'skipped', reason: 'duplicate' });
    expect(triggers).toHaveLength(1);
  });

  it('命令以 / 开头时走命令层并写入 Hub thread', async () => {
    const { router, messageStore } = makeRouter();
    const r = await router.route('feishu', 'chat-1', '/new 会话A', 'm-new', undefined, { id: 's1' }, 'p2p');
    expect(r.kind).toBe('command');
    expect(r.threadId).toBeDefined();
    // 命令层创建了会话线程并绑定；路由器将其写入（Hub）线程
    expect(messageStore.entries.length).toBeGreaterThan(0);
  });

  it('群白名单拒绝未授权群', async () => {
    const { router, permissionStore, adapter } = makeRouter();
    await permissionStore.setWhitelistEnabled('feishu', true);
    const r = await router.route('feishu', 'chat-g', 'hi', 'm-g', undefined, { id: 's1' }, 'group');
    expect(r).toEqual({ kind: 'skipped', reason: 'group_not_allowed' });
    expect(adapter.sent.some((s) => s.includes('未授权'))).toBe(true);
  });

  it('路由携 @-mention 时定位目标猫而非默认', async () => {
    const patterns = new Map<string, string[]>([['cat-x', ['宪宪']]]);
    const { router, triggers } = makeRouter({ mentionPatterns: patterns, defaultCatId: 'cat-default' });
    await router.route('feishu', 'chat-2', '请 @宪宪 协助', 'm-@', undefined, { id: 's1' });
    expect(triggers[0]).toContain('cat-x');
  });
});