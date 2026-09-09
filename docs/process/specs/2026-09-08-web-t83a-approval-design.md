# T8.3a 灵智档案审批流 设计文档（design-template）

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `plugin-web-t83a`（`ff_dev status plugin-web-t83a` 可查） |
| 工作流 | feature（在既有前端与 cats 域上新增能力） |
| 分级路径 | Architectural（跨子系统：后端端点 + 组合根 + 前端代理 + UI） |
| 操作者 | operator |
| 日期 | 2026-09-08 |
| 上级分解 | T8.3 分解为 c（命名合规，PR#162）→ a（审批流，本文件）→ b（档案数据真实化） |
| 前置已交付 | `packages/host/cats-api`（PR#163，cats-routes 挂载到 `ctx.webServer` 的 `/api/profile-updates` 前缀） |

## 目标（Goal）

打通"档案更新提案"的审批闭环：后端提供列表与决策端点 → web bundle 组合根真实拉起 TS HTTP 服务 → 前端按域把档案/审批请求代理到该服务 → 审批面板新增"档案提案"Tab 完成批准/驳回，状态机与冲突语义对齐 clowder-ai。

## 架构（Architecture）

四段链路，逐段可独立交付与验证：

1. **端点层（a1）**：`ProfileUpdatePort` 增 `list(query)`；`packages/cats/routes/src/router.ts` 在 `/:id` 正则**之前**拦截根路径 `GET /api/profile-updates`（当前根路径会落 404，见 `router.ts:172-204,217`），返回 `{ items, nextCursor }`。契约：`?status=pending|approved|rejected&createdBy=&limit=&cursor=`。
2. **组合根（a2）**：新建 `packages/bundle/web/cordis.patch.yml`，与 `packages/bundle/{base,headless,...}` 同构，插入 `@flowforge/host-webserver`（config 端口，默认 8787，env 可覆盖）与 `@flowforge/host-cats-api` 两行；web dev 由 pnpm script 经 `apps/cli` 拉起该 profile。
3. **代理层（a3）**：`web/next.config.js` 在 `rewrites()` 数组**最前**插入 `/api/profile-updates/:path*` → TS 网关（Next 按数组顺序匹配），其余仍走 Python :8000，避免一次性切换。
4. **UI 层（a4）**：`web/src/components/helm/WorkspaceApprovalPanel.tsx`（429 行，已有待审批/历史双 Tab + 风险徽章 + 过滤）新增"档案提案"Tab：卡片展示 `rationale` + before/after diff，提供"批准并写入 / 驳回"；409 按 `status` 字段解析 `stale_hash`（需重新提议）/ `claim_lost`（并发变更重试）/ 已终态（视为成功）。

**与既有系统关系**：业务语义全在 cats 域既有 service/store；cats-api 只做 HTTP 编排；Python :8000 在未被切分的域上继续服务（日落由阶段 11 统一处理）。

## 技术栈（Tech Stack）

- 后端：`@flowforge/cats-routes`（zod 契约，Web Fetch）、`@flowforge/cats-stores`（端口实现）
- 组合根：`@flowforge/cordis` + `packages/bundle/*` patch 清单 + `apps/cli`
- 前端：Next.js 14 + React 18 + TS；`web/src/hooks/useApi.ts`（baseUrl `/api/v1`，30s 超时，错误取 `data.detail`）
- 命名：中文界面 P0（"档案更新提案"、泛指"智能体"/特指"可进化智能体"），代码/路径 P1（`profile-updates`、`forgekin`）

## 规范引用（Spec Compliance）

- 命名契约：`docs/design/naming-contract.md`
- 测试铁律 T1-T9：`docs/rules/test-iron-rules.md`（禁 mock LLM；真实 HTTP、真实端口）
- 编程红线：`docs/rules/07-coding-redlines.md`（端口/路径不硬编码进逻辑分支）
- 文档分层：`docs/rules/11-doc-layering.md`
- 流程铁律：`docs/rules/13-dev-process.md`

## 全局约束（Global Constraints）

- 端口与网关地址一律 env 可覆盖（`FF_GATEWAY_PORT` 默认 8787），代码内只留默认值常量
- 列表端点必须在 `/:id` 正则之前匹配根路径，否则落 404
- 409 语义必须区分 `stale_hash` / `claim_lost` / 已终态；已终态按成功处理（clowder 语义）
- reject 幂等（重复驳回返回 `deduped: true`）
- UI 文案一律 P0 中文术语；不得新增 P2 别名
- 代理切分规则必须位于 `rewrites()` 数组首位之前于 `/api/:path*` 通配
- 每个子项目独立 spec→plan→实施；验证命令退出码 0 才可登记证据

## 数据模型 / 接口设计

```ts
// packages/cats/routes/src/ports.ts 增补
export interface ProfileUpdateListQuery {
  readonly status?: 'pending' | 'approved' | 'rejected' | undefined
  readonly createdBy?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export interface ProfileUpdateListResult {
  readonly items: readonly Record<string, unknown>[]
  readonly nextCursor?: string
}

export interface ProfileUpdatePort {
  // 既有
  get(proposalId: string): Promise<object | null> | object | null
  claimForApproval(proposalId: string, approvedBy: string): unknown | Promise<unknown>
  finalizeApproval(proposalId: string): unknown | Promise<unknown>
  markRejected(proposalId: string, rejectedBy: string, rejectionReason?: string): unknown | Promise<unknown>
  // 新增
  list(query: ProfileUpdateListQuery): Promise<ProfileUpdateListResult> | ProfileUpdateListResult
}
```

前端契约（UI 侧类型，落在 `web/src/lib/` 或组件内）：

```ts
export interface ProfileUpdateProposal {
  readonly id: string
  readonly targetPath: string
  readonly rationale: string
  readonly before: string
  readonly after: string
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly sourceKind: string
}
```

## 测试策略

| 子项目 | 验证方式（真实、禁 mock） |
|---|---|
| a1 端点 | 注入内存 `ProfileUpdatePort`，cats-api + 真实 webServer 端口 + 真实 fetch：根路径列表 200 且分页游标生效；`/:id` 仍 404 未知资源；approve/reject 链路不变 |
| a2 组合根 | `apps/cli` 以 web profile 启动（或 bundle 清单断言）：进程起来后真实 fetch 网关根路径返回非连接错误；bundle 清单含两行挂载 |
| a3 代理 | `next build` 退出 0；dev 下 `/api/profile-updates/*` 命中网关（可用一次真实请求验证） |
| a4 UI | 单元：卡片渲染与 409 分支（真实 fetch 打本地网关端口）；集成：Playwright 冒烟（T8.10 范畴，本子项目先以组件级真实 HTTP 测试兜底） |

## 决策门记录

### DCP-1 需求/变更决策

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| business_value | 0.40 | 0.5 | 0.9 | T8.3 主缺口（审批 UI 全无），且是档案真实化前置 |
| feasibility | 0.35 | 0.6 | 0.85 | 四段均有既有基座（cats-routes / apps/cli / next rewrites / 审批面板） |
| security | 0.25 | 0.7 | 0.85 | 身份沿用 x-user-id，审批需显式 decidedBy，不放宽 |

加权总分 **0.87** / 阈值 0.65；security 为否决维。

### DCP-2 方案决策（human_required）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| feasibility | 0.50 | 0.6 | 0.9 | 四子项目均复用既有机制，无新框架 |
| security | 0.30 | 0.7 | 0.85 | 仅本地监听 + 白名单 CORS + 身份头不放宽 |
| ux | 0.20 | 0.5 | 0.85 | 审批面板加 Tab：入口稳定、复用筛选与徽章 |

加权总分 **0.875** / 阈值 0.70；**操作者签核**（design→plan 硬门禁）：operator，日期 2026-09-08（组合根=新建 web bundle、UI=审批面板加 Tab、顺序=端→根→代理→UI，均经 operator 会话内拍板）。

## 风险预案

- 组合根端口漂移：组合根用固定默认 8787 + env 覆盖；前端代理与组合根共用同一 env 名，避免两处各写一份。
- 列表端点与 `/:id` 正则冲突：实现时先加根路径分支并用测试锁定（回归保护）。
- 并行会话在途批次导致全量 typecheck 红灯：本设计各子项目以"自身相关错误为 0"为验收口径，全量红灯归属在 PR 中如实标注。

## 自审清单（落盘前）

- [x] 占位符扫描：无未决占位标记
- [x] 内部一致性：端口、路径、Tab 落点、子项目编号全文一致
- [x] 范围检查：已按四子系统分解，每项独立可交付
- [x] 歧义检查：409 三类语义、代理顺序、端口来源均唯一解读
