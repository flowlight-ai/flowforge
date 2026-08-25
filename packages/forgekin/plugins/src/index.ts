/**
 * index — @flowforge/forgekin-plugins 插件市场（T7.11/F11）。
 *
 * 入口：`ctx.forgePlugins`（MarketplaceService）：
 *   MarketplaceRegistry 内置/本地/远程注册表 + Marketplace 一键安装/卸载/更新/验证
 *   （依赖递归/版本兼容/checksum/安全扫描/installed.json）+ FrontendPluginRegistry
 *   前端插件六挂载点。
 *
 * @module @flowforge/forgekin-plugins
 */

export * from './types.js';
export * from './registry.js';
export * from './frontend-registry.js';
export * from './marketplace.js';
export * from './service.js';
export { default } from './service.js';
