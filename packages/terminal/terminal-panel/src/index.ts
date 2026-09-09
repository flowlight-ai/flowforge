/**
 * @flowforge/terminal-panel — 浏览器终端面板控制器（批次57 xterm 终端面板）。
 *
 * 把 limb 输出流（{@link TerminalOutputStream}）下推的 NDJSON 定向帧应用到
 * xterm 渲染视图（{@link TerminalViewLike}），并转发用户输入/尺寸到服务端。
 * 两件依赖均经 seam 注入（R16 最小依赖策略）：生产侧由组合根用 socket 中继 +
 * `@xterm/xterm` 适配器驱动；契约测试用内存假实现驱动，不碰真实 DOM/xterm。
 *
 * 模块划分：
 * - `stream`（帧模型 + NDJSON 解码纯函数）
 * - `view`（xterm 渲染视图 seam）
 * - `panel`（帧应用纯函数 + 生命周期控制器）
 *
 * @module @flowforge/terminal-panel
 */

export { parseNdjsonFrame, takeCompleteLine, decodeFrames } from './stream.ts'
export type { TerminalFrame } from './stream.ts'

export type { TerminalViewLike } from './view.ts'

export { applyFrame, TerminalPanelController } from './panel.ts'
export type {
  TerminalOutputStream,
  TerminalPanelOptions,
  TerminalPanelStatus,
} from './panel.ts'