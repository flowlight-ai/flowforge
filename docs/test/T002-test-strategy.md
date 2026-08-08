# T002: 测试策略总览 + 6 维指标体系 + 7 维通过定义

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 通用（所有测试类别的策略基础）
> **关联 spec.md**: [doc:../spec.md]（FR-ENG / FR-CAP / FR-HELM / FR-MAS）
> **关联 arch.md**: [doc:../arch.md]（§4-§12）
> **关联 design.md**: [doc:../design.md]（§3-§16）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 代码修复前置清单（测试前必须先修复）

> 以下代码 Bug 阻塞测试执行，必须在运行测试前修复。未修复的 Bug 在对应测试用例中标注为"⚠️ 需代码修复前置条件"。

| # | Bug | 位置 | 修复方案 | 阻塞的测试 |
|---|-----|------|---------|-----------|
| B1 | ContentAuditAgent 不支持 judge_model 参数 | `agents/content_audit.py` | Agent 接收 judge_model 参数，LLM 调用时传递 model 参数 | 所有含 audit 步骤的 Workflow |
| B2 | _execute_parallel 数据竞争 | `modes/workflow.py:790-804` | 使用 `copy.deepcopy(context_data)` 为每个并行任务创建独立副本 | report_generation 并行步骤 |
| B3 | WorkflowExecutor 跳过 mode executor | `modes/workflow.py:76-83` | 当步骤有 mode 但无 agent 时，使用 mode executor 路由 | Reflexion/ReWOO/AgentJudge 在 Workflow 中不生效 |
| B4 | conftest.py Mock LLM | `tests/conftest.py` | 区分单元/集成测试环境，增加 conftest_e2e.py | 所有集成/E2E 测试 |

---

## 2. 测试策略总览

### 2.1 两条执行路径（不可混淆）

| 路径 | 入口 | 核心方法 | 事件格式 | 适用场景 |
|------|------|---------|---------|---------|
| **Workflow API** | `POST /api/v1/tasks` | `_execute_sop_steps()` | Agent 内部事件 `topic_research.*`, `material_collection.*` | 按 YAML 定义的 Workflow 执行 |
| **Helm UI** | WebSocket 对话框 | `_execute_intelligent_chat()` | 动态规划事件 `workflow.step.start`, `tool.start`, `step.intermediate` | 自由对话 + LLM 动态规划 |

**测试必须分别覆盖两条路径**。它们的 LLM 调用次数、工具链、事件序列完全不同。

### 2.2 测试层级

| 层级 | 框架 | 数据 | 目标 | 覆盖率要求 |
|------|------|------|------|-----------|
| **单元测试** | pytest + pytest-asyncio | Mock LLM 可用 | 模块/接口/工具函数独立验证 | ≥ 85% |
| **集成测试 (Workflow API)** | pytest + httpx | **真实 LLM** | 8 个 Workflow 全流程 | ≥ 70% |
| **集成测试 (Helm UI)** | pytest + WebSocket 客户端 | **真实 LLM** | Helm 动态规划全流程 | 核心流程 100% |
| **E2E 测试** | Playwright | **真实 LLM + 真实浏览器** | 前端时间线渲染 + WebSocket | 核心流程 100% |
| **通道测试** | pytest | **真实 LLM 分通道** | doubao-api / doubao-web/chat / openroute-api / openroute-web | 关键模块 100% |
| **跨平台测试** | pytest + 条件跳过 | Mock | Windows/Linux 兼容性验证 | 关键模块 100% |

### 2.3 Mock 使用铁律

| 允许 Mock | 禁止 Mock |
|-----------|-----------|
| BaseAgent.execute 接口验证 | Workflow 端到端验证 |
| TaskContext 深拷贝测试 | Agent 执行链路验证 |
| EventBus 回调调度测试 | Tool 调用链验证 |
| DI 容器解析测试 | LLM 输出格式验证 |
| 数据库 CRUD 测试 | 前端 Helm WebSocket E2E |
| 沙箱安全规则测试 | 多模型通道测试 |

---

## 3. 测试环境

### 3.1 pytest 配置

```ini
# pytest.ini
[pytest]
asyncio_mode = auto
```

### 3.2 单元测试 conftest.py

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
```

### 3.3 E2E/集成测试 conftest_e2e.py

```python
# tests/conftest_e2e.py — 真实 LLM 测试基础设施

import os
import time
import json
import uuid
import pytest

@pytest.fixture
def use_real_llm():
    """通过环境变量 FLOWFORGE_REAL_LLM=1 启用真实 LLM"""
    return os.environ.get("FLOWFORGE_REAL_LLM", "0") == "1"

@pytest.fixture
async def real_llm_context(use_real_llm):
    """提供真实 LLM 的测试上下文"""
    if not use_real_llm:
        pytest.skip("需设置 FLOWFORGE_REAL_LLM=1 启用真实 LLM 测试")

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

    # 注入 MetricsCollector（T6 铁律）
    from tests.metrics_collector import TestMetricsCollector
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

## 4. 6 维测试指标体系（28 项指标定义）

### 4.1 指标定义

| 维度 | 指标 | 定义 | 采集方式 | 记录格式 |
|------|------|------|---------|---------|
| **LLM** | 总调用次数 | 任务生命周期中 LLM 被调用总次数 | 监听 `llm.start` 事件计数 | integer |
| **LLM** | 各 Agent-LLM 调用分布 | 每个 Agent 调用 LLM 的次数 | `llm.start` 事件按 agent 分组 | `{agent: count}` |
| **LLM** | 模型链 | 每次调用使用的模型 ID 序列 | `llm.start` payload 的 model 字段 | `[model_id, ...]` |
| **LLM** | Token 消耗 | 输入+输出 Token 之和 | `llm.end` payload 的 usage 字段 | `{input: int, output: int}` |
| **LLM** | 延迟分布 | P50/P95/P99 延迟 | `llm.start`→`llm.end` 时间差 | `{p50: ms, p95: ms, p99: ms}` |
| **Tool** | 调用链 | 工具调用顺序序列 | `tool.start` 事件序列 | `tool_a→tool_b→tool_c` |
| **Tool** | 各工具调用次数 | 每个工具被调用次数 | `tool.start` 按 tool_name 分组 | `{tool: count}` |
| **Tool** | 成功率 | 成功/总调用数 | `tool.end` 中 error 为空的比例 | float 0-1 |
| **Tool** | 每步耗时 | 每次工具调用耗时 | `tool.start`→`tool.end` 时间差 | `{tool: {avg_ms, max_ms}}` |
| **Agent** | 调用链 | Agent 调用顺序序列 | `agent.start` 事件序列 | `[agent_name, ...]` |
| **Agent** | 各 Agent 执行时长 | 每个 Agent 执行耗时 | `agent.start`→`agent.end` | `{agent: seconds}` |
| **Agent** | Reflexion 迭代轮次 | Reflexion 模式迭代次数 | `reflexion.evaluator` 事件计数 | integer |
| **Agent** | Reflexion 最终评分 | Reflexion 最终质量评分 | `reflexion.evaluator` payload 的 score | float 0-1 |
| **Agent** | Judge 模型名 | Agent-as-Judge 使用的模型 | `llm.start` payload 中 audit 阶段的 model | string |
| **Workflow** | 阶段序列 | 实际执行的步骤名称序列 | `workflow.step.start` 事件序列 | `[step_name, ...]` |
| **Workflow** | 各步骤耗时 | 每个步骤执行耗时 | `step.start`→`step.complete` | `{step: seconds}` |
| **Workflow** | 并行步骤重叠率 | 并行步骤时间重叠比例 | 并行步骤的 start/end 时间交叉 | float 0-1 |
| **Workflow** | Human 节点停留时间 | 审核暂停到恢复的时长 | `task.paused`→`task.resumed` | seconds |
| **Memory** | 查询次数 | Memory 被查询次数 | MemoryManager.retrieve 调用计数 | integer |
| **Memory** | 写入次数 | Memory 被写入次数 | MemoryManager.save 调用计数 | integer |
| **Memory** | 压缩触发次数 | 92% 阈值触发压缩次数 | `context.warning` 事件计数 | integer |
| **Memory** | 缓存命中率 | 命中缓存/总查询 | cache 工具返回 cached=True 比例 | float 0-1 |
| **WebSocket** | 事件总数 | 推送到前端的事件数 | HelmWSManager 发送计数 | integer |
| **WebSocket** | 各类型事件分布 | 每种事件类型数量 | 按 helm_event_type 分组 | `{type: count}` |
| **WebSocket** | 序号连续性 | 事件序号是否有跳号 | 序号差值检测 | `{gaps: int, missing: []}` |
| **Frontend** | 时间线节点数 | 前端渲染的步骤节点数 | DOM 节点计数 | integer |
| **Frontend** | Citation 链接数 | 来源引用卡片数 | DOM 中 citation 元素计数 | integer |
| **Frontend** | 流式 chunk 渲染数 | 流式内容渲染的 chunk 数 | streaming 事件计数 | integer |

### 4.2 指标记录模板（每个用例必须填写，T6 铁律）

```
| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | X~Y | _ | _ |
| 总工具调用次数 | ≥ X | _ | _ |
| 总耗时 | < Xs | _ | _ |
| Memory 查询次数 | ≥ X | _ | _ |
| Memory 写入次数 | ≥ X | _ | _ |
| Reflexion 迭代次数 | N/A (Workflow API 路径不适用) | _ | _ |
| Judge Agent 模型名 | ≠ 执行模型名 (需代码修复) | _ | _ |
| WebSocket 事件数 | ≥ X | _ | _ |
| 前端时间线节点数 | = X | _ | _ |
```

---

## 5. "测试通过" 7 维定义

一个测试用例**通过**意味着：

1. **所有预期阶段按序执行** — 阶段顺序与 Workflow YAML 一致，`workflow.step.start` 序号差值 = 1
2. **每个阶段的 Agent 被正确调用** — 输出了 Agent 源码中定义的 EventBus 事件，`agent.start` 事件必须出现
3. **每个 Agent 的工具调用链符合预期** — 工具名匹配，调用次数在 `[min, max]` 范围内，`tool.start` 事件序列包含预期工具
4. **每个 Agent 的 LLM 调用次数符合预期** — 在 `[min, max]` 范围内（基于 Agent 源码，非模式执行器假设），`llm.start` 计数在 [min,max] 范围内
5. **阶段输出格式完整** — 必填字段存在且类型正确
6. **前端时间线正确渲染** — Helm 路径下每个节点的图标、文本、子节点正确，DOM 节点计数 ≥ 预期
7. **WebSocket 事件序列完整** — 无丢事件，事件序号连续无跳号

### 5.1 测试失败处理规范

| 失败级别 | 触发条件 | 处理方式 | 记录要求 |
|---------|---------|---------|---------|
| P0-致命 | 代码 Bug 导致崩溃/数据错误 | 立即停止，修复后回归 | 堆栈+上下文+MetricsCollector 报告 |
| P1-严重 | 模型不可用/通道失败 | 跳过该通道，继续其他 | 通道名+错误信息+延迟 |
| P2-一般 | Prompt 问题/输出质量差 | 记录到 prompt_issues.md，继续 | 输入+输出+问题描述 |
| P3-轻微 | 格式/样式问题 | 记录，继续 | 截图+描述 |

---

## 6. 引用

- [doc:rules.md#T1-T8] — 测试铁律 T1-T8（详细定义）
- [doc:test/README.md] — 测试子目录索引
- [doc:test/TEMPLATE.md] — 测试用例文件模板
- [doc:test/T001-test-ironrules.md] — 测试铁律独立文件
- [doc:test/T015-metrics-collector.md] — MetricsCollector 28 项指标采集实现
- [doc:../spec.md] — 软件规格说明书
- [doc:../arch.md] — 架构设计文档
- [doc:../design.md] — 详细设计文档
- [doc:design/naming-contract.md] — 命名契约 v2.0

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建（从 test.md 拆分：代码修复前置清单 + 测试策略总览 + 6 维指标体系 + 7 维通过定义 + 失败处理规范） | 测试员可进化智能体（蜜獾·平头哥） |
