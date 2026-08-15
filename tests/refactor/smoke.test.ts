/**
 * Stage-0 smoke test: verifies the vendored cordis runtime resolves and works
 * inside the FlowForge 0.2.0 TypeScript workspace, including the plugin host
 * (packages/harness/boot) assembly.
 */
import { describe, expect, it } from 'vitest'
import { Context, FiberState, Service } from '@flowforge/cordis'
import { createHost } from '@flowforge/harness-boot'

/** Minimal example service, mirroring cordis README conventions. */
class Clock extends Service {
  static inject = []

  constructor(ctx: Context) {
    super(ctx, 'clock')
  }

  now(): number {
    return Date.now()
  }
}

declare module '@flowforge/cordis' {
  interface Context {
    clock: Clock
  }
}

describe('vendor/cordis runtime', () => {
  it('creates an ACTIVE root Context; root fiber dispose restarts', async () => {
    const ctx = new Context()
    // cordis 4（dsh 定制版）：root fiber 恒 ACTIVE，无 start()
    expect(ctx.fiber.state).toBe(FiberState.ACTIVE)
    await ctx.fiber.dispose()
    expect(ctx.fiber.state).toBe(FiberState.ACTIVE)
  })

  it('registers a service on ctx and unloads it with the root fiber', async () => {
    const ctx = new Context()
    // await ctx.plugin() 即等待加载完成
    await ctx.plugin(Clock)
    expect(typeof ctx.clock.now()).toBe('number')
    await ctx.fiber.dispose()
    // 卸载后服务不可用（root context 宽松读取：返回 undefined，不抛错）
    expect(ctx.clock).toBeUndefined()
  })

  it('emits and receives events scoped to the context', async () => {
    const ctx = new Context()
    const received: string[] = []
    ctx.on('ping', (payload: string) => {
      received.push(payload)
    })
    await ctx.plugin(() => {})
    ctx.emit('ping', 'hello')
    ctx.emit('ping', 'world')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(received).toEqual(['hello', 'world'])
    await ctx.fiber.dispose()
  })
})

describe('plugin host assembly (@flowforge/harness-boot)', () => {
  it('mounts a plugin through the host manifest and unmounts on stop', async () => {
    const host = createHost([{ name: 'clock', plugin: Clock, provide: ['clock'] }])
    await host.start()
    expect(typeof host.ctx.clock.now()).toBe('number')
    await host.stop()
    // 卸载后服务不可用（root context 宽松读取：返回 undefined，不抛错）
    expect(host.ctx.clock).toBeUndefined()
  })
})
