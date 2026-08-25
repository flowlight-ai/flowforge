/**
 * @flowforge/forgekin-roles — T7.28 特种角色（F041-F044）Cordis 插件入口。
 *
 * 四角色子代理：ProductManager（鹰·凯恩）/ DevOps（蜂鸟·闪电）/
 * SecurityOfficer（狼·阿尔法）/ DeliveryManager（象·牛顿）。
 * 挂载 `ctx.forgeRoles`（RolesService 注册表）。
 *
 * @module @flowforge/forgekin-roles
 */

export * from './base.js';
export * from './delivery-manager.js';
export * from './devops.js';
export * from './product-manager.js';
export * from './security-officer.js';
export * from './types.js';
export * from './roles-service.js';
export { default } from './roles-service.js';
