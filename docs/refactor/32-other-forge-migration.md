# 阶段 12（建议）：其他 `*forge` 垂直项目迁移与插件化融合

> 状态：草案 ｜ 创建：2026-08-16 ｜ 关联：`00-overview.md`（品牌层）、`03-fusion-strategy.md`
> （融合分层）、`02-source-crosswalk.md`（P→T 对照）、`22-stage2-plugins.md`（R13 插件契约）、
> `31-stage11-sunset.md`（Python 日落）
> 回答用户问题：**现有 contentforge / devforge / mallforge / novelforge / stockforge（及
> openclaw 下的 demoforge）如何集成或以插件形式融合进新的 TS flowforge？**

---

## 1. 现状盘点：它们本就是 FlowForge 的插件

经实测 `D:\software\fl\flowlight` 下的 `*forge` 项目，**它们不是独立产品，而是 FlowForge 的
"Plugin V3 域插件"** —— 这正是新架构"一切皆插件"的最有力证据，也意味着迁移是"提升（lift）"
而非"重写"。

| 项目 | 领域 | 当前端口 | 证据（实测） |
|---|---|---|---|
| `devforge` | AI 软件开发工厂 | API 8002 / Web 5176 | `pyproject.toml`：`description="Software Development Domain Plugin for FlowForge"`、`dependencies:["flowforge"]`、`[project.entry-points."flowforge.domains"]`；`requirements.txt:-e ../flowforge`；`plugins.py` 导入 `flowforge.core.plugin_protocol`、`flowforge.sdk.FlowForgeSDK` |
| `mallforge` | AI 电商运营工厂 | API 8004 / Web 5178 | 同上结构；`plugins.py` 同 V3 四钩子；`config/agents/` 6 个 YAML |
| `novelforge` | AI 小说创作工厂 | — | 同上；含 `mcp_server/`、`tools/` |
| `stockforge` | AI 投研/交易工厂 | — | 同上；含 `tools/`、`workers/`、`scripts/` |
| `contentforge` | AI 内容创作工厂 | API 8001 | `app/api/endpoints/content.py`、`config/agents/`、`docs/prompts/`、`web/` |
| `demoforge` | 演示垂直 | — | 位于 `openclaw/`，结构同族（**不单独迁移**，见 §7） |

每个 `*forge` 的共同结构（实测）：
- `plugins.py`：Plugin V3 入口，含 `register_forgekins` / `register_forge_skills` /
  `register_council_channels` / `register_auto_forge_config` 四个注册钩子，及事务性
  `on_activate` / `on_disable`（CL-024）+ `rollback_activate/rollback_disable` 回滚钩子；
  使用 `sdk = FlowForgeSDK(project="<forge>")` + `sdk.create_plugin(...)`。
- `config/agents/*.yaml`：声明式 Forgekin 智能体（devforge 24 个：coder/reviewer/
  test_generator/deployer/architect/bug_analyzer/…；mallforge 6 个：cs_agent/product/
  marketing/data_analyst/ad_optimizer/…）。
- `docs/prompts/`：领域提示词；`tools/`（mall/novel/stock）与 `workers/`：领域工具与后台任务；
  `app/api/endpoints/*`：领域 API；`web/`：独立 Next.js 前端（各自端口）。

> 结论先行：新 TS flowforge 应**保留 Plugin V3 契约（翻译成 cordis + `@flowforge/plugin-contract`）**，
> 把每个 `*forge` 提升为一个 **cordis bundle**（插件包 + `cordis.patch.yml` 装配行），挂载其
> 垂直能力。这比"另起炉灶重写"成本低一个数量级，且直接验证"一切皆插件"是否成立。

---

## 2. 核心映射：Plugin V3 协议 → cordis / plugin-contract

| Plugin V3 概念（Python，实测） | 新 TS flowforge 落点 | 说明 |
|---|---|---|
| `pyproject` entry-points `flowforge.domains` | bundle 清单（`cordis.patch.yml` 的 `insert` 行 / `packages/bundle/*`） | 插件发现从 Python entry-points 改为 dsh YAML 装配（R13/R17） |
| `FlowForgeSDK(project=...)` + `sdk.create_plugin(...)` | `@flowforge/plugin-contract` 插件类（`apply(ctx)`） | 每个 `*forge` = 一个 `@flowforge/<domain>-plugin` 包 |
| `on_activate`（加载 YAML + 注册命名空间 + PromptManager） | cordis 插件 `apply(ctx)` 内 `ctx.effect(...)` 注册 | **天然对应**：cordis effect 卸载自动回滚，正好实现 `on_disable`/`rollback_*` |
| `on_disable` / `rollback_*` | cordis effect 自动 unwind（无需手写 teardown） | 消除 Python 端"事务性启停钩子"的重复代码 |
| `register_forgekins`（读 `config/agents/*.yaml`） | Forgekin 档案 → `packages/forgekin/*` 或 `packages/<domain>/agents`（阶段 7 + `02` §3） | YAML 智能体声明**近原样翻译** |
| `register_forge_skills` | skill 插件（`packages/plugins/skill`，T2.2） | 技能库改挂 cordis skill 服务 |
| `register_council_channels` | MindCouncil 频道（`packages/forgekin/council`，F5） | 跨厂商审议基础复用 `packages/chat` approval-hub |
| `register_auto_forge_config` | 自进化配置（`packages/forgekin/loops`，F6） | 五闭环配置平移 |
| `config/plugins.yaml`（`PluginRegistry.load_from_config`） | `cordis.patch.yml` 行 | 声明式工具/资源注册平移 |
| `app/api/endpoints/*` | TS API 插件，挂 `/api/v2/<domain>/*`（R18） | 与 Python `/api/v1/*` 物理隔离共存 |
| `web/` 页面 | `apps/web/app/<domain>/` 路由（阶段 8） | socket.io-client 统一 |
| `tools/`、`workers/` | TS tool 插件（`ctx.tools`）+ 后台 job 插件（`ctx.jobs`） | 领域工具平移 |

**关键收益**：Plugin V3 的"事务性启停（CL-024）"在 cordis 下变成 `ctx.effect` 的免费特性 ——
插件卸载时所有注册（服务/工具/路由/事件监听）自动回滚，无需 `rollback_*` 手写逻辑。这证明
新内核的插件模型比旧的更简洁，迁移是"减代码"而非"加代码"。

---

## 3. 每个 `*forge` 的迁移清单（表面拆解）

对任意一个 `*forge`，迁移 = 把下表左侧"垂直表面"逐项抬升为右侧 TS 构件：

| 垂直表面（Python） | TS 构件 | 工作量量级 |
|---|---|---|
| `config/agents/*.yaml`（N 个 Forgekin） | `packages/<domain>/agents/*.yaml`（Forgekin 档案，结构对齐 clowder `cat-template.json`） | 低（YAML 平移 + 字段校验） |
| `plugins.py` 四钩子 + `on_activate/on_disable` | `packages/@flowforge/<domain>-plugin/src/index.ts`（`apply(ctx)`，用 `ctx.effect` 注册） | 中（薄适配层，逐钩子翻译） |
| `docs/prompts/*` | `packages/<domain>/prompts/*.yaml`（prompt 插件 schema 段，见 `02` §2 末） | 低 |
| `tools/*`、`workers/*` | `packages/plugins/<domain>-tools`（`ctx.tools` 注册）+ `ctx.jobs` 后台任务 | 中（逻辑平移） |
| `app/api/endpoints/*` | `packages/<domain>/api`（fastify 插件，挂 `/api/v2/<domain>/*`） | 中 |
| `web/*` | `apps/web/app/<domain>/*` | 高（前端页面，阶段 8 同策略） |
| `pyproject` entry-points / `requirements:-e ../flowforge` | 加入 pnpm workspace + bundle `cordis.patch.yml` 行 | 低 |

> 由于领域逻辑绝大多数沉淀在 **YAML 智能体 + 提示词 + 薄钩子代码** 中，迁移主体是
> **配置翻译 + 薄适配层**；重活（内核、插件宿主、Forgekin、技能、审议）在阶段 0-7 一次性完成，
> 之后每个垂直只是"挂一个 bundle"。这正是"一切皆插件"的红利。

---

## 4. 集成架构：bundle 如何挂入新 flowforge

```
apps/cli (插件宿主, R13)
  └─ 装配层读取 bundle 清单
       ├─ @flowforge/core-*        (dsh 内核, 阶段1)
       ├─ @flowforge/plugins-*     (dsh 插件, 阶段2)
       ├─ @flowforge/cats|chat|limb(lowder 应用域, 阶段4-6)
       ├─ @flowforge/forgekin-*    (flowforge 品牌层, 阶段7)
       └─ @flowforge/<domain>-plugin  ← 本阶段新增：每个 *forge 一个 bundle
            注入 ctx.* 服务，挂载：
              · Forgekin 档案 (agents/*.yaml)
              · skill / council-channel / auto-forge 配置
              · domain tools + jobs
              · /api/v2/<domain>/* 路由
              · apps/web/app/<domain>/* 页面
```

规则（沿用 R13/R14/R18）：
1. 每个 `*forge` bundle **只通过 `ctx.*` 服务协作**，不跨包引用实现类。
2. 垂直 API 全部在 `/api/v2/<domain>/*`（与 Python v1 隔离，R18）；前端路由在 `apps/web/app/<domain>/`。
3. bundle 可独立 enable/disable；卸载后其服务/路由/工具全部消失（插件隔离）。
4. 配置走 schemastery schema + patch 分层（R17），其 `config/agents/*.yaml` 作为 Forgekin 默认 profile。

---

## 5. 阶段规划（建议作为"阶段 12"）

> 前置依赖：阶段 0（插件基座）+ 阶段 2（`@flowforge/plugin-contract`）+ 阶段 7（Forgekin /
> skills / MindCouncil）+ 阶段 3（API 装配）+ 阶段 8（前端融合）稳定后，本阶段才可启动。
> 即：先把"平台"做稳，再把"垂直"挂上去。建议将本条加入 `10-stage-map.md` §2 索引与 §1 依赖图。

### 5.1 执行顺序（按成熟度）
1. **devforge（模板）**：Plugin V3 最成熟（24 个 Forgekin、四钩子齐全），先迁它跑通"Python V3 → TS bundle"
   全链路，沉淀 `scripts/migrate-plugin-v3` 迁移脚手架，作为其余垂直参照。
2. **mallforge**：6 个 Forgekin + 电商 skills + `tools/`，结构标准，复用 devforge 脚手架。
3. **novelforge**：含 `mcp_server/`，顺带验证 MCP 桥接在垂直插件中的用法。
4. **stockforge**：含 `tools/`、`workers/`、`scripts/`，验证后台 job 插件（`ctx.jobs`）。
5. **contentforge**：含独立 `helm_ws_manager.py`，验证 WebSocket/helm 通道在 TS 下的归属。

### 5.2 每步 DoD
- [ ] 该 `*forge` 以 TS bundle 形式被 `apps/cli` 装载，启动后其 Forgekin 出现在注册表。
- [ ] `/api/v2/<domain>/*` 路由可用；`apps/web/app/<domain>/*` 页面可访问。
- [ ] bundle 卸载后服务/路由/工具全部消失（隔离测试通过）。
- [ ] 行为对照：垂直智能体在 TS 下的回复与 Python V3 基线在 golden tests 上等价。
- [ ] `pnpm test` + 对应 Python `pytest`（旧版行为基线）双绿。
- [ ] 按 `docs/git-workflow.md` 用 `./mgr` 提交（`feat(<domain>): *forge垂直插件化 [sherlock]`）。

---

## 6. 迁移工具（建议随 devforge 一起产出）

`scripts/migrate-plugin-v3`：读一个 `*forge` 的 `plugins.py` + `config/agents/*.yaml` +
`config/plugins.yaml`，生成：
- `packages/@flowforge/<domain>-plugin/` 骨架（`apply(ctx)` + `ctx.effect` 注册桩）；
- 将 `config/agents/*.yaml` 转写为 Forgekin 档案模板；
- 生成 bundle 的 `cordis.patch.yml` 装配行（insert 该插件）。
人工再补领域工具/API/UI 平移。目标是把"机械翻译"自动化，把人力留给"领域逻辑正确性"。

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| **漂移（drift）**：部分 `*forge` 可能越过插件契约、直接 import flowforge 内部模块或加私有端点 | 迁移前先 `grep` 审计每个 `*forge` 对 `flowforge.*` 的引用；越界部分必须改为经 `ctx.*` 服务表达，或在新 `plugin-contract` 中补契约。禁止把内部耦合搬进 bundle |
| **editable pin 反模式**：各 `*forge` `requirements.txt` 写 `-e ../flowforge` | 新架构下不再有" editable 依赖 flowforge"；垂直就是 flowforge 的 bundle，编译期纳入 workspace |
| **多端分叉**：`flowlight-ai/`（GitHub）与 `openclaw/` 下有同名 `*forge` 副本 | **不迁移分叉**。新 TS bundle 是单一事实源；GitHub 端经 `./mgr merge-cross` 同步（见 `docs/git-workflow.md`），openclaw 的 `demoforge` 由同一 bundle 派生，不单独维护 |
| **前端重复**：每个 `*forge` 自带 `web/`（各自端口） | 统一收口到 `apps/web/app/<domain>/`，删除各自 Next.js 实例（阶段 8 策略一致） |
| **配置格式差异**：各 `*forge` 的 `config/plugins.yaml` 字段可能不完全一致 | 以 `02-source-crosswalk.md` §3 为基线，统一为 schemastery schema（R17），迁移脚本做字段兼容 |

---

## 8. 验收标志（阶段 12 整体）

1. 任一 `*forge` 可描述为"某 bundle 在某 ctx 上提供的某服务"（无游离模块）。
2. 全部垂直 bundle 可独立 enable/disable，互相隔离。
3. `pnpm start` 一键装配内核 + 应用域 + 品牌层 + 全部垂直 bundle，启动完整产品。
4. Python 旧版 `*forge` 仍可作为行为基线对照（日落流程见 `31-stage11-sunset.md`），功能齐平后退役。

## 9. 一句话总结

> 其他 `*forge` 项目**已经是 FlowForge 的插件**（Plugin V3 域插件）。新架构不必"融合"它们，
> 而是**保留插件契约、把它翻译成 cordis bundle**：领域逻辑（YAML 智能体 + 提示词 + 薄钩子）
> 近原样平移，事务性启停由 cordis `ctx.effect` 自动接管。这是"一切皆插件"最自然的延伸，
> 也是验证整套重构是否成立的最佳试金石。
