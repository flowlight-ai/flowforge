/**
 * @flowforge/cats-routes — cats 路由 HTTP 挂载层 Cordis 插件（批次55，C41/C22 diff 残余）。
 *
 * 对齐 clowder-ai `routes/{packs,backlog,profile-update-decision-routes,memory-publish}.ts`
 * 的 HTTP 契约（路径/方法/状态码/载荷校验），业务全委托已交付的 store/service 端口
 * （cats-packs / cats-stores / chat-misc）——本包只做挂载翻译，不重复业务语义。
 *
 * clowder 288 个路由文件的语义 diff 结论（批次55，登记于 02-source-crosswalk.md）：
 *   - chat 系（threads/messages/mention/session-chain/approval/realtime）→
 *     已由 chat 系（C22）覆盖；
 *   - memory-publish / marketplace / signal / task 服务 → 已由 chat-misc 覆盖；
 *   - backlog import-active-features 文档导入 → 已由 cats-feat-trajectory backfill 覆盖；
 *   - 余下 packs / backlog / profile-updates / memory-publish 四组为纯 HTTP 挂载面，
 *     即本包。
 *
 * 消费者：
 * ```ts
 * import CatsRoutes from '@flowforge/cats-routes'
 * ctx.plugin(CatsRoutes, { packs, backlog, profileUpdates, memoryPublish })
 * // 宿主 webserver 挂载 ctx.forgeCatsRoutes.handler()（fetch 风格）
 * ```
 *
 * @module @flowforge/cats-routes
 */

import { Context, Service } from '@flowforge/cordis'

import { createCatsRoutesRouter, type CatsRoutesDeps } from './router.ts'

export { createCatsRoutesRouter } from './router.ts'
export type { CatsRoutesDeps } from './router.ts'
export type {
  BacklogPort,
  MemoryPublishPort,
  PackExporterPort,
  PackLoaderPort,
  ProfileUpdatePort,
  SelfClaimPolicyPort,
} from './ports.ts'

declare module '@flowforge/cordis' {
  interface Context {
    /** cats 路由 HTTP 挂载层（批次55）：fetch 风格聚合路由器 */
    forgeCatsRoutes: CatsRoutesService;
  }
}

export interface CatsRoutesConfig extends CatsRoutesDeps {}

/** cats 路由服务 — 挂载 `ctx.forgeCatsRoutes`（纯装配，无后台任务）。 */
export class CatsRoutesService extends Service {
  private readonly deps: CatsRoutesDeps;

  constructor(ctx: Context, config: CatsRoutesConfig = {}) {
    super(ctx, 'forgeCatsRoutes');
    this.deps = config
  }

  /** 聚合 fetch 风格处理器（宿主 webserver 组合根挂载）。 */
  handler(): (request: Request) => Promise<Response> {
    return createCatsRoutesRouter(this.deps)
  }
}

export default CatsRoutesService
