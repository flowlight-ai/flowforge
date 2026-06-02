# FlowForge 开发者功能规格说明书（Dev-Spec v1.0）

> **定位**: 基于实际代码现状的务实功能需求，标注实现复杂度，替代Phase9的愿望清单
> **原则**: 只列可实现的需求，技术债视为 P0 需求
> **日期**: 2026-05-26

---

## 一、P0 技术债修复需求（阻塞级，生产上线前必须完成）

### FR-DEBT-01: WorkflowExecutor 模式路由修复

**当前问题**: 当 Workflow 步骤声明 `agent` 时，`step_mode` 被完全忽略，Reflexion/Agent-Judge/ReWOO/Self-Discover/GoT/Multi-Agent 全部不生效。

**需求描述**: 当步骤同时声明 `agent` 和 `mode` 时，使用 `mode` 指定的执行器包装 Agent 调用，而非直接调用 `agent.execute_with_context()`。

**实现方案**:
```python
if agent_name and ctx.agents:
    agent = ctx.agents.get(agent_name)
    if agent and force_mode:
        # 使用 mode executor 包装 agent 调用
        sub_ctx = TaskContext.from_parent(ctx, input_data={...}, metadata={"_agent": agent_name})
        result = await ctx.executor.run(sub_ctx, mode_hint=step_mode, _is_substep=True)
    elif agent:
        # 直接调用（旧行为，仅 force_mode=False 时）
        ...
```

**复杂度**: 🔴 高（需修改核心执行路径，影响所有 Workflow YAML 的行为）
**预估工时**: 4-6h
**验证标准**: `deep_article.yaml` 的 content_audit 步骤在 `mode: agent_judge` 时调用两次 LLM（Actor+Judge），而非一次

### FR-DEBT-02: conftest.py Mock LLM 污染隔离

**当前问题**: `tests/conftest.py` 的 `mock_llm_tool` fixture 在所有测试中自动生效，E2E 测试无法使用真实 LLM。

**需求描述**:
1. 将 `mock_llm_tool` fixture 移至 `tests/unit/conftest.py`
2. `tests/conftest.py` 中基于 `FLOWFORGE_REAL_LLM` 环境变量决定返回 Mock 或 Real LLMClient
3. E2E 测试自动使用真实 LLM（通过 `conftest_e2e.py`）

**复杂度**: 🟡 中
**预估工时**: 2h
**验证标准**: `pytest tests/e2e/ -v` （无 FLOWFORGE_REAL_LLM）报错提醒设置环境变量

### FR-DEBT-03: _execute_parallel 共享对象隔离

**当前问题**: 并行任务的 `TaskContext.from_parent` 共享 EventBus/Tools/Agents 引用，高并发下存在竞态。

**需求描述**: 为并行任务创建独立的 EventBus 代理，或对 EventBus.emit 加 asyncio.Lock。

**复杂度**: 🟡 中
**预估工时**: 2h
**验证标准**: `report_generation.yaml` 并行步骤的 EventBus 事件按步骤正确隔离

### FR-DEBT-04: ContentAuditAgent judge_model 配置注入

**当前问题**: AgentRegistry 注册 ContentAuditAgent 时未传入 judge_model，导致执行和评审共用同一模型。

**需求描述**: 从 `config/models.yaml` 读取 `judge_model` 配置，在 AgentRegistry 注册时传入。

**复杂度**: 🟢 低
**预估工时**: 1h
**验证标准**: ContentAuditAgent 的两次 LLM 调用使用不同模型名称

### FR-DEBT-05: EventBus 通配符模式匹配

**当前问题**: EventBus 仅支持 `"exact_type"` 和 `"*"` 两种订阅方式。

**需求描述**: 支持 glob 风格通配符 `workflow.*`（匹配所有 workflow.xxx 事件）、`*.start`（匹配所有 start 事件）。

**实现方案**:
```python
def _match_pattern(self, subscriber_pattern: str, event_type: str) -> bool:
    import fnmatch
    return fnmatch.fnmatch(event_type, subscriber_pattern)
```

**复杂度**: 🟢 低
**预估工时**: 1-2h
**验证标准**: 订阅 `"workflow.*"` 能收到 `"workflow.step.start"` 和 `"workflow.step.complete"` 事件

---

## 二、P0 核心功能需求（MVP 必需）

### FR-CORE-01: 内容生产全链路（A3）

**基于现有代码**: `DeepArticleWorkflow`、`QuickPostWorkflow`、`TrendArticleWorkflow` 等 8 个 Workflow YAML
**需补充**:
- [ ] FR-DEBT-01 修复后验证所有 Workflow 的模式路由
- [ ] `deep_article.yaml` 的 fact_check 步骤确保 `FactCheckAgent` 可用
- [ ] `SEOContentWorkflow` 确保 SEO API 可用
- [ ] 所有 Workflow 的人工审核暂停/恢复功能验证

**复杂度**: 🟡 中（依赖 FR-DEBT-01）
**预估工时**: 8h
**可交付**: 8个可运行的 Workflow

### FR-CORE-02: 智能客服（C1）— 从零开发

**需要的组件**:
1. `customer-support` Skill（YAML 定义 + Python 实现）
2. 消息渠道适配器（微信/企微/网页嵌入）
3. 知识库检索集成（OpenSieve RAG）
4. 人机协作触发机制（置信度阈值 + 情绪检测）

**YAML Skill 定义**:
```yaml
name: customer-support
description: "7x24小时AI客服，自动匹配知识库回复"
triggers: ["客服", "帮助", "问题", "退货", "退款"]
required_tools: [llm_client, helixrag_search, message_channel]
params:
  auto_reply_threshold: 0.8
  escalation_keywords: ["投诉", "退款", "差评", "人工"]
```

**复杂度**: 🔴 高（涉及多渠道接入、知识库检索质量、人机协作状态机）
**预估工时**: 24-32h
**可交付**: 1个可用 Skill + 1个多渠道消息适配器

### FR-CORE-03: 灵感记录与知识管理（A1）— 从零开发

**需要的组件**:
1. `idea-catcher` Skill
2. `speech_to_text` 工具（集成 Whisper API 或本地模型）
3. 灵感评分与去重逻辑
4. 长期记忆存储（已有 `memory/long_term.py` 基础）

**复杂度**: 🟡 中
**预估工时**: 12-16h
**可交付**: 1个 Skill + 语音输入支持

---

## 三、P1 扩展功能需求（商业化必需）

### FR-EXT-01: 热点追踪（A2）

**基于现有**: `TrendAnalysisAgent` + `TopicResearchAgent`
**需补充**: 定时调度集成（已有 `scheduler/scheduler.py`）、YAML Workflow 化
**复杂度**: 🟡 中 | **预估**: 8h

### FR-EXT-02: 多平台分发（A4）

**基于现有**: `PublishingAgent` + `WeChatPublisherTool`
**需补充**: 小红书 MCP 集成、知乎 API、B站 API、Twitter API
**复杂度**: 🔴 高（大量第三方API集成） | **预估**: 20-30h

### FR-EXT-03: SEO优化（A6）

**基于现有**: `SEOOptimizationAgent`
**需补充**: 搜索排名API、自动内容更新、搜索引擎索引提交
**复杂度**: 🟡 中 | **预估**: 12h

### FR-EXT-04: 智能记账（E1）

**完全从零**: OCR集成、会计科目Prompt、银行API、财务报表模板
**复杂度**: 🔴 高 | **预估**: 20-24h

### FR-EXT-05: 收入归集（G5）

**完全从零**: 微信支付/支付宝/Stripe API、对账逻辑、日报生成
**复杂度**: 🟡 中 | **预估**: 12-16h

### FR-EXT-06: 邮件营销（B5）

**基于现有**: `SendgridMail` Tool
**需补充**: 客户画像Agent、邮件模板、发送调度
**复杂度**: 🟢 低 | **预估**: 8h

---

## 四、P2 平台功能需求（长期）

### FR-PLAT-01: Solo UI WebSocket E2E 测试套件

**目标**: 覆盖所有意图类型的 Solo UI 路径
**复杂度**: 🔴 高 | **预估**: 16-24h

### FR-PLAT-02: 真实 LLM CI 流水线

**目标**: 每次提交自动运行真实 LLM E2E 测试
**复杂度**: 🟡 中 | **预估**: 8h

### FR-PLAT-03: 多租户数据隔离

**目标**: 不同用户/公司之间的 Skill、Workflow、数据完全隔离
**复杂度**: 🔴 高 | **预估**: 16-24h

### FR-PLAT-04: 模板市场

**目标**: 用户可发布/安装 Workflow 模板
**复杂度**: 🔴 高 | **预估**: 40-60h

---

## 五、不得开发的"愿望需求"（明确标记为不实现）

以下来自 Phase9 的需求在当前阶段**不应开发**（要么不现实、要么ROI极低）:

| 需求 | 理由 |
|------|------|
| DevForge 子系统 | 需要至少1个月独立开发，且代码生成质量控制是行业难题 |
| VideoForge 子系统 | 依赖多个第三方AI视频API，成本极高且质量不稳定 |
| LeadsForge/CRMForge | 本质上是独立SaaS产品，不应由1人开发 |
| 广告投放自动化 | 需要巨量/腾讯/百度多个平台API，ROI不匹配 |
| AB测试引擎 | 统计显著性计算复杂，需要大量流量才能验证 |
| KOL智能筛选 | 依赖社交媒体爬虫，反爬和法律风险高 |

---

## 六、分阶段实施计划（基于现实速度）

### Phase 0: 技术债清理（第1-2周）

| 需求 | 工时 | 依赖 |
|------|------|------|
| FR-DEBT-01: 模式路由修复 | 6h | 无 |
| FR-DEBT-02: Mock LLM隔离 | 2h | 无 |
| FR-DEBT-03: 并行隔离 | 2h | 无 |
| FR-DEBT-04: judge_model | 1h | 无 |
| FR-DEBT-05: EventBus通配符 | 2h | 无 |
| **小计** | **13h** | |

### Phase 1: MVP 核心场景（第3-6周）

| 需求 | 工时 | 依赖 |
|------|------|------|
| FR-CORE-01: 内容生产全链路验证 | 8h | FR-DEBT-01 |
| FR-CORE-02: 智能客服 Skill | 28h | 消息渠道插件 |
| FR-CORE-03: 灵感记录 Skill | 14h | OpenSieve RAG |
| FR-EXT-01: 热点追踪 Workflow | 8h | FR-DEBT-01 |
| **小计** | **58h** | |

### Phase 2: 商业化扩展（第7-12周）

| 需求 | 工时 | 依赖 |
|------|------|------|
| FR-EXT-02: 多平台分发 | 24h | FR-CORE-01 |
| FR-EXT-03: SEO优化 | 12h | FR-CORE-01 |
| FR-EXT-04: 智能记账 | 22h | OCR API |
| FR-EXT-05: 收入归集 | 14h | 支付API |
| FR-EXT-06: 邮件营销 | 8h | 无 |
| **小计** | **80h** | |

### Phase 3: 平台化（第13-24周）

| 需求 | 工时 | 依赖 |
|------|------|------|
| FR-PLAT-01: Solo UI E2E | 20h | FR-DEBT-02 |
| FR-PLAT-02: 真实LLM CI | 8h | FR-DEBT-02 |
| FR-PLAT-03: 多租户隔离 | 20h | 数据库设计 |
| FR-PLAT-04: 模板市场 | 50h | FR-PLAT-03 |
| **小计** | **98h** | |

### 总计

| Phase | 工时 | 自然周 |
|-------|------|--------|
| Phase 0: 技术债 | 13h | 1-2周 |
| Phase 1: MVP | 58h | 3-6周 |
| Phase 2: 扩展 | 80h | 7-12周 |
| Phase 3: 平台化 | 98h | 13-24周 |
| **总计** | **249h** | **24周** |

> 按每天有效开发6小时计算，总计约 42 个工作日 = 8.4 周纯开发时间。加上测试、调试、文档，**实际需要 20-24 自然周**。

---

## 七、需求复杂度评级汇总

| 复杂度 | 需求数 | 典型需求 |
|--------|--------|---------|
| 🟢 低（1-4h） | 3 | judge_model、EventBus通配符、邮件营销 |
| 🟡 中（4-16h） | 7 | Mock隔离、灵感记录、SEO优化、收入归集 |
| 🔴 高（16-60h） | 7 | 模式路由、智能客服、多平台分发、模板市场 |

---

> **本规格基于代码实际审查编写，不是基于理想愿景。所有需求都有明确的实现路径和验证标准。**