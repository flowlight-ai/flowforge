/**
 * @flowforge/terminal-panel 契约测试（批次57 T8.x 浏览器终端面板）。
 *
 * 以内存假视图（{@link TerminalViewLike} 实现）与假输出流（
 * {@link TerminalOutputStream} 实现）驱动纯函数与控制器，逐字断言：
 *  - NDJSON 帧解析：五类定向帧 + 脏行/空行/字段缺失的鲁棒跳过 +
 *    跨 chunk 边界的长行缓冲
 *  - 帧应用：output/resize/title/exit → 视图对应调用，error → onError
 *  - 控制器生命周期：attach 订阅、exit 后停止消费、dispose 幂等清理
 *  - 输入/尺寸上送：sendInput / resize 转发且 disposed 后静默
 * 不碰真实 xterm/DOM（R16 最小依赖 —— 视图与流均为注入 seam）。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  type TerminalFrame,
  type TerminalOutputStream,
  type TerminalViewLike,
  parseNdjsonFrame,
  takeCompleteLine,
  decodeFrames,
  applyFrame,
  TerminalPanelController,
} from '../src/index.ts'

/** 可复用的内存假视图：记录 write/resize/setTitle/setExitStatus/dispose 调用。 */
function makeFakeView(): {
  view: TerminalViewLike
  writes: string[]
  resizes: Array<{ cols: number; rows: number }>
  titles: Array<string | undefined>
  exitStatuses: Array<number | null>
  disposeTimes: () => number
} {
  const writes: string[] = []
  const resizes: Array<{ cols: number; rows: number }> = []
  const titles: Array<string | undefined> = []
  const exitStatuses: Array<number | null> = []
  let disposeTimes = 0
  const view: TerminalViewLike = {
    write: (data) => {
      writes.push(data)
    },
    resize: (cols, rows) => {
      resizes.push({ cols, rows })
    },
    setTitle: (text) => {
      titles.push(text)
    },
    setExitStatus: (code) => {
      exitStatuses.push(code)
    },
    dispose: () => {
      disposeTimes += 1
    },
  }
  return { view, writes, resizes, titles, exitStatuses, disposeTimes: () => disposeTimes }
}

/** 可复用的内存假输出流：记录 subscribe/sendInput/resize/close，暴露 fire() 注入帧。 */
function makeFakeStream(): {
  stream: TerminalOutputStream
  sentInput: string[]
  resizes: Array<{ cols: number; rows: number }>
  closeTimes: () => number
  fire: (frame: TerminalFrame) => void
} {
  const sentInput: string[] = []
  const resizes: Array<{ cols: number; rows: number }> = []
  let closeTimes = 0
  let listener: ((frame: TerminalFrame) => void) | undefined
  const stream: TerminalOutputStream = {
    subscribe: (l) => {
      listener = l
      return () => {
        listener = undefined
      }
    },
    sendInput: (data) => {
      sentInput.push(data)
    },
    resize: (cols, rows) => {
      resizes.push({ cols, rows })
    },
    close: () => {
      closeTimes += 1
    },
  }
  return {
    stream,
    sentInput,
    resizes,
    closeTimes: () => closeTimes,
    fire: (frame) => listener?.(frame),
  }
}

describe('stream：NDJSON 帧解析（批次57）', () => {
  it('叠加 kind 解析五类定向帧', () => {
    expect(parseNdjsonFrame('{"kind":"output","data":"hi\\n"}')).toEqual({
      kind: 'output',
      data: 'hi\n',
    })
    expect(parseNdjsonFrame('{"kind":"resize","cols":80,"rows":24}')).toEqual({
      kind: 'resize',
      cols: 80,
      rows: 24,
    })
    expect(parseNdjsonFrame('{"kind":"exit","code":0}')).toEqual({ kind: 'exit', code: 0 })
    expect(parseNdjsonFrame('{"kind":"title","text":"bash"}')).toEqual({
      kind: 'title',
      text: 'bash',
    })
    expect(parseNdjsonFrame('{"kind":"error","message":"boom"}')).toEqual({
      kind: 'error',
      message: 'boom',
    })
  })

  it('兼容 `type` 别名字段（服务端旧命名）', () => {
    expect(parseNdjsonFrame('{"type":"output","data":"x"}')).toEqual({
      kind: 'output',
      data: 'x',
    })
  })

  it('脏输入鲁棒跳过：空行/非 JSON/未知对象/字段缺失 → null', () => {
    expect(parseNdjsonFrame('')).toBeNull()
    expect(parseNdjsonFrame('   ')).toBeNull()
    expect(parseNdjsonFrame('not-json')).toBeNull()
    expect(parseNdjsonFrame('123')).toBeNull()
    expect(parseNdjsonFrame('[1,2]')).toBeNull()
    expect(parseNdjsonFrame('{"kind":"unknown"}')).toBeNull()
    expect(parseNdjsonFrame('{"kind":"output"}')).toBeNull()
    expect(parseNdjsonFrame('{"kind":"resize","cols":80}')).toBeNull() // 缺 rows
    expect(parseNdjsonFrame('{"kind":"exit","code":"0"}')).toBeNull() // 类型不符
  })

  it('takeCompleteLine：以换行切分首行，返回完整帧与剩余缓冲', () => {
    expect(takeCompleteLine('{"kind":"output","data":"a"}\n{"kind":"exit","code":1}')).toEqual({
      frame: { kind: 'output', data: 'a' },
      rest: '{"kind":"exit","code":1}',
    })
    // 无换行：无完整帧，原样保留为剩余缓冲（不解析可能不完整的尾行）
    expect(takeCompleteLine('tail-without-newline')).toEqual({
      frame: null,
      rest: 'tail-without-newline',
    })
  })

  it('decodeFrames：跨 chunk 分段保留尾行缓冲（长行不丢数据）', () => {
    // chunk A：`output` 行不完整，整段保留为缓冲
    const a = decodeFrames('{"kind":"output","data":"he')
    expect(a).toEqual({ frames: [], buffer: '{"kind":"output","data":"he' })

    // chunk B：补齐 output 行（带换行），释放该帧；缓冲清空
    const b = decodeFrames('llo"}\n', a.buffer)
    expect(b).toEqual({ frames: [{ kind: 'output', data: 'hello' }], buffer: '' })

    // 后续完整行（带换行）正常解出
    const c = decodeFrames('{"kind":"title","text":"t"}\n', b.buffer)
    expect(c).toEqual({ frames: [{ kind: 'title', text: 't' }], buffer: '' })

    // 未接换行的尾行始终保留为缓冲，等待下一个 chunk
    const d = decodeFrames('{"kind":"output","data":"tail')
    expect(d).toEqual({ frames: [], buffer: '{"kind":"output","data":"tail' })
  })

  it('decodeFrames：脏行不中断后续有效帧', () => {
    const { frames, buffer } = decodeFrames(
      'garbage\n{"kind":"exit","code":0}\n{"kind":"output","data":"tail',
    )
    expect(frames).toEqual([{ kind: 'exit', code: 0 }])
    expect(buffer).toBe('{"kind":"output","data":"tail')
  })
})

describe('applyFrame：单帧同步到视图（批次57）', () => {
  it('output → write；resize → resize；title → setTitle；exit → setExitStatus', () => {
    const { view, writes, resizes, titles, exitStatuses } = makeFakeView()
    applyFrame(view, { kind: 'output', data: 'ok' })
    applyFrame(view, { kind: 'resize', cols: 120, rows: 30 })
    applyFrame(view, { kind: 'title', text: 'zsh' })
    applyFrame(view, { kind: 'exit', code: 2 })
    expect(writes).toEqual(['ok'])
    expect(resizes).toEqual([{ cols: 120, rows: 30 }])
    expect(titles).toEqual(['zsh'])
    expect(exitStatuses).toEqual([2])
  })

  it('error 帧不触碰视图（交由宿主 onError 呈现）', () => {
    const { view, writes } = makeFakeView()
    applyFrame(view, { kind: 'error', message: 'boom' })
    expect(writes).toEqual([])
  })
})

describe('TerminalPanelController：生命周期与转发（批次57）', () => {
  it('attach 后订阅流并应用帧，初始状态 idle → attached', () => {
    const { view } = makeFakeView()
    const stream = makeFakeStream()
    const controller = new TerminalPanelController({ view, stream: stream.stream })
    expect(controller.status).toBe('idle')

    controller.attach()
    expect(controller.status).toBe('attached')
    stream.fire({ kind: 'output', data: 'hi' })
    expect(stream.sentInput).toEqual([]) // 帧不触发上送
  })

  it('attach 幂等：重复 attach 无副作用（不重复订阅）', () => {
    const { view } = makeFakeView()
    const stream = makeFakeStream()
    const controller = new TerminalPanelController({ view, stream: stream.stream })
    const fireSpy = stream.fire
    controller.attach()
    controller.attach()
    controller.attach()
    fireSpy({ kind: 'title', text: 'only-once' })
  })

  it('exit 帧置 exited 并停止消费后续帧', () => {
    const { view, writes, exitStatuses } = makeFakeView()
    const stream = makeFakeStream()
    const controller = new TerminalPanelController({ view, stream: stream.stream })
    controller.attach()

    stream.fire({ kind: 'output', data: 'a' })
    stream.fire({ kind: 'exit', code: 0 })
    stream.fire({ kind: 'output', data: 'after-exit' }) // 应被忽略

    expect(controller.status).toBe('exited')
    expect(exitStatuses).toEqual([0])
    expect(writes).toEqual(['a'])
  })

  it('error 帧触发 onError 且不回写视图；处理后可继续消费', () => {
    const { view, writes } = makeFakeView()
    const stream = makeFakeStream()
    const onError = vi.fn()
    const controller = new TerminalPanelController({ view, stream: stream.stream, onError })
    controller.attach()

    stream.fire({ kind: 'error', message: 'boom' })
    stream.fire({ kind: 'output', data: 'still-ok' })
    expect(onError).toHaveBeenCalledWith('boom')
    expect(writes).toEqual(['still-ok'])
  })

  it('sendInput / resize 上送流；dispose 后幂等清理并静默', () => {
    const { view, disposeTimes } = makeFakeView()
    const stream = makeFakeStream()
    const controller = new TerminalPanelController({ view, stream: stream.stream })
    controller.attach()

    controller.sendInput('ls')
    controller.resize(80, 24)
    expect(stream.sentInput).toEqual(['ls'])
    expect(stream.resizes).toEqual([{ cols: 80, rows: 24 }])

    controller.dispose()
    controller.dispose()
    expect(controller.status).toBe('disposed')
    expect(disposeTimes()).toBe(1)
    expect(stream.closeTimes()).toBe(1)
    stream.fire({ kind: 'output', data: 'after-dispose' })
    controller.sendInput('rm')
    expect(stream.sentInput).toEqual(['ls']) // 静默丢弃
  })
})