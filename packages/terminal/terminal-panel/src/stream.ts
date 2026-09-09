/**
 * @flowforge/terminal-panel/stream — limb 输出流帧模型与 NDJSON 解码。
 *
 * 浏览器终端面板对接 limb 输出流（tmux pane / agent carrier FIFO 经 socket
 * 中继）。服务端产物以 NDJSON 行流下推，每行一个定向帧；本模块负责帧类型
 * 契约与逐行解析纯函数，便于逐字断言与单测。
 *
 * 帧词表：
 * - `output`  终端字节（xterm.write 输入）
 * - `resize`  服务端建议尺寸（col/row）
 * - `exit`    进程退出（含退出码）
 * - `title`   pane/会话标题
 * - `error`   传输/执行错误（不下发视图，交由宿主呈现）
 *
 * @module @flowforge/terminal-panel/stream
 */

/** limb 输出流定向帧。 */
export type TerminalFrame =
  | { readonly kind: 'output'; readonly data: string }
  | { readonly kind: 'resize'; readonly cols: number; readonly rows: number }
  | { readonly kind: 'exit'; readonly code: number }
  | { readonly kind: 'title'; readonly text: string }
  | { readonly kind: 'error'; readonly message: string }

/**
 * 逐行解析一条 NDJSON 帧。
 *
 * 鲁棒规则（对齐 limb NDJSON 流式语义）：空行/非 JSON/无 `kind` 的未知对象/
 * 载荷字段缺失一律返回 `null`（调用方跳过，不因脏行中断流）。
 */
export function parseNdjsonFrame(line: string): TerminalFrame | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  switch (o.kind ?? o.type) {
    case 'output':
      if (typeof o.data === 'string') return { kind: 'output', data: o.data }
      break
    case 'resize':
      if (typeof o.cols === 'number' && typeof o.rows === 'number') {
        return { kind: 'resize', cols: o.cols, rows: o.rows }
      }
      break
    case 'exit':
      if (typeof o.code === 'number') return { kind: 'exit', code: o.code }
      break
    case 'title':
      if (typeof o.text === 'string') return { kind: 'title', text: o.text }
      break
    case 'error':
      if (typeof o.message === 'string') return { kind: 'error', message: o.message }
      break
  }
  return null
}

/** 便捷：从累积缓冲中切出首条完整行，返回 [完整帧, 剩余缓冲]。 */
export function takeCompleteLine(buffer: string): { readonly frame: TerminalFrame | null; readonly rest: string } {
  const nl = buffer.indexOf('\n')
  if (nl === -1) return { frame: null, rest: buffer } // 无换行：不解析可能不完整的尾行，原样保留
  const line = buffer.slice(0, nl)
  const rest = buffer.slice(nl + 1)
  return { frame: parseNdjsonFrame(line), rest }
}

/** 逐行解码整段文本（socket data 回调典型用法），保留尾行未完成缓冲。 */
export function decodeFrames(chunk: string, buffer = ''): { readonly frames: readonly TerminalFrame[]; readonly buffer: string } {
  let pending = buffer + chunk
  const frames: TerminalFrame[] = []
  for (;;) {
    const next = takeCompleteLine(pending)
    if (next.rest === pending) break // 无换行符：剩余为不完整尾部，保留给下个 chunk
    if (next.frame !== null) frames.push(next.frame)
    pending = next.rest
  }
  return { frames, buffer: pending }
}