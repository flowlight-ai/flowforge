# FlowForge 2.0 — 三项目融合策略（深度思考）

> 状态：进行中 ｜ 创建：2026-08-16 ｜ 关联：`00-overview.md` §3、`01-stack-decision.md` R13-R18、
> `02-source-crosswalk.md`（file→file 三方对照地图）
> 本文回答：三个项目如何融合为一个产品，而不只是"代码拼盘"。

## 1. 三者本质定位

| 项目 | 角色 | 提供什么 | 类比 |
|---|---|---|---|
| DeepSeek Harness | **内核/框架层** | cordis 插件内核、agent 运行时（scope/session/tools/agent/loop）、60+ 框架插件、host/client 进程模型 | 操作系统 |
| Clowder AI | **应用/协作层** | 群聊 threads/messages、灵智体档案与调用队列（cats）、外部 CLI 具身（limb/tmux）、市场/世界/治理、Fastify+socket.io 单体服务 | 社交平台 |
| FlowForge（Python 旧版） | **品牌/进化层** | Forgekin 灵智体（SoulImprint/EchoStore/MindCodex/SpiritForge）、MindCouncil 跨厂商审议、五自进化闭环、workflow 编译器、EAC 七契约 | 灵魂 |

融合结论：**以 dsh 的内核为底座，clowder 的应用域为躯干，flowforge 的进化能力为灵魂**，
三者通过 cordis 插件机制统一接入，Python 旧版降级为"行为基线"（golden reference），
完成功能齐平后按 `31-stage11-sunset.md` 日落。

## 2. 融合分层模型（单向依赖，全插件化）

```
┌──────────────────────────────────────────────────────────────┐
│ 装配层  apps/cli（插件宿主+入口命令） · apps/web（Next.js）     │ ← 组合一切插件
├──────────────────────────────────────────────────────────────┤
│ 品牌层  packages/forgekin/*（flowforge 原创移植）              │ ← 依赖应用层+框架层
├──────────────────────────────────────────────────────────────┤
│ 应用层  packages/cats/* · chat/* · limb/* · terminal/*        │ ← 依赖框架层
│         （clowder vendor 深度定制）                            │
├──────────────────────────────────────────────────────────────┤
│ 框架层  packages/core/* · harness/* · plugins/* · llm         │ ← 依赖内核
│         （dsh vendor 深度定制）                                │
├──────────────────────────────────────────────────────────────┤
│ 内核层  vendor/cordis 全家桶（Context/Service/Plugin/scope）   │ ← 一切皆插件的底座
└──────────────────────────────────────────────────────────────┘
```

规则：
1. **依赖只向下**：内核不感知任何上层包；框架层不 import 应用层；品牌层可依赖全部下层。
2. **一切皆插件**：每个包导出一个 cordis 插件（`apply(ctx)` + `inject` + `schema`），
   `apps/cli` 是唯一宿主装配器，按插件清单（manifest）加载并启动（详见 `01-stack-decision.md` R13）。
3. **服务即契约**：跨域协作只通过 `ctx.*` 服务接口，不跨包直接引用实现类。

## 3. 冲突消解表（融合的关键决策）

| # | 冲突点 | dsh | clowder | flowforge(Py) | 消解方案 |
|---|---|---|---|---|---|
| F1 | 运行时 | Node ≥22.19 | Node ≥24 | Python 3.11 | TS 统一 `^22.19.0 || >=24`；Python 仅行为基线 |
| F2 | 插件机制 | cordis 内核 | 自研 service 装配 | 装饰器/注册表 | **统一 cordis**：所有域 = 插件，clowder 的 service 层改写为 cordis Service |
| F3 | 会话模型 | session（agent 运行时事件日志） | thread（群聊社交线程） | 任务/使命上下文 | 双视图：thread=社交视图（clowder），session=运行时记录（dsh）；cats TranscriptWriter 做 threadId↔sessionId 关联 |
| F4 | 存储接口 | storage 抽象包 | ports（ThreadStore/MessageStore…）+ better-sqlite3 | sqlite + 记忆库 | 双接口并存：clowder ports 服务应用域，dsh storage 服务 agent 运行时；底层统一 better-sqlite3，Redis 仅可选加速 |
| F5 | 智能体执行 | agent-loop 通用循环 | cats InvocationQueue 调度 | Forgekin 进化上下文 | 三层管线：cats 队列（外层调度）→ `ctx.agentLoop`（dsh 通用循环）→ forgekin 插件注入记忆/审议/进化钩子 |
| F6 | 智能体身份 | Agent registry | Cat profile（frontmatter） | Forgekin SoulImprint | 概念映射 cat→Forgekin；frontmatter 扩展 soul imprint/capability 字段；`catId` schema 保留为兼容别名 |
| F7 | API 服务 | 内置 web（dsh 风格） | Fastify4+socket.io | FastAPI+WS | Fastify4+socket.io（clowder）；路由按域拆分为 fastify 插件，由 api 装配插件挂载 |
| F8 | 前端 | Next.js 14 管理台 | Next.js 14 群聊/档案/市场 | Next.js 14 council/mission/memory | 合并为单一 `apps/web`；页面路由按域目录组织，socket.io-client 统一 |
| F9 | CLI 语义 | dsh cli（宿主命令） | — | start.bat/mgr | `apps/cli` = 插件宿主 + `flowforge` 命令；limb 域是"控制外部 CLI"的插件，与宿主命令互不混淆 |
| F10 | 进程模型 | host/client 多进程 | 单进程服务 | 单进程 | 默认单进程（clowder 模式）+ loader/hmr 热更新；dsh host/client 作为可选部署模式（阶段 3 之后） |
| F11 | 依赖来源 | npm 公开包 | 部分私有包不可用 | pip | 私有/rc 依赖全部 vendor 源码 + 保留 LICENSE/THIRD_PARTY_NOTICES |
| F12 | 智能体品牌 | Agent | Cat | Forgekin（灵智体） | 代码层 P1 名统一 Forgekin；UI 层禁用 "cat" 词汇（`naming-contract.md`） |
| F13 | 开发/测试规范来源 | development.md/testing.md（TS strict、vendor 编辑禁令、prefer real implementation） | AGENTS.md Iron Laws（单一事实源、拒绝复制粘贴调试等 4 条） | 我方 rules/（04-code-style/05-dev-spec/07-coding-redlines 15 条红线/08-flowforge-boundary/11-doc-layering/12-doc-refactor-methodology/git-workflow）+ 测试铁律 T1-T9 | **优先级固定**：我方开发规范 + 测试铁律第一优先 → dsh 规范补充（未覆盖处）→ clowder Iron Laws 兜底；冲突时 T1（禁止 Mock LLM 优先）> dsh llm-mock-server（仅 unit/契约层可用，R21） |
| F14 | 配置格式 | YAML（cordis.yml/cordis.patch.yml/preset.yml/agent.cordis.yml/SKILL.md frontmatter）+ JSON（hooks.json/工程链）+ DSH_* env + schemastery schema | JSON（cat-template.json/.cat-cafe 运行态）+ YAML（connector.yaml/plugin.yaml/hook.yaml/profile frontmatter）+ CAT_CAFE_* env-registry | YAML 全量（config/*.yaml 30+，无 schema 校验） | **格式边界**：声明类配置全 YAML（业务/装配/档案/技能/钩子），JSON 仅运行态数据与工程链，环境变量统一走 FF_* 注册表，加载链路 = schemastery schema 校验 + cordis patch 分层装配（R17 §4，T0.19） |
| F15 | 插件发现模型 | cordis YAML 装配（cordis.yml + patch 分层 + `ctx.plugin()` 注入，无中心 registry） | 文件系统扫描 + host-inventory 控制面审批 | plugin_loader/plugin_manager/plugin_registry（自研注册表） | **统一 dsh cordis YAML 装配**：FlowForge 自有插件（marketplace）同为装配声明；clowder host-inventory 降级为控制面视图（展示/审批，不驱动加载），Python 注册表机制废弃（闭合 review_hy §4.5） |

## 4. 概念映射表（移植时的翻译字典）

| 概念 | dsh | clowder | flowforge P1 | TS 落点 |
|---|---|---|---|---|
| 智能体 | Agent | Cat | Forgekin | `packages/core/agent` + `packages/cats/registry` |
| 档案 | — | CatProfile（frontmatter） | SoulImprint + CapabilityProfile | `packages/cats/profile` + `packages/forgekin/imprint` |
| 会话 | Session（event-sourced） | Thread + Transcript | Mission 上下文 | `packages/core/session` + `packages/chat/threads` |
| 记忆 | SessionStore | MemoryStore | EchoStore（情景）+ MindCodex（程序） | `packages/forgekin/stores` |
| 工具 | Tool（ctx.tools） | — | — | `packages/core/tools` |
| 技能 | Skill | SkillPack | — | `packages/plugins/skill` |
| 执行循环 | AgentLoop | InvocationQueue | 五闭环（进化侧） | `packages/core/agent-loop` + `packages/cats/invocation` + `packages/forgekin/loops` |
| 审议 | — | 审批 Hub/投票 | MindCouncil | `packages/forgekin/council`（复用 approval-hub 基础） |
| 外部 CLI | — | Limb | EAC 七契约 | `packages/limb`（适配器接口对齐 EAC 契约） |
| 工作流 | Workflow | — | workflow 编译器 YAML→执行图 | `packages/plugins/workflow` + `packages/forgekin/compiler` |
| 存储 | Storage | Stores/ports | 记忆库 | 双接口（见 F4） |
| 前端路由 | Web UI | routes/* | council/mission/memory/review | `apps/web/app/<域>/` |
| 会话标题/遥测 | session-title/session-telemetry | — | — | `packages/core/session-title` + `packages/core/session-telemetry` |
| 会话查询/导出 | session-query（sqlite/export/tool） | — | — | `packages/session-query/*` |
| SDK/ACP | sdk（JSON-RPC）/ acp | — | — | `packages/sdk/*` + `packages/acp` |
| 代码运行时 | code-runtime（worker-thread） | — | — | `packages/code-runtime/*` |
| 附件/Web 工具族 | attachment/web/web-search | — | — | `packages/attachment` + `packages/plugins/web*` |
| 目标/上下文 | goal 族 / context 族 | — | — | `packages/plugins/goal` + `packages/core/context` |
| host 家族 | host/*（apiproxy/plugin-inventory/webserver） | — | — | `packages/host/*` |
| 预设 | preset（agent-presets/persona） | — | forgekins 档案 | `packages/preset`（结构对齐 forgekins/*.yaml） |
| 魔法词 | — | — | magic_words（A011） | `packages/forgekin/magic-words` |
| 群聊编排 | — | orchestration | swarm（F049） | `packages/forgekin/swarm`（orchestration 之上） |
| IM 议会 | — | 多通道 push（stretch） | im_council（F047） | `packages/forgekin/im-council` + `packages/chat/channels` |
| TeamAct 转向 | — | — | teamact_steer（F048） | `packages/cats/teamact` |
| 评估台账/控制面 | — | harness-eval（16 域） | eval_ledger（F050） | `packages/forgekin/eval-ledger` + `packages/forgekin/harness-eval` |
| 进化引擎 | — | — | evolution engine 三循环（F046） | `packages/forgekin/evolution-engine` |
| 弹性栈 | — | — | circuit_breaker/recovery_tiers（A004/A022） | `packages/plugins/resilience` |
| 特性开关/金丝雀 | — | — | feature_flags/canary | `packages/plugins/feature-flags` + `packages/plugins/canary` |
| 模式执行器 | — | — | base_mode_executor/modes | `packages/plugins/modes` |
| SOP | — | — | sop/ + config/sops/*.yaml | `packages/forgekin/sop` |
| 物种 | — | breeds（cat-template） | species + species_impl | `packages/forgekin/species` |
| 锻造流水线 | — | Bootcamp | forging/（F028） | `packages/forgekin/forging` + `packages/cats/bootcamp` |
| Trae 桥 | — | — | trae_bridge（F045） | `packages/forgekin/trae-bridge` |
| 球权托管 | — | ball-custody | push-back 协议（F006） | `packages/chat/ball-custody` |
| 礼宾/指南 | — | concierge + guides/registry.yaml | — | `packages/cats/guides` |
| 梦境回放 | — | auto-dream | auto_dream（F051） | `packages/forgekin/auto-dream` |

## 5. 行为基线（Python 旧版的正确用法）

Python 旧版在融合过程中不是"待删除的包袱"，而是**行为基线**：

1. **用例转写**：每个域移植前，从 Python 实现与测试提取行为用例（输入/输出/边界），
   转写为 TS golden tests；TS 实现必须通过同一套场景（尤其 `10-stage-map.md` §3 功能全集矩阵
   D1-D44/C1-C42/F1-F51 全部条目）。
2. **双栈回归**：阶段 1-9 全程 `pytest` 全绿，TS 新功能与 Python 行为逐项对照。
3. **知识迁移**：flowforge 独有的算法细节（五闭环状态机、workflow 编译器 DAG 构建、
   MindCouncil 阈值逻辑、7 层 harness）从 Python 源码直接翻译，禁止凭印象重写。
4. **冻结与删除**：功能齐平（阶段 9 验收）后按 `31-stage11-sunset.md` 走
   冻结 → 归档 → 删除三阶段，git 历史永久保留。

## 6. 融合的验收标志

1. 任一功能均可描述为"某插件在某 ctx 上提供的某服务"（无游离模块）。
2. 卸载任一域插件后，其余域不受影响（插件隔离测试通过）。
3. 概念映射表全部落地：UI 无 "cat"，代码无 P2 别名，Python 行为用例 100% 转写。
4. 单命令 `pnpm start` 装配全部插件启动完整产品。
