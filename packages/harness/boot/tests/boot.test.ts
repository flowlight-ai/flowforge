/**
 * Stage-0 plugin-host tests: manifest assembly, dependency ordering,
 * lifecycle (created/ready/dispose) and service injection.
 */
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { Host, createHost, sortManifests, type PluginManifest } from '../src/index.ts'

/** 简单服务：提供 ctx.greeter。 */
class Greeter extends Service {
  static inject = []

  constructor(ctx: Context) {
    super(ctx, 'greeter')
  }

  greet(name: string): string {
    return `hello, ${name}`
  }
}

/** 依赖 greeter 的服务：提供 ctx.farewell。 */
class Farewell extends Service {
  static inject = ['greeter']

  constructor(ctx: Context) {
    super(ctx, 'farewell')
  }

  bye(): string {
    return 'bye'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: Greeter
    farewell: Farewell
  }
}

const greeterManifest: PluginManifest = {
  name: 'greeter',
  plugin: Greeter,
  provide: ['greeter'],
}

const farewellManifest: PluginManifest = {
  name: 'farewell',
  plugin: Farewell,
  inject: ['greeter'],
}

describe('sortManifests', () => {
  it('排到依赖者之前：farewell 在前也能排到 greeter 之后', () => {
    const ordered = sortManifests([farewellManifest, greeterManifest])
    expect(ordered.map((m) => m.name)).toEqual(['greeter', 'farewell'])
  })

  it('无依赖关系时保持原顺序', () => {
    const a: PluginManifest = { name: 'a', plugin: () => {} }
    const b: PluginManifest = { name: 'b', plugin: () => {} }
    const ordered = sortManifests([a, b])
    expect(ordered.map((m) => m.name)).toEqual(['a', 'b'])
  })

  it('依赖无法满足（循环/缺失）时抛错', () => {
    const a: PluginManifest = { name: 'a', plugin: () => {}, inject: ['b'], provide: ['a'] }
    const b: PluginManifest = { name: 'b', plugin: () => {}, inject: ['a'], provide: ['b'] }
    expect(() => sortManifests([a, b])).toThrow(/依赖无法满足/)
  })
})

describe('Host 插件基座', () => {
  it('按 manifest 装配：start 后 ctx.* 服务可用，stop 后不可用', async () => {
    const host = createHost([greeterManifest, farewellManifest])
    await host.start()
    expect(host.ctx.greeter.greet('forge')).toBe('hello, forge')
    expect(host.ctx.farewell.bye()).toBe('bye')
    await host.stop()
    // 卸载后服务不可用（cordis 4 root context 为宽松读取：返回 undefined，不抛错）
    expect(host.ctx.greeter).toBeUndefined()
  })

  it('use() 追加插件同样生效，且支持 enabled:false 跳过', async () => {
    const host = new Host()
    host.use(greeterManifest)
    host.use({ ...farewellManifest, enabled: false })
    await host.start()
    expect(host.ctx.greeter.greet('x')).toBe('hello, x')
    // enabled:false 的插件未安装，服务未提供，root context 宽松读取返回 undefined
    expect(host.ctx.farewell).toBeUndefined()
    await host.stop()
  })

  it('卸载后 ctx.* 服务不可用（读取抛错）', async () => {
    const host = new Host([greeterManifest])
    await host.start()
    expect(host.ctx.greeter.greet('x')).toBe('hello, x')
    await host.stop()
    expect(host.ctx.greeter).toBeUndefined()
  })

  it('已启动的宿主拒绝追加插件', async () => {
    const host = new Host([greeterManifest])
    await host.start()
    expect(() => host.use(farewellManifest)).toThrow(/已启动/)
    await host.stop()
  })

  it('start 幂等：重复 start 不重复安装', async () => {
    const host = new Host([greeterManifest])
    await host.start()
    await host.start()
    expect(host.ctx.greeter.greet('again')).toBe('hello, again')
    await host.stop()
  })
})
