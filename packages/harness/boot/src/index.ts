/**
 * @flowforge/harness-boot — 最小 cordis 插件宿主（阶段 0 插件基座）。
 *
 * 契约（见 docs/refactor/01-stack-decision.md R13）：
 * 1. 每个功能包导出 cordis 插件（apply(ctx) 函数 / 插件类 / 插件对象）；
 * 2. 宿主按 manifest 提供 provide/inject 做安装顺序拓扑排序；
 * 3. 依赖等待与生命周期（created/ready/dispose）由 cordis Context 保证；
 * 4. 卸载 = ctx.stop()，卸载后 ctx.* 服务不可用（root context 为宽松读取：返回 undefined）。
 */
import { Context } from '@deepseek-ai/cordis'
import type { Plugin } from '@deepseek-ai/cordis'

/** 插件清单条目：R13 契约的 manifest 形态。 */
export interface PluginManifest {
  /** 插件名（日志/诊断/排序用） */
  name: string
  /** 插件入口：apply(ctx) 函数 / 插件类 / 插件对象 */
  plugin: Plugin
  /** 插件配置，透传给 ctx.plugin(plugin, config) */
  config?: Record<string, unknown>
  /** 本插件提供的 ctx.* 服务名（manifest 层声明，供拓扑排序） */
  provide?: string[]
  /** 本插件依赖的 ctx.* 服务名（manifest 层声明，供拓扑排序） */
  inject?: string[]
  /** 默认启用开关 */
  enabled?: boolean
}

function providedNames(manifest: PluginManifest): Set<string> {
  return new Set(manifest.provide ?? [])
}

/**
 * 按 provide/inject 拓扑排序（Kahn）：依赖者排在提供者之后。
 * 不参与依赖图的插件保持原顺序（稳定）。环或缺失依赖抛错，尽早暴露装配问题。
 */
export function sortManifests(manifests: PluginManifest[]): PluginManifest[] {
  const remaining = [...manifests]
  const ordered: PluginManifest[] = []
  const provided = new Set<string>()

  while (remaining.length > 0) {
    const progress = [...remaining]
    for (const manifest of progress) {
      const deps = manifest.inject ?? []
      if (deps.every((name) => provided.has(name))) {
        ordered.push(manifest)
        for (const name of providedNames(manifest)) provided.add(name)
        remaining.splice(remaining.indexOf(manifest), 1)
      }
    }
    if (remaining.length === progress.length) {
      const unresolved = remaining
        .map((m) => `${m.name}(inject: ${(m.inject ?? []).join(',')})`)
        .join(', ')
      throw new Error(`boot: 插件依赖无法满足（缺失或循环）: ${unresolved}`)
    }
  }
  return ordered
}

/** cordis 插件宿主：装配 manifest → 安装 → start/stop。 */
export class Host {
  readonly ctx: Context
  private readonly manifests: PluginManifest[] = []
  private started = false

  constructor(manifests: PluginManifest[] = []) {
    this.ctx = new Context()
    this.manifests = [...manifests]
  }

  /** 追加插件（start 前调用） */
  use(manifest: PluginManifest): this {
    if (this.started) throw new Error('boot: 宿主已启动，无法追加插件')
    this.manifests.push(manifest)
    return this
  }

  /** 按依赖顺序安装启用的插件并等待全部加载完成。
   *
   * cordis 4（dsh 定制版）：Context 无 start()，`ctx.plugin()` 返回可 await 的
   * Fiber，await 即等待加载完成（配置校验/启动错误在此重抛）。
   */
  async start(): Promise<void> {
    if (this.started) return
    const enabled = this.manifests.filter((m) => m.enabled !== false)
    const ordered = sortManifests(enabled)
    for (const manifest of ordered) {
      await this.ctx.plugin(manifest.plugin, manifest.config)
    }
    this.started = true
  }

  /** 停止宿主：卸载全部插件，ctx.* 服务不可用。
   *
   * root fiber 的 dispose = restart（cordis 4）：清空 root 的 disposables，
   * 即逐个执行所有插件子 fiber 的卸载；root fiber 自身保持 ACTIVE。
   * 卸载后读取 ctx.* 返回 undefined（root context 宽松读取，不抛错）。
   */
  async stop(): Promise<void> {
    if (!this.started) return
    await this.ctx.fiber.dispose()
    this.started = false
  }
}

/** 便捷工厂：createHost([...manifests])。 */
export function createHost(manifests: PluginManifest[] = []): Host {
  return new Host(manifests)
}
