/**
 * @flowforge/terminal-panel/view — xterm 渲染视图 seam。
 *
 * 控制器不直接依赖 xterm 库（R16 最小依赖策略）：组合根把 `@xterm/xterm`
 * 的 `Terminal` 适配为 {@link TerminalViewLike} 注入；契约测试以内存假视图
 * 驱动控制器，不碰真实 DOM/xterm。
 *
 * @module @flowforge/terminal-panel/view
 */

/** xterm 渲染视图的业务子集（浏览器往返 view）。 */
export interface TerminalViewLike {
  /** 写入终端单元格（对齐 xterm.Terminal.write，可累积 AFD 缓冲）。 */
  write(data: string): void
  /** 同步/请求尺寸变更（col×row）。 */
  resize(cols: number, rows: number): void
  /** 设置 pane/会话标题（可传 undefined 清空）。 */
  setTitle(text: string | undefined): void
  /** 展示进程退出状态（code=null 表示清除退出态/重连）。 */
  setExitStatus(code: number | null): void
  /** 释放 DOM/取消装载（导航离开/登出时调用）。 */
  dispose(): void
}