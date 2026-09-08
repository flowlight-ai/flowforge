/**
 * Host 上下文与浏览器下载上下文的控制反转 seam 及其真实内存实现。
 *
 * 本包不依赖 cordis：在 dsh 里由 `Context`（命令注册、路由注册、服务获取）与
 * 浏览器 `document/a`（下载保存）承担的能力，全部经这里声明的端口注入。宿主侧
 * 由 {@link HostContextPort} 提供命令/路由注册与配置、导出数据源；浏览器侧由
 * {@link DownloadContextPort} 提供 `fetch`、磁盘保存与同源基址。契约测试直接使用
 * 各自内存实现（铁律 T9）。
 */

import type {
  SessionLogCompressionLevel,
  SessionLogExportSource,
} from '../archive.ts'
import type { CommandResult } from '../contract/command.ts'

/** 一条可注册的宿主命令。 */
export interface CommandDefinition {
  readonly name: string
  readonly description: string
  readonly handler: (invocation: { readonly rawInput: string }) => CommandResult | Promise<CommandResult>
}

/** 一条可注册的宿主下载路由。 */
export interface FetchRouteDefinition {
  readonly path: string
  readonly methods: readonly ('GET' | 'HEAD')[]
  readonly requestBody: 'buffered'
  readonly fetch: (request: Request) => Promise<Response>
}

/**
 * Host 上下文端口：注册命令与下载路由，并暴露已解析配置与导出所需数据源。
 * `source` 可为空——路由在此场景下须回 500（缺服务），与 dsh 语义一致。
 */
export interface HostContextPort {
  readonly config: {
    readonly compressionLevel: SessionLogCompressionLevel
  }
  readonly source: SessionLogExportSource | undefined
  registerCommand(command: CommandDefinition): void
  registerFetch(route: FetchRouteDefinition): void
}

/**
 * 真实内存 Host 上下文：记录命令与路由注册供契约测试断言，`config.source`
 * 由构造注入。提供按名/按路径查询的辅助方法。
 */
export class MemoryHostContext implements HostContextPort {
  readonly commands: CommandDefinition[] = []
  readonly routes: FetchRouteDefinition[] = []
  readonly config: { readonly compressionLevel: SessionLogCompressionLevel }
  readonly source: SessionLogExportSource | undefined

  constructor(
    config: { readonly compressionLevel: SessionLogCompressionLevel },
    source?: SessionLogExportSource,
  ) {
    this.config = config
    this.source = source
  }

  registerCommand(command: CommandDefinition): void {
    this.commands.push(command)
  }

  registerFetch(route: FetchRouteDefinition): void {
    this.routes.push(route)
  }

  /** 按名查找已注册命令。 */
  command(name: string): CommandDefinition | undefined {
    return this.commands.find(command => command.name === name)
  }

  /** 按路径查找已注册路由。 */
  route(path: string): FetchRouteDefinition | undefined {
    return this.routes.find(entry => entry.path === path)
  }
}

/** 浏览器 HTTP 读取回调。 */
export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** 浏览器保存回调：把已就绪的同源下载 URL 交给下载管理器。 */
export type Save = (url: string, filename: string) => void

/**
 * 浏览器下载上下文 seam：把 `fetch`、下载保存与同源基址三个环境能力注入下载
 * 状态机，使其不直接触碰浏览器全局（对应 dsh 的 `downloadUrl` / `hostBase`）。
 */
export interface DownloadContextPort {
  fetcher(input: string | URL, init?: RequestInit): Promise<Response>
  save(url: string, filename: string): void
  hostBase(): string
}

/**
 * 真实内存浏览器下载上下文：捕获 fetch 与 save 回调以便契约测试记录调用，
 * 并可固定同源基址。若未提供基址则回退到 dsh 的空源回退约定。
 */
export class MemoryDownloadContext implements DownloadContextPort {
  private readonly innerFetch: Fetch
  private readonly innerSave: Save
  private readonly base: string

  constructor(fetcher?: Fetch, save?: Save, base?: string) {
    this.innerFetch = fetcher ?? (async (input, init) => fetch(input, init))
    this.innerSave = save ?? (() => {})
    this.base = base ?? 'http://dsh.internal'
  }

  fetcher(input: string | URL, init?: RequestInit): Promise<Response> {
    return this.innerFetch(input, init)
  }

  save(url: string, filename: string): void {
    this.innerSave(url, filename)
  }

  hostBase(): string {
    return this.base
  }
}