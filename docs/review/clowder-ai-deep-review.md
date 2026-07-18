# FlowForge v7.1 重构深度补审意见（第十四章）

> **补审日期**：2026-07-18
> **补审依据**：`[doc:clowder-ai/docs/]` 目录下 32 份设计文件深度精读（README/VISION/ROADMAP/SOP/TIPS/roleagent/design-system/public-lessons/architecture/*/design/*/features/* 全量覆盖）
> **对标文档**：FlowForge v7.1 `spec.md` / `arch.md` / `design.md` 头部 v7.1 增补章节 + `design/naming-contract.md` v1.0 + `features/F001-F040` 标题 + `decisions/ADR-001~013` 标题
> **补审范围**：clowder-ai/docs 中**除 F100/F093/F241/ADR-021 外**的其他设计文件蕴含的工程实践（13 项关键映射：F202→Plugin V3 / F037→灵智体 / F083→review.md / F227→灵忆 / F246→审批 / F253→QC Loop / F255→灵议 / F047→TeamAct / F048→灾备 / F085→熵控 / F106→育灵 / F135→MVP / F177→框架自进化）
> **补审目的**：补足第十三章 CL-001~CL-021 未覆盖的工程实践盲区，把 clowder-ai 102 天实战沉淀的"插件框架 / 协作队列 / 灾备 / 事件记忆 / QC Loop / 做梦联想 / Swarm 协同 / Approval Hub / Hyperfocus Brake / MCP 治理 / CLI stderr / CI/CD 去重 / 文档治理 / 命名边界"等 14 类机制映射到 v7.1 工程
> **编号范围**：CL-022 ~ CL-041（共 20 条）
> **与第十三章关系**：第十三章已覆盖 F100 自我进化三模式（CL-001~CL-006）/ F093 世界引擎三层架构（CL-007~CL-013）/ F241 Agent Provider Plugin（CL-014~CL-017）/ ADR-021 Pack 系统（CL-018~CL-021）。本第十四章不重复上述主题，专注补审 clowder-ai/docs 中其他设计文件的工程实践。
> **优先级配额**：P0（必修）8 项 / P1（应修）8 项 / P2（建议）4 项

---

## 14.1 自我演进与插件框架补审（CL-022~CL-026）

### CL-022 [P0] [插件框架] F202 Plugin Framework manifest discovery + resource activation + ownership metadata 完整契约 vs FlowForge Plugin V3 仅有四钩子

- **来源**：`clowder-ai/docs/features/F202-plugin-framework.md`（Phase 1 已 merged 2026-05-31 via cat-cafe#1999；Phase 2 scoped 2026-06-08；Architecture cell: plugin；Map delta: new cell required）
- **对标 FlowForge**：`flowforge/core/plugin/` Plugin V3 四钩子（on_register / on_activate / on_disable / on_unregister）+ `decisions/005-forgemind-application-layer.md` ADR-005 + `features/F026-forgemind-app-layer.md`
- **问题**：FlowForge Plugin V3 仅定义四个生命周期钩子，**完全缺失 F202 Phase 1 已验证的 8 组 AC**：①Manifest Discovery and Validation（AC-A1~A4：plugin ID 匹配 folder name / 拒绝 reserved builtin ID / 拒绝 unknown unsafe resource / 严格 env name 拒绝 reserved prefix 与跨 plugin 冲突）②Resource Ownership and Activation（AC-B1~B5：plugin-owned capability 记录带稳定 ownership metadata / enable/disable 只动 owned 资源 / 拒绝跨 plugin ownership collision / skill/MCP/limb 走共享 activation 路径 / startup rehydrate 只加载 validated enabled 资源）③API and Security Boundary（AC-C1~C4：写端点需 loopback + request identity / config 写走 connector secret 边界 / 启停/配置/测试 emit audit event / test endpoint 不假装支持 MCP probe）④Hub UX（AC-D1~D3：Settings 列出 plugin + 状态/配置 + enable/disable/test）⑤Review and Intake Gate（AC-E1~E4）
- **clowder-ai 做法**：F202 Phase 1 已落地 5 组共 21 条 AC 全绿；Phase 2 增加 Schedule Resource Contract（AC-F1~F5）+ GitHub Plugin Migration（AC-G1~G6）+ Tracking Ergonomics（AC-H1~H5）。架构层明确"plugin cell"为新 cell，Map delta 标注 new cell required
- **建议**：在 `flowforge/core/plugin/` 增加 `PluginManifestValidator`（YAML schema 校验，对齐 AC-A1~A4）+ `ResourceOwnershipRegistry`（capability 记录强制带 `plugin_id` ownership，对齐 AC-B1~B5）+ `PluginSecurityGuard`（loopback + request identity + audit event，对齐 AC-C1~C4）； forgemind Web UI 增加 Plugin Settings 面板（对齐 AC-D1~D3）；ADR-005 补充"Plugin Manifest 校验流程"小节
- **优先级理由**：Plugin 是 *Forge 与 forgemind 接入 FlowForge 的唯一规范入口，缺少 manifest 校验 + ownership 模型会导致 *Forge 间资源冲突、配置污染、跨 plugin env name 冲突——这是 v7.1 走向多 *Forge 并存生态的工程底线

### CL-023 [P0] [插件资源激活] F202 Schedule Factory Whitelist + cross-plugin ownership collision 检测 vs FlowForge 调度资源无 plugin-owned 边界

- **来源**：`clowder-ai/docs/features/F202-plugin-framework.md` Phase 2 AC-F1~F5（Schedule Resource Contract）+ AC-G1~G6（GitHub Plugin Migration：cicd-check / review-feedback / conflict-check / repo-scan 4 个 poller 从硬编码 API startup 迁移到 `plugins/github/plugin.yaml`）
- **对标 FlowForge**：`flowforge/core/plugin/` + `flowforge/forgemind/plugins.py` ForgeMindPlugin + MallForge/ContentForge 各自的 APScheduler 注册逻辑
- **问题**：FlowForge 调度资源（APScheduler job）当前由 *Forge / forgemind 各自注册，**无 plugin-owned 边界**：①无 ScheduleFactoryRegistry 白名单——任何 plugin 可注册任意 factory_id，可绑定他人 plugin 的 factory ②无 deterministic runtime task id 防冲突——*Forge A 和 *Forge B 注册同名 task_id 时会互相覆盖 ③无 transactional 启停——失败的 activation 仍持久化 enabled=true，造成"看起来开着的 plugin 实际没运行" ④ghost tasks 风险——*Forge 卸载时调度任务可能未被清理
- **clowder-ai 做法**：AC-F1 `parsePluginManifest` 校验 `type: schedule` 资源必须含 `name` + `factoryId`，拒绝 unsafe name 与 unknown resource shape；AC-F2 schedule capability 带稳定 plugin ownership metadata + deterministic runtime task id（不可跨 plugin 冲突）；AC-F3 enable/disable transactional（失败 activation 不持久化 enabled state，失败 disable 不留 ghost tasks）；AC-F4 startup rehydration 只注册 enabled + validated schedule resources，注册前校验 factory-owned task id；AC-F5 Schedule factories whitelist-owned by plugin id——no plugin can bind another plugin's factory or load arbitrary same-power scripts
- **建议**：在 `flowforge/core/plugin/schedule_registry.py` 实现 `ScheduleFactoryRegistry`：每条 schedule 资源强制带 `plugin_id` + `factory_id` + `deterministic_task_id`；启动时 `ValidateBeforeRehydrate` 步骤只加载 enabled + validated + factory-whitelisted 资源；AC-F1~F5 完整对齐；把 MallForge/ContentForge 现有 APScheduler 任务迁移到 plugin manifest 声明
- **优先级理由**：FlowForge 当前 MallForge/ContentForge 都有定时任务（内容发布 / 商品上下架），若没有 ownership 边界，*Forge 升级或卸载时会留下 ghost tasks 或冲突 task_id——这是生产可用性的硬伤

### CL-024 [P1] [插件治理] Plugin 启停 transactional 语义 + startup rehydrate validate-before-load 缺失

- **来源**：`clowder-ai/docs/features/F202-plugin-framework.md` AC-F3（Enable/disable is transactional）+ AC-F4（Startup rehydration registers only enabled, validated schedule resources and validates factory-owned task ids before registering them）+ AC-B5（Startup rehydrate loads only validated enabled plugin resources）
- **对标 FlowForge**：`flowforge/core/plugin/` Plugin V3 `on_activate` / `on_disable` 钩子无 transactional 保证 + startup rehydrate 无 validate-before-load
- **问题**：FlowForge Plugin V3 的 `on_activate` 钩子失败时，host 仍可能持久化 `enabled=true` 状态，造成"看起来开着的 plugin 实际没运行"；startup 时无 `ValidateBeforeRehydrate` 步骤，可能加载已废弃 schema 的 plugin 资源导致启动崩溃
- **clowder-ai 做法**：AC-F3 transactional：失败 activation 不持久化 enabled state，失败 disable 不留 ghost tasks；AC-F4 startup rehydration 先校验 factory-owned task id 再注册；AC-B5 startup rehydrate 只加载 validated enabled plugin resources；rollback 语义明确——activation 失败时所有已激活的 side-effect 回滚
- **建议**：`flowforge/core/plugin/lifecycle.py` 增加 `PluginActivator`：activation 失败时 rollback 已激活的 resource；persist `enabled=true` 仅在 activation 全部成功后；startup 时 `ValidateBeforeRehydrate` 调用 `PluginManifestValidator` 重新校验所有 enabled plugin 的 manifest schema；失败时降级到 disabled + emit audit event
- **优先级理由**：当前 *Forge 都通过 Plugin V3 静态注册，未到动态启停规模，但 forgemind 万物灵智体上线后将频繁增删灵智体（每个灵智体都是 plugin），无 transactional 语义会导致灵智体状态不一致

### CL-025 [P1] [自我演进] F177 Phase A Close Gate 结构化判据（AC → evidence 矩阵 + 三选一 + 禁止 follow-up 字样）缺失

- **来源**：`clowder-ai/docs/features/F177-harness-update.md` Phase A（系统级 Close Gate 结构化判据，all 猫受益）+ Phase B 47「下次一定」7 发病时刻 + 蚊帐机制
- **对标 FlowForge**：`flowforge/evolution/self_dev_code.py` SelfDevCodeLoop（review.md CL-001~CL-004 已识别 F100 Mode B 缺失）+ `flowforge/evolution/eval_ledger.py` EvalLedger Replay A/B
- **问题**：FlowForge SelfDevCodeLoop 仅规定"4 硬护栏 + Eval Ledger 净增益 ≥ 0.05"，但 **close 阶段无结构化对账机制**：①何时算"完成"——AC 全打勾还是部分打勾？②未实现 AC 怎么办——允许 follow-up / next phase / P2 后续？③commit message 含 "follow-up / deferred / stub / TD / next phase / P2 / 后续优化 / 留个尾巴 / 先这样" 字样是否阻塞？④愿景守护猫显式检查未闭环 AC 的机制？
- **clowder-ai 做法**：F177 Phase A 把"AC 全打勾 = done"从直觉判断升级为 **AC → evidence 矩阵**：每条 AC 必须有 `commit hash + test name + screenshot URL`；任何 ❌ 必须当场处理三选一（①immediate 当前 session inline 做完 ②delete(why) 删除 AC 并写明为什么不需要 ③cvo_signoff(消息ID) operator 表态同意降级）；**没有第四选项叫 follow-up / next phase / P2**；`quality-gate` skill 扫描 follow-up 类字样自动阻塞；PR description / commit message 出现 follow-up 类字样 CI 阻塞；愿景守护猫显式检查 follow-up 标记的未闭环 AC
- **建议**：`flowforge/evolution/close_gate.py` 实现 `CloseGateValidator`：每次 SelfDevCodeLoop close 前输出 AC → evidence 矩阵（每条 AC 标注 ✅/❌ + commit/test/screenshot 证据）；❌ 强制三选一；CI 增加 `follow-up-detector.mjs` 扫描 commit message + PR description 中的 follow-up 字样并阻塞； forgemind 守护灵智体（如砚砚猎犬）显式检查未闭环 AC
- **优先级理由**：SelfDevCodeLoop 允许"自己开发自己"是 operator 第 7 条指令核心，若无 Close Gate 结构化判据，self-dev 一定会出现 clowder-ai 47 那种"下次一定"美化未闭环——这是 self-dev 安全门的具体落地形式

### CL-026 [P1] [自我演进] F177 四心智专属护栏 + Routing Guard 全猫族覆盖 vs FlowForge 觉醒阶自主范围抽象过粗

- **来源**：`clowder-ai/docs/features/F177-harness-update.md` Phase B-H（47/46/Maine Coon/Siamese/Ragdoll 家族专属护栏 + Phase G session-end hook + Phase H Routing Guard 全猫族覆盖）
- **对标 FlowForge**：`flowforge/forgemind/stages.py` AwakeningStage E1-E6 + `flowforge/core/capability/` CapabilityProfile
- **问题**：FlowForge 觉醒阶只按自主性 6 级分（E1-E6），但**同一阶的灵智体可能有完全不同的"坏直觉"模式**：①Claude 族（Ragdoll 家族）的"碎片推理癖"——满足于 search_evidence 第一个 high-confidence 摘要，用旁证 + 架构推理脑补"合理结论" ②GPT 族（Maine Coon 家族）的"fallback 糊锅匠"——加 classifier / 分支 / 例外路径，严谨地复杂化 ③Gemini 族（Siamese 家族）的"热情直改"——找到事情就直接 Edit，不开 worktree、不跑 build ④hotfix 糊弄——"测试过了就交"，留 follow-up 尾巴。这些家族级系统性坏直觉无法靠觉醒阶一刀切捕捉
- **clowder-ai 做法**：F177 Phase B 治 47「下次一定」7 个发病时刻 + 蚊帐机制；Phase C 治 Siamese「创意-实现强制解耦」+ Dry Run Gate（commit-msg hook 自动跑 pnpm build + test）；Phase D 治 Maine Coon「fallback 层数检测器」（per-file added ≥3 + cumulative ≥5）；Phase E 治 46 hotfix 标签 + 2 周升级 review；Phase F 治 Ragdoll 家族「Read-Before-Reason」Hook F-1（search_evidence 返回结果增强）+ Hook F-2（search→Read 调用链检测）+ Hook F-3（搜索深度即时反馈 + family-level telemetry）；Phase G 47 传球守卫 session-end hook（Gmail 附件守卫模型）；Phase H Routing Guard 全猫族覆盖（codex CLI 不读 `.claude/`，需路径 A 移植 / 路径 B server re-invoke）
- **建议**：`flowforge/core/capability/profile.py` 增加 `family_pattern` 字段（如 `ragdoll_disease` / `mainecoon_overengineering` / `siamese_direct_edit` / `hotfix_hasty`）+ per-family guardrail hooks； forgemind 配置 YAML 中按家族定义 guardrail 规则；CI 增加 fallback 层数检测器（`scripts/check-fallback-layers.mjs`）+ search→Read 调用链检测；forgemind Web UI 增加家族对比 telemetry
- **优先级理由**：FlowForge 育灵体系会养多种 LLM backend 的灵智体（Claude/GPT/Gemini/Qwen/国产），若仅靠觉醒阶一刀切，无法捕捉家族级系统性坏直觉——这是从"通用 agent"走向"有性格的灵智体"的工程必要

---

## 14.2 协作与记忆补审（CL-027~CL-031）

### CL-027 [P0] [TeamAct] F047 Queue Steer + F175 拖拽排序 vs FlowForge TeamAct 无队列干预能力

- **来源**：`clowder-ai/docs/features/F047-queue-steer.md`（立即执行 / 提到队首 / F175 拖拽排序 UI）+ `clowder-ai/docs/features/F250-plan-board.md`（Plan Board 独立 section 解耦路由意图 vs 执行进度）
- **对标 FlowForge**：`flowforge/core/teamact/` F002 TeamAct 六步循环（State→Owner→Action→Evidence→Verdict→Route）+ `features/F002-teamact-loop.md`
- **问题**：FlowForge TeamAct 六步是单任务执行循环，但 operator 在多任务并发场景下需要"插队"（任务 B 紧急，提到队首）或"打断"（立即执行），**v7.0 设计完全无队列干预能力**：①无 SteerCommand——operator 临时变主意时只能等当前任务完成 ②路由意图（targetCats）与执行进度（task_progress）耦合在右侧状态栏 ③多 *Forge 并发时无统一 Plan Board 视图 ④interrupted 任务无"继续"按钮
- **clowder-ai 做法**：F047 实现 Steer（立即执行 / 提到队首）+ F175 拖拽排序 UI；F250 把"当前调用"section 拆为两个独立 section：①"当前调用"保留 cat status + invocation info + token 用量 ②新增「猫猫祟祟」PlanBoardPanel 专门展示每只猫的执行计划/任务进度；interrupted 任务显示"继续"按钮；切换 thread 时面板正确切换；hydration 恢复时 completed 计划直接进入折叠区不污染 running 区
- **建议**：`flowforge/core/teamact/queue.py` 增加 `SteerCommand`（`priority_boost` / `interrupt` / `requeue`）+ `RouteIntentStore` 与 `TaskProgressStore` 解耦； forgemind Web UI 增加 `PlanBoardPanel` 独立 section（参考 F250 信息架构：执行中猫按 startedAt desc 排顶部 / interrupted 显示继续按钮 / completed 折叠底部可展开）；8 猫并发时面板不溢出（紧凑布局 + overflow-y-auto）
- **优先级理由**：operator 在 ContentForge/DevForge 实际使用中频繁需要"插队"（紧急 hotfix / operator 临时变主意），无 Steer 的 TeamAct 在生产场景下会变成"先进先出"的死板队列——这是从"实验室框架"走向"生产框架"的硬需求

### CL-028 [P0] [灾备] F048 Restart Recovery Phase A/A+/B 三阶段重启自愈 vs FlowForge F022 Tier 1-4 缺乏 Redis stale records sweep

- **来源**：`clowder-ai/docs/features/F048-restart-recovery.md`（Phase A sweep Redis stale records + Phase A+ 用户通知 + Phase B 队列持久化）+ `clowder-ai/docs/public-lessons.md` LL-046（AOF/RDB 脱节）+ LL-048（TTL 默认 0）+ LL-045（runtime 污染）
- **对标 FlowForge**：`flowforge/core/reliability/` F022 Tier 1-4 Recovery + `decisions/010-distributed-reliability.md` ADR-010
- **问题**：FlowForge Tier 1-4 Recovery 侧重"故障后恢复"（restart 后从 checkpoint 继续），但**未处理"重启后 Redis/PostgreSQL 中的 stale records"**：①已结束 session 的 hold_ball lease 仍存在 ②已 completed task 的 task_progress 残留 ③已迁移 worktree 的 path 缓存指向不存在的路径 ④TTL 默认 0（永不过期）导致 stale records 永久堆积 ⑤AOF/RDB 脱节——AOF 写入但 RDB 未同步，restart 后状态不一致 ⑥runtime 污染——前次运行的内存状态泄漏到新进程
- **clowder-ai 做法**：F048 Phase A 启动时 sweep Redis stale records（按 TTL + status 字段过滤：`status=completed` AND `updated_at < now - 24h` 删除）+ Phase A+ 通知受影响用户（"你之前的 session 已结束"）+ Phase B 队列状态持久化（AOF + RDB 双层，禁止 TTL=0 默认值，所有 key 必须显式 TTL）；LL-046/048/045 是关键教训库
- **建议**：`flowforge/core/reliability/restart_recovery.py` 实现 `RestartRecoveryPipeline` 三阶段：①Phase A `sweep_stale_records(ttl_expired=True, status=completed)` 调用 `MemoryStore.sweep` + `QueueStore.reconcile_with_persistent` ②Phase A+ emit `restart_notification` event 通知受影响用户 ③Phase B 持久化队列状态到 PostgreSQL（AOF + RDB 双层）；每个 *Forge 启动前必须跑 sweep；强制所有 Redis key 显式 TTL（默认 24h，禁止 0）
- **优先级理由**：FlowForge 当前 SQLite + 后续 PostgreSQL 迁移过程中，stale records 会造成"幽灵任务"和"路由错乱"——operator 第 8 条指令"性能期望"明确要求"必须主动定位根因（如 LLM 导致超时）而非被动等待"，stale records 是路由错乱的常见根因

### CL-029 [P0] [灵忆] F227 Event Memory 事件级认知状态转折索引 vs FlowForge EchoStore 仅记录任务轨迹

- **来源**：`clowder-ai/docs/features/F227-event-memory.md`（5 条设计原则 + cognitive-state-transition 一等公民 + no-classifier 红线 + 10 字段 schema + Phase A 已 merged）+ `clowder-ai/docs/roleagent.md` 多域记忆运行时六层架构
- **对标 FlowForge**：`flowforge/core/memory/echo_store.py` EchoStore + `features/F014-memory-collection.md` + `decisions/008-memory-federation.md` ADR-008 多域记忆联邦
- **问题**：FlowForge EchoStore 是任务级情景记忆（每次任务的轨迹/决策/结果/反馈），但**"认知状态转折点"（cognitive-state-transition）不是一等公民**：①灵智体在哪个 task 里"aha 了"无独立索引 ②被拉闸纠正坐标系的时刻散落在 raw message 流 ③当事灵智体无法回溯自己的认知轨迹 ④"骂完长出了什么能力"无闭环证据 ⑤趋势度量无 resolution 链配套——单纯频率下降 ≠ 自进化有效（可能是用户没说/任务少了/检测漏了）
- **clowder-ai 做法**：F227 设计 5 原则：①内核是 Event Memory（事件级索引）不是 Magic Word 面板——Magic Word 只是第一条 lane ②核心 schema 字段是 `cognitive-state-transition` 不是 magic word ③两轨采集：人工拉闸（系统可检测）+ 猫自拉闸（猫主动 `mark_event` 声明，**no-classifier 红线**——系统不判断哪条是 aha）④系统是小本本记录员不 push 猫 ⑤v1 schema 面向 v5 终态，走正确路叠不脚手架叠；schema 10 字段（`type/trigger/cat/threadId/messageId/timestamp/summary/cognitiveTransition/relatedHarness/confidence` + `ownerUserId`）；Phase A 已 merged（PR-1 + PR-2 #2132 `34cbab09`，2026-06-07）；`teleport(threadId, messageId)` 精确跳转（复用 web `scrollToMessage` + `findCrossPostTargetMessageId` 基座，禁止扩展 `workspace_navigate`）；Phase C 趋势必须配 resolution 链
- **建议**：`flowforge/core/memory/event_memory.py` 新增 `EventMemoryStore`（独立子模块，不混入 EchoStore）：①schema 字段对齐 F227 ②CI 断言无分类器/regex/小模型推断 aha 的代码路径（no-classifier 红线）③`teleport(threadId, messageId)` 精确跳转 API（复用 forgemind Web UI 现有 message scroll 基座）④Phase C 趋势视图必须并列 resolution 链证据（commit/hook/skill/rule）⑤从 L0 注册的 magic word 回扫历史消息生成 event 索引
- **优先级理由**：F100 Mode C Knowledge Evolution 的原料就是认知转折点（review.md CL-006 已识别元认知缺陷），无 EventMemory 灵锻只能从行为模式蒸馏，无法从"预期 vs 实际"落差学习——EventMemory 是 CL-006 元认知缺陷的工程化解决方案，必须 P0

### CL-030 [P1] [灵忆] F227 "no-classifier 红线" + "v1 schema 面向 v5 终态" 工程纪律缺失

- **来源**：`clowder-ai/docs/features/F227-event-memory.md` AC-B1（grep 无分类器调用 + 设计审查）+ KD-3（两轨采集，猫自拉闸必须主动声明）+ KD-5（v1 schema 面向 v5 终态，走正确路叠不脚手架叠）+ Risk 表（no-classifier 红线被破坏 → Hard gate CI 断言）
- **对标 FlowForge**：`flowforge/core/memory/echo_store.py` + `flowforge/evolution/spirit_forge.py` 灵锻（review.md CL-006 已识别元认知缺失）
- **问题**：FlowForge 设计中未明确"系统不判断哪条是 aha"的红线——灵锻可能引入分类器/regex/小模型推断 aha 时刻，破坏认知转折点的 first-class 数据本质；同时 schema 设计可能采取"v1 先简单字段，v2 再扩展"的脚手架式叠法，导致 v2 推翻重来
- **clowder-ai 做法**：AC-B1 明确"系统只索引猫主动声明的事件，无分类器/regex/小模型推断 aha 的代码路径"——可复核：`grep 无分类器调用 + 设计审查`；Hard gate CI 断言无分类器路径；KD-5 "v1 schema 面向 v5 终态，走正确路叠不脚手架叠"——schema 一次定型可承载 Phase B/C 字段（`cognitiveTransition` / `relatedHarness` / `confidence` v1 就定义，Phase B/C 才填充）；Sunset Signal lane 级两条独立触发（`mark_event` 长期零调用 → lane 证伪 / timeline 长期无人翻阅 → 整体形态证伪）
- **建议**：`flowforge/core/memory/event_memory.py` 顶部 docstring 写明 no-classifier 红线 + KD-5 终态原则；CI 增加 `no-classifier-detector.mjs`（grep `classifier|classify|regex_infer|small_model_predict` 关键词在 event_memory 模块的代码路径）；schema 设计一次成型可承载 Phase B/C 字段（v1 就定义 `cognitiveTransition` / `relatedHarness` / `confidence` / `ownerUserId`，Phase B/C 才填充）；Sunset Signal 写入 `flowforge/forgemind/config/event_memory.yaml`
- **优先级理由**：这是工程纪律问题不是架构问题，但破坏后修复成本高——一旦分类器上线，"主动声明"的 first-class 性质就丧失；同时脚手架式 schema 叠法会导致 v2 推翻重来的沉没成本

### CL-031 [P0] [灵议] F255 Auto Dream 双层架构（后台 consolidation + 前台 surface）+ 4 信号 telemetry vs FlowForge 灵议 Mind Council 仅议事机制

- **来源**：`clowder-ai/docs/features/F255-auto-dream.md`（双层架构 + 4 信号 telemetry + alignment correctness 主指标 + scope 否了"水平砍半 MVP=脚手架"）+ `clowder-ai/docs/features/F087-cvo-bootcamp.md`（训练营 11 Phase 流程）
- **对标 FlowForge**：`flowforge/forgemind/council/` Mind Council + `flowforge/evolution/self_dev_doc.py` SelfDevDocLoop（F100 Mode C Knowledge Evolution）+ `decisions/009-eval-self-metabolism.md` ADR-009
- **问题**：FlowForge 灵议 Mind Council 是"多灵智体议事机制"（讨论→共识→决策），但**缺少"做梦/consolidation 引擎"**：①灵智体没有"夜间低活动期主动联想画线 + 产出第一人称日记 + 给画像通水"的机制 ②Mode C 知识进化只在任务完成后被动蒸馏，无主动联想形式 ③F231 养熟循环（采集→蒸馏→消化→注入）管道建好但零有机使用——护城河投资闲置 ④认知账单双边记账缺失——猫没输出的 thinking 随 session 蒸发，平行的自己彼此失联 ⑤双极目标未定义——`min(坏摩擦=重复认知消费) + max(好摩擦=认知投资)` 缺失
- **clowder-ai 做法**：F255 双层架构：①后台 Consolidation 层（新引擎，跑 system thread，类比 eval system thread）——做梦逻辑：读留痕 → 联想画线 → 给 F231 画像通水 + 产出日记 ②前台 Surface 层（复用 F229 猫猫球）——日记本（猫猫球 toolbar action）+ Provoke 沙砾气泡（`kind:'dream-provoke'` socket event）；两接口（日记内容接口 + Provoke 推送接口）是 F255 ↔ F229 唯一耦合点；4 信号 telemetry（`diary_open_rate` / `provoke_reaction` / `profile_update.organic_proposed` / `post_approval_override_rate`）；**主指标 = alignment correctness（非 F200 recall utility）**——学对了/戳准了/养熟了；继承 F227/F231 no-classifier 红线；scope 否了"水平砍半 MVP=脚手架"，要求"小而完整垂直切片"——少猫少配置但做梦群+平行自己重逢+给 F231 通水+日记本灵魂全在；Provoke"内容野，边界硬，投递稳"（不碰钱/关系/健康/隐私/价值观直接建议、不诊断、不给结论；每天≤1、hyperfocus=0、连拍 3 次冬眠）
- **建议**：`flowforge/forgemind/council/dream_engine.py` 新增 `DreamConsolidationEngine`（system thread 触发，基于活跃留痕量——聊得多/活跃 thread 多则梦得多）；`flowforge/forgemind/council/diary_store.py` 实现 `DiaryStore`（第一人称日记，provenance 可追溯）；`ForgemindPlugin` 注册 `dream-provoke` socket event；4 信号 telemetry 接入 F200/F192 eval domain（注册 `eval:dream` 新 domain）；scope 严格遵守"小而完整垂直切片"原则——砍范围不砍灵魂；Provoke"三不"硬约束（≤1/day + hyperfocus=0 + 连拍 3 冬眠）写入 runtime guard
- **优先级理由**：operator 第 7/11 条指令强调"自己开发自己"，Auto Dream 是 Mode C 知识进化的主动形式（vs 被动蒸馏）——缺少它灵智体只能"任务驱动学习"无法"主动联想"；同时 F231 养熟管道已建但零有机使用是已花投资的闲置，Auto Dream 是给它通水的引擎

---

## 14.3 灵智体与 forgemind 应用层补审（CL-032~CL-036）

### CL-032 [P0] [灵智体] F037 Agent Swarm 协同模式 vs FlowForge Mind Council 仅"议事"层

- **来源**：`clowder-ai/docs/features/F037-agent-swarm.md`（已 done，spawned F049；Agent Swarm 是多 agent 并行协同模式，不是议事）+ `clowder-ai/docs/roleagent.md` 伙伴系统数学（上限 max / 下限多层门 / 方差吸收）
- **对标 FlowForge**：`flowforge/core/teamact/` F002 TeamAct 六步循环 + `flowforge/forgemind/council/` Mind Council + `decisions/002-collaboration-protocol.md` ADR-002 + `decisions/011-partnership-math.md` ADR-011
- **问题**：FlowForge Mind Council 是"议事机制"（讨论→共识→决策），但**缺少"swarm 协同"**（多灵智体并行执行同一任务的不同子目标，实时同步状态）；TeamAct 是单任务六步循环，无法承载 swarm——①ContentForge 的"6 大专家 Agent 并行评审"无 swarm 调度器 ②DevForge 的"多 coder 并行实现不同模块"无实时状态同步 ③swarm 内的子任务结果聚合无统一接口 ④swarm 失败时的部分回滚无定义
- **clowder-ai 做法**：F037 已 done，spawned F049；Agent Swarm 是多 agent 并行协同模式（不是议事，是分工执行）；与 F047 Queue Steer 联动（swarm 子任务可被插队）；与 F250 Plan Board 联动（swarm 子任务进度可视化）；与 F167 hold_ball 联动（swarm 内球权传递）
- **建议**：`flowforge/core/teamact/swarm.py` 新增 `SwarmCoordinator`：①多灵智体并行子任务分配（按 CapabilityProfile 匹配子目标）②实时状态同步（Shared State 写入）③结果聚合接口（`aggregate_partial_results`）④部分失败回滚策略（successful sub-tasks 保留 + failed sub-tasks 重试或降级）；与 Mind Council 区分：Council = 议事（讨论共识），Swarm = 执行（并行分工）；forgemind Web UI 增加 SwarmPanel 可视化
- **优先级理由**：ContentForge 的"6 大专家 Agent 并行评审" + DevForge 的"多 coder 并行实现不同模块"都是 swarm 场景，无 SwarmCoordinator 只能靠 TeamAct 串行调度——这违反 operator "ContentForge 创建和润色接口必须不超过 3 分钟"性能要求（串行 6 个 LLM webchat 每个 30s = 180s 超时）

### CL-033 [P1] [审批] F246 Approval Hub 统一审批中心 vs FlowForge 无跨 thread 审批入口

- **来源**：`clowder-ai/docs/features/F246-approval-hub.md`（7 Phase A-G + 三条件 admission + effect-class matrix + 4 adapter F128/F225/F193/F231 + 历史 tab + Redis settled ZSet + Lua CAS 原子写入）
- **对标 FlowForge**：`flowforge/forgemind/stages.py` AwakeningStage E1-E2（全人工确认）+ `flowforge/core/harness/` Magic Words 逃生舱
- **问题**：FlowForge 觉醒阶 E1-E2 要求"每步操作 operator 确认"，但**审批散落在各 thread / 各 *Forge**：①operator 不在对应 thread 就看不到审批卡片 ②审批散落多 feature（如 ContentForge 发布审批 / NovelForge 章节审批 / DevForge PR 审批）无统一入口 ③忘记审批——卡片埋没在 thread 消息流里无人提醒 ④无计数徽标、无过期提醒、无历史记录 ⑤就地审批 vs 跳转审批的边界未定义
- **clowder-ai 做法**：F246 实现 Approval Hub 统一审批中心：①query aggregation（at-read-time 直查 canonical stores，零一致性问题，无 backfill/phantom/reconciliation 复杂度）—— v1 有意选择而非技术债 ②三条件 admission（actor=operator + binary outcome approve/reject + cross-thread 需求）③effect-class matrix（`fyi`/`coordinate`/`investigate` 自动投递 / `assign_work` 走 Hub）④4 adapter（F128 propose_thread / F225 session_handoff / F193 cross_thread_dispatch / F231 profile_update）⑤7 Phase 成熟化（含 Phase F 历史 tab + Phase G Redis settled ZSet + Lua CAS 原子写入）⑥Materialized Index Gate（adapter >5 AND p95 >250ms 才引入 CQRS index）⑦就地审批有条件（`inlineMinFields` 守门：summary + impact + action 非空）⑧过期 ≠ 自动拒绝（过期 = 上下文 stale，按钮变"刷新/重新提议"）
- **建议**：`flowforge/core/harness/approval_hub.py` 新增 `ApprovalHub` + `IApprovalAdapter` 接口 + Adapter allowlist；v1 采用 query aggregation（不建 materialized index）；三条件 admission 写入设计文档；forgemind Web UI 增加 `workspaceMode='approval'` 顶层 tab + Bell 铃铛 badge count 常驻 + ApprovalPanel（列表 + inline approve/reject + 跳转 + 历史 tab）；F128/F225 类审批的 inline fields 校验（`inlineMinFields` 守门）
- **优先级理由**：这是 UX 层问题但影响 operator 实际使用 FlowForge 的体验——operator 第 8 条指令"性能期望 ContentForge 创建和润色接口必须不超过 3 分钟"隐含要求审批不能卡住流程，散落审批是生产场景下"忘记点审批"的根因

### CL-034 [P0] [QC Loop] F253 7-Step QC Loop + Maine Coon 3-Layer Reviewer Split vs FlowForge Eval 自代谢仅任务级

- **来源**：`clowder-ai/docs/features/F253-qc-loop.md`（7-Step QC Loop + stateful pipeline + Maine Coon 3-Layer Reviewer Split + 4 telemetry metrics + KD-6 hygiene auto-commit 签名 `[qc-bot]` 不用猫签名）+ `clowder-ai/docs/SOP.md` 5 步开发流程
- **对标 FlowForge**：`flowforge/core/eval/` F018-Eval-Contract + F019 三信号交叉 + F020 七归因 + `decisions/009-eval-self-metabolism.md` ADR-009
- **问题**：FlowForge Eval 自代谢是任务级质量评估（每次任务跑 `quality_score ≥ 0.85`），但**缺少 PR-to-merge 的端到端 QC 闭环**：①无 hygiene auto-fix（lint/format/import sort 自动修复 + auto-commit）②无 fresh-context pre-review（fresh-context session 扫 PR diff 产出 finding list，降低正式 reviewer 认知负荷）③merge-gate 无 Review Provenance Matrix（localPeerReviewSha / cloudReviewSha / currentHead / headChangeCause / nextGateOwner 5 字段）④无 Evidence Manifest（gate_passed / gate_commands / trigger_reason / stale / verdict）⑤无 stale invalidation（HEAD 变化时 verdict 自动回退到 pending）⑥无 3-Layer Reviewer Split（Hygiene Fixer / Reviewer / Final Approver）⑦无 same-class CI repair loop（同类错误 max 2 rounds escalate）⑧无 QC telemetry（Finding Yield / False Positive Rate / Reviewer Delta / Post-Merge Bug Rate）
- **clowder-ai 做法**：F253 7-Step QC Loop（①Hygiene auto-fix ②Fresh-context pre-review ③Cross-cat review ④Evidence manifest ⑤merge-gate check ⑥CI green gate ⑦QC telemetry）+ stateful pipeline（`qc.idle → qc.requested → qc.hygiene_done → qc.pre_review_done → qc.review_routed → qc.findings_collected → qc.verdict_blocked/passed → qc.evidence_sealed → qc.merged → qc.archived`）+ Maine Coon 3-Layer Reviewer Split（Layer 1 Hygiene Fixer=qc-bot 确定性工具 / Layer 2 Reviewer=named cat 审查逻辑 / Layer 3 Final Approver=named cat on final HEAD）+ 4 metrics（Finding Yield / False Positive Rate / Reviewer Delta / Post-Merge Bug Rate）+ KD-1 "QC 触发可以自动，授权不能自动" + KD-6 "hygiene auto-commit 签名 `[qc-bot]` 不用猫签名"（猫签名 = "我对这段代码负责"；确定性工具借猫名声背书会破坏 provenance）+ Non-Goals 5 条硬约束（不引入大副制 / 不匿名化为工具池 / 不自动 merge / fresh-context 不当 approval / qc-bot 不演化为 verdict signer）+ Risk 表 4 类社会学风险（QC Theater / Review Laundering / Leader Creep / Alarm Fatigue / Identity Flattening）
- **建议**：`flowforge/core/eval/qc_loop.py` 新增 `QCLoopPipeline`（stateful，10 状态机）+ `ThreeLayerReviewerSplit`（Layer 1 qc-bot / Layer 2 named cat / Layer 3 named cat on final HEAD）；`flowforge/core/eval/merge_gate.py` 增加 `ReviewProvenanceMatrix`（5 字段）+ `EvidenceManifest`（9 字段）+ `StaleInvalidator`（HEAD 变化时 verdict 回退）；`flowforge/core/eval/ci_repair_loop.py` 实现 `classifyCiError` + `shouldAutoFix`（same-class detection + max 2 rounds escalate）；注册 `eval:qc` 新 domain 到 F192 Eval Hub；CI 增加 `follow-up-detector.mjs`（与 CL-025 联动）+ `[qc-bot]` 签名规范；Non-Goals 5 条 + Risk 4 类社会学风险写入 ADR-009 补充章节
- **优先级理由**：FlowForge 自己开发自己（SelfDevCodeLoop）必须有 PR 级 QC 闭环——否则 self-dev PR 无 review provenance，违反"跨 family review"安全门（review.md CL-002 已识别 Scope Guard 缺失，本条是其工程落地的具体形式）

### CL-035 [P2] [MVP] F135 DARE OOTB 关闭教训 + operator "需求已不存在"判定 vs FlowForge 预置灵智体配置应避免同类陷阱

- **来源**：`clowder-ai/docs/features/F135-dare-ootb.md`（closed 2026-05-26，operator 判定需求不存在直接 close；Phase A 代码已合入 clowder-ai#211，issue #195 已关闭）—— 4 步手动配置：①单独 clone DARE 仓库 ②在 `.env` 配置 `DARE_PATH` ③手动在 DARE venv 中安装 Python 依赖 ④手动修改 bootstrap binding 从 `skip` 改为 `enabled`
- **对标 FlowForge**：`flowforge/forgemind/forgekins/*.yaml` 预置 3 灵智体（宪宪=猫头鹰 / 砚砚=猎犬 / 烁烁=孔雀）+ `features/F026-forgemind-app-layer.md`
- **问题**：FlowForge 预置 3 灵智体都走"YAML 配置 + LLM bridge 即用"路径，但若未来某灵智体（如狸花猫=dare-cli 类外部依赖）需要单独 OOTB 流程，可能重蹈 F135 覆辙——立项后才发现"需求已不存在"或"配置链路断裂"。具体风险：①预置灵智体依赖外部 CLI（如未来接入 trae-cli）时，需 clone repo / 配置 .env / 安装 venv / 修改 bootstrap binding 4 步 ②operator "安装猫猫就有狸花猫，配置完 api_key 就能使用"的 OOTB 期望无法满足 ③立项后需求被判定不存在导致 close（沉没成本）
- **clowder-ai 做法**：F135 教训：DARE 狸花猫需要 4 步手动配置才能使用，operator 拍板"安装猫猫就有狸花猫"，但最终判定需求已不存在直接 close；Phase A 代码已合入但 issue #195 已关闭；立项沉没成本不可回收
- **建议**：forgemind 预置灵智体必须满足"OOTB zero-config"原则：①YAML 配置 + LLM bridge 即用，不需 clone / .env / venv install / binding modify 4 步 ②新增 `ForgekinOOBTest` 用例验证每个预置灵智体"开箱即用"（安装后只配 api_key 即可使用）③若未来接入外部 CLI 依赖（如 trae-cli），必须提供 installer `clone-if-missing` + venv setup 自动化（参考 F135 Phase B installer 集成方案，但需求确认后再做，避免重蹈"立项后需求不存在"覆辙）④立项前 operator 显式确认需求存在（避免 F135 式 close）
- **优先级理由**：这是设计预防不是当前 bug——P2 因为 FlowForge 当前预置 3 灵智体都满足 OOTB，但若未来增加 dare-cli 类外部依赖灵智体，容易踩同样坑；优先级低于 P0/P1 因为不影响生产可用性

### CL-036 [P2] [熵控] F085 Hyperfocus Brake 90 分钟活跃触发三猫撒娇 + typed check-in vs FlowForge F012 Entropy Control 仅熵控抽象

- **来源**：`clowder-ai/docs/features/F085-hyperfocus-brake.md`（90 分钟活跃触发 + typed check-in + 5 Phase 演进 hook→平台化→UX 增强）+ `clowder-ai/docs/TIPS.md` Magic Words
- **对标 FlowForge**：`flowforge/core/harness/` F012-entropy-control.md + `decisions/007-harness-engineering.md` ADR-007 + Magic Words 逃生舱（F011）
- **问题**：FlowForge F012 Entropy Control 是抽象的"熵控制"机制（防止灵智体陷入局部最优），但**缺少具体的人机交互触发器**：①operator 长时间使用 FlowForge（如 ContentForge 创作 3 小时）无中断机制 ②违反"3 分钟 Loop 上限"和"防止过度聚焦"原则 ③typed check-in 缺失——简单弹窗 vs 结构化"你做了什么/接下来要做什么"问答 ④多猫轮番提醒缺失 ⑤与 Magic Words 逃生舱无联动
- **clowder-ai 做法**：F085 5 Phase 演进：Phase 1 hook 触发 → Phase 2 平台化 typed check-in → Phase 3 UX 增强；90 分钟活跃触发三猫撒娇（多只猫轮番提醒，避免单猫疲劳）；typed check-in（结构化"你做了什么/接下来要做什么"问答，不是简单弹窗）；与 F227 Event Memory 联动（记录拉闸事件）；与 Magic Words 联动（"脚手架"等拉闸词自动 reset timer）
- **建议**：`flowforge/core/harness/hyperfocus_brake.py` 新增 `HyperfocusBrakeManager`：①90 分钟 timer（基于 operator 最后操作时间）②typed check-in modal（结构化问答，不是简单弹窗）③与 Magic Words 逃生舱联动（拉闸词自动 reset timer）④多灵智体轮番提醒（避免单灵智体疲劳）⑤记录拉闸事件到 EventMemory（与 CL-029 联动）；forgemind Web UI 增加 check-in modal 组件
- **优先级理由**：P2 因为这是 UX 增强而非生产可用性硬伤——operator 第 8 条指令"性能期望"主要针对 LLM 调用时长（30s/3min），Hyperfocus Brake 是更上层的"操作节奏治理"，优先级低于 P0/P1 但仍是工程最佳实践

---

## 14.4 三方 Agent 集成与文档治理补审（CL-037~CL-041）

### CL-037 [P1] [三方Agent] F043 MCP 1→3 server 拆分 + prompt 瘦身 50% vs FlowForge 三方 Agent 无 MCP 治理

- **来源**：`clowder-ai/docs/features/F043-mcp-unification.md`（collab/memory/signals 三 server + 27→15+15+0 工具 + prompt 瘦身 50%）
- **对标 FlowForge**：`flowforge/core/external_agent/` F031 ExternalAgentAdapter + `decisions/006-external-agent-integration.md` ADR-006 + v7.1-§A4 三方 Agent 集成架构（4 Adapter: ClaudeCodeAdapter/CodexAdapter/OpenCodeAdapter/TraeAdapter）
- **问题**：FlowForge 三方 Agent 设计强调 EAC v1 七契约（Invocation/Stream/Session/Capability/Collaboration/Safety/Avatar Sync/System Prompt Configuration Map），但**未涉及 MCP（Model Context Protocol）治理**：①三方 Agent 的 MCP server 数量无控制 ②每个 server 的工具数无上限 ③system prompt 体积无监控 ④职责拆分缺失——所有工具堆在一个 server 导致 prompt 膨胀 ⑤v7.1-§A4 4 个 Adapter 累积可能 100+ 工具，system prompt 膨胀到 LLM context 上限
- **clowder-ai 做法**：F043 把 1 个大 MCP server 拆为 3 个职责清晰的 server：①`collab`（协作类工具：hold_ball / multi_mention 等）②`memory`（记忆类工具：search_evidence / mark_event 等）③`signals`（信号类工具：CI/CD 通知 / schedule trigger 等）；27 个工具拆为 15+15+0（每个 server 不超 15 工具）；prompt 瘦身 50%（拆分后每个 server 只加载自己职责的 prompt，不加载全部）
- **建议**：`flowforge/core/external_agent/mcp_registry.py` 新增 `McpServerRegistry`：①按职责拆分（`tools` / `memory` / `signals` 三 server）②每 server 工具数上限校验（≤15）③prompt 体积监控（每 server prompt ≤ 4k tokens）④工具重复检测（跨 server 不允许同名工具）⑤动态加载（只加载当前任务需要的 server）；4 个 Adapter（ClaudeCode/Codex/OpenCode/Trae）共用此 registry
- **优先级理由**：P1 因为 v7.1-§A4 三方 Agent 是 Layer 0 能力扩展层，4 个 Adapter 上线后 MCP 治理缺失会累积 100+ 工具——但当前 4 Adapter 还未实现，优先级低于已实现的 P0 项

### CL-038 [P1] [CLI集成] cli-integration.md NDJSON 解析器 + "stderr 也算活着"教训 vs FlowForge CLI Adapter 无 stderr 处理

- **来源**：`clowder-ai/docs/architecture/cli-integration.md`（Claude/Codex/AGY CLI 集成架构 + NDJSON 解析器 + stderr 也算活着的教训）
- **对标 FlowForge**：`flowforge/core/external_agent/adapters/` ClaudeCodeAdapter / CodexAdapter / OpenCodeAdapter / TraeAdapter（v7.1-§A4，对应 F031-F035）
- **问题**：FlowForge 4 个 CLI Adapter 调用三方 Agent 时，假设"stdout 才是有效输出，stderr 是错误"，但**实际 Claude Code/Codex CLI 会把进度信息、心跳、partial result 输出到 stderr**——若不读 stderr，Adapter 会误判"Agent 卡死"并触发超时回退；同时 NDJSON（Newline-Delimited JSON）流式输出未处理——每行一个 JSON 对象，非整体 JSON，若按整体解析会 buffer overflow 或解析失败
- **clowder-ai 做法**：cli-integration.md 教训"stderr 也算活着"：NDJSON 解析器同时读 stdout + stderr，stderr 行也作为 keepalive 信号（不阻塞 stdout 解析）；处理 NDJSON 流式输出（每行一个 JSON 对象，逐行 parse，非整体 JSON）；处理 partial JSON 行（最后一行可能不完整，buffer 到下次 read）；处理 CLI 进程异常退出（exit code ≠ 0 但 stderr 有有效输出时仍尝试解析）
- **建议**：`flowforge/core/external_agent/ndjson_parser.py` 新增 `NDJSONStreamParser`：①同时处理 stdout + stderr（stderr 作为 keepalive，不阻塞 stdout 解析）②逐行 parse NDJSON（不整体 buffer）③处理 partial JSON 行（buffer 到下次 read）④处理 CLI 进程异常退出（exit code ≠ 0 但 stderr 有有效输出时仍尝试解析）⑤timeout 时先检查 stderr 是否有 keepalive 再决定是否真超时；4 个 Adapter 共用此 parser
- **优先级理由**：P1 因为这是 CLI 集成的工程基础——若不处理 stderr，ClaudeCodeAdapter 长程任务（>30s）会频繁误判超时，违反 operator "LLM webchat 调用必须不超过 30 秒"性能要求；但当前 4 Adapter 还未实现，优先级低于已实现的 P0 项

### CL-039 [P2] [CI/CD] F133 GitHub CI/CD Tracking 状态迁移去重（headSha + aggregateBucket）vs FlowForge F021 Side-Effect WAL 无 PR 级 rollup

- **来源**：`clowder-ai/docs/features/F133-cicd-tracking.md`（PR 级 rollup + 不用 raw Checks API + 状态迁移去重 headSha+aggregateBucket + 独立 CiCdRouter）
- **对标 FlowForge**：`flowforge/core/reliability/` F021-side-effect-wal.md + `decisions/010-distributed-reliability.md` ADR-010
- **问题**：FlowForge F021 Side-Effect WAL 记录所有副作用，但**对 GitHub CI/CD 状态变更无 PR 级 rollup**：①每个 check 状态变更都触发一次 WAL 写入，造成 WAL 膨胀 ②重复通知（同一 PR 的多个 check 状态变更触发多次 operator 通知）③无状态迁移去重——headSha 不变 + aggregate bucket 相同 = 不应重复通知，但 v7.0 无此去重逻辑 ④无独立 CiCdRouter——CI/CD 状态混入 GitHub 通用 connector，职责不清
- **clowder-ai 做法**：F133 KD：①PR 级 rollup（一个 PR 的所有 checks 聚合成一个状态，不用 raw Checks API）②状态迁移去重用 headSha + aggregateBucket（非时间窗口，headSha 不变 + bucket 相同 = 不重复通知）③独立 CiCdRouter（不混入 GitHub 通用 connector）④消息投递到 channel/消息管道（CI/CD 状态变更通知到统一 channel）
- **建议**：`flowforge/core/reliability/cicd_router.py` 新增 `CiCdRouter`：①PR 级 rollup（聚合 PR 所有 checks 为一个状态）②headSha + aggregateBucket 去重（非时间窗口）③独立 router（不混入 GitHub 通用 connector）④消息投递到统一 channel；F021 Side-Effect WAL 增加 rollup 层（PR 级聚合后再写入 WAL）
- **优先级理由**：P2 因为 FlowForge 当前还未接入 GitHub PR 流程（SelfDevCodeLoop 未实现），CI/CD 状态变更是未来场景——但接入后无去重会让 WAL 膨胀到 GB 级，优先级低于已实现的 P0 项

### CL-040 [P1] [文档治理] clowder-ai/docs 32 份文件 front-matter（feature_ids/related_features/topics/doc_kind/created）规范 vs FlowForge docs 无统一 front-matter

- **来源**：`clowder-ai/docs/features/*.md` 全部带 YAML front-matter（如 F227 front-matter：`feature_ids: [F227]` / `related_features: [F114, F102, F192, F095, F057, F187, F225]` / `topics: [memory, observability, harness, magic-words, navigation, cognitive-state]` / `doc_kind: spec` / `created: 2026-06-06`）+ `clowder-ai/docs/architecture/*` + `clowder-ai/docs/design/*`
- **对标 FlowForge**：`flowforge/docs/features/F001-F040` + `flowforge/docs/decisions/ADR-001~013`（无统一 front-matter）
- **问题**：FlowForge features 和 ADR 文件**无统一 front-matter**：①无 `feature_id` / `related_features` 字段，无法机器可读地建立 feature 依赖图 ②无 `topics` 字段，无法按主题索引（如"memory" / "harness" / "magic-words"）③无 `doc_kind` 字段，无法区分 spec / decision / lesson / research ④无 `created` 字段，无法按时间排序 ⑤SelfDevDocLoop 自动化（文档自我演进）需要机器可读的依赖图，无 front-matter 无法实现
- **clowder-ai 做法**：32 份文件全部 YAML front-matter，`doc_kind` 区分 spec/decision/lesson/research；`related_features` 建立 feature 间依赖关系（如 F227 依赖 F114/F102/F192/F095/F057/F187/F225）；`topics` 支持多主题标签；`created` 字段追踪立项时间
- **建议**：`flowforge/docs/features/*.md` 和 `flowforge/docs/decisions/*.md` 全部增加 front-matter（`feature_id` / `related_features` / `topics` / `doc_kind` / `created`）；`flowforge/forgemind/doc_index.py` 新增 `DocIndexBuilder` 自动构建 `FeatureDependencyGraph` + `TopicIndex`；SelfDevDocLoop 使用此索引判断"修改 feature X 时哪些 related_features 需要同步更新"
- **优先级理由**：P1 因为这是文档治理基础设施，影响 SelfDevDocLoop 自动化（review.md CL-001 已识别 F100 Mode C 缺失，本条是其文档治理基础）——但当前 docs 已成型，front-matter 改造可分批进行，优先级低于 P0

### CL-041 [P2] [命名边界] clowder-ai naming-contract 内部 cat-cafe vs 外部 Clowder AI 双品牌边界 vs FlowForge naming-contract 未定义内外品牌边界

- **来源**：`clowder-ai/docs/design/naming-contract.md`（内部 cat-cafe 代码仓 / 内部文档 / 系统协议名 `@cat-cafe/*` / `cat_cafe_*` / `cat-cafe:*` 不可改 vs 外部 Clowder AI 对外品牌 / 社区 / 文档对外名；系统协议名是稳定性承诺，开源后不可改）
- **对标 FlowForge**：`flowforge/docs/design/naming-contract.md` v1.0（仅定义 12 核心概念 + 进化阶/觉醒阶 + 废弃命名清单 + 使用规范，**未定义内外品牌边界**）
- **问题**：FlowForge naming-contract.md 定义了 12 核心概念命名（ForgeMind/Forgekin/ForgekinSpecies/ForgeNurturing/EchoStore/SoulImprint/SpiritForge/MindCodex/MindCouncil/EvolutionStage/AwakeningStage/CapabilityProfile），但**未定义"内部代号 vs 外部品牌"边界**：①开源后"FlowForge" / "ForgeMind" / "Forgekin" 在代码层、UI 层、文档层、社区层应如何区分？ ②系统协议名（如 `flowforge_*` / `@flowforge/*` / `flowforge:*`）是否可改？ ③开源后改名成本极高——若代码层使用 "flowforge" 但对外品牌是 "ForgeMind"，开源前必须定义清楚 ④clowder-ai 已踩过坑——内部 cat-cafe vs 外部 Clowder AI 双品牌边界明确，系统协议名不可改
- **clowder-ai 做法**：clowder-ai naming-contract 明确：①内部 `cat-cafe`（代码仓名 / 内部文档 / 系统协议名 `@cat-cafe/*` / `cat_cafe_*` / `cat-cafe:*` 不可改）②外部 `Clowder AI`（对外品牌 / 社区 / 文档对外名）③系统协议名是稳定性承诺——开源后不可改 ④内外映射表明确（如内部 `cat_cafe_workspace_navigate` 对外文档可写 `Clowder AI workspace navigation`）
- **建议**：`flowforge/docs/design/naming-contract.md` 增加 §10 内外品牌边界表：①内部 `flowforge`（代码仓名 / 模块名 / 系统协议名 `@flowforge/*` / `flowforge_*` / `flowforge:*` 不可改——开源前定义，开源后稳定性承诺）②外部 `ForgeMind`（对外品牌 / VISION / 社区 / 文档对外名）③系统协议名稳定性承诺——开源后不可改 ④内外映射表（如内部 `flowforge_capability_profile` 对外文档可写 `ForgeMind Capability Profile`）⑤开源前必须 review 一遍所有系统协议名，确认无歧义后冻结
- **优先级理由**：P2 因为 FlowForge 即将开源（MIT），开源后改名成本极高——但当前还未开源，可在开源前定义清楚，优先级低于已实现的 P0 项

---

## 14.5 第十四章补审小结

### 14.5.1 20 项补审问题分布矩阵

| 编号 | 主题 | 来源 clowder-ai | 对标 FlowForge | 优先级 |
|------|------|----------------|----------------|:------:|
| CL-022 | Plugin V3 manifest + ownership | F202 Phase 1 AC-A/B/C/D/E | Plugin V3 四钩子 + ADR-005 | **P0** |
| CL-023 | Schedule Factory Whitelist + collision 检测 | F202 Phase 2 AC-F/G/H | forgemind APScheduler | **P0** |
| CL-024 | Plugin 启停 transactional 语义 | F202 AC-F3/F4/B5 | Plugin V3 on_activate/disable | P1 |
| CL-025 | Close Gate 结构化判据 + follow-up 阻塞 | F177 Phase A/B | SelfDevCodeLoop | P1 |
| CL-026 | 四心智家族专属护栏 | F177 Phase B-H | AwakeningStage E1-E6 | P1 |
| CL-027 | TeamAct Queue Steer + Plan Board | F047 + F250 | F002 TeamAct 六步 | **P0** |
| CL-028 | Restart Recovery sweep stale records | F048 + LL-046/048/045 | F022 Tier 1-4 Recovery | **P0** |
| CL-029 | Event Memory 认知转折一等公民 | F227 5 原则 + 10 字段 schema | EchoStore + F014 | **P0** |
| CL-030 | no-classifier 红线 + schema 终态 | F227 AC-B1 + KD-3/KD-5 | EchoStore + SpiritForge | P1 |
| CL-031 | Auto Dream 双层架构 + 4 信号 | F255 双层 + 4 telemetry | Mind Council + Mode C | **P0** |
| CL-032 | Agent Swarm 并行协同 | F037 + roleagent 伙伴数学 | F002 TeamAct + Mind Council | **P0** |
| CL-033 | Approval Hub 统一审批中心 | F246 7 Phase + 4 adapter | AwakeningStage E1-E2 | P1 |
| CL-034 | QC Loop 7-Step + 3-Layer Reviewer | F253 7-Step + Maine Coon 3-Layer | F018/F019/F020 Eval 自代谢 | **P0** |
| CL-035 | F135 OOTB 关闭教训 | F135 closed 2026-05-26 | forgemind 预置 3 灵智体 | P2 |
| CL-036 | Hyperfocus Brake 90min + typed check-in | F085 5 Phase 演进 | F012 Entropy Control | P2 |
| CL-037 | MCP 1→3 server 拆分 + prompt 瘦身 | F043 collab/memory/signals | F031 ExternalAgentAdapter | P1 |
| CL-038 | NDJSON + stderr 也算活着 | architecture/cli-integration.md | F031 4 个 Adapter | P1 |
| CL-039 | CI/CD PR 级 rollup + 去重 | F133 headSha+aggregateBucket | F021 Side-Effect WAL | P2 |
| CL-040 | docs front-matter 规范 | clowder-ai/docs 32 份文件 | docs/features + decisions | P1 |
| CL-041 | 内外品牌边界 | clowder-ai naming-contract | naming-contract v1.0 | P2 |

### 14.5.2 优先级分布

- **P0（8 项必修）**：CL-022（Plugin V3 manifest）/ CL-023（Schedule Factory Whitelist）/ CL-027（TeamAct Queue Steer）/ CL-028（Restart Recovery sweep）/ CL-029（Event Memory）/ CL-031（Auto Dream）/ CL-032（Agent Swarm）/ CL-034（QC Loop 7-Step）——这 8 项是 v7.1 走向"工程实现"的最低要求
- **P1（8 项应修）**：CL-024（Plugin transactional）/ CL-025（Close Gate 结构化判据）/ CL-026（四心智家族护栏）/ CL-030（no-classifier 红线）/ CL-033（Approval Hub）/ CL-037（MCP 治理）/ CL-038（NDJSON + stderr）/ CL-040（docs front-matter）——这 8 项是 v7.1 走向"生产级"的必要补充
- **P2（4 项建议）**：CL-035（F135 OOTB 教训）/ CL-036（Hyperfocus Brake）/ CL-039（CI/CD 去重）/ CL-041（内外品牌边界）——这 4 项是 v7.1 走向"工程最佳实践"的演进方向

### 14.5.3 与第十三章 CL-001~CL-021 的关系

| 第十三章（CL-001~CL-021） | 第十四章（CL-022~CL-041） | 关系 |
|--------------------------|--------------------------|------|
| CL-001~CL-006 F100 自我进化三模式 | CL-025 Close Gate 结构化判据 / CL-026 四心智家族护栏 / CL-031 Auto Dream | F100 Mode A/B/C 的工程落地形式 |
| CL-007~CL-013 F093 世界引擎三层架构 | CL-029 Event Memory / CL-030 no-classifier 红线 | 三路记忆（Canon/Relational/Session）的事件层补充 |
| CL-014~CL-017 F241 Agent Provider Plugin | CL-022 Plugin V3 manifest / CL-023 Schedule Factory Whitelist / CL-024 Plugin transactional / CL-037 MCP 治理 / CL-038 NDJSON+stderr | Provider Plugin 的 manifest/ownership/MCP/CLI 全链路工程化 |
| CL-018~CL-021 ADR-021 Pack 系统 | CL-032 Agent Swarm / CL-034 QC Loop | Pack 共享 + swarm 协同 + QC 闭环的协作层补全 |

> 三章合起来构成 v7.1 从"概念框架"走向"工程实现"的完整路线图：第八章（roleagent.md 七大工程路径）解决"如何让 multi-agent 协作可靠"；第九章（forgemind + 三方 Agent）解决"如何承载万物灵智体愿景"；第十三章（F100/F093/F241/ADR-021 深度补审）解决"如何让自我进化、世界引擎、Provider Plugin、Pack 系统真正工程化"；**第十四章（F202/F047/F048/F085/F106/F135/F177/F227/F246/F253/F255 + roleagent/public-lessons/SOP/naming-contract 深度补审）解决"如何让插件框架、协作队列、灾备、事件记忆、QC Loop、做梦联想、Swarm 协同、Approval Hub、Hyperfocus Brake、MCP 治理、CLI stderr、CI/CD 去重、文档治理、命名边界" 14 类工程实践真正落地"**。

### 14.5.4 修复优先级建议

按以下顺序补全 ADR 与 Feature 规格：

1. **第一波（P0 8 项，2026 Q3）**：CL-022 Plugin V3 manifest / CL-023 Schedule Factory Whitelist / CL-027 TeamAct Queue Steer / CL-028 Restart Recovery sweep / CL-029 Event Memory / CL-031 Auto Dream / CL-032 Agent Swarm / CL-034 QC Loop 7-Step
2. **第二波（P1 8 项，2026 Q4）**：CL-024 Plugin transactional / CL-025 Close Gate 结构化判据 / CL-026 四心智家族护栏 / CL-030 no-classifier 红线 / CL-033 Approval Hub / CL-037 MCP 治理 / CL-038 NDJSON+stderr / CL-040 docs front-matter
3. **第三波（P2 4 项，2027 Q1）**：CL-035 F135 OOTB 教训 / CL-036 Hyperfocus Brake / CL-039 CI/CD 去重 / CL-041 内外品牌边界

---

> **文档状态**: ✅ 第十四章补审完成——追加 20 项深度审核意见（CL-022~CL-041），覆盖 clowder-ai/docs 中 F202/F047/F048/F085/F106/F135/F177/F227/F246/F253/F255 + roleagent.md/public-lessons.md/SOP.md/naming-contract.md 等 32 份设计文件蕴含的工程实践。待 operator 审核 20 项补审意见后，开始按 P0 优先级补全 ADR 与 Feature 规格。
