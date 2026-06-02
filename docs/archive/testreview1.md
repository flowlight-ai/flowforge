# FlowForge test1.md 审核报告 + 三版本合并分析

> **审核日期**: 2026-05-24
> **审核对象**: `flowforge/docs/test1.md`（你基于我审核意见修订的版本）
> **对照参考**: `flowforge/docs/test.md`（v1.1 + v5.0 + v6.1 合并版）
> **审核角色**: 高级 AI Agent 测试工程师

---

## 一、test1.md 整体评价

### 1.1 优点

| 维度 | 评分 | 说明 |
|------|------|------|
| spec/arch 覆盖度 | **9/10** | 11 章需求追溯矩阵，每个 WF 用例标注了 spec.md/arch.md/design.md 出处 |
| 测试指标体系 | **9/10** | 6 大维度 25+ 指标项，LLM/Tool/Agent/Workflow/Memory/WebSocket/Frontend 全覆盖 |
| 用例设计完整性 | **8/10** | 每个 WF 用例包含输入数据、预期过程表、模型分配、通过条件、指标表、失败处理 |
| 通过条件明确性 | **8/10** | 每个用例 3~10 条明确的 PASS/FAIL 条件 |
| 前端 E2E 覆盖 | **7/10** | 4 个 Solo WebSocket 用例，含事件序列和 UI 交互验证 |
| 模型通道测试 | **8/10** | 4 通道矩阵 + Prompt 约束模板 + 通过/不通过处理 |

### 1.2 需要修正的问题

#### 问题 1: LLM 调用次数基于模式执行器假设（🔴 致命）

test1.md 中 Workflow 测试用例的 LLM 调用次数是基于"模式执行器在 Workflow 步骤中生效"的假设，但实际代码中 **WorkflowExecutor 在步骤有 agent 时跳过 mode executor，直接调用 agent.execute_with_context()**。详见 [testreview.md](file:///d:/software/openclaw/flowforge/docs/testreview.md) 根因 1。

| Workflow | test1.md 预期 LLM | 源码实际 LLM | 差异 |
|----------|-----------------|------------|------|
| deep_article (IT-WF-01) | ≥ 12 次 | **8~11 次** | topic_research 0~1(非 2~3), writing 1(非 1+N), fact_check 1(非 3~6) |
| quick_post (IT-WF-03) | ≥ 5 次 | **1~2 次** | topic_research 0~1(非 2~3), writing 1(非 1+N), publish 0(非 1) |
| trend_article (IT-WF-04) | ≥ 8 次 | **3~5 次** | writing 1(非 1+N) |

**影响**: 如果测试时发现 LLM 调用次数比预期少很多，测试报告可能误报 PASS（实际是 Workflow 路径不完整）。

#### 问题 2: writing 阶段 Reflexion 迭代预期不正确（🔴 致命）

test1.md 预期 `article_writing` 使用 `reflexion` 模式，含 Actor→Evaluator→Reflector 循环 (1+N 次 LLM)。但 Workflow API 路径中 ArticleWritingAgent.execute_with_context() 只做 **1 次 LLM 调用**，没有迭代。Reflexion 迭代仅在 **模式执行器直接模式** 下生效。

test1.md 的以下通过条件无法满足：
- "Reflexion 迭代 1~3 轮" ❌
- "最终 score ≥ 0.85" ❌ (不存在 Evaluator 评分)
- "三个角色使用独立 Agent" ❌

#### 问题 3: content_audit 独立 Judge 模型未实装（🔴 致命）

test1.md 正确要求 "content_audit 评审模型 ≠ article_writing 执行模型"，并指定了不同模型名。但当前 ContentAuditAgent 源码中两次 `llm.execute()` 使用相同的 persona，**不支持指定 judge_model**。这是需要代码修复的前置条件。

#### 问题 4: Reflexion 不收敛测试预期过高（🟡 严重）

IT-MODE-02（Reflexion 不收敛处理）通过条件 3 要求 "三个角色必须使用独立的 Agent"。但 DefaultLLMActor/DefaultLLMEvaluator 都使用同一个 LLM Tool，不满足 "独立 Agent" 的定义。建议改为验证 "三种 prompt 不同"。

#### 问题 5: 缺少"两条执行路径"区分（🟡 中等）

test1.md 将 Workflow API 的预期事件格式（如 `solo.stage.enter`、`solo.tool.start`）混用于 API 路径。实际代码中 **Workflow API 路径不发 Solo 事件**，它发的是 Agent 内部自定义事件（`topic_research.*`、`material_collection.*`）。Solo 事件仅在 WebSocket Solo UI 路径下发。

---

## 二、三版本对比分析

### 2.1 版本概览

| 版本 | 位置 | 行数 | 核心内容 |
|------|------|------|---------|
| **v1.1 + v5.0** | test.md L1-L525 | 525 | 单元测试(UT-CORE-01~UT-LLM-05)、集成测试(API/SOP/插件/跨平台)、E2E Web UI、性能、防御层、Multi-Agent(TaskBoard/Mailbox/Swarms)、压缩器、Checkpoint |
| **v6.0 (test1.md)** | test1.md 全文 | 915 | 8 WF E2E 含 spec/arch 引用、模式执行器专项、Solo WebSocket E2E、模型通道矩阵、并发/熔断、跨 WF、API 业务验证、需求追溯矩阵、6 维指标体系 |
| **v6.1** | test.md L527-L1411 | 885 | 两条执行路径分析、基于源码的 WF Agent 链路、Solo UI 路径、Playwright 断言代码、MetricsCollector 设计、"测试通过"定义、架构问题 |

### 2.2 各版本独有内容（互不覆盖）

| 独有内容 | v1.1+v5.0 | test1.md v6.0 | v6.1 |
|---------|:---:|:---:|:---:|
| 15+ 单元测试 (core/di/events/modes/sandbox/llm/memory) | ✅ | ❌ | ❌ |
| 27 个 API 集成测试 (含模型管理/插件/跨平台) | ✅ | 部分(3个) | ❌ |
| E2E Web UI 8 个场景 (仪表盘/审核/定时/插件管理) | ✅ | ❌ | ❌ |
| 性能测试基准 (延迟/并发/沙箱/插件加载) | ✅ | ❌ | ❌ |
| v5.0 防御层 (L1/L2/L3 三层测试) | ✅ | ❌ | ❌ |
| v5.0 安全工具注册表 (readonly/normal/dangerous) | ✅ | ❌ | ❌ |
| v5.0 TaskBoard + Mailbox + ContextCompressor | ✅ | ❌ | ❌ |
| v5.0 Multi-Agent 三策略 (Subagents/Teams/Swarms) | ✅ | ❌ | ❌ |
| v5.0 CheckpointManager 增强 (incremental/版本/清理) | ✅ | ❌ | ❌ |
| 8 WF 含 spec.md/arch.md/design.md 出处引用 | ❌ | ✅ | ❌ |
| 6 维 25+ 指标定义表 | ❌ | ✅ | ❌ |
| 每个 WF 的详细模型分配表 | ❌ | ✅ | ❌ |
| 每个 WF 的失败处理流程 | ❌ | ✅ | ❌ |
| 模式执行器专项 (ReAct/Reflexion/AgentJudge/coding/Subagents) | ❌ | ✅ | ❌ |
| 需求追溯矩阵 (测试用例↔规格↔架构↔设计↔缺陷) | ❌ | ✅ | ❌ |
| **两条执行路径分析 (API vs Solo)** | ❌ | ❌ | ✅ |
| **Agent 源码真实 LLM 调用次数** | ❌ | ❌ | ✅ |
| **Playwright 前端断言代码** | ❌ | ❌ | ✅ |
| **MetricsCollector 采集器设计** | ❌ | ❌ | ✅ |
| **"测试通过"7 维定义** | ❌ | ❌ | ✅ |
| **3 个架构问题 (mode 虚设/Judge 硬编码/不计 Reflexion)** | ❌ | ❌ | ✅ |

### 2.3 三版本 ID 冲突表

这些用例 ID 在三版本中含义不同，合并时必须统一：

| ID | v1.1+v5.0 含义 | test1.md 含义 | v6.1 含义 |
|----|--------------|-------------|---------|
| `IT-WF-API-01` | (不存在) | (不存在) | deep_article API 路径 |
| `IT-WF-01` | (不存在) | deep_article OpenRoute | (不存在) |
| `IT-SOLO-01` | (不存在) | (不存在) | deep_article Solo UI |
| `IT-CONC-01` | 并发 (imp) | 10 并发不同 persona | 不同 persona 并发 |
| `IT-CB-01` | (不存在) | 熔断触发 | 熔断触发 |
| `E2E-SOLO-01` | ReAct WebSocket | ReAct Solo E2E | (不存在) |
| `UT-DEF-01` | (v5.0) L1 超时 | (不存在) | (v6.1) L1 超时 |

---

## 三、遗漏项分析

### 3.1 test.md 当前合并版 vs 全部需求 — 遗漏清单

| 遗漏项 | 来源 | 严重度 | 说明 |
|--------|------|--------|------|
| 8 WF 含 spec/arch/design 出处引用 | test1.md | 🔴 高 | v1.1+v5.0 没有 Workflow E2E，v6.1 有但没有 spec 出处 |
| 6 维 25+ 指标定义表 | test1.md | 🔴 高 | v6.1 有 JSON 模板但缺完整的指标定义表 |
| 需求追溯矩阵 | test1.md | 🔴 高 | 唯一完整的追溯矩阵在 test1.md 中 |
| 每个 WF 的详细模型分配表 | test1.md | 🟡 中 | v6.1 有通道配置但缺分阶段模型分配 |
| 每个 WF 的失败处理流程 | test1.md | 🟡 中 | v6.1 没有写失败处理的 SOP |
| 模式执行器专项测试 | test1.md | 🟡 中 | v6.1 没有 IT-MODE-01~05 |
| API 业务正确性认证 (API-01~03) | test1.md | 🟡 中 | v1.1 有 27 个 API 集成测试但 test1.md 的业务验证更聚焦 |
| Spec/Arch 全覆盖 | test1.md | 🔴 高 | test1.md Chapter 11 是唯一的需求追溯矩阵 |
| 单元测试基准 | v1.1 | 🔴 高 | test1.md 没有单元测试覆盖（全部 E2E/集成） |
| v5.0 防御层 | v5.0 | 🟡 中 | test1.md 没有 L1/L2/L3 防御测试 |
| v5.0 Multi-Agent | v5.0 | 🟡 中 | test1.md 没有 TaskBoard/Mailbox/Swarms |
| Agent 源码修正 LLM 次数 | v6.1 | 🔴 高 | test1.md 的 LLM 次数偏高 |
| 两条执行路径区分 | v6.1 | 🟡 中 | test1.md 未区分 API 和 Solo 路径 |

### 3.2 test1.md 本身覆盖 spec.md 的评估

| spec.md 章节 | test1.md 覆盖 | 状态 |
|-------------|:---:|------|
| FR-CAP-01 模型通道 | CH-01~05 | ✅ 已覆盖 |
| FR-CAP-04 CodeWriterAgent | IT-MODE-04 | ✅ 已覆盖 |
| FR-CAP-06 Workflow #1~8 | IT-WF-01~09 | ✅ 已覆盖 |
| FR-ENG-01 Persona 锁 | IT-CONC-02 | ✅ 已覆盖 |
| FR-ENG-03 ReAct/Reflexion | IT-MODE-01/02 | ✅ 已覆盖 |
| FR-HRN-03 FeedbackLoop | IT-MODE-03 | ✅ 已覆盖 |
| FR-MAS-01 Subagents | IT-MODE-05 | ✅ 已覆盖 |
| FR-SOL-01~04 Solo UI | E2E-SOLO-01~04 | ✅ 已覆盖 |
| 4.1 性能要求 | IT-CONC-01 | ✅ 已覆盖 |
| 4.3 可靠性要求 | IT-CB-01/02 | ✅ 已覆盖 |
| **单元级别 (core/di/events/tools/memory)** | ❌ 未覆盖 | 🔴 缺失 |
| **v5.0 防御层 (L1/L2/L3)** | ❌ 未覆盖 | 🔴 缺失 |
| **v5.0 Multi-Agent (TaskBoard/Mailbox/Swarms)** | ❌ 未覆盖 | 🔴 缺失 |
| **E2E Web UI (仪表盘/审核/定时/插件管理)** | ❌ 未覆盖 | 🟡 缺失 |

---

## 四、三版本合并方案

### 4.1 最终 test.md 推荐结构

```
# FlowForge 完整测试用例规格说明书 (v7.0 合并版)

## 第一部分：测试基础与策略
  第〇章: 版本说明与合并清单
  第一章: 测试策略总览 (来源: v6.1)
  第二章: 6 维测试指标体系 (来源: test1.md 第二章)
  第三章: "测试通过"定义 + Mock 铁律 (来源: v6.1 1.3+1.4)

## 第二部分：单元测试 (来源: v1.1+v5.0)
  第四章: 核心接口 (UT-CORE-01~10)
  第五章: DI 容器 (UT-DI-01~05)
  第六章: EventBus + SoloAdapter (UT-EVT-01~08, UT-SOLO-01~04)
  第七章: ModeRegistry + 模式执行器 (UT-MOD-01~08, UT-REACT-01~05, UT-PE-01~03, UT-REF-01~05)
  第八章: WorkflowExecutor + HybridExecutor (UT-WF-01~08, UT-HE-01~03)
  第九章: 插件/沙箱/LLM/Memory (UT-PLG-01~07, UT-SBOX-01~08, UT-LLM-01~05, UT-MEM-01~06)
  第十章: v5.0 防御+安全+协作 (UT-DEF-01~05, UT-SEC-01~06, UT-TB-01~08, UT-MB-01~08, UT-CMP-01~05, UT-CP-01~08)

## 第三部分：集成测试 (来源: v1.1)
  第十一章: API 端点 (IT-API-01~27)
  第十二章: SOP 流程 (IT-SOP-01~07)
  第十三章: 插件系统 (IT-PLG-01~05)
  第十四章: 跨平台 (IT-XP-01~05)

## 第四部分：Workflow E2E (来源: test1.md + v6.1 修正)
  第十五章: 两条执行路径分析 (来源: v6.1 1.1)
  第十六章: 8 个 Workflow API 路径 (IT-WF-API-01~08，采用 v6.1 修正后的 LLM 次数 + test1.md 的模型分配表/失败处理/指标表)
  第十七章: 8 个 Workflow Solo UI 路径 (IT-SOLO-01~08, 采用 v6.1 Solo 事件序列)

## 第五部分：模式专项 + 前端 E2E (来源: test1.md + v6.1)
  第十八章: 模式执行器专项 (IT-MODE-01~05, 修正 Reflexion 独立 Agent 条件)
  第十九章: 前端 Solo/WebSocket E2E (E2E-SOLO-01~04 + v6.1 Playwright 断言代码)
  第二十章: 多模型通道矩阵 (CH-01~05 + v6.1 通道标准)

## 第六部分：并发 + 组合 + API 验证 (来源: test1.md + v5.0)
  第二十一章: 并发 + Circuit Breaker (IT-CONC-01~02 + IT-CB-01~02)
  第二十二章: v5.0 Multi-Agent 集成 (IT-MA-01~04, IT-AT-01~04, IT-SW-01~05)
  第二十三章: v5.0 防御集成 (IT-DEF-01~04)
  第二十四章: 跨 Workflow 组合 (IT-CROSS-01~02)
  第二十五章: API 业务正确性 (API-01~03)

## 第七部分：报告 + 工具 (来源: 各版本)
  第二十六章: E2E Web UI (E2E-01~08, 来源: v1.1)
  第二十七章: 性能测试基准 (来源: v1.1)
  第二十八章: MetricsCollector (来源: v6.1)
  第二十九章: 测试执行顺序 (来源: v6.1 + test1.md)
  第三十章: 需求追溯矩阵 (来源: test1.md)
  附录A: E2E 报告模板 (来源: v6.1)
  附录B: 架构问题清单 (来源: v6.1 + testreview.md)
```

### 4.2 test1.md 内容合并时需修正的关键项

| test1.md 原件 | 修正为 | 原因 |
|-------------|--------|------|
| IT-WF-01 topic_research LLM=2~3 | **0~1** | 降级链，前三步命中则不调 LLM |
| IT-WF-01 writing Reflexion 1+N(1~3) | **1** (无迭代) | Workflow API 路径不走 Reflexion |
| IT-WF-01 fact_check LLM=3~6 | **1** | url_check(httpx)→fact_verify(LLM×1) |
| IT-WF-01 总 LLM ≥ 12 | **8~11** | 各阶段修正后合计 |
| IT-WF-03 总 LLM ≥ 5 | **1~2** | quick_post 走 Agent 直达 |
| IT-WF-04 总 LLM ≥ 8 | **3~5** | writing 不迭代 |
| "Reflexion迭代次数 1~3" 通过条件 | Workflow API 路径不适用 | 仅在模式执行器直接模式下有效 |
| "三个角色使用独立 Agent" | "三个 Prompt 不同" (或先修复代码) | DefaultLLM 都用同一个 LLM Tool |
| Solo WebSocket 事件序列 | 标注 "仅 Solo UI 路径" | Workflow API 路径事件格式不同 |

### 4.3 不建议合并的内容

| 内容 | 理由 |
|------|------|
| test1.md IT-WF-02 与 v6.1 IT-SOLO-01 重复 | 保留 v6.1 IT-SOLO-01（含更完整的 WebSocket 事件序列） |
| test1.md E2E-SOLO-03 与 v6.1 E2E-WEB-02 重复 | 保留 v6.1（含 Playwright 断言代码） |

---

## 五、test1.md 专业审核评分

| 维度 | 评分 | 评语 |
|------|------|------|
| 覆盖率 (spec/arch 全功能) | 9/10 | 11 章需求追溯矩阵，覆盖 spec.md 大部分功能 |
| 指标体系 | 9/10 | 6 维 25+ 指标，业内领先 |
| 用例设计质量 | 8/10 | 输入→预期→条件→指标→失败处理，完整五段式 |
| 数据真实性 (真实 LLM) | 8/10 | 明确要求真实 LLM，有通道验证 |
| 模型通道覆盖 | 8/10 | API/网页版分开，有 Prompt 约束 |
| 前端覆盖 | 7/10 | 4 个 Solo 用例，但缺 Playwright 具体代码 |
| 预期过程准确性 | **4/10** | 🔴 LLM 次数基于模式执行器假设，与 Agent 源码不符 |
| 单元测试覆盖 | 0/10 | 🔴 无单元测试 |
| 防御/v5.0 特性覆盖 | 0/10 | 🔴 无 L1/L2/L3 防御/Multi-Agent 测试 |
| E2E Web UI 覆盖 | 3/10 | Solo 覆盖好但缺仪表盘/审核页面/定时任务 UI |
| **综合** | **6.5/10** | 集成/E2E 设计优秀但预期过程需修正，且缺单元测试 |

---

## 六、总结

### test1.md 的核心价值
test1.md 在 **spec/arch 功能覆盖度、指标体系、用例设计完整性、需求追溯矩阵** 四个维度上质量很高，远优于原始的 v1.1 测试设计。它是目前唯一将测试用例与 spec.md/arch.md/design.md/审视缺陷做完整追溯的文档。

### test1.md 需要修正的核心问题
1. **LLM 调用次数偏高** — 基于模式执行器假设，需修正为 Agent 源码实际值
2. **Reflexion 迭代在 Workflow API 路径不生效** — 通过条件需分路径标注
3. **content_audit 独立 Judge 模型需代码修复** — 测试前置条件

### 三版本合并建议
最终 test.md 应保留 **v1.1+v5.0 的单元测试基础 + test1.md 的完整 E2E 用例骨架 + v6.1 的 Agent 源码修正和两条路径分析**，按上述 4.1 节结构合并。

---

> **审核人**: AI 高级 Agent 测试工程师
> **审核日期**: 2026-05-24
> **核心结论**: test1.md 是三个版本中 spec/arch 覆盖最完整的版本（9/10），但预期 LLM 调用次数需基于 Agent 源码修正。三版本各有独有内容，互不覆盖，合并后才是完整的测试体系。