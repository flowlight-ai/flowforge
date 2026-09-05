/**
 * @flowforge/plugins-video-protocol — 视频/图片协议模板引擎（C35，clowder protocol-server 核心移植）。
 *
 * 纯函数协议引擎：`{{var | default:literal}}` 占位符渲染 + sync/async 请求
 * 构建 + JSONPath 提取/状态归类 + capability inherit 链解析。video-analysis
 * 与 video-gen 插件在其上嵌入各自的协议模板。
 *
 * @module @flowforge/plugins-video-protocol
 */

export * from './engine.ts';
