/**
 * cats routes HTTP 挂载层（批次55，C41/C22 diff 残余）。
 *
 * 翻译 clowder-ai 四个路由组的 HTTP 契约（路径/方法/状态码/载荷 zod 校验），
 * 业务委托注入端口：
 *   - packs:   POST /api/packs/add · GET /api/packs · DELETE /api/packs/:name ·
 *              POST /api/packs/export（routes/packs.ts）
 *   - backlog: GET|POST /api/backlog/items · GET /api/backlog/self-claim-policy
 *              （routes/backlog.ts；import-active-features 语义已由 cats-feat-trajectory
 *              backfill 覆盖，见批次55 crosswalk 登记，不重复翻译）
 *   - profile: GET /api/profile-updates/:id · POST :id/approve · POST :id/reject
 *              （routes/profile-update-decision-routes.ts）
 *   - memory:  POST /api/memory/publish（routes/memory-publish.ts）
 *
 * HTTP 契约对齐：400 请求体非法 / 401 无身份 / 403 安全拒绝 / 404 未知路径或
 * 资源 / 201 创建成功；业务错误 200 + { ok: false, error }（对齐 packs 源码语义）。
 *
 * @module @flowforge/cats-routes/router
 */

import { z } from 'zod'
import type {
  BacklogPort,
  MemoryPublishPort,
  PackExporterPort,
  PackLoaderPort,
  ProfileUpdatePort,
  SelfClaimPolicyPort,
} from './ports.ts'

type Json = Record<string, unknown>

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function readJsonBody(request: Request): Promise<Json | null> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === 'object' && parsed !== null ? (parsed as Json) : {}
  } catch {
    return null
  }
}

export interface CatsRoutesDeps {
  readonly packs?: PackLoaderPort | undefined;
  readonly packExporter?: PackExporterPort | undefined;
  readonly backlog?: BacklogPort | undefined;
  readonly selfClaimPolicy?: SelfClaimPolicyPort | undefined;
  readonly profileUpdates?: ProfileUpdatePort | undefined;
  readonly memoryPublish?: MemoryPublishPort | undefined;
  /** 身份解析（缺省读 x-user-id 头；clowder resolveUserId 的 HTTP 面）。 */
  readonly resolveUserId?: ((request: Request) => string | null) | undefined;
}

const addPackSchema = z.object({ source: z.string().min(1) }).strict()
const exportPackSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    catConfig: z.record(z.string(), z.unknown()).optional(),
    sharedRulesContent: z.string().optional(),
    skillsManifestContent: z.string().optional(),
  })
  .strict()
const createBacklogSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    priority: z.enum(['critical', 'high', 'normal', 'low']).default('normal'),
    tags: z.array(z.string()).default([]),
    createdBy: z.string().min(1),
  })
  .strict()
const publishMemorySchema = z
  .object({
    threadId: z.string().min(1),
    title: z.string().min(1),
    content: z.string().min(1),
    createdBy: z.string().min(1),
  })
  .strict()

/**
 * cats routes 聚合路由器（fetch 风格 Request→Response，由宿主 webserver /
 * apiproxy 组合根挂载）。未注册的域返回 404——组合按需装配。
 */
export function createCatsRoutesRouter(deps: CatsRoutesDeps): (request: Request) => Promise<Response> {
  const resolveUserId =
    deps.resolveUserId ?? ((request: Request) => request.headers.get('x-user-id'))

  return async (request: Request) => {
    const url = new URL(request.url)
    const pathname = url.pathname
    const method = request.method

    // ── packs ──
    if (deps.packs !== undefined && pathname === '/api/packs/add' && method === 'POST') {
      const body = await readJsonBody(request)
      const parsed = addPackSchema.safeParse(body)
      if (!parsed.success) {
        return json(400, { error: 'Invalid request', details: parsed.error.issues })
      }
      try {
        const manifest = await deps.packs.add(parsed.data.source)
        return json(201, { ok: true, manifest })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const isSecurityError = msg.includes('security') || msg.includes('Security')
        return json(isSecurityError ? 403 : 400, { ok: false, error: msg })
      }
    }
    if (deps.packs !== undefined && pathname === '/api/packs' && method === 'GET') {
      const packs = await deps.packs.list()
      return json(200, { packs })
    }
    if (deps.packs !== undefined && pathname.startsWith('/api/packs/') && method === 'DELETE') {
      const name = pathname.slice('/api/packs/'.length)
      if (!name) return json(400, { error: 'Pack name required' })
      const removed = await deps.packs.remove(decodeURIComponent(name))
      return json(200, { removed })
    }
    if (deps.packs !== undefined && pathname === '/api/packs/export' && method === 'POST') {
      const body = await readJsonBody(request)
      const parsed = exportPackSchema.safeParse(body)
      if (!parsed.success) {
        return json(400, { error: 'Invalid request', details: parsed.error.issues })
      }
      if (deps.packExporter === undefined) {
        return json(400, { error: 'Pack exporter not mounted' })
      }
      if (!parsed.data.catConfig) {
        return json(400, { error: 'Missing required data: catConfig, sharedRulesContent, skillsManifestContent' })
      }
      const catConfig = parsed.data.catConfig as unknown as Parameters<PackExporterPort['exportMasks']>[0]
      const masks = deps.packExporter.exportMasks(catConfig)
      return json(200, { ok: true, pack: { name: parsed.data.name ?? 'exported', masks } })
    }

    // ── backlog ──
    if (deps.backlog !== undefined && pathname === '/api/backlog/items' && method === 'POST') {
      const body = await readJsonBody(request)
      const parsed = createBacklogSchema.safeParse(body)
      if (!parsed.success) {
        return json(400, { error: 'Invalid request body', details: parsed.error.issues })
      }
      const userId = resolveUserId(request)
      if (!userId) return json(401, { error: 'Identity required' })
      const item = await deps.backlog.create({
        userId,
        title: parsed.data.title,
        summary: parsed.data.summary,
        priority: parsed.data.priority,
        tags: parsed.data.tags,
        createdBy: parsed.data.createdBy,
      } as never)
      return json(201, item as unknown as Json)
    }
    if (deps.backlog !== undefined && pathname === '/api/backlog/items' && method === 'GET') {
      const userId = resolveUserId(request)
      if (!userId) return json(401, { error: 'Identity required' })
      const items = await deps.backlog.listByUser(userId)
      return json(200, { items: items as unknown as Json[] })
    }
    if (deps.selfClaimPolicy !== undefined && pathname === '/api/backlog/self-claim-policy' && method === 'GET') {
      return json(200, await deps.selfClaimPolicy.policy())
    }

    // ── profile-updates ──
    const profileMatch = /^\/api\/profile-updates\/([^/]+)(\/approve|\/reject)?$/.exec(pathname)
    if (deps.profileUpdates !== undefined && profileMatch !== null) {
      const proposalId = decodeURIComponent(profileMatch[1] ?? '')
      const action = profileMatch[2]
      if ((action === undefined || action === '') && method === 'GET') {
        const proposal = await deps.profileUpdates.get(proposalId)
        if (proposal === null) return json(404, { error: 'proposal not found' })
        return json(200, proposal as unknown as Json)
      }
      if (action === '/approve' && method === 'POST') {
        const body = (await readJsonBody(request)) ?? {}
        const approvedBy = typeof body['decidedBy'] === 'string' ? body['decidedBy'] : resolveUserId(request) ?? ''
        if (!approvedBy) return json(401, { error: 'Identity required' })
        try {
          await deps.profileUpdates.claimForApproval(proposalId, approvedBy)
          const proposal = await deps.profileUpdates.finalizeApproval(proposalId)
          if (proposal === null) return json(404, { error: 'proposal not found or status drifted' })
          return json(200, { ok: true, proposal: proposal as unknown as Json })
        } catch (err) {
          return json(409, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
      if (action === '/reject' && method === 'POST') {
        const body = (await readJsonBody(request)) ?? {}
        const rejectedBy = typeof body['decidedBy'] === 'string' ? body['decidedBy'] : resolveUserId(request) ?? ''
        if (!rejectedBy) return json(401, { error: 'Identity required' })
        const reason = typeof body['rejectionReason'] === 'string' ? body['rejectionReason'] : undefined
        const proposal = await deps.profileUpdates.markRejected(proposalId, rejectedBy, reason)
        if (proposal === null) return json(404, { error: 'proposal not found or not pending' })
        return json(200, { ok: true, proposal: proposal as unknown as Json })
      }
    }

    // ── memory publish ──
    if (deps.memoryPublish !== undefined && pathname === '/api/memory/publish' && method === 'POST') {
      const body = await readJsonBody(request)
      const parsed = publishMemorySchema.safeParse(body)
      if (!parsed.success) {
        return json(400, { error: 'Invalid request body', details: parsed.error.issues })
      }
      const result = await deps.memoryPublish.publish(parsed.data)
      return json(200, result)
    }

    return json(404, { error: `no route: ${method} ${pathname}` })
  }
}
