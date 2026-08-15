# FlowForge 2.0 TS 重构 — 总览

> ⛔ **每次重构开工前、每个阶段编码前、每次提交前，必须先重读 `04-code-standards.md`（三方规范合并版）**，
> 再读本文件；规范优先级固定：我方规范 → dsh 规范 → clowder 规范（冲突裁决见 04 §5）。

> 状态：进行中 ｜ 创建：2026-08-16 ｜ 更新：2026-08-16（补充：插件化前置/融合策略/Python 日落/配置格式/双栈隔离/stretch/技术栈全景对齐/开发与测试规范对齐/三方能力全集补齐）
> 本文档是重构的单一信息源，阶段任务清单见 `10-stage-map.md` 及对应 `2X-*.md`。
> 源码对照见 `02-source-crosswalk.md`；融合策略详见 `03-fusion-strategy.md`；Python 日落详见 `31-stage11-sunset.md`。
> 开发/测试规范：三方规范已合并为单一文件 `04-code-standards.md`（重构期间只读此文件）；决策溯源见 `01-stack-decision.md` R20/R21。

## 1. 背景

FlowForge 当前为 Python 3.11+ 单体（FastAPI + pydantic + Next.js 前端），提供可进化智能体
（Forgekin/灵智体）、MindCouncil 审议、五条自进化闭环等能力。为对齐业界先进的 Agent
Harness 架构，决定参考两个开源项目进行全量重构：

| 参考项目 | 路径 | 对齐内容 |
|---|---|---|
| Clowder AI (cat-cafe) | `ex/clowder-ai` | 群聊（Threads/A2A）、灵智体系统（cats）、外部 CLI 控制（Limb/tmux） |
| DeepSeek Harness (dsh) | `ex/deepseek-harness` | 编程语言与工具链（TS monorepo）、"一切皆插件"的 cordis 架构、其余全部智能体框架 |

## 2. 目标

重构后 FlowForge = Clowder AI ∪ DeepSeek Harness ∪ FlowForge 现有特色 的**功能全集**，
技术栈与插件机制对齐两个参考项目：

1. **语言/技术栈对齐**：Python → TypeScript，pnpm monorepo，cordis 插件内核，vitest 测试；
   依赖全景（better-sqlite3/ioredis/fastify/socket.io/zod/schemastery/OTEL 等）见 `01-stack-decision.md` R19。
2. **一切皆插件（第一架构原则）**：以 dsh 的 cordis 插件机制为底座**最先搭好框架**（阶段 0 落地插件基座），
   此后**所有阶段、所有域（core/cats/chat/limb/forgekin/api/cli/web）均以插件形式接入与重构**：cats对应的是我们的forgekin和forgemind灵智体啊，也就是可进化智能体
   每个功能包 = 一个 cordis 插件（`apply(ctx)` + `inject` + `schema`），由 `apps/cli` 宿主统一装配。
3. **功能对齐 Clowder AI**：群聊、灵智体（可进化智能体）、控制外部 CLI 的能力。
4. **架构对齐 DeepSeek Harness**：智能体框架与插件体系（一切皆插件）。
5. **保留 FlowForge 品牌**：Forgekin（灵智体）/ ForgeMind（灵智）/ MindCouncil 命名体系。
6. **Python 有日落计划**：功能齐平并稳定后，按 `31-stage11-sunset.md` 冻结 → 归档 → 删除，
   git 历史与行为基线永保。
7. **配置统一 dsh 格式**：YAML + schemastery schema 校验 + cordis-loader 装配（R17），
   flowforge 现有 YAML 配置迁移加载链路而非改写格式。配置格式全景（三方实测）见 `01-stack-decision.md` R17 §4：
   业务/装配/档案/技能/钩子配置 = YAML；运行态/账户/目录 = JSON；工程链 = JSON；环境变量 = `FF_*` 注册表。
8. **双栈共存零影响**：/api/v1 归 Python 旧版、/api/v2 归 TS 版；better-sqlite3 与 Python DB
   物理隔离，绝不共享写（R18）。
9. **开发与测试规范对齐（第一优先我方规范）**：三方规范已合并为单一文件 `04-code-standards.md`
   （我方 rules/ 全 8 文件 + T001-T019 + git-workflow → dsh development/testing → clowder Iron Laws，优先级固定、冲突已裁决），
   重构期间只读该文件，不再逐个引用原文（R20/R21）。
10. **能力全集三源对齐**：以 `10-stage-map.md` §3 功能全集矩阵为准，三源能力（dsh 框架插件全集、
    clowder 应用域全集、flowforge 品牌层特有能力全集）全部登记在案，移植时逐项勾选，禁止遗漏。

## 3. 核心决策（已确认）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 新旧共存 | 同仓库并行：Python 旧版原位保留可运行；TS 版在 `vendor/`+`packages/`+`apps/` 渐进开发，功能齐平后切换入口（阶段 10） |
| D2 | 源码融合 | vendor 深度定制：从 `ex/deepseek-harness` vendor cordis 全家桶与核心包；从 `ex/clowder-ai` vendor cats/chat/limb 域；在其上开发 FlowForge 特有功能 |
| D3 | 品牌命名 | 代码层 P1 英文名（`Forgekin`/`SoulImprint`/`EchoStore`/`MindCodex`/`SpiritForge`），P2 别名（灵智/灵智体）仅社交使用，遵循 `docs/design/naming-contract.md` |
| D4 | 一切皆插件（前置） | cordis 插件机制为最高架构原则：阶段 0 即搭好插件基座（宿主装配器 + 生命周期冒烟）；阶段 1-8 所有产出均以插件包形态接入，禁止游离于 ctx 之外的模块（规范见 `01-stack-decision.md` R13） |
| D5 | 三项目融合 | 分层融合：dsh 内核/框架层为底座，clowder 应用域为躯干，flowforge 进化能力为灵魂；Python 旧版降级为行为基线（golden reference），冲突消解与概念映射见 `03-fusion-strategy.md`，file→file 锚点见 `02-source-crosswalk.md` |
| D6 | Python 日落 | 阶段 9 功能齐平 + 阶段 10 入口切换 + 稳定运行后，按 `31-stage11-sunset.md` 冻结 → 归档 → 删除，git 历史永久保留 |
| D7 | 配置与隔离 | 配置统一 YAML+schemastery+cordis-loader（R17：patch 分层/环境变量注册表/运行态 JSON）；双栈路由分流 /api/v1(Py) vs /api/v2(TS)、DB 物理隔离（R18）；技术栈全景对齐（R19） |
| D8 | 范围控制 | clowder IM/world/TTS/桌面端等扩展降级为 stretch（`10-stage-map.md` §3.4），不阻塞主线 |
| D9 | 开发/测试规范 | 三方规范合并为单一文件 `04-code-standards.md`（优先级 P0 我方 → P1 dsh → P2 clowder，冲突已裁决）；测试分层 = unit/coverage/real-API e2e/snapshot/web browser（R20/R21） |
| D10 | 能力全集三源对齐 | 三源能力全部登记 `10-stage-map.md` §3 矩阵（dsh 60+ 插件包、clowder 40+ 应用域、flowforge 40+ 特色能力），按阶段勾选，发现缺失立即补档（本次已补齐 D29-D44/C23-C42/F15-F44，编号与 `02-source-crosswalk.md` 一致） |

## 4. 目标架构

```
┌─────────────────────────────────────────────────────────┐
│ 装配层  apps/cli（插件宿主+flowforge 命令） · apps/web      │ ← 组合一切插件
├─────────────────────────────────────────────────────────┤
│ 品牌层  forgekin 域插件：SoulImprint · CapabilityProfile   │
│  EchoStore · MindCodex · SpiritForge · MindCouncil        │
│  5 自进化闭环 · workflow 编译器 · EAC 七契约（flowforge）    │
├─────────────────────────────────────────────────────────┤
│ 应用层  cats 域插件（档案/编排/队列/蒸馏）                 │
│  chat 域插件（Threads/Messages/会话链/交接）               │
│  limb 域插件（外部 CLI 具身/tmux/适配器）（clowder）        │
├─────────────────────────────────────────────────────────┤
│ 框架层  plugins 域插件：mcp · skill · subagent · sandbox   │
│  shell · terminal · workflow · plan · goal · schedule ·   │
│  jobs · credentials · lsp · fs · workspace · compaction · │
│  core 域插件：scope · session · system-prompt · tools ·    │
│  agent · agent-loop（产品 API 脊柱，dsh 契约）              │
├─────────────────────────────────────────────────────────┤
│ 内核层  vendor/cordis（Context/Service/Plugin/scope）     │
│  cosmokit · schemastery · loader · logger-console · hmr   │
│  timer · include · group（一切皆插件的底座）               │
└─────────────────────────────────────────────────────────┘
```

依赖方向：内核 ← 框架 ← 应用 ← 品牌 ← 装配（单向向下）；所有能力通过 cordis 插件注入
（`ctx.*` 服务），阶段 0 先搭插件基座，阶段 1-8 全部以插件形式接入（详见 `03-fusion-strategy.md`）。

## 5. 阶段总览

| 阶段 | 名称 | 产出 | 提交署名 |
|---|---|---|---|
| 0 | 计划文档 + TS 基础设施 + **插件基座** | docs/refactor/* + 根配置 + vendor cordis + 宿主装配器 + 插件生命周期冒烟 | [luban] |
| 1 | 框架内核 core（插件化） | scope/session/system-prompt/tools/agent/agent-loop + session-title/session-query/sdk 契约 | [sherlock] |
| 2 | 插件体系 | mcp/skill/subagent/sandbox/shell/workflow/plan/goal/session-query/sdk/code-runtime/acp 等 + 插件开发契约 | [sherlock] |
| 3 | API 网关 + Web + CLI（插件化） | fastify 装配插件、flowforge 命令、boot/bundle/settings、api-gateway/remotes | [luban] |
| 4 | 灵智体系统 cats（插件化） | 档案/注册表/编排/调用队列/蒸馏/bootcamp/guide/taste/concierge | [sherlock] |
| 5 | 群聊系统 chat（插件化） | 线程/消息/@mention/会话链/交接/实时投递/审批/信号/记忆 | [sherlock] |
| 6 | 外部 CLI 控制 limb（插件化） | Limb 注册/租约/适配器 + tmux/pty 终端 | [sherlock] |
| 7 | Forgekin 进化移植（插件化） | 印记/画像/蒸馏/五闭环/三循环/审议/魔法词/群/IM 议会/评估台账/弹性栈/工作流编译器 | [sherlock] |
| 8 | 前端融合 | Next.js 全页面合并、群聊 UI 对齐 | [sherlock] |
| 9 | 集成与全量回归 | 功能矩阵核对（D/C/F 全勾选）、e2e、双栈验证 | [davinci] |
| 10 | 入口切换与收尾 | 默认入口切换、文档更新 | [wenxin] |
| 11 | **Python 日落与删除** | 冻结 → 归档 → 删除（详见 `31-stage11-sunset.md`） | [wenxin] |

## 6. 成功标准

1. `pnpm flowforge web` / `pnpm start` 一键装配全部插件并启动 TS 版全部功能。
2. 功能全集矩阵（`10-stage-map.md` §3，D/C/F 三源全量）逐项通过；Python 旧版按阶段 11 完成日落。
3. 重构期间 Python 旧版 `pytest` 保持全绿（行为基线）。
4. 插件化验收：任一功能可描述为"某插件在 ctx 上提供的服务"，可独立加载/卸载。
5. **规范验收**：编码通过 `04-code-standards.md` 全部条款（我方 15 条红线 + T1-T9 + dsh 规范检查：oxlint/tsc/覆盖率门）；测试分层齐备
   （unit/coverage/real-API e2e/snapshot/web browser，R21）。
6. 每个阶段完成即按 `04-code-standards.md` §2.7 git 流程通过 `./mgr` 提交 Gitee。
