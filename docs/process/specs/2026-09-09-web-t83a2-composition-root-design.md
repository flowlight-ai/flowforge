# T8.3a-a2 组合根挂载 设计文档（design-template）

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `plugin-web-t83a2`（`ff_dev status plugin-web-t83a2` 可查） |
| 工作流 | change（既有 web-app bundle 增加一行挂载） |
| 分级路径 | Bounded（对既有组合根清单的明确增补） |
| 操作者 | operator |
| 日期 | 2026-09-09 |
| 上级分解 | T8.3a：a1 端点（PR#165）→ **a2 组合根（本文件）** → a3 代理 → a4 UI |

> 本文件曾随未跟踪态丢失（并行会话 sync 周期吞掉未入库文件），现重建并随本子项目提交入库。

## 目标（Goal）

把已交付的 `@flowforge/host-cats-api`（PR#163）挂进真实组合根，使 `/api/profile-updates` 在 web-app profile 启动时可用。

## 前提修正（重要）

主设计签署时假定"仓库缺 web bundle"；实现前勘查发现**组合根已存在**：`packages/bundle/web-app/cordis.patch.yml:96-97` 已挂载 `@flowforge/host-webserver`（`inject: [webStartup]`，`host: ctx.webStartup.host ?? '127.0.0.1'`、`port: ctx.webStartup.port ?? 3080`），同清单另有 `web-runtime`、`connection` 两行。故 a2 **不新建 bundle**，只增一行 + 补依赖。

**连带口径修正**：网关端口由 `webStartup` 提供（默认 3080），不是独立 `FF_GATEWAY_PORT=8787`；a3 前端代理以 web-app 实际监听端口为准。

## 架构（Architecture）

- `packages/bundle/web-app/cordis.patch.yml` 的 layer 2（`connection` 行之后）增：

```yaml
    - id: cats-api
      name: '@flowforge/host-cats-api'
      inject: [webServer]
```

`inject: [webServer]` 与既有 `connection` 行同构：cats-api 内部调用 `ctx.webServer.register`，须等 webserver 行激活。

- `packages/bundle/web-app/package.json` 按 `host-webserver` 同构，在 `peerDependencies` 与 `devDependencies` 各补 `@flowforge/host-cats-api: workspace:^`。
- 不改 webserver 行、不新增启动脚本（`apps/cli` 已能拉起该 profile）。

## 技术栈（Tech Stack）

cordis patch YAML（Loader，含仓库自定义 `!!js` tag）+ pnpm workspace 依赖。

## 规范引用（Spec Compliance）

- 命名契约：`docs/design/naming-contract.md`
- 编程红线：`docs/rules/07-coding-redlines.md`
- 流程铁律：`docs/rules/13-dev-process.md`

## 全局约束（Global Constraints）

- 只改 web-app bundle 的 patch 清单、package.json 与其断言测试；为消费方补 `packages/cats/routes/src/index.ts` 的类型导出
- 新增行必须带 `inject: [webServer]`
- 不引入端口/地址硬编码
- 验证以既有 bundle 断言测试为落点（`!!js` 需 `entryListSchema`，普通 js-yaml 无法解析）
- 流程产物随子项目提交入库，不留未跟踪态

## 数据模型 / 接口设计

```ts
// packages/cats/routes（导出面增补，供消费方引用）
export type { ProfileUpdateListQuery, ProfileUpdateListResult } from './ports.ts'
```

## 测试策略

- 扩展 `packages/bundle/web-app/tests/web-app.spec.ts` 的 "declares web-only host rows"：`cats-api` 行的 name 与 inject
- 回归：`pnpm vitest run packages/bundle/web-app packages/host/cats-api`（7 文件 28 项）
- `pnpm tsc -b packages/host/cats-api --force` 退出码 0；`pnpm lint` 0 errors

## 决策门记录

### DCP-1 需求/变更决策

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| business_value | 0.40 | 0.5 | 0.85 | 让已交付的 cats-api 真正进入组合根 |
| feasibility | 0.35 | 0.6 | 0.95 | 一行清单 + 依赖，机制现成 |
| security | 0.25 | 0.7 | 0.9 | 复用既有绑定与身份语义，无新攻击面 |

加权总分 **0.8975** / 阈值 0.65。

### DCP-2 方案决策（human_required）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| feasibility | 0.50 | 0.6 | 0.95 | 组合根已存在，改动最小 |
| security | 0.30 | 0.7 | 0.9 | 端口与绑定沿用 webStartup |
| ux | 0.20 | 0.5 | 0.9 | 开发者启动方式不变 |

加权总分 **0.925** / 阈值 0.70；**操作者签核**：operator，日期 2026-09-09（T8.3a 主设计已签核 a2 目标；本文件记录前提修正后的最小实现）。

## 风险预案

- 端口口径漂移：a3 一律以 web-app 实际监听端口为准（dev 默认 3080），不用独立 env。
- 流程产物丢失：未跟踪文件会被并行会话 sync 周期吞掉，产物一律随子项目提交。

## 自审清单（落盘前）

- [x] 占位符扫描：无未决占位标记
- [x] 内部一致性：行 id、依赖名、端口口径一致
- [x] 范围检查：单一主题（组合根挂载），不含 a3/a4
- [x] 歧义检查：挂载位置、inject 依赖、端口来源唯一解读
