# 最小 TS 网关（T8.3a 前置）设计文档（design-template）

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `plugin-ts-gateway`（`ff_dev status plugin-ts-gateway` 可查） |
| 工作流 | greenfield（0→1：仓库尚无运行中的 TS HTTP 宿主） |
| 分级路径 | Architectural（新子系统：引入 HTTP 宿主与前端代理切分） |
| 操作者 | operator |
| 日期 | 2026-09-08 |
| 上级分解 | T8.3 分解为 c（命名合规，PR#162 已交）→ a（审批流）→ b（档案数据真实化）；本文件为 a 的前置网关 |

## 目标（Goal）

为 flowforge 引入一个最小 TS HTTP 网关宿主，把已交付但未接线的 `@flowforge/cats-routes`（Web Fetch 契约）挂载为真实可调用服务，使 T8.3a 审批流与后续档案数据面摆脱 Python :8000 日落路径。

## 架构（Architecture）

- **新包 `packages/host/gateway`**（`@flowforge/host-gateway`）：零 Web 框架依赖。核心是一个 `node:http` ↔ Fetch 适配层（约 60-80 行）：把 `IncomingMessage` 转成 `Request`，把 `Response` 写回 `ServerResponse`，支持文本/JSON body 与流式透传。
- **挂载面**：仅挂载 `/api` 前缀，路由委托 `createCatsRoutes(deps)`（`packages/cats/routes/src/router.ts`）；未命中路径返回 404 JSON（对齐"404 未知路径或资源"契约）。
- **依赖注入**：`CatsRoutesDeps` 的端口实现来自既有包（cats-packs / cats-stores / cats-profile / chat-misc）；缺省身份解析沿用 `x-user-id` 头（`router.ts:53` 语义）。
- **配置**：端口默认 `8787`，`FF_GATEWAY_PORT` 覆盖；CORS 仅放行本地 dev origin（`http://localhost:5174`），不引入通配符。
- **前端接线**：`web/next.config.js` 的 rewrites 按域切分——档案/审批域（`/api/profile-updates*` 及后续 `/api/forgekins/profile*`）指向 TS 网关，其余继续走 Python :8000，避免一次性切换的爆炸半径。
- **与既有系统关系**：不改动 cats-routes 的路由与契约；不改动 Python 服务；网关为只读编排层，业务语义全在既有 service/store。

## 技术栈（Tech Stack）

- Node 22+ 内置 `node:http` + 全局 `Request`/`Response`（undici），不引入 express/fastify/h3
- `@flowforge/cats-routes`（已交付，Web Fetch 契约）、zod（其自身依赖）
- vitest 集成测试用真实 `fetch` 打真实端口（T1-T9：禁 mock）

## 规范引用（Spec Compliance）

- 编程红线：`docs/rules/07-coding-redlines.md`（禁硬编码端口/路径——统一 env + 默认值常量）
- 测试铁律：T1-T9（`docs/rules/test-iron-rules.md`）
- 命名契约：`docs/design/naming-contract.md`
- 流程铁律：`docs/rules/13-dev-process.md`
- 八登记点：新包需登记 workspace glob、`tsconfig.base.json` paths、`tsconfig.json`/`tsconfig.host.json` references、`package.json` exports

## 全局约束（Global Constraints）

- 不引入新 Web 框架依赖（R16 最小依赖）
- 端口与 origin 一律 env 可覆盖，代码内只留默认值常量（禁硬编码到逻辑分支）
- 网关只做 HTTP 编排，禁止内联业务规则
- 身份解析不得放宽（维持 401 语义）
- CORS 仅本地 dev，不放行 `*`
- Node ^22.19.0 || >=24.0.0；所有验证命令退出码 0

## 数据模型 / 接口设计

```ts
// packages/host/gateway/src/index.ts
export interface GatewayOptions {
  readonly port?: number            // 默认 8787（FF_GATEWAY_PORT）
  readonly host?: string            // 默认 127.0.0.1（FF_GATEWAY_HOST）
  readonly routes?: CatsRoutesDeps  // 端口实现注入
  readonly allowedOrigins?: readonly string[]
}

export interface GatewayHandle {
  readonly port: number
  readonly url: string
  close(): Promise<void>
}

export function startGateway(options?: GatewayOptions): Promise<GatewayHandle>
```

错误处理：适配层异常 → 500 JSON `{ ok: false, error }`；路由未命中 → 404 同构；与 cats-routes 现有状态码语义（400/401/403/404/201）一致。

## 测试策略

- 单测：适配层方法/路径/头部/body 往返（`Request`↔`IncomingMessage`）
- 集成测试（真实端口 + 真实 fetch，禁 mock）：
  1. `GET /api/profile-updates/:id` 404 未知资源
  2. 注入内存端口实现 → 审批链路 `POST :id/approve` 200 且状态 pending→approved
  3. 未命中路径 → 404；CORS 预检仅放行白名单 origin
- 门禁：以上全绿 + `pnpm lint` 0 errors + `pnpm typecheck` 不劣化

## 决策门记录

### DCP-1 需求/变更决策

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| business_value | 0.40 | 0.5 | 0.9 | 解锁 T8.3a/b，摆脱 Python 日落路径 |
| feasibility | 0.35 | 0.6 | 0.9 | cats-routes 已是 Fetch 契约，适配层极小 |
| security | 0.25 | 0.7 | 0.8 | 仅本地监听 + 白名单 CORS + 身份头不放宽 |

加权总分 **0.875** / 阈值 0.65。

### DCP-2 方案决策（human_required）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| feasibility | 0.50 | 0.6 | 0.9 | 零框架依赖，Node 内置能力足够 |
| security | 0.30 | 0.7 | 0.85 | 攻击面限于本地/内网，无通配 CORS |
| ux | 0.20 | 0.5 | 0.8 | 前端按域切分，开发期行为可预期 |

加权总分 **0.865** / 阈值 0.70；**操作者签核**（design→plan 硬门禁）：待 operator 签核，日期 2026-09-08。

## 风险预案

- Fetch 适配层的流式/二进制边界（头像上传等）：首版仅支持文本与 JSON body，二进制场景后续按需求单独立项。
- 与 Python 并存期间的接口漂移：前端按域切分，网关只承接档案/审批域，其余不动。

## 偏差记录（design 签核后、implement 前的现场修正）

**原设计前提被推翻**：签核时假定"仓库无运行中 TS HTTP 宿主"，实现前勘查发现 `@flowforge/host-webserver` 已提供该能力——cordis `webServer` 服务（`register({ kind: 'exact' | 'prefix', path, handler })` / `registerUpgrade` / `registerFallback`，配置 `host` 取 `127.0.0.1` 或 `0.0.0.0`、`port` 为 0 时取 OS 分配端口），且 `packages/client/connection`、`packages/host/frontend-static` 已在消费它。

**修正后的方案**（operator 2026-09-08 会话内裁决）：

1. **不新建 server**：删除原计划的 `packages/host/gateway`（未入库，零风险），改为新包 **`packages/host/cats-api`**（host 组即宿主适配层，与 apiproxy/webserver/frontend-static 同域），导出 cordis 插件，在 `ctx.webServer` 上注册 `kind: 'prefix'`、`path: '/api/profile-updates'` 路由；handler 内做 `node:http` ↔ Fetch 适配后委托 `createCatsRoutesRouter`。
2. **包名误读澄清**：`packages/api/gateway` 是 Typert RPC 远程派发网关，**不是** HTTP 网关，故不作为挂载点。
3. **组合根不在本子项目**：谁来拉起 `webServer` 属组合根议题，随 T8.3a 前端接线一并解决；本子项目只交付插件与其测试（测试内自起 Context + webServer 真实端口 + 真实 fetch）。
4. **前端代理切分暂缓**：待组合根确定后再改 `web/next.config.js`。

**不变**：CORS 仅 dev 白名单、身份沿用 `x-user-id`（401 不放宽）、网关只做编排不内联业务、测试禁 mock。

## 自审清单（落盘前）

- [x] 占位符扫描：无未决占位标记
- [x] 内部一致性：端口/路径/包名全文一致
- [x] 范围检查：单一主题（网关宿主），不含前端审批 UI（属 T8.3a 本体）
- [x] 歧义检查：挂载面、CORS、身份解析口径唯一
