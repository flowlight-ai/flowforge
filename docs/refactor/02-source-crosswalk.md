# FlowForge 0.2.0 — 源码对照地图（Source Crosswalk）

> 状态：进行中 ｜ 创建：2026-08-16 ｜ 更新：2026-08-16（补全三源能力：dsh session-query/sdk/code-runtime/acp/web工具族/test-support/util 等；clowder auto-dream/guides/harness-eval 等；flowforge 魔法词/群/IM议会/进化引擎/弹性栈等）
> 关联：`03-fusion-strategy.md`（融合分层与概念映射）
> 用途：移植时的 file→file 翻译字典与行为基线锚点；每完成一行即勾选，禁止"凭印象重写"。

## 图例

- `P:` flowforge Python 旧版（`D:\software\fl\flowlight\flowforge`）
- `D:` deepseek-harness（`D:\software\fl\ex\deepseek-harness`）
- `C:` clowder-ai（`D:\software\fl\ex\clowder-ai`）
- `T:` flowforge TS 落点（本仓库 `vendor/`、`packages/`、`apps/`）
- ✅ 已 vendor/已完成 ｜ 🟦 进行中 ｜ ⬜ 未开始

## 1. 内核与框架层（D → T）

| 来源（D） | 落点（T） | 处理 | 状态 |
|---|---|---|---|
| `vendor/cordis` + `vendor/cosmokit` + `vendor/schemastery` + `vendor/loader` + `vendor/include` + `vendor/group` + `vendor/timer` + `vendor/hmr` + `vendor/logger-console` | `vendor/*`（同名） | 整包复制，保留 LICENSE；锁定快照不追踪上游（R16） | ✅ |
| `packages/core/scope` | `packages/core/scope` | vendor 后去 dsh brand 逻辑 | ⬜ |
| `packages/core/session`（SessionStore, `ctx.sessions`） | `packages/core/session` | vendor + 双栈数据隔离 | ⬜ |
| `packages/core/system-prompt`（`ctx.systemPrompt`） | `packages/core/system-prompt` | vendor；吸收 P: `core/persona_injector.py`/`persona_lock.py` 的 persona 组装 | ⬜ |
| `packages/core/tools`（ToolRuntime, `ctx.tools`） | `packages/core/tools` | vendor；对照 P: `core/tool_decorator.py`/`declarative_tool.py` 行为基线 | ⬜ |
| `packages/core/agent`（AgentRegistry, `ctx.agents`） | `packages/core/agent` | vendor | ⬜ |
| `packages/core/agent-default-model` | `packages/core/agent-default-model` | vendor | ⬜ |
| `packages/core/agent-loop`（AgentLoop, `ctx.agentLoop`） | `packages/core/agent-loop` | vendor；对照 P: `core/base_agent.py`/`declarative_agent.py` | ⬜ |
| `packages/llm/llm` + `llm-deepseek` + `llm-pi-ai` + `llm-retry` + `token-meter` | `packages/llm/*` | vendor；追加 openroute provider（P: `forgemind/openroute_adapter.py`） | ⬜ |
| `packages/test-support/llm-mock-server`（`startMockLlmServer`, `MockLlmBehavior`） | `packages/test-support/llm-mock-server` | vendor —— **阶段 1 测试基线已确认存在** | ⬜ |
| `packages/harness/hooks|context|spill|util|typert|storage` | `packages/harness/*` | vendor（阶段 1） | ⬜ |
| `packages/plugins/*`（mcp/skill/subagent/sandbox/shell/terminal/subprocess/workflow/plan/goal/schedule/jobs/credentials/lsp/fs/workspace/compaction/feedback/guard/todo/identity/interaction/approval） | `packages/plugins/*` | vendor 分批（阶段 2） | ⬜ |
| `packages/extensions/*`（tool-cordis/ui-cordis/cordis-client-runner/cordis-host-runner） | `packages/extensions/*` | vendor（阶段 2）；host-runner 与 `packages/harness/boot` 衔接 | ⬜ |
| `packages/boot/*`（app-boot/cmdline）+ `packages/web` + `packages/bundle` + `packages/settings` + `packages/client|host` | `packages/boot|web|bundle|settings|client|host` | vendor（阶段 3） | ⬜ |
| `packages/settings/settings` + `settings-file`（invariant/redact/types 设置抽象） | `packages/settings` | vendor（阶段 0/1，R16/R17） | ⬜ |
| `packages/bundle/{base,headless,web-app}/cordis.patch.yml`（patch 分层装配模板） | `packages/bundle/*` | 移植为 flowforge 装配层模板（R17：bundle→mode→profile→overlay） | ⬜ |
| `apps/cli/config/agent-presets/*`（`preset.yml` + `agent.cordis.yml` + `skills/*/SKILL.md`） | `apps/cli/config/agent-presets` | 移植；preset 结构对齐 flowforge forgekins 档案 | ⬜ |
| `apps/cli` | `apps/cli` | vendor 改造为 `flowforge` 命令 + 插件宿主 | ⬜ |
| `packages/api/*`（api-gateway/remotes/runtime-diagnostics 等） | `packages/api/*` | vendor（阶段 3） | ⬜ |
| `packages/session/session-title`（+ first-prompt-llm/all-prompts-llm） | `packages/core/session-title` | vendor（阶段 1） | ⬜ |
| `packages/session/session-telemetry` + `session-telemetry-otel` + `session-stats` + `session-checkpoint-policy` | `packages/core/session-telemetry` 等 | vendor（阶段 1） | ⬜ |
| `packages/session/session-persistence-jsonl`（zstd 压缩/分块）+ `session-persistence-sqlite` + `session-projection` + `session-projection-cache` | `packages/session/*` | vendor（阶段 1/2） | ⬜ |
| `packages/session-query/*`（session-query/session-query-sqlite/session-log-export/tool-session-query） | `packages/session-query/*` | vendor（阶段 2）；对照 P: `session/` 查询能力 | ⬜ |
| `packages/sdk/*`（client/protocol/server，JSON-RPC 协议） | `packages/sdk/*` | vendor（阶段 2）；python/sdk 桥接基础（S6） | ⬜ |
| `packages/acp/acp`（ACP 会话桥） | `packages/acp` | vendor（阶段 2）；外部 CLI 控制基础 | ⬜ |
| `packages/code-runtime/*`（code-runtime 本体 + worker-thread） | `packages/code-runtime/*` | vendor（阶段 2）；PTC Code Mode 基础 | ⬜ |
| `packages/attachment/attachment` | `packages/attachment` | vendor（阶段 2） | ⬜ |
| `packages/web/*`（web/web-fetch-http/web-search-deepseek|exa|perplexity/tool-web） | `packages/plugins/web*` | vendor（阶段 2）；对照 P: 检索/发布工具 | ⬜ |
| `packages/goal/*`（goal/goal-round-driver/tool-goal/command-goal） | `packages/plugins/goal` | vendor（阶段 2） | ⬜ |
| `packages/context/*`（agent-instructions/packed-chunks/prompt-assembly/system-prompt） | `packages/core/context` | vendor（阶段 1）；对照 P: `persona_injector.py`/`prompt_manager.py` | ⬜ |
| `packages/host/*`（apiproxy/directory-picker*/frontend-static/plugin-inventory/webserver） | `packages/host/*` | vendor（阶段 3） | ⬜ |
| `packages/e2b/*`（fs-e2b/subprocess-e2b） | `packages/e2b/*` | vendor（阶段 2，可选沙箱后端） | ⬜ |
| `packages/test-support/*`（agent-loop-testkit/acp-snapshot/client-runtime/llm-replay/loader-smoke） | `packages/test-support/*` | vendor（阶段 1/2） | ⬜ |
| `packages/util/*`（atomic-write/brand/home-paths/launch-environment/native-command/output-retention/timeout） | `packages/harness/util` | vendor（阶段 0/1） | ⬜ |
| `packages/preset/*`（agent-presets/persona） | `packages/preset/*` | vendor（阶段 2）；preset 结构对齐 flowforge forgekins 档案 | ⬜ |

## 2. 应用层（C → T，clowder `packages/api/src/`）

| 来源（C） | 落点（T） | 处理 | 状态 |
|---|---|---|---|
| `src/services/agents/registry`（AgentRegistry） | `packages/cats/registry` | vendor；概念映射 cat→Forgekin | ⬜ |
| `domains/auto-dream`（梦境回放/自动化反思） | `packages/forgekin/auto-dream` | vendor；对照 P: `evolution/auto_dream.py`（F20） | 🔶（批次10：梦境整合核心已落 `packages/forgekin/auto-dream`，CL-031 双层架构 `ctx.forgeAutoDream`） |
| `domains/ball-custody`（球权托管租约） | `packages/cats/ball-custody` | vendor；对照 P: `docs/features/F006-ball-custody-lease.md`（F40） | ✅（批次23：C24 状态机 + 事件溯源 Projector 已落 cats-ball-custody，`ctx.catsBallCustody`） |
| `domains/concierge` + `domains/guides`（礼宾/指南注册 `guides/registry.yaml` + `guides/flows/*.yaml`） | `packages/cats/guides` | vendor（阶段 4） | ✅（批次24：C25 concierge 全服务群 + guides 插件入口已落 cats-guides，`ctx.catsGuides`，85 测试） |
| `domains/feat-trajectory`（功能轨迹） | `packages/cats/feat-trajectory` | vendor（阶段 4） | ✅（批次25 cats-feat-trajectory：keys/store/projector/git-ref-collector/cross-post-collector/thread-split-collector/scheduler/backfill，git/gh IO 接口化注入，`ctx.catsFeatTrajectory`，64 测试） |
| `domains/health`（健康检查） | `packages/api/health` | vendor（阶段 3） | ⬜ |
| `domains/human-disposition` + `domains/projects` + `domains/preview` + `domains/workspace` | `packages/cats/{human-disposition,projects,preview,workspace}` | vendor（阶段 4/5） | ✅（批次25 四包：cats-projects（F076/F070，33 测试）/cats-human-disposition（F281，21）/cats-workspace（F063，21）/cats-preview（F120/F156，31），Redis→KV 注入、http-proxy→PreviewProxyServer 注入、socket.io→端口接口，106 测试） |
| `domains/taste`（品味记忆） | `packages/cats/taste` | vendor（阶段 4） | ✅（批次25 cats-taste：taste-routing-guard/TasteRepository/writeVignette/approveTasteProposal/InMemoryTasteProposalStore（Redis 变体不移植仅保留 keys），GitRunner + ApprovalLock 端口注入，`ctx.catsTaste`，37 测试） |
| `domains/packs`（技能包）+ `domains/plugin`（host-inventory 控制面） | `packages/cats/packs` + `packages/cats/plugin-inventory` | vendor；**发现模型统一 dsh cordis YAML 装配**（R13），host-inventory 仅作控制面视图 | ✅（批次26：cats-packs（PackStore/SecurityGuard 9 步/Compiler/Loader/GrowthBoundary/PackKnowledgeScope/getActivePackBlocks，27 测试）+ cats-plugin-inventory（PackManifestSchema 严格校验 + validateEffectiveGrants 17 能力 + snapshot 三不变量 + Memory 事务串行化 + File 原子写 + HostInventoryControlPlane 生命周期，33 测试），`ctx.catsPacks` + `ctx.catsPluginInventory`） |
| `agent-hooks`（agent 生命周期钩子） | `packages/cats/agent-hooks` | vendor；对照 P: `core/hooks.py` | ✅（批次26 cats-agent-hooks：4 个 SyncTarget（session-start/stop 脚本 + codex/gemini JSON）+ canonical JSON 漂移 + applySync（dryRun/chmod）+ claude-settings 四态健康（保留用户 hooks）+ health 统一检查/同步（AgentHookCapabilityProbes 端口注入 + ownerAuthorized fail-closed），`ctx.catsAgentHooks`，22 测试） |
| `infrastructure/harness-eval/*`（a2a/anchor-first/capability-tips/capability-wakeup/freshness/friction/memory/sop/task-outcome/measurement/publish-verdict/hub 等 16 域） | `packages/forgekin/harness-eval` | vendor；对照 P: `harness/` + `evaluators/`（F36/F40） | ✅（批次16：EvalDomainRegistry 16 域内置注册 + 自定义追加 + 退役/重启用，见 Python 区 harness 行） |
| `infrastructure/{commands,debug,distillation,document,email,enterprise,github,grounding,scheduler,telemetry}` | `packages/api/infrastructure` | vendor 按域拆分（阶段 3-5） | 🟦（批次29 infrastructure-commands：CommandRegistry + manifest-commands，6 测试；infrastructure-distillation：DistillationCheckpoint + IOpportunityStore，5 测试；infrastructure-document：PandocService，5 测试；批次30 infrastructure-telemetry：hmac + genai-semconv + LocalTraceStore + parsePrometheusText + BurnRateMonitor，9 测试；infrastructure-debug：PromptCaptureStore + capturePromptIfEnabled 桥 + 注入式 nativeL0Fetcher，10 测试；批次31 infrastructure-scheduler：F139 类型契约 + ActorResolver + 五 node:sqlite store + f255-template-boundary，12 测试，TaskRunnerV2 运行时随 invocation/connector 移植再补；批次32 infrastructure-github：gh CLI 工具（token 解析/env 构建/#798 逐页拉取/评论游标/自登录解析），11 测试；infrastructure-grounding：F167 claim 影子核验（extractors/checker INV-O3/O4/O7/O8/O10/采样存储），14 测试，redis 持久化随 PR-O4 再补；批次33 infrastructure-enterprise：F162 Lark/WeCom 企业动作治理边界（双 CliExecutor + 双 ActionService + GoldenChain），19 测试；infrastructure-email：severity 解析/噪声与自反馈过滤/PR tracking store/CI 消息核心层，18 测试，批次34 infrastructure-redis-port + email RedisPrTrackingStore（Lua 原子语义/自愈/TTL，7 测试）+ grounding RedisGroundingSampleStore（8 天 TTL/滚动窗口/日上限计数，5 测试）批次35 email CI 状态层（execution-failure 证据分类 + status-fetcher 单 PR + batch-fetcher GraphQL 批量，14 测试）批次36 email Conflict 层（deliver-connector-message/ConflictRouter/ConflictAutoExecutor/ConflictCheckTaskSpec/ReviewFeedback 终态效应，19 测试）；CiCdRouter/CiCdCheckTaskSpec/IssueComment/ReviewFeedback TaskSpec/ConnectorInvokeTrigger 仍随 connector/github 特性移植再补；OTel-SDK 耦合文件随特性移植再补） |
| `config/{capabilities,governance,mount}` | `packages/harness/config` | vendor；capability 声明对照 P: `core/capability/` | ✅（批次27-28：forgekin-capabilities（C34a 17 测试）+ forgekin-governance（C34b：GovernanceBootstrapService/GovernanceRegistry/preflight/mission-pack/execution-digest-capture，19 测试）） |
| `plugins/{github,video-analysis,video-gen,wechat-visible-reader,weixin-mp}`（manifest `plugin.yaml` + `limbs/*.yml` + `protocols/*.yaml`） | `packages/plugins/*` | vendor（阶段 5/6 或 stretch）；manifest 迁移为插件装配声明（R17 §4） | ⬜ |
| `skill-security`（技能安全） | `packages/plugins/skill-security` | vendor（阶段 2） | ⬜ |
| `src/services/agents/invocation`（InvocationQueue/QueueProcessor/TaskProgressStore） | `packages/cats/invocation` | vendor；执行委托 `ctx.agentLoop`（F5） | ⬜ |
| `src/services/agents/providers/*`（claude/codex/gemini/agy/opencode 适配器） | `packages/limb/adapters` | vendor；接口对齐 P: `forgemind/external_agents.py` EAC 七契约 | ✅（批次5 limb-adapters：五 CLI 适配器全插件化 + 统一 CliEvent 契约 + LimbCliAdapterRegistry + LimbAdaptersService 挂载 `ctx.limbAdapters`，112 测试） |
| `src/services/profile/*`（frontmatter 解析/迁移/审批） | `packages/cats/profile` | vendor；frontmatter 扩展 SoulImprint 字段（F6） | ⬜ |
| `src/services/orchestration/*` | `packages/cats/orchestration` | vendor；对照 P: `forgemind/swarm.py` | ⬜ |
| `src/services/session/*`（TranscriptWriter） | `packages/cats/session` | vendor；threadId↔sessionId 关联（F3） | ⬜ |
| `src/services/stores/*`（ports: ThreadStore/MessageStore/TaskStore/BacklogStore/MemoryStore/…） | `packages/cats/stores` | vendor；better-sqlite3 实现，双栈物理隔离（R18） | ⬜ |
| `src/services/distillation/*`（Dossier） | `packages/cats/distillation` | vendor；对照 P: `evolution/knowledge_evolution.py` | ⬜ |
| `src/services/bootcamp|freshness|duty-briefing|usage-aggregator|…` | `packages/cats/*` | vendor | ⬜ |
| `src/domains/cats/*`（档案路由/技能包/记忆发布/任务积压） | `packages/cats/routes` | vendor，路由按域插件挂载 | ⬜ |
| `src/domains/limb/*`（LimbRegistry/LeaseManager/PairingStore/AccessPolicy/ObservationRouter/RemoteLimbNode/PluginLimbAdapter/RestExecutor/yaml-loader） | `packages/limb` | vendor；全部 Cordis 插件化（R13） | ✅（批次1 limb-core 六模块：Registry/Lease/Pairing/AccessPolicy/ActionLog/Presence + ApprovedPersistence；批次2 limb-node 四模块 + limb-embodiment BindingStore/yaml-loader/Redis 配对持久化；批次3 limb-observation：ObservationRouter/OutboundDeliveryHook/TranscriptCatDelivery 观察路由/出站投递/转录入群全插件化；批次4 limb-terminal：tmux 网关/spawner/会话/诊断全插件化；批次5 limb-adapters：五 CLI 适配器全插件化；批次6 limb-e2e：mock CLI 端到端（配对→租约→执行→转录→回传 + 租约冲突拒绝 + Windows pty 冒烟）跨六域插件装配验证，371 测试） |
| `src/domains/terminal/*`（tmux-gateway/tmux-agent-spawner/session-store）+ Windows pty 回退 | `packages/limb/terminal` | vendor + node-pty（Windows） | ✅（批次4 limb-terminal：TmuxGateway/TmuxAgentSpawner/AgentSessionsReader/SessionStore/AgentPaneRegistry + tmux-agent-carrier-session + F212 cli 诊断（cli-diagnostics/cli-spawn-helpers/cli-timeout）全插件化，LimbTerminalService 挂载 `ctx.limbTerminal`，115 测试；node-pty Windows 回退由组合根注入同接口） |
| `src/domains/services/*`（memory/signals/approval/notifications 等） | `packages/cats|chat` 对应域 | vendor 按域拆分 | ⬜ |
| `src/routes/threads|messages|callback-multi-mention|session-*|thread-branch|approval-hub|proposal|votes|world|community|story|leaderboard|marketplace|settings|…` | `packages/chat` + `packages/marketplace` | vendor；world/community/story 等 clowder 扩展降级 stretch（S1-S3/S7，见 `10-stage-map.md` §3.4） | ✅（批次1-8 chat-threads/messages/mention/session-chain/approval/realtime/misc + stretch-ports ports+mock + e2e） |
| `src/infrastructure/*`（websocket/socket.io、db better-sqlite3、redis、queues、events） | `packages/api/infrastructure` | vendor（阶段 3/5） | ⬜ |
| `cat-template.json` + `.cat-cafe/cat-catalog.json`（**JSON** 档案/目录模型：breeds/variants/CLI 适配器定义） | `packages/cats/catalog` | 结构对齐；Forgekin 档案保持 YAML（R17） | ✅（批次27 cats-catalog：CatCatalogStore 全生命周期（模板/variants/tombstones 合并视图）+ CatalogAccounts（损坏备份 .bak + 冲突 global 优先 skipConflicts）+ UserPreferencesStore + TemplateVariantBackfill 回填 + TemplateVariantTombstones 墓碑 + RuntimeCatCatalog + bootstrap-roster，`ctx.cats`，36 测试） |
| `.cat-cafe/` 运行态 JSON（accounts.json / user-preferences.json / proxy-upstreams.json / provider-profiles 迁移） | `data/` + `~/.flowforge/` | 格式对齐（JSON），改名 ff2 域（R17） | 🟦（批次27 accounts/user-preferences 已随 cats-catalog 交付；proxy-upstreams/provider-profiles 待阶段 6） |
| `src/config/env-registry.ts`（`CAT_CAFE_*` 环境变量集中登记：名称/默认值/分类/敏感标记） | `packages/harness/env-registry` | 移植为 `FF_*` 注册表（R17，阶段 0 T0.19） | ✅（批次27 env-registry：ENV_VARS 单一事实源（12 分类）+ maskUrlCredentials/buildEnvSummary（敏感/URL 掩码）+ isEditableEnvVar* fail-closed 白名单 + `ctx.forgeEnvRegistry`，10 测试） |
| `src/config/cat-config-loader.ts` + connector.yaml/plugin.yaml（connector 配置 YAML manifest） | `packages/chat|limb` 对应域 | 移植（R17；IM 通道为 stretch S1 时仅 ports） | 🟦（批次8 chat-stretch 已交付 IM ports + mock；cat-config-loader 待阶段 6） |
| `assets/prompt-hooks/*/hook.yaml`（prompt 钩子 YAML 定义） | `packages/core/system-prompt` + `packages/forgekin` | 移植（hook.yaml → prompt 插件 schema 段） | ✅（批次27 forgekin-prompt-hooks：HookManifestParser（hook.yaml 解析 + 目录前缀↔id 校验）+ HookRegistry（46 hooks 真实资产扫描）+ scope 过滤（session=S 系/turn=D 系）+ PromptBuilder buildSystemPrompt + InjectionTrace 双 trace（drain 一次清空）+ HookPipeline，`ctx.forgePromptHooks`，30 测试） |
| `packages/shared/*`（catId/threadId schema、profile-frontmatter-parser、registry 纯函数） | `packages/shared` | vendor | ⬜ |
| `apps/web`（页面与组件） | `apps/web` | 与 P: `web/` 前端融合（阶段 8） | ⬜ |

## 3. 品牌层（P → T，flowforge 原创移植）

| 来源（P） | 落点（T） | 处理 | 状态 |
|---|---|---|---|
| `forgemind/soul_imprint.py` | `packages/forgekin/soul`（SoulImprint） | 直接翻译 + golden tests | ✅（批次1 forgekin-soul：不可变哈希/命名空间隔离 + `ctx.forgeSoul`，8 测试） |
| `docs/features/F036-forgemind-forge-relationship.md`（无 Python 实现，按文档建模） | `packages/forgekin/relationship`（ForgeLayer/LayerTransition/ForgeRelationship） | 直接翻译（F036） | ✅（批次22 forgekin-relationship：层动态注册 + 进化/回炉协议（Eval≥0.85 + 5任务 + operator 审批 + 仅蒸馏通用能力）+ `ctx.forgeRelationship`，28 测试） |
| `docs/features/F038-forgemind-lineage.md`（无 Python 实现，按文档建模） | `packages/forgekin/lineage`（LineageNode/Edge/Store + split/fuse 执行器） | 直接翻译（F038） | ✅（批次22 forgekin-lineage：SoulImprint 唯一锚点 + 双向遍历 + 分裂保留父血缘/融合加权合并 + `ctx.forgeLineage`，26 测试） |
| `forgemind/plugins.py`（F026 四钩子 + forge_from_template） | `packages/forgekin/app`（ForgeMind 应用层） | 直接翻译（F026） | ✅（批次22 forgekin-app：四钩子注册表（4 模板/4 技能/2 通道/1 自我进化配置 YAML 驱动）+ forgeFromTemplate 便捷锻造 + `ctx.forgeMind`，12 测试） |
| `core/capability/*` | `packages/forgekin/capability`（CapabilityProfile/proficiency/blind_spots） | 直接翻译 | ✅（批次1 forgekin-capability：models/analyzer/profile + `ctx.forgeCapability`，38 测试） |
| `core/memory_federation/` + `core/event_memory.py` + `core/state_*` | `packages/forgekin/memory`（EchoStore 情景）+ `packages/forgekin/knowledge`（MindCodex 程序）+ `packages/forgekin/stores`（记忆治理） | 直接翻译；数据迁移见 `31-stage11-sunset.md` §4 | ✅（批次1 forgekin-memory：五存储 + EpisodePersistenceHook + `ctx.forgeMemory`；forgekin-knowledge：MindCodex 检索三入口；批次12 forgekin-stores：Collection/CollectionManager + 治理三要素，`ctx.forgeStores`） |
| `evolution/knowledge_evolution.py` | `packages/forgekin/knowledge`（SpiritForge 蒸馏管线） | 直接翻译 | ✅（批次1 forgekin-knowledge：三问→Episode→蒸馏→Eval 双门→storeToCodex，26 测试） |
| `forgemind/council.py` + `core/im_council.py` | `packages/forgekin/council`（MindCouncil：min_reviewers/min_distinct_vendors/pass_threshold） | 直接翻译；审批基础复用 `packages/chat` approval-hub | ✅（批次2 forgekin-council：CouncilVerdict/CouncilSession + 单厂商结构性拒绝 + CouncilChannel 适配；im_council 通道管理待 T7.16） |
| `evolution/self_dev_doc|code|framework|review|test.py` | `packages/forgekin/loops/*`（五闭环） | 直接翻译 | ✅（批次2 forgekin-loops：五步循环 + I1-I8 不变量 + `ctx.forgeLoops`，76 测试） |
| `forgemind/stages.py` + `evolution/maturity.py` | `packages/forgekin/stage`（觉醒阶/进化阶 E1-E6 + 成熟度阶梯） | 直接翻译 | ✅（批次2 forgekin-stage：双轴阶模型 + KnowledgeMaturityLadder + `ctx.forgeStage`，42 测试） |
| `core/workflow_compiler.py` + `workflow_compiler_parser.py` + `workflow_compiler_validator.py` | `packages/forgekin/workflow-compiler` + `packages/plugins/workflow` | 直接翻译（YAML→执行图） | ✅（批次3 forgekin-workflow-compiler：三阶段 Parser/Validator/CodeGen + 条件路由/复合步骤 + `ctx.forgeWorkflowCompiler`，43 测试） |
| `forgemind/external_agents.py` + `core/helm_adapter.py` + `helm_ws_manager.py` | `packages/limb/adapters`（EAC 七契约）+ `packages/forgekin/external-agents`（Helm LLM 事件桥） | 直接翻译为适配器接口 | ✅（批次5 limb-adapters EAC 六方法；批次3 forgekin-external-agents：五种内置 kind 子进程适配器 + LLMClientHelmAdapter + `ctx.forgeExternalAgents`，29 测试） |
| `forgemind/base.py` + `forgekin.py` + `registry.py` + `species.py` + `species_impl/` | `packages/cats/registry` + `packages/forgekin/species` | 概念映射 cat→Forgekin（F6） | ✅（批次7 forgekin-species：五物种模型/工厂/注册表/活实例表全插件化，69 测试） |
| `forgemind/stages.py`（觉醒流程）+ `forging/` | `packages/forgekin/awakening` + `packages/cats/bootcamp` | 直接翻译 | 🔶（批次7：`forging/` 已落 `packages/forgekin/forging`（ForgePipeline 六阶段 + `ctx.forgeForging`，30 测试）；觉醒流程仍待 `awakening`） |
| `forgemind/autonomous.py` | `packages/forgekin/loops/autonomous` | 直接翻译 | 🔶（批次10：已落 `packages/forgekin/autonomous`，F052 守护进程 `ctx.forgeAutonomous`；loops/autonomous 路径弃用） |
| `core/plugin_loader.py` + `plugin_manager.py` + `plugin_registry.py` + `plugin_lifecycle.py` + `plugin_packaging.py` + `plugin_protocol.py` + `plugin_sandbox.py` + `plugin_frontend.py` | `packages/extensions/*` + `packages/forgekin/plugins` | 行为基线对照；机制统一为 cordis loader（R13）；市场发现/安装记录/前端注册语义落 forgekin-plugins | ✅（批次18：Marketplace 七步安装/卸载/更新/四检查验证 + FrontendPluginRegistry 六挂载点 + `ctx.forgePlugins`，39 测试） |
| `core/marketplace.py` | `packages/forgekin/plugins` | 直接翻译 | ✅（批次18：MarketplaceRegistry 本地/远程 + 内置 registry + MarketplaceService，39 测试） |
| `core/approval_hub.py` + `core/teamact/` | `packages/chat/approval` + `packages/cats/teamact` | 直接翻译 | ✅（approval-hub 批次4 已交付；teamact 批次15a 交付，69 测试） |
| `core/credential_store.py` + `secret_store.py` | `packages/plugins/credentials` | 行为基线；存储迁移 better-sqlite3 加密列 | ⬜ |
| `core/scheduler.py` + `schedule_registry.py` + `job` 相关 | `packages/plugins/schedule|jobs` | 行为基线对照 | ⬜ |
| `core/skill_library.py` | `packages/plugins/skill` | 行为基线对照（skill 格式迁移 YAML frontmatter） | ⬜ |
| `core/mcp_integration.py` + `native_tool_server.py` + `tools_bridge.py`（forgemind） | `packages/plugins/mcp` | 行为基线对照 | ⬜ |
| `core/tracing.py` + `observability.py` + `metrics.py` + `event_bridge.py` + `events/event_bus.py` | `packages/forgekin/observability`（ctx.forgeObservability） | 直接翻译（P-94） | ✅（批次13，48 测试） |
| `core/guardrails.py` + `moderation.py` + `content_moderation.py` + `core/gate/` | `packages/plugins/guard` | 直接翻译 | ⬜ |
| `core/workspace.py` | `packages/plugins/workspace` | 直接翻译 | ⬜ |
| `core/external_agent/`（manifest/registry/host_injection/worktree/shared_state/fallback/capability_fusion/guardrails/acp_transport/cli_ndjson/bridge 等，F33/F34/F35） | `packages/external/agent` | 直接翻译（F33/F34/F35；CL-014~017） | ✅（批次21 packages/external/agent：AgentProviderManifest + ProviderTransportRegistry + HostInjector host-owned 注入 + ExternalAgentWorktree 隔离工作区 + F33 ExternalAgentSharedState + F34 ExternalAgentFallback + F35 ExternalAgentCapabilityFusion + ExternalAgentBridge 五步调用链 + ACPTransport/CLI-NDJSON 传输 + 六层 Guardrails + ReferenceAgentAdapter 参考运行时 + 内置 4 Manifest + `ctx.forgeExternalAgent`，113 测试） |
| `core/event_bridge.py` + `hooks.py` | `packages/harness/hooks` | 行为基线对照 | ⬜ |
| `core/config.py`（ConfigLoader/system_config）+ `core/config_version.py`（迁移） | `packages/harness/config`（schemastery schema + 迁移函数，R17） | 加载链路重构：无校验 yaml.safe_load → schema 校验 + patch 装配；config/ 全量 YAML 清单登记（T0.19） | ⬜ |
| `core/session_persistence.py` + `checkpoint_*` + `restart_recovery.py` | `packages/core/session` + `packages/harness/storage` | 行为基线对照 | ⬜ |
| `core/task_store.py` + `task_context.py` | `packages/cats/stores`（TaskStore） | 直接翻译 | ⬜ |
| `harness/feedback_loop.py` + `evaluators/` + `core/gate/` | `packages/forgekin/harness-eval` | 直接翻译（F36；F040） | ✅（批次16 forgekin-harness-eval：LifecycleJudge 五态判定 + ActionRecommender 行动路由 + DailySummarizer 每日汇总 + ScoringRuleEvaluator/MultiDimensionEvaluator + FeedbackLoop 外环质量门控（4 维评分 + 三模式 + 启发式回退 + P0-22 数据富集/P0-29 字段优先级）+ EvaluatorRegistry + EvalDomainRegistry 16 域，`ctx.forgeHarnessEval`，86 测试） |
| `harness/{durable_state,tool_mediation,evidence_sensors,governance,entropy_manager}.py` + `harness/config/harness.yaml` | `packages/forgekin/harness` | 直接翻译（F10；F008-F010/FR-HRN-04） | ✅（批次17 forgekin-harness：L1 durable-state（sqlite/git 双后端 + 乐观锁版本自增）+ L2 tool-mediation（白名单/别名/审计 + 4 拒绝类别）+ L3 evidence-sensors（四类证据 + SHA-256 自验证）+ L4 governance（注入点/优先级 + 5 规则 GOV-001~005）+ L6 entropy-manager（DocGardener/DebtTracker/RuleEvolution/GarbageCollection）+ L7 harnessability（六维加权 + 到期检查），`ctx.forgeHarness`，74 测试） |
| `core/world_engine/` + `core/conditional_router.py` | stretch（`10-stage-map.md` §3.4） | 降级 | ⬜ |
| `forgemind/*_to_openroute_proxy.py` + `anthropic_to_openroute_proxy.py` | `packages/llm/openroute` | 直接翻译为 provider | ⬜ |
| `forgemind/magic_words.py` | `packages/forgekin/magic-words` | 直接翻译（F15；A011） | ✅（批次4 forgekin-magic-words：4 条魔法短语子串检测 + `ctx.forgeMagicWords`，12 测试） |
| `forgemind/swarm.py` + `config/agent_swarm.yaml` | `packages/forgekin/swarm` | 直接翻译（F16；F049） | ✅（批次5 forgekin-swarm：SwarmCoordinator 调度/心跳回收/跨厂商 + `ctx.forgeSwarm`，68 测试） |
| `core/im_council.py` + `config/im_council.yaml` + `config/im_channels.yaml` + `config/a2a_channels.yaml` + `core/channel_manager.py` | `packages/forgekin/im-council` + `packages/chat/channels` | 直接翻译（F17；F047）；A2A 域独立 `packages/a2a` | ✅（批次14 forgekin-im-council：五步议事 + I1-I5 不变量 + Console/WebChat/TraeBridge 三通道 + `ctx.forgeImCouncil`；chat-channels：ChannelManager 注册/广播/分发，45 测试） |
| `core/teamact/` + `config/teamact_steer.yaml` | `packages/cats/teamact` | 直接翻译（F18；F048） | ✅（批次15a cats-teamact：TeamActState 六步循环 + TerminationReport 五项 + HandoffCapsule + PingPongCircuitBreaker + SteerQueue 7 动作 I1-I5，`ctx.catsTeamAct`，69 测试） |
| `docs/features/F005/F006`（Python 老代码无 ball_custody/push_back，按文档契约建模） + clowder-ai `domains/ball-custody` + `packages/shared/src/types/ball-custody.ts` | `packages/cats/ball-custody` | 直接翻译（F40；C24） | ✅（批次23 cats-ball-custody：F005 BallCustodyRegistry + F006 PushBackProtocol + C24 8 态 × 17 事件表驱动状态机 + 事件溯源 Projector，`ctx.catsBallCustody`，61 测试） |
| clowder-ai `domains/guides`（GuideLifecycleService/GuideSessionRepository/GuideRoutingInterceptor/GuidePromptSection/guide-registry-loader） | `packages/cats/guides`（lifecycle-service/session-repository/routing-interceptor/prompt-section/registry-loader） | 直接翻译（F155；C25） | ✅（批次24 cats-guides：5 态 forward-only 状态机 + GuideStateBridge（独立 session store）+ 三阶段 routing-interceptor（prepare/guideContextForCat/ack）+ bootcamp→guide bridge（F171）+ KV 接口注入替代 Redis，`ctx.catsGuides`） |
| clowder-ai `domains/concierge`（ConciergeConfig/ThreadService/Relay/Confirmation/TriagePlan/InvestigationJob/search-context/reply-validator/target-cats/verified-tool-target/prompt-section/routing-interceptor） + `packages/shared/src/types/concierge.ts` | `packages/cats/guides/src/concierge/*` | 直接翻译（F229；C25） | ✅（批次24 cats-guides concierge：KV 接口注入替代 Redis Lua CAS、RosterResolver 替代 catRegistry 单例、ConciergeWorkerLog 可选注入、TTL=0 铁律 5 LL-048、INV R1-R4/C1-C4/T1-T3/I1-I3 不变量全部落地，85 测试） |
| `forgemind/forms.py` + `forgemind/species_impl/org.py` + `forgemind/base.py` + `config/forgekins/keane.yaml*`（F041-F044） | `packages/forgekin/roles` | 直接翻译（F43；四角色子代理） | ✅（批次15b forgekin-roles：ForgekinRole 基类 observe/act/verify 三方法 + 四角色 ProductManager/DevOps/SecurityOfficer/DeliveryManager 各 5 动作 + 审批降级/WAL 先行/Tier0 拒绝/金丝雀/质量门禁不变量，`ctx.forgeRoles`，56 测试） |
| `evolution/eval_ledger.py` + `core/eval/`（contract/three_signals/attribution） | `packages/forgekin/eval-ledger` | 直接翻译（F19/F41；F050） | ✅（批次8 forgekin-eval-ledger：Replay A/B 七步台账 + 五问契约 + 三方信号交叉 + 七类归因，`ctx.forgeEvalLedger`，59 测试） |
| `forgemind/autonomous.py` + `evolution/auto_dream.py` | `packages/forgekin/autonomous` + `packages/forgekin/auto-dream` | 直接翻译（F20；F051） | ✅（批次10：F052 自主守护进程 `ctx.forgeAutonomous` + CL-031 梦境整合 `ctx.forgeAutoDream`，81 测试） |
| `evolution/{engine,foreman,runtime,qc_loop,close_gate,process_evolution,scope_guard,metacognition,models}.py` | `packages/forgekin/evolution-engine` | 直接翻译（F22；F046 三循环基础设施） | ✅（批次11 forgekin-evolution-engine：ForgeMindEngine 三模式治理 + CL-033 ApprovalHub + SelfDevRuntime 五闭环装配 + ContinuousForeman 调度 + CL-034 QC Loop + CL-025 Close Gate，`ctx.forgeEvolution`，114 测试） |
| `core/{circuit_breaker,fallback_chain,degradation,recovery_tier,restart_recovery,checkpoint_manager,checkpoint_config}.py` + `config/resilience.yaml*` + `config/recovery_tiers.yaml*` | `packages/plugins/resilience` + `packages/core/session` | 直接翻译（F23；A004/A022） | ✅（阶段2 基础核心；批次9 补齐 ResilienceExecutor+CheckpointConfig+Cordis 插件 `ctx.forgeResilience`，58 测试） |
| `core/feature_flags.py` + `core/canary.py` + `config/canary/default.yaml` | `packages/plugins/feature-flags` + `packages/plugins/canary` | 直接翻译（F24） | ⬜ |
| `core/base_mode_executor.py` + `modes/` + `core/execution_policy.py` + `core/step_limiter.py` + `core/agent_timeout.py` | `packages/plugins/modes` + `packages/core/agent` | 直接翻译（F25） | ⬜ |
| `core/{content_moderation,moderation}.py` + `core/gate/` + `core/guardrails.py` | `packages/plugins/guard` | 直接翻译（F26） | ⬜ |
| `core/{handoff,state_mapper,state_updates,state_query_tool,variable_resolver,namespace,context_layer_manager,tool_chain_executor,field_condition_gate}.py` | `packages/core/state`（F27；A003/A024；compiler 侧见 T7.8 workflow-compiler） | 直接翻译（F27；A003/A024） | ✅（批次19 core-state：NamespaceRegistry/HandoffManager/StateUpdateMapper/StateMapper/VariableResolver/FieldConditionGate/ContextLayerManager/StateQueryTool/ToolChainExecutor + `ctx.forgeState`，61 测试） |
| `core/{model_service,model_capability,provider_quota}.py` + `config/llm_route.yaml` + `config/provider_quota.yaml*` | `packages/llm/*` | 直接翻译（F28） | ✅（批次20 packages/llm/route：RouteResolver/LLMRouter/ModelService/HealthChecker/ModelCapabilityProvider/ProviderQuotaManager/ModelCapability + 内置 llm-route.yaml + `ctx.forgeLlmRoute`，121 测试） |
| `sop/` + `config/sops/*.yaml` | `packages/forgekin/sop` | 直接翻译（F29） | ✅（批次4 forgekin-sop：PredicateChecker 8 检查器 + SOPExecutor 阶段门禁/流转 + YAML 加载 + `ctx.forgeSop`，71 测试） |
| `forgemind/{base,forgekin,registry,species}.py` + `species_impl/` + `forgemind/forgekins/*.yaml`（8 物种档案） | `packages/cats/registry` + `packages/forgekin/species` | 概念映射 cat→Forgekin（F30；A027） | ⬜ |
| `forging/` + `forgemind/config/forging.yaml` | `packages/forgekin/forging` | 直接翻译（F31；A028） | ✅（批次7 forgekin-forging：ForgePipeline 六阶段 + 内置双 YAML + `ctx.forgeForging`，30 测试） |
| `core/event_memory.py` + `events/` + `middleware/` + `security/` + `vcs/` + `compiler/` + `loop/` + `evaluators/` + `a2a/` + `executor/` + `session/` + `scheduler/` + `skills/` + `llm/` + `agents/` + `brain/` + `services/` + `review/` | `packages/{core,harness,forgekin}/*` 对应域 | 逐目录盘点登记，移植前先读源再写 crosswalk 明细 | ⬜ |
| `core/{prompt_manager,persona_injector,persona_lock}.py` | `packages/core/system-prompt` | 行为基线对照（D2） | ⬜ |
| `config/trae_bridge.yaml` + `.trae_bridge/` | `packages/forgekin/trae-bridge` | 直接翻译（F32；F045） | ✅ |
| `web/`（Next.js 前端） | `apps/web` | 与 clowder `apps/web` 融合（阶段 8） | ⬜ |

## 4. 行为基线工作流（每行的操作顺序）

1. 读取 P: 源文件与对应测试（`core/tests/`、`forgemind/tests/`、`evolution/tests/`）；
2. 提取行为用例（输入/输出/边界/状态机）转写为 T: 包的 golden tests；
3. 从 D:/C: vendor 对应实现（若存在），再按 golden tests 修齐行为差异；
4. 无 D:/C: 对应的（forgekin 原创）直接从 P: 翻译；
5. 勾选本表状态，并在 `10-stage-map.md` 矩阵同步。
