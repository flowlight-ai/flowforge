# cats-api 挂载插件（T8.3a 前置）实施计划

> **执行者必读**：使用 executing-plans（③）行内执行本计划。步骤使用 checkbox（`- [ ]`）跟踪。
> **范围变更**：原"自建最小 TS 网关宿主"已作废（仓库已有 `@flowforge/host-webserver`），本计划改为交付挂载插件，详见 `docs/process/specs/2026-09-08-ts-gateway-design.md` 的"偏差记录"。

**目标**：新建 `packages/host/cats-api`（`@flowforge/host-cats-api`），把 `@flowforge/cats-routes`（Web Fetch 契约）经 `node:http` ↔ Fetch 适配层挂到既有 `ctx.webServer` 的 `/api/profile-updates` 前缀路由上。
**架构**：插件内 `mountCatsApi(ctx, options)` 注册 prefix 路由 → handler 用 `toRequest` 转 Fetch `Request` → 委托 `createCatsRoutesRouter(deps)` → `writeResponse` 写回，并按白名单加 CORS 头。
**技术栈**：Node 22+ 内置 `node:http` 与全局 `Request`/`Response`；`@flowforge/cordis`、`@flowforge/host-webserver`、`@flowforge/cats-routes`。
**规格**：`docs/process/specs/2026-09-08-ts-gateway-design.md`

## 全局约束

- 不新建 HTTP server、不引入 Web 框架（R16 最小依赖）
- origin 白名单与路由前缀一律常量 + 选项可覆盖，禁硬编码进逻辑分支
- 只做 HTTP 编排，禁止内联业务规则
- 身份解析不放宽（沿用 `x-user-id` 头，维持 401 语义）
- CORS 仅本地 dev 白名单，禁止 `*`
- 测试起真实 `Context` + `webServer` 真实端口，用真实 `fetch`，禁 mock（T1/T2/T3）
- 前端代理切分与组合根不在本计划范围（随 T8.3a 本体处理）
- 提交走 `./mgr commit` / `./mgr sync`，规范 `type(scope): 描述 [sherlock]`

---

### 任务 1：包骨架与登记

**文件**：
- 新建：`packages/host/cats-api/package.json`、`packages/host/cats-api/tsconfig.json`、`packages/host/cats-api/tsconfig.host.json`、`packages/host/cats-api/README.md`
- 修改：`tsconfig.base.json`（paths）、`tsconfig.json`（references）、`tsconfig.host.json`（references）
- 修改：`pnpm-lock.yaml`（`pnpm install` 自动更新）

**接口**：
- 产出：包可被 workspace 与 `tsc -b` 解析（`@flowforge/host-cats-api`）

- [ ] **步骤 1：新建 `packages/host/cats-api/package.json`**

```json
{
  "name": "@flowforge/host-cats-api",
  "description": "FlowForge cats HTTP mount plugin - adapts @flowforge/cats-routes (Web Fetch contract) onto the existing @flowforge/host-webserver ctx.webServer prefix routes; T8.3a prerequisite",
  "version": "0.1.0-rc.1",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://gitee.com/flowlight-ai/flowforge.git",
    "directory": "packages/host/cats-api"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": [ "lib/**/*.js", "lib/**/*.d.ts" ],
  "license": "MIT",
  "peerDependencies": {
    "@flowforge/cats-routes": "workspace:^",
    "@flowforge/cordis": "workspace:^",
    "@flowforge/host-webserver": "workspace:^"
  },
  "devDependencies": {
    "@flowforge/cats-routes": "workspace:^",
    "@flowforge/cordis": "workspace:^",
    "@flowforge/host-webserver": "workspace:^"
  }
}
```

- [ ] **步骤 2：新建 `packages/host/cats-api/tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types",
    "composite": true,
    "tsBuildInfoFile": "lib/.tsbuildinfo"
  },
  "include": [ "src" ],
  "exclude": [ "lib", "node_modules", "tests" ],
  "references": [
    { "path": "../../../vendor/cordis" },
    { "path": "../../cats/routes" },
    { "path": "../webserver" }
  ]
}
```

- [ ] **步骤 3：新建 `packages/host/cats-api/tsconfig.host.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types",
    "tsBuildInfoFile": "lib/.tsbuildinfo"
  },
  "include": [ "src" ],
  "exclude": [ "lib", "node_modules", "tests" ],
  "references": [
    { "path": "../../../vendor/cordis" },
    { "path": "../../cats/routes" },
    { "path": "../webserver" }
  ]
}
```

- [ ] **步骤 4：根级三处登记**

`tsconfig.base.json` 的 `paths` 增加：

```json
      "@flowforge/host-cats-api": [
        "./packages/host/cats-api/src/index.ts"
      ],
```

`tsconfig.json` 与 `tsconfig.host.json` 的 `references` 各增加：

```json
    {
      "path": "./packages/host/cats-api/tsconfig.host.json"
    },
```

- [ ] **步骤 5：安装并测试确认**

```sh
pnpm install
```

```sh
node -e "const f=require('fs');console.log(f.existsSync('packages/host/cats-api/node_modules/@flowforge/cats-routes'),f.existsSync('packages/host/cats-api/node_modules/@flowforge/host-webserver'))"
```

测试通过标准：install 退出码 0 且第二条输出 `true true`；测试确认失败则核对包名与 workspace glob（`packages/*/*` 已覆盖）后重跑。

- [ ] **步骤 6：提交骨架**

```sh
git add packages/host/cats-api/package.json packages/host/cats-api/tsconfig.json packages/host/cats-api/tsconfig.host.json packages/host/cats-api/README.md tsconfig.base.json tsconfig.json tsconfig.host.json pnpm-lock.yaml
./mgr commit "build(host-cats-api): 挂载插件包骨架+登记 [sherlock]"
```

---

### 任务 2：Fetch 适配层

**文件**：
- 新建：`packages/host/cats-api/src/adapter.ts`
- 新建：`packages/host/cats-api/tests/adapter.spec.ts`

**接口**：
- 产出：`toRequest(req, baseUrl): Promise<Request>`、`writeResponse(res, response): Promise<void>`

- [ ] **步骤 1：写适配层**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 把 node:http 入站消息转换为 Fetch Request（首版支持文本与 JSON body）。 */
export async function toRequest(req: IncomingMessage, baseUrl: string): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer))
  const body = chunks.length === 0 ? undefined : Buffer.concat(chunks)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD' && body !== undefined
  return new Request(new URL(req.url ?? '/', baseUrl), {
    method,
    headers,
    ...(hasBody ? { body } : {}),
  })
}

/** 把 Fetch Response 写回 node:http 出站响应。 */
export async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  res.end(buffer)
}
```

- [ ] **步骤 2：写单测（真实构造，非 mock）**

```ts
import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { toRequest, writeResponse } from '../src/adapter.ts'

function fakeReq(method: string, url: string, headers: Record<string, string>, body?: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage
  Object.assign(req, { method, url, headers })
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body))
    req.emit('end')
  })
  return req
}

function fakeRes(): { res: ServerResponse; status: () => number; headers: () => Record<string, string>; body: () => string } {
  const state: { status: number; headers: Record<string, string>; body: string } = { status: 0, headers: {}, body: '' }
  const res = {
    setHeader(key: string, value: string) { state.headers[key] = value },
    end(chunk?: Buffer) { state.body = chunk?.toString('utf8') ?? '' },
  } as unknown as ServerResponse
  return { res, status: () => state.status, headers: () => state.headers, body: () => state.body }
}

describe('Fetch 适配层', () => {
  it('POST：方法/路径/头/JSON body 往返一致', async () => {
    const req = fakeReq('POST', '/api/profile-updates/p1/approve', { 'content-type': 'application/json', 'x-user-id': 'u1' }, '{"decidedBy":"u1"}')
    const request = await toRequest(req, 'http://127.0.0.1:8787')
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/profile-updates/p1/approve')
    expect(request.headers.get('x-user-id')).toBe('u1')
    expect(await request.json()).toEqual({ decidedBy: 'u1' })
  })

  it('GET：不带 body 且查询串保留', async () => {
    const req = fakeReq('GET', '/api/packs?limit=2', {})
    const request = await toRequest(req, 'http://127.0.0.1:8787')
    expect(request.method).toBe('GET')
    expect(new URL(request.url).search).toBe('?limit=2')
  })

  it('writeResponse：状态码/头/body 完整写回', async () => {
    const { res, status, headers, body } = fakeRes()
    await writeResponse(res, new Response(JSON.stringify({ ok: false, error: 'nope' }), { status: 404, headers: { 'content-type': 'application/json' } }))
    expect(status()).toBe(404)
    expect(headers()['content-type']).toBe('application/json')
    expect(JSON.parse(body())).toEqual({ ok: false, error: 'nope' })
  })
})
```

- [ ] **步骤 3：运行单测测试确认**

```sh
pnpm vitest run packages/host/cats-api/tests/adapter.spec.ts
```

测试通过标准：3 passed / 0 failed；测试确认失败则按断言定位修正后重跑。

- [ ] **步骤 4：提交**

```sh
git add packages/host/cats-api/src/adapter.ts packages/host/cats-api/tests/adapter.spec.ts
./mgr commit "feat(host-cats-api): node:http与Fetch适配层+往返单测 [sherlock]"
```

---

### 任务 3：挂载插件与集成测试

**文件**：
- 新建：`packages/host/cats-api/src/cors.ts`
- 新建：`packages/host/cats-api/src/index.ts`
- 新建：`packages/host/cats-api/tests/mount.spec.ts`

**接口**：
- 消费：任务 2 的 `toRequest` / `writeResponse`；`createCatsRoutesRouter(deps)`（`@flowforge/cats-routes`，router.ts:91）；`ctx.webServer.register`（`@flowforge/host-webserver`）
- 产出：`mountCatsApi(ctx, options?): () => void`（返回 disposer）与默认导出 cordis 插件

- [ ] **步骤 1：写 CORS 白名单助手**

```ts
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5174', 'http://127.0.0.1:5174'] as const

export function applyCors(response: Response, origin: string | null, allowed: readonly string[]): Response {
  if (origin === null || !allowed.includes(origin)) return response
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.set('vary', 'Origin')
  return new Response(response.body, { status: response.status, headers })
}
```

- [ ] **步骤 2：写挂载插件**

```ts
import type { Context } from '@flowforge/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createCatsRoutesRouter, type CatsRoutesDeps } from '@flowforge/cats-routes'
import { toRequest, writeResponse } from './adapter.ts'
import { DEFAULT_ALLOWED_ORIGINS, applyCors } from './cors.ts'

/** 挂载前缀：与 cats-routes 的 profile 路由组对齐。 */
export const CATS_API_PREFIX = '/api/profile-updates'

export interface CatsApiOptions {
  /** 端口实现注入（缺省空依赖：未注入的域返回 404）。 */
  readonly routes?: CatsRoutesDeps | undefined
  readonly allowedOrigins?: readonly string[] | undefined
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * 把 cats-routes 挂载到 ctx.webServer 的 /api/profile-updates 前缀。
 * @returns 卸载路由的 disposer。
 */
export function mountCatsApi(ctx: Context, options: CatsApiOptions = {}): () => void {
  const allowed = options.allowedOrigins ?? [...DEFAULT_ALLOWED_ORIGINS]
  const route = createCatsRoutesRouter(options.routes ?? {})
  return ctx.webServer.register({
    kind: 'prefix',
    path: CATS_API_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const base = `http://${ctx.webServer.host}:${ctx.webServer.port}`
        const request = await toRequest(req, base)
        const response = await route(request)
        await writeResponse(res, applyCors(response, request.headers.get('origin'), allowed))
      } catch {
        await writeResponse(res, json(500, { ok: false, error: 'internal error' }))
      }
    },
  })
}

export default function plugin(ctx: Context, options?: CatsApiOptions): void {
  ctx.effect(() => mountCatsApi(ctx, options ?? {}), 'host-cats-api: mount')
}
```

- [ ] **步骤 3：写集成测试（真实 Context + webServer 真实端口 + 真实 fetch，禁 mock）**

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { WebServer } from '@flowforge/host-webserver'
import type { CatsRoutesDeps } from '@flowforge/cats-routes'
import { mountCatsApi } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.dispose()
  ctx = undefined
})

async function boot(routes?: CatsRoutesDeps): Promise<string> {
  const root = new Context()
  await root.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  mountCatsApi(root, routes === undefined ? {} : { routes })
  ctx = root
  return `http://127.0.0.1:${root.webServer.port}`
}

describe('cats-api 挂载插件（真实 webServer）', () => {
  it('未注入端口实现 → 提案请求 404（cats-routes 契约）', async () => {
    const base = await boot()
    const response = await fetch(`${base}/api/profile-updates/missing`)
    expect(response.status).toBe(404)
  })

  it('注入内存端口 → 审批链路 pending→approved 走通', async () => {
    const store = new Map<string, string>()
    store.set('p1', 'pending')
    const base = await boot({
      profileUpdates: {
        get: async id => ({ id, status: store.get(id) ?? null }),
        claimForApproval: async (id, approvedBy) => { store.set(id, `approving:${approvedBy}`); return { id } },
        finalizeApproval: async id => { store.set(id, 'approved'); return { id, status: 'approved' } },
        markRejected: async (id, rejectedBy, reason) => { store.set(id, `rejected:${rejectedBy}:${reason ?? ''}`); return { id } },
      },
    })
    const approved = await fetch(`${base}/api/profile-updates/p1/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'u1' },
      body: JSON.stringify({ decidedBy: 'u1' }),
    })
    expect(approved.status).toBe(200)
    expect(store.get('p1')).toBe('approved')
  })

  it('disposer：卸载后前缀路由不再命中', async () => {
    const root = new Context()
    await root.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const dispose = mountCatsApi(root, {})
    dispose()
    const response = await fetch(`http://127.0.0.1:${root.webServer.port}/api/profile-updates/missing`)
    expect(response.status).toBe(404)
    ctx = root
  })

  it('CORS：白名单 origin 放行、非白名单不放行', async () => {
    const root = new Context()
    await root.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    mountCatsApi(root, { allowedOrigins: ['http://localhost:5174'] })
    const base = `http://127.0.0.1:${root.webServer.port}`
    const ok = await fetch(`${base}/api/profile-updates/missing`, { headers: { origin: 'http://localhost:5174' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5174')
    const denied = await fetch(`${base}/api/profile-updates/missing`, { headers: { origin: 'http://evil.example' } })
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
    ctx = root
  })
})
```

- [ ] **步骤 4：运行全包测试测试确认**

```sh
pnpm vitest run packages/host/cats-api
```

测试通过标准：adapter 3 + mount 4 共 7 passed / 0 failed；测试确认失败则按断言定位（路由契约以 cats-routes 源码为准；端口用 0 由 OS 分配）修正后重跑。

- [ ] **步骤 5：提交**

```sh
git add packages/host/cats-api/src/cors.ts packages/host/cats-api/src/index.ts packages/host/cats-api/tests/mount.spec.ts
./mgr commit "feat(host-cats-api): cats-routes挂载至ctx.webServer+真实端口集成测试 [sherlock]"
```

---

### 任务 4：验证证据与 PR 收尾

**文件**：
- 无源码变更；产物为验证证据、流程产物与 PR

- [ ] **步骤 1：登记证据并推进实例**

```sh
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-ts-gateway --command "pnpm vitest run packages/host/cats-api" --exit 0 --summary "适配层单测 3 + 挂载集成 4 全绿（真实 webServer 端口与真实 fetch）"
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-ts-gateway --command "pnpm lint" --exit 0 --summary "lint 0 errors"
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-ts-gateway --command "pnpm typecheck" --exit 0 --summary "typecheck 不劣化（基线为并行会话在途批次）"
node packages/plugins/dev/bin/ff_dev.mjs status plugin-ts-gateway
```

（`pnpm typecheck` 当前基线受并行会话在途批次影响，若退出码非 0 则按真实退出码登记并在 PR 说明中标注归属。）

测试通过标准：`status` 输出含 `designApproved=✓ planValidated=✓ verificationEvidence=✓` 且推进至 finish。

- [ ] **步骤 2：提交流程产物并建 PR**

```sh
git add docs/process/specs/2026-09-08-ts-gateway-design.md docs/process/plans/2026-09-08-ts-gateway.md docs/process/instances/plugin-ts-gateway.json docs/process/verifications/plugin-ts-gateway.md
./mgr commit "docs(process): cats-api挂载插件流程产物-设计偏差记录/计划/实例/验证证据 [sherlock]"
./mgr sync "feat(host-cats-api): cats-routes挂载至既有webServer(T8.3a前置) [sherlock]" --body "T8.3a 前置（实例 plugin-ts-gateway，greenfield 工作流）：原设计假定仓库无 TS HTTP 宿主，实现前勘查发现 @flowforge/host-webserver 已提供（cordis webServer 服务 + register/registerUpgrade/registerFallback），故改为交付挂载插件 packages/host/cats-api——node:http<->Fetch 适配层 + 在 ctx.webServer 注册 /api/profile-updates 前缀路由，CORS 仅 dev 白名单，身份沿用 x-user-id。组合根与前端代理切分随 T8.3a 本体处理。验证：单测 3 + 集成测试 4（真实 webServer 端口 + 真实 fetch）全绿。"
```

测试通过标准：`./mgr sync` 返回 Gitee PR 链接，PR 标题 ≤191 字符。

---

## 自审记录

- **规格覆盖**：设计文档（含偏差记录）→ 任务 1（包与登记）、任务 2（适配层）、任务 3（插件+CORS+身份+disposer）、任务 4（证据+PR）；"测试策略"→ 任务 2 步骤 3、任务 3 步骤 4、任务 4 步骤 1。无遗漏。
- **占位符扫描**：无未决占位标记/"同任务 N"式懒引用；package.json、两个 tsconfig、适配层、插件、测试均给出全文。
- **类型一致性**：`mountCatsApi` / `CatsApiOptions` / `CATS_API_PREFIX` 在设计偏差记录与任务 3 一致；`createCatsRoutesRouter`、`CatsRoutesDeps` 取自 `packages/cats/routes/src/router.ts:91`；`WebServer.register` 签名取自 `packages/host/webserver/src/index.ts:94`。
