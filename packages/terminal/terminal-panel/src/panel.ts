/**
 * @flowforge/terminal-panel/panel — 终端面板控制器。
 *
 * 把 limb 输出流（{@link TerminalOutputStream}）下推的帧应用到 xterm 视图
 * （{@link TerminalViewLike}），并转发用户输入/尺寸到服务端。两件依赖均经
 * seam 注入：生产侧组合根用 socket 中继 + `@xterm/xterm` 适配器驱动，
 * 契约测试用内存假实现驱动。
 *
 * 生命周期：构造后调用 {@link attach} 生效订阅；导航离开/登出调用
 * {@link dispose} 幂等清理。退出帧后停止消费后续帧。
 *
 * @module @flowforge/terminal-panel/panel
 */

import type { TerminalFrame } from './stream.ts'
import type { TerminalViewLike } from './view.ts'

/** limb 终端输出流（浏览器往返管道的服务端子集）。 */
export interface TerminalOutputStream {
  /** 订阅帧下推；返回注销函数。 */
  subscribe(listener: (frame: TerminalFrame) => void): () => void
  /** 把用户输入上送服务端（xterm onData → shell stdin）。 */
  sendInput(data: string): void
  /** 把浏览器尺寸上送服务端（xterm resize → tmux resize-pane）。 */
  resize(cols: number, rows: number): void
  /** 断开/释放传输（宿主登出时调用）。 */
  close(): void
}

/** 控制器状态。 */
export type TerminalPanelStatus = 'idle' | 'attached' | 'exited' | 'disposed'

/** TerminalPanelController 构造选项。 */
export interface TerminalPanelOptions {
  /** xterm 渲染视图 seam。 */
  readonly view: TerminalViewLike
  /** limb 输出流 seam。 */
  readonly stream: TerminalOutputStream
  /** 错误帧回调（不下发视图，交由宿主呈现）。 */
  readonly onError?: ((message: string) => void) | undefined
}

/** 把单帧同步到视图（纯函数，便于逐字断言）。 */
export function applyFrame(view: TerminalViewLike, frame: TerminalFrame): void {
  switch (frame.kind) {
    case 'output':
      view.write(frame.data)
      break
    case 'resize':
      view.resize(frame.cols, frame.rows)
      break
    case 'title':
      view.setTitle(frame.text)
      break
    case 'exit':
      view.setExitStatus(frame.code)
      break
    case 'error':
      break // 错误帧不触碰视图，交由 onError 回调
  }
}

/**
 * 浏览器终端面板控制器 —— 把 limb 输出流帧应用到 xterm 视图并转发输入。
 */
export class TerminalPanelController {
  private status_: TerminalPanelStatus = 'idle'
  private disposed = false
  private unsub?: (() => void) | undefined

  constructor(private readonly options: TerminalPanelOptions) {}

  /** 当前控制器状态。 */
  get status(): TerminalPanelStatus {
    return this.status_
  }

  /** 开始订阅 limb 输出流（幂等：重复 attach 无副作用）。 */
  attach(): void {
    if (this.disposed || this.status_ === 'attached' || this.status_ === 'exited') return
    this.unsub = this.options.stream.subscribe((frame) => this.onFrame(frame))
    this.status_ = 'attached'
  }

  private onFrame(frame: TerminalFrame): void {
    if (this.disposed || this.status_ === 'exited') return
    if (frame.kind === 'exit') {
      this.status_ = 'exited'
      applyFrame(this.options.view, frame)
      return
    }
    if (frame.kind === 'error') {
      this.options.onError?.(frame.message)
      return
    }
    applyFrame(this.options.view, frame)
  }

  /** 上送用户输入到服务端 shell stdin。 */
  sendInput(data: string): void {
    if (this.disposed) return
    this.options.stream.sendInput(data)
  }

  /** 上送尺寸变更到服务端并同步视野。 */
  resize(cols: number, rows: number): void {
    if (this.disposed) return
    this.options.stream.resize(cols, rows)
    this.options.view.resize(cols, rows)
  }

  /** 幂等清理：注销订阅 + 关闭流 + 释放视图。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.status_ = 'disposed'
    this.unsub?.()
    this.unsub = undefined
    this.options.stream.close()
    this.options.view.dispose()
  }
}