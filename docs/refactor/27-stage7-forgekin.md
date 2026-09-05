# 阶段 7：Forgekin 进化移植（FlowForge 特色）

> 目标：把 flowforge Python 版的 Forgekin 进化内核用 TS 重写为 `packages/forgekin` 域，
> 与 cats/chat/limb 域及 dsh 框架层打通。

## 任务清单

- [x] T7.1 `packages/forgekin/soul`：SoulImprint（持久身份标识，含物种 species/阶段 stages）
      （批次1：soul-imprint 哈希稳定/不可变/命名空间隔离 + SoulService 挂载 `ctx.forgeSoul`，8 测试）
- [x] T7.2 `packages/forgekin/capability`：CapabilityProfile（proficiency/blind_spots/能力画像）
      （批次1：models/analyzer/profile + CapabilityService 挂载 `ctx.forgeCapability`，38 测试）
- [x] T7.3 `packages/forgekin/memory`：EchoStore（情景记忆，事件驱动持久化）
      （批次1：echo-store/memory-manager + MemoryService 挂载 `ctx.forgeMemory` + EpisodePersistenceHook，9 测试）
- [x] T7.4 `packages/forgekin/knowledge`：MindCodex（程序记忆库 + 检索）+ SpiritForge（经验蒸馏管线）
      （批次1：models/knowledge-evolution/mind-codex/spirit-forge + KnowledgeService 挂载 `ctx.forgeKnowledge`，26 测试）
- [x] T7.5 `packages/forgekin/council`：MindCouncil（跨厂商审议：min_reviewers /
      min_distinct_vendors / pass_threshold 强制）
      （批次2：CouncilVerdict/CouncilSession 聚合 + 单厂商结构性拒绝 + CouncilChannel 通道适配
      + CouncilService 挂载 `ctx.forgeCouncil`，18 测试）
- [x] T7.6 `packages/forgekin/stage`：AwakeningStage / EvolutionStage E1-E6 + Maturity 成熟度
      （批次2：双轴阶模型（觉醒/进化）+ KnowledgeMaturityLadder 五级晋升/降级/冻结
      + StageService 挂载 `ctx.forgeStage`，42 测试）
- [x] T7.7 `packages/forgekin/loops`：五自进化闭环 self_dev_doc / self_dev_code /
      self_dev_framework / self_dev_review / self_dev_test（TS 重写自 evolution/）
      （批次2：SelfDevLoopBase 五步循环 Discover→Plan→Act→Verify→Persist + I1-I8 不变量
      （觉醒阶门控/Scope Guard/Reflect≤3/LLM 审核必经/I8 approval）+ LoopsService 挂载
      `ctx.forgeLoops`，76 测试）
- [x] T7.8 `packages/forgekin/workflow-compiler`：YAML 工作流 → 执行图（TS 重写自
      core/workflow_compiler*.py，三阶段 Parser/Validator/CodeGen + 条件路由/复合步骤，
      `ctx.forgeWorkflowCompiler`，43 测试）
- [x] T7.9 `packages/forgekin/external-agents`：EAC 七契约外部 agent 适配器（TS 重写自
      forgemind/external_agents.py + helm_adapter.py，子进程隔离 + Helm LLM 事件桥），
      `ctx.forgeExternalAgents`，29 测试
- [x] T7.10 `packages/forgekin/harness`：7 层 harness 工程（durable_state/tool_mediation/
      evidence_sensors/governance/magic_words/entropy_control/harnessability）
      （批次17：L1 durable-state sqlite/git 双后端乐观锁版本自增 + L2 tool-mediation 白名单/
      别名/审计拒绝（4 拒绝类别）+ L3 evidence-sensors 四类证据 SHA-256 自验证 + L4 governance
      注入点优先级规则（5 规则 GOV-001~005）+ L6 entropy-manager 文档保鲜/债务追踪/规则演化/
      垃圾回收四组件 + L7 harnessability 六维加权评估到期检查；magic_words 见 T7.14（批次4）；
      HarnessService 挂载 `ctx.forgeHarness`，74 测试）
- [x] T7.11 `packages/forgekin/plugins`：插件市场 + 前端插件（桥接 chat marketplace）
      （批次18：PluginManifest 清单（分类/挂载点/依赖/checksum）+ MarketplaceRegistry 本地/远程
      注册表（search/list/getPlugin/refresh）+ 内置 registry 2 插件 + Marketplace 七步安装
      （查找/版本/已装/FlowForge 兼容/依赖递归/checksum/下载复制 + installed.json 持久化）+
      卸载依赖者拒绝/更新/四检查验证（files/entry/checksum/safety）+ FrontendPluginRegistry
      六挂载点前端注册表 + MarketplaceService 挂载 `ctx.forgePlugins`，39 测试）
- [x] T7.12 `packages/forgekin/observability`：追踪/指标/事件总线（TS 重写自 `core/{tracing,observability,metrics,event_bridge}.py` + `events/event_bus.py`，F13/P-94，ctx.forgeObservability，48 测试）
- [ ] T7.13 测试（批次53 执行）：YAML 注册 Forgekin → 五闭环各跑通演进（LLM 走 OpenRoute
      真实调用或 llm-replay 录制回放双模式——T1 禁 mock LLM，无凭据环境自跳过并标注
      `@real-llm`；被测系统外部的 CLI 桩按 limb-e2e 先例属边界外依赖）；跨厂商审议拒绝同厂商；
      工作流编译器 DAG 执行；SpiritForge 蒸馏入库可检索
- [x] T7.14 `packages/forgekin/magic-words`：魔法词（TS 重写自 `forgemind/magic_words.py`，F15）
      （批次4：4 条魔法短语 → stop-and-audit 触发动作子串检测 + MagicWordsService 挂载
      `ctx.forgeMagicWords`，12 测试）
- [x] T7.15 `packages/forgekin/swarm`：群聊编排（`forgemind/swarm.py` + `config/agent_swarm.yaml`，F16）
      （批次5：SwarmCoordinator 全量移植 — I2 submit 必有 trace / I3 capability routing
      4 步过滤（能力包含→I5 跨厂商→I6 no-self-review→load balancing）/ I4 心跳超时
      reassign（maxRetries 超限 FAILED）/ 能力互补 complement 推荐 / cancel-fail 终态 /
      runContinuously 调度循环 + 单例工厂；agent_swarm.yaml 内置（5 Forgekin 画像，
      heartbeat 200s）；SwarmService 挂载 `ctx.forgeSwarm`，68 测试）
- [x] T7.16 `packages/forgekin/im-council` + `packages/chat/channels`：IM 议会 + 通道管理
      （`core/im_council.py` + `channel_manager.py`，F17/F047；批次14：IMCouncilManager 五步
      议事流程（发起→推送→等待→decide→归档）+ I1 降级链路（console>trae>webchat）+
      I2 append-only 归档 + I3 requestApproval 唯一入口 + I4 超时自动拒绝 + I5 JSONL 落盘；
      Console/WebChat(Phase2 骨架)/TraeBridge(F045 复用 trae-bridge) 三通道；
      ChannelManager 注册/广播/分发；ImCouncilService 挂载 `ctx.forgeImCouncil`，45 测试；
      A2A 域独立 `packages/a2a`）
- [x] T7.17 `packages/cats/teamact`：TeamAct 转向（`core/teamact/` + `config/teamact_steer.yaml`，F18；
      与 `packages/chat/approval` 打通；批次15a：六步循环状态机 TeamActState + 五项终止条件
      TerminationReport + HandoffCapsule 交接胶囊 + PingPongCircuitBreaker 乒乓熔断 +
      SteerQueue 7 动作队列干预（I1 frozen 不可篡改 + I2 operator 独占 + I3 JSONL trace 归档 +
      I4 非 EMERGENCY 不修改队首 + I5 EMERGENCY 可中断/取消/重定向队首）
      TeamActService 挂载 `ctx.catsTeamAct`，69 测试）
- [x] T7.18 `packages/forgekin/eval-ledger`：评估台账 + 评估契约/三信号交叉/归因矩阵
      （`evolution/eval_ledger.py` + `core/eval/`，F19/F41）
      （批次8：ReplayABRunner 七步流程（用例校验/净增益/烟雾门 2-3/晋升门 3-5+3 类覆盖/
      决策与拒绝原因）+ EvalLedgerStore 五指标统计 + RuleBasedJudge 四档评分；
      EvalContract 五问 + ContractRegistry；ThreeSignalCrossValidator 三方交叉（三级判定提取/
      多数投票/置信度加权）；Attributor 七类归因（关键词规则 + category_hint 加权 + 外置
      YAML 文案模板铁律5+P16），EvalLedgerService 挂载 `ctx.forgeEvalLedger`，59 测试）
- [x] T7.19 `packages/forgekin/autonomous` + `packages/forgekin/auto-dream`：自主进化 + 梦境回放
      （`forgemind/autonomous.py` + `evolution/auto_dream.py`，F20；批次10：autonomous — F052 24h 自主守护进程（三类扫描：文档缺失/TODO/测试缺失三级查找 + 状态感知去重 + Bug1 消费循环与拾取即心跳 + 心跳保活 + Bug2 无效产出检测 + Bug4/5 主动 fail_task + 三类真实落盘 + 活动日志）
      `ctx.forgeAutonomous`；auto-dream — CL-031 双层架构（EpisodeCard/MethodCard L0-L2 模型 + 五级成熟度阶梯 + 贪心聚类 + 蒸馏 L2 草稿 + TopK 浮现 + 4 信号 telemetry + I1 幂等/I4 中断 + 后台循环）`ctx.forgeAutoDream`，81 测试）
- [x] T7.20 `packages/forgekin/evolution-engine`：进化引擎三循环
      （`evolution/{engine,foreman,runtime,qc_loop,close_gate,process_evolution,scope_guard,metacognition,models}.py`，F22；批次11：ForgeMindEngine 三模式治理（Mode A Scope Guard 偏离检测 / Mode B Process Evolution 提案管理 / Mode C Knowledge Evolution + 元认知路由）+ CL-033 ApprovalHub 审批中心 + SelfDevRuntime 五闭环装配（auto/manual/im 三审批模式）+ ContinuousForeman 五 Forgekin 持续调度 + CL-034 QC Loop 7-Step + CL-025 Close Gate 判据，`ctx.forgeEvolution`，114 测试）
- [x] T7.21 `packages/plugins/resilience`：弹性栈（`core/{circuit_breaker,fallback_chain,degradation,recovery_tier,
      restart_recovery,checkpoint_*}.py` + `config/resilience.yaml|recovery_tiers.yaml`，F23）
      （批次9：在阶段2 基础核心（熔断/回退链/降级决策树/恢复层级/重启恢复）之上补齐 —
      ResilienceExecutor P3-005 灾备执行器（三级恢复执行 + 回退链降级）+
      CheckpointConfig YAML 配置加载与校验 + ResilienceService Cordis 插件化
      挂载 `ctx.forgeResilience`（decisionTree/executor/checkpoint 门面），58 测试）
- [x] T7.22 `packages/forgekin/stores`：Side-Effect WAL + 记忆治理（F21/F39；事件写前日志）
      （批次12：WriteAheadLog 事件写前日志（append 深拷贝/get/mark_committed/mark_rolled_back
      单向状态机/list_uncommitted 重放/count 审计，spec 移植自 tests/core/reliability/test_wal.py）
      + MemoryCollection/CollectionManager（backend 协议注入铁律4 + mark_consumed 不可变）
      + MemoryGovernance 三要素（权威等级/消费加权/衰减幂等），StoresService 挂载
      `ctx.forgeStores`，35 测试）
- [x] T7.23 `packages/forgekin/knowledge`：MindCodex 检索三入口/消费加权排名/可检索（F38）
      （批次1：search/listByDomain/listByTag 三入口 + recordConsumption 消费加权，见 T7.4）
- [x] T7.24 `packages/forgekin/sop`：SOP 标准作业程序（`sop/` + `config/sops/*.yaml`，F29）
      （批次4：SOPDefinition/Stage/HardRule/Pitfall 模型 + PredicateChecker 8 检查器
      （manual/git_state/env/command_pattern/command_sequence/handle/sha_dedup/feature_doc）
      + SOPExecutor 阶段门禁/可选阶段降级/for-break-success 流转 + YAML 加载，
      SopService 挂载 `ctx.forgeSop`，71 测试）
- [x] T7.25 `packages/forgekin/species` + `packages/forgekin/forging`：物种体系 + 锻造流水线
      （`forgemind/{base,forgekin,registry,species}.py` + `species_impl/` + `forging/`，F30/F31）
      （批次7：forgekin-species 五物种数据模型 + ForgekinBase（chat 降级/注入/重试分类）
      + ForgekinRegistry selectOwner 启发式 + SpeciesFactoryRegistry 构造器注册表（替代
      Python importlib）+ 五形态 act 边界校验 + SpeciesService 活实例表（spawn/adopt）
      挂载 `ctx.forgeSpecies`；forgekin-forging 六阶段 ForgePipeline（失败包装/计时/
      lastStageResults）+ 默认锚点 SoulImprint + forgeFromYaml 配置驱动 + 内置
      forging.yaml/prompts.yaml（import.meta.url 定位），ForgingService 挂载 `ctx.forgeForging`，99 测试）
- [x] T7.26 `packages/forgekin/trae-bridge`：Trae 桥（`config/trae_bridge.yaml` + `.trae_bridge/`，F32；
      移植 `llm/trae/` 七模块：TraeBridgeProtocol 文件协议（writeRequest/pollResponse/cancel/归档/
      status.json，F045 I1-I8 不变量）+ TraeLLMClient 门面（chat/stream/completeCode/reviewCode/
      generateTests + 会话持久化）+ BridgeLLMOperator（OpenRoute 轮询 + 原子重命名互斥 +
      无效响应/超时重试 + fallback 模型切换）+ TraeSession/Manager + YAML 配置（${ENV} 占位符 +
      环境变量覆盖），SopService 同构挂载 `ctx.forgeTraeBridge`，113 测试）
- [x] T7.27 `packages/forgekin/harness-eval`：harness-eval 控制面（F36；对照 clowder C32 16 域评估）
      （`harness/feedback_loop.py` + `evaluators/`，F040；批次16：LifecycleJudge 五态判定
      （增值/折旧/行动/瓶颈/稳定）+ ActionRecommender 行动路由（F012 sunset / F020 fix /
      escalate CVO）+ DailySummarizer 每日汇总（聚合 F018 契约 + F019 信号 + F020 归因）
      + ScoringRuleEvaluator/MultiDimensionEvaluator 维度评估器 + FeedbackLoop 外环质量门控
      （4 维评分 + PASS/CONDITIONAL/FAIL + full/lightweight/skip 三模式 + 启发式回退 +
      数据富集短内容自动 PASS P0-22 + 字段优先级 P0-29）+ EvaluatorRegistry 注册中心 +
      EvalDomainRegistry 16 域注册表（退役/重启用）；HarnessEvalControlPlaneService 挂载
      `ctx.forgeHarnessEval`，86 测试）
- [x] T7.28 `packages/forgekin/roles`：特种角色子代理（产品经理/DevOps/安全官/交付经理，F43；
      移植 `forgemind/species_impl/org.py` + `forgemind/base.py` 契约 + F041-F044 文档：
      ForgekinRole 基类（observe/act/verify 三方法 + lifecycle + 能力判定 + 审批辅助）+
      四角色（ProductManager 鹰·凯恩 五动作/愿景变更审批/三段式用户故事/MoSCoW·RICE，
      DevOps 蜂鸟·闪电 五动作/WAL 先行/Tier0 拒绝/金丝雀放量/重大变更审批，
      SecurityOfficer 狼·阿尔法 五动作/阻断审批/扫描审计告警自主/审计 append-only，
      DeliveryManager 象·牛顿 五动作/资源重分配审批/质量门禁不可绕过/阻塞风险上报）+
      RolesService 挂载 `ctx.forgeRoles`（四角色注册表 + 自定义角色注册），56 测试）
- [ ] T7.29 测试（批次54 执行）：魔法词触发（真实短语样本）/群编排/IM 议会拒绝同通道/
      评估台账记账/进化引擎三循环演进/弹性栈故障注入恢复（注入式故障端口）/检索排序/
      锻造流水线产物验收（LLM 边界同 T7.13：OpenRoute 真实/llm-replay 双模式）
- [x] T7.30 `packages/core/state`：F27 状态机族（TS 重写自 `core/{namespace,handoff,state_updates,state_mapper,variable_resolver,field_condition_gate,context_layer_manager,state_query_tool,tool_chain_executor}.py`，F003/F024；A003/A024）
      （批次19：NamespaceRegistry 命名空间注册表 + HandoffManager 交接路由（按 target 去重/
      LLM 提示词生成）+ StateUpdateMapper 统一状态输出（嵌套路径设置/新旧格式提取）+
      StateMapper/ParamMapping 声明式参数映射（state./auto./input./context. 四前缀 + 8 种
      transform）+ VariableResolver 统一变量解析（4 级格式兼容 + 别名映射）+ FieldConditionGate
      确定性字段门禁（not_empty/==/length/>= 四类条件 + YAML 加载）+ ContextLayerManager 多层
      上下文（L1 全文/L2 章节摘要/L3 卷摘要/L4 全书摘要/WST 世界状态 + 两阶段并行摘要生成）+
      StateQueryTool 状态查询基类（scope 过滤 + web_search 降级）+ ToolChainExecutor ReAct
      循环（消息窗口裁剪/同工具连续 3 次循环检测/max_iterations）；依赖（Memory/LLM/
      ToolRegistry/EventBus/web_search）接口注入；StateService 挂载 `ctx.forgeState`，61 测试）
- [x] T7.31 `packages/llm/route`：F28 LLM 路由/模型服务/提供商配额（TS 重写自
      `core/{model_service,model_capability,provider_quota}.py` + `config/llm_route.yaml` +
      `config/provider_quota.yaml*`，F025）
      （批次20：LLMRoute/FailoverPolicy/RouteResolver 路由解析（assignment 解析/双策略
      failover）+ LLMRouter 健康感知路由（错误率 0.05 步进 1 次即降级/连续 3 次熔断/恢复
      衰减）+ ModelService 健康检查（24h 可用缓存/冷却期/七类错误分类/forceUpdateModels/
      autoFix/recordCall）+ HealthChecker 周期巡检（findAffectedAssignments 扁平嵌套/
      checkAndFailover）+ ModelCapabilityProvider 能力路由（provider 评分/健康追踪）+
      ProviderQuotaManager 六维配额（日/时/分预算/并发/余额/计数 + backup 切换）+
      ModelCapability 零配置高级 API（chat/embed/summary/agent）；内置 llm-route.yaml；
      依赖（HttpLike/SecretResolver/PluginRegistry）接口注入；LlmRouteService 挂载
      `ctx.forgeLlmRoute`，121 测试）
- [x] T7.32 `packages/external/agent`：F33-F35 外部 Agent 全族（TS 重写自
      `core/external_agent/`，F033-F035）
      （批次21：AgentProviderManifest 声明模型（协议/传输/安全级别校验）+ ProviderTransportRegistry
      注册/发现/load_from_dir 覆盖语义 + HostInjector host-owned 注入（凭据/sandbox/MCP env
      脱敏）+ ExternalAgentWorktree 隔离工作区（唯一目录名/复制源跳 4 目录/回滚快照）+ F33
      ExternalAgentSharedState 共享状态（store DI + listHistory 内存索引）+ F34
      ExternalAgentFallback 降级回退（双层循环 provider×retry + 默认链只保留已注册）+ F35
      ExternalAgentCapabilityFusion 能力融合（min_invocations=3/min_success_rate=0.7 门槛 +
      weight=min(base×count,max) + 能力/盲点不去重合并）+ ExternalAgentBridge 五步调用链
      （选 Provider→注入历史→fallback 链→写共享状态+融合→聚合成本）+ ACPTransport/CLI-NDJSON
      传输层 + ReferenceAgentAdapter 参考运行时 + 六层 Guardrails（L1 输入/L2 提示词/L3 工具
      白名单/L4 输出脱敏/L5 操作确认/L6 成本上限）+ 内置 claude_code.yaml 等 4 Manifest；
      ExternalAgentService 挂载 `ctx.forgeExternalAgent`，113 测试）
- [x] T7.33 `packages/forgekin/{relationship,lineage,app}`：F37 ForgeMind 锻造关系/谱系/应用层
      （TS 重写自 `docs/features/F036-forgemind-forge-relationship.md` +
      `docs/features/F038-forgemind-lineage.md` + `forgemind/plugins.py`，F026/F036/F038）
      （批次22：forgekin-relationship（F036）：ForgeLayer 层动态注册（插件注册垂直层自动加入
      通用层 can_evolve_to）+ 进化协议（Eval≥0.85 + 5+ 任务 + operator 审批 → 能力画像复制 +
      垂直技能注入）+ 回炉协议（仅蒸馏通用能力 distill_general_only + 垂直能力保留原层）+ 幂等
      执行（重复执行返回既有记录；其后有迁移则拒绝）+ computeCapabilityDelta 差异计算，
      `ctx.forgeRelationship`，28 测试；forgekin-lineage（F038）：LineageNode 以 soul_imprint
      为唯一锚点（capability_profile/value_anchors 工程补充）+ LineageStore 双向遍历
      （getAncestry/getDescendants）+ LineageSplitExecutor 分裂（一父多子、复制父能力 +
      capability_adjust 调整、保留父血缘）+ LineageFuseExecutor 融合（≥2 父、数值加权平均/
      数组并集/其余取权重最大、保留多父血缘）+ 六类 LineageRelation（forged/split/fused/
      cloned/traded/layer）校验，`ctx.forgeLineage`，26 测试；forgekin-app（F026）：
      ForgeMind 应用层四钩子注册表（4 通用模板/4 锻造技能/2 MindCouncil 通道/1 自我进化配置，
      同名覆盖 + YAML 配置驱动）+ forgeFromTemplate 便捷锻造入口（构造 ForgekinFormData 调
      ForgePipeline.forge），`ctx.forgeMind`，12 测试）
- [x] T7.34 `packages/cats/ball-custody`：F40 球权托管 + push-back 协议 + C24 球状态机
      （TS 重写自 `docs/features/F005-ball-custody-lease.md` + `F006-push-back-protocol.md`
      （Python 老代码无 ball_custody/push_back，按文档契约建模）+ clowder-ai
      `domains/ball-custody`，F005/F006/C24）
      （批次23：BallCustodyRegistry（F005：TTL 300s 安全网 + now_fn 注入 + 双持球防护 +
      懒清理过期 lease + lease-{10hex} + metrics 四计数，AC-A1~A9）+ PushBackProtocol
      （F006：三要素强制（from_owner/reason/evidence）+ 显式 resolve + pb-{10hex}，
      AC-A1~A10）+ 球状态机（C24：8 态 × 17 事件表驱动 STATIC_TABLE+DYNAMIC_TABLE +
      DEAD_BALL_ZOMBIE_GRACE_MS=600s + handed_cvo/hold_expired/heartbeat 三动态 resolver
      + 穷举 INV-10）+ BallCustodyProjector 事件溯源（apply/rebuild/rebuildAll + 字段 effect
      + stale 清理 + rejected 记录）+ 内存 log/store（可换持久实现）+ 内置 ball-custody.yaml；
      BallCustodyService 挂载 `ctx.catsBallCustody`，61 测试）

## 验收标准

1. 配置驱动注册 Forgekin（沿用 `config/forgekins/*.yaml` 语义）。
2. 跨厂商审议在只有单一厂商时可被强制拒绝（结构性护栏）。
3. 五闭环各自产生可验证的演进产物（文档/代码/框架/审查/测试）。
4. 工作流编译器与 Python 版语义等价（样例 workflow 逐条对比）。
5. 弹性栈故障注入（熔断/降级/恢复层级）与 Side-Effect WAL 回放测试通过。
6. 评估台账/进化引擎三循环产出可验证（记账可查、演进产物逐轮可追溯）。
7. Python 旧版 `pytest` 回归全绿。

## 提交信息模板

```
feat(forgekin): Forgekin进化内核(印记/画像/蒸馏/五闭环/审议) [sherlock]
```
