# T8.1 web/ 并入根 pnpm workspace 设计文档（design-template）

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `plugin-web-t81`（`ff_dev status plugin-web-t81` 可查） |
| 工作流 | change（既有工程结构变更，轻量门禁） |
| 分级路径 | Bounded（brainstorming ① 第一步分级；对既有仓库结构的明确改动） |
| 操作者 | operator |
| 日期 | 2026-09-07 |

## 目标（Goal）

将顶层独立 Next.js 工程 `web/`（`@flowforge/web`）原地并入根 pnpm workspace，统一依赖管理到根 lockfile，并在 CI 上实现 TS 包矩阵与 web 构建的分层触发——完成批次 56（阶段 8 前端补齐）的基础工程接线（`docs/refactor/28-stage8-web.md` T8.1）。

## 架构（Architecture）

- **并入方式（DCP 已拍板）**：`web/` 目录原地不动，根 `pnpm-workspace.yaml` 的 `packages:` 增加 `- web` 一行。零路径破坏：现有文档、脚本、CI 对 `web/` 路径的引用全部保留。
- **依赖收敛**：删除 `web/pnpm-workspace.yaml`、`web/package-lock.json`、`web/pnpm-lock.yaml`，web 依赖（next 14 / react 18 / lucide-react / @xyflow/react / @ducanh2912/next-pwa 等）统一由根 lockfile 管理；web 依赖若含构建期 postinstall 脚本，在根 workspace `allowBuilds` 显式登记。
- **CI 分层**：`ts-ci.yml` 的 TS 包矩阵触发路径排除 `web/**`；新增独立 web job（`next lint` + `next build`），仅 `web/**` 变更触发。两条流水线互不阻塞。
- **与既有系统的关系**：web 不进入根 `tsc -b` 构建图（保持 Next.js 独立构建体系，next.config.js / tailwind / postcss 均不动）；`scripts/sync-vendor-assets.mjs` 与 `predev`/`prebuild` 钩子保留；web 现有页面与组件零改动。

## 技术栈（Tech Stack）

- 包管理：pnpm 11.7.0（Corepack，根 workspace 统一）
- web 应用：Next.js 14 + React 18 + Tailwind + Zustand + socket.io-client（既有，不引入新依赖）

## 规范引用（Spec Compliance）

- 编程红线：`docs/rules/07-coding-redlines.md`
- 测试铁律：T1-T9（`docs/rules/test-iron-rules.md`）
- 文档分层：`docs/rules/11-doc-layering.md`
- Git 流程：`docs/mgr/`（`./mgr sync`，PR 标题 ≤191 字符）
- 流程铁律：`docs/rules/13-dev-process.md`（本实例即按其推进）

## 全局约束（Global Constraints）

- `web/` 目录内源码、页面、配置文件内容零改动（仅删除独立 lockfile/workspace 文件）
- 不修改根 `tsconfig.json`/`tsconfig.host.json` 引用拓扑
- 根 `pnpm-lock.yaml` 唯一 lockfile；不允许出现第二份 workspace 声明
- `allowBuilds` 只允许为实际需要构建脚本的 web 依赖登记，禁止全量放行
- Node ^22.19.0 || >=24.0.0；所有验证命令退出码 0 才可进入 verify 证据

## 测试策略

本任务为工程接线，无业务逻辑新增，TDD 不适用；验证以命令证据为准：

1. 根 `pnpm install` 退出 0（lockfile 吸收 web 依赖）
2. `pnpm --filter @flowforge/web build`（next build）退出 0
3. 根 `pnpm typecheck` 与 `pnpm lint` 结果不劣化（与 main 基线一致）
4. 全部证据经 `ff_dev evidence plugin-web-t81` 登记（verify 硬门禁）

## 决策门记录

### DCP-1 需求/变更决策

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| business_value | 0.40 | 0.5 | 0.9 | 批次 56 主线任务，前端工程底座 |
| feasibility | 0.35 | 0.6 | 0.9 | 原地并入，改动面最小，无路径破坏 |
| security | 0.25 | 0.7 | 0.9 | 统一 lockfile 消除双仓库依赖漂移面 |

加权总分 **0.90** / 阈值 0.65；security 为否决维。登记：`ff_dev gate plugin-web-t81 design --score 0.90 --evidence <本文件>`。

### DCP-2 方案决策（human_required）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| feasibility | 0.50 | 0.6 | 0.9 | 三选一方案中 churn 最小 |
| security | 0.30 | 0.7 | 0.9 | 依赖收敛，allowBuilds 显式登记 |
| ux | 0.20 | 0.5 | 0.8 | 开发者工作流不变（路径/命令零变化） |

加权总分 **0.89** / 阈值 0.70；**操作者签核**（design→plan 硬门禁）：操作者 operator（会话内确认"原地并入"+ 确认设计），日期 2026-09-07。

## 风险预案

- pnpm 多实例依赖冲突（React/Next 生态在根 store 的已知坑）：web 局部 `.npmrc`/`pnpm.overrides` 隔离，不动根版本。
- web 依赖 postinstall 构建脚本被拒：在根 `allowBuilds` 逐个显式登记（构建失败信息会指明包名）。

## 偏差记录（implement 阶段）

- **DCP-2 补充签核（2026-09-08）**：workspace 内发现 `packages/web/web` 已占用 `@flowforge/web`（ctx.web 能力缝插件），前端包改名 **`@flowforge/web-app`**（operator 会话内拍板）；"web 配置零改动"约束豁免 package.json 的 name 字段（元数据）。另：`web/node_modules.bak/`（旧备份，已被 .gitignore）经 operator 拍板删除——其 TS 源文件被 next build 类型检查扫入导致构建阻塞。

## 自审清单（落盘前）

- [x] 占位符扫描：无 TBD/TODO/空节
- [x] 内部一致性：各节术语、数值、路径互相一致
- [x] 范围检查：单一主题（工程接线），无需分解
- [x] 歧义检查：布局方式、删除文件清单、CI 分层口径均唯一解读
