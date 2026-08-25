/**
 * @flowforge/forgekin-roles — T7.28 特种角色 Cordis 插件服务。
 *
 * 挂载 `ctx.forgeRoles`：注册 / 获取四角色 Forgekin 实例（F041-F044）。
 * 对齐 `forgemind/forging/forgekin_registry.py` 的注册表语义 +
 * ForgeMindPlugin.register_forgekins 钩子（F041 §3.2 步骤 5）。
 *
 * @module @flowforge/forgekin-roles
 */

import { Context, Service } from '@flowforge/cordis';
import { ForgekinRole } from './base.js';
import { DeliveryManagerForgekin, type DeliveryManagerOptions } from './delivery-manager.js';
import { DevOpsForgekin, type DevOpsOptions } from './devops.js';
import { ProductManagerForgekin, type ProductManagerOptions } from './product-manager.js';
import { SecurityOfficerForgekin, type SecurityOfficerOptions } from './security-officer.js';
import type { RoleId } from './types.js';

export * from './base.js';
export * from './delivery-manager.js';
export * from './devops.js';
export * from './product-manager.js';
export * from './security-officer.js';
export * from './types.js';

/** 四角色构造选项（F041-F044，各角色缺省能力画像）。 */
export interface RolesServiceOptions {
  /** 产品经理（鹰·凯恩）选项。 */
  readonly productManager?: ProductManagerOptions | undefined;
  /** 运维（蜂鸟·闪电）选项。 */
  readonly devops?: DevOpsOptions | undefined;
  /** 安全官（狼·阿尔法）选项。 */
  readonly securityOfficer?: SecurityOfficerOptions | undefined;
  /** 交付经理（象·牛顿）选项。 */
  readonly deliveryManager?: DeliveryManagerOptions | undefined;
  /** 额外注册的自定义角色（按 forgekinId；可选）。 */
  readonly extraRoles?: readonly ForgekinRole[] | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 特种角色域：四角色 Forgekin 注册表（F041-F044）。 */
    forgeRoles: RolesService;
  }
}

/** 缺省四角色 forgekinId（F041-F044 命名契约）。 */
export const DEFAULT_ROLE_IDS: Record<RoleId, string> = {
  'product-manager': 'forgemind:keane',
  devops: 'forgemind:hummingbird',
  'security-officer': 'forgemind:alpha',
  'delivery-manager': 'forgemind:newton',
};

/**
 * 特种角色域服务 — 四角色注册表统一入口。
 *
 * 组装：productManager / devops / securityOfficer / deliveryManager 四实例，
 * 按 forgekinId 索引；get() 支持按 RoleId 或 forgekinId 查询。
 */
export class RolesService extends Service {
  /** 角色 ID → ForgekinRole 实例表。 */
  readonly roles: ReadonlyMap<string, ForgekinRole>;

  constructor(ctx: Context, options: RolesServiceOptions) {
    super(ctx, 'forgeRoles');
    const roles = new Map<string, ForgekinRole>();
    // 缺省注入 F041-F044 命名契约的 forgekinId / name（用户可覆盖）
    const productManager = new ProductManagerForgekin({
      forgekinId: DEFAULT_ROLE_IDS['product-manager'],
      name: '凯恩',
      ...options.productManager,
    });
    const devops = new DevOpsForgekin({
      forgekinId: DEFAULT_ROLE_IDS.devops,
      name: '闪电',
      ...options.devops,
    });
    const securityOfficer = new SecurityOfficerForgekin({
      forgekinId: DEFAULT_ROLE_IDS['security-officer'],
      name: '阿尔法',
      ...options.securityOfficer,
    });
    const deliveryManager = new DeliveryManagerForgekin({
      forgekinId: DEFAULT_ROLE_IDS['delivery-manager'],
      name: '牛顿',
      ...options.deliveryManager,
    });
    roles.set(productManager.forgekinId, productManager);
    roles.set(devops.forgekinId, devops);
    roles.set(securityOfficer.forgekinId, securityOfficer);
    roles.set(deliveryManager.forgekinId, deliveryManager);
    for (const extra of options.extraRoles ?? []) {
      roles.set(extra.forgekinId, extra);
    }
    this.roles = roles;
  }

  /** 按角色 ID 获取角色实例（缺省实例：DEFAULT_ROLE_IDS；用户覆盖 forgekinId 时按类兜底）。 */
  get(id: RoleId): ForgekinRole {
    const forgekinId = DEFAULT_ROLE_IDS[id];
    const role =
      this.roles.get(forgekinId) ??
      [...this.roles.values()].find((r) => {
        switch (id) {
          case 'product-manager':
            return r instanceof ProductManagerForgekin;
          case 'devops':
            return r instanceof DevOpsForgekin;
          case 'security-officer':
            return r instanceof SecurityOfficerForgekin;
          case 'delivery-manager':
            return r instanceof DeliveryManagerForgekin;
        }
      });
    if (role === undefined) {
      throw new RangeError(`角色 ${id}（${forgekinId}）未注册`);
    }
    return role;
  }

  /** 按 forgekinId 获取角色实例（未注册返回 undefined）。 */
  getByForgekinId(forgekinId: string): ForgekinRole | undefined {
    return this.roles.get(forgekinId);
  }

  /** 注册自定义角色实例（覆盖同名 forgekinId）。 */
  register(role: ForgekinRole): void {
    if (!role.forgekinId || role.forgekinId.trim() === '') {
      throw new RangeError('自定义角色 forgekinId 不能为空');
    }
    (this.roles as Map<string, ForgekinRole>).set(role.forgekinId, role);
  }

  /** 全部角色描述列表（谱系追踪 / UI 展示）。 */
  list(): Record<string, unknown>[] {
    return [...this.roles.values()].map((r) => r.describe());
  }
}

export default function Plugin(
  ctx: Context,
  options: RolesServiceOptions = {},
): void {
  ctx.forgeRoles = new RolesService(ctx, options);
}
