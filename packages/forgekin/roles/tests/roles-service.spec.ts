/**
 * @flowforge/forgekin-roles — T7.28 RolesService 插件挂载验证。
 *
 * 对齐 ForgeMindPlugin.register_forgekins 钩子（F041 §3.2 步骤 5）：
 *   - 插件挂载 ctx.forgeRoles（Cordis Service）
 *   - 四角色注册表（F041-F044 命名契约）
 *   - get / getByForgekinId / register / list
 *   - 自定义角色注册（覆盖同名 forgekinId）
 *
 * @module @flowforge/forgekin-roles/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import { ForgekinRole } from '../src/base.js';
import { DeliveryManagerForgekin } from '../src/delivery-manager.js';
import { DevOpsForgekin } from '../src/devops.js';
import { ProductManagerForgekin } from '../src/product-manager.js';
import { SecurityOfficerForgekin } from '../src/security-officer.js';
import {
  DEFAULT_ROLE_IDS,
  RolesService,
  RolesServiceOptions,
} from '../src/roles-service.js';
import plugin from '../src/index.js';

describe('RolesService 插件（ctx.forgeRoles）', () => {
  it('插件挂载：ctx.forgeRoles 为 RolesService 实例', () => {
    const ctx = new Context();
    plugin(ctx, {});
    expect(ctx.forgeRoles).toBeInstanceOf(RolesService);
  });

  it('四角色注册：默认 forgekinId 符合 F041-F044 命名契约', () => {
    const ctx = new Context();
    plugin(ctx, {});
    expect(DEFAULT_ROLE_IDS).toEqual({
      'product-manager': 'forgemind:keane',
      devops: 'forgemind:hummingbird',
      'security-officer': 'forgemind:alpha',
      'delivery-manager': 'forgemind:newton',
    });
    expect(ctx.forgeRoles.get('product-manager')).toBeInstanceOf(ProductManagerForgekin);
    expect(ctx.forgeRoles.get('devops')).toBeInstanceOf(DevOpsForgekin);
    expect(ctx.forgeRoles.get('security-officer')).toBeInstanceOf(SecurityOfficerForgekin);
    expect(ctx.forgeRoles.get('delivery-manager')).toBeInstanceOf(DeliveryManagerForgekin);
  });

  it('getByForgekinId：按 forgekinId 查询 / 未注册返回 undefined', () => {
    const ctx = new Context();
    plugin(ctx, {});
    const keane = ctx.forgeRoles.getByForgekinId('forgemind:keane');
    expect(keane).toBeInstanceOf(ProductManagerForgekin);
    expect(ctx.forgeRoles.getByForgekinId('forgemind:nobody')).toBeUndefined();
  });

  it('register：注册自定义角色，list 包含自定义角色', () => {
    const ctx = new Context();
    plugin(ctx, {});
    class CustomRole extends ForgekinRole {
      override observe(): Promise<Record<string, unknown>> {
        return Promise.resolve({});
      }
      override act(): Promise<import('../src/types.js').RoleActionResult> {
        throw new RangeError('not implemented');
      }
      override verify(): Promise<boolean> {
        return Promise.resolve(true);
      }
    }
    const custom = new CustomRole({ forgekinId: 'forgemind:custom', name: '自定义' });
    ctx.forgeRoles.register(custom);
    expect(ctx.forgeRoles.getByForgekinId('forgemind:custom')).toBe(custom);
    expect(ctx.forgeRoles.list()).toHaveLength(5);
  });

  it('register：空 forgekinId 抛 RangeError', () => {
    const ctx = new Context();
    plugin(ctx, {});
    class CustomRole extends ForgekinRole {
      override observe(): Promise<Record<string, unknown>> {
        return Promise.resolve({});
      }
      override act(): Promise<import('../src/types.js').RoleActionResult> {
        throw new RangeError('not implemented');
      }
      override verify(): Promise<boolean> {
        return Promise.resolve(true);
      }
    }
    expect(() =>
      ctx.forgeRoles.register(new CustomRole({ forgekinId: '', name: 'x' })),
    ).toThrow(RangeError);
  });

  it('extraRoles 选项：构造时注册额外角色', () => {
    class ExtraRole extends ForgekinRole {
      override observe(): Promise<Record<string, unknown>> {
        return Promise.resolve({});
      }
      override act(): Promise<import('../src/types.js').RoleActionResult> {
        throw new RangeError('not implemented');
      }
      override verify(): Promise<boolean> {
        return Promise.resolve(true);
      }
    }
    const extra = new ExtraRole({ forgekinId: 'forgemind:extra', name: '额外' });
    const ctx = new Context();
    const options: RolesServiceOptions = { extraRoles: [extra] };
    plugin(ctx, options);
    expect(ctx.forgeRoles.getByForgekinId('forgemind:extra')).toBe(extra);
  });

  it('用户覆盖 forgekinId 时 get() 按角色类兜底（instanceof）', () => {
    const ctx = new Context();
    const options: RolesServiceOptions = {
      productManager: { forgekinId: 'forgemind:keane-v2', name: '凯恩二世' },
    };
    plugin(ctx, options);
    const pm = ctx.forgeRoles.get('product-manager');
    expect(pm).toBeInstanceOf(ProductManagerForgekin);
    expect(pm.forgekinId).toBe('forgemind:keane-v2');
  });

  it('list() 返回四角色谱系描述（describe 字段齐全）', () => {
    const ctx = new Context();
    plugin(ctx, {});
    const list = ctx.forgeRoles.list();
    expect(list).toHaveLength(4);
    const keane = list.find((d) => d.forgekin_id === 'forgemind:keane');
    expect(keane?.species_chinese).toBe('组织形态');
    expect(keane?.can_self_evolve).toBe(false); // E1 觉醒
    expect(keane?.can_forge_new_forgekin).toBe(false); // E1 进化
  });
});
