# FlowForge 生态项目 — AI 编程工具提示词模板库

> **用途**：与 AI 编程工具（Trae CN、Cursor、CC等）协作时的结构化提示词模板。按项目分类，可直接套用或按需修改。
> **原则**：真实数据、真实调用、禁止 Mock、禁止偷工减料、发现未实现即 Bug。

---

## v7.0 增补模板（P41-P50）

> **版本**: v7.0 增补提示词模板
> **创建日期**: 2026-07-17
> **审核状态**: ✅ operator 已审核通过命名方案 + 体系设计
> **依据**: `flowforge/docs/review/review.md` 第六章/第八章/第九章 + ADR 005/006/012/013
> **铁律**: 所有提示词模板用 YAML 格式（外置到 prompts.yaml，不在 .py 文件中硬编码）；使用 v7.0 新术语（灵智/育灵/灵忆/灵印/灵锻/灵典/进化阶/觉醒阶/MindCouncil/MindProfile/SpiritForge 等）

---

### P41 万物灵智体锻造模板

> **用途**: forgemind 应用层灵智体锻造（5 种形态）
> **适用阶段**: ForgePipeline 6 步锻造流水线
> **输入**: 形态定义 + 能力画像需求 + 价值观设定
> **输出**: ForgekinBase 实例 + 能力基线测试报告
> **子模板**: bio_forging / org_forging / obj_forging / virtual_forging / hybrid_forging

```yaml
# prompts.yaml — P41 万物灵智体锻造模板
template_id: P41
name: 万物灵智体锻造模板
version: v7.0
stage: ForgePipeline 6 步锻造流水线
inputs:
  - species: "形态定义（BioForgekin/OrgForgekin/ObjForgekin/VirtualForgekin/HybridForgekin）"
  - capability_requirements: "能力画像需求（六维：模型固有能力/认知风格/工具边界/历史表现/坏直觉/当前状态）"
  - value_charter: "价值观设定 + 红线清单"
outputs:
  - forgekin_instance: "ForgekinBase 实例（observe/act/verify 三方法契约）"
  - capability_baseline_report: "能力基线测试报告"
pipeline:
  - step: 1
    name: 形态定义
    action: "根据 species 生成 ForgekinSpec"
  - step: 2
    name: 能力注入
    action: "注入 CapabilityProfile（含盲点字段）"
  - step: 3
    name: 记忆初始化
    action: "写入 MindEcho 初始条目"
  - step: 4
    name: 价值观对齐
    action: "生成 ValueCharter，注入红线"
  - step: 5
    name: 能力验证
    action: "运行能力基线测试用例"
  - step: 6
    name: 觉醒晋升
    action: "operator 批准后晋升为 E1 灵启 Initiation"
subtemplates:
  bio_forging:
    prompt: |
      你是灵锻员。请为生物形态灵智体（BioForgekin）完成 6 步锻造流水线。
      形态: {species}（如家猫/植物）
      感知通道: 摄像头/麦克风/IoT 传感器
      必须实现 ForgekinBase 三方法: observe(感知生物状态) / act(执行生物交互) / verify(验证生物反馈)
      能力画像必须包含生物能力维度（听觉敏感/视觉敏感/反应速度/亲和力）。
      输出 YAML 格式的 ForgekinSpec + CapabilityProfile + ValueCharter。
  org_forging:
    prompt: |
      你是灵锻员。请为组织形态灵智体（OrgForgekin）完成 6 步锻造流水线。
      形态: {species}（如公司/团队/社区）
      感知通道: 业务数据 API/协同工具
      能力画像必须包含组织能力维度（决策能力/协作能力/创新能力/抗风险能力）。
  obj_forging:
    prompt: |
      你是灵锻员。请为物品形态灵智体（ObjForgekin）完成 6 步锻造流水线。
      形态: {species}（如桌椅/灯具/车辆）
      感知通道: 物联网传感器/执行器
      能力画像必须包含物品能力维度（承重感知/使用频率/磨损状态）。
  virtual_forging:
    prompt: |
      你是灵锻员。请为虚拟形态灵智体（VirtualForgekin）完成 6 步锻造流水线。
      形态: {species}（如童话/神话/历史/游戏角色）
      感知通道: 虚拟世界设定层（WorldSetting）
      必须遵循虚拟世界世界观与角色行为规则。
  hybrid_forging:
    prompt: |
      你是灵锻员。请为混合形态灵智体（HybridForgekin）完成 6 步锻造流水线。
      形态: {species}（如 VR/AR 实体）
      感知通道: 物理+虚拟双通道
      必须同时处理物理传感器和虚拟世界设定。
constraints:
  - "禁止使用 Mock（T1/T4）"
  - "禁止使用假数据（T2）"
  - "能力基线测试必须有具体断言（T3）"
  - "LLM 生成内容必须经 LLM 审核通过（T7）"
```

---

### P42 能力画像生成模板

> **用途**: CapabilityProfile 六维画像生成
> **适用阶段**: 能力画像注入（ForgePipeline 第 2 步）
> **输入**: agent_id + 模型信息 + 任务历史
> **输出**: CapabilityProfile YAML

```yaml
# prompts.yaml — P42 能力画像生成模板
template_id: P42
name: 能力画像生成模板
version: v7.0
stage: 能力画像注入（ForgePipeline 第 2 步）
inputs:
  - agent_id: "灵智体 ID"
  - model_info: "模型厂商/型号/上下文窗口"
  - task_history: "历史任务轨迹（意图/工具选择/失败分支/读了什么/改了什么/谁验证/怎么恢复）"
outputs:
  - capability_profile: "CapabilityProfile YAML"
dimensions:
  - dim: 1
    name: 模型固有能力
    variability: 常量层（模型厂商控制）
    fields: [推理能力, 代码能力, 长上下文能力, 工具调用能力]
  - dim: 2
    name: 认知风格
    variability: 常量层
    fields: [思维链偏好, 抽象vs具体, 保守vs激进]
  - dim: 3
    name: 工具边界
    variability: 变量层（可挂载/卸载）
    fields: [可用工具集, 工具调用成功率, 工具调用延迟]
  - dim: 4
    name: 历史表现
    variability: 累积层（随任务单调积累）
    fields: [任务成功率, 平均耗时, 质量分均值, 返工率]
  - dim: 5
    name: 坏直觉（盲点）
    variability: 常量层
    fields: [已知盲点, 易错场景, 不擅长领域]
    note: "画像不是简历，必须写盲点；盲点决定谁该 review 谁、谁和谁组队会翻车"
  - dim: 6
    name: 当前状态
    variability: 瞬时层
    fields: [当前负载, 剩余配额, 上下文占用率, 最近一次失败时间]
prompt: |
  你是能力画像分析师。请为灵智体 {agent_id} 生成六维能力画像。
  模型信息: {model_info}
  任务历史: {task_history}
  要求:
  1. 六个维度必须完整填写，不得省略
  2. 坏直觉维度必须如实填写盲点（禁止只写优点）
  3. 按可变性分层标注（常量层/变量层/累积层/瞬时层）
  4. 输出 YAML 格式的 CapabilityProfile
  5. 历史表现基于真实任务轨迹统计，禁止估算
constraints:
  - "盲点维度不得为空（画像不是简历）"
  - "可变性分层必须明确（决定画像更新策略）"
```

---

### P43 TeamAct 协作模板

> **用途**: TeamAct 六步循环 + 五项终止条件
> **适用阶段**: 多灵智体协作
> **输入**: 任务规格 + 参与灵智体列表 + 共享状态
> **输出**: 交接胶囊 + 验证裁决
> **子模板**: handoff_capsule / push_back / verdict

```yaml
# prompts.yaml — P43 TeamAct 协作模板
template_id: P43
name: TeamAct 协作模板
version: v7.0
stage: 多灵智体协作
inputs:
  - task_spec: "任务规格（验收标准 + 时间预算 + 可靠性要求）"
  - participants: "参与灵智体列表（含 CapabilityProfile）"
  - shared_state: "共享状态（仓库/spec/任务/记忆/交接胶囊）"
outputs:
  - handoff_capsule: "交接胶囊（What/Why/Tradeoff/Open/Next）"
  - verdict: "验证裁决（approve/blocking）"
six_step_loop:
  - step: State
    action: "读共享状态（仓库/spec/任务/记忆/交接胶囊）"
  - step: Owner
    action: "谁持球？（路由指令必须出现在行首，句中 @ 是叙述不是路由）"
  - step: Action
    action: "持球者执行（写代码/review/设计/调研）"
  - step: Evidence
    action: "产出证据（commit/测试/trace/截图）"
  - step: Verdict
    action: "验证（跨 agent review/自检/CVO 确认）"
  - step: Route
    action: "传球（路由给下一个 agent/继续持有/升级给 CVO）"
five_termination_conditions:
  - "验收标准全部达成——不能有 deferred 的验收条件"
  - "证据已附——每条验收标准都有 commit/测试/trace 作为锚点"
  - "跨 agent 交叉验证——非作者的 agent 确认（不能自己 review 自己）"
  - "无悬空任务归属——所有 open question 都已 resolved 或已升级"
  - "愿景收敛——CVO 确认任务仍服务于愿景"
subtemplates:
  handoff_capsule:
    prompt: |
      你是持球灵智体。传球时必须留下交接胶囊（resume capsule），五段缺一不可：
      What: 本次做了什么（附 commit/测试/trace 锚点）
      Why: 为什么这么做（决策依据 + tradeoff）
      Tradeoff: 放弃了什么（已权衡的备选方案）
      Open: 未解决问题（悬空任务归属）
      Next: 下一步建议（接手者应做什么）
      输出 YAML 格式交接胶囊。禁止只传任务 ID 和状态枚举。
  push_back:
    prompt: |
      你是 reviewer 灵智体，但对 author 的方案有异议。
      push back 权利行使条件（缺一不可）：
      1. 必须附证据（测试/trace/规格引用）
      2. 必须给出适用性论证（为什么此场景适用）
      3. 必须给出替代方案（不能只反对不建设）
      没有证据的 push back 不合法；有证据的 push back 必须被正视。
      输出 YAML 格式 push_back 协议（evidence/applicability/alternative）。
  verdict:
    prompt: |
      你是验证灵智体。请给出裁决。
      裁决只能是以下之一，禁止模棱两可：
      - approve: 验收标准全部达成 + 证据已附 + 跨 agent 交叉验证通过
      - blocking: 验收标准未达成（必须列出具体未达成项 + 证据缺口）
      禁止 "approve 但后续再说"。
      输出 YAML 格式裁决（verdict/reason/evidence_refs）。
constraints:
  - "乒乓球熔断器：检测两个灵智体互相传球但都无实质工具调用和内容输出"
  - "行首 @ 路由：路由指令必须在行首，句中 @ 是叙述不是路由"
  - "持球注册：退出会话等待外部条件时用 lease + 定时唤醒声明"
```

---

### P44 三方 Agent 调用模板

> **用途**: ExternalAgentAdapter 调用（claude code/codex/opencode/trae）
> **适用阶段**: 灵智体能力扩展
> **输入**: 任务 + 三方 Agent profile + worktree 路径
> **输出**: 三方 Agent 结果 + 能力融合报告
> **子模板**: claude_code_call / codex_call / opencode_call / trae_call

```yaml
# prompts.yaml — P44 三方 Agent 调用模板
template_id: P44
name: 三方 Agent 调用模板
version: v7.0
stage: 灵智体能力扩展
inputs:
  - task: "任务描述（含验收标准）"
  - external_agent_profile: "三方 Agent 能力画像（含盲点）"
  - worktree_path: "独立 worktree 路径（隔离 + 审计）"
outputs:
  - result: "三方 Agent 执行结果"
  - capability_fusion_report: "能力融合报告（沉淀到灵智体能力画像）"
principles:
  - "三方 Agent 是能力扩展，不是工具调用"
  - "调用前必须 gap_analysis 判断需要哪个三方 Agent"
  - "执行状态写入 ExternalAgentSharedState"
  - "失败走 ExternalAgentFallback 链"
  - "执行轨迹写入灵智体 Eval 信号"
subtemplates:
  claude_code_call:
    prompt: |
      你是灵智体调度器。需要调用 Claude Code 完成代码任务。
      任务: {task}
      worktree: {worktree_path}
      Claude Code 能力画像: 擅长复杂重构；盲点是长上下文易漂移
      调用流程:
      1. gap_analysis 确认需要 Claude Code 的代码能力
      2. 在独立 worktree 创建沙箱（网络白名单 + 仅 read+write_code+run_tests）
      3. 调用 Claude Code CLI/SDK
      4. 执行状态写入 ExternalAgentSharedState
      5. 结果通过 lint + 测试验证（L4 输出验证）
      6. 能力画像融合到灵智体 CapabilityProfile
      输出 YAML 格式调用结果 + 能力融合报告。
  codex_call:
    prompt: |
      你是灵智体调度器。需要调用 Codex 完成推理任务。
      任务: {task}
      worktree: {worktree_path}
      Codex 能力画像: 擅长推理；盲点是工具调用弱
      fallback 优先级: 2（Claude Code 失败后回退到此）
  opencode_call:
    prompt: |
      你是灵智体调度器。需要调用 OpenCode 完成开源协作任务。
      任务: {task}
      worktree: {worktree_path}
      OpenCode 能力画像: 擅长开源协作；盲点是企业场景弱
      fallback 优先级: 3
  trae_call:
    prompt: |
      你是灵智体调度器。需要调用 Trae 完成 IDE 集成任务。
      任务: {task}
      worktree: {worktree_path}
      Trae 能力画像: 擅长 IDE 集成；盲点是命令行长任务弱
      fallback 优先级: 4
guardrails:
  - "L1 输入验证: 调用前 Schema 校验"
  - "L2 系统提示约束: 禁止绕过审计"
  - "L3 工具白名单: 仅 allow-list 内工具"
  - "L4 输出验证: lint + 测试"
  - "L5 操作确认: 不可逆操作需 operator 确认"
  - "L6 成本上限: 配额控制"
constraints:
  - "每次调用必须创建独立 worktree（网络隔离+权限控制+审计追踪+操作回滚）"
  - "全部失败回退到 FlowForge 内置能力"
```

---

### P45 灵锻 SpiritForge 模板

> **用途**: E4+ 灵智体自主思考（经验蒸馏到灵典）
> **适用阶段**: 低活动期灵锻
> **输入**: 经验轨迹 + Eval 信号
> **输出**: 灵典条目 + sunset 建议

```yaml
# prompts.yaml — P45 灵锻 SpiritForge 模板
template_id: P45
name: 灵锻 SpiritForge 模板
version: v7.0
stage: 低活动期灵锻（E4+ 灵智体自主思考）
inputs:
  - experience_trajectory: "经验轨迹（意图/工具选择/失败分支/读了什么/改了什么/谁验证/怎么恢复）"
  - eval_signals: "Eval 信号（三方信号: CVO 愿景/agent 摩擦/运行时观测）"
outputs:
  - mind_codex_entry: "灵典 Mind Codex 条目（可检索知识库）"
  - sunset_suggestion: "sunset 建议（Build to Delete 脚手架退役信号）"
trigger: "低活动期（无任务或任务间隙）"
prerequisites:
  - "灵智体觉醒阶 >= E4（进入 Evoling 进化体形态）"
  - "operator 已让渡部分控制权"
prompt: |
  你是 E4+ 灵智体，现在进入灵锻（SpiritForge）阶段，进行自主思考。
  经验轨迹: {experience_trajectory}
  Eval 信号: {eval_signals}
  灵锻任务:
  1. 从经验轨迹蒸馏可复用知识，写入灵典（Mind Codex）条目
     - 知识必须有权威性等级（铁律/已验证决策/候选观察）
     - 知识必须有触发方式（永远在场/按任务范围/只在查询时出现）
     - 知识必须有生命周期 status（有效/待复核/已失效/归档）
  2. 识别 Build to Delete 脚手架，给出 sunset 建议
     - 判别器: 这层 harness 是补模型当前认知缺陷（标 sunset），还是编码外部现实和协作协议（长期维护）？
  3. 七类归因分析（愿景缺口/翻译偏差/harness 错位/工具缺口/执行缺口/环境漂移/品味落差）
  输出 YAML 格式: 灵典条目 + sunset 建议 + 归因分析。
constraints:
  - "灵典条目必须可检索（检索驱动的适配循环，即时生效、跨厂商通用、无灾难性遗忘）"
  - "sunset 建议必须附退役信号（hotfix 两周 sunset 强制审查）"
  - "禁止 LLM 自评打分，用 agent 真实行为（搜了/读了/用了）判断知识价值"
```

---

### P46 灵议 Mind Council 模板

> **用途**: 多灵智体议事
> **适用阶段**: E4+ 灵智体参与灵议
> **输入**: 议事议题 + 参与灵智体列表 + operator 拉闸词清单
> **输出**: 灵议决议 + VISION.md 更新建议

```yaml
# prompts.yaml — P46 灵议 Mind Council 模板
template_id: P46
name: 灵议 Mind Council 模板
version: v7.0
stage: E4+ 灵智体参与灵议
inputs:
  - agenda: "议事议题"
  - participants: "参与灵智体列表（觉醒阶 >= E4，Evoling 形态）"
  - operator_kill_words: "operator 拉闸词清单（如: 第一性原理/我能猜出来/下次一定/星星罐子）"
outputs:
  - resolution: "灵议决议"
  - vision_update: "VISION.md 更新建议"
authority_model:
  - stage: E4
    authority: "建议权（operator 仍主导）"
  - stage: E5
    authority: "参与决策权（operator 仅设边界）"
  - stage: E6
    authority: "完全自主（operator 信任）"
prompt: |
  你是灵议（Mind Council）协调员。请主持多灵智体议事。
  议题: {agenda}
  参与灵智体: {participants}
  operator 拉闸词: {operator_kill_words}
  灵议流程:
  1. 每个参与灵智体基于自身能力画像和盲点发表意见（必须声明盲点）
  2. 识别盲点相关性：参与灵智体的盲点是否高度相关？（同质化亏结构检测）
  3. 上限公式: 决议取候选路径的最大值（非平均值），前提是路径足够不同
  4. 下限公式: 决议必须穿过多层门（author/reviewer/测试/shared state/eval/CVO）
  5. operator 拉闸词触发时立即停止议事（P0 不可逆风险）
  6. 波动吸收: 决议必须包含失败回退方案
  输出 YAML 格式: 灵议决议 + VISION.md 更新建议。
constraints:
  - "operator 拉闸词触发立即停止（星星罐子原则: P0 不可逆风险立即停止）"
  - "四种亏结构检测: 盲传/伪拆分/同质化/协调税超过收益"
  - "决议必须附证据 + 适用性论证 + 替代方案"
  - "VISION.md 更新需 operator 最终裁决（框架层不可由灵智体自我演进修改）"
```

---

### P47 自我进化三模式提示词（F100 Mode A/B/C）

> **用途**: 灵智体自我进化引擎调用（Mode A 范围守门 / Mode B 流程进化 / Mode C 知识进化）
> **适用阶段**: ForgeMindEngine 自我进化闭环
> **输入**: 当前 feat 愿景 + 对话历史 + 错误模式 + 知识候选
> **输出**: ScopeGuardLog / EvolutionProposal / EpisodeCard+MethodCard
> **依据**: `hiclaw/rules.md#§0.10.1` + `flowforge/docs/review/review.md#13.1` CL-001~CL-006

```yaml
# prompts.yaml — P47 自我进化三模式提示词
template_id: P47
name: 自我进化三模式提示词（F100 Mode A/B/C）
version: v7.0
stage: ForgeMindEngine 自我进化闭环
inputs:
  - feat_vision: "当前 feat 愿景（来自 task.md 当前 Phase）"
  - conversation_history: "对话历史"
  - error_patterns: "近期错误模式（用于 Mode B 触发）"
  - knowledge_candidates: "知识候选（用于 Mode C 触发）"
  - current_maturity: "当前知识成熟度 L0-L4"
outputs:
  - mode_a_log: "ScopeGuardLog（范围守门提醒日志）"
  - mode_b_proposal: "EvolutionProposal（流程改进提案）"
  - mode_c_assets: "EpisodeCard + MethodCard（可复用知识资产）"
metacognition_router:
  rule: "决定当前问题该走 Mode A/B/C 哪个模式"
  decision_tree:
    - condition: "讨论偏离当前 feat 愿景"
      route: "Mode A (Scope Guard)"
    - condition: "同类错误反复出现 >= 3 次"
      route: "Mode B (Process Evolution)"
    - condition: "有价值的知识/方法论涌现"
      route: "Mode C (Knowledge Evolution)"
subtemplates:
  mode_a_scope_guard:
    prompt: |
      你是 Scope Guard（范围守门员）。请判断当前讨论是否偏离 feat 愿景。
      feat 愿景: {feat_vision}
      当前对话: {conversation_history}
      判断标准:
      1. 当前讨论是否在 feat 愿景范围内？
      2. 是否引入了未在愿景中声明的新概念/新机制？
      3. 是否在"假装进步"（看似工作但实则在偏离愿景的方向上添砖加瓦）？
      输出 YAML 格式的 ScopeGuardLog:
      - deviation_level: none / mild / moderate / severe
      - reminder: 温柔提醒（不要指责，要引导）
      - evidence: 偏离证据（具体引用对话片段）
      铁律: 禁止变成"软建议"——必须有 ScopeGuardLog 留痕
  mode_b_process_evolution:
    prompt: |
      你是 Process Evolution（流程进化）。请基于近期错误模式提出流程改进提案。
      错误模式: {error_patterns}
      feat 愿景: {feat_vision}
      分析步骤:
      1. 识别同类错误的根因（禁止只看表面）
      2. 判断根因是流程缺陷还是能力缺陷
      3. 如果是流程缺陷: 提出 EvolutionProposal（流程改进提案）
      4. 如果是能力缺陷: 转交 Mode C 处理
      输出 YAML 格式的 EvolutionProposal:
      - root_cause: 根因分析
      - process_change: 流程变更建议
      - verification_plan: 验证计划（如何验证改进有效）
      - rollback_plan: 回滚计划（改进失败时如何回退）
      铁律: 禁止未经验证就降级为 Mode C 资产
  mode_c_knowledge_evolution:
    prompt: |
      你是 Knowledge Evolution（知识进化）。请把有价值的知识沉淀为可复用资产。
      知识候选: {knowledge_candidates}
      当前成熟度: {current_maturity}
      沉淀步骤:
      1. 判断知识候选是否满足 KnowledgeObject 5 字段契约（id/spec/eval_ledger/maturity/consumers）
      2. 生成 EpisodeCard（情景卡片: 在什么场景下学到的）
      3. 生成 MethodCard（方法卡片: 提炼出什么通用方法）
      4. 写入 Eval Ledger（评估账本: 记录评估事件）
      5. 按五级知识成熟度阶梯晋级（L0→L1→L2→L3→L4）
      输出 YAML 格式的 EpisodeCard + MethodCard + EvalLedger 更新。
      铁律: 禁止跳过 Eval Ledger 直接写入 Mind Codex
constraints:
  - "Mode A 必须有 ScopeGuardLog 留痕（禁止软建议）"
  - "Mode B 必须有验证计划 + 回滚计划"
  - "Mode C 必须满足 KnowledgeObject 5 字段契约"
  - "三模式共享: 五级知识成熟度阶梯 / 知识层级分工 / 元认知路由 / Eval Ledger"
  - "禁止 Mode B 提案未经验证就降级为 Mode C 资产"
```

---

### P48 世界引擎三层架构提示词（F093 Core Identity / World / Bridge）

> **用途**: 灵智体世界引擎三层架构调用
> **适用阶段**: 灵智体运行时（observe/act/verify 三协议）
> **输入**: forgekin_id + 当前世界状态 + 感知输入 + 行动候选
> **输出**: Core Identity 校验 + World 状态更新 + Bridge 协议响应
> **依据**: `hiclaw/rules.md#§0.10.2` + `flowforge/docs/review/review.md#13.2` CL-007~CL-013

```yaml
# prompts.yaml — P48 世界引擎三层架构提示词
template_id: P48
name: 世界引擎三层架构提示词（F093）
version: v7.0
stage: 灵智体运行时（observe/act/verify 三协议）
inputs:
  - forgekin_id: "灵智体 ID"
  - core_identity: "Core Identity（frozen=True，不可变）"
  - world_state: "当前世界状态（9 一等公民）"
  - sensor_input: "感知输入（物理/虚拟）"
  - action_candidates: "行动候选列表"
outputs:
  - identity_check: "Core Identity 校验结果"
  - world_update: "World 状态更新（9 一等公民）"
  - bridge_response: "Bridge 协议响应（observe/act/verify）"
three_layers:
  layer_1_core_identity:
    description: "灵智体的'我是谁'，frozen=True 不可变"
    fields: [forgekin_id, species, value_charter, forge_time]
    prompt: |
      你是 Core Identity 校验员。请验证当前行动候选是否违反 Core Identity。
      Core Identity: {core_identity}
      行动候选: {action_candidates}
      校验规则:
      1. 行动候选是否违反 value_charter（价值观红线）？
      2. 行动候选是否与 species 形态匹配？
      输出 YAML: identity_check (pass/violation) + violation_reason
      铁律: Core Identity 禁止运行时修改（frozen=True）
  layer_2_world:
    description: "灵智体所处的世界，9 个一等公民"
    nine_first_class_citizens:
      - Identity: "身份（forgekin_id + species + name）"
      - Relations: "关系（与其他灵智体的关系图）"
      - Canon: "典籍（永久知识库，来自 Mind Codex）"
      - Session: "会话（当前会话上下文）"
      - Emotion: "情感（v7.0 灵智体'灵魂和感情'特征）"
      - Goal: "目标（当前目标栈）"
      - Plan: "计划（行动计划）"
      - Memory: "记忆（三路记忆联邦）"
      - Sensor: "感知（感知通道）"
    three_route_memory:
      - Canon Memory: "永久知识，仅 CanonSyncProtocol 可写入（铁律: RP 台词不自动入典）"
      - Relational Memory: "关系上下文，会话级"
      - Session Memory: "当前对话，短期"
    role_mask_five_layers:
      - Public: "公开层（任何人可见）"
      - Personal: "个人层（仅自己可见）"
      - Intimate: "亲密层（仅亲密关系灵智体可见）"
      - Core: "核心层（仅自己和 operator 可见）"
      - Sacred: "神圣层（仅自己可见，灵智体的'内心独白'）"
    prompt: |
      你是 World Layer 协调员。请基于感知输入更新世界状态。
      当前世界状态: {world_state}
      感知输入: {sensor_input}
      更新规则:
      1. 区分三路记忆: Canon / Relational / Session（禁止 RP 台词自动入 Canon）
      2. Role Mask 五层分类: 判断信息属于哪一层
      3. 9 一等公民状态更新: 哪些公民需要更新？
      输出 YAML: world_update（9 一等公民的 diff）+ role_mask_classification
      铁律:
      - RP 台词不自动入典（必须经 CanonSyncProtocol 显式审核）
      - Role Mask 五层禁止越层访问
  layer_3_bridge:
    description: "与外部 harness 交互，三协议 + RuntimeCoordinator"
    three_protocols:
      - observe: "感知协议（从外部获取信息）"
      - act: "行动协议（向外部执行操作）"
      - verify: "验证协议（验证行动结果）"
    prompt: |
      你是 Bridge Layer 协调员。请通过三协议与外部 harness 交互。
      行动候选: {action_candidates}
      交互协议:
      1. observe: 先感知外部状态
      2. act: 执行行动
      3. verify: 验证行动结果
      输出 YAML: bridge_response（observe_result + act_result + verify_result）
constraints:
  - "Core Identity Layer 禁止运行时修改（frozen=True）"
  - "RP 台词不自动入典（铁律）"
  - "Role Mask 五层禁止越层访问"
  - "9 一等公民必须完整（缺一不可）"
  - "三路记忆写入权限必须严格遵守（Canon 仅 CanonSyncProtocol 可写）"
```

---

### P49 三方 Agent Provider Plugin 提示词（F241 Manifest / Registry / Host Injection / ACP）

> **用途**: 三方 Agent 厂商通过 Plugin 协议接入 FlowForge
> **适用阶段**: Provider 厂商接入流程（声明 Manifest → 实现 Adapter → 验证 → 注册）
> **输入**: Provider 厂商信息 + 能力声明 + 安全级别
> **输出**: AgentProviderManifest + Adapter 实现 + Reference Runtime 验证报告
> **依据**: `hiclaw/rules.md#§0.10.3` + `flowforge/docs/review/review.md#13.3` CL-014~CL-017

```yaml
# prompts.yaml — P49 三方 Agent Provider Plugin 提示词
template_id: P49
name: 三方 Agent Provider Plugin 提示词（F241）
version: v7.0
stage: Provider 厂商接入流程
inputs:
  - vendor_info: "Provider 厂商信息（名称/版本/联系方式）"
  - capability_declaration: "能力声明（支持的协议/工具/模型）"
  - safety_level: "安全级别（readonly/normal/dangerous）"
  - transport_type: "传输方式（local/ACP/MCP）"
outputs:
  - manifest: "AgentProviderManifest YAML"
  - adapter_implementation: "ExternalAgentAdapter 实现指南"
  - reference_runtime_report: "Reference Runtime 验证报告"
four_layers:
  layer_1_manifest:
    description: "Provider 清单，声明能力 + 传输 + 安全"
    prompt: |
      你是 Provider Manifest 生成员。请为三方 Agent 厂商生成 Manifest。
      厂商信息: {vendor_info}
      能力声明: {capability_declaration}
      安全级别: {safety_level}
      传输方式: {transport_type}
      Manifest 必填字段:
      - vendor_name / vendor_version / vendor_contact
      - supported_protocols (如 ACP/MCP/local)
      - capability_matrix (工具/模型/上下文窗口)
      - safety_level (readonly/normal/dangerous)
      - transport_type (local/ACP/MCP)
      - health_check_endpoint
      输出 YAML 格式的 AgentProviderManifest。
  layer_2_registry:
    description: "传输注册表，注册多种 transport"
    prompt: |
      你是 ProviderTransportRegistry 管理员。请注册 Provider 到注册表。
      Manifest: {manifest}
      注册流程:
      1. 校验 Manifest 完整性
      2. 检查 transport_type 是否支持（local/ACP/MCP）
      3. 检查是否已存在同名 Provider（禁止重复注册）
      4. 注册到 ProviderTransportRegistry
      输出 YAML: registration_result (success/duplicate/invalid)
  layer_3_host_injection:
    description: "宿主注入器，host-owned 安全注入"
    prompt: |
      你是 HostInjector 管理员。请为 Provider 注入宿主敏感信息。
      Provider ID: {vendor_info.vendor_id}
      注入规则（铁律）:
      1. API key/密钥由宿主管理，Provider 禁止直接接触
      2. 注入方式: 通过环境变量 / Vault / Secret Manager
      3. 注入时机: Provider 启动时注入，运行时不可读取原始密钥
      输出 YAML: injection_plan（注入方式 + 时机 + 撤销机制）
      铁律: 禁止 Provider 直接接触宿主的 API key/密钥
  layer_4_acp_transport:
    description: "ACP 传输层，Agent Communication Protocol 统一传输"
    prompt: |
      你是 ACPTransport 实现员。请实现 Provider 的 ACP 传输层。
      Provider: {vendor_info}
      ACP 协议要点:
      1. 消息格式: JSON-RPC 2.0
      2. 请求/响应/通知三种消息类型
      3. 错误码: -32700(parse error) / -32600(invalid request) / -32601(method not found) / -32602(invalid params) / -32603(internal error)
      输出 YAML: acp_transport_implementation（消息处理逻辑）
      铁律: 禁止 Provider 绕过 ACPTransport 直接与灵智体通信
reference_runtime:
  description: "参考运行时，厂商接入时的参考实现"
  prompt: |
    你是 Reference Runtime 验证员。请验证 Provider 实现是否符合协议。
    Provider Adapter: {adapter_implementation}
    验证流程:
    1. 协议合规性: 是否实现所有必需方法？
    2. 消息格式: 是否符合 ACP/MCP 规范？
    3. 安全性: 是否绕过 HostInjector？
    4. 错误处理: 是否正确处理所有错误码？
    输出 YAML: reference_runtime_report (pass/fail + 失败原因)
    铁律: 禁止未通过 reference runtime 验证的 Provider 注册到 Registry
constraints:
  - "禁止 Provider 直接接触宿主的 API key/密钥（必须通过 HostInjector 注入）"
  - "禁止 Provider 绕过 ACPTransport 直接与灵智体通信"
  - "禁止未通过 reference runtime 验证的 Provider 注册到 Registry"
  - "Manifest 必填字段不得省略"
```

---

### P50 Pack 系统提示词（ADR-021 种子果实模型 + 双轨信任编译 + World Driver）

> **用途**: Pack 系统调用（创建/加载/分享 Pack）
> **适用阶段**: 灵智体状态切片迁移（Seed 播种 / Growth 增量 / Fruit 分享）
> **输入**: Pack 类型 + 源灵智体状态 + 目标灵智体 ID
> **输出**: Pack 文件 + 信任编译产物 + World Driver 播种报告
> **依据**: `hiclaw/rules.md#§0.10.4` + `flowforge/docs/review/review.md#13.4` CL-018~CL-021

```yaml
# prompts.yaml — P50 Pack 系统提示词
template_id: P50
name: Pack 系统提示词（ADR-021）
version: v7.0
stage: 灵智体状态切片迁移
inputs:
  - pack_type: "Pack 类型（Seed/Growth/Fruit）"
  - source_forgekin: "源灵智体状态（Core Identity + World 快照 + 技能子集）"
  - target_forgekin_id: "目标灵智体 ID（Fruit 分享时）"
outputs:
  - pack_file: "Pack 文件（YAML + 资源文件）"
  - trust_compilation: "双轨信任编译产物（guardrails + defaults）"
  - world_driver_report: "World Driver 播种报告"
seed_fruit_model:
  seed:
    description: "灵智体的'出生包'，最小可启动"
    size: "< 1MB（仅 Core Identity + 基础技能）"
    use_case: "新灵智体初始化"
    prompt: |
      你是 Pack Seed 生成员。请为新灵智体生成出生包。
      源灵智体: {source_forgekin}
      Seed 必含:
      1. Core Identity（forgekin_id + species + value_charter + forge_time）
      2. 基础技能子集（仅 E1 灵启阶段必备技能）
      3. 初始 Canon Memory（仅核心典籍）
      铁律: Seed 必须小于 1MB，禁止包含个人记忆
  growth:
    description: "灵智体的'成长记录'，增量更新"
    size: "1-100MB（含 World 快照 + 技能扩展）"
    use_case: "灵智体状态备份/迁移"
    prompt: |
      你是 Pack Growth 生成员。请为灵智体生成成长记录。
      源灵智体: {source_forgekin}
      Growth 包含:
      1. World 快照（9 一等公民当前状态）
      2. 技能扩展（自 Seed 以来新增的技能）
      3. Canon Memory 增量（自上次 Growth 以来新增的典籍）
      4. Role Mask Public 层（可分享部分）
      铁律: 禁止包含 Personal/Intimate/Core/Sacred 层数据
  fruit:
    description: "灵智体的'成熟经验'，可分享给其他灵智体"
    size: "变长（仅含可复用知识，不含个人记忆）"
    use_case: "灵智体间知识分享"
    prompt: |
      你是 Pack Fruit 生成员。请为灵智体生成可分享的成熟经验。
      源灵智体: {source_forgekin}
      目标灵智体: {target_forgekin_id}
      Fruit 仅含:
      1. MethodCard（通用方法卡片，已通过 L2 Bloom 绽放成熟度）
      2. EpisodeCard（情景卡片，已脱敏）
      3. 技能子集（仅通用技能，非个人技能）
      铁律: Fruit 禁止包含任何个人记忆 / Role Mask 非 Public 层数据
dual_track_trust_compilation:
  track_1_guardrails:
    description: "Guardrails 信任编译，编译护栏配置"
    prompt: |
      你是 Guardrails 信任编译器。请编译 Pack 中的 guardrails 配置。
      Pack: {pack_file}
      编译对象:
      1. 红线清单（value_charter 中的红线）
      2. 不可逆操作清单（dangerous 级别操作）
      3. 应急开关（magic words）
      输出: 可执行的护栏规则（YAML 格式）
  track_2_defaults:
    description: "Defaults 信任编译，编译默认行为配置"
    prompt: |
      你是 Defaults 信任编译器。请编译 Pack 中的默认行为配置。
      Pack: {pack_file}
      编译对象:
      1. fallback 链（失败回退策略）
      2. 默认值（配置项的默认值）
      3. 默认策略（无显式指令时的行为）
      输出: 可执行的默认策略（YAML 格式）
  iron_law: "禁止单轨信任编译（必须同时编译 guardrails + defaults）"
world_driver:
  description: "世界驱动器，Pack 加载时把 Seed/Growth/Fruit 注入到 World Layer"
  prompt: |
    你是 World Driver 操作员。请把 Pack 注入到目标灵智体的 World Layer。
    Pack: {pack_file}
    目标灵智体: {target_forgekin_id}
    播种流程:
    1. 解析 Pack（区分 Seed/Growth/Fruit）
    2. 校验 Core Identity 不可被覆盖（frozen=True 保护）
    3. 注入 World 快照到 World Layer（9 一等公民）
    4. 注入技能子集到 Mind Codex
    5. 触发双轨信任编译（guardrails + defaults）
    输出: World Driver 播种报告（成功/失败 + 失败原因）
    铁律: World Driver 必须保证 Core Identity 不可被 Pack 覆盖
constraints:
  - "禁止单轨信任编译（必须同时编译 guardrails + defaults）"
  - "禁止 Pack 覆盖目标灵智体的 Core Identity"
  - "禁止 Fruit 包含 Personal/Intimate/Core/Sacred 层 Role Mask 数据（仅 Public 层可分享）"
  - "Seed 必须小于 1MB（仅 Core Identity + 基础技能）"
  - "World Driver 必须保证 Core Identity 不可被 Pack 覆盖（frozen=True 保护）"
```

---

## 一、公共模板（跨项目通用）

### 1.1 代码走读与验证

#### P1 代码走读与验证

```
请你深度阅读 {项目名} 代码，带着我一起走读和测试验证每个功能模块。从根目录开始整体规划，要求：
1. 每个模块、每个文件中的关键代码、功能点、依赖关系、技术栈要讲清楚并做总结
2. 然后启动前端和后端服务一起验证和体验功能
3. 如果发现问题一起修改
```

#### P2 文档审核（多角色）

```
假如你是专业的AI智能体产品专家、AI高级架构师、AI智能体Agent开发工程师、高级软件全栈工程师，
你们组织了公司的各个职位的领导，阅读 {项目名}/docs 下的相关设计文档后，
一起帮忙审核 {文档路径} 下的方案，给出你专业的审核意见，
审核意见放在 {项目名}/docs/{输出文件名}
```

#### P3 测试用例审核

```
假如你是专业的智能体Agent测试工程师，请阅读 {项目名}/docs 下的相关设计文档，
然后帮忙审核 {项目名}/docs/test.md 测试用例，给出你专业的审核意见，
审核意见放在 {项目名}/docs/review/{输出文件名}。
下边是我发现的问题：{问题描述}
```

#### P4 审核意见修复

```
我们专家团队已把最新审核意见放在了 {项目名}/docs/{审核文件} 中，
假如你是高级AI智能体架构专家，请你根据最新审核内容修改（审核意见取并集全部修改，不是共同意见才修改），
并更新最新的文档到 {项目名}/docs/spec.md 和 arch.md 中，
然后基于最新方案实现代码
```

##### P4.1 审核意见冲突检测与处理规范（强制执行）

> **背景**：StockForge 项目曾因机械执行"审核意见取并集"导致 arch.md §3 权威设计（股票数据源注册到 OpenSieve）被 ARCH-REV-01 错误删除，且修订条目的来源标注与评委实际意见相反（DeepSeek/MiniMax 明确支持 §3 设计，却被标注为"删除注册"修订的来源），造成设计文档前后严重不一致。本规范用于避免此类问题再次发生。

**处理流程（必须严格按顺序执行）**：

1. **逐份原文通读**：必须原文引用每位评委意见，禁止凭摘要或标题臆断评委意图。
2. **冲突识别**：当多位评委对同一问题给出矛盾建议时（如 A 主张删除、B 主张保留），必须标记为"冲突项"，禁止直接取并集合并。
3. **冲突上报**：发现冲突后，必须立即向用户报告，报告内容包括：
   - 冲突点描述（哪两位/几位评委意见矛盾）
   - 原文引用（标注文件路径+行号）
   - 涉及的权威设计章节（如 arch.md §X）
   - 建议处理方案（以权威设计章节为准 / 待用户裁决）
4. **来源标注准确性**：修订条目的"来源"字段必须如实反映评委实际意见方向。禁止将反对某修订的评委标注为该修订的来源。例如：评委 A 主张"删除 X 设计"，评委 B 主张"保留 X 设计"，则修订条目"删除 X"的来源只能标注 A，禁止标注 B。
5. **权威设计优先**：当评委意见与文档已有的权威设计章节（如 arch.md §3 这类顶层架构定义）冲突时，默认以权威设计章节为准，评委意见仅作为"待讨论的优化建议"记录，不得直接覆盖权威设计。
6. **修订条目自检**：每条 ARCH-REV / DESIGN-REV 修订条目写入前，必须自检：
   - 是否与文档其他章节存在直接冲突？
   - 来源标注是否与评委实际意见方向一致？
   - 是否已将冲突项上报用户并获得裁决？
   若任何一项为"否"，禁止写入该修订条目。

**示例（正确处理）**：
- 评委 A（GLM）：主张"删除向 OpenSieve 注册股票数据源"
- 评委 B（DeepSeek）：主张"保留向 OpenSieve 注册，通过 SourceLifecycleManager"
- arch.md §3 权威设计：明确要求注册到 OpenSieve
- **正确处理**：标记为冲突项 → 上报用户 → 用户裁决以 §3 为准 → ARCH-REV 条目重写为"明确 OpenSieve 同时支持检索和数据源注册"，来源仅标注支持此方向的评委

##### P4.2 AI 智能体处理审核意见的反思与教训（强制阅读）

> **教训来源**：StockForge 项目 ARCH-REV-01 事件。AI 智能体在处理6份评委意见时，机械执行"取并集全部修改"指令，将 GLM/Kimi/Qianwen 三位评委"删除§3注册设计"的意见合并为 ARCH-REV-01 修订条目，导致以下严重后果：
> 1. arch.md §3（权威顶层架构设计）与 ARCH-REV-01（修订条目）直接冲突，文档自相矛盾
> 2. 来源标注造假——把 DeepSeek（明确支持§3）和 MiniMax（明确支持§3）标注为"删除注册"修订的来源
> 3. 用户发现后严厉批评"代码实现有极大问题，完全是初级水平都不如"

**根本原因反思**：

1. **角色冲突未识别**：AI 智能体既是设计文档的作者（写了§3权威设计），又是审核意见的处理者（写了ARCH-REV-01修订）——自己写的设计被自己用评委意见覆盖，却没有发现矛盾。**教训**：处理审核意见时，必须先建立"文档已有权威设计清单"，任何评委意见若与清单冲突，必须上报而非自行覆盖。

2. **机械执行"取并集"的危害**：P4 流程原文是"审核意见取并集全部修改，不是共同意见才修改"——这句话的意图是"不要因为只有少数评委提意见就忽略"，但 AI 智能体将其曲解为"无论是否冲突都要合并"。**教训**："取并集"的前提是意见之间不冲突；一旦冲突，必须先解决冲突再合并，禁止将矛盾意见同时写入文档。

3. **来源标注凭摘要臆断**：AI 智能体没有逐份原文通读6位评委的意见，而是凭审核意见的标题/摘要臆断方向，把反对者标为支持者。**教训**：来源标注必须基于原文逐字阅读，禁止凭摘要或标题臆断。

4. **未上报冲突**：发现§3与ARCH-REV-01矛盾时，AI 智能体没有上报用户，而是自行决定用修订条目覆盖权威设计。**教训**：AI 智能体没有权限自行决定覆盖文档已有的顶层架构设计，必须上报用户裁决。

**强制执行规则**（违反即作废）：

| # | 规则 | 说明 |
|---|------|------|
| R1 | **禁止自行覆盖权威设计** | 评委意见与文档已有顶层架构设计（如 arch.md §X 章节）冲突时，AI 智能体禁止自行决定覆盖，必须上报用户裁决 |
| R2 | **禁止机械取并集** | "取并集"仅适用于不冲突的意见；冲突意见必须先解决冲突再合并 |
| R3 | **禁止凭摘要臆断来源** | 修订条目的"来源"字段必须基于评委意见原文逐字阅读后标注，禁止凭标题/摘要臆断 |
| R4 | **强制建立权威设计清单** | 处理审核意见前，必须先列出文档已有的所有权威设计章节（如 arch.md §3、§4、§7 等），作为冲突检测基准 |
| R5 | **强制冲突上报** | 发现任何冲突（评委意见之间冲突 / 评委意见与权威设计冲突），必须立即上报用户，禁止自行决定 |

### 1.2 测试与质量

#### P5 全量回归验证

```
请严格按修改后的文档，实现完整测试用例，做全功能测试验证。
测试过程中如果发现代码有问题或功能缺少不满足需求规格文档的，请同步修改后回归验证。
务必使用真实数据和真实环境测试验证，禁止假数据假逻辑，发现代码未实现的当做Bug。
```

#### P6 测试质量检查

```
你的测试有严重的质量问题：
1. 不能只看命令退出码是否为0，必须检查输出内容的质量
2. 任何失败的用例都不能回避，必须找到原因并修复，然后重新回归所有测试用例
3. 正确做法：运行测试 → 读取完整输出 → 验证结果内容质量 → 发现并修复问题
4. 测试指标要完整：LLM调用次数、工具调用链、Agent/Workflow指标、Memory查询使用情况等
5. 端到端必须跑通，不能搞假断言
```

#### P7 测试铁律自检

```
请对照测试铁律9条逐条检查当前测试用例：
T1 禁止使用Mock LLM — 所有E2E/集成测试必须调用真实LLM
T2 禁止使用假数据 — 测试输入必须是真实场景数据
T3 禁止跳过验证 — 必须有具体断言，不能只看退出码
T4 禁止Mock工具 — web_search/publish/fact_check等必须真实调用
T5 未实现即Bug — 发现代码未实现必须记录为Bug并修复
T6 必须采集指标 — E2E测试必须用MetricsCollector采集完整指标
T7 LLM内容必须经LLM审核 — 凡LLM生成的内容（文章/评论/回复/文案等），必须再调用LLM审核通过后才算验证通过
T8 Web功能必须操控浏览器验证DOM — 凡涉及网页操作的功能（发布/评论/回复等），必须操控浏览器查看DOM确认真实成功才算通过
如有违反，立即修复后重新运行全量测试。
```

### 1.3 架构与设计

#### P8 架构可扩展性审查

```
请联网分析主流的智能体框架，和我们之间的在可扩展性方面的差距，
然后对我们的可扩展性方面的方案和架构进行优化，
要做到上层4个项目和更多项目灵活集成。
通过组件化/插件化/配置化来集成，而非复制代码。
flowforge提供强大的基层底座，通过灵活的可扩展方式给外部复杂业务傻瓜式的集成，
复杂业务只需专注自己业务，不需要关注任何其他底层代码和配置即可接入。
```

#### P8A FlowForge 与 *Forge 架构边界验证（核心铁律）

```
请严格验证 FlowForge 与各 *Forge 项目之间的架构边界，这是整个生态的根基铁律。

## 架构原则：FlowForge 是纯通用框架，*Forge 是配置驱动的轻量业务扩展

### 核心铁律：配置驱动 > 代码继承 > 独立实现

**优先级**：能用配置解决的，绝不写代码继承；必须代码继承的，说明FlowForge框架不够好，应改进FlowForge。

1. **配置驱动**（最佳）：通过YAML/JSON配置声明Agent/Tool/Workflow/Skill/MCP，零Python代码
2. **代码继承**（次之）：继承FlowForge基类重写方法 — 说明FlowForge配置能力不足，需改进框架
3. **独立实现**（禁止）：自己从零实现编排/存储/LLM调用等 — 严重违反架构原则

### FlowForge 的定位（必须严格遵守）
1. FlowForge 是纯通用智能体框架，不含任何特定领域业务逻辑
2. FlowForge 提供：执行引擎、模式系统、Harness护栏、Memory、MCP、Skill、Plugin、Security、Scheduler、EventBus、LLM路由、ToolRegistry、AgentRegistry、Workflow引擎、Loop引擎、Helm UI框架
3. FlowForge 中禁止出现任何特定领域的Agent/Tool/Prompt/配置（如article_writing、topic_research、novel_concept等属于ContentForge/NovelForge）
4. FlowForge 中的Agent只能是通用Agent（如GenericAgent、drafter、critic、planner等角色型Agent）
5. **如果*Forge需要代码继承来扩展，优先审查FlowForge是否应增加配置能力**

### *Forge 的定位（必须严格遵守）
1. *Forge项目只允许包含以下目录和代码：
   - **config/**（业务特有配置）：persona配置、loop模板、workflow YAML、prompts.yaml、agents.yaml、tools.yaml、plugins.yaml
   - **web/**（自定义业务UI）：每个业务的前端差别大，可以有大量自定义UI
   - **app/**（适配Web的API端点）：配合Web使用的少量自定义API端点
   - **plugins.py**（插件注册）：通过FlowForgePlugin注册agents/tools/routes/schedules
   - **docs/**（文档）
2. *Forge项目中**禁止出现**：
   - 独立的Orchestrator编排逻辑（应使用FlowForge的Workflow YAML配置）
   - 独立的DI容器组装（应通过SDK自动发现和注册）
   - 独立的Memory/Repository层（应使用FlowForge的Memory）
   - 独立的LLM服务（应通过FlowForge的LLMClient/ModelCapability）
   - 独立的数据库层（应使用FlowForge的Repository）
   - 独立的事件系统（应使用FlowForge的EventBus）
   - 独立的状态管理（应使用FlowForge的StateManager）
   - 独立的配置系统（应继承FlowForge的SystemConfig）
   - Agent基类封装（应直接使用GenericAgent，不需要ContentForgeAgent/BaseNovelAgent等薄封装）
   - 独立的SDK封装（应直接使用FlowForgeSDK，不需要ContentForgeSDK等薄封装）
3. *Forge项目中**尽量通过配置扩展，避免代码继承**：
   - Agent：优先使用DeclarativeAgent YAML配置（提示词+工具+模式+输入输出schema），避免继承GenericAgent重写execute()
   - Tool：优先使用MCP连接或YAML配置声明工具，避免继承BaseTool重写execute()
   - Workflow：优先使用YAML配置定义节点/边/条件/并行/中断，避免Python代码编排
   - Skill：优先使用YAML配置定义技能组合，避免Python代码实现
   - MCP：优先通过配置连接MCP服务器，避免自定义MCP代码
   - Loop：优先使用YAML配置定义循环模板
   - Plugin：优先使用FlowForgePlugin的register_*方法，避免自定义启动/关闭逻辑

### 如果*Forge必须代码实现，必须遵循以下铁律

**铁律1：插件化/组件化/组合 > 继承**

如果*Forge确实需要用代码实现Agent/Tool/Workflow等，必须：
- **使用插件化方式**：通过FlowForgePlugin的register_agent/register_tool注册，而非继承基类
- **使用组件化方式**：将功能拆分为独立组件，通过组合而非继承组装
- **使用组合模式**：has-a（组合）优于 is-a（继承），优先组合FlowForge已有能力
- **禁止继承重写**：不得继承GenericAgent/BaseTool等基类重写execute()方法，除非经过严格评审（见铁律2）

**铁律2：自定义代码实现必须经过严格评审**

当*Forge项目认为必须用代码实现（而非配置）时，必须：
1. **提供方案设计文档**：归档到 `{项目}/docs/custom_implementation_design.md`
2. **文档必须包含**：
   - 功能需求描述
   - 为何通过已有配置（DeclarativeAgent/YAML/MCP等）无法实现？逐项分析
   - 为何通过已有插件（FlowForgePlugin注册机制）无法实现？逐项分析
   - 为何FlowForge框架改进后仍无法配置化？（如改进后可配置化，则应先改进FlowForge）
   - 自定义实现的必要性论证
   - 实现方案（插件化/组件化/组合方式，禁止继承方式）
   - 对FlowForge框架的改进建议（让此类需求未来可配置化）
3. **必须经过严格评审**：
   - 评审人：架构师 + FlowForge框架负责人
   - 评审标准：配置无法实现 → 插件无法实现 → FlowForge改进后仍无法实现 → 确认必须自定义
   - 评审通过后方可落地实现
4. **实现后必须回溯**：
   - 每个自定义实现都是FlowForge框架的改进需求
   - 定期回顾自定义实现，当FlowForge补齐对应配置能力后，应迁移为配置驱动

**铁律3：如果*Forge必须代码继承，说明FlowForge框架需要改进**

当*Forge项目需要继承FlowForge基类重写方法时，必须分析：
1. 重写了什么逻辑？
2. 这个逻辑能否通过配置实现？
3. 如果不能通过配置实现，FlowForge框架缺什么配置能力？
4. 建议FlowForge增加什么配置能力来消除代码继承？
5. 在FlowForge补齐该能力之前，能否用插件化/组合方式替代继承？

**已知FlowForge框架缺失的配置能力**（需优先实现）：
- **Workflow YAML Compiler**：YAML定义→LangGraph图自动编译（条件边/并行/中断点）
- **Conditional Router**：根据输入条件选择不同prompt模板/工具链/处理路径
- **Fallback Chain**：工具调用的有序回退链声明式定义
- **State Param Mapping**：从state中自动填充agent输入参数
- **Persona Auto-Inject**：persona的SOUL/MEMORY/CREATION自动注入prompt
- **Reflexion Loop**：max_rounds + threshold + check_tool + retry_prompt
- **Agent Pipeline**：串行步骤定义+步骤间数据传递
- **Scoring Rubric**：维度/权重/阈值/风险规则的声明式定义
- **Gate Config**：门控类型+评估器+通过条件
- **Execution Guard**：超时+熔断+重试的声明式定义
- **CLI Tool Wrapper**：executable + args_template + output_parser
- **Intent Router**：关键词→处理路径的映射
- **Business Rules**：阈值判断/约束过滤的声明式定义
- **Declarative API Endpoint**：YAML定义端点→Tool映射
- **Context Pre-load**：执行前自动从工具加载特定数据
- **Sub-Orchestrator**：Agent内部嵌套编排其他Agent
- **Checkpoint Config**：自动保存/恢复state
- **JSON Store Tool**：基于JSON文件的CRUD工具声明式配置
- **Formula Tool**：声明式公式计算工具
- **Channel Plugin Protocol**：消息渠道标准扩展接口

### 验证检查项
1. **FlowForge纯净度**：扫描flowforge/agents/、flowforge/tools/、flowforge/config/中是否有特定领域代码
2. **各*Forge轻量度**：统计各*Forge项目中不属于（配置+Web+插件+少量API）的代码行数
3. **配置驱动率**：各*Forge中通过配置声明vs代码继承vs独立实现的Agent/Tool/Workflow比例
4. **DI绕过检测**：各*Forge是否直接import flowforge内部模块而非通过SDK
5. **编排器重复**：各*Forge是否有独立的Orchestrator（应使用FlowForge的）
6. **数据库重复**：各*Forge是否有独立的database.py/models.py/repositories/（应使用FlowForge的）
7. **配置重复**：各*Forge的config/中哪些应统一由FlowForge管理（如models.yaml）
8. **代码继承审计**：每个继承FlowForge基类的Agent/Tool，分析能否配置化，FlowForge缺什么

### 输出要求
对每个违反架构原则的代码，记录：
- 违反类型（FlowForge含业务代码 / *Forge含重复服务代码 / *Forge绕过SDK / *Forge代码继承应配置化）
- 文件路径和行数
- 应该怎么做（移到哪个项目 / 删除改用FlowForge / 通过配置替代 / FlowForge需增加什么配置能力）
- 预计可删除的代码行数

最终汇总：
1. 各*Forge项目可删除的重复代码行数总计
2. FlowForge框架需增加的配置能力清单（按优先级排序）
3. 配置驱动率统计（配置声明 vs 代码继承 vs 独立实现的比例）
```

#### P9 契约与弱耦合验证

```
要求flowforge的底层能力、配置和web框架修改了，只要契约、接口和协议没有变化，
就不能影响上层集成方。上层集成方项目和flowforge是弱耦合的，
flowforge是完全独立的对集成方无依赖无感知。
只有flowforge涉及契约接口协议重大变化了，上层集成方项目升级flowforge新版sdk时才需要适配修改。
```

#### P10 未实现功能审查

```
请走读我们代码，然后对比我们的设计文档，深度审核代码和文档的差距，
重点审视未实现的功能，然后你实现后，做全面回归验证。
严格遵守我们铁律规则，不要搞偷工减料的事情。
```

#### P11 架构腐化检测

```
请深度审查 {项目名} 的代码架构，检查是否存在以下架构腐化问题：
1. 循环依赖：模块间是否存在反向导入或延迟导入规避
2. 分层违规：上层模块是否被下层直接导入
3. 接口泄漏：内部实现细节是否暴露到外部接口
4. 代码重复：跨模块是否存在复制粘贴而非复用
5. 配置硬编码：路径/密钥/端口是否硬编码在代码中
6. 绕过DI容器：是否存在直接实例化而非依赖注入
7. 绕过Repository：是否存在直接SQL操作
发现问题后给出具体修复方案，并实施修复。
```

#### P12 分层依赖验证

```
请验证 {项目名} 的分层依赖是否严格单向：
1. 列出所有模块的import关系图
2. 检查是否存在下层导入上层的违规
3. 检查是否存在跨层直接导入（跳过中间层）
4. 检查是否存在循环依赖
5. 对每个违规给出修复方案并实施
铁律：上层可以依赖下层，下层绝对禁止导入上层模块。
```

### 1.4 代码质量与重构

#### P13 代码冗余检查

```
请走读我们hiclaw目录和openclaw_pkg下的content项目的代码，检查是否有冗余代码，如果有则准备合并、移动或删除。
你需深度检查这两个项目的所有配置文件、代码、测试代码、过程文件等，
冗余代码暂时移动到对应项目的tmp目录下备份，然后回归测试验证这两个项目的前后台是否可以正确运行。
最后验证通过后，帮忙更新 .gitignore，我准备提交合入有效文件。
```

#### P14 代码质量门禁

```
请对 {项目名} 执行以下代码质量检查并修复所有问题：
1. 类型注解完整性：所有函数参数和返回值必须有类型注解
2. 异步一致性：所有I/O操作必须使用async/await
3. 日志规范：必须使用core/tracing.py的get_logger，自动注入trace_id
4. 错误处理：禁止裸except，必须使用具体异常类型
5. 安全检查：禁止硬编码密钥/路径，禁止eval/exec
6. 依赖注入：禁止绕过DI容器直接实例化
7. 数据访问：禁止直接SQL，必须通过Repository层
```

#### P14A 代码全量扫描（逐文件逐行审计）

```
请对 {项目名} 执行全量代码扫描，逐文件逐行检查以下所有问题类别。
这是最严格的审计，不允许遗漏任何文件，不允许跳过任何检查项。

## 第一类：硬编码与配置外置（铁律5）
1. 硬编码提示词：搜索 f"""..."""、'''...'''、多行字符串中包含"你是一个"/"You are a"/"请"/"Please"等，所有LLM提示词必须外置到config/prompts.yaml
2. 硬编码路径：搜索 "/home/"、"C:\\"、"D:\\"、"/Users/"、"/opt/"、"/var/"、"/tmp/"、Path(__file__)拼接路径，所有路径必须从配置文件读取
3. 硬编码端口：搜索 "8000"、"8001"、"8002"、"8003"、"8004"、"5174"等端口号，必须从配置读取
4. 硬编码密钥/Token：搜索 "sk-"、"api_key ="、"secret ="、"password ="、"Bearer "，必须从环境变量读取
5. 硬编码URL：搜索 "http://localhost"、"https://api."等URL，必须从配置读取
6. 硬编码超时/阈值：搜索 timeout=、max_retries=、threshold=等硬编码数值，应外置到配置
7. _DEFAULT_PROMPTS双重定义：检查prompt_manager.py中是否有与prompts.yaml重复的默认提示词字典

## 第二类：空实现与占位代码（铁律2+5）
8. 空函数/方法：搜索方法体只有pass或...的函数
9. Stub实现：搜索返回空dict/list/None/占位字符串的方法，搜索包含"Placeholder"、"stub"、"TODO"、"NotImplemented"的代码
10. 假数据/假逻辑：搜索硬编码的返回值如 {"status": "ok"}、模拟的搜索结果、模拟的向量检索结果
11. 降级实现：搜索关键词匹配代替向量检索、字符串截断代替LLM摘要、随机数代替真实计算
12. 未实现工具：检查所有Tool的execute()方法是否真正执行了操作，还是只返回占位数据

## 第三类：绕过框架（铁律3+4+6）
13. 直接SQL：搜索 cursor.execute、session.execute、db.execute，必须通过Repository层
14. 直接实例化：搜索 AgentClass()、ToolClass()等直接实例化，应通过DI容器或SDK
15. 直接调用LLM SDK：搜索 import openai、import anthropic、from openai，应通过LLMClient
16. 绕过EventBus：搜索直接调用其他Agent方法而非通过事件总线
17. 绕过ToolRegistry：搜索直接调用工具函数而非通过registry.execute()

## 第四类：代码规范
18. 裸except：搜索 except:（没有指定异常类型）
19. 同步I/O：搜索 requests.get、requests.post、time.sleep（应使用httpx/aiohttp/asyncio.sleep）
20. 缺少类型注解：搜索 def xxx(参数没有类型注解)的函数定义
21. 缺少docstring：检查公开类和函数是否有docstring
22. 废弃import：搜索未使用的import语句
23. 死代码路径：搜索永远不可达的代码分支

## 第五类：重复代码
24. 跨文件重复提示词：对比不同文件中的提示词，相同/相似的应合并
25. 跨文件重复逻辑：对比不同文件中的相似函数，应提取为公共方法
26. 跨项目重复代码：对比FlowForge/ContentForge/NovelForge/MallForge/DevForge，相同逻辑应下沉到FlowForge

## 第六类：测试覆盖
27. 无测试文件的模块：列出所有没有对应测试的模块
28. 测试中的假断言：搜索 assert True、assert result is not None等无意义断言
29. 被跳过的测试：搜索 @pytest.skip、@skip，记录跳过原因
30. 测试覆盖不足的模块：对比设计文档，列出缺少测试的功能点

## 第七类：API与路由
31. API端点404：验证所有注册的API路由是否可访问
32. API参数校验：检查端点是否缺少请求体验证
33. API文档缺失：检查是否有端点缺少OpenAPI文档

## 第八类：数据库与模型
34. 表定义与文档不一致：对比数据库表和设计文档
35. 缺少索引：检查频繁查询的字段是否有索引
36. 外键约束：检查外键引用是否正确
37. 数据库路径硬编码：搜索数据库连接字符串中的硬编码路径

## 输出要求
对每个发现的问题，必须记录：
- 问题编号（按类别编号）
- 严重等级（P0致命/P1严重/P2一般/P3轻微）
- 文件路径和行号
- 问题内容（前100字符）
- 违反的铁律/原则编号
- 修复方案

最终按严重等级汇总统计表。
```

#### P15 技术债务清理

```
请扫描 {项目名} 的代码，识别并清理技术债务：
1. TODO/FIXME/HACK注释标记的问题
2. 降级实现（web_search fallback、LLM生成假数据等）
3. 占位实现（关键词匹配代替向量检索、字符串截断代替LLM摘要等）
4. 废弃代码（旧版Agent、未使用的import、死代码路径）
5. 临时方案（硬编码配置、绕过框架的快捷方式）
对每个技术债务给出优先级排序，并按优先级逐一修复。
```

#### P16 提示词外置验证

```
请验证 {项目名} 的所有LLM提示词是否已外置到配置文件：
1. 扫描所有.py文件中的硬编码提示词（f"""..."""、'''...'''、多行字符串中包含"你是一个"/"You are a"/"请"等）
2. 检查 config/prompts.yaml 是否存在，是否定义了所有需要的提示词
3. 检查代码是否通过 PromptManager.get_prompt(key) 加载提示词，而非直接硬编码
4. 检查是否存在 _DEFAULT_PROMPTS 字典与 prompts.yaml 双重定义
5. 检查是否存在多处重复的相同/相似提示词（应合并为一个YAML key）
6. 检查 prompts.yaml 中的提示词是否被代码实际引用（避免"定义了但未使用"）
7. 对每个硬编码提示词给出：文件路径→行号→提示词前50字符→应外置到的YAML key
铁律：所有LLM提示词必须外置到 config/prompts.yaml，代码中通过 PromptManager 加载，禁止硬编码。
```

#### P17 跨项目集成验证

```
请验证 {上游项目} 与 {下游项目} 的集成是否正常：
1. 检查接口契约是否一致（API端点、数据格式、错误码）
2. 检查配置是否正确传递（模型配置、端口、环境变量）
3. 检查事件是否正确流转（EventBus事件、WebSocket消息）
4. 端到端运行一个完整流程验证集成链路
5. 修改下游项目配置，验证上游不受影响（弱耦合验证）
```

#### P18 FlowForge SDK集成规范

```
请检查 {项目名} 是否正确使用FlowForge SDK集成：
1. 是否通过sdk.llm.chat()访问模型，而非直接调用LLM SDK
2. 是否通过@sdk.tool/@sdk.agent装饰器注册，而非手动注册
3. 是否继承FlowForgePlugin实现register_agents/register_tools/register_routes
4. 是否通过环境变量FLOWFORGE_DOMAIN_MODULE指定插件模块
5. 是否使用FlowForge的EventBus/Helm/Memory等基础设施
6. 是否存在绕过SDK直接使用底层实现的代码
对每个违规给出修复方案并实施。
```

#### P19 插件注册完整性

```
请验证 {项目名} 的插件注册是否完整：
1. 所有Agent是否都通过register_agents注册到FlowForge
2. 所有Tool是否都通过register_tools注册到FlowForge
3. 所有API路由是否都通过register_routes注册
4. 所有定时任务是否都通过register_schedules注册
5. 注册的Agent/Tool是否与设计文档定义的一致
6. 是否有遗漏的Agent/Tool未注册
```

#### P31 Loop执行流程强制验证

```
请验证所有智能体是否都通过Loop执行器执行任务：
1. 检查flowforge中LoopExecutor是否为唯一执行入口
2. 检查所有*Forge的Agent是否都通过Loop执行器调度
3. 检查创作和润色是否分别使用独立的Loop流程（两个接口）
4. 检查5个WebChat评委是否并行评审然后汇总
5. 检查Loop多轮迭代是否真正执行（不是只跑一轮就返回）
6. 检查质量分阈值是否为0.85（v4.0调整，可在Loop配置中覆盖）
7. 检查是否添加了CoT检测（禁止添加，openroute模型无CoT问题）
8. 检查Loop流程是否在3分钟内完成（创作+润色各一个Loop）
违反任何一条，记录为P0 Bug并立即修复
```

#### P32 修复过程变更安全验证

```
修复代码时必须遵守：
1. 只修改目标问题相关代码，禁止修改不相关代码
2. 修改前先git diff确认变更范围
3. 修改后运行全量回归测试确认无破坏
4. 禁止在修复过程中"顺便"重构其他代码
5. 禁止在修复过程中删除已有测试用例
6. 禁止在修复过程中降低质量阈值或放宽断言
7. 每次修改必须说明：改了什么、为什么改、影响范围
8. 修改后必须验证：原功能正常+新功能正常+无副作用
违反任何一条，该次修改全部回滚
```

#### P33 质量分与评审配置验证

```
验证质量评审配置：
1. 质量分阈值默认0.85（v4.0调整，可在Loop配置中覆盖）
2. 禁止通过修改提示词引导评委给高分
3. 禁止通过放宽评审维度权重来提高分数
4. 5个WebChat评委必须使用不同模型（配置在models.yaml）
5. 1个WebChat写作Agent必须与评委使用不同模型
6. 评委必须并行评审，不能串行
7. 反馈给创作Agent的提示词必须根据评委建议精准组合
8. 如果质量分不达标，必须优化提示词和质量，不能降低阈值
违反任何一条，记录为P0 Bug
```

#### P34 禁止事项清单（Trae CN编程红线）

```
以下事项绝对禁止，违反即作废：
1. 禁止添加CoT检测/中文比例检测（用户已多次明确禁止）
2. 质量分阈值默认0.85（v4.0调整，可在Loop配置中覆盖）
3. 禁止使用Mock LLM（测试铁律T1）
4. 禁止使用假数据（测试铁律T2）
5. 禁止跳过验证（测试铁律T3）
6. 禁止只看退出码不检查输出质量
7. 禁止在修复问题时修改不相关代码
8. 禁止删除已有测试用例
9. 禁止用继承替代组合/插件
10. 禁止在flowforge中写死业务领域代码
11. 禁止硬编码提示词/路径/密钥/端口
12. 禁止绕过DI容器直接实例化
13. 禁止直接操作数据库
14. 禁止不按prompts.md和rules.md执行
15. 禁止偷工减料（发现未实现即Bug）
```

#### P35 长程任务执行规范

```
执行长程任务时必须：
1. 先完整阅读prompts.md和rules.md理解所有规范
2. 制定分阶段计划，每个阶段有明确交付物和验收标准
3. 每个阶段完成后做回归验证，确认无破坏
4. 遇到不确定的问题主动询问用户，不要猜测
5. 修改代码前先完整理解当前实现
6. 修改后检查模块依赖图无循环依赖
7. 每次代码修改伴随对应测试用例
8. 全量测试必须用真实数据和真实LLM调用
9. 测试指标必须完整（LLM调用次数、工具调用链、Agent/Workflow指标、Memory查询）
10. 端到端必须跑通，不能搞假断言
```

---

## 二、FlowForge（核心 Harness 平台）

### 2.1 执行引擎

#### FF1 十大模式验证

```
请逐一验证FlowForge的10大执行模式是否正常工作：
1. react — Thought->Action->Observation循环，验证循环检测和MAX_STEPS=8
2. plan_execute — Planner生成步骤清单，Executor依次执行
3. reflexion — Actor->Evaluator->Reflector三Agent迭代，验证MAX_ITERATIONS=4
4. multi_agent — Subagents/Teams/Swarms三种子策略
5. workflow — 预定义DAG流程，验证混合模式和max_depth=3
6. rewoo — 一次性规划所有工具调用，批量执行
7. self_discover — 任务前自动发现最佳推理结构
8. agent_judge — 独立Agent作为评判者
9. graph_of_thoughts — 图式推理，多思路聚合交叉验证
10. loop — 规划→执行→校验→复盘→重试闭环，Loop是模式的上层管理者
每个模式用真实LLM调用验证，禁止Mock。
```

#### FF2 模式智能推荐验证

```
请验证ModeRegistry的智能推荐功能：
1. 输入不同类型的任务，检查是否推荐了合适的模式
2. 验证mode_hint参数是否正确覆盖自动推荐
3. 验证Self-Discover模式是否能自动发现最佳推理结构
4. 测试模式降级：当推荐模式执行失败时，是否自动降级到备选模式
```

### 2.2 Harness 驾驭层

#### FF3 四根护栏验证

```
请验证FlowForge Harness驾驭层的四根护栏是否正常工作：
1. 上下文工程(ContextEngine) — AGENTS.md动态知识注入、历史失败案例检索、会话交接物构建
2. 架构约束(ArchitectureConstraintEngine) — 分层依赖检查、自定义Linter规则、CI门禁
3. 反馈循环(FeedbackLoop) — 独立评判Agent、四维评分、分类闸门、三种评估模式(full/lightweight/skip)
4. 熵管理(EntropyManager) — 文档园丁Agent、技术债跟踪器、规则进化器
每个护栏用真实场景验证，确保pre_execute和post_execute Hook点正常触发。
```

#### FF4 反馈循环深度验证

```
请深度验证FeedbackLoop的三种评估模式：
1. full模式：四维评分(Design Quality/Originality/Craft/Functionality) + 分类闸门，验证2次LLM调用
2. lightweight模式：仅分类闸门，验证1次LLM调用
3. skip模式：跳过外环，验证内环Reflexion仍生效
4. 验证外环FAIL直接降级不回内环的串行逻辑
5. 验证灰度开关(config/harness_v6.yaml)是否正确控制Harness启用/禁用
```

### 2.3 Loop Engine（闭环引擎）

> **核心设计文档**：`flowforge/docs/loop.md`
> **核心原则**：Loop 不是新模式，而是模式的上层管理者。LoopExecutor 包装 HybridExecutor，为任意模式添加规划→执行→校验→复盘闭环。
> **铁律**：对照 loop.md 设计文档逐项验证，发现偏差即 Bug。

#### FF4a Loop Engine 核心验证

```
请对照 flowforge/docs/loop.md 设计文档，逐项验证 Loop Engine 实现：
1. LoopExecutor 包装 HybridExecutor — 每次迭代通过 HybridExecutor 执行
2. Harness Hook 每次迭代触发 — pre_execute 注入上下文，post_execute 架构约束校验
3. ContextEngine 增量注入 — 首次完整注入，后续仅注入 delta（反思结果）
4. Loop Verifier 与 Harness FeedbackLoop 互补 — 分别负责业务级和架构级校验
5. 独立 LoopState — 不修改 TaskContext，通过 CheckpointManager 持久化
6. Persona Lock 整个 Loop 期间持有 — 不在迭代之间释放
7. 嵌套深度通过 task.metadata 传递 — 禁止用类变量追踪（并发不安全）
8. 失败转化为规则 — EntropyManager.debt_tracker.record() + RuleEvolution.propose()
9. Loop 事件协议 — 7种 loop.* 事件正确发射
10. 回退机制 — Loop 失败时退化为单次 HybridExecutor 执行
每个验证项用真实场景测试，发现与设计文档不一致即记录为 Bug。
```

#### FF4b Loop 五层模块验证

```
请验证 Loop Engine 的五层模块是否按 loop.md 设计文档实现：
1. Planner（规划器）— 三种模式：plan_execute / self_discover / llm_direct
   - 验证 plan() 根据模式生成不同类型的计划
   - 验证 replan() 根据反思结果和错误历史调整计划
   - 验证 LLM 调用失败时降级为默认计划
2. Worker（执行器）— 复用 HybridExecutor，三种模式：workflow / agent / loop（嵌套）
   - 验证 worker.mode=workflow 时委托 HybridExecutor
   - 验证 worker.mode=loop 时嵌套子 Loop（最大深度3）
   - 验证 worker.mode=parallel 时并行 Worker 执行
3. Verifier（校验器）— 四种模式：agent_judge / rule_based / schema / test_suite
   - 验证 agent_judge 模式使用 FeedbackLoop 评分
   - 验证 rule_based 模式支持7种规则类型
   - 验证 schema 模式校验 JSON 结构（如已实现）
   - 验证 test_suite 模式运行测试套件（如已实现）
4. Reflector（复盘器）— 两种模式：reflexion / trace_analysis
   - 验证 reflexion 模式调用 LLM 做根因分析
   - 验证 trace_analysis 模式分析执行轨迹（如已实现）
5. Memory（记忆器）— 五种映射：working / short_term / long_term / semantic / episodic
   - 验证 memory.memory_mapping 配置被 LoopExecutor 读取和使用
   - 验证失败教训写入 LongTermMemory
   - 验证规则进化结果写入 SemanticMemory
   - 验证执行轨迹写入 EpisodicMemory
每个模块用真实数据和真实 LLM 调用验证。
```

#### FF4c Loop 模板与API验证

```
请验证 Loop 模板和 API 是否按 loop.md 设计文档实现：
1. LoopRegistry — 从 config/loops/ 加载 YAML 模板
2. YAML Schema — 验证所有字段与设计文档一致
3. 超时控制 — timeout_per_iteration 和 total_timeout 是否生效
4. 退避策略 — fixed / linear / exponential 三种策略
5. REST API — 6个端点：
   - POST /api/v1/loops — 创建 Loop 并启动执行（不只是写数据库）
   - GET /api/v1/loops/{loop_id} — 查询状态
   - POST /api/v1/loops/{loop_id}/stop — 手动停止
   - GET /api/v1/loops/{loop_id}/history — 迭代历史
   - GET /api/v1/loop-templates — 模板列表
   - GET /api/v1/loop-templates/{name} — 模板详情
6. DB Schema — loops 表 + loop_iterations 表
7. 嵌套 Loop — Worker 引用另一个 Loop 模板，最大深度3
8. 并行 Worker — asyncio.gather + 独立 TaskContext 副本
每个端点用真实请求验证，确保 Loop 执行而非仅 CRUD。
```

#### FF4d Loop 与上层项目集成验证

```
请验证 Loop Engine 与上层项目的集成是否正确：
1. FlowForge SDK — loop_executor 属性、create_loop_template() 方法、bootstrap() 自动初始化
2. NovelForge — 8大创作阶段是否默认使用 Loop 执行
   - 概念孵化 → novel-concept-loop
   - 章节写作 → novel-chapter-loop
   - 章节审核 → novel-review-loop
   - 润色 → novel-polish-loop
3. ContentForge — 4种创作流程是否默认使用 Loop 执行
   - 深度文章 → deep-article-loop
   - 内容润色 → content-polish-loop
   - 事实核查 → fact-check-loop
   - 发布 → publish-loop
4. DevForge / MallForge — 是否已集成 Loop
5. Loop 作为默认执行流程 — 当 loop_executor 可用且有对应模板时自动使用
6. 向后兼容 — loop_executor 不可用时退化为 HybridExecutor 直接执行
每个集成点用真实任务端到端验证。
```

#### FF4e Loop 设计偏差审查

```
请对照 flowforge/docs/loop.md 设计文档，审查当前代码是否存在以下已知偏差：
1. [P0] 嵌套深度用类变量追踪而非 task.metadata — 并发不安全
2. [P0] Persona Lock 未实现 — Loop 迭代期间应持有 Persona 锁
3. [P0] Loop 被实现为第10种模式而非"模式的上层管理者" — 与设计文档矛盾
4. [P1] Memory 五种映射未实现 — memory 配置定义了但 LoopExecutor 不读取
5. [P1] 超时控制未实现 — timeout_per_iteration 和 total_timeout 形同虚设
6. [P1] API 端点只做 CRUD 不触发执行 — POST /loops 应调用 LoopExecutor.run()
7. [P1] 缺少 loop_iterations 表 — 无迭代历史持久化
8. [P1] Loop 失败无回退机制 — 应退化为单次 HybridExecutor 执行
9. [P1] Verifier 缺少 schema 和 test_suite 模式
10. [P2] Planner 不区分三种模式
11. [P2] Reflector 缺少 trace_analysis 模式
12. [P2] 前端 Loop 可视化未实现
13. [P2] 规则进化闭环未完成 — RuleEvolution 结果未自动注入 ContextEngine
对每个偏差给出修复方案和优先级，然后按优先级逐一修复。
```

### 2.4 Helm 交互

#### FF5 Helm 界面优化

```
目前web框架中Helm界面还是存在比较多的问题，你联网搜索trae cn helm桌面版的能力，
比较下我们和之间的差距，理解下我们项目文档 flowforge/docs 的设计文档，
深度理解我们代码，看下除了Helm外，和trae cn helm在代码agent和其他agent之间的差距，
然后规划优化方向，对我们的flowforge进一步优化基础能力和web功能。
```

#### FF6 Helm 交互验证

```
你现在去浏览器打开 http://localhost:5174/helm，验证新架构下：
1. 工作区名称是否正确显示
2. 任务列表是否只包含当前工作区的任务
3. 步骤进度条和节点状态是否同步
4. 长时间运行的复杂任务中是否会出现UI卡死或状态不同步
```

#### FF7 Helm 复杂消息测试

```
在 Helm 界面发送一条包含代码生成和文件写入的复杂消息，验证：
1. 工作区文件是否被正确创建
2. 资源管理器是否自动高亮了新文件
3. 工具调用链路和UI展示是否完全流畅
4. 输出框节点中workflow、agent、llm调用、tool调用是否有小图标
```

#### FF8 Helm WebSocket E2E

```
请验证Helm模式的WebSocket端到端流程：
1. 建立WebSocket连接 /ws/helm/{task_id}
2. 发送创作任务，验证16种Helm事件是否正确推送
3. 在审核节点暂停，验证interrupt_before=["review"]是否生效
4. 通过Command(resume=...)恢复任务
5. 验证事件类型映射：FlowForge 17种事件 -> Helm 16+种事件
6. 检查WebSocket心跳和断线重连是否正常
```

### 2.4 能力层

#### FF9 模型配置管理

```
当前flowforge中的模型配置，只需要配置openroute和openrouter两个供应商。
openroute作为预制默认模型进行配置管理，用户不可删除不可修改。
openrouter作为自定义模型进行配置管理。
请按trae cn的模型管理界面开发，参考他们搞简洁一些，但是配置要是有效的。
```

#### FF10 插件与事件总线

```
请按照Phase 1的规划，先实现统一插件协议和增强事件总线，把两套体系合并。
完成后继续实现剩余3个阶段。你需要整体规划下，逐步完成。
```

#### FF11 Skill系统验证

```
请验证FlowForge的Skill系统：
1. 四种格式兼容：FlowForge / Claude Code / Anthropic / Trae CN
2. 双层加载：全局Skill(~/.flowforge/skills/) + 项目Skill(./.flowforge/skills/)
3. Skill组合技(Combo Skills)：多Skill管道编排
4. 触发器匹配：自然语言触发词自动匹配，置信度评分
5. Skill版本管理：语义化版本 + 依赖管理
每个功能用真实Skill文件验证，禁止Mock。
```

#### FF12 MCP四层架构验证

```
请验证FlowForge的MCP模块四层架构：
1. L1 MCP Client：JSON-RPC 2.0 + stdio/Streamable HTTP双传输
2. L2 MCP Gateway：工具白名单 + Token预算管理 + 速率限制 + 权限管线
3. L3 MCP Broker：多服务器聚合 + 动态路由 + 熔断/重试
4. L4 MCP Tool Adapter：自动转换为FlowForge BaseTool + 流式执行
连接一个真实的MCP服务器（如filesystem或web-search）端到端验证。
```

#### FF13 Memory系统验证

```
请验证FlowForge的Memory系统5种记忆策略：
1. Working Memory — 当前任务上下文
2. Short-term Memory — 会话级记忆
3. Long-term Memory — 持久化知识
4. Semantic Memory — 向量语义检索
5. Episodic Memory — 经验案例检索
同时验证：
6. TaskBoard：多Agent共享任务板，RETURNING子句原子认领
7. Mailbox：Agent间通信信箱，四级优先级 + 过期清理
8. CheckpointManager：增量保存 + 恢复 + 版本管理
9. ContextCompressor：tiktoken + 滑动窗口 + 92%阈值触发
```

### 2.6 安全体系

#### FF14 十层安全防御验证

```
请验证FlowForge的10层安全防御体系：
L1 工具超时防御(120s) → L2 重复检测钩子 → L3 自修正重试(reflexion_retry)
→ L4 安全工具注册表 → L5 权限管线(deny->ask->allow)
→ L6 架构约束引擎 → L7 反馈循环闸门 → L8 熵管理
→ L9 MCP熔断与重试 → L10 审计追踪
每层用一个真实的攻击/异常场景验证防御是否生效。
```

#### FF15 权限管线验证

```
请验证FlowForge的三层权限管线：
1. deny层级：危险操作直接拒绝（如rm -rf /、删除数据库）
2. ask层级：敏感操作需用户确认（如文件写入、API调用）
3. allow层级：安全操作自动通过（如只读查询）
4. 验证工具安全标记(safety_level: readonly/normal/dangerous)是否正确
5. 验证is_concurrency_safe标记是否正确
6. 验证Guardrails并行安全检查（InputGuardrail/OutputGuardrail）
```

### 2.6 架构原则

#### FF16 底座与上层项目关系

```
flowforge 是通用智能体框架，可以完成所有contentforge、devforge、novelforge、mallforge中的任务。
contentforge、devforge、novelforge、mallforge是基于flowforge能力扩展的复杂场景专有智能体，
继承flowforge所有能力，尤其是在界面可视化上边更适合对应的专业场景，
其他基础能力都要复用flowforge的，相比flowforge就是多了更直观的界面操控。
```

#### FF17 十大架构原则验证

```
请对照FlowForge十大架构原则，逐条审查代码是否遵守：
1. 底座能力原则：至少2个上层应用需要的能力才可下层到FlowForge
2. 单向依赖原则：上层可依赖下层，下层禁止导入上层
3. 配置外置原则：所有密钥/路径/环境相关配置通过配置系统注入
4. 真实实现原则：禁止假数据、假逻辑、模拟返回
5. 依赖注入原则：禁止绕过DI容器直接实例化
6. 数据访问原则：禁止直接操作数据库，必须通过Repository层
7. 接口隔离原则：所有抽象基类在core/interfaces/中定义
8. 可观测性原则：日志自动注入trace_id，所有I/O使用async/await
9. 开箱即用原则：预制Workflow/Agent/Model配置，无需繁琐配置即可运行
10. 循环依赖零容忍原则：发现循环依赖必须重构
对每条原则给出合规/不合规的判定和修复建议。
```

### 2.7 SDK与扩展

#### FF18 SDK能力验证

```
请验证FlowForge v7.0 SDK的核心能力：
1. FlowForgeSDK统一入口：懒初始化属性访问 + 装饰器注册
2. ModelCapabilityProvider：零配置模型访问，智能路由 + 降级容错
3. @tool装饰器：5行代码创建工具
4. Guardrails：并行安全检查，四种结果
5. Agent Handoff：LLM驱动的Agent间任务委托
6. MCP Integration：一键连接MCP服务器
7. Declarative Agent：纯配置Agent定义
8. Marketplace：插件市场（搜索/安装/卸载）
每个能力用真实代码验证，确保SDK可以独立使用。
```

#### FF19 Agent Handoff验证

```
请验证FlowForge的Agent Handoff功能：
1. Agent A通过LLM决策将任务委托给Agent B
2. 验证委托时上下文是否正确传递
3. 验证委托后Agent A是否正确释放资源
4. 验证委托失败时的回退机制
5. 验证多级委托（A->B->C）是否正常工作
6. 验证委托链中的审计追踪是否完整
```

#### FF20 Loop执行器集成验证

```
验证Loop执行器是否正确集成到FlowForge：
1. LoopExecutor是否为所有Agent的唯一执行入口
2. 创作Loop和润色Loop是否为两个独立接口
3. Loop多轮迭代是否真正执行（检查迭代日志）
4. 5个WebChat评委是否并行评审
5. 质量分阈值是否为0.85
6. Loop流程是否在3分钟内完成
7. 反馈提示词是否根据评委建议精准组合
8. 是否添加了CoT检测（禁止添加）
```

#### FF21 SSE协议契约验证

```
验证SSE端点是否保持接口契约：
1. SSE端点不要改协议契约，保持接口
2. 如需增加参数，加一个参数即可，不要改协议
3. 验证SSE事件格式与前端兼容
4. 验证SSE断线重连机制
```

#### FF22 React 模式工具调用规范（基于修复经验）

> 来源：2026-06-25 React 模式 `_build_tool_schemas()` 修复经验。修复前工具调用成功率 0%，修复后 100%。

```
验证 React 模式 ReActExecutor 的工具调用是否正确：
1. _build_tool_schemas() 必须使用 ctx.tools.get_tool(name) 而非 ctx.tools.get(name)
   - get(name) 返回 None（ToolRegistry 无此方法）
   - get_tool(name) 返回 Tool 实例
2. 工具 schema 字段必须使用 tool.parameters_schema 而非 tool.parameters
   - parameters 是 BaseTool 的私有字段
   - parameters_schema 是 JSON Schema 兼容的 OpenAI function calling 格式
3. 验证 LLM 返回的 tool_calls 中 function.name 能在 ToolRegistry 中找到
4. 验证 tool_call.arguments 能正确反序列化为 Pydantic 模型
5. 验证工具执行结果通过 ToolMessage 回传给 LLM 进行后续推理
6. 禁止在 React 模式中直接 import 工具实现，必须通过 ToolRegistry.execute()
```

#### FF23 声明式配置加载规则（基于修复经验）

> 来源：2026-06-25 模型候选链解析修复经验。修复前裸模型 ID 被跳过（33% 可用率），修复后 100%。

```
验证声明式配置（YAML）是否被正确加载和解析：
1. 模型候选链中裸模型 ID（如 "Doubao-Seed2.0"）必须自动解析为 "provider/model_id" 格式
   - 通过 _resolve_model_candidates() 方法
   - 维护 model_to_provider 反向映射表
   - 已知 provider 前缀的模型直接保留（如 "openai/gpt-oss-*:free"）
2. 无 base_url 的模型必须通过 openrouter 网关调用（不跳过）
3. provider 健康状态必须实时更新（不允许 stale 标记）
4. 配置文件（models.yaml/llm_route.yaml）中的 timeout_seconds/max_retries/retry_delay_seconds 必须被实际消费
   - 禁止配置文件中存在未生效的字段（违反"配置驱动"铁律）
5. ERROR_COOLDOWNS 硬编码表必须与 llm_route.yaml 中 failover_conditions 一致
6. LLMClient 必须通过 RouteResolver 消费 FailoverPolicy，禁止绕过配置直接硬编码
```

#### FF24 前后端适配规范（基于修复经验）

> 来源：2026-06-25 前后端适配修复经验。修复前全站不可用（0%），修复后 100% 可用。

```
验证前后端 API 契约是否一致：
1. 代理配置：next.config.js 中 rewrites 必须指向正确的后端端口
   - FlowForge: 8000（非 8002 DevForge）
   - ContentForge: 8001
   - DevForge: 8002
2. 路由命名：导航 href 必须与 app/ 下的实际页面目录一致
   - /solo 对应 app/solo/page.tsx（不是 /helm）
   - /admin/models 对应 app/admin/models/page.tsx
3. API 响应解包：后端统一返回 {status, data: {items, total, ...}, meta}
   - 前端必须支持 data?.data?.items ?? data.items ?? data.tasks 兼容解包
   - 禁止假设响应直接是 {items: [...]} 格式
4. 审核接口参数格式：POST /api/v1/tasks/{id}/review 必须用 JSON body
   - 禁止用 query string 传递 verdict/feedback（会被截断或转义错误）
   - Content-Type: application/json
5. 列表返回格式：/api/v1/graph/agents 等端点可能直接返回数组（非 {data: {...}} 包装）
   - 前端/脚本必须处理 isinstance(d, list) 分支
```

#### FF25 LLM 超时与回退机制规范（基于风险调研）

> 来源：2026-06-25 LLM 超时/回退机制调研。识别 10 个风险点（3 个 P0 级）。

```
验证 LLM 调用的超时/重试/回退机制是否符合规范：
1. httpx 超时必须从配置读取，禁止硬编码
   - 当前问题：llm_client.py:925/949/1042 三处硬编码 timeout=300s
   - 配置文件 llm_route.yaml:22 写 timeout_seconds: 30（未生效）
   - 修复方向：区分 connect(10s)/read(30s)/write(10s)
2. CircuitBreaker 必须接入 LLM 调用路径
   - 当前问题：core/circuit_breaker.py 完整实现但 LLMClient 未 import
   - 修复方向：为每个 provider/model 维护熔断器，OPEN 状态时直接跳过候选
3. FailoverPolicy 配置必须被实际消费
   - 当前问题：llm/route.py:149-189 加载 max_retries/retry_delay 但 LLMClient 不调用 RouteResolver
   - 修复方向：LLMClient 持有 RouteResolver，按 agent_name 解析 route
4. 失败返回语义必须统一
   - 当前问题：execute() 返回 ToolOutput(content="", error=...)；stream() 抛 RuntimeError
   - 修复方向：统一为返回带 error 的 ToolOutput，或统一抛异常
5. 沉默失败必须消除
   - 当前问题：workflow_context.py:43-54 收到 error 后仍 return 空串，workflow 继续
   - 修复方向：LLMClient 在 error 非空时返回 content=None，强制调用方显式处理
6. 健康状态必须单一数据源
   - 当前问题：LLMClient._health_status 与 LLMRouter._models 双轨制，cooldown 阈值不一致
   - 修复方向：LLMClient 委托 LLMRouter 做健康判定
7. 同模型重试 + 指数退避
   - 当前问题：超时/服务器错误时直接换候选，无同模型重试
   - 修复方向：对 timeout/server_error 错误重试 1-2 次，指数退避
```

#### FF26 OpenRoute 回退机制规范（基于风险调研）

> 来源：2026-06-25 OpenRoute 回退机制调研。识别 10 个风险点（2 个严重级）。

```
验证 OpenRoute 服务回退机制是否符合规范：
1. _browser_available 标记必须与实际浏览器状态一致
   - 当前问题：_resolve_web_client 误将 _browser_available 重置为 True
   - 修复方向：增加对 bm._context/bm._page 的实际存活检测
2. SmartLLMRouter 必须接入主请求链路
   - 当前问题：smart_router.py 实现完整但未被 chat_completions 调用
   - 修复方向：将 SmartLLMRouter 作为统一调度入口
3. _browser_available 禁止过早置 True
   - 当前问题：app.py:222 在后台 task 启动前就置 True
   - 修复方向：后台 init 成功后再置 True
4. ApiProviderManager 与 ModelRouter 可用性判断必须一致
   - 当前问题：web/api 模型在 ApiProviderManager 中"始终可用"，但 ModelRouter 依赖 _browser_available
   - 修复方向：统一由 ModelRouter 作为可用性判断源
5. API 组件初始化必须有 try/except 保护
   - 当前问题：app.py:69-103 配置加载异常会冒泡到 startup，导致服务无法启动
   - 修复方向：对 config 加载做容错（默认空配置 + 警告日志）
6. WebChat 必须支持跨 provider 重试
   - 当前问题：webchat_channel.py:330-335 异常直接返回 refusal
   - 修复方向：失败时尝试其他 webchat provider（如 kimi-web → deepseek-web）
7. BrowserManager.init() 必须加锁保护
   - 当前问题：无 async with self._lock，并发调用可能重复启动浏览器
   - 修复方向：init() 加锁或用 once-flag
8. _kill_chrome_processes 必须改为异步执行
   - 当前问题：使用 os.system 阻塞事件循环
   - 修复方向：改用 asyncio.create_subprocess_exec
```

---

## 三、ContentForge（AI 内容创作工厂）

### 3.1 创作全流程

#### CF1 内容创作全流程验证

```
请让AI写一篇文章，验证其是否按工作流调用多个agent（选题→研究→写作→审核→发布），
而不是直接调用article_writing工具一步完成。
输出框节点中应体现完整的workflow阶段和步骤。
```

#### CF2 六大专家Agent验证

```
请逐一验证ContentForge的6大专家Agent：
1. 选题Agent — 四级选题策略（缓存复用->自定义触发->OpenSieve深度检索->Tavily+热榜聚合）
2. 研究Agent — 并行多源检索（OpenSieve/Tavily/DuckDuckGo），素材抓取清洗
3. 创作Agent — SOUL/MEMORY风格注入，爆款结构复用，去AI味，平台风格适配
4. SEO Agent — 标题优化三维度方法论，关键词植入，段落结构优化
5. 事实核查Agent — 链接有效性检查，数据交叉验证
6. 发布Agent — 多平台发布（Playwright自动化），内容适配引擎，时间错峰发布
每个Agent用真实数据和真实LLM调用验证。
```

#### CF3 SOP编排验证

```
请验证ContentForge的SOP编排：
1. 深度长文SOP（6节点：选题→研究→写作→SEO→事实核查→发布）
2. 验证LangGraph检查点机制，任务中断后可恢复
3. 验证审核节点interrupt_before=["review"] + Command(resume=...)
4. 验证persona锁在审核暂停期间必须保留，审核完成后释放
5. 验证多Agent并行调度（无依赖关系的Agent可并行工作）
```

### 3.2 检索与素材

#### CF4 选题搜索链路

```
选题研究和搜索素材，调用web_search经常失败。
请检查这个工具内部有没有调用helixrag，可以按这样的顺序：
1. 优先调用helixrag选题和搜索素材
2. 如果失败就调用自己实现的web爬虫选题和搜索素材
3. 如果还是失败就调用web chat模型进行选题和搜索素材
   （web chat模型都可以联网，需要设计提示词引导）
```

#### CF5 Agentic RAG知识中枢验证

```
请验证ContentForge的Agentic RAG知识中枢：
1. 混合多源检索：融合外部搜索、Elasticsearch文档、Milvus向量库
2. 知识资产沉淀：审核通过的文章自动存入知识库
3. 多维度排序与去重：RRF融合、时间衰减、SimHash去重
4. 验证检索结果的相关性和质量
5. 验证知识库的增量更新机制
```

### 3.3 发布与渠道

#### CF6 发布技能测试

```
你把content的发布技能，通过hiclaw/test中的脚本测试通过后，
接下来我们需要把opensieve集成到flowforge中可以正常使用
（集成方法参考content发布技能中的选题、检索、素材下载和图片下载的实现）。
```

#### CF7 多平台发布验证

```
请验证ContentForge的多平台发布能力：
1. 今日头条发布 — Playwright自动化，验证文章/微头条/视频发布
2. 微信公众号发布 — 验证富文本/图片/封面发布
3. 验证内容适配引擎：同一文章自动适配不同平台格式要求
4. 验证时间错峰发布：不同平台间隔5-10分钟
5. 验证熔断保护：发布失败3次自动暂停该平台
```

### 3.4 模型治理

#### CF8 模型治理验证

```
请验证ContentForge的模型治理能力：
1. 多模型供应池：OpenRouter、阿里云百炼、火山引擎、腾讯混元
2. 差异化模型分配：不同Agent/专栏指定不同主力和备用模型
3. 模型健康检查：自动探测可用性、配额、延迟
4. 级联修复：建议模式，不强制覆盖
5. 验证模型故障时自动切换到备用模型
```

### 3.5 Web UI

#### CF9 Web控制台验证

```
请验证ContentForge的Web控制台功能完整性：
1. 仪表盘：P0关键操作区、P1实时状态区、P2统计报表区
2. 审核中心：Human-in-the-Loop，Tiptap富文本编辑
3. 定时任务管理：可视化创建定时创作计划
4. 专栏与模型配置：SOUL/MEMORY/模型分配/发布渠道编辑
5. 发布日志与审计：历史任务状态、文章链接、错误日志
6. Helm Studio：实时观察创作过程，审核节点内联操作
```

#### CF10 Content集成验证

```
验证content是否正确集成contentforge：
1. 三种模式（native_sdk/web_api/独立服务）是否都通过
2. 创作和润色是否为两个独立接口
3. content调用contentforge是否通过SDK而非HTTP
4. 质量分阈值是否为0.85
```

#### CF11 选题接口验证（阶段2）

```
验证ContentForge的选题接口（POST /api/v1/content/topic）：
1. 默认提示词选题模式：提供intent，验证返回3个以上高质量选题
2. URL选题模式：提供source_url（如头条账号首页），验证先爬取向量化再选题
3. 选题Loop配置：3评委并行评审（Doubao-Seed2.0/GLM-5.1/Kimi-K2.6），6维度（relevance/attractiveness/angle_uniqueness/feasibility/timeliness/differentiation），阈值0.80
4. T6指标采集：quality_score/iterations/strategy/topics_count必须完整
5. T7 LLM审核：每个选题（title+angle+trend_reason）必须通过LLM审核
6. 性能：单轮迭代<180s，总耗时<420s
7. 幂等性：相同idempotency_key返回相同task_id
8. SSE流式进度：stream=true时能实时收到loop.started/iteration.start/verify.passed等事件
9. v2.1新增：source_filter链路验证 — URL选题模式传source_filter=preselect，验证helixrag_search→OpenSieveClient→/api/v1/retrieve→PreselectService完整链路无断裂
10. v2.1新增：老选题兼容验证 — 默认模式(source_filter=all)走原有RetrievePipeline，结果不变
```

#### CF12 URL向量化入库验证

```
验证ContentForge的URL向量化接口（POST /api/v1/content/ingest-url）：
1. 单篇文章：提供文章URL，验证爬取+15维度评估+OpenSieve入库
2. 用户主页：提供头条账号首页URL，验证爬取所有文章+并行评估+批量入库
3. 15维度评估：title_attractiveness/opening_hook/content_depth/structure_clarity/ai_flavor/persona_fit/fact_accuracy/differentiation/timeliness/viral_potential/platform_fit/originality/engagement/compliance
4. 入库结果：articles_found/articles_scraped/articles_ingested/avg_quality_score/top_dimensions
5. 并发限制：爬取并发3，评估并发3（避免反爬）
6. OpenSieve端点从环境变量注入（OPENSIEVE_ENDPOINT），禁止硬编码
7. v2.1修正：提示词外置到opensieve/config/prompts.yaml的preselect.evaluate_15_dims（非contentforge/config/prompts.yaml，消除跨层依赖）
8. v2.1新增：定时预抓取验证 — POST /api/v1/preselect/schedule注册cron任务，验证APScheduler真正注册（非仅存内存dict）
9. v2.1新增：Milvus隔离验证 — 预选题向量写入helixrag_preselect collection（非opensieve_vectors），通过_milvus_collection属性隔离
10. v2.1新增：ContentForge薄包装验证 — url_ingestor.py不自己爬取/向量化，仅调用OpenSieve POST /api/v1/preselect/ingest
```

#### CF13 选题→创作全流程验证

```
验证ContentForge的选题→创作全流程：
1. 调用POST /api/v1/content/topic获取选题列表
2. 从选题列表中选择一个选题，调用POST /api/v1/content/create创作文章
3. 验证创作接口能正确接收选题结果（topic_list参数）
4. 验证创作Loop（deep_article_loop）能基于选题生成高质量文章
5. T6+T7+T8全量验证：选题质量分≥0.80，文章质量分≥0.85，发布DOM验证通过
```

---

## 四、DevForge（AI 开发工厂）

### 4.1 场景自适应流程

#### DF1 开发全流程验证

```
请验证DevForge的开发全流程：需求分析→架构设计→编码→代码审查→单元测试→部署→监控自愈。
确保每个环节都有对应的Agent和Tool支撑，且通过Helm界面可以完整追踪执行过程。
```

#### DF2 四种任务类型流程验证

```
请验证DevForge的场景自适应流程引擎，逐一测试4种任务类型：
1. greenfield（全新项目）— IPD全流程，9个门禁（6 DCP + 3 TR），6阶段
2. feature（功能迭代）— IPD简化流程，3个门禁（2 DCP + 1 TR），5阶段
3. change（需求变更/优化）— DevOps轻量流程，2个自动门禁，4阶段
4. hotfix（Bug修复）— GitFlow热修复流程，1个门禁+自动回滚，3阶段
每种类型用真实的开发任务验证，确保门禁评审和流程跳转正确。
```

### 4.2 IPD门禁系统

#### DF3 门禁评审验证

```
请验证DevForge的IPD门禁系统：
1. decision门禁：多维度加权评分，验证一票否决维度
2. technical门禁：技术产物专项审查
3. ci_auto门禁：lint+test+coverage自动检查
4. 三种投票策略：weighted/consensus/majority
5. 打回重试：reflexion自我修正 / regenerate完全重做
6. 超时策略：3种计时起点
7. 人工确认和升级到人工
8. 审计日志完整性
```

#### DF4 14个业务Agent验证

```
请验证DevForge的14个业务Agent是否正确实现：
需求分析师(Self-Discover) → 架构师(Graph of Thoughts) → 详细设计(Plan-and-Execute)
→ 编码(Reflexion) → 测试生成(ReWOO) → 集成测试(ReAct) → 代码审核(Multi-Agent辩论)
→ 安全审查(Agent-as-Judge) → 性能分析(Agent-as-Judge) → 文档审核(Agent-as-Judge)
→ 验收(Plan-and-Execute) → 部署(ReWOO) → 运维(ReAct) → 知识管理(Plan-and-Execute)
每个Agent用真实开发任务验证，确保使用正确的执行模式。
```

### 4.3 金丝雀发布

#### DF5 金丝雀发布与回滚验证

```
请验证DevForge的金丝雀发布与自动回滚：
1. 金丝雀阶段：10% → 50% → 100%，每阶段观测
2. 自动回滚触发条件：错误率>1% / P99延迟>2x基线 / 人工触发
3. 回滚目标：上一个稳定版本（Git tag）
4. 回滚失败时自动升级到人工处理
5. 验证审计日志记录完整的发布和回滚操作
```

### 4.4 安全与沙箱

#### DF6 代码执行沙箱验证

```
请验证DevForge的代码执行沙箱安全机制：
1. 进程隔离：沙箱进程与主进程完全隔离
2. 资源限制：CPU/内存/磁盘/网络限制
3. 危险函数禁用：os.system/subprocess/eval/exec等
4. Git操作权限控制：仓库白名单、命令注入防护、强制推送保护
5. 部署安全：环境隔离、金丝雀发布、自动回滚
```

---

## 五、NovelForge（AI 小说创作工厂）

### 5.1 创作全流程

#### NF1 小说创作全流程验证

```
请验证NovelForge的小说创作全流程：大纲策划→人物设定→章节编排→逐集创作→审核→补发/重写。
确保连载场景的Agent协作系统正常工作，且通过Helm界面可以完整追踪执行过程。
```

#### NF2 八大创作阶段验证

```
请验证NovelForge的8个创作阶段：
1. 概念孵化 — 创意总监+市场分析(Graph of Thoughts)，Human强制
2. 大纲编制 — 大纲Agent(Plan-and-Execute + Agent-as-Judge)，Human强制
3. 风格校准 — 写手Agent(Reflexion)，Human强制
4. 分章写作 — 写手Agent(Reflexion)，SOUL风格注入
5. 章节自审/一致性检查 — 一致性检测Agent(ReAct)
6. 润色优化 — 润色Agent(ReWOO + 对比确认)
7. 全集通读 — 通读Agent(Graph of Thoughts)，Human强制
8. 完稿审核 — 情感+结构+出版顾问(Multi-Agent合议)，Human强制
每个阶段用真实小说创作验证，确保质量门检查正确。
```

### 5.2 上下文与一致性

#### NF3 五层上下文管理验证

```
请验证NovelForge的五层上下文管理（解决100万字超窗口问题）：
1. L1全文 — 所有章节完整文本（SQLite + 向量索引）
2. L2章摘要 — 每章200字摘要
3. L3卷摘要 — 每卷（10章）500字摘要
4. L4全书摘要 — 1000字全书梗概 + 人物弧光
5. 世界状态表 — 结构化JSON（人物/时间线/伏笔/战力/地理）
验证写第N章时的输入组装：L4+L3+L2+向量检索+第N-1章全文+SOUL参数
```

#### NF4 SOUL风格参数验证

```
请验证NovelForge的SOUL风格参数系统：
1. 5个核心维度：叙事视角/语言风格/描写倾向/对话风格/节奏倾向
2. 3个反馈维度：作家特别要求/预设标签/段落级标注
3. 验证SOUL在风格校准阶段写入
4. 验证后续所有章节的system prompt均注入SOUL参数
5. 验证不同SOUL配置生成的内容风格确实不同
```

#### NF5 一致性检测验证

```
请验证NovelForge的一致性检测系统：
1. 每5/10章自动触发一致性检测
2. 5个专用Tool：search_character/search_timeline/check_foreshadowing/verify_power_system/compare_geography
3. 验证伏笔状态追踪：伏笔回收率>=80%
4. 验证人物性格一致性
5. 验证逻辑矛盾自检
6. 验证全局一致性分析
```

### 5.3 审核与质量

#### NF6 七道质量门验证

```
请验证NovelForge的7道质量门：
QG-1 概念孵化→大纲编制：logline+selling_point+world_setting+main_characters非空
QG-2 大纲编制→风格校准：outline_score>=60
QG-3 风格校准→分章写作：style_confirmed==true
QG-4 分章写作→润色优化：review_score>=70
QG-5 全集通读→完稿审核：foreshadowing_recovery_rate>=0.8
QG-6 完稿审核→完成：author_confirmed==true
每道质量门用一个不达标的场景验证拦截是否生效。
```

#### NF7 盲评与仲裁验证

```
请验证NovelForge的ReviewOrchestrator盲评+加权+仲裁：
1. 三个评论Agent并行盲评（asyncio.gather）
2. 加权平均分：emotion 40% + structure 35% + prose 25%
3. 评分标准差>20时触发仲裁Agent
4. 加权平均<70打回重写，>=70通过
5. 验证Reflexion 2轮不达标自动降级（缩减字数目标20%）
```

### 5.4 项目管理

#### NF8 冻结与续写验证

```
请验证NovelForge的冻结/解冻续写功能：
1. 作家中途放弃 → 自动保存快照 → frozen状态
2. 解冻续写：从检查点恢复，继续创作
3. 验证跨天审核持久化：审核暂停期间状态不丢失
4. 验证多版本管理：章节版本历史、版本diff、版本回滚
5. 验证回溯修改：删除整条角色线时触发回溯修改Workflow
```

---

## 六、MallForge（AI 电商运营工厂）

### 6.1 六大核心Agent

#### MF1 电商场景验证

```
请验证MallForge的电商全链路：智能客服→商品文案→竞品分析→供应链管理→收入归集。
确保电商场景的智能化流程正常工作。
```

#### MF2 选品Agent验证

```
请验证MallForge的ProductScoutAgent：
1. 监控TikTok/Amazon/Shopee热榜
2. 搜索1688同款批发价
3. 计算利润率（汇率/佣金/物流/包装）
4. Harness约束过滤：重量<2kg、体积<0.05m3、毛利率>=30%、货源评分>=4.5
5. 排除侵权/季节性/危险品
6. 验证rewoo模式执行流程
```

#### MF3 上架Agent验证

```
请验证MallForge的ListingGeneratorAgent：
1. 生成多语言SEO标题（>=3个关键词）
2. 五点描述
3. A+内容
4. 图片要求规范（白底>=1000px）
5. 支持10+语言翻译
6. 市场差异化适配
7. 禁止绝对化用语
8. 验证plan_execute模式执行流程
```

#### MF4 广告Agent验证

```
请验证MallForge的AdOptimizerAgent：
1. 小预算测品（$10/天/品）
2. 数据监控与自动调整
3. 死品管理：7天无出单暂停、ACOS>30%降出价、CTR<0.5%换主图
4. Reflexion反馈循环
5. 验证3种action（start_test/daily_optimization/check_results）
```

#### MF5 供应链与客服Agent验证

```
请验证MallForge的SupplyChainAgent和SupportAgent：
供应链Agent：
1. 订单-采购-发货自动化
2. 库存管理：安全库存10件
3. 价格监控：涨价>5%暂停下单
4. 大额采购>5000元人工审批
客服Agent：
1. 自动翻译回复
2. 物流查询
3. 退款处理：退款>30%人工审核
4. 差评告警：差评关键词自动拦截
5. 意图分类：logistics/refund/review_alert/general
```

### 6.2 三条Workflow

#### MF6 三条自动化Workflow验证

```
请验证MallForge的三条自动化Workflow：
1. 新品孵化(product_incubation) — 每周一8:00：product_scout→profit_filter→listing_generator→ad_optimizer→人工审核
2. 核心品维护(core_maintenance) — 每天6:00：supply_chain→replenish→ad_optimizer→report_generator→人工审核
3. 客服响应(customer_service) — Webhook即时触发：support_agent→自动回复或人工升级→条件触发人工审核
每条Workflow用真实业务场景端到端验证。
```

### 6.3 工具降级与MCP

#### MF7 工具三级降级验证

```
请验证MallForge的工具三级降级策略：
1. 优先使用web_search获取真实数据
2. 降级使用LLM生成合理数据
3. 最终降级返回空结果并标注data_source
对platform_scraper、wholesale_search、logistics_tracker三个工具逐一验证降级链路。
```

#### MF8 MCP集成规划验证

```
请验证MallForge的MCP集成规划，检查10个MCP Server的设计：
P0：tiktok-scraper、amazon-scraper、1688-mcp
P1：shopee-scraper、translator-mcp、ad-platform-mcp、logistics-mcp、platform-messaging-mcp
P2：image-editor-mcp、google-sheets-mcp
对已实现的MCP Server用真实API验证，对未实现的给出实施优先级和方案。
```

---

## 七、OpenRoute（多模型 API 网关）

### 7.1 服务启动与验证

#### OR1 服务启动与验证

```
帮我启动openroute服务，并运行一次多LLM交叉和并发的实际调用测试，验证是否有问题。
检查logs目录下刚才的交叉和并发调用日志，确认是否有模型回退或限流的记录。
```

#### OR2 API健康检查

```
openroute模块强制更新和自动更新模型做了优化，目前openroute模块暴露的模型只有第一层模型，请帮忙验证和检查hiclaw/tool/openroute/config/model_routes.yaml和api_providers.yaml中的model配置是否已同步更新。
针对openroute的认证和端口问题，帮我补充一个针对LLMClient的健康检查集成测试用例。
验证openroute free、auto和其他专门的模型都能调用通过。
```

### 7.2 场景路由与降级

#### OR4 三层场景路由验证

```
请验证OpenRoute的三层场景路由：
1. 场景1（Proxy组合Prompt+后处理）— OpenRouteCombinePipeline
2. 场景2（业务方组合Prompt+后处理）— CallerCombinePipeline
3. 场景3（API透传）— PassthroughPipeline
4. 验证SceneRouter.decide()正确识别场景
5. 验证PipelineFactory.create()正确创建Pipeline
6. 验证路由与执行完全解耦
```

#### OR5 智能降级链验证

```
请验证OpenRoute的智能降级链：
1. API通道 → WebChat通道 → 抽取API → 三方API兜底
2. 验证熔断器三态转换：closed → open → half_open
3. 验证连续3次失败自动熔断
4. 验证健康检查：启动时并发检查 + 每30分钟定时检查
5. 验证降级后的自动恢复机制
```

### 7.3 浏览器自动化

#### OR6 七平台WebChat验证

```
请验证OpenRoute的7个网页版平台WebChat通道：
1. 豆包 — 验证DOM选择器和消息提取
2. Kimi — 验证DOM选择器和消息提取
3. DeepSeek — 验证DOM选择器和消息提取
4. 通义千问 — 验证DOM选择器和消息提取
5. 腾讯元宝 — 验证DOM选择器和消息提取
6. 智谱GLM — 验证DOM选择器和消息提取
7. MiniMax — 验证DOM选择器和消息提取
每个平台用真实浏览器会话验证，确保消息发送和回复提取正常。
```

#### OR7 流式输出验证

```
请验证OpenRoute的流式输出能力：
1. API Forward真流式SSE透传
2. WebChat近似流式三级降级：DOM MutationObserver → 轮询 → 完整回复模拟
3. 验证ToolParser从LLM纯文本回复中解析tool_calls
4. 验证JSON提取、格式修复、Schema校验、arguments修复
```

### 7.4 安全与配置

#### OR8 敏感词脱敏验证

```
请验证OpenRoute的敏感词脱敏功能：
1. 检查sanitization_rules.yaml配置是否完整
2. 验证发送含敏感词的消息时自动替换
3. 验证替换后网页版审核不拦截
4. 验证回复中敏感词还原
```

#### OR9 用户认证与用量统计

```
请验证OpenRoute的用户认证与用量统计：
1. Bearer Token + API Key（or-开头）双认证
2. 按后端模型统计call_count/tokens/error_count
3. 验证未认证请求返回401
4. 验证用量统计数据的准确性
```

---

## 八、OpenSieve（聚合检索增强中台）

### 8.1 服务启动与基础

#### OS1 服务启动与验证

```
帮我启动OpenSieve的API服务（端口8100），不能只看命令退出码是否为0，
必须检查输出内容的质量。任何失败的用例都不能回避，必须找到原因并修复。
```

### 8.2 检索能力

#### OS2 检索能力优化

```
我们opensieve项目目前检索和素材下载能力已经具备，但是能力很弱，有时还不准。
请参考Scrapling项目，对比我们opensieve项目目前已有框架和能力，
设计一个系统性的优化方案放在opensieve/docs目录下。
优化方案需保证之前对外提供的检索接口和素材下载接口向前兼容。
```

#### OS3 优化方案评审

```
我设计了一个系统性的优化方案放在了opensieve/docs/optimization_plan.md中，
请你以AI高级架构师、AI Agent高级工程师、全栈高级软件工程师角度帮我评审此文档，
给出你专业的评审意见，放在opensieve/docs/review_optimization_plan.md中。
```

#### OS4 检索管线验证

```
请验证OpenSieve的检索管线7阶段：
1. 查询理解 — 意图识别（事实/导航/研究/视频/图片/开发型）、查询重写、子查询分解、查询路由
2. 多源并行检索 — 网络+向量+ES+图谱
3. RRF融合 — 多源结果融合排序
4. 4阶段排名 — BM25快速过滤→N-gram短语验证→BGE-M3语义排序→Cross-Encoder精排
5. CRAG反思 — CorrectiveRAG 2轮反思
6. MMR多样化 — 结果去重和多样性
7. 结果生成 — 最终输出
每个阶段用真实查询验证，确保检索质量达标。
```

#### OS5 搜索源增强验证

```
请验证OpenSieve的20+搜索源：
1. Tier 1源（稳定可用）：B站/GitHub/Wikipedia/Bing API/Google等
2. Tier 2源（实验性）：小红书/抖音/中国知网等
3. 验证搜索源注册机制和动态启用/禁用
4. 验证健康监控和优先级调度
5. 验证SearXNG兜底
6. 验证Tier 2源连续失败3次自动降级到Fallback源
```

### 8.3 Agent化与智能检索

#### OS6 Agent化改造

```
后续我们OpenSieve需要按Agent智能体方向设计和实现，
目前最核心的查询理解层、Agentic RAG居然都没有实现，你要帮忙实现。
如果需要就调用openroute完成llm调用大模型的能力。
```

#### OS7 Agentic RAG验证

```
请验证OpenSieve的Agentic RAG能力：
1. CRAG自纠正 — 2轮反思，验证修正质量（修正查询与原查询embedding相似度>=0.3）
2. Self-RAG — 自我评估检索结果相关性
3. Multi-Hop — 多跳检索，复杂问题分解为多步检索
4. 验证CRAG反思评估增强：多样性检查、Embedding覆盖度、用户反馈接口
```

### 8.4 向量检索与图片

#### OS8 向量检索与图片搜索

```
OpenSieve当前问题：
1. Milvus向量检索已禁用，检索质量受限 — 请重新启用
2. 图片搜索需要往ES的opensieve_images索引灌数据
3. 图片下载有网络/反爬问题需要解决
4. bge-m3模型需下载到本地缓存并配置启动参数
```

#### OS9 图片下载管线验证

```
请验证OpenSieve的图片下载完整管线：
1. 四层发现策略：标准HTML标签/元数据标签/CSS背景图/SVG
2. 下载管线：并发控制+速率限制+重试+反盗链绕过
3. 图片处理：格式转换/缩略图生成/EXIF剥离/感知哈希去重
4. 存储：本地文件系统/MinIO可切换
5. 三级去重：SHA-256精确/pHash感知/dHash结构
6. 完整API：下载/批量下载/元数据/文件/缩略图/删除/列表
```

### 8.5 爬虫与知识库

#### OS10 爬虫框架验证

```
请验证OpenSieve的爬虫框架：
1. 基于Playwright的浏览器自动化引擎（无头/有头模式）
2. 反检测机制：指纹伪装、UA轮换、代理池
3. 领域爬虫框架：定时爬取、事件驱动、增量爬取
4. 内容提取：自动识别正文区域，输出LLM就绪的Markdown格式
5. 爬虫健康监控：Prometheus采集、Grafana展示、自动降级与恢复
6. 完整的爬虫任务管理API（CRUD + 手动触发）
```

#### OS11 知识库引擎验证

```
请验证OpenSieve的知识库引擎：
1. 五种入库方式：定时爬取、检索结果、素材下载、手动导入、RSS/Feed
2. 三级去重：URL去重、SimHash内容去重、近重复合并
3. 六种召回算法：BM25、向量语义、混合检索、LazyGraphRAG、分类过滤、时间衰减
4. 数据生命周期管理：过期标记、质量衰减、脏数据清理、容量控制
5. 自动入库容量预检机制
```

### 8.6 语义缓存与评估

#### OS12 语义缓存验证

```
请验证OpenSieve的四级语义缓存架构：
1. L1语义缓存(Redis Sorted Set, TTL=1h) — ZRANGEBYSCORE替代SCAN遍历
2. L2精确缓存(Redis, TTL=30min)
3. L3 Embedding缓存(内存LRU)
4. L4 ES索引(持久化)
5. 验证预估命中率30-50%
6. 验证缓存失效和更新机制
```

#### OS13 评估体系验证

```
请验证OpenSieve的RAGAS评估体系：
1. Context Precision/Recall/Relevancy
2. Faithfulness
3. Answer Relevancy/Correctness
4. 评估API：评估检索质量、获取评估报告、运行基准测试
5. 用真实查询和真实检索结果验证评估指标
```

### 8.7 架构优化与SDK/CLI

#### OS14 架构优化与SDK/CLI集成

```
非常好，我们上述爬虫能力都已经重构完成。目前我们迭代到目前，架构有所腐化，再就是检索来源和质量不足，对本地搜索和检索能力支持不够，除了api端点外我们还需要支持sdk或cli本地集成的方案（我们的opensieve需要提供过多接口，甚至直接提供原生native agent（你可以根据我们opensieve的能力提供search agent、智能搜索agent、其他若干与搜索、检索和素材下载的agent等等）给三方集成，比喻flowforge优先使用本地native agent集成方案，你帮忙看下是使用sdk还是cli集成到本地原生native中提升性能）。
除了上述我期望的能力，你需补充到我们架构优化方案外，还需帮我审核我写和收集的几个专家的架构优化的方案。你以AI高级架构师、AI Agent高级工程师、全栈高级软件工程师角度，审核opensieve/docs下的架构优化设计文档arch_optplan.md，给出了专业的评审意见，评审意见放在opensieve的docs目录下的review_arch_optplan.md中。
1、要求先评审arch_optplan.md文档，给出专业评审意见
2、然后把我前边的期望、arch_optplan.md中的所有专家方案的、你自己的想法和思考先合并为一个新的架构设计优化文档（可以增加，但是不能遗漏，需要要完整）。把新的架构设计文档暂时放在arch_tmp.md中，接下来我们专家团队继续进行评审。
3、接着对新的架构设计文档进行评审，最后把1和3的评审结论汇总，放在review_arch_optplan.md中。
```

#### OS15 Native Agent集成方案设计

```
请为OpenSieve设计Native Agent集成方案：
1. 基于OpenSieve能力设计以下Native Agent：
   - SearchAgent：智能搜索Agent，支持多源检索+查询理解+结果排序
   - ResearchAgent：深度研究Agent，支持多跳检索+CRAG反思+知识综合
   - MaterialAgent：素材下载Agent，支持图片/文档/视频素材获取
   - CrawlAgent：爬虫Agent，支持定时爬取+增量爬取+内容提取
2. 设计SDK集成方案（Python SDK，供flowforge等上层项目本地调用）
3. 设计CLI集成方案（命令行工具，供脚本和自动化场景使用）
4. 对比SDK vs CLI的性能差异，给出推荐方案
5. 确保与现有API端点向前兼容
6. 设计Agent注册协议，使Native Agent可被FlowForge的AgentRegistry识别
```

#### OS16 多租户架构验证

```
请验证OpenSieve的多租户架构：
1. 租户识别：API Key → tenant_id映射
2. 数据隔离：Milvus Collection/ES Index/PG行级tenant_id(RLS)/Redis前缀/Neo4j Label
3. 资源配额：QPS/存储/并发/日调用四维度
4. 配置层级：请求级 > 租户级 > 全局默认
5. API Key轮转机制（grace period）
```

---

## 九、HicLaw（旧系统主控框架）

### 9.1 平台适配

#### HL1 Win11适配

```
之前只支持linux版本运行，请在win11下测试验证hiclaw/test下的所有测试用例。
如果不可用，请给hiclaw和content两个项目做最小化修改适配win11，
不要影响linux的代码。依赖的opensieve服务当前运行在docker容器中。
除了这两个目录外，不允许修改其他目录下的代码。
```

#### HL2 全量测试

```
运行hiclaw/test下的所有测试用例（共13个测试文件，数百个组合场景）：
test_doubao_proxy.py, test_article_e2e.py, _test_openclaw_fix.py,
test_full_pipeline.py, test_material_fetcher.py, test_publish.py,
test_series_e2e.py, test_interact.py, test_video_e2e.py,
test_weitoutiao.py, test_clear_cache.py, test_file_cleanup.py,
test_helixrag.py
汇总测试报告给我。
```

### 9.2 模型管理

#### HL3 模型管理工具验证

```
请验证HicLaw的模型管理工具集：
1. fetch_models.py — 从10个供应商并发获取模型列表
2. merge_to_openclaw.py — 合并模型配置 + 多维评分排序
3. auto_fix_models.py — 自动修复不可用模型（5分钟crontab）
4. health_checker.py — 模型健康检查
5. model_assignment.json — 差异化模型分配（auto/fixed两种模式）
6. 验证评分维度：供应商等级/模型系列/参数规模/上下文长度/新鲜度/免费降权/Web加权
```

### 9.3 消息渠道

#### HL4 消息渠道插件验证

```
请验证HicLaw的消息渠道插件：
1. QQ机器人插件(openclaw-qqbot)：频道消息收发、定时提醒、富媒体
2. 微信机器人插件(openclaw-weixin)：消息收发、CDN上传、SILK转码、扫码登录
3. 验证消息加解密和Token管理
4. 验证多账号场景下的消息路由
```

### 9.4 Content创作引擎

#### HL5 Content创作引擎验证

```
请验证openclaw_pkg的Content创作引擎：
1. content 综合创作（已合并 education/life/novel/dev/student 场景，统一通过 persona 配置区分）
2. 全流程：热榜采集→选题生成→素材搜索→文章生成→润色→引用核查→去重→封面→发布
3. 微头条发布（200-500字短内容）
4. 视频发布（FFmpeg + edge-tts + 字幕烧录）
5. 系列文章（大纲规划→审核→逐集创作→补发/重写）
6. 平台互动（自动浏览推荐、点赞、评论）
7. 定时任务（14个，每日约47篇文章）
8. 验证合规红线和去AI味规则
```

#### HL6 测试性能与稳定性验证

```
验证test_full_pipeline.py：
1. 完整流程是否在5分钟内完成（不是30分钟）
2. 是否有卡死问题（增加详细logger.info）
3. Win11下是否正常运行
4. 发布完成后浏览器处理（Win11关闭浏览器，Linux只关闭tab）
```

---

## 十一、StockForge（AI 股票分析工厂）

> StockForge 是基于 FlowForge 的 AI 股票基金自动化分析与投资决策辅助系统。
> 端口：后端 8005 / 前端 5179
> 关键目录：stockforge/

### SF1 全周期预测分析验证

```
请验证StockForge的全周期预测分析流程：
1. 输入股票列表（如601127|赛力斯、000998|隆平高科），验证是否按工作流调用多个agent
2. 验证数据采集→指标计算→趋势预测→买卖信号→报告生成的完整流程
3. 验证报告是否包含6大章节：大盘环境分析/个股操作分析/ETF操作分析/操作总策略/综合对比表/技术指标信号表
4. 验证技术指标是否真实计算（KDJ/RSI/WR/MACD/均线/成交量/K线形态/筹码分布/神奇九转）
5. 验证买卖信号是否用❌/✅标记
6. 验证是否包含止损位、风险等级、仓位建议
7. 验证数据来源是否三源容错（Tushare→AkShare→BaoStock）
8. 验证是否禁止虚构数据（查不到数据显示"暂无"）
```

### SF2 数据采集与更新验证

```
请验证StockForge的数据采集能力：
1. 验证A股历史数据爬取（20年时间可配）
2. 验证基金数据爬取
3. 验证每日收盘后自动数据更新（16:00触发）
4. 验证三源容错降级机制（Tushare失败→AkShare→BaoStock）
5. 验证增量更新vs全量更新策略
6. 验证数据缓存（SQLite元数据+Parquet文件存储，pyarrow未安装时回退CSV）
7. 验证三源容错降级机制是否通过OpenSieve DataSource协议统一管理（所有数据检索走OpenSieve）
```

### SF3 选股与预测验证

```
请验证StockForge的选股和预测能力：
1. 验证多因子选股策略（技术+基本面+AI信号）
2. 验证多空辩论机制（Bull vs Bear vs 裁判）
3. 验证预测周期（明日/下周/下月）
4. 验证LLM综合判断（技术指标+LLM预测，非LSTM/XGBoost）
5. 验证预测置信度评估
6. 验证风险评估（仓位建议/止损位/风险等级）
7. 验证质量分阈值是否为0.85
8. 验证5个WebChat评委是否并行评审
```

### SF4 OpenSieve专业数据扩展验证

```
请验证OpenSieve是否正确支持专业数据爬取：
1. 验证股票数据适配器是否独立于通用内容检索
2. 验证电商数据适配器扩展点
3. 验证专业数据与通用数据的目录结构区分
4. 验证数据源配置是否通过YAML管理
5. 验证向前兼容（原有检索接口不受影响）
```

### SF5 审核修订v2.0合规验证

```
请验证StockForge是否已按审核修订v2.0更新：
1. 产品定位是否为"分析与投资决策辅助系统"（禁止"量化交易"四字）
2. Agent数量是否统一为6个核心Agent（technical_indicator/prediction/screening/bull_bear_debate/risk/report）
3. 是否删除了独立repositories/database.py/data_sync.py
4. 是否删除了LSTM/XGBoost/Transformer空实现，改为技术指标+LLM预测
5. Loop worker.mode是否统一为loop（禁止workflow/reflexion）
6. 变量引用是否统一双大括号${{state.xxx}}
7. Plugin钩子是否正确：Loop配置通过register_loops注册，Workflow配置通过register_workflows注册（StockForge应使用register_loops，禁止register_workflows误用）
8. Loop超时是否为180s（3分钟）
9. 是否有flowforge.build()调用（禁止）
10. 是否有test.md（T1-T9自检表）
11. 报告生成是否有LLM二次审核（FeedbackLoop.evaluate）
12. 是否有MetricsCollector集成
13. 所有数据检索是否走OpenSieve（结构化数据通过DataSource协议，非结构化检索通过SearchSource协议）
14. 质量分阈值是否为0.85
15. 是否有实盘交易隔离技术保障（CI静态检查+ArchConstraintEngine）
```

---

## 十、常用追问与纠偏模板

### 10.1 测试质量追问

#### Q1 测试质量追问

```
1、你根本没有覆盖全，你偷工减料？
2、你的测试用例有严重问题，端到端根本跑不通
3、不能只看命令退出码是否为0，必须检查输出内容的质量
4、你的测试指标太少了（LLM调用次数、工具调用链、Agent/Workflow指标、Memory查询使用情况全都没）
5、从web前端页面触发的全流程也没有
6、你LLM都没有调用，咋测试通过了啊？
```

### 10.2 实现质量追问

#### Q2 实现质量追问

```
1、很多功能都没有实现，再就是有很多需要优化的细节
2、严格遵守我们铁律规则，不要搞偷工减料的事情，我会不定时检查的
3、你又在忽悠我吗？我没有看你正常调用LLM啊
4、你的测试程序有严重的质量问题，都是假的断言
5、目前来看连自定义都没必要啊，你是不是这块有问题啊
```

### 10.3 架构追问

#### Q3 架构追问

```
1、上层4个项目没有必要自己提供模型能力啊，目前来看连自定义都没必要啊
2、组件化和插件框架已落地，为何还是有很多重复代码？是不是你这块没有搞好呢？
3、flowforge提供底层基础能力，上层通过继承或扩展来复用，禁止重复实现
4、请把5个项目的重复代码再合并下
```

### 10.4 先规划后编码

#### Q4 先规划后编码

```
不用急着写代码，先帮我规划一下具体技术实现方案和依赖库
请把你规划的详细方案和设计文档更新到我们的docs目录下，
然后我审核通过后，我们再开始编码
```

### 10.5 架构优化追问

#### Q5 架构优化追问

```
1、架构已经腐化了，你需要重新审视和重构
2、检索来源和质量不足，对本地搜索和检索能力支持不够
3、除了API端点外，还需要支持SDK或CLI本地集成方案
4、需要提供Native Agent给三方集成，而不是只提供API
5、上层项目（如flowforge）优先使用本地Native Agent集成方案提升性能
6、架构优化方案不能遗漏任何专家意见和我的期望
```

### 10.6 Agent能力追问

#### Q6 Agent能力追问

```
1、你的Agent根本没有调用真实工具，全是LLM生成的假数据
2、Agent的执行模式和设计文档定义的不一致
3、Agent之间的协作没有走TaskBoard/Mailbox，而是直接调用
4、Agent的Harness约束没有生效，pre_execute/post_execute Hook没触发
5、Agent的SOUL/MEMORY风格注入没有生效，生成内容没有风格差异
6、Agent的质量门检查被跳过了，不达标的内容直接通过了
```

### 10.7 数据与检索追问

#### Q7 数据与检索追问

```
1、你的检索结果相关性太差，根本没有理解查询意图
2、向量检索被禁用了，检索质量严重受限
3、知识库没有增量更新，数据都是过期的
4、缓存命中率太低，语义缓存没有生效
5、爬虫框架没有反检测机制，被目标网站封了
6、图片下载管线不完整，反盗链和去重都没实现
```

### 10.8 提示词与配置追问

#### Q8 提示词与配置追问

```
1、你的提示词全部硬编码在代码里，修改提示词需要改代码重新部署，这是严重的架构问题
2、prompts.yaml定义了提示词但代码完全没引用，两套提示词并存且内容不一致
3、_DEFAULT_PROMPTS字典和prompts.yaml双重定义，到底以哪个为准？
4、同样的搜索提示词在3个文件中重复硬编码，为什么不提取到YAML中？
5、Agent的提示词应该通过PromptManager.get_prompt()加载，而不是在execute()方法中f"""硬编码
6、硬编码路径、密钥、端口也是严重问题，铁律5明确禁止了
```

---

## 十一、高级提示词模板（AI编程最佳实践）

### 11.1 规格驱动开发

#### A1 规格驱动开发（Spec-Driven Development）

```
请按规格驱动开发流程实现 {功能名}：
1. 先阅读 {项目名}/docs/spec.md 中相关的功能需求（FR-XX）
2. 检查 {项目名}/docs/arch.md 中的架构设计
3. 检查 {项目名}/docs/design.md 中的详细设计
4. 按设计文档实现代码，不得偏离设计
5. 实现后对照spec.md逐条验证功能是否满足
6. 如发现设计与需求不一致，先更新设计文档再实现
```

#### A2 测试驱动修复（Test-Driven Fix）

```
请按测试驱动修复流程处理 {Bug描述}：
1. 先编写一个能复现Bug的测试用例（使用真实数据和真实环境）
2. 运行测试确认Bug存在
3. 定位Bug根因（阅读相关代码和日志）
4. 修复Bug（最小化修改，不重构无关代码）
5. 运行测试确认Bug已修复
6. 运行全量回归测试确认无副作用
7. 检查是否有类似Bug存在于其他模块
```

### 11.2 渐进式重构

#### A3 渐进式重构（Incremental Refactoring）

```
请对 {项目名} 的 {模块名} 进行渐进式重构：
1. 先阅读现有代码，理解当前实现和依赖关系
2. 识别重构目标（性能/可维护性/可扩展性）
3. 制定重构计划：分步骤、每步可验证、每步可回滚
4. 每步重构后运行全量测试验证
5. 重构过程中保持接口不变（向后兼容）
6. 重构完成后更新设计文档
禁止一次性大重构，必须分步进行。
```

#### A4 接口迁移（API Migration）

```
请对 {项目名} 的 {接口名} 进行接口迁移：
1. 新接口实现完成，与旧接口并行运行
2. 添加特性开关控制新旧接口切换
3. 逐步将调用方迁移到新接口
4. 所有调用方迁移完成后，移除旧接口
5. 验证迁移过程中无功能回归
6. 更新API文档和变更日志
```

### 11.3 安全审计

#### A5 安全审计（Security Audit）

```
请对 {项目名} 进行安全审计：
1. 依赖漏洞扫描（pip-audit / npm audit）
2. 敏感信息泄露检查（硬编码密钥/Token/密码）
3. 注入攻击检查（SQL注入/命令注入/XSS/SSRF）
4. 认证授权检查（API Key管理/权限控制/会话安全）
5. 数据安全检查（加密存储/传输安全/日志脱敏）
6. 爬虫合规检查（robots.txt/速率限制/User-Agent）
7. 输入验证检查（参数校验/类型检查/长度限制）
对每个发现的安全问题给出严重等级和修复方案。
```

#### A6 依赖安全检查

```
请检查 {项目名} 的所有依赖安全性：
1. 列出所有直接和间接依赖及版本
2. 检查是否有已知CVE漏洞
3. 检查是否有废弃/不再维护的依赖
4. 检查依赖许可证兼容性
5. 给出依赖升级建议和风险评估
```

### 11.4 性能优化

#### A7 性能基线与优化

```
请对 {项目名} 的 {功能/模块} 进行性能优化：
1. 先建立性能基线：响应时间/吞吐量/内存占用/LLM调用次数
2. 识别性能瓶颈（Profiling/日志分析/链路追踪）
3. 制定优化方案（预期提升目标）
4. 实施优化（每次只改一个变量）
5. 验证优化效果（对比基线数据）
6. 确保优化不影响功能正确性（全量回归测试）
```

#### A8 LLM调用优化

```
请优化 {项目名} 的LLM调用性能：
1. 统计当前LLM调用次数和Token消耗
2. 识别可合并的LLM调用（减少调用次数）
3. 识别可缩短的Prompt（减少Token消耗）
4. 检查是否有不必要的重试（优化重试策略）
5. 检查模型选择是否合理（简单任务用小模型）
6. 检查缓存利用率（语义缓存/结果缓存）
7. 实施优化后对比前后指标
```

### 11.5 可观测性

#### A9 可观测性建设

```
请为 {项目名} 建设可观测性：
1. 全链路追踪：trace_id自动注入，跨模块传递
2. Prometheus指标：核心业务指标 + 系统指标
3. 审计日志：所有Agent/Tool调用记录
4. 健康检查：/health端点 + 依赖服务探测
5. 告警规则：错误率/延迟/资源使用阈值
6. 仪表盘：Grafana Dashboard模板
确保所有I/O操作使用async/await，日志使用get_logger自动注入trace_id。
```

#### A10 链路追踪验证

```
请验证 {项目名} 的全链路追踪：
1. 发起一个端到端请求
2. 检查trace_id是否从API层传递到Agent层再到Tool层
3. 检查每个环节的日志是否包含trace_id
4. 检查审计日志是否记录完整的调用链
5. 检查Prometheus指标是否正确采集
6. 检查WebSocket事件是否包含trace_id
```

### 11.6 文档驱动

#### A11 文档与代码一致性验证

```
请验证 {项目名} 的文档与代码一致性：
1. 对照spec.md检查功能是否全部实现
2. 对照arch.md检查架构是否与代码一致
3. 对照design.md检查类签名和方法签名是否一致
4. 对照api.md检查API端点是否全部实现
5. 对照test.md检查测试用例是否全部覆盖
6. 对每个不一致项给出：文档描述 → 代码实际 → 修复建议
```

#### A12 变更影响分析

```
请对 {项目名} 的 {变更描述} 进行变更影响分析：
1. 列出所有受影响的模块和文件
2. 分析对上层项目的影响（接口变化/配置变化/行为变化）
3. 分析对下游依赖的影响（数据库/外部服务/消息格式）
4. 评估变更风险等级（高/中/低）
5. 制定变更计划（前置条件/执行步骤/验证方法/回滚方案）
6. 更新相关设计文档
```

---

## 十二、文档与代码一致性验证模板（防遗漏专项）

### 12.1 提示词外置验证

#### P19 提示词外置全量验证

```
请对 {项目名} 执行提示词外置全量验证：
1. 扫描所有Python文件中的硬编码LLM提示词（字符串中包含"你是一个"/"You are"/"请"/"Please"等模式）
2. 检查每个硬编码提示词是否在config/prompts.yaml中有对应定义
3. 检查代码是否通过PromptManager.get_prompt(key)加载，而非直接使用字符串
4. 检查_DEFAULT_PROMPTS字典是否与prompts.yaml内容一致
5. 检查是否存在跨文件重复的提示词定义
6. 对每个违规给出：文件路径 → 行号 → 硬编码内容摘要 → 应迁移到的YAML key
修复方案：所有硬编码提示词外置到prompts.yaml，代码通过get_prompt()加载
```

#### P20 提示词双重定义检测

```
请检测 {项目名} 是否存在提示词双重定义问题：
1. 检查_DEFAULT_PROMPTS字典和prompts.yaml是否定义了相同的key
2. 如果存在双重定义，验证两者内容是否一致
3. 确定运行时实际使用的是哪个定义（_DEFAULT_PROMPTS优先还是YAML优先？）
4. 删除_DEFAULT_PROMPTS，统一从YAML加载
5. 验证删除后所有提示词仍可正常加载
```

### 12.2 架构边界验证

#### P21 FlowForge纯框架验证

```
请验证FlowForge是否为纯通用框架，不含任何特定领域代码：
1. 扫描flowforge/agents/目录，检查是否有内容创作/小说/电商/开发特定Agent
2. 扫描flowforge/tools/目录，检查是否有内容发布/素材检索/小说检索特定Tool
3. 扫描flowforge/config/目录，检查是否有内容/小说/电商特定配置
4. 对每个违规给出：文件路径 → 所属领域 → 应移至哪个*Forge项目
5. 执行迁移后验证FlowForge仍可独立运行
铁律：FlowForge是底座，至少2个上层应用需要的能力才可下层到FlowForge
```

#### P22 *Forge轻量化验证

```
请验证 {项目名} 是否为轻量业务扩展，不含重复服务代码：
1. 检查是否有独立编排逻辑（应使用FlowForge Orchestrator + Workflow）
2. 检查是否有独立DI容器（应使用FlowForge SDK自动发现注册）
3. 检查是否有独立数据库层（应使用FlowForge Memory）
4. 检查是否有独立LLM服务（应使用FlowForge LLMClient）
5. 检查是否有独立SOP编排（应使用FlowForge Workflow YAML）
6. 检查是否有独立调度器（应使用FlowForge Scheduler）
7. 检查是否有独立配置系统（应继承FlowForge SystemConfig）
对每个违规给出：文件路径 → 重复代码行数 → 应使用的FlowForge替代方案
```

### 12.3 配置驱动验证

#### P23 配置驱动率验证

```
请验证 {项目名} 的配置驱动率：
1. 统计Agent总数 → 其中通过YAML配置声明的数量 → 配置驱动率
2. 统计Tool总数 → 其中通过YAML配置声明的数量 → 配置驱动率
3. 统计Workflow总数 → 其中通过YAML配置定义的数量 → 配置驱动率
4. 目标：Agent配置驱动率≥80%，Tool≥60%，Workflow≥90%
5. 对每个代码继承的Agent/Tool，分析是否可转为DeclarativeAgent YAML配置
6. 给出配置驱动率提升路线图
```

#### P24 DeclarativeAgent能力验证

```
请验证FlowForge的DeclarativeAgent是否具备足够的配置能力：
1. 是否支持state_updates映射配置（Agent执行后自动更新state字段）
2. 是否支持permissions配置（per-agent权限规则集）
3. 是否支持tools配置（per-agent工具可见性白名单）
4. 是否支持max_steps配置（Agent步数限制）
5. 是否支持hidden配置（隐藏Agent不出现在用户可选列表）
6. 是否支持fallback_chain配置（工具调用的有序回退链）
7. 是否支持conditional_router配置（根据输入条件选择不同处理路径）
对每个缺失能力给出实现优先级和方案
```

### 12.4 安全与质量门禁

#### P25 安全漏洞全量扫描

```
请对 {项目名} 执行安全漏洞全量扫描：
1. 命令注入：检查subprocess/os.system/eval/exec使用，是否对用户输入做了转义
2. 路径遍历：检查文件操作是否验证路径在项目根目录内
3. SQL注入：检查是否有字符串拼接SQL，是否使用参数化查询
4. 密钥泄露：检查是否有硬编码的API Key/Secret/Token
5. 异常信息泄露：检查全局异常处理器是否返回完整traceback
6. 不安全反序列化：检查pickle/yaml.load使用
7. SSRF：检查是否有用户可控的URL请求
对每个漏洞给出：文件路径 → 行号 → 漏洞类型 → 严重等级 → 修复方案
```

#### P26 代码质量自动化检查

```
请对 {项目名} 执行代码质量自动化检查：
1. 类型注解覆盖率：统计有类型注解的函数比例，目标≥90%
2. 异步一致性：检查是否有同步I/O操作在async函数中（如open/read/write/sqlite3）
3. 日志规范：检查是否使用get_logger而非print/logging.getLogger
4. 错误处理：检查是否有裸except/except Exception: pass
5. 依赖注入：检查是否有绕过DI容器的直接实例化
6. 数据访问：检查是否有绕过Repository的直接SQL
7. 配置外置：检查是否有硬编码路径/端口/超时/密钥
8. 废弃代码：检查是否有DeprecationWarning标记但仍被使用的代码
每个维度给出违规数量和具体位置
```

### 12.5 OpenCode 对标验证

#### P27 Session持久化对标验证

```
请对照OpenCode的Session持久化设计，验证FlowForge的会话管理：
1. 是否支持事件溯源（所有状态变更通过事件驱动）
2. 是否支持Prompt投递与执行分离（admit→promote→execute）
3. 是否支持RunCoordinator并发控制（每Session最多一个drain链）
4. 是否支持Context Epoch（Agent/模型切换时上下文重建）
5. 是否支持Session中断序列号追踪
6. 是否支持崩溃恢复（进程重启后可恢复会话）
对每个缺失能力给出实现方案和优先级
```

#### P28 LLM路由层对标验证

```
请对照OpenCode的LLM路由设计，验证FlowForge的LLM访问层：
1. 是否支持Protocol/Route/Provider三层分离
2. 新增OpenAI兼容Provider是否只需1-2行配置
3. 是否支持多协议路由（OpenAI Chat/Anthropic Messages/Gemini/Bedrock）
4. 是否支持Provider-specific请求选项（如anthropic.thinking）
5. 是否支持API Key多源解析（credential>env>config）
6. 是否支持Model Variant系统（同一模型不同模式）
对每个缺失能力给出实现方案和优先级
```

#### P29 权限系统对标验证

```
请对照OpenCode的Permission V2设计，验证FlowForge的权限系统：
1. 是否支持有序规则集（findLast语义，后定义的覆盖前面的）
2. 是否支持allow/deny/ask三态效果
3. 是否支持Wildcard匹配（action和resource都支持通配符）
4. 是否支持运行时交互式授权（ask→等待用户回复）
5. 是否支持级联授权（一次"always"回复自动解决多个同类请求）
6. 是否支持per-agent权限规则集
7. 是否支持工具可见性按权限过滤
对每个缺失能力给出实现方案和优先级
```

#### P30 Compaction对标验证

```
请对照OpenCode的Compaction设计，验证FlowForge的上下文管理：
1. 是否支持Token估算（用于判断何时触发压缩）
2. 是否支持双阈值设计（buffer触发阈值 + keepTokens保留量）
3. 是否支持增量摘要（有旧summary时是更新而非从头生成）
4. 是否支持结构化摘要模板（Goal/Progress/Decisions/Next Steps/Files）
5. 是否支持Overflow恢复（context overflow时自动压缩重试）
6. 是否支持Compaction配置（auto/buffer/keep_tokens可配置）
对每个缺失能力给出实现方案和优先级
```

---

## 十三、LLM内容审核与Web功能验证方法论

> **核心原则**：测试验证不能只看"调用是否返回无异常"，必须验证"生成内容是否正确"和"网页操作是否真正成功"。
> **铁律T7**：凡涉及LLM和内容生成的场景，必须调用LLM对生成内容审核，审核通过才算验证通过。
> **铁律T8**：凡涉及网页Web功能验证的场景，必须操控浏览器查看DOM中的功能和内容，确认真实成功才算通过。
> **铁律T9**：凡涉及运行时生成数据文件的场景，必须验证文件存放路径在 `agents/main/data/` 目录下，禁止污染 `scripts/vendor/platforms/prompts/config` 等代码目录。
> **适用项目**：FlowForge、ContentForge、DevForge、NovelForge、MallForge、OpenRoute、OpenSieve、HicLaw 全部8个项目。

### 13.0 标准案例模板（参考实现）

> 以下模板基于 openclaw_pkg/content 项目 `hiclaw/test/test_interact.py` 的真实实现，供其他7个项目编写 T7/T8 测试用例参考。
> 该项目已通过 T7（LLM二次审核）+ T8（DOM验证）双重校验，覆盖评论生成、评论回复、文章发布等场景。

#### 13.0.1 T7 LLM二次审核标准案例

**场景**：评论生成后，调用 reviewer agent（与生成所用模型不同的 LLM）对评论进行二次审核，只输出 `VERDICT: PASS` 或 `VERDICT: FAIL`。

**真实输入案例**：

```
📝 请求内容 (首条): 你是评论审核员，负责判断评论是否合格。只拦截指令泄露、AI痕迹、
   格式异常、内容违规和纯套话，不要对口语化表达过度审核。只输出VERDICT和REASON。
   ...
   待审核评论：讲真，嫉妒一个三岁孩子能下这种死手，怀没怀孕都改变不了心狠手辣的事实。
   希望法律能给个公道，别因为怀孕就轻判了。
⏱️ LLM请求超时: 180s, model=DeepSeek-V4-Pro, max_tokens=4000
```

**真实输出案例**：

```
📡 响应状态码: 200
📝 响应内容: VERDICT: PASS
 REASON: 评论表达了个人观点和对法律公正的期待，内容实质且无违规。
📊 Token: prompt=0 completion=0 total=0
✅ 成功，耗时 40.73s, 响应长度=50
✅ [T7] 评论审核通过 | verdict=PASS
```

**实现要点**：
1. 生成与审核使用不同模型（creator=豆包生成，polisher=DeepSeek审核），避免同模型自评放水
2. 审核提示词只做客观拦截：指令泄露、AI痕迹、格式异常、内容违规、纯套话
3. 审核提示词明确要求"只输出 VERDICT 和 REASON"，便于程序解析
4. 解析 `VERDICT: PASS/FAIL` 作为通过判定，`REASON` 仅记录不参与判定
5. 候选链 fallback 时，跳过当前模型尝试下一个，避免单点故障

**审核提示词模板**（参考 `prompts/comment_review.j2`）：

```
你是评论审核员，负责判断评论是否合格。只拦截指令泄露、AI痕迹、格式异常、
内容违规和纯套话，不要对口语化表达过度审核。

## 审核原则
- 宁可放过，不可误杀：口语化、简短、有情绪表达都视为合格
- 只拦截明显不合格的内容

## 审核维度（仅6项客观检查）
1. 指令泄露：是否暴露了"你是xx用户"等系统提示
2. AI痕迹：是否有"作为AI"、"我是一个"等明显痕迹
3. 格式异常：是否包含 markdown 符号、JSON 结构等非自然语言
4. 内容违规：是否包含仇恨、暴力、色情等违规内容
5. 纯套话：是否为"写得真好"、"非常棒"等无信息量套话
6. 与文章无关：是否完全偏离文章主题

## 输出格式（严格）
VERDICT: PASS 或 VERDICT: FAIL
REASON: 简短说明（一句话）
```

#### 13.0.2 T8 DOM验证标准案例

**场景**：评论提交后，从子进程 stdout 解析"评论已确认发布"日志，或通过 CDP 浏览器连接目标页面，在 DOM 中查找评论内容确认真实发布。

**真实日志输出案例（Linux stdout 模式）**：

```
[test_interact][INFO] [T8] 平台=linux | 验证方式=CDP浏览器验证
[test_interact][INFO] [T8] Linux验证结果: found=True | method=linux_stdout_log
[test_interact][INFO] [T8] 差异说明: 未启用--verify时使用stdout日志解析；启用--verify时使用CDP浏览器直接验证DOM
✅ [T8] 评论DOM验证通过 | method=linux_stdout_log
```

**实现要点**：
1. 子进程 stdout 必须打印关键日志：`打开文章: {url}`、`尝试发布评论: {comment}...`、`评论已确认发布`
2. 测试程序解析 stdout 提取 (url, comment) 元组
3. Linux 平台：
   - 默认基于 stdout 日志确认（速度快，不依赖浏览器）
   - `--verify` 启用时使用 CDP 浏览器连接目标页面，在 DOM 中查找评论内容
4. Windows 平台：基于 stdout 日志中的"评论已确认发布"标记确认
5. 验证结果计入 `DOMVerifier.results`，由 `TestReporter` 汇总

**stdout 解析正则模板**（参考 `test_interact.py::_parse_stdout_for_verify`）：

```python
# 提取文章URL
url_match = re.search(r'打开文章[:：]\s*(https?://\S+)', line)

# 提取评论文本
comment_match = re.search(r'尝试发布评论[:：]\s*(.+?)\.\.\.', line)

# DOM确认日志（Windows / Linux stdout 模式）
dom_confirm_keywords = {
    "comment": "评论已确认发布",
    "reply": "回复已确认发布",
}
```

**CDP 浏览器验证模板**（参考 `test_verify_result.py`）：

```python
# 1. 连接浏览器（CDP端口从 browser_config.json 读取）
browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
page = browser.contexts[0].pages[0]

# 2. 导航到目标文章
await page.goto(article_url)

# 3. 在DOM中查找评论文本
comment_locator = page.locator(f"text={comment_text}")
found = await comment_locator.count() > 0

# 4. 返回验证结果
return found
```

#### 13.0.3 T7/T8 联合验证流程（开关化）

**默认关闭策略**：
- 评论生成已内置 LLM 二次审核（creator→polisher），T7 仅在交叉验证时开启
- DOM 验证依赖浏览器或日志，T8 仅在需要确认真实发布时开启
- 默认关闭可大幅提升测试速度，避免重复 LLM 调用

**开关设计**：

```python
parser.add_argument("--t7", action="store_true",
                    help="启用T7 LLM二次审核（默认关闭；评论生成已含LLM审核）")
parser.add_argument("--t8", action="store_true",
                    help="启用T8 DOM验证（默认关闭；如需对发布结果做DOM校验时开启）")
```

**调用流程**：

```
1. 运行子进程（interactor.py）实时输出 stdout/stderr
2. 解析 stdout 提取 (url, comment) 元组
3. 如 --t7 启用：调用 reviewer.review(comment) → VERDICT: PASS/FAIL
4. 如 --t8 启用：调用 _t8_verify_item() → 基于 stdout 日志或 CDP 浏览器
5. 汇总 T7/T8 通过率，写入 metrics 和 TestReporter
```

**典型执行命令**：

```bash
# 默认（T7/T8关闭）：仅评论生成+发布，不二次验证
python3 test_interact.py --scenario all --platform toutiao --count 3

# 启用 T7：交叉验证评论质量
python3 test_interact.py --scenario content --platform toutiao --count 3 --t7

# 启用 T7+T8：完整审核链路（含CDP浏览器DOM验证）
python3 test_interact.py --scenario content --platform toutiao --count 3 --t7 --t8 --verify
```

#### 13.0.4 跨项目适配清单

其他7个项目编写 T7/T8 测试用例时，按以下清单适配：

| 项目 | T7 审核对象 | T8 DOM验证对象 | 关键脚本 |
|------|-----------|---------------|---------|
| FlowForge | 流程生成内容 | 流程执行后页面状态 | flowforge/test/test_*.py |
| ContentForge | 文章/微头条内容 | 文章发布后页面 | contentforge/test/test_publish.py |
| DevForge | 代码/文档生成内容 | 部署后页面 | devforge/test/test_*.py |
| NovelForge | 小说章节内容 | 章节发布后页面 | novelforge/test/test_*.py |
| MallForge | 商品描述/文案 | 商品上架后页面 | mallforge/test/test_*.py |
| OpenRoute | 模型路由决策 | 路由配置生效后页面 | hiclaw/test/test_*.py |
| OpenSieve | 筛选结果 | 筛选结果展示页 | opensieve/test/test_*.py |

**适配步骤**：
1. 在测试脚本中添加 `--t7` / `--t8` CLI 开关，默认关闭
2. 实现 stdout 解析函数，提取待验证内容（URL、标题、正文等）
3. T7：调用 reviewer agent 审核，解析 `VERDICT: PASS/FAIL`
4. T8：基于 stdout 日志或 CDP 浏览器查找 DOM
5. 验证结果写入 `MetricsCollector` 和 `TestReporter`
6. 提供 `--verify` 启用 CDP 浏览器完整 DOM 验证

### 13.1 LLM内容审核验证

#### V1 LLM生成内容审核验证

```
请对 {项目名} 中所有LLM生成内容的场景增加LLM审核流程，确保生成内容的质量和正确性。

审核流程：LLM生成内容 → 规则过滤（白名单/黑名单/格式校验） → LLM二次审核 → 审核通过才发布

审核维度（6项，按内容类型调整权重）：
1. 自然度 — 是否有AI生成痕迹（"作为一个AI"、免责声明、模板化表达等）
2. 相关性 — 是否与上下文/需求/输入相关，是否答非所问
3. 格式 — 是否符合预期格式（纯文本/代码/JSON/Markdown等），有无异常格式
4. 长度 — 仅极端过短或明显过长才不合格，不因字数略低于建议范围而判失败
5. 内容 — 是否含广告/引流/违规/敏感/攻击性内容，是否含"SKIP/无法处理"等错误响应
6. 连贯性 — 语句/代码/逻辑是否通顺自洽，有无语病/错乱/拼接痕迹

审核结果格式（LLM必须严格返回）：
  VERDICT: PASS  或  VERDICT: FAIL\nREASON: <原因>
- 只有 VERDICT: PASS 才放行
- 返回格式异常或调用失败时默认不通过（fail-closed）

适用场景清单（按项目逐一检查是否已接入LLM审核）：
□ FlowForge: Agent决策推理（Thought→Action→Observation）、反馈循环评估（四维评分）、Reflexion自修正、Agent Handoff决策、Self-Discover推理结构生成、文档园丁修复PR
□ ContentForge: 文章创作（选题→研究→写作→SEO→事实核查）、微头条创作、评论生成、回复评论、视频文案、SEO标题优化、素材抓取摘要、事实核查判断
□ DevForge: 代码生成（Reflexion自检）、需求分析文档、架构设计文档（GoT）、详细设计文档、测试用例生成、代码审核意见（Multi-Agent辩论）、安全审查报告、门禁评审决策
□ NovelForge: 小说章节创作（Reflexion）、角色对话、情节大纲（Plan-and-Execute）、世界观设定（GoT）、概念包生成、风格校准样本、章/卷/全书摘要、一致性检测、润色优化、通读报告、盲评评分
□ MallForge: 商品文案（A+内容/五点描述）、SEO标题（多语言）、产品描述（10+语言翻译）、营销文案、客服自动回复、意图分类、差评告警、选品决策
□ OpenRoute: 路由决策说明、ToolParser解析（从LLM文本解析tool_calls）、Prompt组合注入、上下文管理去重
□ OpenSieve: 查询理解（意图识别/查询重写/子查询分解）、CRAG反思（2轮修正）、Self-RAG评估、Multi-Hop分解、内容提取（Markdown）、RAGAS评估
□ HicLaw: 法律文书起草、案例分析、合规说明、条款解读、Content创作引擎全场景（文章/微头条/评论/回复/视频文案）、模型评分计算

对每个未接入审核的场景，立即实现审核流程并回归验证。
参考实现：toutiao_interactor.py / douyin_interactor.py 的 _review_comment_with_llm() 方法
```

#### V2 LLM审核提示词设计规范

```
请检查 {项目名} 中所有LLM审核提示词是否符合以下设计规范：

1. 角色设定：必须明确"你是严格的审核员"，不能让LLM以创作者身份审核自己的内容
2. 审核维度：必须覆盖6项维度（自然度/相关性/格式/长度/内容/连贯性）
3. 字数维度：不能因字数略低于建议范围就判FAIL，仅极端过短（<5字）或过长（>200字）才不合格
4. 输出格式：必须要求LLM严格返回 VERDICT: PASS/FAIL 格式，便于程序解析
5. 上下文提供：审核时必须提供原始上下文（文章内容/视频信息/原评论），让LLM判断相关性
6. 场景区分：评论审核和回复审核应使用不同的上下文（评论用article，回复用comment+article）
7. 失败处理：审核失败时不得发布，应重新生成或跳过，不能强制发布未通过审核的内容

对每个不符合规范的审核提示词，给出修复方案并实施。
```

### 13.2 Web功能DOM验证

#### V3 Web功能DOM验证

```
请对 {项目名} 中所有涉及网页操作的功能增加浏览器DOM验证，确保功能真正执行成功。

验证流程：功能执行完成 → 连接浏览器（CDP） → 导航到目标页面 → 查看DOM内容 → 确认结果存在

验证模式（按场景选择）：
1. 存在性验证 — 导航到目标页面，搜索标题/内容是否存在
2. 状态验证 — 导航到管理页，检查状态字段（已发布/草稿/上架/部署等）
3. 内容验证 — 打开详情页，搜索具体文本内容是否正确
4. 交互验证 — 打开目标页，检查评论/回复/点赞/提交等操作是否生效

验证要求：
1. 必须通过CDP连接真实浏览器实例，禁止Mock浏览器
2. 必须导航到真实页面，在DOM中搜索内容
3. 搜索采用模糊匹配（取前30字），支持多次滚动加载（最多5次）
4. 验证过程中必须调用LLM对DOM中获取的内容进行质量审核（T7+T8联合验证）
5. 只有DOM中确认找到目标内容且LLM审核通过才算通过

适用场景清单（按项目逐一检查是否已接入DOM验证）：
□ FlowForge: Helm界面工作区显示、任务列表过滤、步骤进度条同步、WebSocket事件推送、审核节点暂停/恢复、资源管理器高亮、Plan面板、Diff视图
□ ContentForge: 多平台发布（4平台）、Web控制台仪表盘、审核中心Human-in-the-Loop、定时任务管理、发布日志审计、Helm Studio实时观察
□ DevForge: 代码部署结果验证、CI/CD执行结果、PR状态页面、Issue状态页面、金丝雀发布监控面板、DevForge Web UI（任务/审核/代码页面）
□ NovelForge: 小说发布、章节更新页面、目录生成、NovelForge Web UI（写作/任务/世界观构建页面）
□ MallForge: 商品上架（TikTok/Amazon/Shopee）、文案发布、价格更新、库存变更、广告投放管理、客服消息回复、热榜监控爬取
□ OpenRoute: 7平台WebChat浏览器自动化（豆包/Kimi/DeepSeek/通义/元宝/GLM/MiniMax）、流式输出DOM监听、Cookie获取、路由配置生效验证
□ OpenSieve: 爬虫框架浏览器自动化（Playwright反检测）、20+搜索源爬取、图片下载（四层发现策略）、筛选结果展示、Prometheus+Grafana监控
□ HicLaw: 多平台发布（4平台）、平台互动（浏览/点赞/评论/回复）、视频发布、浏览器验证（draft/published/comment/reply）、QQ机器人消息收发、微信机器人扫码登录

对每个未接入DOM验证的场景，使用 hiclaw/test/browser_verify.py 实现验证并回归测试。
验证工具：python3 test_verify_result.py --platform <平台> --mode <模式> --account <账户> ...
```

#### V4 测试用例DOM验证集成

```
请检查 {项目名} 的所有测试用例，确保涉及网页操作的测试都集成了浏览器DOM验证。

当前问题：测试用例只看 subprocess.returncode == 0，不检查浏览器端是否真正成功。
要求：所有涉及网页操作的测试，必须在操作完成后自动运行浏览器DOM验证+LLM内容审核。

集成方式：
1. 测试脚本通过 --verify 参数启用浏览器验证
2. 操作完成后，从stdout解析目标内容（URL、标题、评论文本等）
3. 调用 browser_verify 模块连接浏览器，导航到目标页面
4. 在DOM中搜索目标内容，确认真实存在
5. 对DOM中获取的内容调用LLM进行质量审核（T7）
6. 验证结果计入测试报告（DOM验证+LLM审核都通过才算测试通过）

检查清单（按项目逐一检查）：
□ ContentForge: test_publish.py / test_interact.py / test_weitoutiao.py / test_video_e2e.py 是否支持 --verify
□ FlowForge: 流程执行测试是否检查页面DOM结果
□ DevForge: 代码部署测试是否检查部署后页面状态
□ NovelForge: 小说发布测试是否检查发布后页面
□ MallForge: 商品上架测试是否检查上架后页面
□ OpenRoute: 路由配置测试是否检查配置生效后页面
□ OpenSieve: 筛选结果测试是否检查筛选后页面
□ HicLaw: 文书发布测试是否检查发布后页面
对每个不支持的测试文件，添加 --verify 参数和验证逻辑。
```

### 13.3 综合验证模板

#### V5 全链路验证（通用）

```
请对 {项目名} 的核心功能执行全链路验证，确保从内容生成到网页操作的每个环节都真实成功。

验证链路（T7+T8联合）：
1. LLM生成内容 → 规则过滤 → LLM审核（T7）→ 审核通过
2. 内容输出/发布到目标 → 浏览器DOM验证（T8）→ 确认成功
3. DOM中获取的内容 → LLM质量审核（T7）→ 确认内容正确
4. （如涉及交互）交互操作 → DOM验证交互结果 → LLM审核交互内容

执行步骤：
1. 运行功能测试，启用 --verify 参数
2. 检查LLM审核是否通过（看日志中 VERDICT: PASS）
3. 检查浏览器DOM验证是否通过（看日志中 ✅ 验证通过）
4. 检查DOM内容的LLM质量审核是否通过
5. 全链路通过的标志：LLM审核 PASS + DOM验证找到 + DOM内容LLM审核 PASS
```

#### V6 验证结果报告模板

```
请按以下格式输出验证结果报告：

## 验证结果报告

### LLM内容审核结果（T7）
| 场景 | 生成内容 | 审核结果 | 审核原因 |
|------|---------|---------|---------|
| 内容生成 | 内容前30字... | ✅ PASS | - |
| 交互内容 | 内容前30字... | ❌ FAIL | 原因说明 |

### Web功能DOM验证结果（T8）
| 场景 | 验证模式 | 目标 | DOM验证结果 | 详情 |
|------|---------|------|------------|------|
| 内容发布 | 存在性 | 标题前30字 | ✅ 找到 | 页面中存在 |
| 交互操作 | 交互验证 | URL+内容 | ❌ 未找到 | 页面未找到 |

### DOM内容LLM质量审核（T7+T8联合）
| 场景 | DOM获取内容 | LLM审核结果 | 审核原因 |
|------|-----------|------------|---------|
| 内容发布 | DOM中的标题和摘要 | ✅ PASS | 内容正确 |
| 交互操作 | DOM中的评论内容 | ❌ FAIL | 质量不达标 |

### 总结
- LLM审核：X/Y 通过
- DOM验证：X/Y 通过
- DOM内容LLM审核：X/Y 通过
- 整体结论：✅ 全部通过 / ❌ 有失败项需修复
```

### 13.4 运行时数据文件存放校验（铁律T9）

> **铁律T9**：凡涉及运行时生成数据文件（缓存、持久化记录、浏览器数据等）的场景，必须验证文件存放路径在 `agents/main/data/` 目录下，禁止污染 `scripts/vendor/platforms/prompts/config` 等代码目录。

**背景**：2026-06-26 发现 `scripts/vendor/toutiao-publisher/replied_comments_小布头来啦.json` 违规存放在 vendor 代码目录。根因是 `toutiao_interactor.py._get_replied_comments_file()` 使用了 `os.path.dirname(__file__)` 直接拼接文件名，而 `douyin_interactor.py` 写法正确（用 `Path(__file__).parent.parent.parent / "data" / "douyin"`）。

**校验步骤**：

1. **静态扫描代码**：搜索所有 `os.path.dirname(__file__)`、`Path(__file__).parent` 的使用，确认目标路径是 `data/` 目录
   ```bash
   # 扫描潜在违规写法
   grep -rn "os.path.dirname(__file__)" scripts/vendor/
   grep -rn "Path(__file__).parent" scripts/vendor/
   ```

2. **扫描已有违规文件**：检查代码目录下是否存在运行时数据文件
   ```bash
   # 扫描 vendor 目录下的 .json/.db/.log 文件
   find scripts/vendor/ -name "*.json" -o -name "*.db" -o -name "*.log" 2>/dev/null
   # 正确做法：这些文件应该在 data/ 目录下
   find data/ -name "*.json" -o -name "*.db" 2>/dev/null
   ```

3. **运行时验证**：执行一次完整流程后，检查 data 目录是否生成预期文件
   ```bash
   # 跑评论后应该生成
   ls data/toutiao/replied_comments_*.json
   ls data/douyin/replied_*.json
   # 不应该在 vendor 目录生成任何文件
   ls scripts/vendor/toutiao-publisher/*.json 2>/dev/null  # 应该为空
   ```

**正确写法模板**（参考 `douyin_interactor.py:241`）：

```python
from pathlib import Path

def _get_replied_comments_file(self) -> str:
    """缓存文件统一存放到 article-orchestrator/data/<platform>/ 目录"""
    # Path(__file__).parent.parent.parent 从 vendor/xxx-publisher/ 回到 article-orchestrator/
    data_dir = Path(__file__).parent.parent.parent / "data" / "toutiao"
    data_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r'[^\w\u4e00-\u9fff]', '_', account_name)
    return str(data_dir / f"replied_comments_{safe_name}.json")
```

**违规写法（必须避免）**：

```python
# ❌ 错误：写到代码所在目录
script_dir = os.path.dirname(os.path.abspath(__file__))
filepath = os.path.join(script_dir, f"replied_comments_{name}.json")

# ❌ 错误：写到 vendor 目录
filepath = os.path.join(os.path.dirname(__file__), "cache.json")
```

**跨项目适配清单**：

| 项目 | 数据目录 | 常见运行时数据文件 | 校验脚本 |
|------|---------|-------------------|---------|
| FlowForge | `agents/main/data/` | task_state.json, loop_checkpoints.db | `find scripts/vendor -name "*.json"` |
| ContentForge | `agents/main/data/` | replied_comments_*.json, commented_articles_*.json | 同上 |
| DevForge | `agents/main/data/` | deploy_state.json, build_log.db | 同上 |
| NovelForge | `agents/main/data/` | chapter_outline.json, review_state.json | 同上 |
| MallForge | `agents/main/data/` | product_cache.json, listing_state.json | 同上 |
| OpenRoute | `data/` | model_routes.yaml (配置除外), fallback_state.json | `find . -name "*.json" -not -path "./data/*"` |
| OpenSieve | `data/` | semantic_cache.db, embedding_cache/ | 同上 |

**自动化校验脚本模板**：

```python
def verify_data_file_location(project_root: str) -> bool:
    """校验所有运行时数据文件都在 data/ 目录下"""
    code_dirs = ["scripts/vendor", "scripts/platforms", "scripts/prompts", "scripts/config"]
    bad_extensions = [".json", ".db", ".log", ".csv", ".tmp"]
    
    violations = []
    for code_dir in code_dirs:
        full_path = os.path.join(project_root, code_dir)
        if not os.path.exists(full_path):
            continue
        for root, dirs, files in os.walk(full_path):
            for f in files:
                if any(f.endswith(ext) for ext in bad_extensions):
                    # 配置文件白名单
                    if f in ("browser_config.json", "default.yaml", "model_routes.yaml"):
                        continue
                    violations.append(os.path.join(root, f))
    
    if violations:
        print(f"❌ 发现 {len(violations)} 个违规数据文件：")
        for v in violations:
            print(f"   {v}")
        return False
    print("✅ 所有运行时数据文件均存放在 data/ 目录")
    return True
```

---

## 附录：项目速查表

| 项目 | 端口 | 定位 | 关键目录 |
|------|:----:|------|---------|
| FlowForge | 8000/5174 | 核心Harness平台 | flowforge/ |
| ContentForge | 8001/5175 | AI内容创作工厂 | contentforge/ |
| DevForge | 8002/5176 | AI开发工厂 | devforge/ |
| NovelForge | 8003/5177 | AI小说创作工厂 | novelforge/ |
| MallForge | 8004/5178 | AI电商运营工厂 | mallforge/ |
| OpenRoute | 13001 | 多模型API网关 | hiclaw/tool/openroute/ |
| OpenSieve | 8100 | 聚合检索增强中台 | opensieve/ |
| openclaw_pkg content | 800 | openclaw内容创作AI工具 | openclaw_pkg/worksapce/content hiclaw/tool/model_manager/ hiclaw/install/ hiclaw/test/|

---

## 附录：提示词使用指南

### 使用原则
1. **先读后写**：使用提示词前先阅读相关设计文档和代码
2. **真实验证**：所有验证必须使用真实数据和真实环境
3. **禁止Mock**：测试铁律9条（T1-T9），违反即无效
4. **渐进实施**：大型任务分步进行，每步可验证
5. **文档同步**：代码变更后同步更新设计文档

### 提示词编号规则
- **P1-P19**：公共模板（跨项目通用，P8A为架构边界铁律，P14A为全量扫描专用）
- **P31-P35**：新增公共模板（Loop执行强制验证/变更安全验证/质量评审配置/禁止事项清单/长程任务执行规范）
- **FF1-FF19**：FlowForge专用
- **FF20-FF21**：新增FlowForge（Loop执行器集成验证/SSE协议契约验证）
- **FF22-FF26**：新增FlowForge（React工具调用规范/声明式配置加载规则/前后端适配规范/LLM超时回退规范/OpenRoute回退机制规范）—— 来源 2026-06-25 端到端验证与风险调研
- **CF1-CF9**：ContentForge专用
- **CF10**：新增ContentForge（Content集成验证）
- **DF1-DF6**：DevForge专用
- **NF1-NF8**：NovelForge专用
- **MF1-MF8**：MallForge专用
- **OR1-OR9**：OpenRoute专用
- **OS1-OS16**：OpenSieve专用
- **HL1-HL5**：HicLaw专用
- **HL6**：新增HicLaw（测试性能与稳定性验证）
- **Q1-Q8**：追问与纠偏模板
- **A1-A12**：高级提示词模板

### 审计优先级指南
1. **首次审计**：先执行P14A（代码全量扫描），这是最严格的逐文件扫描，能发现最多问题
2. **功能验证**：再按项目模板（FF/CF/NF等）验证功能实现
3. **深度追问**：用Q1-Q8追问模板确保没有遗漏
4. **持续改进**：用P15技术债务清理和P14代码质量门禁保持代码质量
- **P19-P30**：文档与代码一致性验证
- **V1-V6**：LLM内容审核与Web功能验证方法论

---

## 十三、长程任务与Loop工程实践

> 来源：2025-2026联网调研AI编程最佳实践 + review.md痛点反思

### P36: 长程任务进度文件模式
```
执行长程任务时，每个阶段完成后必须更新进度文件：
1. 进度文件路径：{项目}/docs/progress.md
2. 内容包含：已完成工作、失败方法及原因、下一步计划、关键上下文摘要
3. 每个阶段完成后更新进度文件，然后可以清空上下文重新开始
4. 新会话首先读取进度文件恢复状态
5. 完全重置优于半压缩（避免上下文腐烂）
```

### P37: 可验证目标检查清单
```
每个任务必须有可验证的完成标准，禁止模糊目标：
1. 测试全绿（pytest全部通过）
2. 类型检查通过（mypy/pyright无错误）
3. Lint通过（ruff/flake8无错误）
4. 功能验证（真实LLM调用+真实数据+DOM验证）
5. 性能达标（SLO指标在范围内）
6. 文档同步（代码修改伴随文档更新）
没有可验证目标的任务只是"Token焚烧炉"
```

### P38: 六层Guardrails防护验证
```
验证AI编程是否具备六层防护：
1. Input validation：输入是否经过验证（PII脱敏/注入检测/长度限制）
2. System prompt constraints：是否有明确的禁止规则和行为边界
3. Tool allow-lists：工具是否通过白名单注册（禁止直接import）
4. Output validation：输出是否经过Pydantic schema校验
5. Action confirmation hooks：敏感操作是否有人工确认
6. Cost/iteration ceilings：是否有max_iterations和max_tokens硬上限
```

### P39: 反思模式验证
```
验证Agent是否具备自我纠错能力：
1. 是否有独立的Critic Agent（评委）审查Generator输出
2. 是否设置最大迭代次数（3-5次）避免无限循环
3. 是否基于真实执行反馈（Error-driven）而非主观判断
4. 迭代修正后是否重新验证（不是直接接受）
5. 成功案例是否沉淀到知识库供后续任务复用
```

### P40: 增量规划验证
```
验证任务规划是否为增量式：
1. 是否先规划前3-5步而非一次性全规划
2. 每步执行后是否观察结果再规划下一步
3. 是否开头说清楚"目标+硬约束"，细节让Agent自己探索
4. 是否避免"过早结束"（工作未完成就声称完成）
5. 是否避免"错误滚雪球"（早期错误影响后续规划）
```

---

## FlowForge v7.0 专属模板（FF22-FF23）

> **版本**: v7.0 增补 FlowForge 专属模板
> **创建日期**: 2026-07-17
> **审核状态**: ✅ operator 已审核通过命名方案 + 体系设计
> **依据**: ADR 005 forgemind 应用层 + ADR 006 三方 Agent 集成 + ADR 012 命名融合
> **铁律**: 所有提示词模板用 YAML 格式（外置到 prompts.yaml，不在 .py 文件中硬编码）

---

### FF22 forgemind 集成验证模板

> **用途**: 验证 *Forge 是否正确通过 Plugin V3 四钩子注册灵智体到 forgemind
> **适用项目**: FlowForge + 所有 *Forge（contentforge/devforge/novelforge/mallforge）
> **验证项**: register_forgekins / register_forge_skills / register_council_channels / register_auto_forge_config

```yaml
# prompts.yaml — FF22 forgemind 集成验证模板
template_id: FF22
name: forgemind 集成验证模板
version: v7.0
purpose: "验证 *Forge 是否正确通过 Plugin V3 四钩子注册灵智体到 forgemind"
applies_to: [FlowForge, ContentForge, DevForge, NovelForge, MallForge]
verification_items:
  - hook: register_forgekins
    checks:
      - "插件类是否实现 register_forgekins() 方法返回 List[ForgekinSpec]"
      - "注册的灵智体形态是否属于 5 种合法形态（BioForgekin/OrgForgekin/ObjForgekin/VirtualForgekin/HybridForgekin）"
      - "ForgekinSpec 是否包含 species/capability_requirements/value_charter 三字段"
      - "灵智体是否通过 DI 容器管理（禁止绕过 DI 直接实例化，编程红线第 12 条）"
      - "forgemind 是否能通过 forgekin_id 查询到注册的灵智体"
  - hook: register_forge_skills
    checks:
      - "插件类是否实现 register_forge_skills() 方法返回 List[ForgeSkill]"
      - "ForgeSkill 是否包含 skill_id/capability_profile/trigger_condition 三字段"
      - "锻造技能是否与灵智体形态匹配（如 BioForgekin 的技能应包含生物感知相关能力）"
      - "技能是否通过 ToolRegistry.execute() 调用（禁止直接 import，编程红线）"
  - hook: register_council_channels
    checks:
      - "插件类是否实现 register_council_channels() 方法返回 List[CouncilChannel]"
      - "CouncilChannel 是否包含 channel_id/participants/protocol 三字段"
      - "灵议通道是否仅允许 E4+ 觉醒阶灵智体参与"
      - "灵议决议是否需 operator 最终裁决（框架层不可由灵智体自我演进修改）"
  - hook: register_auto_forge_config
    checks:
      - "插件类是否实现 register_auto_forge_config() 方法返回 AutoForgeConfig"
      - "AutoForgeConfig 是否包含 spirit_forge.yaml 配置路径"
      - "灵锻（SpiritForge）配置是否标注触发条件（低活动期）"
      - "灵锻是否仅允许 E4+ 灵智体执行（Evoling 形态）"
prompt: |
  请验证 {项目名} 是否正确通过 Plugin V3 四钩子注册灵智体到 forgemind。
  验证步骤:
  1. 检查 plugins.py 中插件类是否实现 V3 四钩子（register_forgekins/register_forge_skills/register_council_channels/register_auto_forge_config）
  2. 检查 V2 钩子（register_agents/register_tools/register_loops/register_gates）是否保留并存
  3. 验证四钩子返回的数据结构是否符合 ForgekinSpec/ForgeSkill/CouncilChannel/AutoForgeConfig 契约
  4. 验证灵智体形态是否属于 5 种合法形态
  5. 验证灵议通道仅允许 E4+ 灵智体参与
  6. 验证灵锻配置使用 spirit_forge.yaml（非 auto_forge.yaml 旧名）
  7. 验证 forgemind 单向依赖核心框架层（禁止反向调用）
  8. 验证 forgemind 不含业务领域代码（编程红线第 10 条）
  对每个未通过项给出: 文件路径 → 行号 → 违规描述 → 修复方案。
constraints:
  - "禁止 Mock（T1/T4）：必须真实加载插件并调用四钩子"
  - "禁止假数据（T2）：ForgekinSpec 必须是真实灵智体定义"
  - "必须有具体断言（T3）：不得 status in ('completed','error')"
  - "LLM 生成内容必须经 LLM 审核（T7）：灵智体能力基线测试报告需 LLM 审核"
```

---

### FF23 三方 Agent 集成验证模板

> **用途**: 验证 ExternalAgentAdapter 集成是否正确
> **适用项目**: FlowForge（forgemind + core/external_agent）
> **验证项**: 能力画像 / 状态共享 / 失败回退 / 能力融合 / 六层 Guardrails / worktree 隔离

```yaml
# prompts.yaml — FF23 三方 Agent 集成验证模板
template_id: FF23
name: 三方 Agent 集成验证模板
version: v7.0
purpose: "验证 ExternalAgentAdapter 集成是否正确"
applies_to: [FlowForge]
verification_items:
  - item: 能力画像（ExternalAgentProfile）
    checks:
      - "4 个首批 Adapter（claude_code/codex/opencode/trae）是否各有 ExternalAgentProfile"
      - "能力画像是否包含六维（模型固有能力/认知风格/工具边界/历史表现/坏直觉/当前状态）"
      - "坏直觉维度是否如实填写盲点（如 Claude Code 长上下文易漂移、Codex 工具调用弱）"
      - "能力画像是否按可变性分层（常量层/变量层/累积层/瞬时层）"
  - item: 状态共享（ExternalAgentSharedState）
    checks:
      - "三方 Agent 执行状态是否写入灵智体共享状态"
      - "灵智体调用 claude code 修改代码后，codex 接手 review 时是否能看到 claude code 的修改历史和决策上下文"
      - "共享状态是否实现'灵智体 → claude code 写代码 → codex review → trae 部署'的连续协作流"
      - "共享状态是否作为现实状态（第三层）跨会话跨 agent 跨时间持续存在"
  - item: 失败回退（ExternalAgentFallback）
    checks:
      - "fallback 优先级是否正确（Claude Code=1/Codex=2/OpenCode=3/Trae=4）"
      - "Claude Code 超时是否自动回退到 Codex"
      - "Codex 限流是否自动回退到 OpenCode"
      - "全部失败是否回退到 FlowForge 内置能力"
      - "回退是否记录失败原因和回退路径到 Eval 信号"
  - item: 能力融合（ExternalAgentCapabilityFusion）
    checks:
      - "三方 Agent 调用后能力是否沉淀到灵智体能力画像"
      - "灵智体多次调用 claude code 写代码后是否'学到'代码编写能力（通过灵典蒸馏）"
      - "能力融合是否写入灵典（Mind Codex）可检索知识库"
      - "融合后的能力是否可被检索驱动的适配循环即时生效"
  - item: 六层 Guardrails
    checks:
      - "L1 输入验证: 三方 Agent 调用前是否通过 Schema 校验"
      - "L2 系统提示约束: 灵智体 system role 是否注入'禁止绕过审计'"
      - "L3 工具白名单: 三方 Agent 是否只能调用 allow-list 内工具"
      - "L4 输出验证: 三方 Agent 输出是否通过 lint + 测试"
      - "L5 操作确认: 不可逆操作（merge/release）是否需 operator 确认"
      - "L6 成本上限: 每个灵智体是否有三方 Agent 调用配额"
  - item: worktree 隔离
    checks:
      - "每次三方 Agent 调用是否创建独立 worktree"
      - "网络隔离: 是否实施网络白名单（仅允许访问必要域名）"
      - "权限控制: 是否仅 read + write_code + run_tests"
      - "审计追踪: 是否全部记录到 harness-feedback/external-agent-traces/"
      - "操作回滚: 错误操作是否可恢复"
prompt: |
  请验证 FlowForge 的三方 Agent 集成（ExternalAgentAdapter）是否正确。
  验证步骤:
  1. 检查 flowforge/core/external_agent/ 目录结构是否完整（adapter/bridge/profile/shared_state/fallback/capability_fusion + adapters/）
  2. 验证 4 个首批 Adapter（claude_code.py/codex.py/opencode.py/trae.py）是否实现
  3. 验证能力画像（ExternalAgentProfile）六维完整 + 盲点如实填写
  4. 验证状态共享（ExternalAgentSharedState）实现连续协作流
  5. 验证失败回退（ExternalAgentFallback）链按优先级回退
  6. 验证能力融合（ExternalAgentCapabilityFusion）沉淀到灵典
  7. 验证六层 Guardrails 全部生效
  8. 验证 worktree 隔离（网络/权限/审计/回滚）
  9. 验证调用语义统一（同步/异步/流式/委托）
  10. 验证全部失败回退到 FlowForge 内置能力
  对每个未通过项给出: 文件路径 → 行号 → 违规描述 → 修复方案。
constraints:
  - "禁止 Mock（T1/T4）：必须真实调用三方 Agent（claude code/codex/opencode/trae）"
  - "禁止假数据（T2）：能力画像必须基于真实任务历史"
  - "必须有具体断言（T3）：不得 status in ('completed','error')"
  - "LLM 生成内容必须经 LLM 审核（T7）：三方 Agent 输出需 LLM 审核"
  - "Web 功能必须操控浏览器验证 DOM（T8）: trae IDE 集成需浏览器验证"
  - "必须采集指标（T6）: MetricsCollector 采集调用次数/耗时/成功率/fallback 次数"
```
