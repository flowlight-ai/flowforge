# FlowForge 0.2.0 — 阶段地图与功能全集矩阵

> 更新：2026-08-16 阶段 0 增加插件基座与配置体系基座；新增阶段 11 Python 日落；
> 全部阶段以插件形式接入；上游应用平台 IM/TTS/世界等扩展降级为 stretch（§3.4）；技术栈/配置全景对齐 R17/R19；
> 开发/测试规范对齐 R20/R21；**能力全集三源补全**：D29-D44（上游框架参考会话族/sdk/acp/code-runtime/
> web 工具族等）、C23-C42（上游应用平台 auto-dream/harness-eval/env-registry 等）、F15-F44（flowforge
> 魔法词/swarm/IM 议会/进化引擎/弹性栈等），编号与 `02-source-crosswalk.md` 完全一致。

## 1. 阶段依赖图

```
阶段0 计划+基础设施+插件基座 ─► 阶段1 core(插件化) ─► 阶段2 plugins ─► 阶段3 api/cli(插件化)
                                                          │
阶段4 cats(插件化) ─► 阶段5 chat(插件化) ─► 阶段6 limb(插件化)  │
        └────────────┴────────────┴──► 阶段7 forgekin(插件化) ◄┘
                                     │
阶段8 前端融合 ◄─────────────────────┘
   │
阶段9 集成回归 ──► 阶段10 入口切换 ──► 阶段11 Python 日落(冻结→归档→删除)
```

- **插件化前置**：阶段 0 先搭好 cordis 插件基座（宿主装配器 + 生命周期冒烟），阶段 1-8 所有
  域（core/cats/chat/limb/forgekin/api/cli）均以 cordis 插件包形态接入与重构（契约见
  `01-stack-decision.md` R13），禁止游离于 `ctx` 之外的模块。
- 阶段 1-3 为上游框架参考实现骨架（框架层），阶段 4-6 为上游应用平台功能（应用层），阶段 7 为
  flowforge 特色（品牌层），阶段 8-10 为融合收尾，阶段 11 为 Python 日落（`31-stage11-sunset.md`）。
- 每阶段完成 = 实现 + vitest 通过 + `./mgr` 提交，Python 旧版全程保底（行为基线）。

## 2. 阶段任务清单索引

| 文档 | 范围 |
|---|---|
| `00-overview.md` | 总览（目标/决策/架构/阶段总览） |
| `01-stack-decision.md` | 技术栈决策 R01-R21（插件契约 R13/配置体系 R17/双栈隔离 R18/技术栈对齐 R19/开发规范对齐 R20/测试规范对齐 R21） |
| `02-source-crosswalk.md` | 源码对照地图（file→file 三方锚点 + 行为基线工作流） |
| `03-fusion-strategy.md` | 三项目融合策略（分层/冲突消解/概念映射/行为基线） |
| `10-stage-map.md` | 阶段地图 + 功能全集矩阵（本文件） |
| `20-stage0-infra.md` | TS 根配置、vendor cordis、**插件基座**、CI 冒烟 |
| `21-stage1-core.md` | scope/session/system-prompt/tools/agent/agent-loop（插件化） |
| `22-stage2-plugins.md` | 插件体系与插件开发契约（mcp/skill/workflow 等） |
| `23-stage3-api-cli.md` | fastify 装配、socket.io、flowforge CLI、boot/bundle/settings |
| `24-stage4-cats.md` | 灵智体系统（clowder cats 域移植，插件化） |
| `25-stage5-chat.md` | 群聊系统（threads/messages/@mention/交接，插件化） |
| `26-stage6-limb.md` | 外部 CLI 控制（Limb/tmux/pty/适配器，插件化） |
| `27-stage7-forgekin.md` | Forgekin 进化内核（印记/画像/五闭环/审议/工作流编译器，插件化） |
| `28-stage8-web.md` | 前端融合（Next.js 页面合并） |
| `29-stage9-integration.md` | 功能矩阵核对、e2e、双栈回归 |
| `30-stage10-cutover.md` | 入口切换、文档收尾 |
| `31-stage11-sunset.md` | Python 日落与删除计划（冻结/归档/删除） |

## 3. 功能全集矩阵（验收勾选表）

图例：⬜ 未开始 ｜ 🟦 进行中 ｜ ✅ 完成

### 3.1 上游框架参考侧（框架/插件）

| # | 能力 | 来源包 | 阶段 | 状态 |
|---|---|---|---|---|
| D1 | Session 事件溯源日志 + 内存存储 | core/session | 1 | ✅ |
| D2 | System-prompt 组装 + 工具 schema 注册 | core/system-prompt | 1 | ✅ |
| D3 | Scoped tool 注册与执行管线 | core/tools | 1 | ✅ |
| D4 | Agent 接口/注册表/事件词汇 | core/agent | 1 | ✅ |
| D5 | 默认模型选择 | core/agent-default-model | 1 | ✅ |
| D6 | 默认 agent 驱动循环 | core/agent-loop | 1 | ✅ |
| D7 | scope 作用域原语 | core/scope | 1 | ✅ |
| D8 | hooks 事件钩子 | packages/hooks | 2 | ✅ |
| D9 | MCP 客户端/服务器 | packages/mcp | 2 | ✅ |
| D10 | 技能系统（fs/badge/tool-skill） | packages/skill | 2 | ✅ |
| D11 | 子代理 subagent | packages/subagent | 2 | ✅ |
| D12 | 沙箱（landlock-run + e2b 可选） | packages/sandbox | 2 | ✅ |
| D13 | Shell / Terminal / Subprocess | packages/shell 等 | 2 | ✅ |
| D14 | 工作流 workflow | packages/workflow | 2 | ✅ |
| D15 | 计划 plan / 目标 goal / 待办 todo | packages/plan 等 | 2 | ✅ |
| D16 | 调度 schedule / 作业 jobs | packages/schedule 等 | 2 | ✅ |
| D17 | 凭证 credentials / 设置 settings | packages/credentials + settings 包 | 2 | ✅（阶段 1 提前移植，含 credentials-local） |
| D18 | LSP / FS / Workspace | packages/lsp 等 | 2 | ✅ |
| D19 | 上下文压缩 compaction / spill | packages/compaction | 2 | ✅（阶段 1 提前移植） |
| D20 | 反馈 feedback / 护栏 guard | packages/feedback | 2 | ✅（guard 随阶段 2 移植完成） |
| D21 | 身份 identity / 交互 interaction / 审批 approval | packages/* | 2 | ✅ |
| D22 | 插件扩展（tool-cordis/ui-cordis/runner） | packages/extensions | 2 | ✅ |
| D22b | 应用层插件契约（@flowforge/plugin-contract，对齐上游 plugin-contract 参考） | packages/plugin-contract | 2 | ✅（T2.15：manifest/capability/grants/routes/lifecycle/conformance + 20 vitest） |
| D23 | API 网关 + Web 服务 | packages/web | 3 | ✅（api-gateway/api-remotes/host-webserver/host-apiproxy，PR #86） |
| D24 | CLI（web/headless/jsonrpc/acp 模式） | apps/cli | 3 | ✅（profile/plugin/dump-config + headless 端到端 mock 冒烟通过；web profile 依赖阶段 8 web-app bundle） |
| D25 | boot 引导 / bundle 打包 / client / host | packages/boot 等 | 3 | ✅（app-boot/cmdline/base/headless/client-connection，PR #86） |
| D26 | runtime-diagnostics / typert / util / spill | packages/* | 1-2 | ✅ |
| D27 | LLM 抽象 + mock server | packages/llm | 1 | ✅ |
| D28 | 配置体系基座（patch 装配/env-registry/前端 schema 校验） | packages/bundle + core/config | 0-3 | 🟦（patch 装配链随阶段 3 落地：bundle patch/profile 层/--patch 覆盖 + 热更新；env-registry 见 C39、前端校验随阶段 8） |
| D29 | 会话标题 session-title（first-prompt-llm/all-prompts-llm） | packages/session/session-title | 1 | ✅ |
| D30 | 会话遥测 session-telemetry（otel/stats/checkpoint-policy） | packages/session/* | 1 | ✅ |
| D31 | 会话持久化（jsonl zstd/sqlite/projection/cache） | packages/session/* | 1-2 | ✅ |
| D32 | 会话查询族 session-query（sqlite/export/tool） | packages/session-query/* | 2 | ✅ |
| D33 | SDK（client/protocol/server，JSON-RPC） | packages/sdk/* | 2 | ✅ |
| D34 | ACP 会话桥 | packages/acp | 2 | ✅ |
| D35 | 代码运行时 code-runtime（worker-thread） | packages/code-runtime/* | 2 | ✅（阶段 1 提前移植） |
| D36 | 附件 attachment | packages/attachment | 2 | ✅（阶段 1 提前移植） |
| D37 | Web 工具族（web-fetch-http/web-search-deepseek|exa|perplexity/tool-web） | packages/web/* | 2 | ✅ |
| D38 | 目标族 goal（goal-round-driver/tool-goal/command-goal） | packages/goal | 2 | ✅ |
| D39 | 上下文族 context（agent-instructions/packed-chunks/prompt-assembly） | packages/core/context | 1 | ⬜ |
| D40 | host 族（apiproxy/directory-picker/frontend-static/plugin-inventory/webserver） | packages/host/* | 3 | ✅（9 包随阶段 3 移植，PR #86） |
| D41 | e2b（fs-e2b/subprocess-e2b，可选沙箱后端） | packages/e2b/* | 2 | ✅ |
| D42 | test-support 族（agent-loop-testkit/acp-snapshot/client-runtime/llm-replay/loader-smoke） | packages/test-support/* | 1-2 | 🟦（4/5 已移植；client-runtime 依赖阶段 3 client/host 域） |
| D43 | util 族（atomic-write/brand/home-paths/launch-environment/native-command/output-retention/timeout） | packages/harness/util | 0-1 | ✅ |
| D44 | 预设 preset（agent-presets/persona，结构对齐 forgekins 档案） | packages/preset | 2 | ✅ |

### 3.2 上游应用平台参考侧（群聊/灵智/CLI 控制）

| # | 能力 | 来源 | 阶段 | 状态 |
|---|---|---|---|---|
| C1 | 灵智体档案（profile/迁移/审批） | cats/services/profile | 4 | ✅（批次4 cats-profile：ProfileRepository/审批管线） |
| C2 | 灵智体注册表 AgentRegistry | cats/services/agents/registry | 4 | ✅（批次1 cats-shared CatRegistry） |
| C3 | 调用队列/进度跟踪 InvocationQueue | cats/services/agents/invocation | 4 | ✅（批次3 cats-invocation，PR #90） |
| C4 | 编排 orchestration + 事件审计 | cats/services/orchestration | 4 | ✅（批次5 cats-orchestration：EventAuditLog/AutoSummarizer 等） |
| C5 | 会话转录 TranscriptWriter | cats/services/session | 4 | ✅（批次6 cats-session：Writer/Reader/Sealer，PR #94） |
| C6 | 存储层 ports（Thread/Message/Task/Backlog/Memory） | cats/services/stores | 4 | ✅（批次2 ports+Memory；批次6.5 cats-stores-sqlite） |
| C7 | 经验蒸馏 Dossier/Distillation | cats/services/distillation | 4 | ✅（批次5 DossierDistillationService） |
| C8 | Bootcamp 引导 / 值班简报 / 新鲜度 | cats/services/* | 4 | 🟦（duty-briefing/freshness 批次5 已交付；bootcamp 引导待补） |
| C9 | 用量聚合 usage-aggregator | cats/services | 4 | ✅（批次5 UsageAggregatorService） |
| C10 | 群聊线程 Threads（CRUD/成员） | routes/threads | 5 | ✅（批次1 chat-threads，含读状态/分支/导出） |
| C11 | 消息 Messages + 消息行动 | routes/messages | 5 | ✅（批次2 chat-messages，含 disposition 准入） |
| C12 | @mention 路由 + 多 @ 编排 | routes/callback-multi-mention | 5 | ✅（批次5 chat-mention） |
| C13 | 会话链 session-chain / 交接 handoff | routes/session-* | 5 | ✅（批次6 chat-session-chain） |
| C14 | 线程分支 thread-branch | routes/thread-branch | 5 | ✅（批次1 并入 chat-threads ThreadBranchService） |
| C15 | 审批 Hub / 提案 / 投票 | routes/approval-hub 等 | 5 | ✅（批次4 chat-approval） |
| C16 | socket.io 实时投递/进度/信号 | infrastructure/websocket | 5 | ✅（批次3 chat-realtime + RealtimeTransport 缝） |
| C17 | Limb 注册/租约/配对/策略 | domains/limb | 6 | ✅（批次1 limb-core：Registry/Lease/Pairing/AccessPolicy/ActionLog/Presence 全插件化；批次2 补 RedisApprovedLimbPairingPersistence 配对持久化） |
| C18 | RemoteLimbNode / PluginLimbAdapter / REST 执行 | domains/limb | 6 | ✅（批次2 limb-node：RemoteLimbNode/PluginLimbAdapter/PluginRestExecutor/PluginTokenManager + limb-embodiment：BindingStore/yaml-loader 全插件化；批次3 limb-observation：ObservationRouter/OutboundDeliveryHook/TranscriptCatDelivery 观察路由与输出回传全插件化） |
| C19 | tmux 网关/生成器 + agent 会话 | domains/terminal | 6 | ✅（批次4 limb-terminal：TmuxGateway/TmuxAgentSpawner/AgentSessionsReader/SessionStore/AgentPaneRegistry + F212 cli 诊断 + duplex carrier 全插件化，115 测试） |
| C20 | CLI 适配器（claude/codex/gemini/agy/opencode） | services/agents/providers | 6 | ⬜ |
| C21 | 市场 marketplace / 插件 plugin / 技能包 packs | routes/marketplace 等 | 5 | ✅（批次7 chat-misc MarketplaceService） |
| C22 | 信号 signals / 记忆 memory / 任务 tasks | routes/* | 5 | ✅（批次7 chat-misc Signal/MemoryPublish/TaskService） |
| C23 | 梦境回放/自动化反思 auto-dream | domains/auto-dream | 7 | ⬜ |
| C24 | 球权托管租约 ball-custody | domains/ball-custody | 5 | ⬜ |
| C25 | 礼宾 concierge + 指南 guides（registry.yaml + flows/*.yaml） | domains/concierge + domains/guides | 4 | ⬜ |
| C26 | 功能轨迹 feat-trajectory | domains/feat-trajectory | 4 | ⬜ |
| C27 | 健康检查 health | domains/health | 3 | ✅（阶段 3 以 apiproxy RPC 域承载：health/session/settings/credentials 全测试覆盖） |
| C28 | 人性倾向/项目/预览/工作区（human-disposition/projects/preview/workspace） | domains/* | 4-5 | ⬜ |
| C29 | 品味记忆 taste | domains/taste | 4 | ⬜ |
| C30 | 技能包 packs + 插件控制面 plugin（host-inventory 仅视图，发现模型统一上游 cordis，F15） | domains/packs + domains/plugin | 5 | ⬜ |
| C31 | agent 生命周期钩子 agent-hooks | agent-hooks | 4 | ⬜ |
| C32 | harness-eval 16 域评估（a2a/anchor-first/capability-tips/freshness/sop/task-outcome 等） | infrastructure/harness-eval | 7 | ⬜ |
| C33 | infrastructure 域（commands/debug/distillation/document/email/enterprise/github/grounding/scheduler/telemetry） | infrastructure/* | 3-5 | ⬜ |
| C34 | 能力/治理/挂载配置（capabilities/governance/mount） | config/* | 3-4 | ⬜ |
| C35 | 上游参考插件（github/video-analysis/video-gen/wechat-visible-reader/weixin-mp，manifest 迁移装配声明） | plugins/* | 5-6 | ⬜ |
| C36 | 技能安全 skill-security | skill-security | 2 | ✅（packages/plugins/skill-security，13 vitest） |
| C37 | 档案目录模型 cat-template.json（breeds/variants/CLI 适配器；Forgekin 档案保持 YAML） | packages/cats/catalog | 4 | ⬜ |
| C38 | .cat-cafe 运行态 JSON（accounts/user-preferences/proxy-upstreams/provider-profiles） | data/ + ~/.flowforge | 4 | ⬜ |
| C39 | 环境变量注册表 env-registry（CAT_CAFE_* → FF_*） | packages/harness/env-registry | 0 | ⬜ |
| C40 | 连接器配置 cat-config-loader + connector.yaml（IM stretch 时仅 ports） | packages/chat|limb | 5-6 | 🟦（批次8 chat-stretch 已交付 IM ports + mock；cat-config-loader 待阶段 6） |
| C41 | prompt 钩子 hook.yaml | packages/core/system-prompt + packages/forgekin | 1/4 | ⬜ |
| C42 | shared 包（catId/threadId schema、frontmatter-parser、registry 纯函数） | packages/shared | 0 | ✅（批次1 cats-shared，100+ 类型文件） |

### 3.4 Stretch 清单（Phase 11 之后，功能全集之外的扩展目标）

> 2026-08-16 决策：以下条目范围过大、依赖外部服务或非核心路径，**降级为 stretch**，
> 不作为阶段 5-6 必做项；不阻塞主线里程碑。stretch 完成同样走 DoD 与 mgr 提交。

| # | 能力 | 来源 | 建议阶段 | 状态 |
|---|---|---|---|---|
| S1 | IM 通道（飞书/Telegram/钉钉/企微/WebChat） | 上游应用平台 routes/push 等 | 11+ | 🟦（批次8 chat-stretch 已交付 IImChannelAdapter ports + InMemory mock；真实通道按凭据启用） |
| S2 | TTS/语音 / RSS / 邮件 / GitHub signals | 上游应用平台 services | 11+ | ⬜ |
| S3 | 世界 world / 社区 / 故事 / 排行榜 | 上游应用平台 routes/* | 11+ | 🟦（批次8 chat-stretch 已交付 IStory/ICommunity/ILeaderboard ports + InMemory mock） |
| S4 | 桌面端 desktop | 上游应用平台 desktop/ | 11+ | ⬜ |
| S5 | 游戏/信号（games） | 上游应用平台 routes/* | 11+ | ⬜ |
| S6 | Python↔TS 桥接 SDK（`python/sdk`） | 本项目 | 10-11 | ⬜ |
| S7 | 物理 AI 传感器 / 虚拟世界设置（F44） | P: core/world_engine + conditional_router | 11+ | ⬜ |

- S1-S3 对应上游应用平台历史能力编号 C23-C25（IM/世界/TTS 等，`02-source-crosswalk.md` §2 中
  world/community/story 等行）与 S7（F44）同步标注 stretch，与主表 C23-C42 编号互不冲突；
- IM 通道若在阶段 5-6 确有真实凭据需求，按"接口 + mock 先行"原则只留 ports，不实现通道。

### 3.3 FlowForge 特色（品牌层）

| # | 能力 | 来源（Python） | 阶段 | 状态 |
|---|---|---|---|---|
| F1 | SoulImprint 灵魂印记 | forgemind/soul_imprint.py | 7 | ⬜ |
| F2 | CapabilityProfile 能力画像 | core/capability | 7 | ⬜ |
| F3 | EchoStore 情景记忆 | core/memory | 7 | ⬜ |
| F4 | MindCodex 程序记忆 + SpiritForge 蒸馏 | core/knowledge_evolution.py | 7 | ⬜ |
| F5 | MindCouncil 跨厂商审议 | forgemind/council.py | 7 | ⬜ |
| F6 | 五自进化闭环（docs/code/framework/review/test） | evolution/self_dev_*.py | 7 | ⬜ |
| F7 | 觉醒阶/进化阶 E1-E6 + 成熟度 | evolution/maturity.py | 7 | ⬜ |
| F8 | 工作流编译器 YAML→执行图 | core/workflow_compiler*.py | 7 | ⬜ |
| F9 | 外部 agent 适配器 EAC 七契约 | forgemind/external_agents.py | 7 | ⬜ |
| F10 | 7 层 harness 工程（durable_state 等） | core/harness | 7 | ⬜ |
| F11 | 插件市场 + 前端插件 | core/marketplace.py + plugin_* | 7 | ⬜ |
| F12 | 团队协作 teamact + 审批 | core/teamact + approval_hub | 7 | ⬜ |
| F13 | 观测/追踪/指标 | core/observability + tracing | 7 | ⬜ |
| F14 | Web 页面（council/mission/memory/review/signals/admin） | web/src/app | 8 | ⬜ |
| F15 | 魔法词 magic_words | forgemind/magic_words.py（F011/F012；A011） | 7 | ⬜ |
| F16 | 群聊编排 swarm | forgemind/swarm.py + config/agent_swarm.yaml（F049） | 7 | ⬜ |
| F17 | IM 议会 im_council + 通道管理 | core/im_council.py + channel_manager.py + config/im_council|im_channels|a2a_channels.yaml（F047） | 7 | ⬜ |
| F18 | TeamAct 转向与审批 | core/teamact/ + config/teamact_steer.yaml（F048；对照 F002） | 7 | ⬜ |
| F19 | 评估台账 eval_ledger | evolution/eval_ledger.py（F050；对照 F018 评估契约） | 7 | ⬜ |
| F20 | 自主进化 autonomous + 梦境回放 auto_dream | forgemind/autonomous.py + evolution/auto_dream.py（F051） | 7 | ⬜ |
| F21 | Side-Effect WAL（记忆写前日志） | core/event_memory.py 相关（F021） | 7 | ⬜ |
| F22 | 进化引擎三循环（engine/foreman/runtime/qc_loop/close_gate/process_evolution/scope_guard/metacognition/models） | evolution/*.py（F046） | 7 | ⬜ |
| F23 | 弹性栈（熔断/降级/恢复层级/检查点/重启恢复） | core/{circuit_breaker,fallback_chain,degradation,recovery_tier,restart_recovery,checkpoint_*}.py + config/resilience.yaml|recovery_tiers.yaml（F022；A004/A022） | 2/7 | ✅（packages/plugins/resilience，23 vitest；阶段 7 应用层接线待做） |
| F24 | 特性开关 + 金丝雀 | core/feature_flags.py + core/canary.py + config/canary/default.yaml | 2 | ✅（packages/plugins/feature-flags 8 + canary 10 vitest） |
| F25 | 模式执行器（modes/执行策略/步长限制/超时） | core/base_mode_executor.py + modes/ + execution_policy.py + step_limiter.py + agent_timeout.py | 1/2 | ✅（packages/plugins/modes，14 vitest） |
| F26 | 内容审核与护栏（moderation/gate/guardrails） | core/{content_moderation,moderation,guardrails}.py + core/gate/（对照 F007 push-back） | 2 | ✅（packages/plugins/guard，16 vitest） |
| F27 | 状态机族（handoff/状态映射/变量解析/命名空间/上下文层/工具链执行/字段门控） | core/{handoff,state_mapper,state_updates,state_query_tool,variable_resolver,namespace,context_layer_manager,tool_chain_executor,field_condition_gate}.py（F003/F024；A003/A024） | 1/7 | ⬜ |
| F28 | LLM 路由/模型服务/提供商配额 | core/{model_service,model_capability,provider_quota}.py + config/llm_route.yaml|provider_quota.yaml*（F025） | 1/3 | ⬜ |
| F29 | SOP 标准作业程序 | sop/ + config/sops/*.yaml | 7 | ⬜ |
| F30 | 物种体系（base/forgekin/registry/species + species_impl + forgekins/*.yaml 8 物种） | forgemind/*.py + forgemind/forgekins/*.yaml（F027；A027） | 4/7 | ⬜ |
| F31 | 锻造流水线 forging | forging/ + forgemind/config/forging.yaml（F028；A028） | 7 | ⬜ |
| F32 | Trae 桥接 | config/trae_bridge.yaml + .trae_bridge/（F045） | 7 | ⬜ |
| F33 | 外部 agent 共享状态 | core/external_agent/（F033） | 6 | ⬜ |
| F34 | 外部 agent 降级回退 | core/external_agent/ + fallback_chain（F034） | 6 | ⬜ |
| F35 | 外部 agent 能力融合 | core/external_agent/（F035） | 6 | ⬜ |
| F36 | harness-eval 控制面 | harness/ + evaluators/（F040） | 7 | ⬜ |
| F37 | ForgeMind 锻造关系/谱系/应用层 | forgemind/（F026/F036/F038） | 7 | ⬜ |
| F38 | MindCodex 检索（三入口/消费加权排名/可检索） | core/knowledge_evolution.py + memory_federation/（F015/F016/F039） | 7 | ⬜ |
| F39 | 记忆治理 | core/memory_federation/ + core/event_memory.py（F014/F017） | 7 | ⬜ |
| F40 | 球权托管 + push-back 协议 | docs/features/F005/F006（F006） | 5/7 | ⬜ |
| F41 | 评估契约/三信号交叉/归因矩阵 | core/eval/ + evolution/eval_ledger.py（F018/F019/F020） | 7 | ⬜ |
| F42 | 活性探针与规范读（liveness canonical read） | core/（F023） | 3/7 | ⬜ |
| F43 | 特种角色子代理（产品经理/DevOps/安全官/交付经理） | forgemind/forms.py 相关（F041-F044） | 7 | ⬜ |
| F44 | 物理 AI 传感器 + 虚拟世界设置 | core/world_engine/ + conditional_router.py（F029/F030） | stretch | ⬜ |

## 4. 每阶段通用验收门（DoD）

1. 阶段任务清单（`2X-*.md`）内所有条目完成。
2. 新增/修改代码通过 `pnpm typecheck` 与 `pnpm lint`。
3. 对应域 vitest 测试全绿（`pnpm test`）。
4. **插件化验收**：阶段 1-8 产出均以 cordis 插件形式提供，可独立 `ctx.plugin()`
   加载/卸载，生命周期与依赖注入正确（契约见 `01-stack-decision.md` R13）。
5. Python 旧版 `pytest` 回归全绿（双栈共存/行为基线验证）。
6. 按 `docs/git-workflow.md` 用 `./mgr` 提交并创建 PR（Gitee）。
