# @flowforge/host-cats-api

cats HTTP 挂载插件（T8.3a 前置，流程实例 `plugin-ts-gateway`）。

## 定位

`@flowforge/cats-routes` 是 Web Fetch 契约（`Request` → `Response`），而宿主 `@flowforge/host-webserver` 用原生 `node:http` handler。本包补齐两者之间的适配，并把 cats-routes 的 profile 路由组挂到 `ctx.webServer` 的前缀路由上——**不新建 HTTP server，不引入 Web 框架**。

## 用法

```ts
import { Context } from '@flowforge/cordis'
import { WebServer } from '@flowforge/host-webserver'
import CatsApi from '@flowforge/host-cats-api'

const ctx = new Context()
await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
await ctx.plugin(CatsApi, { routes: { profileUpdates: myProfileUpdatePort } })
// → http://127.0.0.1:<port>/api/profile-updates/*
```

命令式挂载（需自行管理 disposer）：

```ts
import { mountCatsApi } from '@flowforge/host-cats-api'

const dispose = mountCatsApi(ctx, { routes })
dispose()
```

## 契约

- 挂载前缀：`/api/profile-updates`（`CATS_API_PREFIX`，与 cats-routes 的 profile 路由组对齐）
- 状态码语义沿用 cats-routes：400 请求体非法 / 401 无身份 / 403 安全拒绝 / 404 未知路径或资源 / 201 创建成功
- 身份解析沿用 `x-user-id` 头（不放宽 401）
- CORS 仅放行 dev 白名单（`http://localhost:5174` / `http://127.0.0.1:5174`），禁止 `*`
- 只做 HTTP 编排，业务语义全在既有 service/store

## 未覆盖范围

组合根（谁拉起 `webServer`）与前端代理切分属 T8.3a 本体，不在本包。

## 测试

```sh
pnpm vitest run packages/host/cats-api
```

集成测试起真实 `Context` + `webServer` 真实端口，用真实 `fetch` 打（T1/T2/T3：禁 mock）。
