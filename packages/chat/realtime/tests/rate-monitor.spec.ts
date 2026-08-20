/**
 * BroadcastRateMonitor 契约测试（阶段5 批次3，F183 Phase C2/C3）：
 * - 阈值触发 warn（字段完整）+ 去抖（同 thread 5s 内至多一次）
 * - 滑动窗口过期（fake clock 推进后旧 stamp 不计）
 * - 窗口边界（t=0 burst 与 t=windowMs burst 不叠加 —— 含闭包 cutoff）
 * - onWarn 抛错不传染 record（best-effort 观测）
 * - 机会式清扫（全过期 thread 状态被回收 + sweepCount 节流计数）
 * - getStats / reset
 *
 * @module @flowforge/chat-realtime/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { BroadcastRateMonitor } from '../src/index.ts'

interface FakeClock {
  now: number
  advance(ms: number): void
}

function fakeClock(start = 0): FakeClock {
  return { now: start, advance(ms) { this.now += ms } }
}

function monitorOpts(overrides: Record<string, unknown> = {}) {
  return { rateThreshold: 5, windowMs: 1000, warnDedupMs: 5000, ...overrides }
}

describe('BroadcastRateMonitor', () => {
  it('does not warn at or below threshold', () => {
    const clock = fakeClock()
    const onWarn = vi.fn()
    const monitor = new BroadcastRateMonitor({ ...monitorOpts({ onWarn }), now: () => clock.now })
    for (let i = 0; i < 5; i++) monitor.record('t1') // == threshold，非 >
    expect(onWarn).not.toHaveBeenCalled()
    expect(monitor.getStats('t1').windowCount).toBe(5)
  })

  it('warns with full event fields when threshold exceeded', () => {
    const clock = fakeClock(100)
    const onWarn = vi.fn()
    const monitor = new BroadcastRateMonitor({ ...monitorOpts({ onWarn }), now: () => clock.now })
    for (let i = 0; i < 6; i++) monitor.record('t1')
    expect(onWarn).toHaveBeenCalledTimes(1)
    expect(onWarn).toHaveBeenCalledWith({
      threadId: 't1',
      windowCount: 6,
      threshold: 5,
      windowMs: 1000,
      timestamp: 100,
    })
    expect(monitor.getStats('t1').lastWarnAt).toBe(100)
  })

  it('dedups warnings within the warn window per thread', () => {
    const clock = fakeClock()
    const onWarn = vi.fn()
    const monitor = new BroadcastRateMonitor({ ...monitorOpts({ onWarn }), now: () => clock.now })
    for (let i = 0; i < 6; i++) monitor.record('t1') // warn #1
    for (let i = 0; i < 10; i++) monitor.record('t1') // 持续超阈值 —— 去抖
    expect(onWarn).toHaveBeenCalledTimes(1)

    clock.advance(5000) // 去抖窗口结束
    for (let i = 0; i < 6; i++) monitor.record('t1')
    expect(onWarn).toHaveBeenCalledTimes(2)
  })

  it('tracks threads independently', () => {
    const clock = fakeClock()
    const onWarn = vi.fn()
    const monitor = new BroadcastRateMonitor({ ...monitorOpts({ onWarn }), now: () => clock.now })
    for (let i = 0; i < 6; i++) monitor.record('t1') // t1 warn
    for (let i = 0; i < 6; i++) monitor.record('t2') // t2 独立 warn
    expect(onWarn).toHaveBeenCalledTimes(2)
    expect(onWarn).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadId: 't1' }))
    expect(onWarn).toHaveBeenNthCalledWith(2, expect.objectContaining({ threadId: 't2' }))
  })

  it('expires stamps outside the sliding window', () => {
    const clock = fakeClock()
    const onWarn = vi.fn()
    const monitor = new BroadcastRateMonitor({ ...monitorOpts({ onWarn }), now: () => clock.now })
    for (let i = 0; i < 6; i++) monitor.record('t1') // warn（窗口内 6 条）
    expect(onWarn).toHaveBeenCalledTimes(1)

    clock.advance(2000) // 全部过期
    monitor.record('t1') // 新窗口仅 1 条
    expect(monitor.getStats('t1').windowCount).toBe(1)
    expect(onWarn).toHaveBeenCalledTimes(1) // 不再超阈值
  })

  it('does not double-count at the inclusive window boundary', () => {
    const clock = fakeClock()
    const onWarn = vi.fn()
    const monitor = new BroadcastRateMonitor({
      ...monitorOpts({ rateThreshold: 10, onWarn }),
      now: () => clock.now,
    })
    for (let i = 0; i < 10; i++) monitor.record('t1') // t=0 共 10 条（== 阈值，无 warn）
    clock.advance(1000) // 恰好一个窗口
    monitor.record('t1') // cutoff 含闭包 → t=0 的 10 条全部过期
    expect(monitor.getStats('t1').windowCount).toBe(1)
    expect(onWarn).not.toHaveBeenCalled()
  })

  it('swallows onWarn errors (best-effort observability)', () => {
    const clock = fakeClock()
    const onWarn = vi.fn(() => { throw new Error('logger exploded') })
    const monitor = new BroadcastRateMonitor({ ...monitorOpts({ onWarn }), now: () => clock.now })
    expect(() => {
      for (let i = 0; i < 6; i++) monitor.record('t1')
    }).not.toThrow()
  })

  it('evicts fully-expired thread state via throttled sweeps', () => {
    const clock = fakeClock()
    const monitor = new BroadcastRateMonitor({ ...monitorOpts(), now: () => clock.now })
    for (let i = 0; i < 3; i++) monitor.record('t1')
    clock.advance(1500)
    monitor.record('t2') // 触发机会式清扫（>= 一个窗口未清扫）
    expect(monitor.getStats('t1').windowCount).toBe(0) // t1 状态被整体回收
    expect(monitor.sweepCount).toBeGreaterThanOrEqual(1)
  })

  it('throttles sweeps to at most once per window', () => {
    const clock = fakeClock()
    const monitor = new BroadcastRateMonitor({ ...monitorOpts(), now: () => clock.now })
    monitor.record('t1')
    for (let i = 0; i < 20; i++) monitor.record('t2') // 同窗口内高频 record
    expect(monitor.sweepCount).toBe(1) // 仅首条触发
  })

  it('reset clears per-thread state without touching others', () => {
    const clock = fakeClock()
    const monitor = new BroadcastRateMonitor({ ...monitorOpts(), now: () => clock.now })
    for (let i = 0; i < 3; i++) monitor.record('t1')
    monitor.record('t2')
    monitor.reset('t1')
    expect(monitor.getStats('t1').windowCount).toBe(0)
    expect(monitor.getStats('t2').windowCount).toBe(1)
  })

  it('resetAll clears all state and sweep counter', () => {
    const clock = fakeClock()
    const monitor = new BroadcastRateMonitor({ ...monitorOpts(), now: () => clock.now })
    monitor.record('t1')
    clock.advance(1500)
    monitor.record('t2')
    monitor.resetAll()
    expect(monitor.getStats('t1').windowCount).toBe(0)
    expect(monitor.getStats('t2').windowCount).toBe(0)
    expect(monitor.sweepCount).toBe(0)
  })
})
