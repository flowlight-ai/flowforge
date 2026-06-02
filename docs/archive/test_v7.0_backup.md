# FlowForge 完整测试用例规格说明书 (v7.0 合并版)

> **版本**: 7.0 | **日期**: 2026-05-24 | **状态**: 待评审
> **合并来源**: v1.1 单元/集成测试 + v5.0 防御/协作测试 + test1.md (v6.0) Workflow E2E + v6.1 两条路径修正
> **核心变化**: 三版本合并 + 5 项审核修正（LLM次数/Reflexion路径/Judge模型/双路径区分/独立Agent条件）
> **设计基础**: 逐文件审查 `flowforge/agents/*.py` + `flowforge/modes/*.py` + `flowforge/workflows/*.yaml`
> **重要发现**: WorkflowExecutor 在步骤有 agent 时跳过 mode executor 直接调用 agent.execute_with_context()

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

### 0.2 合并时应用的 5 项关键修正

| # | 修正项 | 原值 | 修正值 | 来源 |
|---|--------|------|--------|------|
| 1 | LLM 调用次数 | 基于模式执行器假设（deep_article≥12, quick_post≥5, trend_article≥8） | 基于 Agent 源码（deep_article 8~11, quick_post 1~2, trend_article 3~5） | testreview1.md 问题1 |
| 2 | Reflexion 迭代在 Workflow API 路径不生效 | writing 阶段 Reflexion 1+N(1~3) | Workflow API 路径 writing=1次LLM，无迭代 | testreview1.md 问题2 |
| 3 | content_audit 独立 Judge 模型需代码修复 | 假设 audit 使用不同模型 | 标注"需代码修复前置条件" | testreview1.md 问题3 |
| 4 | 两条执行路径必须区分 | 混用事件格式 | Workflow API 路径 vs Solo UI 路径分别测试 | testreview1.md 问题5 |
| 5 | Reflexion 独立 Agent 条件修正 | "三个角色使用独立 Agent" | "三种 Prompt 不同"（DefaultLLMActor/Evaluator 共用 LLM Tool） | testreview1.md 问题4 |

### 0.3 各版本独有内容保留映射

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
| **UT-SOLO-01** | bridge 建立全部事件映射 | bridge() | 17 个订阅者注册到 event_bus（17 个 FlowForge 事件映射到 16 种 Solo 事件类型） |
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
| **步骤来源** | Workflow YAML 定义 | LLM 动态规划 |
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
  → 输出: {"intent_type": "write", "plan": [{name, type, tool/agent}, ...]}
Stage 2: Execute Steps (LLM × 1~N + Tool × M)
  → 每个 step 按 type 执行: tool / agent / generate
Stage 3: Compile (LLM × 1) — 整理输出
Stage 4: Save (file I/O) — 保存文件（仅长内容）
```

---

## 第十六章：8 个 Workflow API 路径测试用例

> **执行通道优先级**：OpenRoute API版 → OpenRoute网页版 → 验证通过后以此为准
> **未通过的API模型**：通过`models.yaml`中`enabled: false`暂时关闭
> **未通过的网页版模型**：修正Prompt，约束LLM输出所需工具格式或文案

### 16.0 模型配置要求

```
执行模型: doubao-api/deepseek-v3 (或类似推理模型)
评审模型: doubao-api/gemini-2.5-pro (必须不同！) ⚠️ 需代码修复前置条件
网页版模型: doubao-web/chat (非 seed-2.0)
备用通道: openroute-api
```

**执行前必须验证模型可用性**：
- `doubao-web/chat` — 确认模型名已从 seed-2.0 更新
- `openroute-api` — API-only 验证通过后作为备用通道
- 不通过的模型：API 版设置 `enabled: false`，网页版修正 Prompt 约束

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

**汇总**：总 LLM 调用 **8~11 次**（⚠️ 修正值，原 test1.md 为 ≥12 次）

**关键模型分配**：

| 阶段 | 执行模型 | 说明 |
|------|---------|------|
| 1~5 | `openroute/auto` | 执行模型 |
| 6 content_audit | `openroute/doubao-web/chat` | ⚠️ **评审模型 ≠ 执行模型**（需代码修复前置条件） |
| 7 | — | 人工审核 |
| 8 | `openroute/auto` | 执行模型 |

**通过条件**：

1. ✅ 8 个阶段按 `topic_research→material_collection→writing→seo_opt→fact_check→audit→review→publish` 顺序执行
2. ✅ 阶段 1 topic_research 输出 `topics` 数组，至少 1 个元素含 `title` 和 `url`
3. ✅ 阶段 2 material_collection 输出 `materials` 数组，至少 1 个元素含 `content`
4. ✅ 阶段 3 writing 输出 `draft` 字段，长度 ≥ 500 字符
5. ✅ 阶段 4 seo_opt 输出 `seo_title` 字段
6. ✅ 阶段 5 fact_check 输出 `is_clean` 和 `issues` 字段
7. ✅ 阶段 6 audit 输出 `score` (float) 和 `is_clean` (bool)
8. ✅ 阶段 6 audit 使用的 LLM 模型 ≠ 阶段 1-5 使用的 LLM 模型（⚠️ 需代码修复前置条件）
9. ✅ 阶段 8 publish 输出 `published` 字典，含已发布平台
10. ✅ 总耗时 < 300s

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 8~11 | _ | _ |
| 总工具调用次数 | ≥ 3 | _ | _ |
| 总耗时 | < 300s | _ | _ |
| Memory查询次数 | ≥ 2 | _ | _ |
| Memory写入次数 | ≥ 4 | _ | _ |
| Reflexion迭代次数 | N/A (Workflow API路径不适用) | _ | _ |
| Judge Agent模型名 | ≠ openroute/auto (需代码修复) | _ | _ |
| WebSocket事件数 | N/A (API路径无Solo事件) | _ | _ |
| 前端时间线节点数 | N/A (API路径) | _ | _ |

**失败处理**：

- 若模型不可用：跳过该通道，标记为 SKIP，在报告中说明
- 若工具调用失败：记录失败原因，检查重试逻辑是否触发（L1超时/L3自修正）
- 若LLM输出格式不符：检查 Prompt 是否需要调整，记录到 prompt_issues.md
- 若Agent跳过工具直接回答：记录为 P2 Bug（调用链路验证失败）
- 若 content_audit 使用相同模型：记录为 P0 Bug（需代码修复）

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

**汇总**：总 LLM 调用 **1~2 次**（⚠️ 修正值，原 test1.md 为 ≥5 次）

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
| Memory查询次数 | ≥ 1 | _ | _ |
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

**汇总**：总 LLM 调用 **3~5 次**（⚠️ 修正值，原 test1.md 为 ≥8 次）

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1 | `openroute/auto`（需要多步推理） |
| 2 | `openroute/auto` |
| 3 | `openroute/auto` |
| 4 | `openroute/doubao-web/chat` |

**通过条件**：

1. ✅ 第一步必须是 `trend_analysis`（先分析趋势再选题）
2. ✅ **必须调用 web_search 获取实时热点**（否则是 Bug——热点追踪不搜索）
3. ✅ trends 数组至少含 3 条热点
4. ✅ 热点数据可通过搜索引擎验证时效性（非 LLM 编造）
5. ✅ article_writing 引用了阶段 1 的趋势数据

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 3~5 | _ | _ |
| 总工具调用次数 | 2~3 | _ | _ |
| trend_analysis LLM次数 | 2~3 | _ | _ |
| web_search调用次数 | ≥ 1 | _ | _ |
| 热点条数 | ≥ 3 | _ | _ |

**失败处理**：

- 若 trend_analysis 未调用 web_search：记录为 P0 Bug（热点追踪不搜索）
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

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1~5 | `openroute/auto` |
| 6 | `openroute/auto` |

**通过条件**：

1. ✅ seo_keywords 数组长度 ≥ 5
2. ✅ draft 中目标关键词"Python异步编程最佳实践"出现 ≥ 2 次
3. ✅ seo_optimization 必须使用 plan_execute 模式（YAML 定义）
4. ✅ fact_check 必须调用 web_search 验证

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 6~9 | _ | _ |
| 总工具调用次数 | ≥ 3 | _ | _ |
| seo_keywords数量 | ≥ 5 | _ | _ |
| 关键词出现次数 | ≥ 2 | _ | _ |

**失败处理**：

- 若 seo_keywords 为空：检查 SEOOptimizationAgent Prompt，记录到 prompt_issues.md
- 若 fact_check 未调用 web_search：记录为 P1 Bug
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
| 6 content_audit | ContentAuditAgent | **2** | 无 | ⚠️ 需代码修复前置条件 |
| 7 review | (human pause) | **0** | - | auto_approve 跳过 |
| 8 publish | PublishingAgent | **0** | publish_local | - |

**汇总**：总 LLM 调用 **10~15 次**

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1~5 | `openroute/auto` |
| 6 content_audit | `openroute/doubao-web/chat`（⚠️ 评审模型 ≠ 执行模型，需代码修复前置条件） |
| 7 | — |
| 8 | `openroute/auto` |

**通过条件**：

1. ✅ **并行步骤中 research_1 和 research_2 的实际执行时间有重叠**（验证并行而非串行）
2. ✅ `research_1` 和 `research_2` 的开始时间差 < 2s（确认同时启动）
3. ✅ 总耗时 < `(research_1 耗时 + research_2 耗时)` × 1.1（确认不串行）
4. ✅ 并行步骤输出独立互不污染（`materials_1` ≠ `materials_2`）
5. ✅ **content_audit 使用不同于 article_writing 的模型**（⚠️ 需代码修复前置条件）
6. ✅ content_audit 四维评分均为 0-1 浮点数

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 10~15 | _ | _ |
| 总工具调用次数 | ≥ 4 | _ | _ |
| 并行步骤时间重叠 | > 0s | _ | _ |
| content_audit模型名 | ≠ openroute/auto (需代码修复) | _ | _ |
| 总耗时 | < 300s | _ | _ |

**失败处理**：

- 若并行步骤实际串行执行：记录为 P0 Bug（WorkflowExecutor 并行逻辑错误）
- 若并行步骤输出互相污染：记录为 P0 Bug（上下文隔离失败）
- 若 content_audit 使用相同模型：记录为 P0 Bug（需代码修复）

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

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1~4 | `openroute/auto` |
| 5 | `openroute/auto` |

**通过条件**：

1. ✅ image_research 必须调用 pexels_image 工具（非 LLM 编造 URL）
2. ✅ images 数组至少含 2 张可用图片
3. ✅ 图片 URL 可通过 HTTP 200 访问
4. ✅ 若含 content_audit 步骤，需使用不同模型（⚠️ 需代码修复前置条件）

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | 4~8 | _ | _ |
| 总工具调用次数 | ≥ 3 | _ | _ |
| 图片数量 | ≥ 2 | _ | _ |
| 图片URL可访问率 | = 1.0 | _ | _ |
| 总耗时 | < 200s | _ | _ |

**失败处理**：

- 若 image_research 未调用 pexels_image：记录为 P0 Bug（图片搜索核心步骤缺失）
- 若图片 URL 不可访问：记录为 P1 Bug（图片源问题）
- 若 images 数组为空：检查 ImageResearchAgent Prompt，记录到 prompt_issues.md

---

## 第十七章：8 个 Workflow Solo UI 路径测试用例

> **路径说明**：Solo UI 路径通过 WebSocket 对话框发起，走 `_execute_intelligent_chat()`，与 Workflow API 路径完全不同。
> **事件格式**：Solo 路径发出 `workflow.step.start/complete`、`tool.start/end`、`step.intermediate` 事件。

---

### 17.1 IT-SOLO-01：深度长文 — Solo UI 路径

**操作**：浏览器 Solo 对话框输入: "帮我写一篇关于2026年AI Agent发展趋势的深度分析文章"

**Solo UI 执行路径** (`_execute_intelligent_chat()`)：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(step=planning)`, `step.intermediate(规划完成: ...)`, `workflow.step.complete(planning)` |
| 2 搜索素材 | `_execute_tool_or_agent(web_search)` | 0 | web_search×1 | `workflow.step.start(搜索素材)`, `tool.start(web_search)`, `tool.end(web_search)`, `workflow.step.complete(搜索素材)` |
| 3 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `workflow.step.start(撰写内容)`, `tool.start(article_writing, is_agent=true)`, `tool.end(article_writing)`, `workflow.step.complete(撰写内容)` |
| 4 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile, stage=compile)`, `workflow.step.complete(compile)` |
| 5 保存文件 (save) | workspace I/O | 0 | file write | `workflow.step.start(save)`, `draft.file`, `workflow.step.complete(save)` |

**汇总**：总 LLM 调用 **3~4 次**（planning + writing agent + compile + 可能搜索回退）

**预期 WebSocket 事件序列**：

```
1.  workflow.step.start  {"step": "planning", "stage": "planning"}
2.  workflow.step.complete {"step": "planning", "intent_type": "write"}
3.  step.intermediate     {"step_name": "规划完成: ..."}
4.  workflow.step.start  {"step": "搜索素材", "stage": "搜索素材"}
5.  tool.start            {"tool_name": "web_search"}
6.  tool.end              {"tool_name": "web_search", "success": true}
7.  workflow.step.complete {"step": "搜索素材"}
8.  workflow.step.start  {"step": "撰写内容", "stage": "撰写内容"}
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

---

### 17.2 IT-SOLO-02：快速发文 — Solo UI 路径

**操作**：浏览器 Solo 对话框输入: "写一篇关于GPT-5最新发布消息的速报"

**Solo UI 执行路径**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)`, `workflow.step.complete(planning)` |
| 2 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `workflow.step.start(撰写)`, `tool.start(article_writing)`, `tool.end(article_writing)`, `workflow.step.complete(撰写)` |
| 3 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **2~3 次**

**通过条件**：

1. ✅ 前端时间线渲染的节点 ≥ 3
2. ✅ 撰写节点下显示 Agent 子节点
3. ✅ compile 后 `draft.update` 事件内容非空
4. ✅ 事件序号连续无跳号

---

### 17.3 IT-SOLO-03：热点追踪 — Solo UI 路径

**操作**：浏览器 Solo 对话框输入: "追踪本周AI领域最新热点并撰写文章"

**Solo UI 执行路径**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)`, `step.intermediate(规划完成: write, 3步)` |
| 2 搜索热点 | `_execute_tool_or_agent(web_search)` | 0 | web_search×1 | `workflow.step.start(搜索热点)`, `tool.start(web_search)`, `tool.end(web_search)` |
| 3 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `workflow.step.start(撰写)`, `tool.start(article_writing)`, `tool.end(article_writing)` |
| 4 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **3~4 次**

**通过条件**：

1. ✅ 前端时间线渲染的节点 ≥ 4
2. ✅ 搜索热点节点下显示 `web_search` 子节点
3. ✅ 搜索结果包含真实热点数据（非 LLM 编造）
4. ✅ 事件序号连续无跳号

---

### 17.4 IT-SOLO-04：SEO 内容 — Solo UI 路径

**操作**：浏览器 Solo 对话框输入: "针对关键词'Python异步编程最佳实践'生成一篇SEO优化的文章"

**Solo UI 执行路径**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)` |
| 2 搜索素材 | `_execute_tool_or_agent(web_search)` | 0 | web_search×1 | `tool.start(web_search)`, `tool.end(web_search)` |
| 3 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `tool.start(article_writing)`, `tool.end(article_writing)` |
| 4 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **3~4 次**

**通过条件**：

1. ✅ 前端时间线渲染的节点 ≥ 4
2. ✅ 最终输出包含 SEO 关键词
3. ✅ 事件序号连续无跳号

---

### 17.5 IT-SOLO-05：报告生成 — Solo UI 路径

**操作**：浏览器 Solo 对话框输入: "生成一份关于全球气候变化影响的深度研究报告"

**Solo UI 执行路径**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)` |
| 2 搜索素材 | `_execute_tool_or_agent(web_search)` | 0 | web_search×1~2 | `tool.start(web_search)`, `tool.end(web_search)` |
| 3 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `tool.start(article_writing)`, `tool.end(article_writing)` |
| 4 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |
| 5 保存文件 (save) | workspace I/O | 0 | file write | `draft.file` |

**汇总**：总 LLM 调用 **3~4 次**

**通过条件**：

1. ✅ 前端时间线渲染的节点 ≥ 4
2. ✅ 报告内容长度 ≥ 1000 字符
3. ✅ 保存文件后显示下载链接
4. ✅ 事件序号连续无跳号

---

### 17.6 IT-SOLO-06：多语言发布 — Solo UI 路径

**操作**：浏览器 Solo 对话框输入: "写一篇介绍中国茶文化的文章并翻译成英文和日文"

**Solo UI 执行路径**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)` |
| 2 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `tool.start(article_writing)`, `tool.end(article_writing)` |
| 3 翻译 | `_execute_tool_or_agent(multilingual)` | 1 | 无 | `tool.start(multilingual)`, `tool.end(multilingual)` |
| 4 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **3~4 次**

**通过条件**：

1. ✅ 前端时间线渲染的节点 ≥ 4
2. ✅ 最终输出包含至少 2 种语言版本
3. ✅ 事件序号连续无跳号

---

### 17.7 IT-SOLO-07：多平台分发 — Solo UI 路径

**操作**：浏览器 Solo 对话框输入: "写一篇关于远程办公效率的文章并适配公众号/头条/知乎三个平台"

**Solo UI 执行路径**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)` |
| 2 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `tool.start(article_writing)`, `tool.end(article_writing)` |
| 3 平台适配 | `_execute_tool_or_agent(content_repurposer)` | 1 | 无 | `tool.start(content_repurposer)`, `tool.end(content_repurposer)` |
| 4 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **3~4 次**

**通过条件**：

1. ✅ 前端时间线渲染的节点 ≥ 4
2. ✅ 最终输出包含多个平台版本
3. ✅ 事件序号连续无跳号

---

### 17.8 IT-SOLO-08：图文并茂 — Solo UI 路径

**操作**：浏览器 Solo 对话框输入: "写一篇关于日本樱花季旅行攻略的图文文章"

**Solo UI 执行路径**：

| 阶段 | 内部步骤 | LLM 次数 | 工具调用 | WebSocket 事件 |
|------|---------|---------|---------|---------------|
| 1 意图识别 (planning) | `_call_llm(planner)` | 1 | 无 | `workflow.step.start(planning)` |
| 2 搜索素材 | `_execute_tool_or_agent(web_search)` | 0 | web_search×1 | `tool.start(web_search)`, `tool.end(web_search)` |
| 3 撰写内容 | `_execute_tool_or_agent(article_writing)` | 1 | 无 | `tool.start(article_writing)`, `tool.end(article_writing)` |
| 4 图片搜索 | `_execute_tool_or_agent(image_research)` | 0 | pexels_image×1 | `tool.start(pexels_image)`, `tool.end(pexels_image)` |
| 5 整理输出 (compile) | `_call_llm(solo_assistant)` | 1 | 无 | `workflow.step.start(compile)`, `workflow.step.complete(compile)` |

**汇总**：总 LLM 调用 **3~4 次**

**通过条件**：

1. ✅ 前端时间线渲染的节点 ≥ 5
2. ✅ 图片搜索节点下显示 `pexels_image` 子节点
3. ✅ 最终输出包含图片 URL
4. ✅ 事件序号连续无跳号

---

### 17.9 Solo UI 路径覆盖矩阵

| Workflow | Solo UI 测试 | Solo 事件序列验证 | 前端时间线验证 |
|----------|:---:|:---:|:---:|
| deep_article | ✅ IT-SOLO-01 | ✅ | ✅ (Playwright) |
| quick_post | ✅ IT-SOLO-02 | ✅ | ✅ |
| trend_article | ✅ IT-SOLO-03 | ✅ | ✅ |
| seo_content | ✅ IT-SOLO-04 | ✅ | ✅ |
| report_generation | ✅ IT-SOLO-05 | ✅ | ✅ |
| multilingual | ✅ IT-SOLO-06 | ✅ | ✅ |
| multi_platform | ✅ IT-SOLO-07 | ✅ | ✅ |
| image_article | ✅ IT-SOLO-08 | ✅ | ✅ |

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
3. ✅ **三种 Prompt 不同**（Actor/Evaluator/Reflector 的 system prompt 各不相同）（⚠️ 修正：原条件"三个角色使用独立 Agent"不正确，DefaultLLMActor/DefaultLLMEvaluator 共用同一个 LLM Tool）
4. ✅ 每轮 Evaluator 必须返回 0-1 之间的数值评分

> **⚠️ 仅模式执行器直接模式下有效，Workflow API 路径不适用**（WorkflowExecutor 跳过 mode executor）

---

### 18.3 IT-MODE-03：Agent-as-Judge 不同模型验证

**需求依据**：spec.md FR-HRN-03 反馈循环（独立评判 Agent）；审视缺陷8

**输入数据**：
- 意图：`"写一篇关于'远程办公利弊'的评论文章"`
- 配置：writing 用 `openroute/auto`，audit 用 `openroute/doubao-web/chat`

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期行为 |
|------|-------|------|---------|
| 1 | article_writing | reflexion | 使用 `openroute/auto` 生成文章 |
| 2 | content_audit | agent_judge | **使用 `openroute/doubao-web/chat` 评审** |

**通过条件**：
1. ✅ **audit 阶段的 LLM 模型名 ≠ writing 阶段的 LLM 模型名**（⚠️ 需代码修复前置条件）
2. ✅ audit 返回四维评分（design_quality/originality/craft/functionality）
3. ✅ 评分不全相同（证明不是同一模型重复评分）
4. ✅ audit 返回 verdict（pass/conditional/fail）

> **⚠️ 需代码修复前置条件**：当前 ContentAuditAgent 源码中两次 llm.execute() 使用相同的 persona，不支持指定 judge_model

---

### 18.4 IT-MODE-04：代码生成（coding 档位模型）

**需求依据**：spec.md FR-CAP-04 CodeWriterAgent；design.md 8.2

**输入数据**：
- 意图：`"用Python写一个快速排序算法，要求包含注释和单元测试"`
- 模式：reflexion
- 模型：**coding 档位** `arkcode/ark-code-latest`

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期 LLM 次数 | 预期模型 |
|------|-------|------|-------------|---------|
| 1 | code_writer_agent | reflexion | 1+N(1~3) | **`arkcode/ark-code-latest`** |

**通过条件**：
1. ✅ **必须使用 coding 档位模型 `arkcode/ark-code-latest`**（否则是 Bug——代码任务没用代码模型）
2. ✅ 响应必须包含可执行的 Python 代码
3. ✅ 代码应包含注释
4. ✅ 应包含单元测试代码
5. ✅ LLM 模型链中必须包含 `arkcode/ark-code-latest`

---

### 18.5 IT-MODE-05：Subagents 并行策略

**需求依据**：spec.md FR-MAS-01（完全上下文隔离、并行执行、工具过滤、结果压缩）；design.md 7.4

**输入数据**：
- 意图：`"从技术、经济、社会三个角度并行分析'人工智能对教育的影响'"`
- 模式：multi_agent（strategy=subagents）
- 模型：`openroute/auto`

**预期执行过程**：

| 子任务 | Agent | 上下文 | 工具集 | 模型 |
|--------|-------|--------|--------|------|
| 技术角度 | subagent_1 | 独立空 state | [llm, web_search] | `openroute/auto` |
| 经济角度 | subagent_2 | 独立空 state | [llm, web_search] | `openroute/auto` |
| 社会角度 | subagent_3 | 独立空 state | [llm, web_search] | `openroute/auto` |

**通过条件**：
1. ✅ 3 个子任务必须并行执行（`agent.start` 时间戳接近，非串行）
2. ✅ 每个子 Agent 必须有独立的上下文（`TaskContext.from_parent(state={})`）
3. ✅ 子 Agent 只暴露最小工具集（工具过滤）
4. ✅ 子 Agent 结果必须压缩返回（不污染父 Agent 上下文）
5. ✅ 单个子任务失败不应影响其他子任务

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 子任务并行时间重叠 | > 0s | _ | _ |
| 子Agent上下文隔离 | state={} | _ | _ |
| 子Agent工具集 | ≠ 全部工具 | _ | _ |

---

## 第十九章：前端 Solo/WebSocket E2E 测试

### 19.1 测试环境

- 后端: `http://localhost:8889`
- 前端: `http://localhost:5173`
- WebSocket: `ws://localhost:8889/ws/{task_id}`

### 19.2 E2E-SOLO-01：完整 ReAct Solo 流程

**需求依据**：spec.md FR-SOL-01~04；arch.md 10.6

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
  ├── web_search × N
  └── LLM 思考
[阶段6: 审核] content_audit(agent_judge)
  └── LLM 思考 (模型: doubao-web/chat ← 不同于阶段1-5)
[阶段7: 人工审核] review(human) ← 暂停，可交互
[阶段8: 发布] publishing(plan_execute)
  └── 发布结果
```

**Playwright 断言代码**：

```javascript
// 1. 时间线容器存在
expect(page.locator('[data-testid="timeline"]')).toBeVisible();

// 2. 至少出现 4 个阶段节点
const stageNodes = page.locator('[data-testid="timeline-stage"]');
expect(await stageNodes.count()).toBeGreaterThanOrEqual(4);

// 3. 第一阶段是"意图识别"
expect(stageNodes.nth(0)).toContainText('意图识别');

// 4. 存在工具调用子节点（扳手图标）
expect(page.locator('[data-testid="tool-node"]').first()).toBeVisible();

// 5. 存在 Agent 调用子节点
expect(page.locator('[data-testid="agent-node"]').first()).toBeVisible();

// 6. 最终答案区域出现内容
expect(page.locator('[data-testid="final-answer"]')).not.toBeEmpty();

// 7. 来源面板(Citation)可见
expect(page.locator('[data-testid="source-panel"]')).toBeVisible();

// 8. 文件下载链接出现（长内容）
expect(page.locator('[data-testid="file-download"]')).toBeVisible();
```

**验证点**：
1. ✅ 8 个阶段按序渲染，无跳步
2. ✅ 阶段 6 顶部显示评审模型名（不同于阶段 1-5 的执行模型）
3. ✅ 阶段 7 渲染为"审核中"按钮，点击通过后继续
4. ✅ 阶段 3 不显示 Reflexion 迭代轮次标签（⚠️ Workflow API 路径无迭代）
5. ✅ 来源面板（Source Panel）始终可见，Citation 可点击跳转
6. ✅ 虚拟滚动支持 500+ 条事件（spec.md FR-SOL-02）

---

### 19.4 E2E-SOLO-03：WebSocket 断线重连

**操作**：Solo 执行中手动断开 WebSocket → 等待 5 秒 → 重连

**预期**：
1. ✅ 重连成功
2. ✅ 接收 replay 事件，回放断线期间丢失的事件
3. ✅ 时间线自动补全
4. ✅ 指数退避重连，最多 10 次（spec.md 4.3 可靠性要求）

**Playwright 断言代码**：

```javascript
// 模拟断线重连
await page.context().setOffline(true);
await page.waitForTimeout(5000);
await page.context().setOffline(false);

// 验证时间线补全
const stageNodes = page.locator('[data-testid="timeline-stage"]');
expect(await stageNodes.count()).toBeGreaterThan(0);
```

---

### 19.5 E2E-SOLO-04：审核交互全流程

**需求依据**：spec.md FR-SOL-03（审核节点内联）；arch.md 12.3 Human-in-the-Loop

**操作**：选择 deep_article Workflow → 等待 review 阶段暂停 → 点击"驳回" → 输入反馈 → 提交

**预期事件序列**：

```
review.ready → task.paused → (用户操作) → review.submitted(verdict=reject) → task状态=rejected
```

**验证点**：
1. ✅ review.ready 事件触发时间线暂停
2. ✅ 审核窗口期 5 分钟内可撤回（spec.md FR-SOL-03）
3. ✅ 用户点击"驳回" → review.submitted(verdict=reject)
4. ✅ **Persona 锁在审核暂停期间必须保留**（spec.md 开发规范铁律）
5. ✅ 审核完成后 persona 锁必须释放
6. ✅ Solo 前端显示审核内联块（不跳转独立页面）
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
| `doubao-web/chat` | quick_post 3 阶段全部完成 + 工具格式输出正确 | 若 LLM 输出格式不符：调整 Prompt，约束输出格式 |
| `arkcode/ark-code-latest` | 代码生成任务完成 | 若不支持：标记为不可用，在 models.yaml 中 enabled=false |
| **网页版模型** | **LLM 必须按 Prompt 约束输出工具调用格式** | **不通过则修正 Prompt，修复后重新验证** |
| **API 版模型** | **LLM 必须正确使用 tool_calls** | **不通过则检查模型是否支持 tool_calls，不支持则标记** |

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

**需求依据**：spec.md 4.1 性能要求"并发创建 10 个不同 persona 任务：全部成功，无锁冲突"

**操作**：10 个并发 POST /api/v1/tasks，使用 10 个不同 persona（persona_1~10），全部使用 quick_post Workflow

**预期**：
1. ✅ 全部返回 201，无 409 ConflictError
2. ✅ 10 个任务全部成功完成
3. ✅ 各任务状态互不污染

### 21.2 IT-CONC-02：同 persona 并发冲突

**需求依据**：spec.md FR-ENG-01 Persona 锁；arch.md 12.2

**操作**：2 个并发 POST /api/v1/tasks，使用同一个 persona

**预期**：
1. ✅ 第 1 个返回 201
2. ✅ 第 2 个返回 409 ConflictError
3. ✅ 第 1 个完成后，同 persona 新任务可正常执行

### 21.3 IT-CB-01：连续失败触发熔断

**需求依据**：spec.md 4.3 可靠性要求"Circuit Breaker 触发：5 次连续失败触发熔断"；arch.md 9.2 MCPBroker

**操作**：配置一个必定失败的工具 → 连续调用 5 次

**预期**：
1. ✅ 前 5 次返回错误
2. ✅ 第 6 次返回 Circuit Breaker 开启状态
3. ✅ 熔断后不再尝试调用

### 21.4 IT-CB-02：429 retry-after 处理

**需求依据**：spec.md 4.3 可靠性要求"429 Retry-After：支持 retry-after 头部解析"

**操作**：模拟 LLM 返回 429 状态码 + Retry-After: 5

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
| **IT-AT-01** | Lead 分解 + 团队认领 | 任务被正确分解到 TaskBoard，团队成员认领执行 |
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

### 23.1 三层防御联合测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-DEF-01** | L1 超时 → L2 检测 → L3 修正 | 工具超时 → 重复检测 → reflexion_retry 自修正 |
| **IT-DEF-02** | 防御配置传递 | `ctx.metadata["defense"]` 正确合并到步骤级 |
| **IT-DEF-03** | SOP 模板渲染 | `{{variable}}` 被正确替换 |
| **IT-DEF-04** | Checkpoint 入口保存 | checkpoint_enabled=True 时，SOP 入口自动保存检查点 |

---

## 第二十四章：跨 Workflow 组合测试

### 24.1 IT-CROSS-01：先后执行两个 Workflow

**操作**：
1. 先执行 deep_article（persona=tech_blog）
2. 等待完成后，执行 quick_post（persona=tech_blog）

**预期**：
1. ✅ 两个 Workflow 独立完成，状态不互相污染
2. ✅ 第 1 个 Workflow 的 Memory 数据在第 2 个中可查询到（如果 TTL 未过期）
3. ✅ Persona 锁在 deep_article review 暂停时正确释放，quick_post 能正常获取

### 24.2 IT-CROSS-02：deep_article → multi_platform 链式

**操作**：
1. 执行 deep_article（含 review 暂停）
2. 审核通过后，对同一篇文章执行 multi_platform

**预期**：
1. ✅ multi_platform 可以复用 deep_article 的 draft 和 materials
2. ✅ 两个 Workflow 的 publish 输出不同（不同平台）

---

## 第二十五章：API 业务正确性验证

> 不再只检查 status_code=200，必须验证业务逻辑正确性

### 25.1 API-01：模式列表验证

**操作**：GET /api/v1/modes

**验证**：
1. ✅ 返回 9 种模式（react/plan_execute/reflexion/multi_agent/workflow/rewoo/self_discover/agent_judge/graph_of_thoughts）
2. ✅ 每个模式包含完整字段（name, description, capabilities）
3. ✅ 不包含未注册的垃圾模式
4. ✅ 模式执行器初始化失败的不出现在列表中

### 25.2 API-02：任务创建验证

**操作**：POST /api/v1/tasks

**验证**：
1. ✅ 返回 task_id（非空 UUID）
2. ✅ 返回 status=pending
3. ✅ 返回 mode 字段与请求一致
4. ✅ 返回 persona 字段与请求一致
5. ✅ 任务记录写入数据库（可查询）

### 25.3 API-03：任务状态转换验证

**操作**：创建任务 → 查询状态 → 等待完成 → 查询最终状态

**验证**：
1. ✅ 状态转换序列：pending → running → completed/error
2. ✅ running 状态包含 current_step 信息
3. ✅ completed 状态包含 result 字段（非空 JSON）
4. ✅ error 状态包含 error 字段（非空字符串）
5. ✅ 不存在从 completed 回退到 running 的情况

---

# 第七部分：报告 + 工具

---

## 第二十六章：E2E Web UI 测试

| 用例 ID | 场景 | 用户操作 | 预期 |
|---------|------|---------|------|
| **E2E-01** | 创建并完成普通任务 | 仪表盘 → 填入意图 → 选择模式 → 提交 | 任务创建成功，可在任务列表查看 |
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

### 27.2 压力测试脚本示例

```python
# tests/performance/test_concurrent_tasks.py

import asyncio
import time
import httpx

async def test_concurrent_create():
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        tasks = []
        for i in range(10):
            payload = {
                "persona": f"test_persona_{i}",
                "input_data": {"topic": f"测试任务 {i}"},
                "mode": "react"
            }
            tasks.append(client.post("/api/v1/tasks", json=payload))
        start = time.time()
        results = await asyncio.gather(*tasks)
        elapsed = time.time() - start
        success = sum(1 for r in results if r.status_code == 201)
        print(f"10 并发创建: {elapsed:.2f}s, 成功: {success}/10")
        assert success == 10, "所有并发创建应该成功"
```

### 27.3 测试覆盖率目标

| 模块 | 目标覆盖率 | 关键覆盖项 |
|------|-----------|-----------|
| `core/` | ≥ 90% | BaseAgent, BaseTool(+safety_level), TaskContext, DI, Errors, CheckpointManager(增强) |
| `modes/` | ≥ 85% | 所有 9 种执行器 + MultiAgent(三策略) + Workflow(防御+reflexion_retry) |
| `events/` | ≥ 90% | EventBus, SoloAdapter |
| `tools/` | ≥ 85% | Registry(+timeout), SecureToolRegistry, Sandbox, LLMClient |
| `memory/` | ≥ 85% | MemoryManager(+compressor), TaskBoard, Mailbox, ContextCompressor |
| `executor/` | ≥ 80% | HybridExecutor, StateManager |
| `plugins/` | ≥ 75% | PluginManager, entry_points 加载 |

---

## 第二十八章：MetricsCollector 设计

测试执行时自动运行的 MetricsCollector 记录以下数据：

```python
class TestMetricsCollector:
    """测试指标收集器 — 通过 EventBus 订阅自动采集"""

    def __init__(self, event_bus, task_id):
        self.llm_calls = 0
        self.llm_by_agent = {}     # {agent_name: count}
        self.llm_tokens_in = 0
        self.llm_tokens_out = 0
        self.llm_latencies = []    # [ms]
        self.tool_calls = 0
        self.tool_by_name = {}     # {tool_name: count}
        self.tool_chain = []       # ordered sequence
        self.tool_latencies = []   # [ms]
        self.tool_errors = 0
        self.stage_order = []      # ordered stage names
        self.stage_durations = {}  # {stage: seconds}
        self.events_received = 0
        self.events_by_type = {}
        self.memory_queries = 0
        self.memory_writes = 0
        self.compactions = 0

    def on_llm_start(self, data): ...
    def on_llm_end(self, data): ...
    def on_tool_start(self, data): ...
    def on_tool_end(self, data): ...
    def on_workflow_step_start(self, data): ...
    def on_workflow_step_complete(self, data): ...
    def on_agent_event(self, event_type, data): ...

    def generate_report(self) -> dict:
        """生成 JSON 指标报告"""
```

**指标报告 JSON 模板**：

```json
{
  "test_id": "IT-WF-API-01",
  "workflow": "deep_article",
  "path": "workflow_api",
  "start_time": "ISO8601",
  "end_time": "ISO8601",
  "total_duration_s": 0,
  "result": "PASS/FAIL",
  "llm_metrics": {
    "total_calls": 0,
    "by_agent": {
      "topic_research": {"calls": 0, "tokens_in": 0, "tokens_out": 0},
      "material_collection": {"calls": 0, "tokens_in": 0, "tokens_out": 0},
      "article_writing": {"calls": 0, "tokens_in": 0, "tokens_out": 0},
      "seo_optimization": {"calls": 0, "tokens_in": 0, "tokens_out": 0},
      "fact_check": {"calls": 0, "tokens_in": 0, "tokens_out": 0},
      "content_audit": {"calls": 0, "tokens_in": 0, "tokens_out": 0}
    },
    "p50_latency_ms": 0,
    "p95_latency_ms": 0,
    "p99_latency_ms": 0
  },
  "tool_metrics": {
    "total_calls": 0,
    "by_tool": {
      "opensieve_search": 0,
      "web_search": 0,
      "httpx_head": 0,
      "publish_local": 0
    },
    "tool_chain": [],
    "success_rate": 0
  },
  "agent_metrics": {
    "total_agents": 6,
    "agent_durations_s": {},
    "topic_research_source": "",
    "material_collection_source_types": [],
    "audit_model": "",
    "audit_score": 0
  },
  "workflow_metrics": {
    "total_steps": 8,
    "step_durations_s": {},
    "effective_steps": 8,
    "review_skipped": true
  },
  "memory_metrics": {
    "query_count": 0,
    "write_count": 0,
    "compaction_triggered": false,
    "total_tokens_stored": 0
  },
  "event_metrics": {
    "total_events": 0,
    "events_by_type": {},
    "seq_gaps": 0
  },
  "pass_criteria": {
    "all_stages_ordered": false,
    "all_agents_called": false,
    "tool_chain_matches": false,
    "llm_count_in_range": false,
    "output_fields_complete": false,
    "audit_model_different": false,
    "duration_under_limit": false
  }
}
```

---

## 第二十九章：测试执行顺序

```
Phase 0: 代码修复（测试前置条件）
  ├── 修复 doubao-web/chat 模型名
  ├── 修复 content_audit Agent 支持独立 judge_model
  ├── 修复 WorkflowExecutor mode executor 回退
  └── OpenRoute API 通道预检

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
  ├── IT-WF-API-03: trend_article (4 步)
  ├── IT-WF-API-04: seo_content (6 步)
  ├── IT-WF-API-05: report_generation (8+并行)
  ├── IT-WF-API-06: multilingual (5 步)
  ├── IT-WF-API-07: multi_platform (4 步)
  └── IT-WF-API-08: image_article (5 步)

Phase 4: Solo UI 路径 E2E
  ├── IT-SOLO-01: deep_article Solo
  ├── IT-SOLO-02: quick_post Solo
  ├── IT-SOLO-03: trend_article Solo
  ├── IT-SOLO-04: seo_content Solo
  ├── IT-SOLO-05: report_generation Solo
  ├── IT-SOLO-06: multilingual Solo
  ├── IT-SOLO-07: multi_platform Solo
  └── IT-SOLO-08: image_article Solo

Phase 5: 模式执行器专项
  ├── IT-MODE-01: ReAct 循环检测
  ├── IT-MODE-02: Reflexion 不收敛
  ├── IT-MODE-03: Agent-as-Judge 不同模型
  ├── IT-MODE-04: 代码生成 coding 模型
  └── IT-MODE-05: Subagents 并行

Phase 6: 前端 Playwright E2E
  ├── E2E-SOLO-01: ReAct Solo 流程
  ├── E2E-SOLO-02: Workflow Solo 流程
  ├── E2E-SOLO-03: WebSocket 断线重连
  └── E2E-SOLO-04: 审核交互

Phase 7: 并发 + Circuit Breaker
  ├── IT-CONC-01: 10 并发不同 persona
  ├── IT-CONC-02: 同 persona 冲突
  ├── IT-CB-01: 熔断触发
  └── IT-CB-02: 429 重试

Phase 8: 跨 Workflow 组合
  ├── IT-CROSS-01: deep_article → quick_post
  └── IT-CROSS-02: deep_article → multi_platform

Phase 9: API 业务正确性
  ├── API-01: 模式列表
  ├── API-02: 任务创建
  └── API-03: 状态转换

Phase 10: 生成报告
  ├── e2e_summary_{date}.md
  ├── e2e_metrics_{date}.json
  └── prompt_issues_{date}.md
```

---

## 第三十章：需求追溯矩阵

| 测试用例 | 规格需求 | 架构设计 | 详细设计 | 审视缺陷 |
|---------|---------|---------|---------|---------|
| IT-WF-API-01 | FR-CAP-06 #1 | 6.5 Workflow #1 | 9.1 | 缺陷2/5/6/8/9 |
| IT-WF-API-02 | FR-CAP-06 #2 | 6.5 Workflow #2 | 9.1 | 缺陷2/9 |
| IT-WF-API-03 | FR-CAP-06 #3 | 6.5 Workflow #3 | 9.1 | 缺陷2/5 |
| IT-WF-API-04 | FR-CAP-06 #5 | 6.5 Workflow #5 | 9.1 | 缺陷2 |
| IT-WF-API-05 | FR-CAP-06 #8 | 6.5 Workflow #8 | 9.1 | 缺陷2/8 |
| IT-WF-API-06 | FR-CAP-06 #7 | 6.5 Workflow #7 | 9.1 | 缺陷2 |
| IT-WF-API-07 | FR-CAP-06 #4 | 6.5 Workflow #4 | 9.1 | 缺陷2 |
| IT-WF-API-08 | FR-CAP-06 #6 | 6.5 Workflow #6 | 9.1 | 缺陷2/8 |
| IT-SOLO-01~08 | FR-SOL-01~04 | 10.6 | 5.2 | 缺陷4 |
| IT-MODE-01 | FR-ENG-03 | 5.1 ReAct | 7.1 | 缺陷5 |
| IT-MODE-02 | FR-ENG-03 | 5.1 Reflexion | 7.3 | 缺陷5 |
| IT-MODE-03 | FR-HRN-03 | 7.4 FeedbackLoop | 14.5 | 缺陷8 |
| IT-MODE-04 | FR-CAP-04 | 6.4 | 8.2 | 缺陷7 |
| IT-MODE-05 | FR-MAS-01 | 10.3 | 7.4 | 缺陷10 |
| E2E-SOLO-01~04 | FR-SOL-01~04 | 10.6 | 5.2 | 缺陷4 |
| CH-01~05 | FR-CAP-01 | 10.4 | 11.1 | 缺陷7 |
| IT-CONC-01~02 | FR-ENG-01 | 12.2 | 4.2 | 缺陷10 |
| IT-CB-01~02 | 4.3可靠性 | 9.2 | 16.3 | 缺陷10 |
| IT-CROSS-01~02 | — | — | — | 缺陷11 |
| API-01~03 | FR-ENG-01~06 | 4.7 | 4.2 | 缺陷3 |
| UT-CORE-01~10 | FR-ENG-01~06 | 4.1~4.6 | 3.1~3.6 | — |
| UT-DI-01~05 | FR-ENG-02 | 4.2 | 3.2 | — |
| UT-EVT-01~08 | FR-ENG-04 | 4.3 | 3.3 | — |
| UT-SOLO-01~04 | FR-SOL-01~04 | 10.6 | 5.2 | — |
| UT-MOD-01~08 | FR-ENG-03 | 5.1 | 7.1 | — |
| UT-REACT-01~05 | FR-ENG-03 | 5.1 ReAct | 7.1 | — |
| UT-PE-01~03 | FR-ENG-03 | 5.1 PlanExecute | 7.2 | — |
| UT-REF-01~05 | FR-ENG-03 | 5.1 Reflexion | 7.3 | — |
| UT-DLLM-01~04 | FR-ENG-03 | 5.1 | 7.3 | — |
| UT-WF-01~08 | FR-CAP-06 | 6.5 | 9.1 | — |
| UT-HE-01~03 | FR-ENG-01 | 12.2 | 4.2 | — |
| UT-PLG-01~07 | FR-EXT-01 | 11.1 | 10.1 | — |
| UT-SBOX-01~08 | FR-SEC-01 | 11.2 | 10.2 | — |
| UT-LLM-01~05 | FR-CAP-01 | 10.4 | 11.1 | — |
| UT-MEM-01~06 | FR-ENG-05 | 8.1 | 6.1 | — |
| UT-DEF-01~05 | FR-DEF-01 | 9.1 | 16.1 | — |
| UT-SEC-01~06 | FR-SEC-01 | 9.2 | 16.2 | — |
| UT-TB-01~08 | FR-MAS-02 | 10.1 | 7.5 | — |
| UT-MB-01~08 | FR-MAS-02 | 10.2 | 7.5 | — |
| UT-CMP-01~05 | FR-ENG-05 | 8.2 | 6.2 | — |
| UT-CP-01~08 | FR-ENG-06 | 8.3 | 6.3 | — |
| IT-API-01~27 | FR-ENG-01~06 | 4.7 | 4.2 | 缺陷3 |
| IT-SOP-01~07 | FR-CAP-06 | 6.5 | 9.1 | — |
| IT-PLG-01~05 | FR-EXT-01 | 11.1 | 10.1 | — |
| IT-XP-01~05 | FR-PLT-01 | 11.3 | 10.3 | — |
| IT-MA-01~04 | FR-MAS-01 | 10.3 | 7.4 | — |
| IT-AT-01~04 | FR-MAS-01 | 10.3 | 7.4 | — |
| IT-SW-01~05 | FR-MAS-01 | 10.3 | 7.4 | — |
| IT-DEF-01~04 | FR-DEF-01 | 9.1 | 16.1 | — |

---

# 附录

---

## 附录 A：E2E 测试报告模板

```markdown
# FlowForge v7.0 E2E 测试报告

> 日期: YYYY-MM-DD
> 执行人: AI Agent 测试工程师
> 代码基础: Agent 源码审查完成

## 一、模型通道健康

| 通道 | 状态 | 延迟(ms) | 备注 |
|------|------|---------|------|
| doubao-api | ✅/❌ | - | - |
| doubao-web/chat | ✅/❌ | - | 模型名已确认为 chat |
| openroute-api | ✅/❌ | - | - |
| openroute-web | ✅/❌ | - | - |

## 二、Workflow API 路径结果

| ID | Workflow | 步骤 | 通道 | 状态 | LLM | Tool | 耗时 | 备注 |
|----|---------|------|------|------|-----|------|------|------|
| IT-WF-API-01 | deep_article | 8 | - | - | - | - | - | - |
| IT-WF-API-02 | quick_post | 3 | - | - | - | - | - | - |
| IT-WF-API-03 | trend_article | 4 | - | - | - | - | - | - |
| IT-WF-API-04 | seo_content | 6 | - | - | - | - | - | - |
| IT-WF-API-05 | report_generation | 8+并 | - | - | - | - | - | - |
| IT-WF-API-06 | multilingual | 5 | - | - | - | - | - | - |
| IT-WF-API-07 | multi_platform | 4 | - | - | - | - | - | - |
| IT-WF-API-08 | image_article | 5 | - | - | - | - | - | - |

## 三、Solo UI 路径结果

| ID | 场景 | 状态 | LLM | Tool | 时间线节点 | 备注 |
|----|------|------|-----|------|----------|------|
| IT-SOLO-01 | deep_article | - | - | - | - | - |
| IT-SOLO-02 | quick_post | - | - | - | - | - |
| IT-SOLO-03 | trend_article | - | - | - | - | - |
| IT-SOLO-04 | seo_content | - | - | - | - | - |
| IT-SOLO-05 | report_generation | - | - | - | - | - |
| IT-SOLO-06 | multilingual | - | - | - | - | - |
| IT-SOLO-07 | multi_platform | - | - | - | - | - |
| IT-SOLO-08 | image_article | - | - | - | - | - |

## 四、前端 E2E 结果

| ID | 场景 | 状态 | 备注 |
|----|------|------|------|
| E2E-SOLO-01 | ReAct Solo 流程 | - | - |
| E2E-SOLO-02 | Workflow Solo 流程 | - | - |
| E2E-SOLO-03 | 断线重连 | - | - |
| E2E-SOLO-04 | 审核交互 | - | - |

## 五、并发与容错

| ID | 场景 | 状态 | 备注 |
|----|------|------|------|
| IT-CONC-01 | 10并发 | - | - |
| IT-CONC-02 | 同persona冲突 | - | - |
| IT-CB-01 | 熔断 | - | - |
| IT-CB-02 | 429重试 | - | - |

## 六、跨 Workflow

| ID | 场景 | 状态 | 备注 |
|----|------|------|------|
| IT-CROSS-01 | deep→quick | - | - |
| IT-CROSS-02 | deep→multi | - | - |

## 七、关键指标汇总

| 指标 | 总计 | 均值/Workflow | 达标 |
|------|------|-------------|------|
| 总 LLM 调用次数 | - | - | - |
| 总工具调用次数 | - | - | - |
| Agent-as-Judge 不同模型 | -/2 | - | - |
| Reflexion 生效 (仅模式执行器直接模式) | -/0 | - | - |
| 并行步骤时间重叠 | -/1 | - | - |
| WebSocket 事件丢包 | - | - | - |
| 时间线渲染出错 | - | - | - |
| 流式渲染完整 | - | - | - |

## 八、发现的问题

| # | 问题 | 严重度 | 根因 | 修复状态 |
|---|------|--------|------|---------|
| 1 | content_audit 未用独立模型 | P0 | Agent 代码硬编码 | 待修复 |
| 2 | Reflexion 在 Workflow 中不生效 | P1 | WorkflowExecutor 跳过 mode | 待修复 |
| 3 | doubao-web 需特殊 Prompt 约束 | P1 | 网页版无 tool_calls | 已适配 |

## 九、结论

| 通过率 | Workflow API | Solo UI | 前端 E2E | 并发 | 综合 |
|--------|:---:|:---:|:---:|:---:|:---:|
| 目标 | 8/8 | 8/8 | 4/4 | 4/4 | 24/24 |
| 实际 | -/8 | -/8 | -/4 | -/4 | -/24 |

🟢/🔴 **通过/不通过** — 说明
```

---

## 附录 B：架构问题清单

> 来源：testreview.md 代码审查发现的 3 个架构问题 + testreview1.md 审核发现的 5 个修正项

### 问题 1：Workflow 步骤的 mode 字段形同虚设

**严重度**：P1

**描述**：YAML 中声明 `mode: "rewoo"` 但在 Workflow API 路径中完全不被使用。WorkflowExecutor 在步骤有 agent 时直接调用 `agent.execute_with_context()`，跳过 mode executor。

**影响**：
- 测试预期（基于 mode name）与实际执行（基于 Agent 代码）脱节
- Reflexion 迭代在 Workflow 中不生效
- Agent-as-Judge 在 Workflow 中不生效

**建议修复**：要么让 WorkflowExecutor 在无 agent 但有 mode 时使用 mode executor，要么为了灵活性保留当前设计但文档化清晰说明。

**测试影响**：所有 Workflow API 路径测试用例的 LLM 次数和工具调用链必须基于 Agent 源码，不能基于 mode 名称。

### 问题 2：content_audit 无法使用独立模型

**严重度**：P0

**描述**：当前 `ContentAuditAgent` 两次 `llm.execute()` 使用相同的 `persona` 参数，没有参数指定使用不同的模型。`agent_judge` 模式执行器 (`AgentJudgeExecutor`) 调用 `judge_actor` 和 `judge_evaluator` 两个 Agent，但在 Workflow 上下文中这个 executor 根本没被调用——WorkflowExecutor 直接调用 Agent。

**影响**：
- 审核评分与执行使用同一模型，评分缺乏独立性
- spec.md FR-HRN-03 要求"独立评判 Agent"无法满足

**建议修复**：Agent 接收 `judge_model` 参数，LLM 调用时传递 `model` 参数。

**测试影响**：所有含 content_audit 步骤的 Workflow 测试用例中，"audit 模型 ≠ 执行模型"通过条件标注为"⚠️ 需代码修复前置条件"。

### 问题 3：Solo UI 和 Workflow API 的事件序列完全不同

**严重度**：P1

**描述**：前端时间线渲染依赖 WebSocket 事件。Solo 路径发出 `workflow.step.start/complete`、`tool.start/end`、`step.intermediate` 事件，而 Workflow API 路径发出 Agent 内部的 `topic_research.*`、`material_collection.*` 等自定义事件。前端需要同时处理两种事件格式。

**影响**：
- 前端时间线在两种路径下渲染逻辑不同
- 测试必须分别覆盖两条路径

**建议修复**：统一事件格式，或在 EventBusSoloAdapter 中增加对 Agent 内部事件的映射。

**测试影响**：测试用例必须区分 Workflow API 路径和 Solo UI 路径，分别验证事件序列。

### 问题 4：LLM 调用次数基于模式执行器假设（已修正）

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

### 问题 5：Reflexion 独立 Agent 条件不成立（已修正）

**严重度**：🟡 严重（已在 v7.0 中修正）

**描述**：test1.md IT-MODE-02 通过条件 3 要求"三个角色必须使用独立的 Agent"。但 DefaultLLMActor 和 DefaultLLMEvaluator 都使用同一个 LLM Tool（`DefaultLLMActor` 和 `DefaultLLMEvaluator` 共享底层 `llm.execute()` 调用），不满足"独立 Agent"的定义。

**修正方案**：

| 原条件 | 修正后条件 | 原因 |
|--------|-----------|------|
| 三个角色使用独立 Agent | **三种 Prompt 不同** | DefaultLLMActor/Evaluator 共用同一个 LLM Tool，无法满足"独立 Agent" |

**验证方法**：
1. 提取 Actor/Evaluator/Reflector 三者的 system prompt 模板
2. 断言三者内容不完全相同
3. 如需真正"独立 Agent"，需代码层面将 Evaluator 拆分为独立 Agent 类（当前不在 v7.0 测试范围内，标记为待修复）

**v7.0 中的体现**：
- 第 18 章 IT-MODE-02 通过条件 3 已改为"三种 Prompt 不同"
- 需求追溯矩阵中标注"spec.md FR-HRN-03 要求'独立评判 Agent'无法满足，降级为 Prompt 差异验证"

---

> **附录 B 修订记录**：v7.0 新增，汇总 5 项审核修正的详细对照。所有修正已同步到正文各章节。