# FlowForge 测试规范导航 + 测试用例索引

> **文档编号**: test/README.md（v1.0）
> **更新日期**: 2026-07-19
> **用途 1**: FlowForge 测试规范文档导航（测试铁律 / 测试策略 / 指标体系 / 命名规范）
> **用途 2**: 17 份 T0XX 测试用例文件的索引，与 [features/F0XX-xxx.md](../features/) + [architecture/A0XX-xxx.md](../architecture/) + [design/D0XX-xxx.md](../design/) 同号一一对应
> **依据**: `[doc:test.md]` 顶层测试索引 + `[doc:rules.md#T1-T8]` 测试铁律 + `[doc:design/naming-contract.md]` v2.0 命名规范
> **参考**: `[doc:../design/README.md]` Design Feature 索引结构 + `[doc:../architecture/README.md]` Architecture Feature 索引结构

---

## 1. 测试规范范围

本目录存放 FlowForge 的测试规范文档与按测试类别拆分的测试用例规格文件。

**与顶层 test.md 的区别**：
- `test.md`（顶层）：测试规范总览 + 测试铁律 T1-T8 简要列表 + T0XX 文件索引（导航文件，< 50KB）
- `test/`（本目录）：完整测试规范 + 按测试类别拆分的测试用例规格（T0XX-xxx.md）
- `test/TEMPLATE.md`：测试用例文件模板（8 节结构）

---

## 2. 测试铁律 T1-T8（详见 [doc:rules.md#T1-T8]）

| # | 铁律 | 简述 | 违反后果 |
|---|------|------|---------|
| **T1** | 禁止使用 Mock LLM | 所有 E2E/集成测试必须调用真实 LLM | 测试结果视为无效，必须重写 |
| **T2** | 禁止使用假数据 | 测试输入必须是真实场景数据 | 测试结果视为无效，必须重写 |
| **T3** | 禁止跳过验证 | 必须有具体断言，禁止 `status in ("completed","error")` | 测试用例视为无效，必须重写 |
| **T4** | 禁止 Mock 工具调用 | web_search/publish/fact_check 等必须真实调用 | 测试结果视为无效，必须重写 |
| **T5** | 未实现即 Bug | 发现代码未实现必须记录为 Bug 并修复 | 视为隐瞒 Bug |
| **T6** | 必须采集指标 | E2E 测试必须用 MetricsCollector 采集 28 项指标 | 测试报告视为不完整 |
| **T7** | LLM 内容必须经 LLM 审核 | LLM 生成内容必须再调用 LLM 审核通过 | 验证视为无效 |
| **T8** | Web 功能必须操控浏览器验证 DOM | Web 功能必须用浏览器查看 DOM + LLM 审核 DOM 内容 | 验证视为无效 |

> **执行方式**：`FLOWFORGE_REAL_LLM=1 pytest tests/e2e/ -v` — 必须设置此环境变量才运行真实测试

---

## 3. 测试规范文件清单

| 文件 | 内容 | 状态 |
|------|------|:----:|
| [README.md](README.md) | 测试规范导航 + 测试用例索引（本文件） | ✅ v1.0 |
| [TEMPLATE.md](TEMPLATE.md) | T0XX 文件模板（8 节结构） | ✅ v1.0 |

---

## 4. 测试用例文件清单（按测试类别 + T0XX 编号排序）

### 4.1 测试基础与策略（T001-T002）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T001-test-ironrules.md](T001-test-ironrules.md) | 测试铁律 T1-T8 + 执行方式 | ✅ | 铁律章 | 通用 |
| [T002-test-strategy.md](T002-test-strategy.md) | 测试策略总览 + 6 维指标体系 + 7 维通过定义 + 代码修复前置清单 | ✅ | 第一~三章 | 通用 |

### 4.2 单元测试（T003）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T003-unit-tests.md](T003-unit-tests.md) | 单元测试（核心接口 / DI / EventBus / 模式执行器 / Workflow / 插件 / 沙箱 / LLM / Memory / 防御 / 安全 / 协作） | ✅ | 第四~十章 | 单元测试 |

### 4.3 集成测试（T004）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T004-integration-tests.md](T004-integration-tests.md) | 集成测试（API 端点 / SOP 流程 / 插件集成 / 跨平台） | ✅ | 第十一~十四章 | 集成测试 |

### 4.4 Workflow API 路径 E2E（T005-T006）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T005-workflow-api-e2e-core.md](T005-workflow-api-e2e-core.md) | Workflow API 路径分析 + IT-WF-API-01~04（deep_article / quick_post / trend_article / seo_content） | ✅ | 第十五~十六章 §1-4 | E2E |
| [T006-workflow-api-e2e-extended.md](T006-workflow-api-e2e-extended.md) | IT-WF-API-05~08 + 负向测试（report_generation / multilingual / multi_platform / image_article + IT-WF-NEG） | ✅ | 第十六章 §5-9 | E2E |

### 4.5 Helm UI 路径 E2E（T007）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T007-helm-ui-e2e.md](T007-helm-ui-e2e.md) | Helm UI 路径测试（IT-HELM-01~09 + IT-HELM-NEG，按意图类型设计） | ✅ | 第十七章 | E2E |

### 4.6 模式执行器专项 + 前端 E2E + 多模型通道（T008-T010）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T008-mode-executor-tests.md](T008-mode-executor-tests.md) | 模式执行器专项测试（ReAct / Reflexion / Agent-as-Judge / Code / Subagents / ReWOO / SelfDiscover / GraphOfThoughts / on_error） | ✅ | 第十八章 | 集成测试 |
| [T009-frontend-e2e.md](T009-frontend-e2e.md) | 前端 Helm/WebSocket E2E 测试（ReAct / Workflow / 断线重连 / 审核交互） | ✅ | 第十九章 | E2E |
| [T010-model-channels.md](T010-model-channels.md) | 多模型通道矩阵（CH-01~05：openroute-api / doubao-web / arkcode） | ✅ | 第二十章 | 通道测试 |

### 4.7 并发 + Multi-Agent + 防御 + 跨 Workflow + API 业务（T011-T013）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T011-concurrency-circuit-breaker.md](T011-concurrency-circuit-breaker.md) | 并发 + Circuit Breaker 测试（IT-CONC / IT-CB） | ✅ | 第二十一章 | 集成测试 |
| [T012-multi-agent-integration.md](T012-multi-agent-integration.md) | Multi-Agent 集成测试（Subagents / Agent Teams / Swarms） | ✅ | 第二十二章 | 集成测试 |
| [T013-defense-cross-api.md](T013-defense-cross-api.md) | 防御集成 + 跨 Workflow 组合 + API 业务正确性 | ✅ | 第二十三~二十五章 | 集成测试 |

### 4.8 Web UI + 性能 + 指标采集（T014-T015）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T014-web-ui-performance.md](T014-web-ui-performance.md) | E2E Web UI 测试 + 性能测试基准 + 覆盖率目标 | ✅ | 第二十六~二十七章 | E2E + 性能 |
| [T015-metrics-collector.md](T015-metrics-collector.md) | MetricsCollector 可执行实现（28 项指标采集 + pytest 集成 + 断言模板） | ✅ | 第二十八章 | 工具 |

### 4.9 通用 Agent + 执行顺序 + 追溯矩阵（T016）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T016-generic-agent-execution.md](T016-generic-agent-execution.md) | 通用 Agent + 通用 Workflow 测试 + 测试执行顺序 + 需求追溯矩阵 | ✅ | 第二十九~三十一章 | 通用 |

### 4.10 v6.0 模块测试（T017-T019）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T017-harness-skill-mcp.md](T017-harness-skill-mcp.md) | Harness 驾驭层 + Skill 系统 + MCP 模块测试 | ✅ | 第三十二~三十四章 | 单元 + 集成 |
| [T018-state-episode.md](T018-state-episode.md) | 任务状态机 + 轨迹记录测试 | ✅ | 第三十五~三十六章 | 单元 + 集成 |

### 4.11 测试报告 + Bug 分类（T019）

| 文件 | 标题 | 状态 | 关联章节 | 测试类别 |
|------|------|:----:|---------|---------|
| [T019-test-report-templates.md](T019-test-report-templates.md) | 附录 A：E2E 测试报告模板 + 附录 B：架构问题 vs Bug 分类体系 | ✅ | 附录 A + B | 报告 |

---

## 5. 测试分类说明

| 类别 | 框架 | 数据 | 目标 | 覆盖率要求 | 对应 T0XX |
|------|------|------|------|-----------|-----------|
| **单元测试** | pytest + pytest-asyncio | Mock LLM 可用 | 模块/接口/工具函数独立验证 | ≥ 85% | T003 / T017 / T018 |
| **集成测试** | pytest + httpx | **真实 LLM** | 多模块协作全流程 | ≥ 70% | T004 / T008 / T011 / T012 / T013 |
| **E2E 测试** | Playwright + pytest | **真实 LLM + 真实浏览器** | 前端时间线渲染 + WebSocket | 核心流程 100% | T005 / T006 / T007 / T009 / T014 |
| **性能测试** | pytest + locust | **真实 LLM** | 延迟/吞吐量/并发 | 关键模块 100% | T014 |
| **通道测试** | pytest | **真实 LLM 分通道** | doubao-api / doubao-web/chat / openroute-api / openroute-web / arkcode | 关键模块 100% | T010 |

---

## 6. 测试命名规范（详见 [doc:design/naming-contract.md] v2.0）

### 6.1 文件命名

```
tests/<category>/test_<feature_id>_<scenario>.py
```

**示例**：
- `tests/unit/test_f001_capability_profile.py` — F001 能力画像单元测试
- `tests/integration/test_f002_teamact_loop.py` — F002 TeamAct 循环集成测试
- `tests/e2e/test_f008_durable_state.py` — F008 Durable State Surfaces E2E 测试

### 6.2 用例编号

| 编号前缀 | 测试类别 | 示例 |
|---------|---------|------|
| UT-XXX | 单元测试 | UT-CORE-01 / UT-DI-01 / UT-MOD-01 |
| IT-XXX | 集成测试 | IT-API-01 / IT-SOP-01 / IT-WF-API-01 |
| E2E-XXX | E2E 测试 | E2E-HELM-01 / E2E-01 |
| PERF-XXX | 性能测试 | PERF-01 |
| CH-XXX | 通道测试 | CH-01 |

### 6.3 文档命名

```
test/T0XX-kebab-case-name.md
```

**编号规则**：

| 编号范围 | 类别 | 关联章节 |
|---------|------|---------|
| T001-T002 | 测试基础与策略 | 铁律章 + 第一~三章 |
| T003 | 单元测试 | 第四~十章 |
| T004 | 集成测试 | 第十一~十四章 |
| T005-T006 | Workflow API 路径 E2E | 第十五~十六章 |
| T007 | Helm UI 路径 E2E | 第十七章 |
| T008-T010 | 模式专项 + 前端 E2E + 通道 | 第十八~二十章 |
| T011-T013 | 并发 + Multi-Agent + 防御 + 跨 Workflow + API | 第二十一~二十五章 |
| T014-T015 | Web UI + 性能 + 指标采集 | 第二十六~二十八章 |
| T016 | 通用 Agent + 执行顺序 + 追溯矩阵 | 第二十九~三十一章 |
| T017-T018 | v6.0 模块测试（Harness / Skill / MCP / 状态机 / 轨迹） | 第三十二~三十六章 |
| T019 | 测试报告 + Bug 分类 | 附录 A + B |

---

## 7. 与顶层 test.md 的关系

- **顶层 [test.md](../test.md)**：测试规范总览 + 测试铁律 T1-T8 简要列表 + T0XX 文件索引（< 50KB 导航文件）
- **本目录 T0XX**：完整测试用例规格，按测试类别拆分（每个文件 < 50KB）
- **跨文档引用**：T0XX 引用 F0XX（Feature 级 SRS）+ A0XX（Feature 级 SAD）+ D0XX（Feature 级 SDD）+ spec.md / arch.md / design.md §3.X

```
spec.md §3.X  ←─同号─→  arch.md §3.X  ←─同号─→  design.md §3.X
       ↑                        ↑                        ↑
       │                        │                        │
   features/F0XX          architecture/A0XX          design/D0XX
（Feature 级 SRS）     （Feature 级 SAD）         （Feature 级 SDD）
       ↑                        ↑                        ↑
       └────────────────────────┴────────────────────────┘
                                │
                            test/T0XX
                       （测试用例规格）
```

---

## 8. 状态定义

| 状态 | 含义 |
|------|------|
| ⏳ pending | 未开始 |
| 🔄 in_progress | 开发中 |
| ✅ done | 已完成并通过测试 review |
| ❌ deprecated | 已废弃 |
| 🚫 blocked | 被阻塞（需依赖解决） |

---

## 9. 引用

- [doc:test.md] — 顶层测试索引
- [doc:test/TEMPLATE.md] — 测试用例文件模板
- [doc:rules.md#T1-T8] — 测试铁律 T1-T8（详细定义）
- [doc:design/naming-contract.md] — 命名契约 v2.0（P0 官方名称优先）
- [doc:../spec.md] — 软件规格说明书
- [doc:../arch.md] — 架构设计文档
- [doc:../design.md] — 详细设计文档
- [doc:../features/F0XX-xxx.md] — Feature 级 SRS
- [doc:../architecture/A0XX-xxx.md] — Feature 级 SAD
- [doc:../design/D0XX-xxx.md] — Feature 级 SDD
- [doc:../../../hiclaw/rules.md#第十一部分] — 文档分层规范
- [doc:../../../hiclaw/prompts.md#P7] — 测试铁律自检（T1-T8）

---

## 10. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初版：测试规范导航 + 19 份 T0XX 文件索引（含 TEMPLATE.md）+ 测试铁律 T1-T8 + 命名规范 + 与顶层 test.md 关系图 | 测试员 Forgekin（蜜獾·平头哥） |
