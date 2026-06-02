# FlowForge 完整测试用例规格说明书 (v8.0 审核修订版)

> **版本**: 8.0 | **日期**: 2026-05-24 | **状态**: 待评审
> **合并来源**: v7.0 合并版 + 6 份专家审核报告修订
> **核心变化**: 14 项审核修订（代码修复前置清单/Solo UI重写/FactCheck修正/MetricsCollector实现/调用路径验证/预期输出定义/Memory指标/模式执行器补全/通用Agent覆盖/架构vs Bug分类等）
> **审核来源**: testreview_deepseek.md / testreview_doubao.md / testreview_glm.md / testreview_kimi.md / testreview_m27.md / testreview_qwen.md
> **设计基础**: 逐文件审查 `flowforge/agents/*.py` + `flowforge/modes/*.py` + `flowforge/workflows/*.yaml`
> **重要发现**: WorkflowExecutor 在步骤有 agent 时跳过 mode executor 直接调用 agent.execute_with_context()

---

# 代码修复前置清单（测试前必须先修复）

> **来源**: 6 份审核报告共同发现的代码 Bug，不修复则相关测试无法通过

| # | Bug | 位置 | 修复方案 | 阻塞的测试 | 严重度 |
|---|-----|------|---------|-----------|--------|
| B1 | ContentAuditAgent不支持judge_model参数 | `content_audit.py` | Agent接收judge_model参数，LLM调用时传递model参数 | 所有含audit步骤的Workflow | P0 |
| B2 | _execute_parallel数据竞争 | `workflow.py:790-804` | 使用copy.deepcopy(context_data)为每个并行任务创建独立副本 | report_generation | P0 |
| B3 | WorkflowExecutor跳过mode executor | `workflow.py:76-83` | 增加选项：当步骤声明mode但无agent时使用mode executor | Reflexion/ReWOO/AgentJudge在Workflow中不生效 | P1 |
| B4 | conftest.py Mock LLM | `tests/conftest.py` | 区分单元/集成测试环境，增加conftest_e2e.py | 所有集成/E2E测试 | P0 |

**修复验证要求**：
- B1 修复后：验证 audit 阶段 LLM 调用的 model 字段 ≠ 执行模型
- B2 修复后：验证并行步骤输出独立互不污染
- B3 修复后：验证 Reflexion/ReWOO/AgentJudge 在 Workflow 中生效
- B4 修复后：验证集成测试使用真实 LLM 调用

---

# 第一部分：测试基础与策略

---

## 第〇章：版本说明与合并清单

### 0.1 三版本来源

| 版本 | 原始位置 | 核心内容 | 行数 |
|------|---------|---------|------|
| **v1.1 + v5.0** | test_v6.1_backup.md L1-L525 | 单元测试(UT-CORE-01~UT-LLM-05)、集成测试(API/SOP/插件/跨平台)、E2E Web UI、性能、防御层、Multi-Agent(TaskBoard/Mailbox/Swarms)、压缩器、Checkpoint | 525 |
| **v6.0 (test1.md)** | test1.md 全文 | 8 WF E2E 含 spec/arch 引用、模式执行器专项、Solo WebSocket E2E、模型通道矩阵、并发/熔断、跨 WF、API 业务验证、需求追溯矩阵、6 维指标体系 | 915 |
| **v6.1** | test_v6.1_backup.md L527-L1411 | 两条执行路径分析、基于源码的 WF Agent 链路、Solo UI 路径、Playwright 断言代码、MetricsCollector 设计、"测试通过"定义、架构问题 | 885 |

### 0.2 合并时应用的 5 项关键修正（v7.0）

| # | 修正项 | 原值 | 修正值 | 来源 |
|---|--------|------|--------|------|
| 1 | LLM 调用次数 | 基于模式执行器假设（deep_article≥12, quick_post≥5, trend_article≥8） | 基于 Agent 源码（deep_article 8~11, quick_post 1~2, trend_article 3~5） | testreview1.md 问题1 |
| 2 | Reflexion 迭代在 Workflow API 路径不生效 | writing 阶段 Reflexion 1+N(1~3) | Workflow API 路径 writing=1次LLM，无迭代 | testreview1.md 问题2 |
| 3 | content_audit 独立 Judge 模型需代码修复 | 假设 audit 使用不同模型 | 标注"需代码修复前置条件" | testreview1.md 问题3 |
| 4 | 两条执行路径必须区分 | 混用事件格式 | Workflow API 路径 vs Solo UI 路径分别测试 | testreview1.md 问题5 |
| 5 | Reflexion 独立 Agent 条件修正 | "三个角色使用独立 Agent" | "三种 Prompt 不同"（DefaultLLMActor/Evaluator 共用 LLM Tool） | testreview1.md 问题4 |

### 0.3 v8.0 审核修复清单（6 份审核报告）

| # | 修复项 | 来源审核报告 | 对应章节 |
|---|--------|------------|---------|
| 1 | 新增代码修复前置清单（B1-B4） | 全部6份 | 文档最前面 |
| 2 | 重写第十七章 Solo UI 路径（按意图类型设计） | testreview_qwen R1, testreview_glm P0-2 | 第十七章 |
| 3 | 修正 FactCheckAgent 测试预期（httpx HEAD 非 web_search） | testreview_qwen 架构问题4 | 第十六章 16.1/16.4 |
| 4 | 添加 TrendAnalysisAgent web_search 必须成功断言 | testreview_qwen 架构问题5, testreview_doubao 问题3 | 第十六章 16.3 |
| 5 | 实现 MetricsCollector（从设计升级为可执行代码） | testreview_deepseek FATAL-5, testreview_qwen R5 | 第二十八章 |
| 6 | 添加 conftest_e2e.py 真实 LLM 测试基础设施 | testreview_deepseek FATAL-1, testreview_glm P0-1 | 第一章 1.4 |
| 7 | 添加缺失的模式执行器测试（IT-MODE-06~09） | testreview_glm P1-4 | 第十八章 |
| 8 | 添加调用路径验证表 | testreview_glm P1-3, testreview_kimi 问题13 | 第十六章 |
| 9 | 添加预期输出 JSON 结构 | testreview_glm P0-6, testreview_deepseek FATAL-4 | 第十六章 |
| 10 | 添加 Memory 指标验证 | testreview_glm P1-8 | 第十六章 |
| 11 | 添加通用 Agent 和通用 Workflow 测试 | testreview_glm P1-5/P1-6 | 新增章节 |
| 12 | 更新版本号和审核修复清单 | 全部6份 | 第〇章 |
| 13 | 修正模型名引用（确认无 seed-2.0 残留） | testreview_doubao 问题4, testreview_m27 0.3 | 第十六章 16.0 |
| 14 | 添加架构问题 vs Bug 问题分类 | testreview_glm P1-12, testreview_qwen 架构问题 | 附录B |

### 0.4 各版本独有内容保留映射

| 独有内容 | v1.1+v5.0 | test1.md v6.0 | v6.1 | 合并章节 |
|---------|:---:|:---:|:---:|---------|
| 15+ 单元测试 (core/di/events/modes/sandbox/llm/memory) | ✅ | ❌ | ❌ | 第四~九章 |
| 27 个 API 集成测试 | ✅ | 部分 | ❌ | 第十一章 |
| E2E Web UI 8 个场景 | ✅ | ❌ | ❌ | 第二十六章 |
| 性能测试基准 | ✅ | ❌ | ❌ | 第二十七章 |
| v5.0 防御层 (L1/L2/L3) | ✅ | ❌ | ❌ | 第十章、第二十三章 |
| v5.0 安全工具注册表 | ✅ | ❌ | ❌ | 第十章 |
| v5.0 TaskBoard + Mailbox + ContextCompressor | ✅ | ❌ | ❌ | 第十章 |
| v5.0 Multi-Agent 三策略 | ✅ | ❌ | ❌ | 第二十二章 |
| v5.0 CheckpointManager 增强 | ✅ | ❌ | ❌ | 第十章 |
| 8 WF 含 spec/arch/design 出处引用 | ❌ | ✅ | ❌ | 第十六章 |
| 6 维 25+ 指标定义表 | ❌ | ✅ | ❌ | 第二章 |
| 每个 WF 的详细模型分配表 | ❌ | ✅ | ❌ | 第十六章 |
| 每个 WF 的失败处理流程 | ❌ | ✅ | ❌ | 第十六章 |
| 模式执行器专项 | ❌ | ✅ | ❌ | 第十八章 |
| 需求追溯矩阵 | ❌ | ✅ | ❌ | 第三十章 |
| 两条执行路径分析 | ❌ | ❌ | ✅ | 第十五章 |
| Agent 源码真实 LLM 调用次数 | ❌ | ❌ | ✅ | 第十六章 |
| Playwright 前端断言代码 | ❌ | ❌ | ✅ | 第十九章 |
| MetricsCollector 采集器设计 | ❌ | ❌ | ✅ | 第二十八章 |
| "测试通过"7 维定义 | ❌ | ❌ | ✅ | 第三章 |
| 3 个架构问题 | ❌ | ❌ | ✅ | 附录B |

---

## 第一章：测试策略总览

### 1.1 两条执行路径（不可混淆）

| 路径 | 入口 | 核心方法 | 事件格式 | 适用场景 |
|------|------|---------|---------|---------|
| **Workflow API** | `POST /api/v1/tasks` | `_execute_sop_steps()` | Agent 内部事件 `topic_research.*`, `material_collection.*` | 按 YAML 定义的 Workflow 执行 |
| **Solo UI** | WebSocket 对话框 | `_execute_intelligent_chat()` | 动态规划事件 `workflow.step.start`, `tool.start`, `step.intermediate` | 自由对话 + LLM 动态规划 |

**测试必须分别覆盖两条路径**。它们的 LLM 调用次数、工具链、事件序列完全不同。

### 1.2 测试层级

| 层级 | 框架 | 数据 | 目标 | 覆盖率要求 |
|------|------|------|------|-----------|
| **单元测试** | pytest + pytest-asyncio | Mock LLM 可用 | 模块/接口/工具函数独立验证 | ≥ 85% |
| **集成测试 (Workflow API)** | pytest + httpx | **真实 LLM** | 8 个 Workflow 全流程 | ≥ 70% |
| **集成测试 (Solo UI)** | pytest + WebSocket 客户端 | **真实 LLM** | Solo 动态规划全流程 | 核心流程 100% |
| **E2E 测试** | Playwright | **真实 LLM + 真实浏览器** | 前端时间线渲染 + WebSocket | 核心流程 100% |
| **通道测试** | pytest | **真实 LLM 分通道** | doubao-api / doubao-web/chat / openroute-api / openroute-web | 关键模块 100% |
| **跨平台测试** | pytest + 条件跳过 | Mock | Windows/Linux 兼容性验证 | 关键模块 100% |

### 1.3 Mock 使用铁律

| 允许 Mock | 禁止 Mock |
|-----------|-----------|
| BaseAgent.execute 接口验证 | Workflow 端到端验证 |
| TaskContext 深拷贝测试 | Agent 执行链路验证 |
| EventBus 回调调度测试 | Tool 调用链验证 |
| DI 容器解析测试 | LLM 输出格式验证 |
| 数据库 CRUD 测试 | 前端 Solo WebSocket E2E |
| 沙箱安全规则测试 | 多模型通道测试 |

### 1.4 测试环境

```ini
# pytest.ini
[pytest]
asyncio_mode = auto
markers =
    real_llm: 真实 LLM 调用测试（需 FLOWFORGE_REAL_LLM=1）
    unit: 单元测试（使用 Mock LLM）
    integration: 集成测试
    e2e: 端到端测试
```

```python
# tests/conftest.py

import os
import sys
import pytest
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

@pytest.fixture(autouse=True)
def setup_test_env():
    os.environ["FLOWFORGE_ENV"] = "test"
    os.environ["DB_URL"] = "sqlite:///data/test_flowforge.db"
    os.environ["OPENROUTER_API_KEY"] = "test-key"
    yield
    for path in ["data/test_flowforge.db", "data/test_checkpoints.db"]:
        if os.path.exists(path):
            os.remove(path)

@pytest.fixture
def mock_llm_tool():
    """统一 LLM Mock：所有单元测试共享此 Mock，避免每个测试单独定义。"""
    from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
    class MockLLM(BaseTool):
        name = "llm"
        description = "Mock LLM Tool"
        parameters_schema = {}
        async def execute(self, input: ToolInput) -> ToolOutput:
            return ToolOutput(result={"content": '{"score": 0.9, "issues": []}'})
    return MockLLM()

@pytest.fixture
def use_real_llm():
    """通过环境变量 FLOWFORGE_REAL_LLM=1 启用真实LLM"""
    return os.environ.get("FLOWFORGE_REAL_LLM", "0") == "1"
```

```python
# tests/conftest_e2e.py
"""真实 LLM 端到端测试配置 — 仅在 FLOWFORGE_REAL_LLM=1 时生效"""

import pytest
import os
import time
import json
import uuid

@pytest.fixture
def use_real_llm():
    """通过环境变量 FLOWFORGE_REAL_LLM=1 启用真实LLM"""
    return os.environ.get("FLOWFORGE_REAL_LLM", "0") == "1"

@pytest.fixture
async def real_llm_context(use_real_llm):
    """提供真实 LLM 的测试上下文"""
    if not use_real_llm:
        pytest.skip("需设置 FLOWFORGE_REAL_LLM=1 启用真实LLM测试")

    from flowforge.core.task_context import TaskContext
    from flowforge.events.event_bus import EventBus
    from flowforge.tools.llm_client import LLMClient
    from flowforge.tools.registry import ToolRegistry

    event_bus = EventBus()
    tool_registry = ToolRegistry()
    tool_registry.register(LLMClient(event_bus=event_bus))

    ctx = TaskContext(
        task_id=f"test_{uuid.uuid4().hex[:8]}",
        persona="test",
        input_data={},
    )
    ctx.tools = tool_registry
    ctx.event_bus = event_bus

    # 注入 MetricsCollector
    collector = TestMetricsCollector(event_bus, ctx.task_id)
    ctx._test_collector = collector

    yield ctx

    # 测试结束后输出报告
    collector.end_time = time.time()
    report = collector.generate_report()
    print(f"\n=== 测试指标报告 ({ctx.task_id}) ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))
```

---

## 第二章：6 维测试指标体系（28 项指标定义）

### 2.1 指标定义

| 维度 | 指标 | 定义 | 采集方式 | 记录格式 |
|------|------|------|---------|---------|
| **LLM** | 总调用次数 | 任务生命周期中LLM被调用总次数 | 监听`llm.start`事件计数 | integer |
| **LLM** | 各Agent-LLM调用分布 | 每个Agent调用LLM的次数 | `llm.start`事件按agent分组 | `{agent: count}` |
| **LLM** | 模型链 | 每次调用使用的模型ID序列 | `llm.start` payload的model字段 | `[model_id, ...]` |
| **LLM** | Token消耗 | 输入+输出Token之和 | `llm.end` payload的usage字段 | `{input: int, output: int}` |
| **LLM** | 延迟分布 | P50/P95/P99延迟 | `llm.start`→`llm.end`时间差 | `{p50: ms, p95: ms, p99: ms}` |
| **Tool** | 调用链 | 工具调用顺序序列 | `tool.start`事件序列 | `tool_a→tool_b→tool_c` |
| **Tool** | 各工具调用次数 | 每个工具被调用次数 | `tool.start`按tool_name分组 | `{tool: count}` |
| **Tool** | 成功率 | 成功/总调用数 | `tool.end`中error为空的比例 | float 0-1 |
| **Tool** | 每步耗时 | 每次工具调用耗时 | `tool.start`→`tool.end`时间差 | `{tool: {avg_ms, max_ms}}` |
| **Agent** | 调用链 | Agent调用顺序序列 | `agent.start`事件序列 | `[agent_name, ...]` |
| **Agent** | 各Agent执行时长 | 每个Agent执行耗时 | `agent.start`→`agent.end` | `{agent: seconds}` |
| **Agent** | Reflexion迭代轮次 | Reflexion模式迭代次数 | `reflexion.evaluator`事件计数 | integer |
| **Agent** | Reflexion最终评分 | Reflexion最终质量评分 | `reflexion.evaluator` payload的score | float 0-1 |
| **Agent** | Judge模型名 | Agent-as-Judge使用的模型 | `llm.start` payload中audit阶段的model | string |
| **Workflow** | 阶段序列 | 实际执行的步骤名称序列 | `workflow.step.start`事件序列 | `[step_name, ...]` |
| **Workflow** | 各步骤耗时 | 每个步骤执行耗时 | `step.start`→`step.complete` | `{step: seconds}` |
| **Workflow** | 并行步骤重叠率 | 并行步骤时间重叠比例 | 并行步骤的start/end时间交叉 | float 0-1 |
| **Workflow** | Human节点停留时间 | 审核暂停到恢复的时长 | `task.paused`→`task.resumed` | seconds |
| **Memory** | 查询次数 | Memory被查询次数 | MemoryManager.retrieve调用计数 | integer |
| **Memory** | 写入次数 | Memory被写入次数 | MemoryManager.save调用计数 | integer |
| **Memory** | 压缩触发次数 | 92%阈值触发压缩次数 | `context.warning`事件计数 | integer |
| **Memory** | 缓存命中率 | 命中缓存/总查询 | cache工具返回cached=True比例 | float 0-1 |
| **WebSocket** | 事件总数 | 推送到前端的事件数 | SoloWSManager发送计数 | integer |
| **WebSocket** | 各类型事件分布 | 每种事件类型数量 | 按solo_event_type分组 | `{type: count}` |
| **WebSocket** | 序号连续性 | 事件序号是否有跳号 | 序号差值检测 | `{gaps: int, missing: []}` |
| **Frontend** | 时间线节点数 | 前端渲染的步骤节点数 | DOM节点计数 | integer |
| **Frontend** | Citation链接数 | 来源引用卡片数 | DOM中citation元素计数 | integer |
| **Frontend** | 流式chunk渲染数 | 流式内容渲染的chunk数 | streaming事件计数 | integer |

### 2.2 指标记录模板（每个用例必须填写）

```
| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | X~Y | _ | _ |
| 总工具调用次数 | ≥ X | _ | _ |
| 总耗时 | < Xs | _ | _ |
| Memory查询次数 | ≥ X | _ | _ |
| Memory写入次数 | ≥ X | _ | _ |
| 缓存命中率 | > 0（第二次执行时） | _ | _ |
| Reflexion迭代次数 | N/A (Workflow API路径不适用) | _ | _ |
| Judge Agent模型名 | ≠ 执行模型名 (需代码修复) | _ | _ |
| WebSocket事件数 | ≥ X | _ | _ |
| 前端时间线节点数 | = X | _ | _ |
```

---

## 第三章："测试通过"7 维定义

一个测试用例**通过**意味着：

1. **所有预期阶段按序执行** — 阶段顺序与 Workflow YAML 一致
2. **每个阶段的 Agent 被正确调用** — 输出了 Agent 源码中定义的 EventBus 事件
3. **每个 Agent 的工具调用链符合预期** — 工具名匹配，调用次数在 `[min, max]` 范围内
4. **每个 Agent 的 LLM 调用次数符合预期** — 在 `[min, max]` 范围内（基于 Agent 源码，非模式执行器假设）
5. **阶段输出格式完整** — 必填字段存在且类型正确
6. **前端时间线正确渲染** — Solo 路径下每个节点的图标、文本、子节点正确
7. **WebSocket 事件序列完整** — 无丢事件，事件序号连续

---

# 第二部分：单元测试 (来源: v1.1+v5.0)

---

## 第四章：核心接口测试 (core/)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-CORE-01** | BaseAgent.execute 正常调用 | AgentInput(params={"task": "hello"}) | 返回 AgentOutput(result={...}) |
| **UT-CORE-02** | BaseAgent.execute_with_context 上下文传递 | AgentInput + TaskContext | context 正确传递到 Agent |
| **UT-CORE-03** | BaseTool.execute 正常调用 | ToolInput(params={"query": "test"}) | 返回 ToolOutput(result={...}) |
| **UT-CORE-04** | BaseTool.validate_params 校验通过 | 符合 schema 的 params | True |
| **UT-CORE-05** | BaseTool.validate_params 校验失败 | 缺少 required 字段的 params | False |
| **UT-CORE-06** | TaskContext.from_parent 深拷贝 | 父 TaskContext + overrides | 子 TaskContext 的 state 修改不影响父 |
| **UT-CORE-07** | TaskContext.from_parent 共享资源 | 父 TaskContext + overrides | 子 TaskContext 的 tools/agents/event_bus 与父是同一引用 |
| **UT-CORE-08** | FlowForgeError 默认属性 | FlowForgeError() | status_code=500, detail="Internal flowforge error" |
| **UT-CORE-09** | WorkflowRecursionError 属性 | WorkflowRecursionError() | status_code=400 |
| **UT-CORE-10** | ConflictError 属性 | ConflictError() | status_code=409 |

---

## 第五章：DI 容器测试 (core/di.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-DI-01** | 注册并解析单例 | register_singleton("test", lambda: "hello") | resolve("test") == "hello" |
| **UT-DI-02** | 单例返回同一实例 | resolve 两次 | 两次返回相同实例 |
| **UT-DI-03** | 解析未注册依赖 | resolve("nonexistent") | 抛出 KeyError |
| **UT-DI-04** | 注册实例 | register_instance("test", object()) | resolve("test") 返回该实例 |
| **UT-DI-05** | resolve_all_agents 只返回 Agent | register_agent 2 个 + register_singleton 1 Tool | 返回 2 个 Agent |

---

## 第六章：EventBus + SoloAdapter 测试

### 6.1 EventBus 测试 (events/)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-EVT-01** | 订阅并接收事件 | subscribe + emit | 回调被调用 |
| **UT-EVT-02** | 事件 payload 完整 | emit 带 task_id + payload | 回调收到完整 event dict |
| **UT-EVT-03** | 多订阅者都收到 | 2 个回调订阅同一事件 | 两个都被调用 |
| **UT-EVT-04** | 通用监听器 '*' | subscribe('*') + emit 任意事件 | 回调被调用 |
| **UT-EVT-05** | 异步回调正确调度 | async 回调 | asyncio.ensure_future 调度成功 |
| **UT-EVT-06** | 回调异常不影响其他订阅者 | 一个回调抛异常 | 其他回调正常执行 |
| **UT-EVT-07** | EventBus 异步回调通过 asyncio.ensure_future 调度 | async def callback + emit | 回调被正确调度执行 |
| **UT-EVT-08** | EventBus 同步回调直接执行 | 普通函数 callback + emit | 不抛异常，正常执行 |

### 6.2 EventBusSoloAdapter 测试 (events/solo_adapter.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-SOLO-01** | bridge 建立全部事件映射 | bridge() | 17 个订阅者注册到 event_bus |
| **UT-SOLO-02** | bridge 防重入 | bridge() 调用两次 | _bridged=True，第二次不重复订阅 |
| **UT-SOLO-03** | 事件映射正确 | emit "llm.stream" | solo_manager.emit_event 被调用，参数为 "solo.llm.stream" |
| **UT-SOLO-04** | task_id 正确传递 | emit(task_id="task-001") | solo_manager.emit_event 收到 task_id="task-001" |

---

## 第七章：ModeRegistry + 模式执行器测试

### 7.1 ModeRegistry 测试 (modes/registry.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-MOD-01** | 注册模式 | register(ReActExecutor()) | 模式在 registry 中 |
| **UT-MOD-02** | 获取已注册模式 | get("react") | 返回 ReActExecutor 实例 |
| **UT-MOD-03** | 获取未注册模式 | get("nonexistent") | 抛出 ModeNotFoundError |
| **UT-MOD-04** | 重复注册 | register 同一模式两次 | 抛出 ValueError |
| **UT-MOD-05** | suggest_mode 推荐推理任务 | "复杂数学证明" | 返回 "graph_of_thoughts" |
| **UT-MOD-06** | suggest_mode 推荐搜索任务 | "多步查询" | 返回 "react" |
| **UT-MOD-07** | suggest_mode 推荐写作任务 | "生成文章" | 返回 "reflexion" |
| **UT-MOD-08** | suggest_mode 默认推荐 | "其他任务" | 返回 "workflow" |

### 7.2 ReActExecutor 测试

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-REACT-01** | 正常执行 3 步后给出最终回答 | 返回 final_answer + steps=3 |
| **UT-REACT-02** | 达到 MAX_STEPS 停止 | steps ≤ 8 |
| **UT-REACT-03** | 循环检测触发 | 重复 Action 3 次后 emitted "react.loop_detected" |
| **UT-REACT-04** | 空输入返回空结果 | 不抛异常 |
| **UT-REACT-05** | 事件发射完整 | react.thought → react.action → react.observation |

### 7.3 PlanExecuteExecutor 测试

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-PE-01** | Planner 生成 3 步计划 | plan 列表长度为 3 |
| **UT-PE-02** | Executor 按序执行 | 步骤输出按序收集 |
| **UT-PE-03** | Planner JSON 解析失败时降级 | 返回空 plan，不崩溃 |

### 7.4 ReflexionExecutor 测试

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-REF-01** | 第一次迭代达到阈值 | iterations=1, score≥0.85 |
| **UT-REF-02** | 未达标继续迭代 | iterations>1 |
| **UT-REF-03** | 达到 MAX_ITERATIONS 停止 | iterations≤4 |
| **UT-REF-04** | 记录最佳结果 | best_score ≥ 所有迭代分数 |
| **UT-REF-05** | DefaultLLMActor 回退 | AgentRegistry 无 reflexion_actor 时使用默认 |

### 7.5 DefaultLLM 系列测试

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-DLLM-01** | DefaultLLMActor.execute_with_context 正常执行 | 通过 context.tools 获取 LLM Tool 并返回 AgentOutput |
| **UT-DLLM-02** | DefaultLLMActor.execute() 抛 NotImplementedError | 提示必须使用 execute_with_context |
| **UT-DLLM-03** | DefaultLLMEvaluator JSON 容错解析 | 对 LLM 返回 JSON 内容使用 re.search 提取并解析 |
| **UT-DLLM-04** | DefaultLLMEvaluator 无 LLMTool 降级 | 返回默认 score=0.5 + No LLM tool 提示 |

---

## 第八章：WorkflowExecutor + HybridExecutor 测试

### 8.1 WorkflowExecutor 测试

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-WF-01** | 顺序执行 3 步骤 | 3 个步骤按序完成 |
| **UT-WF-02** | 并行组执行 | parallel_group 中步骤并发完成 |
| **UT-WF-03** | 递归深度超限 | depth≥3 时抛出 WorkflowRecursionError |
| **UT-WF-04** | 嵌套 Workflow 禁止 | mode="workflow" 步骤抛出 ValueError |
| **UT-WF-05** | human 节点暂停 | emitted "review.ready" |
| **UT-WF-06** | on_error=skip 跳过失败步骤 | 步骤失败后继续执行 |
| **UT-WF-07** | on_error=retry 重试成功 | 第 2 次重试成功 |
| **UT-WF-08** | on_error=abort 终止（默认） | 步骤失败后中断 |

### 8.2 HybridExecutor 测试 (executor/hybrid_executor.py)

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-HE-01** | 顶层调用同 persona 并发锁 | 同一 persona 创建两个任务，第二个抛 ConflictError(409) |
| **UT-HE-02** | _is_substep=True 跳过 Persona 锁 | Workflow 子步骤调用 run(_is_substep=True)，不抛异常，正常执行 |
| **UT-HE-03** | _is_substep=False 同 persona 冲突 | 顶层入口重复创建同一专栏，确认为 409 |

---

## 第九章：插件/沙箱/LLM/Memory 测试

### 9.1 插件系统测试 (core/plugin_manager.py)

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-PLG-01** | 从 entry_points 发现插件 | 扫描 flowforge.modes 组 |
| **UT-PLG-02** | 从 YAML 配置加载插件 | 解析 plugin 模块路径 |
| **UT-PLG-03** | 加载失败的插件不影响系统启动 | 一个插件加载失败，其他正常注册 |
| **UT-PLG-04** | mode 插件注册到 ModeRegistry | MyCustomMode 可 get() |
| **UT-PLG-05** | agent 插件注册到 AgentRegistry | MyAgent 可 get() |
| **UT-PLG-06** | tool 插件注册到 ToolRegistry | MyTool 可 execute() |
| **UT-PLG-07** | MCP 配置自动生成 Tool | mcp_servers 配置项生成对应 Tool |

### 9.2 沙箱安全测试 (tools/python_executor.py)

| 用例 ID | 场景 | 输入 | 预期 |
|---------|------|------|------|
| **UT-SBOX-01** | 正常代码执行 | `print("hello")` | stdout="hello" |
| **UT-SBOX-02** | 超时代码 | `while True: pass` + timeout=2 | 返回 timeout 错误 |
| **UT-SBOX-03** | 内存超限 | 分配超过 64MB 的列表 | 返回 memory 错误 (Linux) / 执行成功 (Windows 无 psutil) |
| **UT-SBOX-04** | 禁止 `__import__` | `import os; os.system('ls')` | NameError: __import__ |
| **UT-SBOX-05** | 禁止 `eval` | `eval("1+1")` | NameError: eval |
| **UT-SBOX-06** | 禁止 `open` | `open('/etc/passwd')` | NameError: open |
| **UT-SBOX-07** | 文件路径穿越防护 | `file_rw` 访问 `../../../etc/passwd` | Access denied |
| **UT-SBOX-08** | Windows 平台兼容 | sys.platform="win32" | resource 模块跳过，不报错 |

### 9.3 LLM Client 测试 (tools/llm_client.py)

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-LLM-01** | 正常调用返回内容 | result["content"] 非空 |
| **UT-LLM-02** | 主模型不可用，自动切换 fallback | 使用 fallback 模型 |
| **UT-LLM-03** | 所有模型不可用 | 抛出 AllModelsUnavailable |
| **UT-LLM-04** | Solo emitter 注入 | set_solo_emitter 后调用 llm.start/llm.end |
| **UT-LLM-05** | Token 统计更新 | token.stats 事件被发射 |

### 9.4 Memory 模块测试 (memory/)

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-MEM-01** | WorkingMemory 存取 | store → retrieve 返回相同值 |
| **UT-MEM-02** | ShortTermMemory SQLite 存取 | store → retrieve 返回相同值 |
| **UT-MEM-03** | LongTermMemory SQLite 存取 | store → retrieve 返回相同值 |
| **UT-MEM-04** | SemanticMemory 未启用返回空 | search() → [] |
| **UT-MEM-05** | MemoryManager.hybrid_search | 跨类型检索正确合并 |
| **UT-MEM-06** | 过期清理 | ShortTermMemory TTL 过期后 retrieve 返回 None |

---

## 第十章：v5.0 防御+安全+协作测试

### 10.1 三层防御测试 (test_defense.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-DEF-01** | L1 工具超时触发 | 注册慢工具（sleep 5s），tool_timeout=1 | 返回 `ToolOutput(error="timed out after 1s")` |
| **UT-DEF-02** | L1 工具正常完成不超时 | 注册快工具（sleep 0.1s），tool_timeout=5 | 正常返回 `ToolOutput(result={...})` |
| **UT-DEF-03** | L2 _on_enter 钩子调用 | 自定义 ModeExecutor 覆写 `_on_enter` | `_on_enter` 被调用，ctx 被传入 |
| **UT-DEF-04** | L2 _on_exit 钩子调用 | 自定义 ModeExecutor 覆写 `_on_exit` | `_on_exit` 被调用，result 可被修改 |
| **UT-DEF-05** | L3 reflexion_retry 策略 | SOP 步骤 `on_error: "reflexion_retry"`，步骤失败 | 触发 Reflexion 分析 → 重试 |

### 10.2 安全工具注册表测试 (test_secure_registry.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-SEC-01** | readonly 工具无需审批 | safety_level="readonly" | 直接执行，不触发审批 |
| **UT-SEC-02** | normal 工具正常执行 | safety_level="normal" | 直接执行 |
| **UT-SEC-03** | dangerous 工具需审批 | safety_level="dangerous" + 无审批 | 返回 `ToolOutput(error="Permission denied")` |
| **UT-SEC-04** | dangerous 工具审批通过 | safety_level="dangerous" + 审批通过 | 正常执行 |
| **UT-SEC-05** | 非并发安全工具串行执行 | is_concurrency_safe=False + 2 并发调用 | 通过 asyncio.Lock 串行执行 |
| **UT-SEC-06** | set_tool_safety 动态修改 | `set_tool_safety("tool", "dangerous")` | 工具安全等级被更新 |

### 10.3 TaskBoard 测试 (test_task_board.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-TB-01** | 添加任务 | `add_task("t1", "research", {...})` | 任务出现在 pending 列表 |
| **UT-TB-02** | 批量添加任务 | `add_tasks_batch([...])` | 所有任务出现在 pending 列表 |
| **UT-TB-03** | 原子认领任务 | `claim_task("worker_1")` | 任务状态变为 claimed，claimed_by 正确 |
| **UT-TB-04** | 无任务可认领 | 空 TaskBoard + `claim_task("worker")` | 返回 None |
| **UT-TB-05** | 完成任务 | `complete_task("t1", {"result": ...})` | 任务状态变为 completed |
| **UT-TB-06** | 任务失败 | `fail_task("t1", "error msg")` | 任务状态变为 failed，error_message 正确 |
| **UT-TB-07** | 重置超时任务 | claimed 超时任务 + `reset_stuck_tasks(0)` | 任务状态重置为 pending |
| **UT-TB-08** | 按状态过滤 | `get_all_tasks(status="completed")` | 只返回 completed 任务 |

### 10.4 Mailbox 测试 (test_mailbox.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-MB-01** | 发送消息 | `send("a", "b", "test", "body")` | 消息出现在数据库 |
| **UT-MB-02** | 接收消息 | `receive("b")` | 返回消息列表，自动标记已读 |
| **UT-MB-03** | 优先级排序 | 发送 low/high/critical 消息 | 接收顺序：critical → high → low |
| **UT-MB-04** | 未读过滤 | `receive("b", unread_only=True)` | 只返回未读消息 |
| **UT-MB-05** | 主题过滤 | `receive("b", subject_contains="alert")` | 只返回主题包含 "alert" 的消息 |
| **UT-MB-06** | TTL 过期 | 发送消息 ttl_seconds=0 + 等待 | 消息被自动清理 |
| **UT-MB-07** | 发送者过滤 | `receive("b", sender="a")` | 只返回来自 "a" 的消息 |
| **UT-MB-08** | 信箱统计 | `get_stats("b")` | 返回 total/unread/by_priority |

### 10.5 ContextCompressor 测试 (test_compressor.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-CMP-01** | 低于阈值不压缩 | 短消息列表 | 原样返回，不调用 LLM |
| **UT-CMP-02** | 超过阈值触发压缩 | 长消息列表（>85% 上下文窗口） | 早期历史被压缩为摘要消息 |
| **UT-CMP-03** | 关键消息判断 | tool/assistant+tool_calls/system 消息 | `_is_decision_or_tool_result()` 返回 True |
| **UT-CMP-04** | 无 LLM 可用时降级 | 无 LLM 工具 + 无 llm_client | 保持原始消息不压缩 |
| **UT-CMP-05** | set_context_window | `set_context_window(64000)` | 后续压缩使用新的窗口大小 |

### 10.6 CheckpointManager 增强测试

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-CP-01** | save_full 保存 | `save_full(task_id, state, messages, "label")` | 版本号自动递增 |
| **UT-CP-02** | save_incremental 无变更跳过 | 连续两次相同 state | 第二次返回已有 id，不新增行 |
| **UT-CP-03** | save_incremental 有变更保存 | 修改 state 后 save_incremental | 新增一行，版本号递增 |
| **UT-CP-04** | restore 恢复最新 | `restore(task_id)` | 返回 `{"state": dict, "messages": list}` |
| **UT-CP-05** | restore 恢复指定版本 | `restore(task_id, checkpoint_id)` | 返回指定版本的 state + messages |
| **UT-CP-06** | get_latest 获取最新 | 多次 save 后 get_latest | 返回版本号最大的检查点 |
| **UT-CP-07** | delete_old_versions 清理 | 保存 8 个版本 + `delete_old_versions(keep_latest=5)` | 保留 5 个，删除 3 个 |
| **UT-CP-08** | Schema 迁移兼容 | 旧 schema（无 messages_json 列） | 自动添加新列，旧数据可读 |

---

# 第三部分：集成测试 (来源: v1.1)

---

## 第十一章：API 端点测试

| 用例 ID | 方法 | 路径 | 描述 | 验证点 |
|---------|------|------|------|--------|
| **IT-API-01** | POST | `/api/v1/tasks` | 创建 ReAct 模式任务 | status_code=201, 返回 task_id 和 mode |
| **IT-API-02** | POST | `/api/v1/tasks` | 创建 Reflexion 模式任务 | mode=reflexion in response |
| **IT-API-03** | POST | `/api/v1/tasks` | 同一 persona 并发创建 | status_code=409 ConflictError |
| **IT-API-04** | POST | `/api/v1/tasks` | 指定不存在的 mode | status_code=404 ModeNotFoundError |
| **IT-API-05** | POST | `/api/v1/tasks` | Solo 模式创建 | interaction_mode=solo, WebSocket 可连接 |
| **IT-API-06** | GET | `/api/v1/tasks` | 获取任务列表 | 分页正确 |
| **IT-API-07** | GET | `/api/v1/tasks/{id}` | 获取任务详情 | state 包含中间结果 |
| **IT-API-08** | POST | `/api/v1/tasks/{id}/cancel` | 取消任务 | status=cancelled |
| **IT-API-09** | POST | `/api/v1/tasks/{id}/pause` | 暂停任务 | status=paused, task.paused 事件发射 |
| **IT-API-10** | POST | `/api/v1/tasks/{id}/resume` | 恢复任务 | status=running, task.resumed 事件发射 |
| **IT-API-11** | POST | `/api/v1/tasks/{id}/skip` | 跳过节点 | skipped_stage 正确返回 |
| **IT-API-12** | POST | `/api/v1/tasks/{id}/review` | 审核通过 | status=published |
| **IT-API-13** | POST | `/api/v1/tasks/{id}/review` | 审核拒绝 | status=rejected |
| **IT-API-14** | POST | `/api/v1/tasks/{id}/review` | 审核编辑 | status=waiting_review |
| **IT-API-15** | GET | `/api/v1/review/queue` | 获取待审核列表 | 只返回 waiting_review 任务 |
| **IT-API-16** | GET | `/api/v1/modes` | 获取可用模式 | 返回 9 种模式 |
| **IT-API-17** | GET | `/api/v1/workflows` | 获取可用 Workflow | 返回已注册 Workflow |
| **IT-API-18** | GET | `/api/v1/agents` | 获取已注册 Agent | 返回 Agent 列表含验证状态 |
| **IT-API-19** | PUT | `/api/v1/admin/models/assign` | 更新模型分配 | 分配生效 |
| **IT-API-20** | POST | `/api/v1/admin/models/autofix` | 触发自动修复 | 修复报告正确返回 |
| **IT-API-21** | GET | `/api/v1/admin/models/health` | 获取模型健康 | 包含所有模型状态 |
| **IT-API-22** | GET | `/api/v1/dashboard/stats` | 获取统计数据 | 今日/本月数据正确 |
| **IT-API-23** | GET | `/api/v1/plugins` | 获取已加载插件 | 返回插件列表 |
| **IT-API-24** | GET | `/api/v1/system/platform` | 获取平台兼容性 | os/sandbox_type 正确 |
| **IT-API-25** | GET | `/health` | 健康检查 | 包含 mode_registry 状态 |
| **IT-API-26** | GET | `/metrics` | Prometheus 指标 | 包含 flowforge_ 前缀指标 |
| **IT-API-27** | POST | `/api/v1/tasks/{id}/review` | ContentForge 迁移验证：使用 JSON body `{"verdict": "pass"}` 提交审核 | 审核成功，非 query params 方式 |

---

## 第十二章：SOP 流程测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-SOP-01** | deep_article 全流程（8 步骤） | 从 topic_research 到 publish 全部完成 |
| **IT-SOP-02** | Workflow 中 Reflexion Writer 迭代 | Writer 步骤 score≥0.85（⚠️ 仅模式执行器直接模式下有效，Workflow API 路径不适用） |
| **IT-SOP-03** | 审核暂停后恢复 | 暂停→审核通过→继续→完成 |
| **IT-SOP-04** | 审核拒绝 | 任务状态 rejected |
| **IT-SOP-05** | Workflow 步骤失败 retry | retry 1 次后成功 |
| **IT-SOP-06** | Workflow 步骤失败 skip | 跳过失败步骤，继续后续 |
| **IT-SOP-07** | 并行组执行 | research 和 seo_analysis 时间重叠 |

---

## 第十三章：插件系统集成测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-PLG-01** | pip 安装插件包 | 安装后自动发现并注册 |
| **IT-PLG-02** | YAML 配置加载插件 | 配置指定 module 路径后自动加载 |
| **IT-PLG-03** | MCP 工具接入 | mcp_servers 配置后 Tool 可用 |
| **IT-PLG-04** | OpenAPI 自动生成 Tool | spec_url 配置后生成对应 Tool |
| **IT-PLG-05** | 插件热加载 | /plugins/reload 后新插件生效 |

---

## 第十四章：跨平台集成测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-XP-01** | Linux 沙箱完整功能 | timeout、memory_limit 均生效 |
| **IT-XP-02** | Windows 沙箱降级 | resource 模块不存在，自动降级为 psutil |
| **IT-XP-03** | Windows 无 psutil | 沙箱仍可执行，仅无内存限制 |
| **IT-XP-04** | 文件路径规范化 | Windows 反斜杠路径正确处理 |
| **IT-XP-05** | 平台检测 API | /system/platform 返回正确 os |

---

# 第四部分：Workflow E2E（核心章节）

---

## 第十五章：两条执行路径分析

### 15.1 路径对比

| 维度 | Workflow API 路径 | Solo UI 路径 |
|------|------------------|-------------|
| **入口** | `POST /api/v1/tasks` | WebSocket 对话框 |
| **核心方法** | `_execute_sop_steps()` | `_execute_intelligent_chat()` |
| **步骤来源** | Workflow YAML 定义 | LLM 动态规划（Planner + `_infer_steps_from_intent`） |
| **Agent 调用方式** | `agent.execute_with_context()` | `_execute_tool_or_agent()` |
| **模式执行器** | ⚠️ 不使用（有 agent 时跳过） | ✅ 使用（ReAct/Reflexion/PlanExecute） |
| **Reflexion 迭代** | ❌ 不生效 | ✅ 生效（通过模式执行器） |
| **事件格式** | Agent 内部事件 `topic_research.*` | 动态规划事件 `workflow.step.start` |
| **LLM 调用次数** | 基于 Agent 内部逻辑 | 基于 Planning + Steps + Compile |
| **审核方式** | `POST /review` | Solo 前端内联审核 |
| **典型 LLM 次数** | deep_article: 8~11 | deep_article: 3~4 |

### 15.2 WorkflowExecutor 的 Agent 执行路径

`WorkflowExecutor._execute_sop_steps()` 的实际逻辑：

```python
# workflow.py L76-L83
agent_name = step.get("agent")
if agent_name and ctx.agents:
    agent = ctx.agents.get(agent_name)
    if agent:
        # ⚠️ 直接调用 agent.execute_with_context()，跳过 mode executor！
        agent_output = await agent.execute_with_context(agent_input, ctx)
```

**这意味着**: 虽然 YAML 中写了 `mode: "rewoo"`，但 WorkflowExecutor **并不使用 rewoo 模式执行器**。Agent 被直接调用，Agent 内部自己处理 LLM 调用和工具调用。

### 15.3 Solo UI 动态规划路径

```
Stage 1: Planning (LLM × 1) — 意图识别
  → _is_simple_message()=True? → _simple_response() (Fast-path)
  → _is_simple_message()=False? → _call_llm(planner) → 输出 intent_type + plan
  → Plan 为空? → _infer_intent_type_from_text() + _infer_steps_from_intent() (Fallback)
Stage 2: Execute Steps (LLM × 1~N + Tool × M)
  → 每个 step 按 type 执行: tool / agent / generate
Stage 3: Compile (LLM × 1) — 整理输出
Stage 4: Save (file I/O) — 保存文件（仅长内容）
```

**关键**: Solo UI 路径**不走 Workflow YAML**，走的是 Planner LLM + `_infer_steps_from_intent` 硬编码模板。测试用例必须按意图类型设计，而非按 Workflow 名称。

---

## 第十六章：8 个 Workflow API 路径测试用例

> **执行通道优先级**：OpenRoute API版 → OpenRoute网页版 → 验证通过后以此为准
> **未通过的API模型**：通过`models.yaml`中`enabled: false`暂时关闭
> **未通过的网页版模型**：修正Prompt，约束LLM输出所需工具格式或文案

### 16.0 模型配置要求

```
执行模型: doubao-api/deepseek-v3 (或类似推理模型)
评审模型: doubao-api/gemini-2.5-pro (必须不同！) ⚠️ 需代码修复前置条件(B1)
网页版模型: doubao-web/chat
备用通道: openroute-api
```

**模型配置验证前置检查**：
- `doubao-web/chat` — 确认模型名正确（已从 seed-2.0 更新）
- `openroute-api` — API-only 验证通过后作为备用通道
- 不通过的模型：API 版设置 `enabled: false`，网页版修正 Prompt 约束
- `GET http://localhost:13000/v1/models` → 验证模型列表中无 "seed-2.0"
- `GET http://localhost:13000/v1/models` → 验证包含 "doubao-web/chat"

---

### 16.1 IT-WF-API-01：深度长文 Workflow（deep_article）— 8步 API 路径

**需求依据**：spec.md FR-CAP-06 #1；arch.md 6.5 Workflow #1；design.md 9.1

**输入数据**：

```json
{
  "workflow": "deep_article",
  "persona": "tech_blog",
  "task": "帮我写一篇关于2026年AI Agent发展趋势的深度分析文章，面向技术从业者，3000字以上",
  "platforms": ["local"],
  "auto_approve_review": true
}
```

**预期执行过程**（基于 Agent 源码，⚠️ 非模式执行器假设）：

| 阶段 | Agent | WorkflowExecutor 行为 | Agent 内部步骤 | LLM 次数 | 工具调用 | EventBus 事件（关键） |
|------|-------|---------------------|---------------|---------|---------|---------------------|
| 1 topic_research | TopicResearchAgent | 直接调用 agent.execute_with_context() | cache→opensieve_search→web_search→LLM(回退) | **0~1** | opensieve_search×0~1, web_search×0~1 | `topic_research.opensieve_search_start/complete`, `topic_research.complete` |
| 2 material_collection | MaterialCollectionAgent | 直接调用 agent.execute_with_context() | cache_check(opensieve)→web_search→llm_summarize | **2~4** | opensieve_search×N, web_search×M | `material_collection.cache_check_start/complete`, `material_collection.web_search_start/complete`, `material_collection.llm_summarize_start/complete`, `material_collection.complete` |
| 3 writing | ArticleWritingAgent | 直接调用 agent.execute_with_context() | LLM generate | **1** | 无 | `article_writing.generation_start`, `article_writing.complete` |
| 4 seo_opt | SEOOptimizationAgent | 直接调用 agent.execute_with_context() | planning→optimize | **2** | 无 | `seo_optimization.planning_start/complete`, `seo_optimization.optimize_start/complete` |
| 5 fact_check | FactCheckAgent | 直接调用 agent.execute_with_context() | url_check→fact_verify | **1** | httpx HEAD×N | `fact_check.url_check_start/complete`, `fact_check.fact_verify_start/complete`, `fact_check.complete` |
| 6 audit | ContentAuditAgent | 直接调用 agent.execute_with_context() | assess→compliance | **2** | 无 | `content_audit.assess_start/complete`, `content_audit.compliance_start/complete`, `content_audit.complete` |
| 7 review | (human) | `_pause_for_review()` | 暂停 (auto_approve_review=true 跳过) | **0** | 无 | `review.ready` |
| 8 publish | PublishingAgent | 直接调用 agent.execute_with_context() | publish per platform | **0** | publish_local×1 | `publishing.platform_done`, `publishing.complete` |

**汇总**：总 LLM 调用 **8~11 次**

**调用路径验证表**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache_check → (miss) → opensieve_search → (miss) → web_search → (success) → llm_summarize | 检查tool.start事件序列 |
| material_collection | cache_check → (miss) → web_search → llm_summarize | 检查tool.start事件序列 |
| writing | llm.generate(draft) | 检查llm.start事件的prompt包含写作指令 |
| seo_optimization | llm.planning → llm.optimize | 检查两次llm.start事件的agent_name |
| fact_check | httpx HEAD×N (URL可访问性验证) | 检查tool.start事件中tool_name为httpx_head |
| audit | llm.assess → llm.compliance | 检查两次llm.start事件的model字段（⚠️ 需B1修复后验证不同） |
| publish | publish_local | 检查tool.start事件 |

**预期输出 JSON 结构**：

```json
{
  "topics": {"type": "list", "min_count": 2, "item_schema": {"title": "str", "keywords": "list[str]", "angle": "str"}},
  "materials": {"type": "list", "min_count": 3},
  "draft": {"type": "str", "min_length": 500},
  "seo_title": {"type": "str", "min_length": 10},
  "fact_check_result": {"type": "object", "required_fields": ["verified", "unverified", "corrections"]},
  "score": {"type": "float", "range": [0, 1.0]},
  "is_clean": {"type": "bool"},
  "published": {"type": "dict"}
}
```

**关键模型分配**：

| 阶段 | 执行模型 | 说明 |
|------|---------|------|
| 1~5 | `openroute/auto` | 执行模型 |
| 6 content_audit | `openroute/doubao-web/chat` | ⚠️ **评审模型 ≠ 执行模型**（需代码修复前置条件B1） |
| 7 | — | 人工审核 |
| 8 | `openroute/auto` | 执行模型 |

**通过条件**：

1. ✅ 8 个阶段按 `topic_research→material_collection→writing→seo_opt→fact_check→audit→review→publish` 顺序执行
2. ✅ 阶段 1 topic_research 输出 `topics` 数组，至少 1 个元素含 `title` 和 `url`
3. ✅ 阶段 2 material_collection 输出 `materials` 数组，至少 1 个元素含 `content`
4. ✅ 阶段 3 writing 输出 `draft` 字段，长度 ≥ 500 字符
5. ✅ 阶段 4 seo_opt 输出 `seo_title` 字段
6. ✅ 阶段 5 fact_check 输出 `is_clean` 和 `issues` 字段，使用 httpx HEAD 验证 URL 可访问性
7. ✅ 阶段 6 audit 输出 `score` (float) 和 `is_clean` (bool)
8. ✅ 阶段 6 audit 使用的 LLM 模型 ≠ 阶段 1-5 使用的 LLM 模型（⚠️ 需代码修复前置条件B1）
9. ✅ 阶段 8 publish 输出 `published` 字典，含已发布平台
10. ✅ 总耗时 < 300s

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 8~11 | _ | _ |
| 总工具调用次数 | ≥ 3 | _ | _ |
| 总耗时 | < 300s | _ | _ |
| Memory查询次数 | ≥ 8（每个Agent查询1次） | _ | _ |
| Memory写入次数 | ≥ 6（每个Agent完成后写入） | _ | _ |
| 缓存命中率 | > 0（第二次执行相同任务时） | _ | _ |
| Reflexion迭代次数 | N/A (Workflow API路径不适用) | _ | _ |
| Judge Agent模型名 | ≠ openroute/auto (需B1修复) | _ | _ |
| WebSocket事件数 | N/A (API路径无Solo事件) | _ | _ |
| 前端时间线节点数 | N/A (API路径) | _ | _ |

**失败处理**：

- 若模型不可用：跳过该通道，标记为 SKIP，在报告中说明
- 若工具调用失败：记录失败原因，检查重试逻辑是否触发（L1超时/L3自修正）
- 若LLM输出格式不符：检查 Prompt 是否需要调整，记录到 prompt_issues.md
- 若Agent跳过工具直接回答：记录为 P2 Bug（调用链路验证失败）
- 若 content_audit 使用相同模型：记录为 P0 Bug（需B1修复）
- 若 fact_check 调用 web_search 而非 httpx HEAD：记录为 P1 Bug（预期行为不符）

---

### 16.2 IT-WF-API-02：快速发文 Workflow（quick_post）— 3步 API 路径

**需求依据**：spec.md FR-CAP-06 #2；arch.md 6.5 Workflow #2

**输入数据**：

```json
{"workflow": "quick_post", "persona": "news_flash", "task": "写一篇关于GPT-5最新发布消息的速报"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | Agent 内部步骤 | LLM 次数 | 工具调用 |
|------|-------|---------------|---------|---------|
| 1 topic_research | TopicResearchAgent | cache→opensieve→web_search→LLM | **0~1** | opensieve×1 or web_search×1 |
| 2 writing | ArticleWritingAgent | LLM generate | **1** | 无 |
| 3 publish | PublishingAgent | publish per platform | **0** | publish_local×1 |

**汇总**：总 LLM 调用 **1~2 次**

**调用路径验证表**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache_check → (miss) → opensieve_search/web_search | 检查tool.start事件序列 |
| writing | llm.generate(draft) | 检查llm.start事件 |
| publish | publish_local | 检查tool.start事件 |

**预期输出 JSON 结构**：

```json
{
  "topics": {"type": "list", "min_count": 1},
  "draft": {"type": "str", "min_length": 200},
  "published": {"type": "dict"}
}
```

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1 | `openroute/auto` |
| 2 | `openroute/auto` |
| 3 | `openroute/doubao-web/chat`（lightweight档位） |

**通过条件**：

1. ✅ 3 个阶段顺序执行
2. ✅ 不包含 seo_optimization、fact_check、content_audit 步骤
3. ✅ writing 输出 draft 长度 ≥ 200 字符
4. ✅ publish 输出 published 字典
5. ✅ 总耗时 < 60s

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 1~2 | _ | _ |
| 总工具调用次数 | 1~2 | _ | _ |
| 总耗时 | < 60s | _ | _ |
| Memory查询次数 | ≥ 2 | _ | _ |
| Memory写入次数 | ≥ 1 | _ | _ |
| 缓存命中率 | > 0（第二次执行时） | _ | _ |
| Reflexion迭代次数 | N/A (Workflow API路径不适用) | _ | _ |
| workflow.step.start事件数 | = 3 | _ | _ |

**失败处理**：

- 若模型不可用：跳过该通道，标记为 SKIP
- 若 writing 阶段输出过短：检查 Prompt，记录到 prompt_issues.md
- 若 topic_research 未调用任何工具：记录为 P2 Bug

---

### 16.3 IT-WF-API-03：热点追踪 Workflow（trend_article）— 4步 API 路径

**需求依据**：spec.md FR-CAP-06 #3；arch.md 6.5 Workflow #3；spec.md 5.2"热点追踪创作"

**输入数据**：

```json
{"workflow": "trend_article", "persona": "trend_watcher", "task": "追踪本周AI领域最新热点并撰写文章", "domain": "AI"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | Agent 内部步骤 | LLM 次数 | 工具调用 | 特别关注 |
|------|-------|---------------|---------|---------|---------|
| 1 trend_analysis | TrendAnalysisAgent | collect_data→analyze_trends→generate_report | **2~3** | web_search×1 | **热点数据是否真实（非编造），可通过搜索验证** |
| 2 topic_research | TopicResearchAgent | cache→opensieve→web_search→LLM | **0~1** | opensieve×1 or web_search×1 | 选题是否基于阶段1的真实热点 |
| 3 writing | ArticleWritingAgent | LLM generate | **1** | 无 | 文章是否引用趋势数据 |
| 4 publish | PublishingAgent | publish per platform | **0** | publish_local×1 | — |

**汇总**：总 LLM 调用 **3~5 次**

**调用路径验证表**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| trend_analysis | web_search → llm.analyze_trends → llm.generate_report | 检查tool.start事件序列（web_search必须成功） |
| topic_research | cache_check → (miss) → opensieve_search/web_search | 检查tool.start事件序列 |
| writing | llm.generate(draft) | 检查llm.start事件 |
| publish | publish_local | 检查tool.start事件 |

**预期输出 JSON 结构**：

```json
{
  "trends": {"type": "list", "min_count": 3, "item_schema": {"topic": "str", "heat": "float", "source": "str"}},
  "topics": {"type": "list", "min_count": 1},
  "draft": {"type": "str", "min_length": 500},
  "published": {"type": "dict"}
}
```

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1 | `openroute/auto`（需要多步推理） |
| 2 | `openroute/auto` |
| 3 | `openroute/auto` |
| 4 | `openroute/doubao-web/chat` |

**通过条件**：

1. ✅ 第一步必须是 `trend_analysis`（先分析趋势再选题）
2. ✅ **web_search 必须成功返回结果（不能降级到LLM编造热点）**
3. ✅ **如果 web_search 失败降级到 LLM，该测试标记为 FAIL（数据不可信）**
4. ✅ trends 数组至少含 3 条热点
5. ✅ 热点数据可通过搜索引擎验证时效性（非 LLM 编造）
6. ✅ article_writing 引用了阶段 1 的趋势数据

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 3~5 | _ | _ |
| 总工具调用次数 | 2~3 | _ | _ |
| trend_analysis LLM次数 | 2~3 | _ | _ |
| web_search调用次数 | ≥ 1 | _ | _ |
| web_search是否成功 | ✅ 必须 | _ | _ |
| 热点条数 | ≥ 3 | _ | _ |
| Memory查询次数 | ≥ 3 | _ | _ |
| Memory写入次数 | ≥ 2 | _ | _ |
| 缓存命中率 | > 0（第二次执行时） | _ | _ |

**失败处理**：

- 若 trend_analysis 未调用 web_search：记录为 P0 Bug（热点追踪不搜索）
- 若 web_search 失败降级到 LLM 编造热点：标记为 **FAIL**（数据不可信）
- 若热点数据为 LLM 编造：记录为 P1 Bug（需验证时效性）
- 若 article_writing 未引用趋势数据：记录为 P2 Bug

---

### 16.4 IT-WF-API-04：SEO 内容 Workflow（seo_content）— 6步 API 路径

**需求依据**：spec.md FR-CAP-06 #5；arch.md 6.5 Workflow #5

**输入数据**：

```json
{"workflow": "seo_content", "persona": "seo_writer", "task": "针对关键词'Python异步编程最佳实践'生成一篇SEO优化的文章"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | Agent 内部步骤 | LLM 次数 | 工具调用 | 输出验证 |
|------|-------|---------------|---------|---------|---------|
| 1 topic_research | TopicResearchAgent | 降级链 | **0~1** | opensieve×1 or web_search×1 | topics |
| 2 seo_optimization | SEOOptimizationAgent | planning→optimize | **2** | 无 | seo_keywords含搜索量/竞争度 |
| 3 material_collection | MaterialCollectionAgent | cache→web_search→llm_summarize | **2~4** | opensieve×N + web_search×M | materials |
| 4 writing | ArticleWritingAgent | LLM generate | **1** | 无 | draft含关键词密度检查 |
| 5 fact_check | FactCheckAgent | url_check→fact_verify | **1** | httpx HEAD×N | fact_check_result |
| 6 publish | PublishingAgent | publish per platform | **0** | publish_local×1 | published_urls |

**汇总**：总 LLM 调用 **6~9 次**

**调用路径验证表**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache_check → (miss) → opensieve_search/web_search | 检查tool.start事件序列 |
| seo_optimization | llm.planning → llm.optimize | 检查两次llm.start事件 |
| material_collection | cache_check → web_search → llm_summarize | 检查tool.start事件序列 |
| writing | llm.generate(draft) | 检查llm.start事件 |
| fact_check | httpx HEAD×N (URL可访问性验证) | 检查tool.start事件中tool_name为httpx_head |
| publish | publish_local | 检查tool.start事件 |

**预期输出 JSON 结构**：

```json
{
  "topics": {"type": "list", "min_count": 1},
  "seo_keywords": {"type": "list", "min_count": 5},
  "materials": {"type": "list", "min_count": 3},
  "draft": {"type": "str", "min_length": 500},
  "fact_check_result": {"type": "object", "required_fields": ["verified", "unverified"]},
  "published": {"type": "dict"}
}
```

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1~5 | `openroute/auto` |
| 6 | `openroute/auto` |

**通过条件**：

1. ✅ seo_keywords 数组长度 ≥ 5
2. ✅ draft 中目标关键词"Python异步编程最佳实践"出现 ≥ 2 次
3. ✅ seo_optimization 必须使用 plan_execute 模式（YAML 定义）
4. ✅ fact_check 使用 httpx HEAD 验证 URL 可访问性（非 web_search）

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 6~9 | _ | _ |
| 总工具调用次数 | ≥ 3 | _ | _ |
| seo_keywords数量 | ≥ 5 | _ | _ |
| 关键词出现次数 | ≥ 2 | _ | _ |
| Memory查询次数 | ≥ 5 | _ | _ |
| Memory写入次数 | ≥ 4 | _ | _ |
| 缓存命中率 | > 0（第二次执行时） | _ | _ |

**失败处理**：

- 若 seo_keywords 为空：检查 SEOOptimizationAgent Prompt，记录到 prompt_issues.md
- 若 fact_check 调用 web_search 而非 httpx HEAD：记录为 P1 Bug（FactCheckAgent 使用 httpx HEAD 验证 URL 可访问性）
- 若 draft 中关键词密度不足：记录为 P2 Bug（Prompt 调整）

---

### 16.5 IT-WF-API-05：报告生成 Workflow（report_generation）— 含并行步骤

**需求依据**：spec.md FR-CAP-06 #8；arch.md 6.5 Workflow #8

**输入数据**：

```json
{"workflow": "report_generation", "persona": "analyst", "task": "生成一份关于全球气候变化影响的深度研究报告"}
```

**预期执行过程**（8 步 + 并行，基于 Agent 源码）：

| 阶段 | Agent | LLM 次数 | 工具调用 | 并行验证 |
|------|-------|---------|---------|---------|
| 1 topic_research | TopicResearchAgent | **0~1** | opensieve/web_search | - |
| 2 parallel: research_1 | MaterialCollectionAgent | **2~4** | opensieve + web_search | **与 research_2 并发执行** |
| 2 parallel: research_2 | MaterialCollectionAgent | **2~4** | opensieve + web_search | **与 research_1 并发执行** |
| 3 writing | ArticleWritingAgent | **1** | 无 | - |
| 4 seo_optimization | SEOOptimizationAgent | **2** | 无 | - |
| 5 fact_check | FactCheckAgent | **1** | httpx HEAD | - |
| 6 content_audit | ContentAuditAgent | **2** | 无 | ⚠️ 需代码修复前置条件B1 |
| 7 review | (human pause) | **0** | - | auto_approve 跳过 |
| 8 publish | PublishingAgent | **0** | publish_local | - |

**汇总**：总 LLM 调用 **10~15 次**

**调用路径验证表**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache_check → opensieve_search/web_search | 检查tool.start事件序列 |
| parallel research_1 | cache_check → web_search → llm_summarize | 检查tool.start事件序列 + 与research_2时间重叠 |
| parallel research_2 | cache_check → web_search → llm_summarize | 检查tool.start事件序列 + 与research_1时间重叠 |
| writing | llm.generate(draft) | 检查llm.start事件 |
| seo_optimization | llm.planning → llm.optimize | 检查两次llm.start事件 |
| fact_check | httpx HEAD×N | 检查tool.start事件 |
| audit | llm.assess → llm.compliance | 检查两次llm.start事件的model字段 |
| publish | publish_local | 检查tool.start事件 |

**预期输出 JSON 结构**：

```json
{
  "topics": {"type": "list", "min_count": 2},
  "materials_1": {"type": "list", "min_count": 2},
  "materials_2": {"type": "list", "min_count": 2},
  "draft": {"type": "str", "min_length": 500},
  "seo_title": {"type": "str", "min_length": 10},
  "fact_check_result": {"type": "object"},
  "score": {"type": "float", "range": [0, 1.0]},
  "is_clean": {"type": "bool"},
  "published": {"type": "dict"}
}
```

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1~5 | `openroute/auto` |
| 6 content_audit | `openroute/doubao-web/chat`（⚠️ 评审模型 ≠ 执行模型，需代码修复前置条件B1） |
| 7 | — |
| 8 | `openroute/auto` |

**通过条件**：

1. ✅ **并行步骤中 research_1 和 research_2 的实际执行时间有重叠**（验证并行而非串行）
2. ✅ `research_1` 和 `research_2` 的开始时间差 < 2s（确认同时启动）
3. ✅ 总耗时 < `(research_1 耗时 + research_2 耗时)` × 1.1（确认不串行）
4. ✅ 并行步骤输出独立互不污染（`materials_1` ≠ `materials_2`）— ⚠️ 需B2修复（数据竞争）
5. ✅ **content_audit 使用不同于 article_writing 的模型**（⚠️ 需代码修复前置条件B1）
6. ✅ content_audit 四维评分均为 0-1 浮点数

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 10~15 | _ | _ |
| 总工具调用次数 | ≥ 4 | _ | _ |
| 并行步骤时间重叠 | > 0s | _ | _ |
| content_audit模型名 | ≠ openroute/auto (需B1修复) | _ | _ |
| 总耗时 | < 300s | _ | _ |
| Memory查询次数 | ≥ 8 | _ | _ |
| Memory写入次数 | ≥ 6 | _ | _ |
| 缓存命中率 | > 0（第二次执行时） | _ | _ |

**失败处理**：

- 若并行步骤实际串行执行：记录为 P0 Bug（WorkflowExecutor 并行逻辑错误）
- 若并行步骤输出互相污染：记录为 P0 Bug（上下文隔离失败，需B2修复）
- 若 content_audit 使用相同模型：记录为 P0 Bug（需B1修复）

---

### 16.6 IT-WF-API-06：多语言发布 Workflow（multilingual）— 5步 API 路径

**需求依据**：spec.md FR-CAP-06 #7；arch.md 6.5 Workflow #7

**输入数据**：

```json
{"workflow": "multilingual", "persona": "global_writer", "task": "写一篇介绍中国茶文化的文章并翻译成英文和日文"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | LLM 次数 | 工具调用 | 验证点 |
|------|-------|---------|---------|--------|
| 1 topic_research | TopicResearchAgent | **0~1** | opensieve/web_search | — |
| 2 material_collection | MaterialCollectionAgent | **2~4** | opensieve + web_search | — |
| 3 writing | ArticleWritingAgent | **1** | 无 | 中文初稿 |
| 4 translation | MultilingualAgent | **3** (detect+translate+verify) | 无 | **translated含en/ja目标语言版本** |
| 5 publish | PublishingAgent | **0** | publish_local | 多语言版本均发布 |

**汇总**：总 LLM 调用 **6~9 次**

**调用路径验证表**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache_check → opensieve_search/web_search | 检查tool.start事件序列 |
| material_collection | cache_check → web_search → llm_summarize | 检查tool.start事件序列 |
| writing | llm.generate(draft) | 检查llm.start事件 |
| translation | llm.detect → llm.translate → llm.verify | 检查3次llm.start事件 |
| publish | publish_local | 检查tool.start事件 |

**预期输出 JSON 结构**：

```json
{
  "topics": {"type": "list", "min_count": 1},
  "materials": {"type": "list", "min_count": 2},
  "draft": {"type": "str", "min_length": 500},
  "translated": {"type": "dict", "required_fields": ["en", "ja"]},
  "published": {"type": "dict"}
}
```

**通过条件**：

1. ✅ translated 输出至少含 2 种目标语言翻译（英文+日文）
2. ✅ 翻译质量不低于机器翻译基准
3. ✅ multilingual Agent 必须使用 plan_execute 模式（YAML 定义）

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 6~9 | _ | _ |
| 总工具调用次数 | ≥ 2 | _ | _ |
| 翻译语言数 | ≥ 2 | _ | _ |
| 总耗时 | < 200s | _ | _ |
| Memory查询次数 | ≥ 4 | _ | _ |
| Memory写入次数 | ≥ 3 | _ | _ |
| 缓存命中率 | > 0（第二次执行时） | _ | _ |

**失败处理**：

- 若翻译输出缺少目标语言：检查 MultilingualAgent Prompt，记录到 prompt_issues.md
- 若翻译质量极差：记录为 P2 Bug（Prompt 调整）

---

### 16.7 IT-WF-API-07：多平台分发 Workflow（multi_platform）— 4步 API 路径

**需求依据**：spec.md FR-CAP-06 #4；arch.md 6.5 Workflow #4

**输入数据**：

```json
{"workflow": "multi_platform", "persona": "social_media", "task": "写一篇关于远程办公效率的文章并适配公众号/头条/知乎三个平台", "platforms": ["wechat", "toutiao", "zhihu"]}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | LLM 次数 | 工具调用 | 特别关注 |
|------|-------|---------|---------|---------|
| 1 topic_research | TopicResearchAgent | **0~1** | opensieve/web_search | — |
| 2 writing | ArticleWritingAgent | **1** | 无 | 产出主版本 |
| 3 repurpose | ContentRepurposerAgent | **1 + N_platforms** (analyze + per-platform rewrite) = **4** | 无 | **variants应含不同平台的改写版本** |
| 4 publish | PublishingAgent | **0** | publish_local | 多平台发布 |

**汇总**：总 LLM 调用 **5~6 次**

**调用路径验证表**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache_check → opensieve_search/web_search | 检查tool.start事件序列 |
| writing | llm.generate(draft) | 检查llm.start事件 |
| repurpose | llm.analyze → llm.rewrite(wechat) → llm.rewrite(toutiao) → llm.rewrite(zhihu) | 检查4次llm.start事件 |
| publish | publish_local | 检查tool.start事件 |

**预期输出 JSON 结构**：

```json
{
  "topics": {"type": "list", "min_count": 1},
  "draft": {"type": "str", "min_length": 300},
  "variants": {"type": "list", "min_count": 3, "item_schema": {"platform": "str", "content": "str"}},
  "published": {"type": "dict"}
}
```

**通过条件**：

1. ✅ **content_repurposer 必须调用**（格式转换核心步骤）
2. ✅ variants 数组长度 ≥ 3（对应 3 个以上目标平台）
3. ✅ 各版本风格有差异（公众号偏正式、知乎偏深度、头条偏标题党）
4. ✅ 每个平台版本内容非空

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 5~6 | _ | _ |
| 总工具调用次数 | ≥ 1 | _ | _ |
| 平台变体数 | ≥ 3 | _ | _ |
| 总耗时 | < 150s | _ | _ |
| Memory查询次数 | ≥ 3 | _ | _ |
| Memory写入次数 | ≥ 2 | _ | _ |
| 缓存命中率 | > 0（第二次执行时） | _ | _ |

**失败处理**：

- 若 content_repurposer 未调用：记录为 P0 Bug（格式转换核心步骤缺失）
- 若 variants 数量不足：检查 ContentRepurposerAgent Prompt
- 若各平台版本风格无差异：记录为 P2 Bug（Prompt 调整）

---

### 16.8 IT-WF-API-08：图文并茂 Workflow（image_article）— 5步 API 路径

**需求依据**：spec.md FR-CAP-06 #6；arch.md 6.5 Workflow #6

**输入数据**：

```json
{"workflow": "image_article", "persona": "visual_writer", "task": "写一篇关于日本樱花季旅行攻略的图文文章"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | LLM 次数 | 工具调用 | 特别关注 |
|------|-------|---------|---------|---------|
| 1 topic_research | TopicResearchAgent | **0~1** | opensieve/web_search | — |
| 2 material_collection | MaterialCollectionAgent | **2~4** | opensieve + web_search | — |
| 3 writing | ArticleWritingAgent | **1** | 无 | — |
| 4 image_research | ImageResearchAgent | **1~2** | pexels_image 或 web_search | **images应包含真实可访问的图片URL，非占位符** |
| 5 publish | PublishingAgent | **0** | publish_local | 图文混排发布 |

**汇总**：总 LLM 调用 **4~8 次**

**调用路径验证表**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache_check → opensieve_search/web_search | 检查tool.start事件序列 |
| material_collection | cache_check → web_search → llm_summarize | 检查tool.start事件序列 |
| writing | llm.generate(draft) | 检查llm.start事件 |
| image_research | pexels_image / web_search(image) | 检查tool.start事件中tool_name |
| publish | publish_local | 检查tool.start事件 |

**预期输出 JSON 结构**：

```json
{
  "topics": {"type": "list", "min_count": 1},
  "materials": {"type": "list", "min_count": 2},
  "draft": {"type": "str", "min_length": 500},
  "images": {"type": "list", "min_count": 2, "item_schema": {"url": "str", "alt": "str"}},
  "published": {"type": "dict"}
}
```

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1~4 | `openroute/auto` |
| 5 | `openroute/auto` |

**通过条件**：

1. ✅ image_research 必须调用 pexels_image 工具（非 LLM 编造 URL）
2. ✅ images 数组至少含 2 张可用图片
3. ✅ 图片 URL 可通过 HTTP 200 访问
4. ✅ 若含 content_audit 步骤，需使用不同模型（⚠️ 需代码修复前置条件B1）

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 4~8 | _ | _ |
| 总工具调用次数 | ≥ 3 | _ | _ |
| 图片数量 | ≥ 2 | _ | _ |
| 图片URL可访问率 | = 1.0 | _ | _ |
| 总耗时 | < 200s | _ | _ |
| Memory查询次数 | ≥ 4 | _ | _ |
| Memory写入次数 | ≥ 3 | _ | _ |
| 缓存命中率 | > 0（第二次执行时） | _ | _ |

**失败处理**：

- 若 image_research 未调用 pexels_image：记录为 P0 Bug（图片搜索核心步骤缺失）
- 若图片 URL 不可访问：记录为 P1 Bug（图片源问题）
- 若 images 数组为空：检查 ImageResearchAgent Prompt，记录到 prompt_issues.md

---

## 第十七章：8 个 Solo UI 路径测试用例（按意图类型设计）

> **⚠️ v8.0 核心修正**：Solo UI 路径**不走 Workflow YAML**，走的是 Planner LLM + `_infer_steps_from_intent`。
> 因此测试用例必须按**用户输入意图类型**设计，而非按 Workflow 名称。
> **来源**：testreview_qwen R1、testreview_glm P0-2

---

### 17.1 IT-SOLO-01：简单问候（Fast-path）— `_is_simple_message()=True → _simple_response()`

**用户输入**："你好"

**预期 Planner 行为**：
- `_is_simple_message()` 返回 True（匹配问候语模式）
- 走 Fast-path：`_simple_response()` 直接返回
- **不进入 Planning 阶段**

**预期执行步骤**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 simple_response | `_simple_response()` | **0** | 无 | `draft.update(content="你好！有什么我可以帮助你的吗？")` |

**汇总**：总 LLM 调用 **0 次**（Fast-path 不调用 LLM）

**预期 Planner 输出**：N/A（不经过 Planner）

**预期 WebSocket 事件序列**：

```
1. draft.update         {"content": "你好！有什么我可以帮助你的吗？", "agent_name": "solo_assistant"}
```

**通过条件**：

1. ✅ 不触发 Planning 阶段（无 `workflow.step.start(step=planning)` 事件）
2. ✅ 直接返回简单回复
3. ✅ 前端时间线渲染 ≤ 1 个节点
4. ✅ Fast-path vs Planning 判断条件：`_is_simple_message()` 返回 True

**前端时间线预期渲染**：仅显示一条聊天消息，无步骤节点

---

### 17.2 IT-SOLO-02：写作意图（Planning路径）— Planner输出write意图

**用户输入**："帮我写一篇关于2026年AI Agent发展趋势的深度分析文章"

**预期 Planner 输出**：

```json
{
  "intent_type": "write",
  "plan": [
    {"name": "搜索素材", "type": "tool", "tool": "web_search"},
    {"name": "撰写内容", "type": "agent", "agent": "article_writing"}
  ]
}
```

**预期执行步骤**（基于 `_infer_steps_from_intent("write")` 的硬编码模板或 Planner 动态输出）：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(step=planning)`, `step.intermediate(规划完成: write, 2步)`, `workflow.step.complete(step=planning)` |
| 2 搜索素材 | `_execute_tool_or_agent(web_search)` | 0 | web_search×1 | `workflow.step.start(step=搜索素材)`, `tool.start(web_search)`, `tool.end(web_search)`, `workflow.step.complete(step=搜索素材)` |
| 3 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `workflow.step.start(step=撰写内容)`, `tool.start(article_writing, is_agent=true)`, `tool.end(article_writing)`, `workflow.step.complete(step=撰写内容)` |
| 4 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(step=compile, stage=compile)`, `workflow.step.complete(step=compile)` |
| 5 保存文件 (save) | workspace I/O | 0 | file write | `workflow.step.start(step=save)`, `draft.file`, `workflow.step.complete(step=save)` |

**汇总**：总 LLM 调用 **3 次**（planning + writing agent + compile）

**预期 WebSocket 事件序列**：

```
1.  workflow.step.start  {"step": "planning", "stage": "planning"}
2.  workflow.step.complete {"step": "planning", "intent_type": "write"}
3.  step.intermediate     {"step_name": "规划完成: write, 2步"}
4.  workflow.step.start  {"step": "搜索素材"}
5.  tool.start            {"tool_name": "web_search"}
6.  tool.end              {"tool_name": "web_search", "success": true}
7.  workflow.step.complete {"step": "搜索素材"}
8.  workflow.step.start  {"step": "撰写内容"}
9.  tool.start            {"tool_name": "article_writing", "is_agent": true}
10. article_writing.generation_start {"topic": "2026年AI Agent..."}
11. article_writing.complete {"draft_length": N}
12. tool.end              {"tool_name": "article_writing", "success": true, "is_agent": true}
13. workflow.step.complete {"step": "撰写内容"}
14. workflow.step.start  {"step": "compile", "stage": "compile"}
15. workflow.step.complete {"step": "compile"}
16. workflow.step.start  {"step": "save", "stage": "save"}
17. draft.file           {"filename": "output.md", "path": "..."}
18. workflow.step.complete {"step": "save"}
19. draft.update         {"content": "...", "agent_name": "solo_assistant"}
```

**通过条件**：

1. ✅ 前端时间线渲染的节点 ≥ 4（planning → 搜索素材 → 撰写内容 → compile → save）
2. ✅ 搜索素材节点下显示 `web_search` 子节点（扳手图标）
3. ✅ 撰写内容节点下显示 `article_writing` Agent 子节点
4. ✅ compile 后 `draft.update` 事件内容非空
5. ✅ save 后显示文件下载链接
6. ✅ 所有 `tool.start/tool.end` 成对出现
7. ✅ 事件序号连续无跳号
8. ✅ Fast-path vs Planning 判断条件：`_is_simple_message()` 返回 False → 进入 Planning

**前端时间线预期渲染**：

```
[Planning] 意图识别 → write
  └── 规划完成: 2步
[Step 1] 搜索素材
  └── 🔧 web_search
[Step 2] 撰写内容
  └── 🤖 article_writing
[Compile] 整理输出
[Save] 保存文件
  └── 📄 output.md
```

---

### 17.3 IT-SOLO-03：搜索意图（Planning路径）— Planner输出search意图

**用户输入**："搜索一下最新的AI Agent框架有哪些"

**预期 Planner 输出**：

```json
{
  "intent_type": "search",
  "plan": [
    {"name": "搜索", "type": "tool", "tool": "web_search"}
  ]
}
```

**预期执行步骤**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)`, `step.intermediate(规划完成: search, 1步)`, `workflow.step.complete(planning)` |
| 2 搜索 | `_execute_tool_or_agent(web_search)` | 0 | web_search×1 | `workflow.step.start(搜索)`, `tool.start(web_search)`, `tool.end(web_search)`, `workflow.step.complete(搜索)` |
| 3 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **2 次**

**通过条件**：

1. ✅ Planner 输出 intent_type="search"
2. ✅ 前端时间线渲染的节点 ≥ 3
3. ✅ 搜索节点下显示 `web_search` 子节点
4. ✅ 事件序号连续无跳号
5. ✅ Fast-path vs Planning 判断条件：`_is_simple_message()` 返回 False → Planning

---

### 17.4 IT-SOLO-04：研究意图（Planning路径）— Planner输出research意图

**用户输入**："深入研究一下量子计算在密码学中的应用"

**预期 Planner 输出**：

```json
{
  "intent_type": "research",
  "plan": [
    {"name": "搜索", "type": "tool", "tool": "web_search"},
    {"name": "分析", "type": "generate"},
    {"name": "整理", "type": "generate"}
  ]
}
```

**预期执行步骤**（基于 `_infer_steps_from_intent("research")` → [搜索, 分析, 整理]）：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)`, `workflow.step.complete(planning)` |
| 2 搜索 | `_execute_tool_or_agent(web_search)` | 0 | web_search×1 | `tool.start(web_search)`, `tool.end(web_search)` |
| 3 分析 | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(分析)`, `workflow.step.complete(分析)` |
| 4 整理 | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(整理)`, `workflow.step.complete(整理)` |
| 5 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **4 次**

**通过条件**：

1. ✅ Planner 输出 intent_type="research"
2. ✅ 前端时间线渲染的节点 ≥ 4
3. ✅ 搜索节点下显示 `web_search` 子节点
4. ✅ 事件序号连续无跳号
5. ✅ Fast-path vs Planning 判断条件：`_is_simple_message()` 返回 False → Planning

---

### 17.5 IT-SOLO-05：翻译意图（Fast-path或Planning）— 简单翻译走Fast-path，复杂翻译走Planning

**用户输入**："把'人工智能正在改变世界'翻译成英文"

**预期 Planner 行为**：
- 简单翻译：可能走 Fast-path（`_simple_response()`）
- 复杂翻译（如"翻译这篇5000字的文章"）：走 Planning

**预期 Planner 输出（Planning路径）**：

```json
{
  "intent_type": "translate",
  "plan": [
    {"name": "翻译", "type": "agent", "agent": "multilingual"}
  ]
}
```

**预期执行步骤**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)`, `workflow.step.complete(planning)` |
| 2 翻译 | `_execute_tool_or_agent(multilingual)` | 1 | 无 | `tool.start(multilingual)`, `tool.end(multilingual)` |
| 3 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **2~3 次**

**通过条件**：

1. ✅ 翻译结果包含目标语言版本
2. ✅ 前端时间线渲染的节点 ≥ 2
3. ✅ 事件序号连续无跳号
4. ✅ Fast-path vs Planning 判断条件：简单翻译可能走 Fast-path（0次LLM），复杂翻译走 Planning

---

### 17.6 IT-SOLO-06：代码意图（Planning路径）— Planner输出code意图

**用户输入**："用Python写一个快速排序算法"

**预期 Planner 输出**：

```json
{
  "intent_type": "code",
  "plan": [
    {"name": "编写代码", "type": "agent", "agent": "code_writer_agent"}
  ]
}
```

**预期执行步骤**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)`, `workflow.step.complete(planning)` |
| 2 编写代码 | `_execute_tool_or_agent(code_writer_agent)` | 1 | 无 | `tool.start(code_writer_agent)`, `tool.end(code_writer_agent)` |
| 3 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **2~3 次**

**通过条件**：

1. ✅ code_writer_agent 被调用
2. ✅ 输出包含可执行的 Python 代码
3. ✅ 前端时间线渲染的节点 ≥ 2
4. ✅ 事件序号连续无跳号
5. ✅ Fast-path vs Planning 判断条件：`_is_simple_message()` 返回 False → Planning

---

### 17.7 IT-SOLO-07：Plan降级场景 — Planner返回空plan → `_infer_steps_from_intent()` fallback

**用户输入**："帮我分析一下这个问题"（模糊意图，Planner可能返回空plan）

**预期 Planner 行为**：
- Planner 返回空 plan 或格式错误的 JSON
- 降级到 `_infer_intent_type_from_text()` + `_infer_steps_from_intent()`
- 基于关键词推断意图类型

**预期执行步骤**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)` |
| 1a Plan降级 | `_infer_intent_type_from_text()` | 0 | 无 | `step.intermediate(Plan降级: 使用关键词推断)` |
| 2 执行推断步骤 | `_infer_steps_from_intent()` | 1~N | 取决于推断结果 | 取决于推断的步骤 |
| 3 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **2~N 次**（取决于降级后的步骤数）

**通过条件**：

1. ✅ Plan 降级时系统不崩溃
2. ✅ `_infer_intent_type_from_text()` 返回有效意图类型
3. ✅ `_infer_steps_from_intent()` 返回非空步骤列表
4. ✅ 前端时间线渲染降级提示
5. ✅ 事件序号连续无跳号
6. ✅ Fast-path vs Planning 判断条件：Planning 失败 → Fallback

---

### 17.8 IT-SOLO-08：复杂多步意图 — "写文章并翻译成英文发布"

**用户输入**："写一篇关于远程办公利弊的文章并翻译成英文发布"

**预期 Planner 输出**：

```json
{
  "intent_type": "write",
  "plan": [
    {"name": "搜索素材", "type": "tool", "tool": "web_search"},
    {"name": "撰写内容", "type": "agent", "agent": "article_writing"},
    {"name": "翻译", "type": "agent", "agent": "multilingual"},
    {"name": "发布", "type": "tool", "tool": "publish_local"}
  ]
}
```

**预期执行步骤**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)`, `step.intermediate(规划完成: write, 4步)`, `workflow.step.complete(planning)` |
| 2 搜索素材 | `_execute_tool_or_agent(web_search)` | 0 | web_search×1 | `tool.start(web_search)`, `tool.end(web_search)` |
| 3 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `tool.start(article_writing)`, `tool.end(article_writing)` |
| 4 翻译 | `_execute_tool_or_agent(multilingual)` | 1 | 无 | `tool.start(multilingual)`, `tool.end(multilingual)` |
| 5 发布 | `_execute_tool_or_agent(publish_local)` | 0 | publish_local×1 | `tool.start(publish_local)`, `tool.end(publish_local)` |
| 6 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **4 次**

**通过条件**：

1. ✅ Planner 规划出多步计划（≥ 3 步）
2. ✅ 前端时间线渲染的节点 ≥ 5
3. ✅ 翻译步骤输出包含英文版本
4. ✅ 发布步骤输出包含 published 字典
5. ✅ 事件序号连续无跳号
6. ✅ Fast-path vs Planning 判断条件：`_is_simple_message()` 返回 False → Planning

**前端时间线预期渲染**：

```
[Planning] 意图识别 → write (4步)
[Step 1] 搜索素材
  └── 🔧 web_search
[Step 2] 撰写内容
  └── 🤖 article_writing
[Step 3] 翻译
  └── 🤖 multilingual
[Step 4] 发布
  └── 🔧 publish_local
[Compile] 整理输出
```

---

### 17.9 Solo UI 路径覆盖矩阵

| 意图类型 | Solo UI 测试 | 关键验证 | Fast-path/Planning |
|----------|:---:|:---:|:---:|
| 简单问候 | ✅ IT-SOLO-01 | 不触发Planning | Fast-path |
| 写作意图 | ✅ IT-SOLO-02 | Planner输出write | Planning |
| 搜索意图 | ✅ IT-SOLO-03 | Planner输出search | Planning |
| 研究意图 | ✅ IT-SOLO-04 | Planner输出research | Planning |
| 翻译意图 | ✅ IT-SOLO-05 | 简单/复杂路径 | Fast-path或Planning |
| 代码意图 | ✅ IT-SOLO-06 | code_writer_agent | Planning |
| Plan降级 | ✅ IT-SOLO-07 | fallback机制 | Fallback |
| 复杂多步 | ✅ IT-SOLO-08 | 多步规划 | Planning |

---

# 第五部分：模式专项 + 前端 E2E

---

## 第十八章：模式执行器专项测试

> **注意**：以下测试在**模式执行器直接模式**下执行（非 Workflow API 路径），验证模式执行器本身的行为。

### 18.1 IT-MODE-01：ReAct 循环检测

**需求依据**：spec.md FR-ENG-03 ReAct（MAX_STEPS=8，含循环检测）；design.md 7.1

**输入数据**：
- 意图：`"反复搜索同一个问题：AI是什么？AI是什么？AI是什么？"`
- 模式：react
- 模型：`openroute/auto`

**预期执行过程**：

| 步骤 | 预期行为 |
|------|---------|
| 1~2 | 正常 Thought→Action→Observation 循环 |
| 3+ | 检测到重复 Action，触发 `react.loop_detected` 事件 |
| — | Agent 不会无限循环，steps ≤ MAX_STEPS=8 |

**通过条件**：
1. ✅ `react.loop_detected` 事件被发射
2. ✅ 总步骤数 ≤ 8（MAX_STEPS）
3. ✅ Agent 不会无限循环挂起

---

### 18.2 IT-MODE-02：Reflexion 不收敛处理

**需求依据**：spec.md FR-ENG-03 Reflexion（MAX_ITERATIONS=4，QUALITY_THRESHOLD=0.85）；design.md 7.3

**输入数据**：
- 意图：`"写一篇关于量子场论的学术论文，要求达到Nature发表水平"`（故意极高要求，LLM 难以达标）
- 模式：reflexion
- 模型：`openroute/auto`

**预期执行过程**：

| 迭代 | Actor | Evaluator | Reflector |
|------|-------|-----------|-----------|
| 1 | 生成初稿 | 评分 < 0.85 | 分析问题 |
| 2 | 基于反思改进 | 评分 < 0.85 | 分析问题 |
| 3 | 基于反思改进 | 评分 < 0.85 | 分析问题 |
| 4 | 基于反思改进 | 评分（可能仍<0.85） | — |

**通过条件**：
1. ✅ 达到 MAX_ITERATIONS=4 后停止，不会崩溃
2. ✅ 输出 `best_score` 和 `best_result`（即使未达标）
3. ✅ **三种 Prompt 不同**（Actor/Evaluator/Reflector 的 system prompt 各不相同）
4. ✅ 每轮 Evaluator 必须返回 0-1 之间的数值评分

> **⚠️ 仅模式执行器直接模式下有效，Workflow API 路径不适用**

---

### 18.3 IT-MODE-03：Agent-as-Judge 不同模型验证

**需求依据**：spec.md FR-HRN-03 反馈循环（独立评判 Agent）

**输入数据**：
- 意图：`"写一篇关于'远程办公利弊'的评论文章"`
- 配置：writing 用 `openroute/auto`，audit 用 `openroute/doubao-web/chat`

**通过条件**：
1. ✅ **audit 阶段的 LLM 模型名 ≠ writing 阶段的 LLM 模型名**（⚠️ 需代码修复前置条件B1）
2. ✅ audit 返回四维评分（design_quality/originality/craft/functionality）
3. ✅ 评分不全相同（证明不是同一模型重复评分）
4. ✅ audit 返回 verdict（pass/conditional/fail）

---

### 18.4 IT-MODE-04：代码生成（coding 档位模型）

**需求依据**：spec.md FR-CAP-04 CodeWriterAgent；design.md 8.2

**输入数据**：
- 意图：`"用Python写一个快速排序算法，要求包含注释和单元测试"`
- 模式：reflexion
- 模型：**coding 档位** `arkcode/ark-code-latest`

**通过条件**：
1. ✅ **必须使用 coding 档位模型 `arkcode/ark-code-latest`**
2. ✅ 响应必须包含可执行的 Python 代码
3. ✅ 代码应包含注释和单元测试

---

### 18.5 IT-MODE-05：Subagents 并行策略

**需求依据**：spec.md FR-MAS-01；design.md 7.4

**输入数据**：
- 意图：`"从技术、经济、社会三个角度并行分析'人工智能对教育的影响'"`
- 模式：multi_agent（strategy=subagents）

**通过条件**：
1. ✅ 3 个子任务必须并行执行
2. ✅ 每个子 Agent 必须有独立的上下文
3. ✅ 子 Agent 只暴露最小工具集
4. ✅ 子 Agent 结果必须压缩返回
5. ✅ 单个子任务失败不应影响其他子任务

---

### 18.6 IT-MODE-06：ReWOO 蓝图生成+并行执行验证

**需求依据**：spec.md FR-ENG-03 ReWOO；design.md 7.5

**输入数据**：
- 意图：`"搜索AI Agent最新框架并分析其优缺点"`
- 模式：rewoo

**预期执行过程**：

| 阶段 | 角色 | 预期行为 |
|------|------|---------|
| 1 Planner | 生成蓝图 | 输出 `[Step(action=web_search, query=...), Step(action=analyze, ...)]` |
| 2 Worker | 并行执行 | 所有工具调用步骤并行执行 |
| 3 Interpreter | 整合结果 | 基于 Worker 输出生成最终回答 |

**通过条件**：
1. ✅ Planner 生成有效的蓝图（至少 2 个步骤）
2. ✅ Worker 步骤并行执行（时间重叠 > 0s）
3. ✅ Interpreter 正确整合所有 Worker 结果
4. ✅ 蓝图中的占位符被正确替换

---

### 18.7 IT-MODE-07：SelfDiscover 模式推荐验证

**需求依据**：spec.md FR-ENG-03 Self-Discover；design.md 7.6

**输入数据**：
- 意图：`"分析这个复杂问题的最优解法"`
- 模式：self_discover

**预期执行过程**：

| 阶段 | 预期行为 |
|------|---------|
| 1 Select | 从模块库中选择合适的推理模块 |
| 2 Adapt | 适配选中的模块到当前任务 |
| 3 Implement | 生成具体的推理步骤 |
| 4 Execute | 执行推理步骤 |

**通过条件**：
1. ✅ Select 阶段输出至少 1 个推理模块
2. ✅ Adapt 阶段输出适配后的模块描述
3. ✅ Implement 阶段输出可执行的推理步骤
4. ✅ Execute 阶段正确执行并返回结果

---

### 18.8 IT-MODE-08：GraphOfThoughts 分支推理验证

**需求依据**：spec.md FR-ENG-03 Graph-of-Thoughts；design.md 7.7

**输入数据**：
- 意图：`"从多个角度分析量子计算的商业前景"`
- 模式：graph_of_thoughts

**预期执行过程**：

| 阶段 | 预期行为 |
|------|---------|
| 1 Branch | 生成多个推理分支（≥ 2） |
| 2 Score | 对每个分支评分 |
| 3 Merge | 合并高分分支 |
| 4 Refine | 精炼最终结果 |

**通过条件**：
1. ✅ 生成至少 2 个推理分支
2. ✅ 每个分支有独立评分
3. ✅ 高分分支被正确合并
4. ✅ 最终结果优于任意单分支

---

### 18.9 IT-MODE-09：Workflow on_error 四种策略组合验证

**需求依据**：spec.md FR-ENG-06 Workflow 错误处理；design.md 9.1

**输入数据**：
- 构造一个包含 4 个步骤的 Workflow，每个步骤使用不同的 on_error 策略

**预期执行过程**：

| 步骤 | on_error | 预期行为 |
|------|----------|---------|
| 1 | abort | 步骤失败 → Workflow 终止 |
| 2 | skip | 步骤失败 → 跳过，继续执行 |
| 3 | retry(max=2) | 步骤失败 → 重试最多 2 次 |
| 4 | reflexion_retry | 步骤失败 → Reflexion 分析后重试 |

**通过条件**：
1. ✅ abort 策略：步骤失败后 Workflow 状态为 error
2. ✅ skip 策略：步骤失败后 Workflow 继续执行，跳过步骤标记为 skipped
3. ✅ retry 策略：步骤失败后重试，重试次数 ≤ max
4. ✅ reflexion_retry 策略：步骤失败后触发 Reflexion 分析，基于分析结果重试

---

## 第十九章：前端 Solo/WebSocket E2E 测试

### 19.1 测试环境

- 后端: `http://localhost:8889`
- 前端: `http://localhost:5173`
- WebSocket: `ws://localhost:8889/ws/{task_id}`

### 19.2 E2E-SOLO-01：完整 ReAct Solo 流程

**操作**：浏览器打开 http://localhost:5173 → 选择 ReAct 模式 → 输入 `"百度最新的AI战略是什么"` → 提交

**预期时间线事件序列**：

```
solo.stage.enter → solo.llm.start → solo.llm.reasoning → solo.llm.end →
solo.tool.start(web_search) → solo.tool.end(web_search) →
solo.llm.start → solo.llm.reasoning → solo.llm.end →
solo.tool.start(web_scraper) → solo.tool.end(web_scraper) →
solo.llm.start → solo.llm.stream → solo.llm.end →
solo.draft.update → solo.task.completed
```

**验证点**：
1. ✅ 前端时间线正确渲染每个节点
2. ✅ 工具调用节点和 LLM 思考节点正确区分（图标/颜色）
3. ✅ 流式答案逐行渲染（solo.llm.stream）
4. ✅ 事件序号连续无跳号
5. ✅ 来源卡片（Citation）正确展示 URL
6. ✅ `eventToEntry` 正确映射所有事件类型
7. ✅ `entryToChatMessages` 正确转换为聊天消息
8. ✅ `mergeStreamingMessages` 正确合并流式消息
9. ✅ `groupMessagesIntoSteps` 正确分组

---

### 19.3 E2E-SOLO-02：Workflow 完整 Solo 流程（deep_article）

**操作**：浏览器 → Solo → 选择 deep_article Workflow → 输入 `"写一篇关于量子计算的科普文章"` → 提交

**预期时间线节点**：

```
[阶段1: 选题研究] topic_research(rewoo)
  ├── web_search × 2~3
  └── LLM 思考
[阶段2: 素材搜集] material_collection(rewoo)
  ├── web_search × 3~5
  └── LLM 思考
[阶段3: 撰写] article_writing(reflexion)
  └── LLM 思考 (1次，无迭代)
[阶段4: SEO优化] seo_optimization(plan_execute)
  └── LLM 思考
[阶段5: 事实核查] fact_check(react)
  ├── httpx HEAD × N (URL可访问性验证)
  └── LLM 思考
[阶段6: 审核] content_audit(agent_judge)
  └── LLM 思考 (模型: doubao-web/chat ← 不同于阶段1-5)
[阶段7: 人工审核] review(human) ← 暂停，可交互
[阶段8: 发布] publishing(plan_execute)
  └── 发布结果
```

**Playwright 断言代码**：

```javascript
expect(page.locator('[data-testid="timeline"]')).toBeVisible();
const stageNodes = page.locator('[data-testid="timeline-stage"]');
expect(await stageNodes.count()).toBeGreaterThanOrEqual(4);
expect(stageNodes.nth(0)).toContainText('意图识别');
expect(page.locator('[data-testid="tool-node"]').first()).toBeVisible();
expect(page.locator('[data-testid="agent-node"]').first()).toBeVisible();
expect(page.locator('[data-testid="final-answer"]')).not.toBeEmpty();
expect(page.locator('[data-testid="source-panel"]')).toBeVisible();
expect(page.locator('[data-testid="file-download"]')).toBeVisible();
```

**验证点**：
1. ✅ 8 个阶段按序渲染，无跳步
2. ✅ 阶段 6 顶部显示评审模型名（不同于阶段 1-5 的执行模型）
3. ✅ 阶段 7 渲染为"审核中"按钮，点击通过后继续
4. ✅ 阶段 3 不显示 Reflexion 迭代轮次标签
5. ✅ 来源面板始终可见，Citation 可点击跳转
6. ✅ 虚拟滚动支持 500+ 条事件

---

### 19.4 E2E-SOLO-03：WebSocket 断线重连

**操作**：Solo 执行中手动断开 WebSocket → 等待 5 秒 → 重连

**预期**：
1. ✅ 重连成功
2. ✅ 接收 replay 事件，回放断线期间丢失的事件
3. ✅ 时间线自动补全
4. ✅ 指数退避重连，最多 10 次

---

### 19.5 E2E-SOLO-04：审核交互全流程

**操作**：选择 deep_article Workflow → 等待 review 阶段暂停 → 点击"驳回" → 输入反馈 → 提交

**预期事件序列**：

```
review.ready → task.paused → (用户操作) → review.submitted(verdict=reject) → task状态=rejected
```

**验证点**：
1. ✅ review.ready 事件触发时间线暂停
2. ✅ 审核窗口期 5 分钟内可撤回
3. ✅ 用户点击"驳回" → review.submitted(verdict=reject)
4. ✅ **Persona 锁在审核暂停期间必须保留**
5. ✅ 审核完成后 persona 锁必须释放
6. ✅ Solo 前端显示审核内联块
7. ✅ 支持审核通过/驳回/编辑提交三种操作

---

## 第二十章：多模型通道矩阵

### 20.1 通道组合测试

| 测试 ID | 通道 | Workflow | 优先级 | 说明 |
|---------|------|---------|--------|------|
| **CH-01** | `openroute/auto`（API） | quick_post | P0 | API 通道基准验证 |
| **CH-02** | `openroute/doubao-web/chat`（网页版） | quick_post | P0 | 网页版需要特殊 Prompt 约束 |
| **CH-03** | `openroute/auto`（API） | deep_article | P0 | 复杂 Workflow API 验证 |
| **CH-04** | `openroute/doubao-web/chat`（网页版） | deep_article | P0 | 复杂 Workflow 网页版验证 |
| **CH-05** | `arkcode/ark-code-latest`（coding） | quick_post | P1 | coding 档位验证 |

### 20.2 通道验证通过标准

| 通道 | 验证标准 | 不通过处理 |
|------|---------|-----------|
| `openroute/auto` | quick_post 3 阶段全部完成 | 若通过，作为后续所有测试的主通道 |
| `doubao-web/chat` | quick_post 3 阶段全部完成 + 工具格式输出正确 | 若 LLM 输出格式不符：调整 Prompt |
| `arkcode/ark-code-latest` | 代码生成任务完成 | 若不支持：models.yaml 中 enabled=false |
| **网页版模型** | **LLM 必须按 Prompt 约束输出工具调用格式** | **不通过则修正 Prompt** |
| **API 版模型** | **LLM 必须正确使用 tool_calls** | **不支持则标记** |

### 20.3 网页版模型 Prompt 约束模板

当使用 doubao-web/chat 或 openroute-web 时（不支持原生 tool_calls），LLM 客户端自动在 Prompt 中注入：

```
你是FlowForge的写作Agent。你必须严格按照以下格式输出：

1. 如果需要搜索资料，输出:
   TOOL: web_search
   QUERY: <搜索关键词>

2. 如果需要抓取网页内容，输出:
   TOOL: web_scraper
   URL: <网页URL>

3. 如果最终回答，输出:
   FINAL_ANSWER:
   {"result": {...}}

注意: 不要输出任何其他格式的内容。
```

---

# 第六部分：并发 + 组合 + API 验证

---

## 第二十一章：并发 + Circuit Breaker 测试

### 21.1 IT-CONC-01：10 并发不同 persona 任务

**预期**：
1. ✅ 全部返回 201，无 409 ConflictError
2. ✅ 10 个任务全部成功完成
3. ✅ 各任务状态互不污染

### 21.2 IT-CONC-02：同 persona 并发冲突

**预期**：
1. ✅ 第 1 个返回 201
2. ✅ 第 2 个返回 409 ConflictError
3. ✅ 第 1 个完成后，同 persona 新任务可正常执行

### 21.3 IT-CB-01：连续失败触发熔断

**预期**：
1. ✅ 前 5 次返回错误
2. ✅ 第 6 次返回 Circuit Breaker 开启状态
3. ✅ 熔断后不再尝试调用

### 21.4 IT-CB-02：429 retry-after 处理

**预期**：
1. ✅ 等待 5 秒后重试
2. ✅ 重试成功
3. ✅ 日志记录 429 事件和重试行为

---

## 第二十二章：v5.0 Multi-Agent 集成测试

### 22.1 Subagents 策略测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-MA-01** | 2 个子任务并行执行 | 两个任务结果均返回，互不影响 |
| **IT-MA-02** | 子任务隔离性 | 子任务 state 修改不影响父 context |
| **IT-MA-03** | 子任务失败不影响其他 | 1 个子任务失败，其他正常返回 |
| **IT-MA-04** | 自动任务分解 | 无 sub_tasks 时自动调用 LLM 分解 |

### 22.2 Agent Teams 策略测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-AT-01** | Lead 分解 + 团队认领 | 任务被正确分解到 TaskBoard |
| **IT-AT-02** | Mailbox 通信 | 成员发送 critical 消息 → Lead 触发 replan |
| **IT-AT-03** | 空闲检测退出 | 连续 N 轮无进展 → 自动退出循环 |
| **IT-AT-04** | 任务失败处理 | 成员任务失败 → fail_task + 通知 Lead |

### 22.3 Swarms 策略测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-SW-01** | Worker 认领 + 执行 + 完成 | Worker 从 TaskBoard 认领任务并完成 |
| **IT-SW-02** | 心跳监控 | Worker 发送心跳 → Coordinator 记录 |
| **IT-SW-03** | 失联检测 | Worker 停止心跳 → Coordinator 重置其任务 |
| **IT-SW-04** | 空闲退出 | 无任务可认领 → max_empty_rounds 后退出 |
| **IT-SW-05** | 任务重试 | 任务失败 → 重试 → 超过 max_retry 后 fail |

---

## 第二十三章：v5.0 防御集成测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-DEF-01** | L1 超时 → L2 检测 → L3 修正 | 工具超时 → 重复检测 → reflexion_retry 自修正 |
| **IT-DEF-02** | 防御配置传递 | `ctx.metadata["defense"]` 正确合并到步骤级 |
| **IT-DEF-03** | SOP 模板渲染 | `{{variable}}` 被正确替换 |
| **IT-DEF-04** | Checkpoint 入口保存 | checkpoint_enabled=True 时自动保存检查点 |

---

## 第二十四章：跨 Workflow 组合测试

### 24.1 IT-CROSS-01：先后执行两个 Workflow

**预期**：
1. ✅ 两个 Workflow 独立完成，状态不互相污染
2. ✅ 第 1 个 Workflow 的 Memory 数据在第 2 个中可查询到
3. ✅ Persona 锁正确释放

### 24.2 IT-CROSS-02：deep_article → multi_platform 链式

**预期**：
1. ✅ multi_platform 可以复用 deep_article 的 draft 和 materials
2. ✅ 两个 Workflow 的 publish 输出不同

---

## 第二十五章：API 业务正确性验证

### 25.1 API-01：模式列表验证

**验证**：
1. ✅ 返回 9 种模式
2. ✅ 每个模式包含完整字段
3. ✅ 不包含未注册的垃圾模式

### 25.2 API-02：任务创建验证

**验证**：
1. ✅ 返回 task_id（非空 UUID）
2. ✅ 返回 status=pending
3. ✅ 返回 mode/persona 字段与请求一致

### 25.3 API-03：任务状态转换验证

**验证**：
1. ✅ 状态转换序列：pending → running → completed/error
2. ✅ running 状态包含 current_step 信息
3. ✅ completed 状态包含 result 字段
4. ✅ 不存在从 completed 回退到 running

---

# 第七部分：报告 + 工具

---

## 第二十六章：E2E Web UI 测试

| 用例 ID | 场景 | 用户操作 | 预期 |
|---------|------|---------|------|
| **E2E-01** | 创建并完成普通任务 | 仪表盘 → 填入意图 → 选择模式 → 提交 | 任务创建成功 |
| **E2E-02** | 审核流程 | 审核中心 → 预览草稿 → 通过 | 任务状态变为 published |
| **E2E-03** | 驳回流程 | 审核中心 → 预览草稿 → 驳回 + 反馈 | 任务状态变为 rejected |
| **E2E-04** | Solo 模式实时交互 | 创建 Solo 任务 → WebSocket 连接 → 观察实时事件流 | 执行流展示全部工具调用和 LLM 思考过程 |
| **E2E-05** | Solo 模式审核 | Solo 模式中点击通过/驳回 | 任务继续执行到 publish |
| **E2E-06** | 定时任务管理 | 创建 Cron 任务 → 等待触发 | 定时触发创作 |
| **E2E-07** | 模型健康管理 | 查看模型列表 → 触发健康检查 | 模型状态更新 |
| **E2E-08** | 插件管理 | 查看已加载插件 → 安装新插件 → 重载 | 新插件可用 |

---

## 第二十七章：性能测试基准

### 27.1 压力测试指标

| 指标 | 目标 | 测试方法 |
|------|------|---------|
| **单 Agent 执行延迟** | < 2s (不含 LLM API 耗时) | 100 次 TopicAgent.execute() 取 P95 |
| **Workflow 8 步骤执行** | < 30s (不含 LLM API 耗时) | 10 次 deep_article Workflow 取均值 |
| **Reflexion 3 迭代** | < 15s (不含 LLM API 耗时) | 10 次 Reflexion Writer 取均值 |
| **并发创建 10 个不同 persona 任务** | 全部成功，无锁冲突 | 10 并发 POST /tasks |
| **WebSocket 事件延迟** | < 50ms (P95) | Solo 模式下 tool.start 到前端接收 |
| **插件加载时间** | < 500ms (10 个插件) | 启动时扫描 entry_points + YAML |
| **沙箱代码执行** | 启动延迟 < 100ms | 100 次 PythonExecutorTool 取均值 |

### 27.2 测试覆盖率目标

| 模块 | 目标覆盖率 | 关键覆盖项 |
|------|-----------|-----------|
| `core/` | ≥ 90% | BaseAgent, BaseTool, TaskContext, DI, Errors, CheckpointManager |
| `modes/` | ≥ 85% | 所有 9 种执行器 + MultiAgent + Workflow |
| `events/` | ≥ 90% | EventBus, SoloAdapter |
| `tools/` | ≥ 85% | Registry, SecureToolRegistry, Sandbox, LLMClient |
| `memory/` | ≥ 85% | MemoryManager, TaskBoard, Mailbox, ContextCompressor |
| `executor/` | ≥ 80% | HybridExecutor, StateManager |
| `plugins/` | ≥ 75% | PluginManager, entry_points 加载 |

---

## 第二十八章：MetricsCollector 实现（可执行代码）

> **⚠️ v8.0 升级**：从"设计文档"升级为"可执行代码"，包含 EventBus 订阅、pytest fixture 集成、自动报告生成、28 项指标全部采集

```python
# tests/metrics_collector.py

import time
import json
from typing import Any


class TestMetricsCollector:
    """测试指标收集器 — 通过 EventBus 订阅自动采集 28 项指标"""
    
    def __init__(self, event_bus, task_id: str):
        self.task_id = task_id
        self.llm_calls = []
        self.tool_calls = []
        self.agent_calls = []
        self.workflow_steps = []
        self.memory_queries = 0
        self.memory_writes = 0
        self.events = []
        self.start_time = None
        self.end_time = None
        
        # 订阅所有事件
        event_bus.subscribe(f"{task_id}.*", self._on_event)
        event_bus.subscribe("llm.start", self._on_llm_start)
        event_bus.subscribe("llm.end", self._on_llm_end)
        event_bus.subscribe("tool.start", self._on_tool_start)
        event_bus.subscribe("tool.end", self._on_tool_end)
        event_bus.subscribe("agent.start", self._on_agent_start)
        event_bus.subscribe("agent.end", self._on_agent_end)
        event_bus.subscribe("workflow.step.start", self._on_step_start)
        event_bus.subscribe("workflow.step.complete", self._on_step_complete)
    
    def _on_event(self, data: Any):
        self.events.append({"time": time.time(), "data": data})
    
    def _on_llm_start(self, data: Any):
        self.llm_calls.append({
            "start": time.time(),
            "model": data.get("model"),
            "agent": data.get("agent_name"),
        })
    
    def _on_llm_end(self, data: Any):
        if self.llm_calls:
            self.llm_calls[-1]["end"] = time.time()
            self.llm_calls[-1]["tokens"] = data.get("usage", {})
    
    def _on_tool_start(self, data: Any):
        self.tool_calls.append({
            "start": time.time(),
            "tool": data.get("tool_name"),
            "step": data.get("step"),
        })
    
    def _on_tool_end(self, data: Any):
        if self.tool_calls:
            self.tool_calls[-1]["end"] = time.time()
            self.tool_calls[-1]["success"] = data.get("success", False)
    
    def _on_agent_start(self, data: Any):
        self.agent_calls.append({
            "start": time.time(),
            "agent": data.get("agent_name"),
        })
    
    def _on_agent_end(self, data: Any):
        if self.agent_calls:
            self.agent_calls[-1]["end"] = time.time()
            self.agent_calls[-1]["success"] = data.get("success", True)
    
    def _on_step_start(self, data: Any):
        self.workflow_steps.append({
            "start": time.time(),
            "step": data.get("step_name"),
        })
    
    def _on_step_complete(self, data: Any):
        if self.workflow_steps:
            self.workflow_steps[-1]["end"] = time.time()
            self.workflow_steps[-1]["success"] = data.get("success", True)
    
    def _group_by(self, items: list, key: str) -> dict:
        result = {}
        for item in items:
            k = item.get(key, "unknown")
            result[k] = result.get(k, 0) + 1
        return result
    
    def _calc_latencies(self, items: list) -> dict:
        latencies = []
        for item in items:
            if "start" in item and "end" in item:
                latencies.append((item["end"] - item["start"]) * 1000)
        if not latencies:
            return {"p50": 0, "p95": 0, "p99": 0}
        latencies.sort()
        return {
            "p50": latencies[len(latencies) // 2],
            "p95": latencies[int(len(latencies) * 0.95)],
            "p99": latencies[int(len(latencies) * 0.99)],
        }
    
    def generate_report(self) -> dict:
        llm_by_agent = self._group_by(self.llm_calls, "agent")
        tool_by_name = self._group_by(self.tool_calls, "tool")
        agent_by_name = self._group_by(self.agent_calls, "agent")
        step_by_name = self._group_by(self.workflow_steps, "step")

        llm_tokens_in = sum(c.get("tokens", {}).get("prompt_tokens", 0) for c in self.llm_calls if "tokens" in c)
        llm_tokens_out = sum(c.get("tokens", {}).get("completion_tokens", 0) for c in self.llm_calls if "tokens" in c)

        return {
            "task_id": self.task_id,
            "total_duration": self.end_time - self.start_time if self.end_time and self.start_time else None,
            "llm": {
                "total_calls": len(self.llm_calls),
                "by_agent": llm_by_agent,
                "tokens_in": llm_tokens_in,
                "tokens_out": llm_tokens_out,
                "latencies_ms": self._calc_latencies(self.llm_calls),
            },
            "tool": {
                "total_calls": len(self.tool_calls),
                "by_name": tool_by_name,
                "chain": [c.get("tool") for c in self.tool_calls],
                "success_rate": sum(1 for c in self.tool_calls if c.get("success")) / max(len(self.tool_calls), 1),
                "latencies_ms": self._calc_latencies(self.tool_calls),
            },
            "agent": {
                "total_calls": len(self.agent_calls),
                "by_name": agent_by_name,
                "latencies_ms": self._calc_latencies(self.agent_calls),
            },
            "workflow": {
                "total_steps": len(self.workflow_steps),
                "by_name": step_by_name,
                "latencies_ms": self._calc_latencies(self.workflow_steps),
            },
            "memory": {
                "query_count": self.memory_queries,
                "write_count": self.memory_writes,
            },
            "events": {
                "total": len(self.events),
                "by_type": self._group_by(self.events, "type") if self.events else {},
            },
        }


# pytest fixture 集成
import pytest

@pytest.fixture
def metrics_collector(event_bus, task_id):
    """自动采集测试指标的 fixture"""
    collector = TestMetricsCollector(event_bus, task_id)
    collector.start_time = time.time()
    yield collector
    collector.end_time = time.time()
    report = collector.generate_report()
    # 自动保存指标报告
    report_path = f"test_reports/metrics_{task_id}_{int(time.time())}.json"
    os.makedirs("test_reports", exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n📊 Metrics report saved to {report_path}")
    return report


@pytest.fixture
def assert_metrics(metrics_collector):
    """指标断言辅助 fixture"""
    class MetricsAsserter:
        def __init__(self, collector):
            self.collector = collector

        def assert_llm_count(self, min_calls: int, max_calls: int):
            actual = len(self.collector.llm_calls)
            assert min_calls <= actual <= max_calls, \
                f"LLM calls {actual} not in range [{min_calls}, {max_calls}]"

        def assert_tool_chain(self, expected_chain: list):
            actual = [c.get("tool") for c in self.collector.tool_calls]
            for tool in expected_chain:
                assert tool in actual, f"Expected tool '{tool}' not found in chain {actual}"

        def assert_agent_called(self, agent_name: str):
            actual = [c.get("agent") for c in self.collector.agent_calls]
            assert agent_name in actual, f"Agent '{agent_name}' not called. Called: {actual}"

        def assert_step_order(self, expected_steps: list):
            actual = [c.get("step") for c in self.collector.workflow_steps]
            for i, step in enumerate(expected_steps):
                if i < len(actual):
                    assert actual[i] == step, \
                        f"Step {i}: expected '{step}', got '{actual[i]}'"

        def assert_memory_ops(self, min_queries: int = 0, min_writes: int = 0):
            assert self.collector.memory_queries >= min_queries, \
                f"Memory queries {self.collector.memory_queries} < {min_queries}"
            assert self.collector.memory_writes >= min_writes, \
                f"Memory writes {self.collector.memory_writes} < {min_writes}"

        def assert_no_tool_errors(self):
            errors = [c for c in self.collector.tool_calls if not c.get("success")]
            assert len(errors) == 0, f"Tool errors: {errors}"

    return MetricsAsserter(metrics_collector)
```

**使用示例**：

```python
@pytest.mark.real_llm
@pytest.mark.integration
async def test_deep_article_workflow(metrics_collector, assert_metrics):
    """IT-WF-API-01: deep_article 全流程"""
    # ... 执行 Workflow ...

    # 指标断言
    assert_metrics.assert_llm_count(8, 11)
    assert_metrics.assert_agent_called("topic_research")
    assert_metrics.assert_agent_called("article_writing")
    assert_metrics.assert_agent_called("content_audit")
    assert_metrics.assert_tool_chain(["opensieve_search", "web_search"])
    assert_metrics.assert_step_order([
        "topic_research", "material_collection", "article_writing",
        "seo_optimization", "fact_check", "content_audit", "review", "publish"
    ])
    assert_metrics.assert_memory_ops(min_queries=2, min_writes=1)
    assert_metrics.assert_no_tool_errors()
```

---

## 第二十九章：通用 Agent 与通用 Workflow 测试

> **⚠️ v8.0 新增**：覆盖 14 个通用 Agent 和 5 个通用 Workflow 模板（来源：testreview_glm P1-5/P1-6）

### 29.1 通用 Agent 单元测试

`flowforge/agents/generic/` 下 14 个通用 Agent 的单元测试矩阵：

| 用例 ID | Agent | 测试重点 | 预期行为 |
|---------|-------|---------|---------|
| UT-GA-01 | AnalystAgent | 分析任务执行 | 接收分析指令 → LLM 调用 → 返回分析结果 |
| UT-GA-02 | ApproverAgent | 审批决策 | 接收审批内容 → LLM 评估 → 返回 approve/reject |
| UT-GA-03 | CriticAgent | 批评评审 | 接收内容 → LLM 批评 → 返回改进建议 |
| UT-GA-04 | DelivererAgent | 交付输出 | 接收最终内容 → 格式化 → 返回交付物 |
| UT-GA-05 | DrafterAgent | 草稿撰写 | 接收主题 → LLM 生成 → 返回草稿 |
| UT-GA-06 | ExecutorAgent | 任务执行 | 接收执行指令 → 工具调用 → 返回执行结果 |
| UT-GA-07 | FinalizerAgent | 最终整合 | 接收多步结果 → LLM 整合 → 返回最终输出 |
| UT-GA-08 | GeneratorAgent | 内容生成 | 接收生成参数 → LLM 生成 → 返回内容 |
| UT-GA-09 | PlannerAgent | 规划分解 | 接收目标 → LLM 规划 → 返回步骤列表 |
| UT-GA-10 | ProcessorAgent | 数据处理 | 接收原始数据 → 处理转换 → 返回处理结果 |
| UT-GA-11 | ReactActorAgent | ReAct 行动 | 接收观察 → 选择工具 → 执行 → 返回行动结果 |
| UT-GA-12 | ReactObserverAgent | ReAct 观察 | 接收行动结果 → 提取信息 → 返回观察 |
| UT-GA-13 | ReactThinkerAgent | ReAct 思考 | 接收观察 → LLM 推理 → 返回思考 |
| UT-GA-14 | RefinerAgent | 迭代优化 | 接收草稿+反馈 → LLM 优化 → 返回改进版 |
| UT-GA-15 | ReviewerAgent | 评审打分 | 接收内容 → LLM 评审 → 返回评分+意见 |
| UT-GA-16 | ValidatorAgent | 验证检查 | 接收内容 → 规则验证 → 返回 pass/fail |
| UT-GA-17 | VerifierAgent | 事实核查 | 接收声明 → 工具验证 → 返回验证结果 |

**通用测试模板**：

```python
import pytest
from flowforge.agents.generic import (
    AnalystAgent, ApproverAgent, CriticAgent, DelivererAgent,
    DrafterAgent, ExecutorAgent, FinalizerAgent, GeneratorAgent,
    PlannerAgent, ProcessorAgent, ReactActorAgent, ReactObserverAgent,
    ReactThinkerAgent, RefinerAgent, ReviewerAgent, ValidatorAgent, VerifierAgent,
)

GENERIC_AGENTS = [
    ("analyst", AnalystAgent),
    ("approver", ApproverAgent),
    ("critic", CriticAgent),
    ("deliverer", DelivererAgent),
    ("drafter", DrafterAgent),
    ("executor", ExecutorAgent),
    ("finalizer", FinalizerAgent),
    ("generator", GeneratorAgent),
    ("planner", PlannerAgent),
    ("processor", ProcessorAgent),
    ("react_actor", ReactActorAgent),
    ("react_observer", ReactObserverAgent),
    ("react_thinker", ReactThinkerAgent),
    ("refiner", RefinerAgent),
    ("reviewer", ReviewerAgent),
    ("validator", ValidatorAgent),
    ("verifier", VerifierAgent),
]

@pytest.mark.parametrize("agent_name,agent_class", GENERIC_AGENTS)
async def test_generic_agent_execute(agent_name, agent_class, mock_llm_tool):
    """每个通用 Agent 必须实现 execute_with_context 且返回有效输出"""
    agent = agent_class()
    # 验证基类继承
    assert hasattr(agent, "execute_with_context"), f"{agent_name} 缺少 execute_with_context"
    # 验证默认属性
    assert hasattr(agent, "name") or hasattr(agent, "agent_name")
    # 验证 execute 返回结构
    from flowforge.core.interfaces import AgentInput
    result = await agent.execute_with_context(
        AgentInput(params={"task": f"test_{agent_name}_task"}), None
    )
    assert result is not None, f"{agent_name} 返回 None"

@pytest.mark.parametrize("agent_name,agent_class", GENERIC_AGENTS)
async def test_generic_agent_llm_call(agent_name, agent_class, metrics_collector):
    """每个通用 Agent 执行时必须调用 LLM（至少 1 次）"""
    agent = agent_class()
    from flowforge.core.interfaces import AgentInput
    await agent.execute_with_context(
        AgentInput(params={"task": f"test_{agent_name}_task"}), None
    )
    assert_metrics.assert_llm_count(1, 10)  # 至少 1 次 LLM 调用
```

### 29.2 通用 Workflow 模板 E2E 测试

5 个通用 Workflow 模板：

| 用例 ID | Workflow 模板 | 步骤数 | 测试重点 |
|---------|-------------|--------|---------|
| IT-GEN-WF-01 | generic_pipeline | 4~6 | 线性流水线：Drafter → Reviewer → Refiner → Deliverer |
| IT-GEN-WF-02 | generic_iterative | 3~5 | 迭代优化：Drafter → [Reviewer → Refiner]×N → Deliverer |
| IT-GEN-WF-03 | generic_plan_execute | 3~4 | 规划执行：Planner → [Executor]×N → Finalizer |
| IT-GEN-WF-04 | generic_react | 2~4 | ReAct 循环：Thinker → [Actor → Observer]×N → Finalizer |
| IT-GEN-WF-05 | generic_review | 3~5 | 评审流程：Drafter → [Critic → Refiner]×N → Approver |

#### IT-GEN-WF-01：generic_pipeline 线性流水线

**输入**：
```json
{
  "workflow": "generic_pipeline",
  "persona": "tech",
  "input": {
    "topic": "AI Agent 架构设计最佳实践",
    "requirements": "技术深度文章，3000字以上"
  }
}
```

**预期执行过程**：

| 阶段 | Agent | 预期 LLM 次数 | 预期工具调用 |
|------|-------|-------------|------------|
| 1. 起草 | DrafterAgent | 1 | 无 |
| 2. 评审 | ReviewerAgent | 1 | 无 |
| 3. 优化 | RefinerAgent | 1 | 无 |
| 4. 交付 | DelivererAgent | 1 | publish_local |

**通过条件**：
1. ✅ 4 个 Agent 按序执行
2. ✅ 总 LLM 调用 4~6 次
3. ✅ 最终输出包含完整内容
4. ✅ ReviewerAgent 返回评分和改进建议
5. ✅ RefinerAgent 的输出质量优于 DrafterAgent 的初稿

**预期输出 JSON 结构**：
```json
{
  "draft": {"type": "string", "min_length": 500},
  "review": {
    "score": {"type": "float", "range": [0, 1]},
    "suggestions": {"type": "array", "min_length": 1}
  },
  "refined_draft": {"type": "string", "min_length": 500},
  "delivered": {
    "content": {"type": "string"},
    "format": {"type": "string"},
    "published_path": {"type": "string"}
  }
}
```

**调用路径验证**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| 起草 | DrafterAgent → LLM.generate | 检查 agent.start 事件 |
| 评审 | ReviewerAgent → LLM.assess | 检查 llm.start 的 prompt 包含评审指令 |
| 优化 | RefinerAgent → LLM.refine | 检查 llm.start 的 prompt 包含改进建议 |
| 交付 | DelivererAgent → publish_local | 检查 tool.start 事件 |

#### IT-GEN-WF-02：generic_iterative 迭代优化

**输入**：
```json
{
  "workflow": "generic_iterative",
  "persona": "education",
  "input": {
    "topic": "Python 异步编程入门指南",
    "max_iterations": 3,
    "quality_threshold": 0.8
  }
}
```

**预期执行过程**：

| 阶段 | Agent | 预期 LLM 次数 | 说明 |
|------|-------|-------------|------|
| 1. 起草 | DrafterAgent | 1 | 生成初稿 |
| 2. 评审 | ReviewerAgent | 1 | 评分 < 0.8 → 继续迭代 |
| 3. 优化 | RefinerAgent | 1 | 基于反馈优化 |
| 4. 再评审 | ReviewerAgent | 1 | 评分 ≥ 0.8 → 停止 |
| 5. 交付 | DelivererAgent | 1 | 最终交付 |

**通过条件**：
1. ✅ 迭代次数 ≤ max_iterations
2. ✅ 每次迭代 ReviewerAgent 返回评分
3. ✅ 评分呈递增趋势
4. ✅ 最终评分 ≥ quality_threshold 或达到 max_iterations
5. ✅ 总 LLM 调用 3~7 次（取决于迭代次数）

#### IT-GEN-WF-03：generic_plan_execute 规划执行

**输入**：
```json
{
  "workflow": "generic_plan_execute",
  "persona": "life",
  "input": {
    "goal": "策划一次周末家庭出游方案",
    "constraints": "预算500元以内，适合5岁儿童"
  }
}
```

**通过条件**：
1. ✅ PlannerAgent 生成步骤列表（≥ 2 步）
2. ✅ 每个步骤由 ExecutorAgent 执行
3. ✅ FinalizerAgent 整合所有步骤结果
4. ✅ 总 LLM 调用 3~6 次

#### IT-GEN-WF-04：generic_react ReAct 循环

**输入**：
```json
{
  "workflow": "generic_react",
  "persona": "tech",
  "input": {
    "task": "查找2024年诺贝尔物理学奖得主及其主要贡献",
    "max_steps": 5
  }
}
```

**通过条件**：
1. ✅ ThinkerAgent → ActorAgent → ObserverAgent 循环执行
2. ✅ 循环次数 ≤ max_steps
3. ✅ ActorAgent 调用工具（web_search 等）
4. ✅ 最终 FinalizerAgent 输出答案
5. ✅ 总 LLM 调用 3~10 次

#### IT-GEN-WF-05：generic_review 评审流程

**输入**：
```json
{
  "workflow": "generic_review",
  "persona": "finance",
  "input": {
    "topic": "2024年A股市场回顾与2025年展望",
    "review_rounds": 2
  }
}
```

**通过条件**：
1. ✅ DrafterAgent 生成初稿
2. ✅ CriticAgent 提出批评意见
3. ✅ RefinerAgent 基于批评优化
4. ✅ ApproverAgent 最终审批
5. ✅ 总 LLM 调用 4~8 次

### 29.3 通用 Agent 覆盖矩阵

| Agent | 单元测试 | Workflow 集成 | 使用的模板 |
|-------|:---:|:---:|---------|
| AnalystAgent | ✅ UT-GA-01 | — | — |
| ApproverAgent | ✅ UT-GA-02 | ✅ IT-GEN-WF-05 | generic_review |
| CriticAgent | ✅ UT-GA-03 | ✅ IT-GEN-WF-05 | generic_review |
| DelivererAgent | ✅ UT-GA-04 | ✅ IT-GEN-WF-01/02 | generic_pipeline/iterative |
| DrafterAgent | ✅ UT-GA-05 | ✅ IT-GEN-WF-01/02/05 | 全部含起草 |
| ExecutorAgent | ✅ UT-GA-06 | ✅ IT-GEN-WF-03 | generic_plan_execute |
| FinalizerAgent | ✅ UT-GA-07 | ✅ IT-GEN-WF-03/04 | generic_plan_execute/react |
| GeneratorAgent | ✅ UT-GA-08 | — | — |
| PlannerAgent | ✅ UT-GA-09 | ✅ IT-GEN-WF-03 | generic_plan_execute |
| ProcessorAgent | ✅ UT-GA-10 | — | — |
| ReactActorAgent | ✅ UT-GA-11 | ✅ IT-GEN-WF-04 | generic_react |
| ReactObserverAgent | ✅ UT-GA-12 | ✅ IT-GEN-WF-04 | generic_react |
| ReactThinkerAgent | ✅ UT-GA-13 | ✅ IT-GEN-WF-04 | generic_react |
| RefinerAgent | ✅ UT-GA-14 | ✅ IT-GEN-WF-01/02/05 | 全部含优化 |
| ReviewerAgent | ✅ UT-GA-15 | ✅ IT-GEN-WF-01/02 | generic_pipeline/iterative |
| ValidatorAgent | ✅ UT-GA-16 | — | — |
| VerifierAgent | ✅ UT-GA-17 | — | — |

---

## 第三十章：测试执行顺序

> **⚠️ v8.0 更新**：增加代码修复前置清单验证（B1-B4）、通用 Workflow 测试、模式执行器补全

```
Phase 0: 代码修复（测试前置条件）
  ├── B1: 修复 ContentAuditAgent 支持 judge_model 参数
  ├── B2: 修复 _execute_parallel 数据竞争 (deepcopy context_data)
  ├── B3: 修复 WorkflowExecutor mode executor 回退（可选）
  ├── B4: 配置 conftest_e2e.py 真实 LLM 测试环境
  └── 验证: doubao-web/chat 模型名已更新（无 seed-2.0 残留）

Phase 0-Pre: 模型名验证
  ├── GET http://localhost:13000/v1/models → 验证模型列表中无 "seed-2.0"
  ├── GET http://localhost:13000/v1/models → 验证包含 "doubao-web/chat"
  └── POST http://localhost:13000/v1/chat/completions (model="doubao-web/chat") → 验证可调用

Phase 1: 模型通道健康检查
  ├── doubao-api ping → PASS/FAIL
  ├── doubao-web/chat ping → PASS/FAIL
  ├── openroute-api ping → PASS/FAIL
  └── openroute-web ping → PASS/FAIL

Phase 2: 通道快速验证 (quick_post × 通道)
  ├── CH-01: openroute/api → PASS/FAIL
  ├── CH-02: doubao-web/chat → PASS/FAIL (FAIL → 修正 Prompt)
  ├── CH-03: openroute/api (deep_article) → PASS/FAIL
  ├── CH-04: doubao-web/chat (deep_article) → PASS/FAIL
  └── CH-05: arkcode/ark-code-latest → PASS/FAIL

Phase 3: Workflow API 路径 E2E (以通过的主通道为准)
  ├── IT-WF-API-01: deep_article (8 步)
  ├── IT-WF-API-02: quick_post (3 步)
  ├── IT-WF-API-03: trend_article (4 步) ← 验证 web_search 必须成功
  ├── IT-WF-API-04: seo_content (6 步) ← FactCheckAgent 用 httpx HEAD
  ├── IT-WF-API-05: report_generation (8+并行) ← 验证并行输出独立
  ├── IT-WF-API-06: multilingual (5 步)
  ├── IT-WF-API-07: multi_platform (4 步)
  └── IT-WF-API-08: image_article (5 步)

Phase 4: Solo UI 路径 E2E（按意图类型）
  ├── IT-SOLO-01: write 意图（深度文章）
  ├── IT-SOLO-02: write 意图（快速帖子）
  ├── IT-SOLO-03: research 意图（趋势分析）
  ├── IT-SOLO-04: optimize 意图（SEO 优化）
  ├── IT-SOLO-05: analyze 意图（报告生成）
  ├── IT-SOLO-06: translate 意图（多语言）
  ├── IT-SOLO-07: adapt 意图（多平台适配）
  ├── IT-SOLO-08: fast-path（简单消息）
  └── IT-SOLO-09: plan-fallback（Planner 空计划降级）

Phase 5: 模式执行器专项（9 种全覆盖）
  ├── IT-MODE-01: ReAct 循环检测
  ├── IT-MODE-02: Reflexion 不收敛
  ├── IT-MODE-03: Agent-as-Judge 不同模型
  ├── IT-MODE-04: 代码生成 coding 模型
  ├── IT-MODE-05: Subagents 并行
  ├── IT-MODE-06: ReWOO 蓝图生成+并行执行
  ├── IT-MODE-07: Self-Discover 模式推荐
  ├── IT-MODE-08: Graph-of-Thoughts 分支推理
  └── IT-MODE-09: Workflow on_error 四种策略

Phase 6: 通用 Workflow 模板 E2E
  ├── IT-GEN-WF-01: generic_pipeline 线性流水线
  ├── IT-GEN-WF-02: generic_iterative 迭代优化
  ├── IT-GEN-WF-03: generic_plan_execute 规划执行
  ├── IT-GEN-WF-04: generic_react ReAct 循环
  └── IT-GEN-WF-05: generic_review 评审流程

Phase 7: 前端 Playwright E2E
  ├── E2E-SOLO-01: ReAct Solo 流程
  ├── E2E-SOLO-02: Workflow Solo 流程
  ├── E2E-SOLO-03: WebSocket 断线重连
  └── E2E-SOLO-04: 审核交互

Phase 8: 并发 + Circuit Breaker
  ├── IT-CONC-01: 10 并发不同 persona
  ├── IT-CONC-02: 同 persona 冲突
  ├── IT-CB-01: 熔断触发
  └── IT-CB-02: 429 重试

Phase 9: 跨 Workflow 组合
  ├── IT-CROSS-01: deep_article → quick_post
  └── IT-CROSS-02: deep_article → multi_platform

Phase 10: API 业务正确性
  ├── API-01: 模式列表
  ├── API-02: 任务创建
  └── API-03: 状态转换

Phase 11: 生成报告
  ├── e2e_summary_{date}.md
  ├── e2e_metrics_{date}.json
  └── prompt_issues_{date}.md
```

---

## 第三十一章：需求追溯矩阵

> **⚠️ v8.0 更新**：增加通用 Agent/Workflow 测试、模式执行器补全、Solo UI 按意图类型

| 测试用例 | 规格需求 | 架构设计 | 详细设计 | 审视缺陷 | v8.0 变化 |
|---------|---------|---------|---------|---------|----------|
| IT-WF-API-01 | FR-CAP-06 #1 | 6.5 Workflow #1 | 9.1 | 缺陷2/5/6/8/9 | +调用路径验证+预期输出JSON+Memory指标 |
| IT-WF-API-02 | FR-CAP-06 #2 | 6.5 Workflow #2 | 9.1 | 缺陷2/9 | +调用路径验证+预期输出JSON+Memory指标 |
| IT-WF-API-03 | FR-CAP-06 #3 | 6.5 Workflow #3 | 9.1 | 缺陷2/5 | +web_search必须成功断言+Memory指标 |
| IT-WF-API-04 | FR-CAP-06 #5 | 6.5 Workflow #5 | 9.1 | 缺陷2 | +FactCheck用httpx HEAD+预期输出JSON |
| IT-WF-API-05 | FR-CAP-06 #8 | 6.5 Workflow #8 | 9.1 | 缺陷2/8 | +并行数据竞争验证(B2)+Memory指标 |
| IT-WF-API-06 | FR-CAP-06 #7 | 6.5 Workflow #7 | 9.1 | 缺陷2 | +调用路径验证+预期输出JSON |
| IT-WF-API-07 | FR-CAP-06 #4 | 6.5 Workflow #4 | 9.1 | 缺陷2 | +调用路径验证+预期输出JSON |
| IT-WF-API-08 | FR-CAP-06 #6 | 6.5 Workflow #6 | 9.1 | 缺陷2/8 | +调用路径验证+预期输出JSON |
| IT-SOLO-01~09 | FR-SOL-01~04 | 10.6 | 5.2 | 缺陷4 | **重写**: 按意图类型设计+fast-path+plan-fallback |
| IT-MODE-01 | FR-ENG-03 | 5.1 ReAct | 7.1 | 缺陷5 | — |
| IT-MODE-02 | FR-ENG-03 | 5.1 Reflexion | 7.3 | 缺陷5 | — |
| IT-MODE-03 | FR-HRN-03 | 7.4 FeedbackLoop | 14.5 | 缺陷8 | — |
| IT-MODE-04 | FR-CAP-04 | 6.4 | 8.2 | 缺陷7 | — |
| IT-MODE-05 | FR-MAS-01 | 10.3 | 7.4 | 缺陷10 | — |
| IT-MODE-06 | FR-ENG-03 | 5.1 ReWOO | 7.5 | — | **v8.0 新增** |
| IT-MODE-07 | FR-ENG-03 | 5.1 SelfDiscover | 7.6 | — | **v8.0 新增** |
| IT-MODE-08 | FR-ENG-03 | 5.1 GraphOfThoughts | 7.7 | — | **v8.0 新增** |
| IT-MODE-09 | FR-CAP-06 | 6.5 | 9.1 | — | **v8.0 新增** |
| IT-GEN-WF-01~05 | FR-EXT-02 | 6.6 | 9.2 | — | **v8.0 新增**: 通用Workflow模板 |
| UT-GA-01~17 | FR-EXT-02 | 6.6 | 9.2 | — | **v8.0 新增**: 通用Agent单元测试 |
| E2E-SOLO-01~04 | FR-SOL-01~04 | 10.6 | 5.2 | 缺陷4 | — |
| CH-01~05 | FR-CAP-01 | 10.4 | 11.1 | 缺陷7 | — |
| IT-CONC-01~02 | FR-ENG-01 | 12.2 | 4.2 | 缺陷10 | — |
| IT-CB-01~02 | 4.3可靠性 | 9.2 | 16.3 | 缺陷10 | — |
| IT-CROSS-01~02 | — | — | — | 缺陷11 | — |
| API-01~03 | FR-ENG-01~06 | 4.7 | 4.2 | 缺陷3 | — |
| UT-CORE-01~10 | FR-ENG-01~06 | 4.1~4.6 | 3.1~3.6 | — | — |
| UT-DI-01~05 | FR-ENG-02 | 4.2 | 3.2 | — | — |
| UT-EVT-01~08 | FR-ENG-04 | 4.3 | 3.3 | — | — |
| UT-SOLO-01~04 | FR-SOL-01~04 | 10.6 | 5.2 | — | — |
| UT-MOD-01~08 | FR-ENG-03 | 5.1 | 7.1 | — | — |
| UT-REACT-01~05 | FR-ENG-03 | 5.1 ReAct | 7.1 | — | — |
| UT-PE-01~03 | FR-ENG-03 | 5.1 PlanExecute | 7.2 | — | — |
| UT-REF-01~05 | FR-ENG-03 | 5.1 Reflexion | 7.3 | — | — |
| UT-DLLM-01~04 | FR-ENG-03 | 5.1 | 7.3 | — | — |
| UT-WF-01~08 | FR-CAP-06 | 6.5 | 9.1 | — | — |
| UT-HE-01~03 | FR-ENG-01 | 12.2 | 4.2 | — | — |
| UT-PLG-01~07 | FR-EXT-01 | 11.1 | 10.1 | — | — |
| UT-SBOX-01~08 | FR-SEC-01 | 11.2 | 10.2 | — | — |
| UT-LLM-01~05 | FR-CAP-01 | 10.4 | 11.1 | — | — |
| UT-MEM-01~06 | FR-ENG-05 | 8.1 | 6.1 | — | — |
| UT-DEF-01~05 | FR-DEF-01 | 9.1 | 16.1 | — | — |
| UT-SEC-01~06 | FR-SEC-01 | 9.2 | 16.2 | — | — |
| UT-TB-01~08 | FR-MAS-02 | 10.1 | 7.5 | — | — |
| UT-MB-01~08 | FR-MAS-02 | 10.2 | 7.5 | — | — |
| UT-CMP-01~05 | FR-ENG-05 | 8.2 | 6.2 | — | — |
| UT-CP-01~08 | FR-ENG-06 | 8.3 | 6.3 | — | — |
| IT-API-01~27 | FR-ENG-01~06 | 4.7 | 4.2 | 缺陷3 | — |
| IT-SOP-01~07 | FR-CAP-06 | 6.5 | 9.1 | — | — |
| IT-PLG-01~05 | FR-EXT-01 | 11.1 | 10.1 | — | — |
| IT-XP-01~05 | FR-PLT-01 | 11.3 | 10.3 | — | — |
| IT-MA-01~04 | FR-MAS-01 | 10.3 | 7.4 | — | — |
| IT-AT-01~04 | FR-MAS-01 | 10.3 | 7.4 | — | — |
| IT-SW-01~05 | FR-MAS-01 | 10.3 | 7.4 | — | — |
| IT-DEF-01~04 | FR-DEF-01 | 9.1 | 16.1 | — | — |

---

# 附录

---

## 附录 A：E2E 测试报告模板

> **⚠️ v8.0 更新**：增加 28 项指标完整记录、架构问题 vs Bug 分类、通用 Workflow 结果

```markdown
# FlowForge v8.0 E2E 测试报告

> 日期: YYYY-MM-DD
> 执行人: AI Agent 测试工程师
> 代码基础: Agent 源码审查完成 + B1-B4 代码修复验证

## 〇、代码修复前置验证

| Bug | 修复状态 | 验证结果 | 验证人 |
|-----|---------|---------|--------|
| B1: ContentAuditAgent judge_model | ✅/❌ | audit LLM model ≠ 执行 model | — |
| B2: _execute_parallel 数据竞争 | ✅/❌ | 并行步骤输出独立互不污染 | — |
| B3: WorkflowExecutor mode 回退 | ✅/❌ | Reflexion 在 Workflow 中生效 | — |
| B4: conftest_e2e.py 真实 LLM | ✅/❌ | 集成测试使用真实 LLM 调用 | — |

## 一、模型通道健康

| 通道 | 状态 | 延迟(ms) | 备注 |
|------|------|---------|------|
| doubao-api | ✅/❌ | - | - |
| doubao-web/chat | ✅/❌ | - | 模型名已确认为 chat |
| openroute-api | ✅/❌ | - | - |
| openroute-web | ✅/❌ | - | - |

## 二、Workflow API 路径结果

| 用例 | 结果 | LLM次数 | 工具链 | 耗时(s) | Memory查询/写入 |
|------|------|---------|--------|---------|---------------|
| IT-WF-API-01 | PASS/FAIL | - | - | - | -/- |
| IT-WF-API-02 | PASS/FAIL | - | - | - | -/- |
| IT-WF-API-03 | PASS/FAIL | - | - | - | -/- |
| IT-WF-API-04 | PASS/FAIL | - | - | - | -/- |
| IT-WF-API-05 | PASS/FAIL | - | - | - | -/- |
| IT-WF-API-06 | PASS/FAIL | - | - | - | -/- |
| IT-WF-API-07 | PASS/FAIL | - | - | - | -/- |
| IT-WF-API-08 | PASS/FAIL | - | - | - | -/- |

## 三、Solo UI 路径结果

| 用例 | 意图类型 | Planning结果 | 步骤数 | 结果 |
|------|---------|-------------|--------|------|
| IT-SOLO-01 | write | intent_type / plan | - | PASS/FAIL |
| IT-SOLO-02 | write | intent_type / plan | - | PASS/FAIL |
| IT-SOLO-03 | research | intent_type / plan | - | PASS/FAIL |
| IT-SOLO-04 | optimize | intent_type / plan | - | PASS/FAIL |
| IT-SOLO-05 | analyze | intent_type / plan | - | PASS/FAIL |
| IT-SOLO-06 | translate | intent_type / plan | - | PASS/FAIL |
| IT-SOLO-07 | adapt | intent_type / plan | - | PASS/FAIL |
| IT-SOLO-08 | fast-path | _simple_response | 0 | PASS/FAIL |
| IT-SOLO-09 | plan-fallback | _infer_steps | - | PASS/FAIL |

## 四、模式执行器专项结果

| 用例 | 模式 | 结果 | 关键指标 |
|------|------|------|---------|
| IT-MODE-01 | ReAct | PASS/FAIL | 循环次数/工具调用链 |
| IT-MODE-02 | Reflexion | PASS/FAIL | 迭代轮次/最终评分 |
| IT-MODE-03 | AgentJudge | PASS/FAIL | judge model ≠ actor model |
| IT-MODE-04 | Coding | PASS/FAIL | 代码执行结果 |
| IT-MODE-05 | MultiAgent | PASS/FAIL | 子Agent并行数 |
| IT-MODE-06 | ReWOO | PASS/FAIL | 蓝图步骤数/并行执行数 |
| IT-MODE-07 | SelfDiscover | PASS/FAIL | 推荐模式/推理步骤 |
| IT-MODE-08 | GraphOfThoughts | PASS/FAIL | 分支数/最优路径 |
| IT-MODE-09 | Workflow on_error | PASS/FAIL | 策略组合覆盖 |

## 五、通用 Workflow 模板结果

| 用例 | 模板 | 结果 | LLM次数 | 迭代次数 |
|------|------|------|---------|---------|
| IT-GEN-WF-01 | generic_pipeline | PASS/FAIL | - | 1 |
| IT-GEN-WF-02 | generic_iterative | PASS/FAIL | - | - |
| IT-GEN-WF-03 | generic_plan_execute | PASS/FAIL | - | - |
| IT-GEN-WF-04 | generic_react | PASS/FAIL | - | - |
| IT-GEN-WF-05 | generic_review | PASS/FAIL | - | - |

## 六、关键指标汇总（28 项完整记录）

| 指标 | 总计 | 均值/Workflow | 达标 |
|------|------|-------------|------|
| 总 LLM 调用次数 | - | - | - |
| LLM Token 消耗(in/out) | -/- | - | - |
| LLM 延迟 P50/P95/P99(ms) | -/-/- | - | - |
| 总工具调用次数 | - | - | - |
| 工具调用链完整率 | - | - | - |
| 工具调用成功率 | - | - | - |
| Agent-as-Judge 不同模型 | -/2 | - | - |
| Reflexion 生效 (仅模式执行器直接模式) | -/0 | - | - |
| 并行步骤时间重叠 | -/1 | - | - |
| Memory 查询次数 | - | - | - |
| Memory 写入次数 | - | - | - |
| Memory 缓存命中率 | - | - | - |
| WebSocket 事件丢包 | - | - | - |
| 时间线渲染出错 | - | - | - |
| 流式渲染完整 | - | - | - |

## 七、发现的问题

| # | 问题 | 分类 | 严重度 | 根因 | 修复状态 |
|---|------|------|--------|------|---------|
| 1 | content_audit 未用独立模型 | Bug B1 | P0 | Agent 代码硬编码 | 待修复 |
| 2 | Reflexion 在 Workflow 中不生效 | 架构 A1 | P1 | WorkflowExecutor 跳过 mode | 待修复 |
| 3 | doubao-web 需特殊 Prompt 约束 | — | P1 | 网页版无 tool_calls | 已适配 |
| 4 | 并行数据竞争 | Bug B2 | P0 | context_data 同一引用 | 待修复 |
| 5 | Solo UI 与 Workflow API 事件格式不统一 | 架构 A2 | P1 | 两条路径设计不同 | 待修复 |
| 6 | DI 容器实际是全局单例 | 架构 A3 | P2 | deps.py 非真正 DI | 待修复 |

## 八、结论

| 通过率 | Workflow API | Solo UI | 模式执行器 | 通用WF | 前端 E2E | 并发 | 综合 |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 目标 | 8/8 | 9/9 | 9/9 | 5/5 | 4/4 | 4/4 | 39/39 |
| 实际 | -/8 | -/9 | -/9 | -/5 | -/4 | -/4 | -/39 |

🟢/🔴 **通过/不通过** — 说明
```

---

## 附录 B：架构问题 vs Bug 问题分类

> **⚠️ v8.0 新增**：明确区分"架构设计问题"和"代码Bug"，分别设计验证方案（来源：testreview_glm P1-12, testreview_qwen 架构问题）

### B.1 分类原则

| 分类 | 定义 | 特征 | 处理方式 |
|------|------|------|---------|
| **代码 Bug (B)** | 代码实现与设计意图不符 | 修复后行为改变，不影响其他模块 | 修复 → 验证 → 回归测试 |
| **架构设计问题 (A)** | 设计决策导致的功能限制 | 修改需要架构调整，影响多个模块 | 设计替代方案 / 标注为设计限制 |

### B.2 代码 Bug 清单（必须修复）

| # | Bug | 严重度 | 位置 | 修复方案 | 阻塞的测试 | 修复验证 |
|---|-----|--------|------|---------|-----------|---------|
| B1 | ContentAuditAgent 不支持 judge_model 参数 | P0 | `content_audit.py` | Agent 接收 judge_model 参数，LLM 调用时传递 model 参数 | 所有含 audit 步骤的 Workflow | audit 阶段 LLM 调用的 model 字段 ≠ 执行模型 |
| B2 | _execute_parallel 数据竞争 | P0 | `workflow.py:790-804` | 使用 `copy.deepcopy(context_data)` 为每个并行任务创建独立副本 | report_generation | 并行步骤输出独立互不污染 |
| B3 | WorkflowExecutor 跳过 mode executor | P1 | `workflow.py:76-83` | 增加选项：当步骤声明 mode 但无 agent 时使用 mode executor | Reflexion/ReWOO/AgentJudge 在 Workflow 中不生效 | Reflexion 在 Workflow 中生效 |
| B4 | conftest.py Mock LLM | P0 | `tests/conftest.py` | 区分单元/集成测试环境，增加 conftest_e2e.py | 所有集成/E2E 测试 | 集成测试使用真实 LLM 调用 |

**Bug 修复验证闭环**：

```
Bug 发现 → 修复代码 → 运行修复验证测试 → 通过 → 回归测试 → 关闭
                                    ↓ 失败
                               回到修复代码
```

### B.3 架构设计问题清单（需要设计决策）

| # | 问题 | 严重度 | 影响 | 建议方案 | 替代验证方案 |
|---|------|--------|------|---------|------------|
| A1 | Workflow YAML 的 mode 字段在 Workflow API 路径下无效 | P1 | 用户配置的 mode 被忽略，Reflexion/ReWOO/AgentJudge 在 Workflow 中不生效 | 方案1: 让 WorkflowExecutor 尊重 mode 字段；方案2: 文档化说明 mode 仅在 Solo 路径生效 | Solo UI 路径验证 mode 生效；Workflow API 路径基于 Agent 源码验证 |
| A2 | Solo UI 和 Workflow API 事件格式不统一 | P1 | 前端需要两套渲染逻辑 | 方案1: 统一事件格式；方案2: EventBusSoloAdapter 增加 Agent 内部事件映射 | 分别测试两条路径的事件序列 |
| A3 | DI 容器实际是全局单例 (deps.py)，非真正 DI | P2 | 违反铁律3"禁止绕过 DI 容器直接实例化" | 迁移到真正的 DI 容器 | 当前通过 deps.py 全局函数验证依赖注入 |
| A4 | Harness Layer 未集成到测试 | P2 | v6.0 核心特性（上下文工程/架构约束/反馈循环/熵管理/权限管线/会话管理）无法验证 | 增加 Harness 专项测试 | 标注为 v9.0 待补充 |

### B.4 架构问题 vs Bug 叠加效应分析

> **当前 Workflow 端到端跑不通的根因是"架构设计问题 + 代码 Bug"叠加**：

```
WorkflowExecutor 跳过 mode executor (架构 A1)
  → Reflexion/AgentJudge 在 Workflow 中不生效
  → 测试预期基于 mode 名称，实际执行基于 Agent 源码

ContentAuditAgent 无 judge_model (Bug B1)
  → 审核评分与执行使用同一模型
  → spec.md FR-HRN-03 要求"独立评判 Agent"无法满足

事件格式不统一 (架构 A2)
  → 前端时间线在两种路径下渲染逻辑不同
  → 测试必须分别覆盖两条路径

Mock 测试环境 (Bug B4)
  → 测试无法发现上述问题
  → 所有集成测试在假数据环境下通过
```

### B.5 v7.0 原有架构问题（已修正/保留）

#### 问题 1：Workflow 步骤的 mode 字段形同虚设

**分类**：架构设计问题 A1

**严重度**：P1

**描述**：YAML 中声明 `mode: "rewoo"` 但在 Workflow API 路径中完全不被使用。WorkflowExecutor 在步骤有 agent 时直接调用 `agent.execute_with_context()`，跳过 mode executor。

**影响**：
- 测试预期（基于 mode name）与实际执行（基于 Agent 代码）脱节
- Reflexion 迭代在 Workflow 中不生效
- Agent-as-Judge 在 Workflow 中不生效

**建议修复**：要么让 WorkflowExecutor 在无 agent 但有 mode 时使用 mode executor，要么为了灵活性保留当前设计但文档化清晰说明。

**测试影响**：所有 Workflow API 路径测试用例的 LLM 次数和工具调用链必须基于 Agent 源码，不能基于 mode 名称。

#### 问题 2：content_audit 无法使用独立模型

**分类**：代码 Bug B1

**严重度**：P0

**描述**：当前 `ContentAuditAgent` 两次 `llm.execute()` 使用相同的 `persona` 参数，没有参数指定使用不同的模型。`agent_judge` 模式执行器 (`AgentJudgeExecutor`) 调用 `judge_actor` 和 `judge_evaluator` 两个 Agent，但在 Workflow 上下文中这个 executor 根本没被调用——WorkflowExecutor 直接调用 Agent。

**影响**：
- 审核评分与执行使用同一模型，评分缺乏独立性
- spec.md FR-HRN-03 要求"独立评判 Agent"无法满足

**建议修复**：Agent 接收 `judge_model` 参数，LLM 调用时传递 `model` 参数。

**测试影响**：所有含 content_audit 步骤的 Workflow 测试用例中，"audit 模型 ≠ 执行模型"通过条件标注为"⚠️ 需代码修复前置条件"。

#### 问题 3：Solo UI 和 Workflow API 的事件序列完全不同

**分类**：架构设计问题 A2

**严重度**：P1

**描述**：前端时间线渲染依赖 WebSocket 事件。Solo 路径发出 `workflow.step.start/complete`、`tool.start/end`、`step.intermediate` 事件，而 Workflow API 路径发出 Agent 内部的 `topic_research.*`、`material_collection.*` 等自定义事件。前端需要同时处理两种事件格式。

**影响**：
- 前端时间线在两种路径下渲染逻辑不同
- 测试必须分别覆盖两条路径

**建议修复**：统一事件格式，或在 EventBusSoloAdapter 中增加对 Agent 内部事件的映射。

**测试影响**：测试用例必须区分 Workflow API 路径和 Solo UI 路径，分别验证事件序列。

#### 问题 4：LLM 调用次数基于模式执行器假设（已在 v7.0 中修正）

**严重度**：🔴 致命（已在 v7.0 中修正）

**描述**：test1.md 中 Workflow 测试用例的 LLM 调用次数是基于"模式执行器在 Workflow 步骤中生效"的假设，但实际代码中 WorkflowExecutor 在步骤有 agent 时跳过 mode executor，直接调用 agent.execute_with_context()。

**修正对照表**：

| Workflow | 原预期 LLM | 修正后 LLM | 差异根因 |
|----------|-----------|-----------|---------|
| deep_article | ≥ 12 | **8~11** | topic_research 0~1(非2~3), writing 1(非1+N), fact_check 1(非3~6) |
| quick_post | ≥ 5 | **1~2** | topic_research 0~1(非2~3), writing 1(非1+N), publish 0(非1) |
| trend_article | ≥ 8 | **3~5** | writing 1(非1+N) |
| seo_content | — | **6~9** | 基于 Agent 源码修正 |
| report_generation | — | **10~15** | 基于 Agent 源码修正 |
| multilingual | — | **6~9** | 基于 Agent 源码修正 |
| multi_platform | — | **5~6** | writing 1, platform_adapt×3 各 1, publish 0~1 |
| image_article | — | **4~7** | writing 1, image_gen 1~2, layout 1, publish 0~1 |

#### 问题 5：Reflexion 独立 Agent 条件不成立（已在 v7.0 中修正）

**严重度**：🟡 严重（已在 v7.0 中修正）

**描述**：test1.md IT-MODE-02 通过条件 3 要求"三个角色必须使用独立的 Agent"。但 DefaultLLMActor 和 DefaultLLMEvaluator 都使用同一个 LLM Tool（`DefaultLLMActor` 和 `DefaultLLMEvaluator` 共享底层 `llm.execute()` 调用），不满足"独立 Agent"的定义。

**修正方案**：

| 原条件 | 修正后条件 | 原因 |
|--------|-----------|------|
| 三个角色使用独立 Agent | **三种 Prompt 不同** | DefaultLLMActor/Evaluator 共用同一个 LLM Tool，无法满足"独立 Agent" |

**验证方法**：
1. 提取 Actor/Evaluator/Reflector 三者的 system prompt 模板
2. 断言三者内容不完全相同
3. 如需真正"独立 Agent"，需代码层面将 Evaluator 拆分为独立 Agent 类（当前不在 v8.0 测试范围内，标记为待修复）

**v8.0 中的体现**：
- 第 18 章 IT-MODE-02 通过条件 3 已改为"三种 Prompt 不同"
- 需求追溯矩阵中标注"spec.md FR-HRN-03 要求'独立评判 Agent'无法满足，降级为 Prompt 差异验证"

### B.6 v8.0 审核修复追踪表

| # | 修复项 | 来源审核报告 | 对应章节 | 修复状态 | 验证结果 |
|---|--------|------------|---------|---------|---------|
| 1 | 新增代码修复前置清单（B1-B4） | 全部6份 | 文档最前面 | ✅ 已完成 | — |
| 2 | 重写第十七章 Solo UI 路径（按意图类型设计） | testreview_qwen R1, testreview_glm P0-2 | 第十七章 | ✅ 已完成 | — |
| 3 | 修正 FactCheckAgent 测试预期（httpx HEAD 非 web_search） | testreview_qwen 架构问题4 | 第十六章 16.1/16.4 | ✅ 已完成 | — |
| 4 | 添加 TrendAnalysisAgent web_search 必须成功断言 | testreview_qwen 架构问题5, testreview_doubao 问题3 | 第十六章 16.3 | ✅ 已完成 | — |
| 5 | 实现 MetricsCollector（从设计升级为可执行代码） | testreview_deepseek FATAL-5, testreview_qwen R5 | 第二十八章 | ✅ 已完成 | — |
| 6 | 添加 conftest_e2e.py 真实 LLM 测试基础设施 | testreview_deepseek FATAL-1, testreview_glm P0-1 | 第一章 1.4 | ✅ 已完成 | — |
| 7 | 添加缺失的模式执行器测试（IT-MODE-06~09） | testreview_glm P1-4 | 第十八章 | ✅ 已完成 | — |
| 8 | 添加调用路径验证表 | testreview_glm P1-3, testreview_kimi 问题13 | 第十六章 | ✅ 已完成 | — |
| 9 | 添加预期输出 JSON 结构 | testreview_glm P0-6, testreview_deepseek FATAL-4 | 第十六章 | ✅ 已完成 | — |
| 10 | 添加 Memory 指标验证 | testreview_glm P1-8 | 第十六章 | ✅ 已完成 | — |
| 11 | 添加通用 Agent 和通用 Workflow 测试 | testreview_glm P1-5/P1-6 | 第二十九章 | ✅ 已完成 | — |
| 12 | 更新版本号和审核修复清单 | 全部6份 | 第〇章 | ✅ 已完成 | — |
| 13 | 修正模型名引用（确认无 seed-2.0 残留） | testreview_doubao 问题4, testreview_m27 0.3 | 第十六章 16.0 | ✅ 已完成 | — |
| 14 | 添加架构问题 vs Bug 问题分类 | testreview_glm P1-12, testreview_qwen 架构问题 | 附录B | ✅ 已完成 | — |

---

> **附录 B 修订记录**：v7.0 新增架构问题清单；v8.0 重构为"架构设计问题 vs 代码 Bug"分类体系，新增 A1-A4 架构问题、B1-B4 代码 Bug、叠加效应分析、修复追踪表。