# FlowForge v3.0 任务清单 — task_face

> **版本**：v3.0-face（基于大厂面试的 v3.0 进化需求）
> **日期**：2026-07-15
> **定位**：基于 `spec_face.md`（需求规格）+ `arch_face.md`（架构详设）拆解的任务清单。
> **本文档开头为 12 项决策对比分析表（辅助快速决策），其后为 P0 详细任务与依赖分析。**
> **规范约束**：严格遵守 `hiclaw/rules.md`、`hiclaw/prompts.md`、T1-T15 测试铁律。

---

## 第一章：12 项决策对比分析表（辅助快速决策）

> 以下针对 spec_face.md 第九章 9.5 的 12 项待审核决策点，逐项给出对比分析与推荐。

### 决策 1：P0/P1/P2 优先级排序

| 维度 | 选项 A（当前排序） | 选项 B（A2A 后置） | 选项 C（全 P0） |
|------|-------------------|-------------------|----------------|
| 内容 | P0=M1-M5, P1=M6-M11+M15, P2=M12-M17 | P0=M2-M5+M9, P1=M1+M6-M11, P2=同 | 全部 P0 |
| 优点 | 协议/上下文/安全/可观测全栈基础 | 先打基础再互联，降低风险 | 快速全量交付 |
| 缺点 | A2A 风险较高（协议可能变化） | A2A 滞后影响生态 | 资源分散，质量难保 |
| 资源需求 | 中 | 中 | 高 |
| 风险 | 中（A2A 协议未稳定） | 低 | 高 |

**推荐**：**选项 A（当前排序）**。理由：A2A 是 v3.0 核心差异化（跨厂互联），延后会丧失先发优势；协议变化风险可通过适配层缓解。

---

### 决策 2：A2A 集成深度

| 维度 | 选项 A（完整 Server+Client） | 选项 B（仅 Client） | 选项 C（仅 Server） |
|------|----------------------------|--------------------|--------------------|
| 能力 | 可被外部调用 + 可调用外部 | 只能调用外部 | 只能被外部调用 |
| 工作量 | 大（需路由/鉴权/Directory） | 小（仅需 Tool） | 中 |
| 价值 | 完整互联节点 | 单向消费 | 单向暴露 |
| 生态价值 | 高（双向联邦） | 低 | 中 |
| 适用场景 | 平台化 / SaaS | 仅内部增强 | 仅对外服务 |

**推荐**：**选项 A（完整 Server+Client）**。理由：FlowForge 定位为"Agent 互联网节点"，单向能力无法支撑联邦生态；Server 复用 FastAPI 增量小。

---

### 决策 3：MCP 2026 升级时机

| 维度 | 选项 A（立即启动，兼容旧版） | 选项 B（等 RC 正式发布 7/28） | 选项 C（等 GA） |
|------|---------------------------|---------------------------|----------------|
| 时间 | 立即 | 延后 2 周 | 延后数月 |
| 风险 | Spec 可能微调 | 低 | 最低 |
| 兼容 | Feature Flag 兼容旧版 | 同 | 同 |
| 影响 | 不阻塞 P0 路线 | P0 延期 | v3.0 延期 |

**推荐**：**选项 A（立即启动）**。理由：用 Feature Flag 兼容旧版，Spec 微调时适配层调整即可；等 RC 会阻塞整个 P0 路线。

---

### 决策 4：Context Engineering 范围

| 维度 | 选项 A（全 JIT） | 选项 B（渐进式） | 选项 C（仅 Memory Tool） |
|------|----------------|----------------|------------------------|
| 内容 | JIT+MemoryTool+Editing 全套 | System/Persona 预加载+Task/Working JIT | 仅加 Memory Tool |
| 性能提升 | 40%+ | 20-30% | 5-10% |
| 风险 | 高（改动大） | 中 | 低 |
| 工作量 | 大 | 中 | 小 |
| 质量 | 高（上下文精准） | 中高 | 中 |

**推荐**：**选项 B（渐进式）**。理由：全 JIT 改动过大风险高；渐进式先保 System/Persona 稳定（Cache 命中高），Task/Working 按 JIT 加载，兼顾性能与稳定。

---

### 决策 5：多租户策略

| 维度 | 选项 A（v3.0 即支持） | 选项 B（延后 v3.1） | 选项 C（仅配额隔离） |
|------|---------------------|-------------------|-------------------|
| 内容 | 数据+资源+配置全隔离 | 延后 | 仅 QPS/Token 隔离 |
| 商业化 | 可立即 SaaS | 不可 | 部分 |
| 工作量 | 大 | 小 | 中 |
| 风险 | 中（渗透测试） | 低 | 中 |

**推荐**：**选项 B（延后 v3.1）**。理由：v3.0 聚焦技术能力（A2A/MCP/Context/Guardrails/OTel），多租户是商业化能力，技术能力稳定后再做多租户更稳妥；但 M9 Cost 归因预留 tenant_id 字段。

---

### 决策 6：Skill 市场开放时机

| 维度 | 选项 A（v3.0 开放） | 选项 B（v3.0 内部，v3.1 开放） | 选项 C（不开放） |
|------|-------------------|---------------------------|----------------|
| 生态 | 早开放早建生态 | 先内部验证 | 无生态 |
| 风险 | 高（安全/质量） | 中 | 低 |
| 工作量 | 大 | 中 | 小 |

**推荐**：**选项 B（v3.0 内部，v3.1 开放）**。理由：安全沙箱（M2）+ 评价体系（M6）需先成熟，否则开放市场风险高；v3.0 先内部跑通，v3.1 正式开放。

---

### 决策 7：Computer Use 范围

| 维度 | 选项 A（含移动端） | 选项 B（仅桌面+浏览器） | 选项 C（仅浏览器） |
|------|------------------|---------------------|------------------|
| 覆盖 | 全平台 | 桌面+浏览器 | 浏览器 |
| 价值 | 高 | 中高 | 中 |
| 工作量 | 极大 | 大 | 中 |
| 稳定性 | 低（移动端碎片化） | 中 | 高 |

**推荐**：**选项 B（仅桌面+浏览器）**。理由：移动端碎片化严重（Android/iOS 差异大），ROI 低；桌面+浏览器已覆盖 DevForge/ContentForge 主要场景。

---

### 决策 8：T10-T15 测试铁律分阶段

| 维度 | 选项 A（全部纳入 v3.0） | 选项 B（P0 配 T10-T13，P2 配 T14-T15） | 选项 C（延后） |
|------|----------------------|--------------------------------------|--------------|
| 覆盖 | 100% | 按阶段 | 低 |
| 风险 | 低（早发现） | 中 | 高 |
| 工作量 | 大 | 中 | 小 |

**推荐**：**选项 B（按阶段配）**。理由：T10(OTel)/T11(A2A)/T12(Durable)/T13(Guardrails) 对应 P0，必须配套；T14(Eval-gated)/T15(AgentBOM) 对应 P2，延后合理。

---

### 决策 9：路线图时间调整

| 维度 | 选项 A（6.0=2月,6.1=3月,6.2=2月） | 选项 B（压缩：1+2+1） | 选项 C（拉长：3+4+3） |
|------|--------------------------------|---------------------|---------------------|
| 总周期 | 7 个月 | 4 个月 | 10 个月 |
| 压力 | 中 | 高 | 低 |
| 质量 | 中高 | 风险高 | 高 |

**推荐**：**选项 A（当前）**。理由：2+3+2 节奏合理，P0 基础需充分（2 月），P1 复杂需更多时间（3 月），P2 相对独立（2 月）；压缩会牺牲质量。

---

### 决策 10：CSA AGMM 目标

| 维度 | 选项 A（冲击 Level 5） | 选项 B（稳定 Level 4） | 选项 C（Level 3 即可） |
|------|---------------------|---------------------|---------------------|
| 目标 | 最高 | 高 | 中 |
| 工作量 | 极大 | 大 | 中 |
| 价值 | 行业领先 | 工业可用 | 基础 |

**推荐**：**选项 B（稳定 Level 4）**。理由：Level 4 已达工业可用（Identity/Observability/Safety/Compliance/Lifecycle/Collaboration 全 L4）；Level 5 需行业认证投入大，ROI 不高。

---

### 决策 11：商业化 SaaS 时机

| 维度 | 选项 A（v3.0 即 SaaS） | 选项 B（v3.1 SaaS） | 选项 C（不 SaaS） |
|------|---------------------|-------------------|------------------|
| 收入 | 早变现 | 稳健 | 无 |
| 前提 | 多租户+计费（M16） | 同 | - |
| 风险 | 高（技术未稳） | 中 | 低 |

**推荐**：**选项 B（v3.1 SaaS）**。理由：v3.0 先打磨技术能力，多租户延后（决策 5），v3.1 配套多租户+计费再 SaaS 化更稳妥。

---

### 决策 12：大厂动态遗漏补充

| 维度 | 可能遗漏方向 | 是否纳入 |
|------|------------|---------|
| 联邦学习 | 隐私保护的多方协作 | **暂不纳入**（与 Agent Harness 关联弱） |
| 隐私计算 | 数据可用不可见 | **暂不纳入**（与当前场景关联弱） |
| 端侧 Agent | 手机/Edge 设备运行 Agent | **v3.1 考察**（依赖 Computer Use 移动端，决策 7） |
| Agent Workflow 标准化 | WfMC/BPMN for Agent | **暂不纳入**（已有 Workflow Compiler） |
| Agent Memory 标准化 | 共享记忆协议 | **v3.1 考察**（M3 Memory Tool 内部化先行） |
| 多模态 Agent | 视觉/音频输入输出 | **v3.1 考察**（依赖 Computer Use，M13） |

**推荐**：当前 15 大方向已覆盖核心，暂不纳入联邦学习/隐私计算（与 Agent Harness 关联弱）；端侧/多模态/记忆标准化留 v3.1 考察。

---

### 决策汇总表（快速决策用）

| # | 决策项 | 推荐 | 理由摘要 |
|---|--------|------|---------|
| 1 | 优先级排序 | **A（当前）** | A2A 是差异化核心 |
| 2 | A2A 集成深度 | **A（完整）** | 双向联邦生态 |
| 3 | MCP 升级时机 | **A（立即）** | Feature Flag 兼容，不阻塞 |
| 4 | Context Eng 范围 | **B（渐进）** | 兼顾性能与稳定 |
| 5 | 多租户 | **B（延后 v3.1）** | 先技术后商业 |
| 6 | Skill 市场 | **B（v3.0 内部）** | 安全沙箱先成熟 |
| 7 | Computer Use | **B（桌面+浏览器）** | 移动端 ROI 低 |
| 8 | T10-T15 | **B（按阶段）** | P0 配 T10-T13 |
| 9 | 路线图时间 | **A（当前）** | 节奏合理 |
| 10 | CSA AGMM | **B（Level 4）** | 工业可用 |
| 11 | SaaS 时机 | **B（v3.1）** | 配套多租户 |
| 12 | 遗漏补充 | **暂不纳入** | 留 v3.1 考察 |

> **请在决策汇总表中标注"同意/调整"即可，后续任务清单按推荐方案编排。**

### v7.0 灵智养成体系融合说明

> face 目录下的 M1-M17 任务已完美融入 v7.0 灵智养成体系（详见 `flowforge/docs/spec.md` 第七章）。
> M1-M17 是 v7.0 七层架构第 1-6 层的工程实现，为第 7 层（自进化层）的 ForgekinEngine 提供支撑。
> v7.0 的 FR-EVO-01~15 需求规格在 `flowforge/docs/spec.md` 第八章中独立定义，不在本任务清单中重复。

---

## 第二章：P0 任务拆解总览

### 2.1 P0 模块任务总览

| 模块 | 任务数 | 工作量（人日） | 优先级 |
|------|--------|--------------|--------|
| M5 OTel GenAI | 8 | 12 | P0-1（最先） |
| M4 六层 Guardrails | 10 | 15 | P0-2 |
| M3 Context Eng 2.0 | 9 | 14 | P0-3 |
| M2 MCP 2026 | 8 | 13 | P0-4 |
| M1 A2A 协议 | 11 | 18 | P0-5（最后） |
| 集成联调 | 7 | 14 | P0-6 |
| **合计** | **53** | **86** | |

### 2.2 任务编号规则

`{模块}-{阶段}-{序号}`
- 模块：M1/M2/M3/M4/M5/INT（集成）
- 阶段：D（设计）/I（实现）/T（测试）/D（文档）
- 示例：`M5-I-03` = M5 模块实现阶段第 3 个任务

---

## 第三章：M5 OTel GenAI 详细任务

### M5-D-01: OTel GenAI Span Schema 设计
**输入**：spec_face.md M5、OTel GenAI v1.30 规范
**输出**：Span Schema 设计文档
**步骤**：
1. 阅读 OTel GenAI v1.30 `gen_ai.*` 属性规范
2. 定义 `gen_ai.llm` / `gen_ai.tool` / `gen_ai.agent` Span 属性
3. 定义 Span 层级关系（root→gateway→agent→tool→llm）
4. 输出 `flowforge/docs/face/otel_span_schema.md`
**依赖**：无
**验收**：Schema 覆盖所有 LLM/Tool/Agent 调用

### M5-I-01: GenAITracer 实现升级
**输入**：M5-D-01、现有 `observability/tracer.py`
**输出**：升级后的 `observability/genai_tracer.py`
**步骤**：
1. 升级现有 `observability/tracer.py` 为 `gen_ai.*` schema
2. 实现 `trace_llm_call(model, input, output, usage)` 生成 `gen_ai.llm` Span
3. 实现 `trace_tool_call(tool_name, input, output)` 生成 `gen_ai.tool` Span
4. 实现 `trace_agent_exec(agent_id, input)` 生成 `gen_ai.agent` Span
5. Span 属性完整设置（gen_ai.system/request.model/usage.*）
**依赖**：M5-D-01
**验收**：所有 LLM/Tool/Agent 调用生成标准 Span；T10 测试通过

### M5-I-02: Metrics 标准化
**输入**：M5-D-01、现有 `observability/metrics_collector.py`
**输出**：升级后的 Metrics
**步骤**：
1. 对齐 `gen_ai.client.token_usage`（Counter）
2. 对齐 `gen_ai.client.operation_duration`（Histogram）
3. 对齐 `gen_ai.server.active_requests`（UpDownCounter）
4. 新增 `flowforge.cache.hit_rate`、`flowforge.guardrails.block_count`、`flowforge.a2a.task_duration`
5. 与现有 metrics_collector 协同
**依赖**：M5-I-01
**验收**：Metrics 上报 Prometheus 格式正确

### M5-I-03: Exporter 多后端
**输入**：M5-I-01
**输出**：`observability/exporter_manager.py`
**步骤**：
1. 实现 OTLP gRPC Exporter（默认）
2. 实现 LangSmith Exporter（按需）
3. 实现 Langfuse Exporter（按需）
4. 实现 Phoenix Exporter（按需）
5. 配置驱动选择 `config/observability/exporters.yaml`
**依赖**：M5-I-01
**验收**：至少 2 个 Exporter 可用

### M5-I-04: Trace 端到端串联
**输入**：M5-I-01
**输出**：全链路 Trace 串联
**步骤**：
1. Gateway 请求生成 root Span
2. Harness 阶段生成子 Span
3. Engine/Agent 阶段生成子 Span
4. Tool/LLM 阶段生成子 Span
5. 全链路一个 Trace ID 传递（context propagation）
6. 支持 Distributed Tracing（跨 A2A 调用，M1 协同）
**依赖**：M5-I-01
**验收**：用户→LLM 一个 Trace ID 完整串联

### M5-I-05: 告警规则实现
**输入**：M5-I-02
**输出**：`config/observability/alerts.yaml` + 告警引擎
**步骤**：
1. 实现告警规则 YAML 配置
2. LLM 失败率 > 5% 告警
3. 平均延迟 > 30s 告警
4. Token 异常增长告警
5. Cache 命中率 < 50% 告警（M9 协同）
**依赖**：M5-I-02
**验收**：告警规则全部触发测试通过

### M5-I-06: Eval-gated Deploy Gate
**输入**：M5-I-01
**输出**：`observability/eval_gate.py`
**步骤**：
1. 实现 `pre_deploy_check(version)` 接口
2. 发布前自动跑 τ-bench（k=5）
3. pass^5 ≥ 80% 才允许发布
4. 失败自动回滚
5. 评估报告 OTel Trace 化
**依赖**：M5-I-01、M6（评估框架，P1 可先桩实现）
**验收**：不合格版本被阻断（T14 测试）

### M5-I-07: Helm UI Trace View 集成
**输入**：M5-I-04
**输出**：Helm UI Trace 视图
**步骤**：
1. 新增 `TraceView.tsx` 组件
2. Span 树形展开（可折叠）
3. LLM Input/Output 可查看（支持折叠长内容）
4. 错误 Span 高亮（红色）
5. 慢 Span 高亮（黄色，> P95）
6. 与现有 `ToolCallCard.tsx` / `LLMCallCard.tsx` 协同
**依赖**：M5-I-04
**验收**：Trace 视图可用，Span 树完整展示

### M5-T-01: M5 测试
**输入**：M5-I-01~07
**输出**：测试用例
**步骤**：
1. T10 OTel Trace 完整性测试（每个 Span 完整生成）
2. Exporter 多后端测试
3. Trace 端到端串联测试
4. 告警规则触发测试
5. Eval-gated 阻断测试
**依赖**：M5-I-01~07
**验收**：T10 测试通过

---

## 第四章：M4 六层 Guardrails 详细任务

### M4-D-01: 六层 Guardrails 策略设计
**输入**：spec_face.md M4
**输出**：`config/guardrails/` 策略 YAML
**步骤**：
1. 设计 L1 Input Validation 策略（Injection/Jailbreak/PII）
2. 设计 L2 System Prompt Constraints 策略
3. 设计 L3 Tool Allow-lists 策略
4. 设计 L4 Output Validation 策略
5. 设计 L5 Action Confirmation 策略
6. 设计 L6 Cost Ceilings 策略
7. 输出 6 个 YAML 配置文件
**依赖**：无
**验收**：策略 YAML 完整

### M4-I-01: L1 Input Validator
**输入**：M4-D-01
**输出**：`security/guardrails/input_validator.py`
**步骤**：
1. 实现 Prompt Injection 检测（LLM-as-Judge）
2. 实现 Jailbreak 检测（关键词+模式匹配）
3. 实现 PII 检测（身份证/手机/邮箱/银行卡）
4. 实现输入长度/复杂度限制
5. 实现多语言输入识别
**依赖**：M4-D-01、M5-I-01（Trace）
**验收**：Injection 检出率 ≥ 95%

### M4-I-02: L2 System Prompt Guard
**输入**：M4-D-01
**输出**：`security/guardrails/system_prompt_guard.py`
**步骤**：
1. 实现 AGENTS.md 自动注入
2. 实现 Skill 白名单注入
3. 实现 Linter 规则注入
4. 实现权限管线（M11 协同，P1 先桩）
5. 实现 System Prompt 防泄露
**依赖**：M4-D-01、M5-I-01
**验收**：System Prompt 不泄露给用户

### M4-I-03: L3 Tool Allowlist
**输入**：M4-D-01
**输出**：`security/guardrails/tool_allowlist.py`
**步骤**：
1. 实现每个 Agent 可用工具集声明（YAML）
2. 运行时强制校验（不在白名单不可调用）
3. 工具参数 Schema 校验（Pydantic）
4. 工具调用频率限制
5. 与 M2 MCP 沙箱协同
**依赖**：M4-D-01、M5-I-01
**验收**：白名单外工具被拦截

### M4-I-04: L4 Output Validator
**输入**：M4-D-01
**输出**：`security/guardrails/output_validator.py`
**步骤**：
1. 实现内容审核（豆包 moderation）
2. 实现事实核查（fact_check 工具强制调用）
3. 实现代码安全扫描（bandit/semgrep）
4. 实现输出格式校验（JSON Schema/Markdown）
5. 实现 AI 痕迹检测（T7 标准）
**依赖**：M4-D-01、M5-I-01
**验收**：违规内容被拦截

### M4-I-05: L5 Action Confirmation
**输入**：M4-D-01
**输出**：`security/guardrails/action_confirmation.py`
**步骤**：
1. 实现高风险 Action 列表（YAML）
2. 实现二次确认机制（Web UI/即时通讯）
3. 实现 Blast-radius Gate（影响范围评估，M12 协同先桩）
4. 实现时间窗口限制（24h 可撤销）
5. 实现多人会签（M-of-N）
**依赖**：M4-D-01、M5-I-01
**验收**：高风险 Action 100% 二次确认

### M4-I-06: L6 Cost Ceiling
**输入**：M4-D-01
**输出**：`security/guardrails/cost_ceiling.py`
**步骤**：
1. 实现每会话成本上限（默认 $10）
2. 实现每日成本上限（默认 $100）
3. 实现每月成本上限（默认 $1000）
4. 实现超额自动熔断
5. 实现实时成本仪表盘（Web UI）
**依赖**：M4-D-01、M5-I-02
**验收**：超额熔断生效

### M4-I-07: Guardrails Orchestrator
**输入**：M4-I-01~06
**输出**：`security/guardrails/orchestrator.py`
**步骤**：
1. 实现 `pre_check(request)` 前馈编排（L1+L2+L3）
2. 实现 `post_check(response)` 后馈编排（L4+L5+L6）
3. 与 HybridExecutor 集成（执行前后调用）
4. 与 OTel Trace 集成
5. 通过 DI 注入
**依赖**：M4-I-01~06、M5-I-01
**验收**：六层完整闭环

### M4-I-08: Guardrails Web UI
**输入**：M4-I-07
**输出**：Guardrails 配置/监控 UI
**步骤**：
1. Guardrails 策略配置 UI
2. 拦截记录查看 UI
3. 成本仪表盘 UI
4. 高风险 Action 审批队列 UI
**依赖**：M4-I-07
**验收**：UI 可用

### M4-T-01: M4 测试
**输入**：M4-I-01~08
**输出**：测试用例
**步骤**：
1. T13 Guardrails 闭环测试（六层全部触发）
2. Injection 检测测试集（50 例）
3. 高风险 Action 二次确认测试
4. 成本上限熔断测试
**依赖**：M4-I-01~08
**验收**：T13 测试通过

---

## 第五章：M3 Context Engineering 2.0 详细任务

### M3-D-01: Context Layer 升级设计
**输入**：spec_face.md M3、现有 `core/context_layer_manager.py`
**输出**：`config/context_engine/layers.yaml`
**步骤**：
1. 定义 System/Persona/Task/Working 四层
2. 每层声明 `lazy` 和 `priority`
3. 定义 Cache 策略
4. 定义 Token 预算
**依赖**：无
**验收**：layers.yaml 完整

### M3-I-01: Context Engine JIT 升级
**输入**：M3-D-01、现有 `harness/context_engine.py`
**输出**：升级后的 `harness/context_engine.py`
**步骤**：
1. 实现 `build_context(agent_id, task_input, session_id)`
2. System/Persona 必加载，Task/Working 标记 lazy
3. Token 预算检查，超限触发 Context Editing
4. 实现 `fetch(layer, key)` 按需获取
5. 通过 ToolRegistry 注册为 `context_fetch` 工具
**依赖**：M3-D-01、M5-I-01
**验收**：JIT 模式 Token 下降 ≥ 40%

### M3-I-02: Memory Tool 实现
**输入**：M3-D-01、现有 `memory/`
**输出**：`harness/memory_tool.py`
**步骤**：
1. 实现 `memory_save(key, value, ttl, scope)`
2. 实现 `memory_recall(query, top_k)` 语义检索
3. 实现 `memory_forget(key)` 主动遗忘
4. 实现 `memory_compress(threshold)` 压缩
5. 通过 ToolRegistry 注册
**依赖**：M3-D-01、M5-I-01
**验收**：4 个 API 全部可用

### M3-I-03: Context Editor 实现
**输入**：M3-D-01
**输出**：`harness/context_editor.py`
**步骤**：
1. 实现 Token 预算管理（默认 32K）
2. 实现历史消息滑动窗口（keep_first_last）
3. 实现工具结果折叠（与 M2 Elision 协同）
4. 实现多轮对话压缩
5. 策略 YAML 配置化
**依赖**：M3-D-01、M5-I-01
**验收**：50 轮对话 Token 稳定 32K 内

### M3-I-04: Context Layer Manager 升级
**输入**：M3-D-01、现有 `core/context_layer_manager.py`
**输出**：升级后的 `core/context_layer_manager.py`
**步骤**：
1. 支持 `lazy: true` 标记
2. 支持 `priority` 字段
3. Token 不足时丢弃低优先级层
4. 与 Context Engine 协同
**依赖**：M3-D-01、M3-I-01
**验收**：lazy 层按需加载

### M3-I-05: Context Cache 实现
**输入**：M3-I-01
**输出**：Context Cache 模块
**步骤**：
1. 实现 Cache Key（content hash）
2. 实现 TTL（默认 1h）
3. 实现主动失效（Persona 更新触发）
4. 与 M9 Prompt Caching 协同
5. Cache 命中率 Metric（OTel）
**依赖**：M3-I-01、M5-I-02
**验收**：命中率 ≥ 60%

### M3-I-06: Context PreFlect 集成
**输入**：M3-I-01、M8（P1 先桩）
**输出**：PreFlect 上下文预测
**步骤**：
1. Agent 执行前预测所需上下文
2. 预测结果注入 JIT 加载
3. 与 M8 PreFlect 协同（P1 先桩，预留接口）
**依赖**：M3-I-01
**验收**：上下文预测准确率 ≥ 70%（P1 完整后）

### M3-I-07: Loop 集成
**输入**：M3-I-01~03
**输出**：Loop 每步 Context 构建
**步骤**：
1. `loop/executor.py` 每步调用 `build_context`
2. 工具结果自动 Elision
3. 多轮对话自动压缩
**依赖**：M3-I-01~03
**验收**：Loop 集成后 T7 通过率不下降

### M3-T-01: M3 测试
**输入**：M3-I-01~07
**输出**：测试用例
**步骤**：
1. JIT Token 下降测试
2. Memory Tool 4 API 测试
3. Context Editing 50 轮测试
4. Cache 命中率测试
5. T7 审核通过率不下降测试
**依赖**：M3-I-01~07
**验收**：全部通过

---

## 第六章：M2 MCP 2026 详细任务

### M2-D-01: MCP 2026 Spec RC 兼容设计
**输入**：spec_face.md M2、MCP 2026 Spec RC
**输出**：`config/mcp_v2026/` 配置
**步骤**：
1. 阅读 MCP 2026 Spec RC（Stateless Core/Apps/OAuth/Elision）
2. 设计 Stateless 状态外置方案（Redis）
3. 设计 MCP Apps Manifest 格式
4. 设计 Tool Result Elision 策略
5. 设计 OAuth Authorization Code Flow
6. 设计 Tool Sandbox 策略
**依赖**：无
**验收**：设计文档完整

### M2-I-01: MCP Server Stateless 化
**输入**：M2-D-01、现有 `flowforge/mcp/server.py`
**输出**：升级后的 MCP Server
**步骤**：
1. 移除 Server 状态字段
2. 所有状态读写走 Redis（Session ID 透传）
3. Server 可水平扩展（多副本）
4. 重启不影响进行中会话
5. Feature Flag 兼容旧版
**依赖**：M2-D-01、M5-I-01
**验收**：重启后会话不中断

### M2-I-02: MCP Apps Manifest
**输入**：M2-D-01
**输出**：`mcp/manifest_registry.py`
**步骤**：
1. 实现 `/.well-known/mcp-manifest.json` 自动发现
2. Manifest 解析与注册
3. Marketplace 集成（M17 协同，P2 先桩）
4. 版本管理
**依赖**：M2-D-01
**验收**：Manifest 自动发现可用

### M2-I-03: OAuth Authorization Code Flow
**输入**：M2-D-01
**输出**：`mcp/oauth_flow.py`
**步骤**：
1. 实现 Authorization Code Flow
2. 用户授权页（FlowForge Web UI）
3. Token 加密存储（复用 `core/secret_store.py`）
4. Token 刷新机制
5. 用户级授权（非全局 API Key）
**依赖**：M2-D-01、`middleware/auth.py`
**验收**：OAuth Flow 跑通

### M2-I-04: Tool Result Elision
**输入**：M2-D-01
**输出**：`mcp/elision.py`
**步骤**：
1. 实现结果 Token 计数
2. > 4K tokens 自动摘要
3. 历史结果折叠（保留最近 N 次完整）
4. 与 M3 Context Editor 协同
**依赖**：M2-D-01、M3-I-03
**验收**：Elision 触发率监控

### M2-I-05: Tool Sandbox 强化
**输入**：M2-D-01
**输出**：升级后的沙箱
**步骤**：
1. Container Isolation（Docker per tool）
2. Resource Limit（CPU/Memory/Network）
3. Network Egress Allowlist
4. CVE-2025-47241 修复（路径遍历/YAML 安全）
5. 与 M4 L3 Tool Allowlist 协同
**依赖**：M2-D-01、M4-I-03
**验收**：沙箱隔离测试通过

### M2-I-06: EMA 企业网关
**输入**：M2-I-01~05
**输出**：`mcp/gateway.py` 升级
**步骤**：
1. 企业内部 MCP 网关聚合
2. 统一鉴权/审计/限流
3. 多版本兼容（v2024/v2026 RC）
**依赖**：M2-I-01~05
**验收**：网关聚合可用

### M2-I-07: MCP 工具自动注册
**输入**：M2-I-02
**输出**：ToolRegistry 集成
**步骤**：
1. MCP 工具自动发现（Manifest）
2. 自动注册到 ToolRegistry
3. Schema 校验
4. 通过 DI 注入
**依赖**：M2-I-02
**验收**：MCP 工具可被 Agent 调用

### M2-T-01: M2 测试
**输入**：M2-I-01~07
**输出**：测试用例
**步骤**：
1. Stateless 重启测试
2. Manifest 自动发现测试
3. OAuth Flow 测试
4. Elision 触发测试
5. Sandbox 隔离测试（CVE 修复）
**依赖**：M2-I-01~07
**验收**：全部通过

---

## 第七章：M1 A2A 协议详细任务

### M1-D-01: A2A 协议设计
**输入**：spec_face.md M1、Google A2A Spec
**输出**：`config/a2a/` 配置
**步骤**：
1. 阅读 Google A2A Spec 2026
2. 设计 Agent Card 格式（YAML）
3. 设计 Task 生命周期（pending→running→completed→failed）
4. 设计 SSE 流式响应
5. 设计鉴权方案（Bearer/OAuth2/JWT）
6. 设计 Agent Directory
**依赖**：无
**验收**：设计文档完整

### M1-I-01: A2A 数据模型
**输入**：M1-D-01
**输出**：`interconnect/a2a/models.py`
**步骤**：
1. 实现 `A2ATaskRequest`（Pydantic）
2. 实现 `A2ATaskStatus`
3. 实现 `A2ATaskResult`
4. 实现 `AgentCard`
5. 实现 `Artifact`
**依赖**：M1-D-01
**验收**：模型校验通过

### M1-I-02: Agent Card Builder
**输入**：M1-D-01、现有 `core/agent_registry.py`
**输出**：`interconnect/a2a/card_builder.py`
**步骤**：
1. 从 AgentRegistry 读取 Agent 元数据
2. 生成标准 Agent Card（YAML）
3. 写入 `config/a2a/agent_cards/`
4. 支持 `/.well-known/agent.json` 自动暴露
**依赖**：M1-D-01、M1-I-01
**验收**：`curl /.well-known/agent.json` 返回标准 Card

### M1-I-03: A2A Server 实现
**输入**：M1-I-01~02
**输出**：`interconnect/a2a/server.py` + `routes.py`
**步骤**：
1. 实现 `POST /a2a/{agent_id}/tasks`（下发任务）
2. 实现 `GET /a2a/{agent_id}/tasks/{task_id}/status`
3. 实现 `GET /a2a/{agent_id}/tasks/{task_id}/result`
4. 实现 `DELETE /a2a/{agent_id}/tasks/{task_id}`（取消）
5. 实现 `POST /a2a/{agent_id}/stream`（SSE 流式）
6. 复用 HybridExecutor 异步执行
7. 复用 TaskStore 任务持久化
8. 集成到 `app/api/router.py`
**依赖**：M1-I-01~02、M5-I-01
**验收**：外部 Client 可下发任务并收到响应

### M1-I-04: A2A Client 实现
**输入**：M1-I-01
**输出**：`interconnect/a2a/client.py`
**步骤**：
1. 继承 BaseTool（DI 合规）
2. 实现 `a2a_invoke(agent_url, task_input, streaming, timeout)`
3. 自动发现外部 Agent Card
4. 支持同步/流式两种模式
5. 支持长任务轮询/订阅
6. 通过 ToolRegistry 注册
**依赖**：M1-I-01、M5-I-01
**验收**：FlowForge Agent 可调用外部 A2A Agent

### M1-I-05: Agent Directory
**输入**：M1-I-02
**输出**：`interconnect/a2a/directory.py`
**步骤**：
1. 启动时扫描 `config/a2a/agent_cards/*.yaml`
2. 支持手动 register/unregister
3. 实现 `GET /a2a/directory/search?skill=&tags=`
4. 支持联邦查询（跨实例）
5. 缓存 + 定时刷新
**依赖**：M1-I-02
**验收**：50+ Agent 注册与查询

### M1-I-06: A2A 鉴权
**输入**：M1-D-01
**输出**：`interconnect/a2a/authenticator.py`
**步骤**：
1. 实现 Bearer Token 校验（内部）
2. 实现 OAuth2 Client Credentials（跨厂）
3. 实现 JWT 签名（请求来源验证）
4. 限流配额（按 tenant + agent_id）
5. 与 `middleware/auth.py` 集成
**依赖**：M1-D-01
**验收**：鉴权通过 Bearer+OAuth2

### M1-I-07: SSE 流式响应
**输入**：M1-I-03
**输出**：SSE 实现
**步骤**：
1. 复用 Helm WebSocket 推送机制
2. 实现 SSE Event Stream
3. 支持 progress 事件
4. 支持 cancel 事件
5. 超时处理
**依赖**：M1-I-03
**验收**：SSE 流式响应可用

### M1-I-08: A2A Web UI
**输入**：M1-I-03~05
**输出**：A2A Directory UI
**步骤**：
1. Agent Directory 搜索界面
2. Agent Card 详情查看
3. 任务下发测试界面
4. 任务状态实时查看
**依赖**：M1-I-03~05
**验收**：UI 可用

### M1-I-09: Push Notifications
**输入**：M1-I-03
**输出**：推送通知
**步骤**：
1. 实现长任务推送通知
2. Webhook 回调
3. 即时通讯推送
4. 与 M11 HITL 协同（P1）
**依赖**：M1-I-03
**验收**：推送通知可用

### M1-I-10: 跨实例联邦
**输入**：M1-I-05
**输出**：联邦查询
**步骤**：
1. 跨实例 Agent Directory 联邦
2. 联邦查询协议
3. 鉴权透传
**依赖**：M1-I-05、M1-I-06
**验收**：跨实例联邦查询可用

### M1-T-01: M1 测试
**输入**：M1-I-01~10
**输出**：测试用例
**步骤**：
1. T11 A2A 协议合规测试（Agent Card/Task/SSE 标准）
2. 鉴权测试（Bearer/OAuth2）
3. 流式响应测试
4. 联邦查询测试
5. T8 浏览器 DOM 验证（Web UI）
**依赖**：M1-I-01~10
**验收**：T11 测试通过

---

## 第八章：集成联调任务

### INT-I-01: M5+M4 集成
**步骤**：Guardrails 检查全部 OTel Trace
**依赖**：M5-I-01、M4-I-07
**验收**：Guardrails Span 完整

### INT-I-02: M3+M2 集成
**步骤**：MCP 工具结果 Elision 与 Context Editor 协同
**依赖**：M3-I-03、M2-I-04
**验收**：工具结果自动裁剪

### INT-I-03: M1+M2+M3+M4+M5 全链路
**步骤**：端到端联调
- A2A 任务下发 → Context JIT 构建 → MCP 工具调用 → Guardrails 验证 → OTel Trace
**依赖**：M1~M5 全部完成
**验收**：端到端 Trace 完整

### INT-I-04: 性能 SLO 验证
**步骤**：性能基准测试
**依赖**：INT-I-03
**验收**：性能 SLO 全部达标

### INT-T-01: T10-T13 全量测试
**步骤**：T10(OTel)/T11(A2A)/T12(Durable)/T13(Guardrails)
**依赖**：INT-I-03
**验收**：T10-T13 全部通过

---

## 第九章：P0 依赖分析

### 9.1 任务依赖图

```
M5-D-01 ──► M5-I-01 ──► M5-I-02 ──► M5-I-05
              │    │
              │    ├──► M5-I-03
              │    │
              │    ├──► M5-I-04 ──► M5-I-07
              │    │
              │    └──► M5-I-06 (依赖 M6 桩)
              │
M4-D-01 ──► M4-I-01~06 ──► M4-I-07 ──► M4-I-08
              │ (依赖 M5-I-01)
              
M3-D-01 ──► M3-I-01 ──► M3-I-04
              │    │
              │    ├──► M3-I-02
              │    │
              │    ├──► M3-I-03 (依赖 M2-I-04)
              │    │
              │    ├──► M3-I-05 (依赖 M5-I-02)
              │    │
              │    └──► M3-I-06 (依赖 M8 桩)
              │
              └──► M3-I-07 (依赖 M3-I-01~03)

M2-D-01 ──► M2-I-01 ──► M2-I-06
              │
              ├──► M2-I-02 ──► M2-I-07
              │
              ├──► M2-I-03
              │
              ├──► M2-I-04 (依赖 M3-I-03)
              │
              └──► M2-I-05 (依赖 M4-I-03)

M1-D-01 ──► M1-I-01 ──► M1-I-02 ──► M1-I-03
              │                        │
              │                        ├──► M1-I-04
              │                        │
              │                        ├──► M1-I-07
              │                        │
              │                        └──► M1-I-08
              │
              ├──► M1-I-05 (依赖 M1-I-02)
              │
              ├──► M1-I-06
              │
              ├──► M1-I-09 (依赖 M1-I-03)
              │
              └──► M1-I-10 (依赖 M1-I-05, M1-I-06)
```

**集成联调依赖链**

```
INT-I-01 (M5+M4 集成)  ← M5-I-01, M4-I-07
INT-I-02 (M3+M2 集成)  ← M3-I-03, M2-I-04
INT-I-03 (全链路联调)  ← M1~M5 全部
INT-I-04 (性能 SLO)    ← INT-I-03
INT-T-01 (T10-T13 测试) ← INT-I-03 + INT-I-04
```

### 9.2 关键路径（Critical Path）

```
M5-D-01 → M5-I-01 → M5-I-04 → INT-I-03 → INT-T-01
 (1d)     (3d)      (3d)      (3d)      (2d)
关键路径总长：12 人日（不可并行部分）
```

### 9.3 依赖矩阵

| 任务 | 前置依赖 | 后续依赖 |
|------|---------|---------|
| M5-D-01 | 无 | M5-I-01 |
| M5-I-01 | M5-D-01 | M4-I-*, M3-I-*, M2-I-*, M1-I-*, M5-I-02~07 |
| M5-I-02 | M5-I-01 | M5-I-05, M4-I-06, M3-I-05 |
| M5-I-06 | M5-I-01 | - |
| M4-D-01 | 无 | M4-I-01~06 |
| M4-I-07 | M4-I-01~06, M5-I-01 | M4-I-08, INT-I-01 |
| M3-D-01 | 无 | M3-I-01 |
| M3-I-01 | M3-D-01, M5-I-01 | M3-I-04~07 |
| M3-I-03 | M3-D-01, M5-I-01 | M2-I-04, M3-I-07 |
| M2-I-04 | M2-D-01, M3-I-03 | M2-I-06 |
| M2-I-05 | M2-D-01, M4-I-03 | M2-I-06 |
| M1-I-03 | M1-I-01~02, M5-I-01 | M1-I-04~10 |
| INT-I-03 | M1~M5 全部 | INT-I-04, INT-T-01 |
| INT-T-01 | INT-I-03, INT-I-04 | 无 |

### 9.4 并行度分析

**可并行任务组**：
- 组 A（M5 基础）：M5-D-01 → M5-I-01（先行，所有模块共用）
- 组 B（M4/M3/M2/M1 设计）：可同时启动（M4-D-01/M3-D-01/M2-D-01/M1-D-01 无依赖）
- 组 C（M4/M3/M2/M1 实现）：M5-I-01 完成后可并行
- 组 D（Web UI 并行）：M4-I-08 / M1-I-08 / M5-I-07 可并行

**最大并行度**：4（M3 + M4 + M2 + M1 四条链路同时实现，前提是 M5-I-01 已完成）

**串行瓶颈**：
1. M5-I-01 是所有模块实现的前置
2. M3-I-03 → M2-I-04（Context Editor 是 Tool Result Elision 的前置）
3. M4-I-03 → M2-I-05（Tool Allowlist 是 Tool Sandbox 的前置）
4. M4-I-07 → INT-I-01（Guardrails Orchestrator 是 M5+M4 集成的前置）

**资源需求提示**：P0 工作量 86 人日，按 4 人团队、4 并行度估算，需 22 个工作日（约 4-5 周）；加上关键路径串行段 12 人日，整体 P0 周期约 8 周（2 个月）。

---

## 第十章：P0 实施步骤（按周排期）

> 原 8 周排期，覆盖 Phase 6.0 P0 全部任务（M1-M5 + 集成联调）。

### Week 1（基础设计 + M5 启动）

| 周 | 任务 | 负责模块 | 依赖 |
|----|------|---------|------|
| W1-D1~D2 | M5-D-01 OTel Schema 设计 | M5 | 无 |
| W1-D1~D2 | M4-D-01 Guardrails 策略设计 | M4 | 无 |
| W1-D1~D2 | M3-D-01 Context Layer 设计 | M3 | 无 |
| W1-D1~D2 | M2-D-01 MCP 2026 设计 | M2 | 无 |
| W1-D1~D2 | M1-D-01 A2A 协议设计 | M1 | 无 |
| W1-D3~D5 | M5-I-01 GenAITracer 实现 | M5 | M5-D-01 |
| W1-D3~D5 | M5-I-02 Metrics 标准化 | M5 | M5-I-01（可并行） |

### Week 2（M5 完成 + M4/M3 启动）

| 周 | 任务 | 负责模块 | 依赖 |
|----|------|---------|------|
| W2-D1~D2 | M5-I-03 Exporter 多后端 | M5 | M5-I-01 |
| W2-D1~D3 | M5-I-04 Trace 端到端串联 | M5 | M5-I-01 |
| W2-D1~D2 | M4-I-01 L1 Input Validator | M4 | M4-D-01, M5-I-01 |
| W2-D1~D2 | M3-I-01 Context Engine JIT | M3 | M3-D-01, M5-I-01 |
| W2-D3~D4 | M4-I-02 L2 System Prompt Guard | M4 | M4-D-01 |
| W2-D3~D4 | M3-I-02 Memory Tool | M3 | M3-D-01 |
| W2-D5 | M5-I-05 告警规则 | M5 | M5-I-02 |

### Week 3（M4/M3/M2 并行）

| 周 | 任务 | 负责模块 | 依赖 |
|----|------|---------|------|
| W3-D1~D2 | M4-I-03 L3 Tool Allowlist | M4 | M4-D-01 |
| W3-D1~D2 | M4-I-04 L4 Output Validator | M4 | M4-D-01 |
| W3-D1~D2 | M3-I-03 Context Editor | M3 | M3-D-01, M5-I-01 |
| W3-D1~D2 | M2-I-01 MCP Stateless | M2 | M2-D-01, M5-I-01 |
| W3-D3~D4 | M4-I-05 L5 Action Confirm | M4 | M4-D-01 |
| W3-D3~D4 | M4-I-06 L6 Cost Ceiling | M4 | M4-D-01, M5-I-02 |
| W3-D3~D4 | M3-I-04 Context Layer Manager 升级 | M3 | M3-I-01 |
| W3-D3~D4 | M2-I-02 MCP Apps Manifest | M2 | M2-D-01 |
| W3-D5 | M2-I-03 OAuth Flow | M2 | M2-D-01 |

### Week 4（M4/M3 完成 + M2/M1 启动）

| 周 | 任务 | 负责模块 | 依赖 |
|----|------|---------|------|
| W4-D1~D2 | M4-I-07 Guardrails Orchestrator | M4 | M4-I-01~06 |
| W4-D1~D2 | M3-I-05 Context Cache | M3 | M3-I-01, M5-I-02 |
| W4-D1~D2 | M2-I-04 Tool Result Elision | M2 | M2-D-01, M3-I-03 |
| W4-D1~D2 | M2-I-05 Tool Sandbox | M2 | M2-D-01, M4-I-03 |
| W4-D1~D2 | M1-I-01 A2A 数据模型 | M1 | M1-D-01 |
| W4-D3~D4 | M4-I-08 Guardrails Web UI | M4 | M4-I-07 |
| W4-D3~D4 | M3-I-06 Context PreFlect 集成 | M3 | M3-I-01 |
| W4-D3~D4 | M2-I-06 EMA 企业网关 | M2 | M2-I-01~05 |
| W4-D3~D4 | M1-I-02 Agent Card Builder | M1 | M1-I-01 |
| W4-D5 | M4-T-01 M4 测试 | M4 | M4-I-01~08 |
| W4-D5 | M3-I-07 Loop 集成 | M3 | M3-I-01~03 |
| W4-D5 | M2-I-07 MCP 工具自动注册 | M2 | M2-I-02 |

### Week 5（M2/M1 并行）

| 周 | 任务 | 负责模块 | 依赖 |
|----|------|---------|------|
| W5-D1~D2 | M3-T-01 M3 测试 | M3 | M3-I-01~07 |
| W5-D1~D2 | M2-T-01 M2 测试 | M2 | M2-I-01~07 |
| W5-D1~D2 | M1-I-03 A2A Server | M1 | M1-I-01~02, M5-I-01 |
| W5-D3~D4 | M1-I-04 A2A Client | M1 | M1-I-01 |
| W5-D3~D4 | M1-I-05 Agent Directory | M1 | M1-I-02 |
| W5-D3~D4 | M1-I-06 A2A 鉴权 | M1 | M1-D-01 |
| W5-D5 | M5-I-06 Eval-gated Deploy | M5 | M5-I-01 |
| W5-D5 | M5-I-07 Helm UI Trace View | M5 | M5-I-04 |

### Week 6（M1 完成 + 集成启动）

| 周 | 任务 | 负责模块 | 依赖 |
|----|------|---------|------|
| W6-D1~D2 | M1-I-07 SSE 流式响应 | M1 | M1-I-03 |
| W6-D1~D2 | M1-I-08 A2A Web UI | M1 | M1-I-03~05 |
| W6-D1~D2 | M1-I-09 Push Notifications | M1 | M1-I-03 |
| W6-D3~D4 | M1-I-10 跨实例联邦 | M1 | M1-I-05, M1-I-06 |
| W6-D3~D4 | INT-I-01 M5+M4 集成 | INT | M5-I-01, M4-I-07 |
| W6-D3~D4 | INT-I-02 M3+M2 集成 | INT | M3-I-03, M2-I-04 |
| W6-D5 | M1-T-01 M1 测试 | M1 | M1-I-01~10 |
| W6-D5 | M5-T-01 M5 测试 | M5 | M5-I-01~07 |

### Week 7（全链路联调）

| 周 | 任务 | 负责模块 | 依赖 |
|----|------|---------|------|
| W7-D1~D3 | INT-I-03 全链路联调 | INT | M1~M5 全部 |
| W7-D4~D5 | INT-I-04 性能 SLO 验证 | INT | INT-I-03 |

### Week 8（P0 验收 + 文档完善）

| 周 | 任务 | 负责模块 | 依赖 |
|----|------|---------|------|
| W8-D1~D3 | INT-T-01 T10-T13 全量测试 | INT | INT-I-03, INT-I-04 |
| W8-D4~D5 | P0 模块验收（M1-M5） | ALL | INT-T-01 |
| W8-D5 | 文档完善 + 用户审核材料准备 | ALL | P0 验收 |
| W8-D5 | Phase 6.0 GA 里程碑评审 | ALL | 文档完善 |

---

## 第十一章：P1/P2 任务概览（简略）

### P1 任务概览（Phase 6.1）

| 模块 | 关键任务 | 工作量 |
|------|---------|--------|
| M6 评估框架 | τ-bench 集成 + SWE-bench Pro + 在线评估 | 15d |
| M7 Durable+长程 | Durable Event Log + Saga + 30h 长程 | 18d |
| M8 自我纠错 2.0 | PreFlect + VIGIL + SAGE | 12d |
| M9 Prompt Caching | Cache + Cost-Aware Routing + 配额池 | 10d |
| M10 生产化部署 | 灰度+A/B+Eval-gated+自动回滚 | 12d |
| M11 HITL 2.0 | IETF CHEQ + 三段式 + DevForge IPD 对接 | 10d |
| M15 故障恢复 | Self-healing + 降级链路 + Bulkhead | 10d |
| T14 测试 | Eval-gated 测试 | 2d |

### P2 任务概览（Phase 6.2）

| 模块 | 关键任务 | 工作量 |
|------|---------|--------|
| M12 Agent 治理 | AgentBOM + Blast-radius + 治理即代码 | 12d |
| M13 Computer Use | Visual Grounding + GUI Agent | 15d |
| M14 三层协议栈 | ACP + 协议适配器 + 网关 | 10d |
| M16 多租户 | Tenant 隔离 + 配额 + 计费 | 15d |
| M17 Skill 市场 | 市场平台 + 打包 + 沙箱 + 分发 | 12d |
| T15 测试 | AgentBOM 完整性测试 | 2d |

---

## 第十二章：风险管理

### 12.1 P0 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| A2A Spec 变化 | 中 | 高 | 适配层 + 跟踪 Linux Foundation |
| MCP 2026 RC 延迟 | 中 | 中 | Feature Flag 兼容旧版 |
| OTel GenAI 兼容性 | 低 | 中 | Exporter 多版本 |
| Guardrails 误杀 | 中 | 中 | 策略可调 + 白名单 |
| JIT Context 质量下降 | 中 | 高 | T7 审核通过率监控 |
| 性能 SLO 不达标 | 中 | 高 | 性能基准 + 持续优化 |

### 12.2 应急预案

- A2A Spec 变化 → 适配层 1 周内调整
- MCP RC 延迟 → Feature Flag 回退旧版
- 性能不达标 → 降级为非 JIT 模式
- Guardrails 误杀 → 策略调优 + 白名单

---

## 第十三章：验收标准

### 13.1 P0 模块验收

| 模块 | 验收标准 |
|------|---------|
| M1 A2A | T11 通过 + Agent Card/Task/SSE 标准 |
| M2 MCP | Stateless 重启不中断 + OAuth Flow + Sandbox |
| M3 Context | JIT Token 下降 ≥ 40% + Memory Tool 4 API |
| M4 Guardrails | T13 通过 + 六层闭环 + Injection 检出 ≥ 95% |
| M5 OTel | T10 通过 + gen_ai.* Span + Trace 端到端 |

### 13.2 整体验收

- T10-T13 全部通过
- 性能 SLO 全部达标
- 安全红线 16-20 遵守
- 端到端联调通过

---

## 第十四章：附录

### 14.1 任务统计

| 阶段 | 任务数 | 工作量（人日） |
|------|--------|--------------|
| P0 设计（M1-M5） | 5 | 5 |
| P0 实现（M1-M5） | 41 | 67 |
| P0 测试（M1-M5） | 5 | 8 |
| 集成联调 | 7 | 14 |
| **P0 合计** | **53** | **86** |
| P1 | ~55 | ~102 |
| P2 | ~30 | ~66 |

### 14.2 关联文档

- `spec_face.md`（需求规格）
- `arch_face.md`（架构详设）
- `face.md`（六厂面试原始信息）
- `flowforge/docs/spec.md` v2.1
- `flowforge/docs/arch.md`
- `hiclaw/rules.md`
- `hiclaw/prompts.md`

### 14.3 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v3.0-face-draft | 2026-07-14 | 初稿，含 12 项决策表 + P0 详细任务 |
| v3.0-face | 2026-07-15 | 恢复为原始 8 周排期与原始依赖分析；新增 v7.0 灵智养成体系融合说明（指向 spec.md 第七章） |

---

> **本文档为 FlowForge v3.0 任务清单，待用户审核决策后执行。**
> **请先审核第一章 12 项决策对比分析表，标注"同意/调整"。**
> **审核通过后按 Week 1-8 排期启动 P0 实施。**
