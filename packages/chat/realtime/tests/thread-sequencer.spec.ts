/**
 * ThreadSequencer 契约测试（阶段5 批次3）：
 * - thread-scoped 独立计数（跨 thread 不保证全局顺序，KD-9）
 * - peek 只读 / bumpTo 单调保持（低值 no-op、高值抬升后续 next）
 * - epoch 构造期生成且稳定 / 覆盖注入
 * - reset / resetAll
 *
 * @module @flowforge/chat-realtime/tests
 */

import { describe, expect, it } from 'vitest'
import { ThreadSequencer } from '../src/index.ts'

describe('ThreadSequencer', () => {
  it('assigns independent monotonic seqs per thread', () => {
    const seq = new ThreadSequencer('epoch-1')
    expect(seq.next('t1')).toBe(1)
    expect(seq.next('t1')).toBe(2)
    expect(seq.next('t2')).toBe(1) // thread-scoped，跨 thread 独立
    expect(seq.next('t1')).toBe(3)
  })

  it('peek reads current seq without incrementing', () => {
    const seq = new ThreadSequencer('epoch-1')
    expect(seq.peek('t1')).toBe(0) // unseen thread
    seq.next('t1')
    expect(seq.peek('t1')).toBe(1)
    expect(seq.peek('t1')).toBe(1) // 不递增
  })

  it('bumpTo is a no-op for lower or invalid values', () => {
    const seq = new ThreadSequencer('epoch-1')
    seq.next('t1') // 1
    seq.bumpTo('t1', 0)
    seq.bumpTo('t1', -5)
    seq.bumpTo('t1', 1) // equal → no-op
    expect(seq.next('t1')).toBe(2)
  })

  it('bumpTo preserves monotonicity after a seq override', () => {
    const seq = new ThreadSequencer('epoch-1')
    seq.next('t1') // 1
    seq.bumpTo('t1', 100) // override 路径（确定性夹具）
    expect(seq.next('t1')).toBe(101) // 后续自动分配不回退
    expect(seq.next('t1')).toBe(102)
  })

  it('bumpTo on unseen thread seeds the counter', () => {
    const seq = new ThreadSequencer('epoch-1')
    seq.bumpTo('t9', 7)
    expect(seq.next('t9')).toBe(8)
  })

  it('epoch is stable for the sequencer lifetime and honors override', () => {
    const seq = new ThreadSequencer('boot-uuid-42')
    expect(seq.epoch).toBe('boot-uuid-42')
    seq.next('t1')
    expect(seq.epoch).toBe('boot-uuid-42') // 构造期生成，终身稳定
  })

  it('generates a random epoch when not overridden', () => {
    const a = new ThreadSequencer()
    const b = new ThreadSequencer()
    expect(a.epoch).toBeTruthy()
    expect(a.epoch).not.toBe(b.epoch)
  })

  it('reset clears one thread without touching others', () => {
    const seq = new ThreadSequencer('epoch-1')
    seq.next('t1')
    seq.next('t2')
    seq.reset('t1')
    expect(seq.peek('t1')).toBe(0)
    expect(seq.peek('t2')).toBe(1)
  })

  it('resetAll clears all thread seq state', () => {
    const seq = new ThreadSequencer('epoch-1')
    seq.next('t1')
    seq.next('t2')
    seq.resetAll()
    expect(seq.peek('t1')).toBe(0)
    expect(seq.peek('t2')).toBe(0)
  })
})
