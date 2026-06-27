# Landing Design 方案联合审核报告

> **审核日期**: 2026-06-15  
> **审核范围**: flowforge/devforge/contentforge/novelforge 四个项目的 landing_design.md  
> **审核依据**: hiclaw/prompts.md、各项目 landing_plan.md、flowforge/docs/task.md、devforge/docs/optimization_plan.md  
> **审核团队**: AI产品专家、高级架构师、Agent开发工程师、全栈工程师  
> **审核方法**: 文档走读 + 代码验证 + 架构对标 + 铁律检查

---

## 一、总体评价

### 1.1 方案亮点

**配置驱动化方向正确**：四个项目的 landing_design.md 统一采用 YAML 配置驱动 Agent、Workflow、Quality Gate，符合现代 Agent 框架的发展趋势。特别是：

- FlowForge 的 Workflow YAML Compiler 设计（FWK-01）可消除 5 个独立 Orchestrator
- DevForge 的 4 种任务类型 Workflow 模板（greenfield/feature/change/hotfix）覆盖完整
- ContentForge 的 SOP YAML Compiler 将 LangGraph StateGraph 编译为可执行图
- NovelForge 的 6 道质量门 YAML 配置实现声明式质量检查

**OpenCode 对标意识强**：devforge/docs/optimization_plan.md 系统性地对标了 OpenCode 的 30+ 个 Pattern，包括 Session 持久化、LLM 路由层、Compaction、System Context 代数等，体现了对业界先进架构的深入理解。

**质量门设计严谨**：NovelForge 的 6 道质量门（QG-1 到 QG-6）定义了清晰的检查条件、阈值、打回策略，特别是 QG-5 要求伏笔回收率≥0.8 和一致性评分≥0.85，体现了对小说创作质量的严格要求。

### 1.2 核心问题

**架构边界严重违反**：根据 flowforge/docs/task.md 第八轮审计（P8A），FlowForge 含有 23 处特定领域代码（~1100 行），ContentForge/NovelForge/DevForge 含有大量重复服务代码（总计 ~7871 行可删除）。这违反了"FlowForge 是纯通用框架，*Forge 是轻量业务扩展"的架构根基原则。

**配置驱动率极低**：当前 Agent 配置驱动率 0%（0/45），Tool 配置驱动率 0%（0/21），Workflow 配置驱动率仅 17%（1/6）。landing_design.md 中定义的 YAML 配置大多停留在设计阶段，代码实现仍是硬编码。

**OpenCode 对标差距大**：根据 task.md 第九轮审计，FlowForge 与 OpenCode 对标存在 30 项差距（P0: 8 项），包括无 Session 持久化、无 LLM 路由层分离、无 Compaction、无指数退避重试等核心能力。

**硬编码提示词泛滥**：三个项目共有 115 处硬编码提示词（FlowForge 77 处 + ContentForge 24 处 + NovelForge 14 处），prompts.yaml 定义了但代码未引用，违反铁律 5（禁止硬编码）。

---

## 二、FlowForge Landing Design 审核

### 2.1 Workflow YAML Compiler（FWK-01）

**设计评价**: ⭐⭐⭐⭐⭐（优秀）

Workflow YAML Compiler 是整个配置驱动化架构的核心，设计文档定义了完整的 Schema：

```python
class WorkflowDefinition(BaseModel):
    name: str
    version: str = "2.0"
    description: str = ""
    task_types: list[str]
    defaults: WorkflowDefaults
    stages: list[StageConfig]
```

支持条件边、并行分支、中断点、检查点等高级特性，可消除 ContentForge/NovelForge/DevForge 各自硬编码的 Orchestrator。

**实施问题**:

- **P0 致命**: 当前 3 个项目（CF/NF/DF）仍使用 Python 硬编码编排，Workflow YAML Compiler 未实现
- **P1 严重**: 缺少 Conditional Router（FWK-02）、Fallback Chain（FWK-03）、State Param Mapping（FWK-04）等配套能力
- **P1 严重**: 缺少 DeclarativeAgent state_updates 映射配置（FWK-09），导致 15 个纯 prompt+LLM+JSON 的 Agent 无法 YAML 化

**审核建议**:

1. **优先级调整**: FWK-01 应为"第负一优先级"（不实现则架构原则无法落地），而非 P0
2. **分阶段实施**: 
   - Phase 1（2 周）: 实现 Workflow YAML Compiler 核心 + Conditional Router
   - Phase 2（1 周）: 实现 Fallback Chain + State Param Mapping
   - Phase 3（1 周）: 实现 DeclarativeAgent state_updates
3. **迁移策略**: 先在 MallForge（架构最干净）试点 YAML 化，验证后推广到其他项目

### 2.2 OpenCode Pattern 对标

**设计评价**: ⭐⭐⭐⭐（良好，但实施差距大）

devforge/docs/optimization_plan.md 系统性地列出了 30+ 个 OpenCode Pattern 的适配设计，包括：

- **Session 持久化**（SES-01 到 SES-06）: 事件溯源、Prompt 投递与执行分离、RunCoordinator 并发控制
- **Context & Memory**（CTX-01 到 CTX-06）: 可重放状态、System Context 代数、Context Epoch、Compaction
- **Error Handling**（ERR-01 到 ERR-05）: 指数退避重试、瞬态错误检测、SSE 超时保护

**实施问题**:

- **P0 致命**: 30 项 Pattern 中多数未实现，特别是 Session 持久化（OC-FF-15）、LLM 路由层（OC-FF-16）、Compaction（OC-FF-18）、指数退避重试（OC-FF-24）
- **P1 严重**: 已实现的 Pattern 与设计文档不一致，如 Reflexion 模式 MAX_ITERATIONS 设计为 4，代码中可能不同（OC-FF-01）

**审核建议**:

1. **聚焦 P0 Pattern**: 优先实现 Session 持久化、LLM 路由层、Compaction、指数退避重试这 4 个 P0 Pattern
2. **对标验证**: 按 task.md 中 FF1-FF19 提示词逐条验证，确保设计落地
3. **文档同步**: 实现后更新 landing_design.md，标注哪些 Pattern 已实现、哪些未实现

### 2.3 安全体系

**设计评价**: ⭐⭐⭐（一般，多数未实现）

landing_design.md 中定义了 10 层安全防御体系（L1 工具超时防御 → L10 审计追踪），但根据 task.md（OC-FF-11），多数未实现或未集成：

- **未实现**: L2 重复检测钩子、L4 安全工具注册表、L6 架构约束引擎、L7 反馈循环闸门、L8 熵管理、L9 MCP 熔断、L10 审计追踪
- **已实现但弱**: L1 工具超时防御（120s 硬编码）、L3 自修正重试（reflexion_retry 未验证）
- **P0 安全隐患**: secret_key="changeme-in-production"（FF-P14A-01）、全局异常处理器返回完整 traceback（NF-P14A-15）

**审核建议**:

1. **安全优先**: 立即修复 secret_key 硬编码和 traceback 泄露问题
2. **分阶段实现**: 优先实现 L4 安全工具注册表（标记工具安全级别）和 L10 审计追踪（记录所有 Agent/Tool 调用）
3. **权限系统对标**: 按 OpenCode Permission V2 设计，实现 allow/deny/ask 三态 + Wildcard 匹配 + 运行时交互式授权（OC-FF-20）

---

## 三、DevForge Landing Design 审核

### 3.1 四种任务类型 Workflow 模板

**设计评价**: ⭐⭐⭐⭐⭐（优秀）

DevForge 的 4 种 Workflow YAML 模板设计完整，覆盖 IPD 全流程到 GitFlow 热修复：

| 模板 | 阶段数 | 门禁数 | 人工审批 | 适用场景 |
|------|:------:|:------:|:--------:|---------|
| greenfield | 6 | 9（6 DCP + 3 TR） | 是 | 全新项目 |
| feature | 5 | 3（2 DCP + 1 TR） | 否 | 功能迭代 |
| change | 4 | 2（CI 自动门禁） | 否 | 需求变更 |
| hotfix | 3 | 1（快速评审） | 是 | Bug 修复 |

**YAML Schema 设计严谨**：

```yaml
gate_config:
  name: "DCP-1 概念决策"
  type: "decision"
  dimensions:
    - name: "business_value"
      evaluator_agent: "dev_business_value_evaluator"
      weight: 0.40
      threshold: 0.6
  pass_threshold: 0.60
  veto_dimensions: ["security"]  # 一票否决维度
  voting_strategy: "weighted"
  human_required: true
  on_reject:
    action: "retry"
    max_retries: 1
    fallback: "terminate"
  timeout_seconds: 3600
  audit_log_required: true
```

支持多维度加权评分、一票否决、三种投票策略（weighted/consensus/majority）、超时策略、审计日志等高级特性。

**实施问题**:

- **P0 致命**: 4 种 Workflow YAML 模板未实现（OC-DF-01），当前仍使用 Python 硬编码编排
- **P0 致命**: 金丝雀发布完全未实现（OC-DF-02），10%→50%→100% 金丝雀 + 自动回滚缺失
- **P0 致命**: 代码执行沙箱完全未实现（OC-DF-03），进程隔离/资源限制/危险函数禁用全部缺失
- **P1 严重**: 门禁三种投票策略未实现（OC-DF-04）、门禁超时策略未实现（OC-DF-05）、门禁人工确认和升级未实现（OC-DF-06）

**审核建议**:

1. **优先实现 Workflow YAML Compiler**: DevForge 的 4 种模板依赖 FlowForge 的 FWK-01，应协同实施
2. **金丝雀发布分阶段**: 
   - Phase 1: 实现基础部署（无金丝雀）
   - Phase 2: 实现 10%→100% 两阶段金丝雀
   - Phase 3: 实现 10%→50%→100% 三阶段 + 自动回滚
3. **沙箱安全优先**: 代码执行沙箱是 P0 安全问题，应优先于功能实现

### 3.2 门禁系统

**设计评价**: ⭐⭐⭐⭐⭐（优秀）

门禁设计是 DevForge 的核心亮点，10 个门禁（DCP-1~4 + TR-1~6）覆盖 IPD 全流程：

| 门禁 | 类型 | 阶段 | 人工 | 说明 |
|------|------|------|:----:|------|
| DCP-1 | decision | 概念→计划 | 是 | 商业价值 + 可行性评估 |
| DCP-2 | decision | 计划→开发 | 是 | 详细设计评审 |
| DCP-3 | decision | 开发→测试 | 是 | 代码完成度评估 |
| DCP-4 | decision | 测试→发布 | 是 | 发布风险 + 安全 + 测试覆盖率 |
| TR-1 | technical | 设计产物 | 否 | 技术产物专项审查 |
| TR-2~6 | technical | 各阶段 | 否 | 架构/代码/测试/安全/文档审查 |

**实施问题**:

- **P1 严重**: 门禁三种投票策略（weighted/consensus/majority）未实现（OC-DF-04）
- **P1 严重**: 门禁超时策略（3 种计时起点）未实现（OC-DF-05）
- **P1 严重**: 门禁人工确认和升级到人工的流程未实现（OC-DF-06）
- **P1 严重**: 14 个业务 Agent 执行模式与设计不符（OC-DF-07），多数只是单次 LLM 调用

**审核建议**:

1. **门禁优先实现**: 先实现 DCP-1 和 TR-1 两个核心门禁，验证流程后推广
2. **Agent 模式对齐**: 14 个业务 Agent 应按设计文档使用正确的执行模式（如需求分析师用 Self-Discover、架构师用 Graph of Thoughts、编码用 Reflexion）
3. **审计日志**: 门禁审计日志是合规要求，应优先实现

### 3.3 架构边界问题

**P0 致命**: DevForge 含有大量不应存在的重复服务代码（ARCH-DF-01 到 ARCH-DF-07，~1877 行）：

- 独立编排逻辑（core/orchestrator.py, 477 行）→ 应使用 FlowForge Orchestrator
- 独立配置系统（core/config.py, ~100 行）→ 应继承 FlowForge SystemConfig
- 独立数据库层（memory/database.py + repository.py + audit_service.py, ~400 行）→ 应使用 FlowForge Memory
- 独立工作流执行器（core/workflow_executor.py, ~300 行）→ 应使用 FlowForge WorkflowExecutor
- 独立门控编排（core/gate_orchestrator.py + agent_guard.py, ~200 行）→ 应抽象为 FlowForge 通用机制
- 独立模型定义（core/models.py, ~100 行）→ 应使用 FlowForge TaskContext
- 独立 API 层（api/routes.py + schemas.py + websocket.py, ~300 行）→ 应通过 plugins.py 注册到 FlowForge

**审核建议**:

1. **先补齐 FlowForge 能力**: 在删除 DevForge 重复代码前，确保 FlowForge 的 WorkflowExecutor、GateOrchestrator、Memory 等能力已实现
2. **渐进式迁移**: 
   - Phase 1: 迁移 API 层到 plugins.py 注册
   - Phase 2: 迁移数据库层到 FlowForge Memory
   - Phase 3: 删除独立 Orchestrator，使用 FlowForge WorkflowExecutor
3. **保留门控特性**: DevForge 的门控编排是业务特有，可保留但应抽象为 FlowForge 通用机制

---

## 四、ContentForge Landing Design 审核

### 4.1 SOP YAML Compiler

**设计评价**: ⭐⭐⭐⭐⭐（优秀）

ContentForge 的 SOP YAML Compiler 将 LangGraph StateGraph 编译为可执行图，设计精巧：

```python
class SOPCompiler:
    def compile(self, sop_name: str, emit_stage=None, emit_step=None,
                initial_state: dict | None = None) -> StateGraph:
        config = self._load_sop_config(sop_name)
        state_class = self._resolve_state_class(config.get("state_schema", ""))
        graph = StateGraph(state_class)
        
        # 注册所有节点
        for node_name, node_config in config.get("nodes", {}).items():
            agent_name = node_config.get("agent", "")
            if agent_name in _SYSTEM_NODES:
                graph.add_node(node_name, self._make_system_node(node_name, agent_name))
            else:
                graph.add_node(node_name, self._make_agent_node(node_name, node_config, ...))
        
        # 注册普通边、条件边、终止边
        ...
        
        # 编译为可执行图
        compiled = graph.compile(
            checkpointer=checkpointer,
            interrupt_before=interrupt_before,
        )
        return compiled
```

支持 4 种 SOP 模板（深度长文/新闻快讯/微头条/系列文章），覆盖不同创作场景。

**实施问题**:

- **P0 致命**: 六大专家 Agent 完全缺失（OC-CF-01），选题/研究/创作/SEO/事实核查/发布 6 个专家 Agent 未实现
- **P0 致命**: 内容创作非多 Agent 协作（OC-CF-02），当前是 Pipeline 内联实现，非多 Agent Workflow 协作
- **P0 致命**: Playwright 多平台发布完全缺失（OC-CF-05），今日头条/微信公众号的自动化发布未实现
- **P0 致命**: Web 控制台 6 大页面缺失（OC-CF-08），审核中心/定时任务/专栏配置/模型配置/发布日志/设置页面全部缺失
- **P1 严重**: LangGraph SOP 检查点未验证（OC-CF-03）、选题搜索三级降级未完整实现（OC-CF-04）、模型治理健康检查未实现（OC-CF-06）、模型故障自动切换未实现（OC-CF-07）

**审核建议**:

1. **优先实现六大专家 Agent**: 这是 ContentForge 的核心竞争力，应按 design.md 逐个实现
2. **SOP Compiler 验证**: 用深度长文 SOP 端到端验证 Compiler 是否正常工作，特别是 interrupt_before=["review"] 和 Command(resume=...)
3. **Web 控制台分阶段**: 
   - Phase 1（1 周）: 实现审核中心 + 发布日志
   - Phase 2（1 周）: 实现定时任务管理 + 专栏配置
   - Phase 3（1 周）: 实现模型配置 + 设置页面

### 4.2 六大专家 Agent

**设计评价**: ⭐⭐⭐⭐⭐（优秀，但未实现）

设计文档定义了 6 大专家 Agent，每个 Agent 都有详细的执行模式和工具配置：

| Agent | 执行模式 | 工具 | 核心能力 |
|-------|---------|------|---------|
| 选题 Agent | reflexion | helixrag_search, web_search, llm | 四级选题策略（缓存复用→自定义触发→HelixRAG 深度检索→Tavily+热榜聚合） |
| 研究 Agent | rewoo | helixrag_search, web_search, material_download | 并行多源检索，素材抓取清洗 |
| 创作 Agent | reflexion | llm, persona_inject | SOUL/MEMORY 风格注入，爆款结构复用，去 AI 味 |
| SEO Agent | plan_execute | llm, seo_analyzer | 标题优化三维度方法论，关键词植入 |
| 事实核查 Agent | react | link_checker, data_validator | 链接有效性检查，数据交叉验证 |
| 发布 Agent | rewoo | playwright, content_adapter | 多平台发布，内容适配，时间错峰 |

**实施问题**:

- **P0 致命**: 6 个 Agent 全部未实现（OC-CF-01）
- **P1 严重**: AgenticRAG.search() 核心多源检索逻辑仍为占位 pass（BUG-CF-04）
- **P1 严重**: PublishAgent 未集成 PublishEngine，仍缺少 llm_client 参数（BUG-CF-05）

**审核建议**:

1. **Agent 实现优先级**: 选题 Agent → 研究 Agent → 创作 Agent → 发布 Agent → SEO Agent → 事实核查 Agent
2. **真实数据验证**: 每个 Agent 必须用真实数据和真实 LLM 调用验证，禁止 Mock（铁律 1+2）
3. **执行模式对齐**: 确保 Agent 使用设计文档指定的执行模式（如选题 Agent 用 reflexion、研究 Agent 用 rewoo）

### 4.3 架构边界问题

**P0 致命**: ContentForge 含有大量不应存在的重复服务代码（ARCH-CF-01 到 ARCH-CF-12，~2867 行）：

- 独立编排逻辑（brain/orchestrator.py, 677 行）→ 应使用 FlowForge Orchestrator + Workflow
- 独立 DI 容器组装（core/di_setup.py, 220 行）→ 应通过 SDK 自动发现注册
- 独立数据库层（memory/stores/sqlite_store.py + memory/repositories/, ~400 行）→ 应使用 FlowForge Memory
- 独立任务存储（core/task_store.py, ~150 行）→ 应使用 FlowForge Memory
- 独立 LLM 服务（tools/llm/model_service.py + router.py + helm_adapter.py, ~500 行）→ 应使用 FlowForge LLMClient
- 独立 SOP 编排（brain/sop/deep_article.py + news_summary.py + review_controller.py, ~500 行）→ 应使用 FlowForge Workflow YAML
- 独立调度器（brain/scheduler.py, ~100 行）→ 应使用 FlowForge Scheduler
- 独立 Bridge 封装（core/flowforge_bridge.py, ~80 行）→ 应直接用 GenericAgent
- 独立 SDK 封装（sdk/client.py, ~60 行）→ 应直接用 FlowForgeSDK
- 独立指标系统（core/metrics.py, ~30 行）→ 应直接用 flowforge.metrics
- 独立回调系统（core/callback.py, ~50 行）→ 应抽象为 FlowForge 通用通知机制
- 独立配置系统（core/config.py, ~100 行）→ 应简化，仅保留 ContentForge 特有字段

**审核建议**:

1. **先补齐 FlowForge 能力**: 在删除 ContentForge 重复代码前，确保 FlowForge 的 WorkflowExecutor、Memory、LLMClient 等能力已实现
2. **渐进式迁移**: 
   - Phase 1: 删除独立 LLM 服务，改用 FlowForge LLMClient
   - Phase 2: 删除独立 SOP 编排，改用 FlowForge Workflow YAML
   - Phase 3: 删除独立 Orchestrator，使用 FlowForge WorkflowExecutor
   - Phase 4: 删除独立数据库层，使用 FlowForge Memory
3. **保留业务特有**: ContentForge 的 6 大专家 Agent 和 SOP 模板是业务特有，应保留

---

## 五、NovelForge Landing Design 审核

### 5.1 质量门 YAML 配置

**设计评价**: ⭐⭐⭐⭐⭐（优秀）

NovelForge 的 6 道质量门 YAML 配置设计严谨，覆盖小说创作全流程：

```yaml
- id: "QG-5"
  name: "full_review_passed"
  display_name: "全集通读 → 完稿审核"
  description: "伏笔回收率≥0.8且一致性评分≥0.85"
  next_phase: "final_review"
  next_status: "reviewing"
  threshold: 0.8
  checks:
    - field: "foreshadowing_recovery_rate"
      condition: ">= 0.8"
      error_message: "伏笔回收率未达到0.8"
    - field: "consistency_score"
      condition: ">= 0.85"
      error_message: "全局一致性评分未达到0.85"
```

**QualityGateChecker 实现完整**：

```python
class QualityGateChecker:
    def check(self, gate_name: str, state: dict) -> dict:
        gate = self._gates.get(gate_name)
        if not gate:
            return {"passed": False, "reason": f"Unknown gate: {gate_name}"}
        failures = []
        for check in gate["checks"]:
            value = self._resolve_field(state, check["field"])
            allow_missing = check.get("allow_missing", False)
            ok = self._evaluate(value, check["condition"], allow_missing)
            if not ok:
                failures.append({
                    "field": check["field"],
                    "message": check.get("error_message", f"Check failed: {check['field']}"),
                })
        if failures:
            return {"passed": False, "gate": gate_name, "failures": failures, ...}
        return {"passed": True, "gate": gate_name, "next_status": gate.get("next_status"), ...}
```

支持字段路径解析（如 `outline.volumes.length`）、条件评估（`>= 0.8`、`== true`、`not_empty`）、缺失值处理（`allow_missing`）。

**实施问题**:

- **P1 严重**: 六道质量门检查条件与设计文档不一致（BUG-NF-07），如 QG-2 缺少评分检查和逻辑矛盾检查、QG-3 缺少 style_confirmed 布尔检查
- **P2 一般**: 质量门检查器已实现，但部分检查条件过于简单（如 verify_power_system 只检查 "!!" 前缀）

**审核建议**:

1. **对齐设计文档**: 按 design.md 更新质量门检查条件，确保 QG-1 到 QG-6 的检查逻辑与设计一致
2. **增强语义检查**: 一致性检测 Tool 应增加 LLM 增强的语义验证，而非仅字符串匹配
3. **质量门可视化**: 在 Web 控制台展示质量门检查结果，便于用户理解为何被打回

### 5.2 创作 Workflow YAML

**设计评价**: ⭐⭐⭐⭐⭐（优秀）

NovelForge 的八阶段创作 Workflow YAML 设计完整，覆盖概念→大纲→风格→写作→自审→润色→通读→审核全流程：

```yaml
steps:
  # Phase 1: 概念孵化
  - id: "concept"
    name: "概念孵化"
    agent: "novel_concept"
    mode: "got"
    params:
      genre: "${params.genre}"
      inspiration: "${params.inspiration}"
    output: "concept_package"
    quality_gate:
      gate_name: "concept_approved"
      on_fail:
        action: "retry"
        max_retries: 2
    human_review: true
  
  # Phase 4: 分章写作循环
  - id: "writing_loop"
    name: "分章写作"
    type: "loop"
    loop_config:
      iterate_over: "state.outline.volumes[*].chapters[*]"
      iteration_var: "chapter_info"
      max_iterations: 100
      checkpoint_every: 5
    steps:
      - id: "write_chapter"
        name: "撰写章节"
        agent: "chapter_writing"
        mode: "reflexion"
        context_injection:
          build_context: true
          layers: ["L1", "L2", "L3", "L4", "WST"]
      ...
```

支持循环写作（分章写作循环）、上下文注入（五层上下文管理）、质量门检查、人工审核等高级特性。

**实施问题**:

- **P0 致命**: 八大创作阶段 Agent 执行模式与设计文档严重不符（BUG-NF-01），7 个 Agent 声明了模式但实际只是单次 LLM 调用
- **P0 致命**: 五层上下文管理写入路径严重缺失（BUG-NF-04），L1 全文层无向量索引写入、L2 章摘要层降级为截断前 200 字、L3 卷摘要层逻辑缺失、L4 全书摘要层未持久化、L5 世界状态表写入路径缺失
- **P0 致命**: SOUL 风格参数缺少 3 个反馈维度（BUG-NF-05），author_feedback/author_tags/paragraph_annotations 缺失
- **P1 严重**: 一致性检测 5 个 Tool 依赖不完整的 world_state（BUG-NF-06）、盲评不严格 + 仲裁结果未覆盖 + 打回重写闭环缺失（BUG-NF-08）、冻结/续写/版本管理/回溯修改严重缺失（BUG-NF-09）

**审核建议**:

1. **Agent 模式对齐**: 8 个 Agent 应按设计文档使用正确的执行模式，特别是：
   - NovelConceptAgent: Graph of Thoughts（多分支发散→交叉对比→合并收敛）
   - OutlineAgent: Plan-and-Execute（规划→执行→验证）
   - StyleCalibrateAgent: Reflexion（Actor→Evaluator→Reflector 循环）
   - ChapterWritingAgent: Reflexion + SOUL 风格注入
   - ContinuityCheckAgent: ReAct（Thought→Action→Observation 循环）
2. **五层上下文管理补全**: 
   - L1: 实现向量索引写入
   - L2: 用 LLM 生成 200 字摘要，而非截断
   - L3: 实现卷摘要逻辑（每 10 章生成 500 字摘要）
   - L4: 持久化全书摘要到数据库
   - L5: 实现世界状态表自动维护（人物/时间线/伏笔/战力/地理）
3. **SOUL 反馈维度**: 增加 author_feedback/author_tags/paragraph_annotations 字段，并注入后续章节的 system prompt

### 5.3 架构边界问题

**P0 致命**: NovelForge 含有大量不应存在的重复服务代码（ARCH-NF-01 到 ARCH-NF-05，~2027 行）：

- 独立编排逻辑（core/orchestrator.py, 467 行）→ 应使用 FlowForge Orchestrator
- 独立核心模块（core/下 9 个模块, ~800 行）→ 应删除重复模块，保留 context_manager/quality_gate 等 NovelForge 特有
- 独立数据库层（app/database.py + models.py + repositories/, ~500 行）→ 应使用 FlowForge Memory
- 独立 Deps 组装（app/deps.py, ~200 行）→ 应通过 SDK 自动注册
- Agent 基类封装（agents/base.py BaseNovelAgent, ~60 行）→ 应直接用 GenericAgent

**审核建议**:

1. **先补齐 FlowForge 能力**: 在删除 NovelForge 重复代码前，确保 FlowForge 的 Orchestrator、Memory 等能力已实现
2. **保留业务特有**: NovelForge 的 context_manager/quality_gate/style_profile/review_orchestrator 是业务特有（~500 行），应保留
3. **删除冗余中间层**: 删除 BaseNovelAgent，直接使用 GenericAgent

---

## 六、跨项目共性问题

### 6.1 硬编码提示词（115 处）

**问题描述**: 三个项目共有 115 处硬编码提示词（FlowForge 77 处 + ContentForge 24 处 + NovelForge 14 处），prompts.yaml 定义了但代码未引用。

**典型案例**:

- FlowForge: `_DEFAULT_PROMPTS` 字典（39 个）与 prompts.yaml（38 个）双重定义，内容有差异
- ContentForge: prompts.yaml 定义了 21 个模板但 0 个被实际使用
- NovelForge: prompts.yaml 定义了 6 个 `agent.*` 提示词但代码完全忽略

**违反铁律**: 铁律 5（禁止硬编码）

**审核建议**:

1. **统一删除 _DEFAULT_PROMPTS**: PromptManager 只从 YAML 加载
2. **代码通过 get_prompt() 加载**: 所有硬编码提示词外置到 prompts.yaml
3. **合并重复定义**: 同一搜索提示词在 3 个文件中重复硬编码，应合并为 1 个 YAML key

### 6.2 架构边界违反（~7871 行可删除）

**问题描述**: FlowForge 含有 23 处特定领域代码（~1100 行），ContentForge/NovelForge/DevForge 含有大量重复服务代码（总计 ~7871 行可删除）。

**违反原则**: "FlowForge 是纯通用框架，*Forge 是轻量业务扩展"

**审核建议**:

1. **先补齐 FlowForge 框架能力**: 特别是 FWK-01 到 FWK-09
2. **FlowForge 移出特定领域代码**: 23 处代码移到对应的 *Forge 项目
3. **\*Forge 删除重复服务代码**: 改用 FlowForge SDK 复用

### 6.3 OpenCode 对标差距（54 项）

**问题描述**: FlowForge 与 OpenCode 对标存在 30 项差距（P0: 8 项），DevForge 10 项（P0: 3 项），ContentForge 8 项（P0: 4 项），NovelForge 6 项（P0: 2 项），合计 54 项。

**核心差距**:

- **Session 持久化**: 无事件溯源、无 Prompt 投递与执行分离、无 RunCoordinator 并发控制
- **LLM 路由层**: 无 Protocol/Route/Provider 三层分离，新增 Provider 需修改核心代码
- **Compaction**: 无增量摘要、无 Overflow 恢复、无结构化摘要模板
- **指数退避重试**: LLM 调用失败无自动重试和瞬态错误识别

**审核建议**:

1. **聚焦 P0 Pattern**: 优先实现 Session 持久化、LLM 路由层、Compaction、指数退避重试
2. **对标验证**: 按 task.md 中 FF1-FF19 提示词逐条验证
3. **文档同步**: 实现后更新 landing_design.md，标注哪些 Pattern 已实现、哪些未实现

---

## 七、修复优先级建议

### 第负一优先级（FlowForge 框架能力 — 不补齐则架构原则无法落地）

1. **FWK-01**: Workflow YAML Compiler（影响全部 4 个项目，消除 5 个独立 Orchestrator）
2. **FWK-02**: Conditional Router（影响 CF/NF/MF，消除 if-else 策略路由）
3. **FWK-03**: Fallback Chain（影响 CF/NF/MF，消除 4 处硬编码回退逻辑）
4. **FWK-04**: State Param Mapping（影响 CF/NF，消除参数注入硬编码）
5. **FWK-05**: Persona Auto-Inject（影响 CF，消除 persona 加载硬编码）
6. **FWK-09**: DeclarativeAgent state_updates（影响 NF，15 个 Agent 可 YAML 化）

### 第零优先级（架构根基 — 框架能力补齐后立即执行）

7. **ARCH-FF**: FlowForge 移出 23 处特定领域代码到对应 *Forge（~1100 行）
8. **ARCH-CF**: ContentForge 删除 12 处重复服务代码（~2867 行），改用 FlowForge SDK
9. **ARCH-NF**: NovelForge 删除 5 处重复服务代码（~2027 行），改用 FlowForge SDK
10. **ARCH-DF**: DevForge 删除 7 处重复服务代码（~1877 行），改用 FlowForge SDK
11. 删除 ContentForge Agent/BaseNovelAgent/DevForgeAgent 冗余中间层
12. 约 15 个纯 prompt+LLM+JSON 的 Agent 迁移到 DeclarativeAgent YAML 配置

### 第一优先级（P0，共 52 项）

**硬编码提示词（3 项，影响 115 处代码）**:
1. BUG-PROMPT-01: FlowForge 77 处硬编码提示词
2. BUG-PROMPT-02: ContentForge 24 处硬编码提示词
3. BUG-PROMPT-03: NovelForge 14 处硬编码提示词

**空实现/Stub（4 项）**:
4. BUG-CONFIG-02: 4 个核心工具为空实现/Stub
5. FF-P14A-02: PublishTool 返回 stub
6. FF-P14A-03: VideoGenerateTool 返回 stub
7. FF-P14A-04: MCP Integration 全部 stub

**安全漏洞（2 项）**:
8. FF-P14A-01: secret_key="changeme-in-production"
9. NF-P14A-15: 全局异常处理器返回完整 traceback

**架构致命问题（8 项）**:
10. CF-P14A-01: DI 容器 TaskRepo()/AuditRepo() 无参实例化必崩
11. FF-P14A-05: 10+ 存储模块全部直接 SQL
12. FF-P14A-07: 数据库路径全部硬编码
13. NF-P14A-03: deps.py 直接实例化绕过 DI
14. NF-P14A-04: Agent 注册逻辑重复执行两次
15. NF-P14A-14: novel_store.py 10 处同步 I/O 阻塞
16. NF-P14A-16: 搜索基类抛 NotImplementedError
17. BUG-NF-01: 八大创作阶段 Agent 执行模式与设计文档严重不符

**功能缺失（19 项）**:
18-36. 见 task.md 中 P0 级问题清单

### 第二优先级（P1，共 107 项）

见 task.md 中 P1 级问题清单

### 第三优先级（P2，共 121 项）

见 task.md 中 P2 级问题清单

---

## 八、实施路线图建议

### Phase 1（第 1-2 周）: FlowForge 框架能力补齐

**目标**: 实现 FWK-01 到 FWK-09，为架构迁移奠定基础

**关键交付**:
- Workflow YAML Compiler 核心（FWK-01）
- Conditional Router（FWK-02）
- Fallback Chain（FWK-03）
- State Param Mapping（FWK-04）
- DeclarativeAgent state_updates（FWK-09）

**验收标准**:
- MallForge 的 1 个 Workflow 可通过 YAML 定义并执行
- 15 个纯 prompt+LLM+JSON 的 Agent 可迁移到 DeclarativeAgent YAML 配置

### Phase 2（第 3-4 周）: 架构边界清理

**目标**: FlowForge 移出特定领域代码，*Forge 删除重复服务代码

**关键交付**:
- FlowForge 移出 23 处特定领域代码到对应 *Forge
- ContentForge 删除 12 处重复服务代码（~2867 行）
- NovelForge 删除 5 处重复服务代码（~2027 行）
- DevForge 删除 7 处重复服务代码（~1877 行）

**验收标准**:
- FlowForge 不含任何特定领域代码
- *Forge 通过 FlowForge SDK 复用基础能力，无独立 Orchestrator/Database/LLM 服务

### Phase 3（第 5-6 周）: P0 问题修复

**目标**: 修复 52 项 P0 问题，特别是硬编码提示词和安全漏洞

**关键交付**:
- 115 处硬编码提示词外置到 prompts.yaml
- 4 个核心工具空实现修复
- 2 个安全漏洞修复（secret_key、traceback 泄露）
- 8 个架构致命问题修复

**验收标准**:
- 所有提示词通过 get_prompt() 加载
- 无 stub 实现的核心工具
- 无 P0 安全隐患

### Phase 4（第 7-8 周）: OpenCode Pattern 对标

**目标**: 实现 17 项 P0 OpenCode Pattern，缩小与业界先进框架的差距

**关键交付**:
- Session 持久化（事件溯源、Prompt 投递与执行分离）
- LLM 路由层（Protocol/Route/Provider 三层分离）
- Compaction（增量摘要、Overflow 恢复）
- 指数退避重试 + 瞬态错误检测

**验收标准**:
- 进程崩溃后可恢复会话
- 新增 Provider 只需 2 行配置
- 上下文窗口溢出时自动压缩
- LLM 调用失败自动重试

### Phase 5（第 9-10 周）: P1 问题修复 + 功能完善

**目标**: 修复 107 项 P1 问题，完善各项目核心功能

**关键交付**:
- DevForge: 4 种 Workflow YAML 模板实现、金丝雀发布、代码执行沙箱
- ContentForge: 六大专家 Agent 实现、Playwright 多平台发布、Web 控制台 6 大页面
- NovelForge: 五层上下文管理补全、SOUL 反馈维度、一致性检测增强

**验收标准**:
- 各项目核心功能按 design.md 实现
- 端到端测试通过（真实数据、真实 LLM 调用）

---

## 九、总结

### 9.1 方案整体评价

**设计优秀，实施差距大**: 四个项目的 landing_design.md 在配置驱动化、OpenCode 对标、质量门设计等方面体现了高水平的架构设计能力，但代码实施与设计文档存在严重脱节。

**架构根基违反**: FlowForge 含有特定领域代码，*Forge 含有大量重复服务代码，违反了"FlowForge 是纯通用框架，*Forge 是轻量业务扩展"的架构根基原则。

**配置驱动率极低**: Agent 配置驱动率 0%，Tool 配置驱动率 0%，Workflow 配置驱动率仅 17%，landing_design.md 中定义的 YAML 配置大多停留在设计阶段。

**OpenCode 对标差距大**: 与 OpenCode 等先进 Agent 框架相比，在 Session 持久化、LLM 路由层、Compaction、指数退避重试等核心能力上存在显著差距。

### 9.2 核心建议

1. **先补齐 FlowForge 框架能力**: FWK-01 到 FWK-09 是所有架构问题的根因，不补齐这些能力，*Forge 就无法通过配置驱动，只能继续代码继承
2. **架构边界清理**: FlowForge 移出特定领域代码，*Forge 删除重复服务代码，总计可删除 ~7871 行重复代码
3. **聚焦 P0 问题**: 优先修复 52 项 P0 问题，特别是硬编码提示词（115 处）、安全漏洞（2 项）、架构致命问题（8 项）
4. **OpenCode Pattern 对标**: 实现 17 项 P0 Pattern，缩小与业界先进框架的差距
5. **分阶段实施**: 按 5 个 Phase 逐步推进，每个 Phase 可验证、可回滚

### 9.3 风险提示

1. **架构迁移风险**: 删除 ~7871 行重复代码可能引入回归 Bug，应渐进式迁移，每步可验证
2. **OpenCode Pattern 实施风险**: Session 持久化、LLM 路由层等核心能力实施复杂度高，可能需要外部专家支持
3. **时间风险**: 10 周实施路线图较紧凑，可能需要根据实际进度调整

---

**审核结论**: 方案方向正确，设计优秀，但实施差距大。建议按上述优先级和路线图逐步推进，先补齐 FlowForge 框架能力，再清理架构边界，最后修复 P0/P1 问题。

**审核团队签字**:  
- AI 产品专家: _______________  
- 高级架构师: _______________  
- Agent 开发工程师: _______________  
- 全栈工程师: _______________  

**日期**: 2026-06-15
