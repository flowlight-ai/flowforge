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
| C17 | Limb 注册/租约/配对/策略 | domains/limb | 6 | ✅（批次1 limb-core：Registry/Lease/Pairing/AccessPolicy/ActionLog/Presence 全插件化；批次2 补 RedisApprovedLimbPairingPersistence 配对持久化；批次6 limb-e2e mock CLI 端到端 7 用例：配对→租约→执行→转录→回传 + 租约冲突拒绝） |
| C18 | RemoteLimbNode / PluginLimbAdapter / REST 执行 | domains/limb | 6 | ✅（批次2 limb-node：RemoteLimbNode/PluginLimbAdapter/PluginRestExecutor/PluginTokenManager + limb-embodiment：BindingStore/yaml-loader 全插件化；批次3 limb-observation：ObservationRouter/OutboundDeliveryHook/TranscriptCatDelivery 观察路由与输出回传全插件化；批次6 limb-e2e mock CLI 端到端：五模式解析（claude/codex/gemini/opencode/agy）+ 转录→群聊幂等落库/触发绑定猫 + Windows pty 路径冒烟） |
| C19 | tmux 网关/生成器 + agent 会话 | domains/terminal | 6 | ✅（批次4 limb-terminal：TmuxGateway/TmuxAgentSpawner/AgentSessionsReader/SessionStore/AgentPaneRegistry + F212 cli 诊断 + duplex carrier 全插件化，115 测试） |
| C20 | CLI 适配器（claude/codex/gemini/agy/opencode） | services/agents/providers | 6 | ✅（批次5 limb-adapters：五 CLI 适配器全插件化（EAC 七契约）+ 统一 CliEvent 契约 + Registry 默认装配 + LimbAdaptersService 挂载 `ctx.limbAdapters`，112 测试） |
| C21 | 市场 marketplace / 插件 plugin / 技能包 packs | routes/marketplace 等 | 5 | ✅（批次7 chat-misc MarketplaceService） |
| C22 | 信号 signals / 记忆 memory / 任务 tasks | routes/* | 5 | ✅（批次7 chat-misc Signal/MemoryPublish/TaskService） |
| C23 | 梦境回放/自动化反思 auto-dream | domains/auto-dream | 7 | ✅（批次10 forgekin-auto-dream：双层架构 + 五级成熟度 + 贪心聚类 + L2 草稿 + TopK 浮现 + 4 信号 telemetry，见 F20） |
| C24 | 球权托管租约 ball-custody | domains/ball-custody | 5 | ✅（批次23 cats-ball-custody：8 态 × 17 事件表驱动转移 + 事件溯源 Projector（apply/rebuild/rebuildAll）+ 内存 log/store，见 F40） |
| C25 | 礼宾 concierge + 指南 guides（registry.yaml + flows/*.yaml） | domains/concierge + domains/guides | 4 | ✅（批次24 cats-guides：concierge 全服务群（config/thread/relay/confirmation/triage/investigation/search-context/reply-validator/target-cats/verified-tool-target/worker）+ guides 插件入口（registry-loader/5 态状态机/session-store/lifecycle/action/routing-interceptor/prompt-section/thread-store），KV 接口注入替代 Redis、RosterResolver 替代 catRegistry，85 测试，见 F155/F229） |
| C26 | 功能轨迹 feat-trajectory | domains/feat-trajectory | 4 | ✅（批次25 cats-feat-trajectory：三源投影（event-stream/git-ref/thread-split+merge）+ git-ref-collector（git/gh IO 接口化注入 + multi-candidate skip-low-confidence）+ cross-post/thread-split collector + scheduler（git 失败降级 + freshness 诚实记录）+ backfill 回填，ctx.catsFeatTrajectory，64 测试，见 F233） |
| C27 | 健康检查 health | domains/health | 3 | ✅（阶段 3 以 apiproxy RPC 域承载：health/session/settings/credentials 全测试覆盖） |
| C28 | 人性倾向/项目/预览/工作区（human-disposition/projects/preview/workspace） | domains/* | 4-5 | ✅（批次25 四包：cats-projects（F076/F070 triage 五桶 + risk 8 信号 + Intent Card 四阶段 + external-project KV 注入，33 测试）+ cats-human-disposition（F281 ledger 双索引 + CAS append + 三适配器 + 严格游标分页，21 测试）+ cats-workspace（F063 traversal/symlink 三重防护 + HMAC 编辑会话 + 有界预览，21 测试）+ cats-preview（F120 loopback-only 代理 + 端口白名单 + F156 Origin 校验，31 测试） |
| C29 | 品味记忆 taste | domains/taste | 4 | ✅（批次25 cats-taste：F221 品味信号检测（ADVISORY，KD-8 不阻止）+ canonical worktree 定位 + vignette 写入（public git commit main-only / sensitive 直写）+ locked+checkpointed 审批管线（ApprovalLock 端口，结构化兼容 cats-invocation SessionMutex），ctx.catsTaste，37 测试） |
| C30 | 技能包 packs + 插件控制面 plugin（host-inventory 仅视图，发现模型统一上游 cordis，F15） | domains/packs + domains/plugin | 5 | ⬜ |
| C31 | agent 生命周期钩子 agent-hooks | agent-hooks | 4 | ⬜ |
| C32 | harness-eval 16 域评估（a2a/anchor-first/capability-tips/freshness/sop/task-outcome 等） | infrastructure/harness-eval | 7 | ✅（批次16 forgekin-harness-eval：EvalDomainRegistry 16 域注册表，见 F36） |
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
| F1 | SoulImprint 灵魂印记 | forgemind/soul_imprint.py | 7 | ✅（批次1 forgekin-soul：哈希稳定/不可变/命名空间隔离 + `ctx.forgeSoul`，8 测试） |
| F2 | CapabilityProfile 能力画像 | core/capability | 7 | ✅（批次1 forgekin-capability：models/analyzer/profile + `ctx.forgeCapability`，38 测试） |
| F3 | EchoStore 情景记忆 | core/memory | 7 | ✅（批次1 forgekin-memory：五存储 save/retrieve/hybrid + EpisodePersistenceHook + `ctx.forgeMemory`，9 测试） |
| F4 | MindCodex 程序记忆 + SpiritForge 蒸馏 | core/knowledge_evolution.py | 7 | ✅（批次1 forgekin-knowledge：三问→Episode→蒸馏→双门→入库 + `ctx.forgeKnowledge`，26 测试） |
| F5 | MindCouncil 跨厂商审议 | forgemind/council.py | 7 | ✅（批次2 forgekin-council：CouncilVerdict/CouncilSession 聚合 + min_reviewers/min_distinct_vendors/pass_threshold 强制 + 单厂商结构性拒绝 + `ctx.forgeCouncil`，18 测试） |
| F6 | 五自进化闭环（docs/code/framework/review/test） | evolution/self_dev_*.py | 7 | ✅（批次2 forgekin-loops：SelfDevLoopBase 五步循环 + I1-I8 不变量 + `ctx.forgeLoops`，76 测试） |
| F7 | 觉醒阶/进化阶 E1-E6 + 成熟度 | evolution/maturity.py | 7 | ✅（批次2 forgekin-stage：双轴阶模型 + KnowledgeMaturityLadder 五级晋升/降级/冻结 + `ctx.forgeStage`，42 测试） |
| F8 | 工作流编译器 YAML→执行图 | core/workflow_compiler*.py | 7 | ✅（批次3 forgekin-workflow-compiler：三阶段 Parser/Validator/CodeGen + 条件路由/复合步骤 + `ctx.forgeWorkflowCompiler`，43 测试） |
| F9 | 外部 agent 适配器 EAC 七契约 | forgemind/external_agents.py | 7 | ✅（批次3 forgekin-external-agents：五种内置 kind 子进程适配器 + Helm LLM 事件桥 + `ctx.forgeExternalAgents`，29 测试） |
| F10 | 7 层 harness 工程（durable_state 等） | harness/（F008-F010/FR-HRN-04） | 7 | ✅（批次17 forgekin-harness：L1 durable-state（sqlite/git 双后端 + 乐观锁版本）+ L2 tool-mediation（白名单/别名/审计 + 4 拒绝类别）+ L3 evidence-sensors（四类证据 + SHA-256 自验证）+ L4 governance（注入点/优先级 + 5 规则 GOV-001~005）+ L6 entropy-manager（DocGardener/DebtTracker/RuleEvolution/GarbageCollection）+ L7 harnessability（六维加权 + 到期检查），`ctx.forgeHarness`，74 测试） |
| F11 | 插件市场 + 前端插件 | core/marketplace.py + plugin_* | 7 | ✅（批次18 forgekin-plugins：PluginManifest + 本地/远程注册表 + 七步安装/卸载/更新/四检查验证 + 六挂载点前端注册表 `ctx.forgePlugins`，39 测试） |
| F12 | 团队协作 teamact + 审批 | core/teamact + approval_hub | 7 | ✅（批次15a cats-teamact：六步循环状态机 + 五项终止条件 + 交接胶囊 + 乒乓熔断 + SteerQueue 7 动作 `ctx.catsTeamAct`，69 测试；审批复用 chat approval） |
| F13 | 观测/追踪/指标 | core/observability + tracing | 7 | ✅（批次13 forgekin-observability：AsyncLocalStorage trace_id 全链路传播 + TraceManager span 链 + 三类指标采集器 + AuditLogger JSONL + EventBus 发布订阅/请求响应 + 跨项目桥，48 测试） |
| F14 | Web 页面（council/mission/memory/review/signals/admin） | web/src/app | 8 | ⬜ |
| F15 | 魔法词 magic_words | forgemind/magic_words.py（F011/F012；A011） | 7 | ✅（批次4 forgekin-magic-words：4 条魔法短语 → stop-and-audit 触发检测 + `ctx.forgeMagicWords`，12 测试） |
| F16 | 群聊编排 swarm | forgemind/swarm.py + config/agent_swarm.yaml（F049） | 7 | ✅（批次5 forgekin-swarm：SwarmCoordinator 能力路由/心跳回收/跨厂商过滤 + `ctx.forgeSwarm`，68 测试） |
| F17 | IM 议会 im_council + 通道管理 | core/im_council.py + channel_manager.py + config/im_council|im_channels|a2a_channels.yaml（F047） | 7 | ✅（批次14 forgekin-im-council：五步议事 + I1 降级链路 + I2 append-only 归档 + I3 唯一入口 + I4 超时拒绝 + I5 落盘，Console/WebChat/TraeBridge 三通道 `ctx.forgeImCouncil` + chat-channels ChannelManager，45 测试） |
| F18 | TeamAct 转向与审批 | core/teamact/ + config/teamact_steer.yaml（F048；对照 F002） | 7 | ✅（批次15a cats-teamact：六步循环状态机 + 五项终止条件 + 交接胶囊 + 乒乓熔断 + SteerQueue 7 动作（I1-I5 不变量）`ctx.catsTeamAct`，69 测试；审批基础复用 chat approval） |
| F19 | 评估台账 eval_ledger | evolution/eval_ledger.py（F050；对照 F018 评估契约） | 7 | ✅（批次8 forgekin-eval-ledger：ReplayABRunner 七步（净增益/双门/3 类覆盖）+ Store 五指标 + RuleBasedJudge，59 测试） |
| F20 | 自主进化 autonomous + 梦境回放 auto_dream | forgemind/autonomous.py + evolution/auto_dream.py（F051） | 7 | ✅（批次10：forgekin-autonomous F052 24h 守护进程（三类扫描+消费循环+心跳保活+无效产出检测+真实落盘）`ctx.forgeAutonomous` + forgekin-auto-dream CL-031 梦境整合双层架构（聚类+蒸馏 L2 草稿+浮现+4 信号 telemetry）`ctx.forgeAutoDream`，81 测试） |
| F21 | Side-Effect WAL（记忆写前日志） | core/event_memory.py 相关（F021） | 7 | ✅（批次12 forgekin-stores：WriteAheadLog append/get/mark_committed/mark_rolled_back/list_uncommitted + 深拷贝 + 单向状态机 + count 审计，`ctx.forgeStores`，35 测试） |
| F22 | 进化引擎三循环（engine/foreman/runtime/qc_loop/close_gate/process_evolution/scope_guard/metacognition/models） | evolution/*.py（F046） | 7 | ✅（批次11 evolution-engine：ForgeMindEngine 三模式治理 + CL-033 ApprovalHub + SelfDevRuntime 三审批模式 + ContinuousForeman + CL-034 QC Loop + CL-025 Close Gate，`ctx.forgeEvolution`，114 测试） |
| F23 | 弹性栈（熔断/降级/恢复层级/检查点/重启恢复） | core/{circuit_breaker,fallback_chain,degradation,recovery_tier,restart_recovery,checkpoint_*}.py + config/resilience.yaml|recovery_tiers.yaml（F022；A004/A022） | 2/7 | ✅（packages/plugins/resilience；批次9 补齐 ResilienceExecutor+CheckpointConfig+Cordis 插件 `ctx.forgeResilience`，58 vitest） |
| F24 | 特性开关 + 金丝雀 | core/feature_flags.py + core/canary.py + config/canary/default.yaml | 2 | ✅（packages/plugins/feature-flags 8 + canary 10 vitest） |
| F25 | 模式执行器（modes/执行策略/步长限制/超时） | core/base_mode_executor.py + modes/ + execution_policy.py + step_limiter.py + agent_timeout.py | 1/2 | ✅（packages/plugins/modes，14 vitest） |
| F26 | 内容审核与护栏（moderation/gate/guardrails） | core/{content_moderation,moderation,guardrails}.py + core/gate/（对照 F007 push-back） | 2 | ✅（packages/plugins/guard，16 vitest） |
| F27 | 状态机族（handoff/状态映射/变量解析/命名空间/上下文层/工具链执行/字段门控） | core/{handoff,state_mapper,state_updates,state_query_tool,variable_resolver,namespace,context_layer_manager,tool_chain_executor,field_condition_gate}.py（F003/F024；A003/A024） | 1/7 | ✅（批次19 packages/core/state：NamespaceRegistry + HandoffManager + StateUpdateMapper + StateMapper/ParamMapping + VariableResolver + FieldConditionGate + ContextLayerManager + StateQueryTool + ToolChainExecutor ReAct 循环，`ctx.forgeState`，61 测试） |
| F28 | LLM 路由/模型服务/提供商配额 | core/{model_service,model_capability,provider_quota}.py + config/llm_route.yaml|provider_quota.yaml*（F025） | 1/3 | ✅（批次20 packages/llm/route：RouteResolver + LLMRouter 健康感知级联 + ModelService 健康检查/错误分类/failover + HealthChecker 周期巡检 + ModelCapabilityProvider 能力路由 + ProviderQuotaManager 六维配额 + ModelCapability 零配置 API，`ctx.forgeLlmRoute`，121 测试） |
| F29 | SOP 标准作业程序 | sop/ + config/sops/*.yaml | 7 | ✅（批次4 forgekin-sop：阶段门禁引擎（PredicateChecker 8 检查器 + SOPExecutor 门禁/流转 + YAML 加载）+ `ctx.forgeSop`，71 测试） |
| F30 | 物种体系（base/forgekin/registry/species + species_impl + forgekins/*.yaml 8 物种） | forgemind/*.py + forgemind/forgekins/*.yaml（F027；A027） | 4/7 | ✅（批次7 forgekin-species：五物种数据模型 + ForgekinBase chat 降级/重试分类 + Registry selectOwner + SpeciesFactoryRegistry 构造器注册表 + 五形态边界校验 + `ctx.forgeSpecies` 活实例表，69 测试） |
| F31 | 锻造流水线 forging | forging/ + forgemind/config/forging.yaml（F028；A028） | 7 | ✅（批次7 forgekin-forging：六阶段 ForgePipeline（失败包装/计时）+ 默认锚点印记 + forgeFromYaml + 内置双 YAML，`ctx.forgeForging`，30 测试） |
| F32 | Trae 桥接 | config/trae_bridge.yaml + .trae_bridge/（F045） | 7 | ✅（批次6 forgekin-trae-bridge：TraeBridgeProtocol 文件协议（F045 I1-I8）+ TraeLLMClient 门面 + BridgeLLMOperator OpenRoute 轮询 + 会话持久化 + YAML 配置）+ `ctx.forgeTraeBridge`，113 测试） |
| F33 | 外部 agent 共享状态 | core/external_agent/（F033） | 6 | ✅（批次21 packages/external/agent：ExternalAgentSharedState 共享状态（store DI 注入 + listHistory 内存索引 + read/write/clear/listKeys），`ctx.forgeExternalAgent`，113 测试） |
| F34 | 外部 agent 降级回退 | core/external_agent/ + fallback_chain（F034） | 6 | ✅（批次21 packages/external/agent：ExternalAgentFallback withFallback 双层循环（provider × retry，success===true 判定，失败退避）+ getDefaultChain 默认链只保留已注册 Provider） |
| F35 | 外部 agent 能力融合 | core/external_agent/（F035） | 6 | ✅（批次21 packages/external/agent：ExternalAgentCapabilityFusion fuse（min_invocations=3 / min_success_rate=0.7 门槛 + weight=min(base×count, max) + 能力/盲点不去重合并 + 融合历史）） |
| F36 | harness-eval 控制面 | harness/ + evaluators/（F040） | 7 | ✅（批次16 forgekin-harness-eval：LifecycleJudge 五态判定 + ActionRecommender 行动路由 + DailySummarizer 每日汇总 + ScoringRule/MultiDimension 评估器 + FeedbackLoop 外环质量门控（4 维评分 + 三模式 + 启发式回退）+ EvaluatorRegistry + EvalDomainRegistry 16 域，`ctx.forgeHarnessEval`，86 测试） |
| F37 | ForgeMind 锻造关系/谱系/应用层 | forgemind/（F026/F036/F038） | 7 | ✅（批次22 forgekin-relationship：层动态注册 + 进化/回炉协议（Eval≥0.85 + 5任务 + operator 审批 + 仅蒸馏通用能力）+ `ctx.forgeRelationship`，28 测试；forgekin-lineage：LineageNode/Edge/Store 双向遍历 + 分裂/融合执行器（加权合并）+ `ctx.forgeLineage`，26 测试；forgekin-app：F026 四钩子注册表（4 模板/4 技能/2 通道/1 自我进化配置）+ forgeFromTemplate 便捷锻造 + `ctx.forgeMind`，12 测试） |
| F38 | MindCodex 检索（三入口/消费加权排名/可检索） | core/knowledge_evolution.py + memory_federation/（F015/F016/F039） | 7 | ✅（批次1 forgekin-knowledge：search/listByDomain/listByTag 三入口 + recordConsumption 消费加权，见 F4） |
| F39 | 记忆治理 | core/memory_federation/ + core/event_memory.py（F014/F017） | 7 | ✅（批次12 forgekin-stores：MemoryCollection/CollectionManager（backend 协议注入）+ MemoryGovernance 三要素（权威等级/消费加权/衰减策略，幂等），`ctx.forgeStores`） |
| F40 | 球权托管 + push-back 协议 | docs/features/F005/F006（F006） | 5/7 | ✅（批次23 cats-ball-custody：F005 BallCustodyRegistry（TTL 300s + now_fn 注入 + 双持球防护 + 懒清理 + lease-{10hex}） + F006 PushBackProtocol（三要素强制 + 显式 resolve + pb-{10hex}）+ C24 球状态机合包，61 测试全绿，`ctx.catsBallCustody`） |
| F41 | 评估契约/三信号交叉/归因矩阵 | core/eval/ + evolution/eval_ledger.py（F018/F019/F020） | 7 | ✅（批次8 forgekin-eval-ledger：EvalContract 五问 + ContractRegistry + ThreeSignalCrossValidator + Attributor 七类归因，`ctx.forgeEvalLedger`） |
| F42 | 活性探针与规范读（liveness canonical read） | core/（F023） | 3/7 | ⬜ |
| F43 | 特种角色子代理（产品经理/DevOps/安全官/交付经理） | forgemind/forms.py 相关（F041-F044） | 7 | ✅（批次15b forgekin-roles：ForgekinRole 基类 + 四角色各 5 动作 + 审批降级不变量，`ctx.forgeRoles`，56 测试） |
| F44 | 物理 AI 传感器 + 虚拟世界设置 | core/world_engine/ + conditional_router.py（F029/F030） | stretch | ⬜ |

## 4. 每阶段通用验收门（DoD）

1. 阶段任务清单（`2X-*.md`）内所有条目完成。
2. 新增/修改代码通过 `pnpm typecheck` 与 `pnpm lint`。
3. 对应域 vitest 测试全绿（`pnpm test`）。
4. **插件化验收**：阶段 1-8 产出均以 cordis 插件形式提供，可独立 `ctx.plugin()`
   加载/卸载，生命周期与依赖注入正确（契约见 `01-stack-decision.md` R13）。
5. Python 旧版 `pytest` 回归全绿（双栈共存/行为基线验证）。
6. 按 `docs/git-workflow.md` 用 `./mgr` 提交并创建 PR（Gitee）。
