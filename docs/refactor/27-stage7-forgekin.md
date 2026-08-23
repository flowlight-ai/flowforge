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
- [ ] T7.10 `packages/forgekin/harness`：7 层 harness 工程（durable_state/tool_mediation/
      evidence_sensors/governance/magic_words/entropy_control/harnessability）
- [ ] T7.11 `packages/forgekin/plugins`：插件市场 + 前端插件（桥接 chat marketplace）
- [ ] T7.12 `packages/forgekin/observability`：追踪/指标/事件总线
- [ ] T7.13 测试：YAML 注册 Forgekin → 五闭环各跑通 mock 演进；跨厂商审议拒绝同厂商；
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
- [ ] T7.16 `packages/forgekin/im-council` + `packages/chat/channels`：IM 议会 + 通道管理
      （`core/im_council.py` + `channel_manager.py`，F17；IM 通道 stretch 时仅 ports，A2A 域独立 `packages/a2a`）
- [ ] T7.17 `packages/cats/teamact`：TeamAct 转向（`core/teamact/` + `config/teamact_steer.yaml`，F18；
      与 `packages/chat/approval` 打通）
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
- [ ] T7.20 `packages/forgekin/evolution-engine`：进化引擎三循环
      （`evolution/{engine,foreman,runtime,qc_loop,close_gate,process_evolution,scope_guard,metacognition,models}.py`，F22）
- [x] T7.21 `packages/plugins/resilience`：弹性栈（`core/{circuit_breaker,fallback_chain,degradation,recovery_tier,
      restart_recovery,checkpoint_*}.py` + `config/resilience.yaml|recovery_tiers.yaml`，F23）
      （批次9：在阶段2 基础核心（熔断/回退链/降级决策树/恢复层级/重启恢复）之上补齐 —
      ResilienceExecutor P3-005 灾备执行器（三级恢复执行 + 回退链降级）+
      CheckpointConfig YAML 配置加载与校验 + ResilienceService Cordis 插件化
      挂载 `ctx.forgeResilience`（decisionTree/executor/checkpoint 门面），58 测试）
- [ ] T7.22 `packages/forgekin/stores`：Side-Effect WAL + 记忆治理（F21/F39；事件写前日志）
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
- [ ] T7.27 `packages/forgekin/harness-eval`：harness-eval 控制面（F36；对照 clowder C32 16 域评估）
- [ ] T7.28 `packages/forgekin/roles`：特种角色子代理（产品经理/DevOps/安全官/交付经理，F43）
- [ ] T7.29 测试：魔法词触发/群编排/IM 议会拒绝同通道/评估台账记账/进化引擎三循环演进/
      弹性栈故障注入恢复/检索排序/锻造流水线产物验收

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
