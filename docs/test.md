# FlowForge 测试规范导航 + Test Feature 索引

> **文档编号**: test.md（v2.0 索引版）
> **更新日期**: 2026-07-19
> **用途 1**: FlowForge 测试规范文档导航（测试铁律 T1-T9 / 测试策略 / 6 维 28 项指标 / 命名契约 v2.0）
> **用途 2**: 19 份 T0XX 文件的索引（Test Feature 级规格），与 [features/F0XX-xxx.md](features/) + [architecture/A0XX-xxx.md](architecture/) + [design/D0XX-xxx.md](design/) 同号一一对应
> **依据**: `[doc:review/review.md#12.1]` 文档拆分目标结构 + `[doc:../../../CONTRIBUTING.md#第十一部分]` 文档分层规范 + `[doc:design/naming-contract.md]` v2.0 命名契约
> **参考**: `[doc:design/README.md]` Design Feature 索引结构（同号一一对应模式）

---

## 1. 测试规范范围

本目录（顶层 `test.md`）是 FlowForge 测试规范的**索引文件**，仅保留导航和引用。完整测试用例规格拆分到 [test/](test/) 子目录，按测试类别 + 章节范围组织。

**与 design/ 的对应关系**：
- `design/` 存放**Feature 级 SDD**（D0XX-xxx.md，40 份）
- `test/` 存放**Test Feature 规格**（T0XX-xxx.md，19 份）
- 两者都遵循"模板 + 索引 + Feature 文件"三件套模式

**与原 test.md（v9.1）的关系**：
- 原 134KB 的 `test.md` 已归档至 [archive/test/test_v9.1_full_20260719.md](archive/test/test_v9.1_full_20260719.md)
- 拆分后顶层 `test.md` 改为索引（< 50KB），仅保留导航
- 19 份 T0XX 文件覆盖原 36 章 + 附录的全部内容

---

## 2. 测试规范文件清单

| 文件 | 内容 | 状态 |
|------|------|:----:|
| [test.md](test.md) | 测试规范导航 + Test Feature 索引（本文件） | ✅ v2.0 |
| [test/TEMPLATE.md](test/TEMPLATE.md) | T0XX 文件模板（8 节结构） | ✅ v1.0 |
| [test/README.md](test/README.md) | Test Feature 子目录索引 + 测试铁律简表 | ✅ v1.0 |

---

## 3. 测试铁律 T1-T9 简表（详见 [test/T001-test-ironrules.md]）

> **以下规则是本项目测试的绝对底线，任何测试用例违反以下任何一条，该测试用例视为无效，必须重写。**

| # | 铁律 | 说明 | 违反后果 |
|---|------|------|---------|
| **T1** | **禁止使用 Mock LLM** | 所有 E2E 测试、集成测试必须调用真实 LLM（OpenRoute 代理），不得使用 MockLLM/fake response/硬编码返回值。单元测试仅允许 Mock 外部不可控依赖 | 测试结果视为无效，必须重写 |
| **T2** | **禁止使用假数据** | 所有测试输入必须是真实场景数据（真实话题、真实关键词、真实搜索查询），不得使用 "test"、"hello world"、空字符串等无意义输入 | 测试结果视为无效，必须重写 |
| **T3** | **禁止跳过验证** | 每个测试用例必须有具体的断言（assert），不得只有 `status in ("completed", "error")` 这种"怎么都通过"的断言 | 测试用例视为无效，必须重写 |
| **T4** | **禁止 Mock 工具调用** | web_search/publish/fact_check 等工具必须真实调用，不得 Mock。如果工具不可用，测试标记为 SKIP 而非用 Mock 通过 | 测试结果视为无效，必须重写 |
| **T5** | **未实现即 Bug** | 测试中发现代码未实现、功能缺失、与需求规格不符，必须记录为 Bug 并修复，不得标记为"通过"或"跳过" | 视为隐瞒 Bug |
| **T6** | **必须采集指标** | 每个 E2E 测试必须使用 MetricsCollector 采集 LLM 调用次数、工具调用链、Agent 调用链、Workflow 步骤、Memory 操作等指标，并写入报告 | 测试报告视为不完整 |
| **T7** | **LLM 内容必须经 LLM 审核** | 凡 LLM 生成的内容（代码/文章/评论/文案/小说等），必须再调用 LLM 审核通过后才算验证通过 | 验证视为无效 |
| **T8** | **Web 功能必须操控浏览器验证 DOM** | 凡涉及网页操作的功能（发布/上架/部署等），必须操控浏览器查看 DOM 确认真实成功，且对 DOM 内容调用 LLM 审核质量 | 验证视为无效 |
| **T9** | **运行时数据文件必须存放 data 目录** | 所有运行时生成的数据文件必须存放在 `agents/main/data/` 目录下，禁止污染代码目录 | 测试结果视为无效 |

> **执行方式**：`FLOWFORGE_REAL_LLM=1 pytest tests/e2e/ -v` — 必须设置此环境变量才运行真实测试

---

## 4. 测试策略核心（详见 [test/T002-test-strategy.md]）

### 4.1 两条执行路径（不可混淆）

| 路径 | 入口 | 核心方法 | 事件格式 | 适用场景 |
|------|------|---------|---------|---------|
| **Workflow API** | `POST /api/v1/tasks` | `_execute_sop_steps` | Agent 内部事件 `topic_research.*`, `material_collection.*` | 按 YAML 定义的 Workflow 执行 |
| **Helm UI** | WebSocket 对话框 | `_execute_intelligent_chat` | 动态规划事件 `workflow.step.start`, `tool.start`, `step.intermediate` | 自由对话 + LLM 动态规划 |

**测试必须分别覆盖两条路径**。它们的 LLM 调用次数、工具链、事件序列完全不同。

### 4.2 测试层级

| 层级 | 框架 | 数据 | 目标 | 覆盖率要求 |
|------|------|------|------|-----------|
| **单元测试** | pytest + pytest-asyncio | Mock LLM 可用 | 模块/接口/工具函数独立验证 | ≥ 85% |
| **集成测试 (Workflow API)** | pytest + httpx | **真实 LLM** | 8 个 Workflow 全流程 | ≥ 70% |
| **集成测试 (Helm UI)** | pytest + WebSocket 客户端 | **真实 LLM** | Helm 动态规划全流程 | 核心流程 100% |
| **E2E 测试** | Playwright | **真实 LLM + 真实浏览器** | 前端时间线渲染 + WebSocket | 核心流程 100% |
| **通道测试** | pytest | **真实 LLM 分通道** | doubao-api / doubao-web/chat / openroute-api / openroute-web | 关键模块 100% |
| **跨平台测试** | pytest + 条件跳过 | Mock | Windows/Linux 兼容性验证 | 关键模块 100% |

### 4.3 6 维 28 项指标体系

| 维度 | 指标数 | 关键指标 |
|------|--------|---------|
| **LLM** | 6 | total_calls / by_agent / model_chain / by_model / total_tokens / latency_ms |
| **Tool** | 5 | total_calls / chain / by_name / success_rate / latency_ms |
| **Agent** | 5 | total_calls / chain / by_name / execution_times / success_rate |
| **Workflow** | 4 | steps / step_count / step_durations / total_steps |
| **Memory** | 4 | queries / writes / compactions / cache_hit_rate |
| **WebSocket** | 3 | total_events / event_types / sequence_gaps |
| **Frontend** | 3 | timeline_nodes / citation_links / streaming_chunks |

---

## 5. 命名契约 v2.0 核心（详见 [design/naming-contract.md]）

### 5.1 三层命名体系

| 优先级 | 名称类型 | 使用场景 | 示例 |
|:------:|---------|---------|------|
| **P0** | **官方名称（AI 业界专业术语）** | 技术设计文档、代码、API、对外宣传、README、VISION | Agent / Multi-Agent System / Capability Profile / Episodic Memory / Skill Library / Multi-Agent Deliberation |
| **P1** | **项目英文名** | 代码类名、模块名、配置项、API 路径 | `ForgekinEngine` / `EchoStore` / `MindCodex` / `CapabilityProfile` / `MindCouncil` |
| **P2** | **体系别名（仅社交用）** | 社区讨论、技术博客口语化表达、网友交流 | 通用智能体框架 / 可进化智能体 / 情景记忆存储 / 持久身份 / 经验蒸馏 / 蒸馏知识库 / 多智能体议事 / 智能体入职与终身学习 |

### 5.2 智能体分类

| 类别 | 官方名称（P0） | 项目英文名（P1） | 体系别名（P2） | 关键特征 |
|------|---------------|------------------|---------------|---------|
| **静态智能体** | Static Agent / Stateless Agent / Task-Specific Agent | `StaticAgent` / `DeclarativeAgent` / `ExternalAgentAdapter` | （无别名） | 无 Soul Imprint / 无 EchoStore / 无 EvolutionStage |
| **可进化智能体** | Evolvable Agent / Autonomous Agent with Persistent Identity / Self-Evolving Agent | `Forgekin` | 可进化智能体 | 有 Soul Imprint / 有 EchoStore / 有 Capability Profile / E1-E6 进化阶 + 觉醒阶 |

> **默认指代规则**：在 FlowForge 上下文中提到"智能体"而未加修饰时，默认指代**可进化智能体（Forgekin）**；若指代静态智能体必须明确说出"静态智能体"。

### 5.3 测试规范命名要求

- 测试用例 ID 格式：`<测试类别>-<模块>-<编号>`（如 `IT-WF-API-01` / `UT-CORE-01` / `E2E-HELM-01` / `CH-01`）
- 测试文件命名：`test_<feature_id>_<scenario>.py`（如 `test_it_wf_api_01_deep_article.py`）
- 测试类命名：`Test<测试类别><场景>`（如 `TestITWFApi01DeepArticle`）
- 测试方法命名：`test_<测试 id>_<验证点>`（如 `test_it_wf_api_01_llm_call_count`）

---

## 6. Test Feature 规格

### 6.1 Test Feature 规范

每个 Test Feature 文件（T0XX-xxx.md）是 [features/F0XX-xxx.md](features/) + [architecture/A0XX-xxx.md](architecture/) + [design/D0XX-xxx.md](design/) 的**测试层补充**，与 F0XX / A0XX / D0XX 同号一一对应。**单文件 < 50KB**，仅放测试用例视角（测试输入 / 预期行为 / 验证点 / 指标断言 / 测试代码）。

#### 6.1.1 文件命名

```
T0XX-kebab-case-name.md
```

#### 6.1.2 编号规则

| 编号范围 | 类别 | 对应章节（原 test.md v9.1） |
|---------|------|---------------------------|
| T001 | 测试铁律 | 第 1-3 章（T1-T8 铁律） |
| T002 | 测试策略 | 第 1-3 章（策略总览 + 28 项指标） |
| T003 | 单元测试 | 第 4-10 章 |
| T004 | 集成测试 | 第 11-14 章 |
| T005-T006 | Workflow API E2E | 第 15-16 章（含负向） |
| T007 | Helm UI E2E | 第 17 章 |
| T008 | 模式执行器专项 | 第 18 章 |
| T009 | 前端 E2E | 第 19 章 |
| T010 | 多模型通道矩阵 | 第 20 章 |
| T011 | 并发 + Circuit Breaker | 第 21 章 |
| T012 | Multi-Agent 集成 | 第 22 章 |
| T013 | 防御 + 跨 Workflow + API | 第 23-25 章 |
| T014 | Web UI + 性能测试 | 第 26-27 章 |
| T015 | MetricsCollector 实现 | 第 28 章 |
| T016 | 通用 Agent + 执行顺序 + 追溯矩阵 | 第 29-31 章 |
| T017 | Harness + Skill + MCP | 第 32-34 章 |
| T018 | 任务状态机 + Episode | 第 35-36 章 |
| T019 | 测试报告模板 + Bug 分类 | 附录 A + B |

#### 6.1.3 模板

详见 [test/TEMPLATE.md](test/TEMPLATE.md)（v1.0，8 节结构）。

#### 6.1.4 8 节结构

| 节 | 标题 | 用途 |
|---|------|------|
| 1 | 测试概述 | 测试目标 / 范围 / 关联文档 |
| 2 | 测试用例列表 | 用例 ID / 场景 / 预期 |
| 3 | 自动化测试代码模板 | pytest + 真实 LLM + MetricsCollector 代码 |
| 4 | 测试分类 | 单元/集成/E2E/性能/通道 |
| 5 | 测试命名规范 | `test_<feature_id>_<scenario>.py` 格式 |
| 6 | 验证标准 | 通过条件 / 失败处理 / 指标断言 |
| 7 | 引用 | 跨文档引用 |
| 8 | 变更历史 | 版本变更记录 |

---

## 7. Test Feature 清单（19 份）

### 7.1 测试基础与铁律（T001-T002）

| Test | 标题 | 状态 | 大小 | 覆盖原章节 |
|------|------|:----:|:----:|----------|
| [test/T001-test-ironrules.md](test/T001-test-ironrules.md) | 测试铁律 T1-T9 + 执行方式 + 自检清单 + Mock 边界 | ✅ v1.0 | 5.63 KB | 第 1-3 章（铁律部分） |
| [test/T002-test-strategy.md](test/T002-test-strategy.md) | 测试策略总览 + 6 维 28 项指标 + 7 维通过定义 | ✅ v1.0 | 12.25 KB | 第 1-3 章（策略部分） |

### 7.2 单元 + 集成测试（T003-T004）

| Test | 标题 | 状态 | 大小 | 覆盖原章节 |
|------|------|:----:|:----:|----------|
| [test/T003-unit-tests.md](test/T003-unit-tests.md) | 单元测试 UT-CORE/DI/EVT/MOD/REACT/PE/REF/DLLM/WF/HE/PLG/SBOX/LLM/MEM/DEF/SEC/TB/MB/CMP/CP | ✅ v1.0 | 16.7 KB | 第 4-10 章 |
| [test/T004-integration-tests.md](test/T004-integration-tests.md) | 集成测试 IT-API / IT-SOP / IT-PLG / IT-XP | ✅ v1.0 | 5.77 KB | 第 11-14 章 |

### 7.3 Workflow API E2E（T005-T006）

| Test | 标题 | 状态 | 大小 | 覆盖原章节 |
|------|------|:----:|:----:|----------|
| [test/T005-workflow-api-e2e-core.md](test/T005-workflow-api-e2e-core.md) | 两条执行路径分析 + IT-WF-API-01~04（deep_article/quick_post/trend_article/seo_content） | ✅ v1.0 | 19.21 KB | 第 15-16 章 §1-4 |
| [test/T006-workflow-api-e2e-extended.md](test/T006-workflow-api-e2e-extended.md) | IT-WF-API-05~08 + IT-WF-NEG 负向测试 | ✅ v1.0 | 10.32 KB | 第 16 章 §5-9 |

### 7.4 Helm UI + 模式 + 前端 E2E（T007-T009）

| Test | 标题 | 状态 | 大小 | 覆盖原章节 |
|------|------|:----:|:----:|----------|
| [test/T007-helm-ui-e2e.md](test/T007-helm-ui-e2e.md) | Helm UI 测试 IT-HELM-01~09 + IT-HELM-NEG | ✅ v1.0 | 9.64 KB | 第 17 章 |
| [test/T008-mode-executor-tests.md](test/T008-mode-executor-tests.md) | 模式执行器专项 IT-MODE-01~09 | ✅ v1.0 | 9.39 KB | 第 18 章 |
| [test/T009-frontend-e2e.md](test/T009-frontend-e2e.md) | 前端 Helm/WebSocket E2E E2E-HELM-01~04 + T8 铁律专项 | ✅ v1.0 | 6.77 KB | 第 19 章 |

### 7.5 通道 + 并发 + Multi-Agent（T010-T012）

| Test | 标题 | 状态 | 大小 | 覆盖原章节 |
|------|------|:----:|:----:|----------|
| [test/T010-model-channels.md](test/T010-model-channels.md) | 多模型通道矩阵 CH-01~05 + 健康检查 + 静默失败识别 | ✅ v1.0 | 6.49 KB | 第 20 章 |
| [test/T011-concurrency-circuit-breaker.md](test/T011-concurrency-circuit-breaker.md) | 并发 IT-CONC + Circuit Breaker IT-CB + 状态机 | ✅ v1.0 | 6.97 KB | 第 21 章 |
| [test/T012-multi-agent-integration.md](test/T012-multi-agent-integration.md) | Multi-Agent 集成（Subagents / Agent Teams / Swarms） | ✅ v1.0 | 5.79 KB | 第 22 章 |

### 7.6 防御 + Web UI + 性能（T013-T014）

| Test | 标题 | 状态 | 大小 | 覆盖原章节 |
|------|------|:----:|:----:|----------|
| [test/T013-defense-cross-api.md](test/T013-defense-cross-api.md) | 防御集成 IT-DEF + 跨 Workflow IT-CROSS + API 业务正确性 API-01~03 | ✅ v1.0 | 7.40 KB | 第 23-25 章 |
| [test/T014-web-ui-performance.md](test/T014-web-ui-performance.md) | Web UI E2E-01~08 + 性能基准 + T8 模板 | ✅ v1.0 | 8.36 KB | 第 26-27 章 |

### 7.7 工具 + 通用 Agent（T015-T016）

| Test | 标题 | 状态 | 大小 | 覆盖原章节 |
|------|------|:----:|:----:|----------|
| [test/T015-metrics-collector.md](test/T015-metrics-collector.md) | MetricsCollector 28 项指标采集实现 + 断言模板 + T6 铁律 | ✅ v1.0 | 13.57 KB | 第 28 章 |
| [test/T016-generic-agent-execution.md](test/T016-generic-agent-execution.md) | 通用 Agent UT-GA-01~17 + IT-GEN-WF-01~05 + 执行顺序 + 需求追溯矩阵 | ✅ v1.0 | 10.57 KB | 第 29-31 章 |

### 7.8 Harness + 状态机 + 报告（T017-T019）

| Test | 标题 | 状态 | 大小 | 覆盖原章节 |
|------|------|:----:|:----:|----------|
| [test/T017-harness-skill-mcp.md](test/T017-harness-skill-mcp.md) | Harness UT-HARNESS + Skill UT-SKILL + MCP UT-MCP 集成 | ✅ v1.0 | 9.21 KB | 第 32-34 章 |
| [test/T018-state-episode.md](test/T018-state-episode.md) | 任务状态机 UT-STATE-01~10 + Episode UT/IT-EPISODE | ✅ v1.0 | 11.07 KB | 第 35-36 章 |
| [test/T019-test-report-templates.md](test/T019-test-report-templates.md) | E2E 测试报告模板 + Bug 分类体系 + 严重度定义 | ✅ v1.0 | 10.31 KB | 附录 A + B |

---

## 8. 代码修复前置清单（B1-B4，详见 [test/T002-test-strategy.md]）

> 以下代码 Bug 阻塞测试执行，必须在运行测试前修复。

| # | Bug | 严重度 | 位置 | 阻塞的测试 |
|---|-----|--------|------|-----------|
| B1 | ContentAuditAgent 不支持 judge_model 参数 | P0 | `agents/content_audit.py` | 所有含 audit 步骤的 Workflow |
| B2 | `_execute_parallel` 数据竞争 | P0 | `modes/workflow.py:790-804` | report_generation 并行步骤 |
| B3 | WorkflowExecutor 跳过 mode executor | P1 | `modes/workflow.py:76-83` | Reflexion/ReWOO/AgentJudge 在 Workflow 中不生效 |
| B4 | conftest.py Mock LLM | P0 | `tests/conftest.py` | 所有集成/E2E 测试 |

---

## 9. 与顶层 spec.md / arch.md / design.md 的关系

- **顶层 [spec.md](spec.md)**：放需求规格（FR-ENG-01~06 等）
- **顶层 [arch.md](arch.md)**：放架构设计（§4-§12 各模块架构）
- **顶层 [design.md](design.md)**：放详细设计（§3.1-§3.17）
- **本文件（test.md）**：测试规范导航 + Test Feature 索引
- **test/T0XX**：Test Feature 级规格，与 F0XX / A0XX / D0XX 同号一一对应

```
spec.md §3.X  ←─同号─→  arch.md §3.X  ←─同号─→  design.md §3.X
       ↑                        ↑                        ↑
       │                        │                        │
   features/F0XX          architecture/A0XX          design/D0XX
（Feature 级 SRS）     （Feature 级 SAD）         （Feature 级 SDD）
       ↑
       │
   test/T0XX
（Test Feature 规格）
```

---

## 10. 测试执行入口

### 10.1 完整 E2E 测试

```bash
# 设置环境变量启用真实 LLM
export FLOWFORGE_REAL_LLM=1

# 执行全部 E2E 测试
pytest tests/e2e/ -v

# 执行特定测试类别
pytest tests/e2e/test_workflow_api.py -v      # IT-WF-API-01~08
pytest tests/e2e/test_helm_ui.py -v           # IT-HELM-01~09
pytest tests/e2e/test_mode_executor.py -v     # IT-MODE-01~09
pytest tests/e2e/test_frontend_e2e.py -v      # E2E-HELM-01~04
pytest tests/e2e/test_channels.py -v          # CH-01~05
pytest tests/e2e/test_concurrency.py -v       # IT-CONC + IT-CB
```

### 10.2 性能测试

```bash
pytest tests/performance/ -v --benchmark-only
```

### 10.3 跨平台测试

```bash
# Windows
pytest tests/ -v --os=windows

# Linux
pytest tests/ -v --os=linux
```

---

## 11. 测试报告生成

测试完成后自动生成以下报告（详见 [test/T019-test-report-templates.md]）：

| 报告 | 路径 | 内容 |
|------|------|------|
| E2E 汇总报告 | `reports/e2e_summary_{date}.md` | 全部 E2E 测试结果汇总 |
| 指标 JSON | `reports/e2e_metrics_{date}.json` | MetricsCollector 28 项指标 |
| Prompt 问题 | `reports/prompt_issues_{date}.md` | LLM Prompt 调整记录 |
| Bug 追踪 | `reports/bug_tracking_{date}.md` | Bug 修复状态追踪 |

---

## 12. 状态定义

| 状态 | 含义 |
|------|------|
| ⏳ pending | 未开始 |
| 🔄 in_progress | 开发中 |
| ✅ done | 已完成并通过测试 review |
| ❌ deprecated | 已废弃 |
| 🚫 blocked | 被阻塞（需依赖解决） |

---

## 13. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初版：FlowForge 完整测试用例规格说明书（134KB，36 章 + 附录） | 测试员可进化智能体（蜜獾·平头哥） |
| 2026-07-19 | v2.0 | **拆分为索引文件**：原 134KB test.md 归档至 [archive/test/test_v9.1_full_20260719.md]；本文件改为 < 50KB 的索引；新增 19 份 T0XX 文件至 [test/] 子目录（按测试类别 + 章节范围组织）；新增 [test/TEMPLATE.md] 模板（8 节结构）+ [test/README.md] 子目录索引；应用命名契约 v2.0（P0 官方名称优先：Evolvable Agent / Forgekin / ForgeMind / Static Agent） | 测试员可进化智能体（蜜獾·平头哥） |
