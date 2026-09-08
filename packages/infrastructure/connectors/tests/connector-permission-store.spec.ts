/**
 * 权限存储契约测试 — Memory + Redis（端口仿真）。
 * 覆盖群白名单、管理员、命令限制、getConfig 快照。真实存储，禁 Mock。
 */

import { describe, expect, it } from 'vitest';

import {
  MemoryConnectorPermissionStore,
  type IConnectorPermissionStore,
  RedisConnectorPermissionStore,
} from '../src/index.ts';
import { FakeConnectorRedis } from './helpers/fake-redis.ts';

describe.each([
  ['Memory', () => new MemoryConnectorPermissionStore() as IConnectorPermissionStore],
  ['Redis', () => new RedisConnectorPermissionStore(new FakeConnectorRedis()) as IConnectorPermissionStore],
])('%s ConnectorPermissionStore', (_name, factory) => {
  it('白名单默认关闭时所有群放行；开启后仅允许已添加群', async () => {
    const store = factory();
    expect(await store.isGroupAllowed('feishu', 'g-1')).toBe(true);

    await store.setWhitelistEnabled('feishu', true);
    expect(await store.isGroupAllowed('feishu', 'g-1')).toBe(false);

    await store.allowGroup('feishu', 'g-1', '产品群');
    expect(await store.isGroupAllowed('feishu', 'g-1')).toBe(true);
    expect(await store.isGroupAllowed('feishu', 'g-2')).toBe(false);
  });

  it('allowGroup/denyGroup/listAllowedGroups 往返', async () => {
    const store = factory();
    await store.allowGroup('feishu', 'g-1');
    await store.allowGroup('feishu', 'g-2', '测试群');
    expect(await store.listAllowedGroups('feishu')).toHaveLength(2);

    expect(await store.denyGroup('feishu', 'g-1')).toBe(true);
    expect(await store.denyGroup('feishu', 'g-1')).toBe(false);
    expect(await store.listAllowedGroups('feishu')).toHaveLength(1);
    expect((await store.listAllowedGroups('feishu'))[0]?.externalChatId).toBe('g-2');
  });

  it('管理员 isAdmin/setAdminOpenIds/hasAdminConfig', async () => {
    const store = factory();
    expect(await store.hasAdminConfig('feishu')).toBe(false);
    expect(await store.isAdmin('feishu', 'ou_1')).toBe(false);

    await store.setAdminOpenIds('feishu', ['ou_1', 'ou_2']);
    expect(await store.isAdmin('feishu', 'ou_1')).toBe(true);
    expect(await store.isAdmin('feishu', 'ou_3')).toBe(false);
    expect(await store.hasAdminConfig('feishu')).toBe(true);
    expect(await store.getAdminOpenIds('feishu')).toEqual(['ou_1', 'ou_2']);
  });

  it('命令限制 isCommandAdminOnly/setCommandAdminOnly', async () => {
    const store = factory();
    expect(await store.isCommandAdminOnly('feishu')).toBe(false);
    await store.setCommandAdminOnly('feishu', true);
    expect(await store.isCommandAdminOnly('feishu')).toBe(true);
  });

  it('getConfig 返回完整快照', async () => {
    const store = factory();
    await store.setWhitelistEnabled('feishu', true);
    await store.setCommandAdminOnly('feishu', true);
    await store.setAdminOpenIds('feishu', ['ou_1']);
    await store.allowGroup('feishu', 'g-1');
    const cfg = await store.getConfig('feishu');
    expect(cfg.whitelistEnabled).toBe(true);
    expect(cfg.commandAdminOnly).toBe(true);
    expect(cfg.adminOpenIds).toEqual(['ou_1']);
    expect(cfg.allowedGroups).toHaveLength(1);
  });
});