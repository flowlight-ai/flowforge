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
- [ ] T7.8 `packages/forgekin/workflow-compiler`：YAML 工作流 → 执行图（TS 重写自
      core/workflow_compiler*.py，含条件路由/字段门控）
- [ ] T7.9 `packages/forgekin/external-agents`：EAC 七契约外部 agent 适配器（TS 重写自
      forgemind/external_agents.py + helm_adapter.py），桥接 limb 域
- [ ] T7.10 `packages/forgekin/harness`：7 层 harness 工程（durable_state/tool_mediation/
      evidence_sensors/governance/magic_words/entropy_control/harnessability）
- [ ] T7.11 `packages/forgekin/plugins`：插件市场 + 前端插件（桥接 chat marketplace）
- [ ] T7.12 `packages/forgekin/observability`：追踪/指标/事件总线
- [ ] T7.13 测试：YAML 注册 Forgekin → 五闭环各跑通 mock 演进；跨厂商审议拒绝同厂商；
      工作流编译器 DAG 执行；SpiritForge 蒸馏入库可检索
- [ ] T7.14 `packages/forgekin/magic-words`：魔法词（TS 重写自 `forgemind/magic_words.py`，F15）
- [ ] T7.15 `packages/forgekin/swarm`：群聊编排（`forgemind/swarm.py` + `config/agent_swarm.yaml`，F16）
- [ ] T7.16 `packages/forgekin/im-council` + `packages/chat/channels`：IM 议会 + 通道管理
      （`core/im_council.py` + `channel_manager.py`，F17；IM 通道 stretch 时仅 ports，A2A 域独立 `packages/a2a`）
- [ ] T7.17 `packages/cats/teamact`：TeamAct 转向（`core/teamact/` + `config/teamact_steer.yaml`，F18；
      与 `packages/chat/approval` 打通）
- [ ] T7.18 `packages/forgekin/eval-ledger`：评估台账 + 评估契约/三信号交叉/归因矩阵
      （`evolution/eval_ledger.py` + `core/eval/`，F19/F41）
- [ ] T7.19 `packages/forgekin/autonomous` + `packages/forgekin/auto-dream`：自主进化 + 梦境回放
      （`forgemind/autonomous.py` + `evolution/auto_dream.py`，F20）
- [ ] T7.20 `packages/forgekin/evolution-engine`：进化引擎三循环
      （`evolution/{engine,foreman,runtime,qc_loop,close_gate,process_evolution,scope_guard,metacognition,models}.py`，F22）
- [ ] T7.21 `packages/plugins/resilience`：弹性栈（`core/{circuit_breaker,fallback_chain,degradation,recovery_tier,
      restart_recovery,checkpoint_*}.py` + `config/resilience.yaml|recovery_tiers.yaml`，F23）
- [ ] T7.22 `packages/forgekin/stores`：Side-Effect WAL + 记忆治理（F21/F39；事件写前日志）
- [x] T7.23 `packages/forgekin/knowledge`：MindCodex 检索三入口/消费加权排名/可检索（F38）
      （批次1：search/listByDomain/listByTag 三入口 + recordConsumption 消费加权，见 T7.4）
- [ ] T7.24 `packages/forgekin/sop`：SOP 标准作业程序（`sop/` + `config/sops/*.yaml`，F29）
- [ ] T7.25 `packages/forgekin/species` + `packages/forgekin/forging`：物种体系 + 锻造流水线
      （`forgemind/{base,forgekin,registry,species}.py` + `species_impl/` + `forging/`，F30/F31）
- [ ] T7.26 `packages/forgekin/trae-bridge`：Trae 桥（`config/trae_bridge.yaml` + `.trae_bridge/`，F32）
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
