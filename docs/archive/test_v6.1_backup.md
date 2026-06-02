# FlowForge 测试用例设计 v1.1

> **对应文档**：FlowForge 架构设计 v4.0 + 详细设计 v2.0 + API 参考 v1.1
> **测试策略**：单元测试 → 集成测试 → E2E 测试

---

## 第一章：测试策略总览

### 1.1 测试层级

| 层级 | 框架 | 目标 | 覆盖率要求 |
|------|------|------|-----------|
| **单元测试** | pytest + pytest-asyncio | 每个模块、接口、工具函数独立验证 | ≥ 85% |
| **集成测试** | pytest + httpx | API 端点、SOP 流程、数据库操作、插件系统 | ≥ 70% |
| **E2E 测试** | Playwright (可选) | Web UI 完整用户流程、Solo 模式实时交互 | 核心流程 100% |
| **跨平台测试** | pytest + 条件跳过 | Windows/Linux 兼容性验证 | 关键模块 100% |

### 1.2 测试环境

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
    """统一 LLM Mock：所有测试共享此 Mock，避免每个测试单独定义。"""
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

## 第二章：单元测试用例

### 2.1 核心接口测试 (core/)

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

### 2.2 依赖注入容器测试 (core/di.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-DI-01** | 注册并解析单例 | register_singleton("test", lambda: "hello") | resolve("test") == "hello" |
| **UT-DI-02** | 单例返回同一实例 | resolve 两次 | 两次返回相同实例 |
| **UT-DI-03** | 解析未注册依赖 | resolve("nonexistent") | 抛出 KeyError |
| **UT-DI-04** | 注册实例 | register_instance("test", object()) | resolve("test") 返回该实例 |
| **UT-DI-05** | resolve_all_agents 只返回 Agent | register_agent 2 个 + register_singleton 1 Tool | 返回 2 个 Agent |

### 2.3 事件总线测试 (events/)

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

### 2.4 EventBusSoloAdapter 测试 (events/solo_adapter.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-SOLO-01** | bridge 建立全部事件映射 | bridge() | 17 个订阅者注册到 event_bus（17 个 FlowForge 事件映射到 16 种 Solo 事件类型） |
| **UT-SOLO-02** | bridge 防重入 | bridge() 调用两次 | _bridged=True，第二次不重复订阅 |
| **UT-SOLO-03** | 事件映射正确 | emit "llm.stream" | solo_manager.emit_event 被调用，参数为 "solo.llm.stream" |
| **UT-SOLO-04** | task_id 正确传递 | emit(task_id="task-001") | solo_manager.emit_event 收到 task_id="task-001" |

### 2.5 ModeRegistry 测试 (modes/registry.py)

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

### 2.6 模式执行器测试 (modes/)

#### 2.6.1 ReActExecutor

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-REACT-01** | 正常执行 3 步后给出最终回答 | 返回 final_answer + steps=3 |
| **UT-REACT-02** | 达到 MAX_STEPS 停止 | steps ≤ 8 |
| **UT-REACT-03** | 循环检测触发 | 重复 Action 3 次后 emitted "react.loop_detected" |
| **UT-REACT-04** | 空输入返回空结果 | 不抛异常 |
| **UT-REACT-05** | 事件发射完整 | react.thought → react.action → react.observation |

#### 2.6.2 PlanExecuteExecutor

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-PE-01** | Planner 生成 3 步计划 | plan 列表长度为 3 |
| **UT-PE-02** | Executor 按序执行 | 步骤输出按序收集 |
| **UT-PE-03** | Planner JSON 解析失败时降级 | 返回空 plan，不崩溃 |

#### 2.6.3 ReflexionExecutor

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-REF-01** | 第一次迭代达到阈值 | iterations=1, score≥0.85 |
| **UT-REF-02** | 未达标继续迭代 | iterations>1 |
| **UT-REF-03** | 达到 MAX_ITERATIONS 停止 | iterations≤4 |
| **UT-REF-04** | 记录最佳结果 | best_score ≥ 所有迭代分数 |
| **UT-REF-05** | DefaultLLMActor 回退 | AgentRegistry 无 reflexion_actor 时使用默认 |

#### 2.6.4 DefaultLLM 系列

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-DLLM-01** | DefaultLLMActor.execute_with_context 正常执行 | 通过 context.tools 获取 LLM Tool 并返回 AgentOutput |
| **UT-DLLM-02** | DefaultLLMActor.execute() 抛 NotImplementedError | 提示必须使用 execute_with_context |
| **UT-DLLM-03** | DefaultLLMEvaluator JSON 容错解析 | 对 LLM 返回 JSON 内容使用 re.search 提取并解析 |
| **UT-DLLM-04** | DefaultLLMEvaluator 无 LLMTool 降级 | 返回默认 score=0.5 + No LLM tool 提示 |

#### 2.6.5 WorkflowExecutor

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

### 2.7 HybridExecutor 测试 (executor/hybrid_executor.py)

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-HE-01** | 顶层调用同 persona 并发锁 | 同一 persona 创建两个任务，第二个抛 ConflictError(409) |
| **UT-HE-02** | _is_substep=True 跳过 Persona 锁 | Workflow 子步骤调用 run(_is_substep=True)，不抛异常，正常执行 |
| **UT-HE-03** | _is_substep=False 同 persona 冲突 | 顶层入口重复创建同一专栏，确认为 409 |

### 2.8 插件系统测试 (core/plugin_manager.py)

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-PLG-01** | 从 entry_points 发现插件 | 扫描 flowforge.modes 组 |
| **UT-PLG-02** | 从 YAML 配置加载插件 | 解析 plugin 模块路径 |
| **UT-PLG-03** | 加载失败的插件不影响系统启动 | 一个插件加载失败，其他正常注册 |
| **UT-PLG-04** | mode 插件注册到 ModeRegistry | MyCustomMode 可 get() |
| **UT-PLG-05** | agent 插件注册到 AgentRegistry | MyAgent 可 get() |
| **UT-PLG-06** | tool 插件注册到 ToolRegistry | MyTool 可 execute() |
| **UT-PLG-07** | MCP 配置自动生成 Tool | mcp_servers 配置项生成对应 Tool |

### 2.9 沙箱安全测试 (tools/python_executor.py)

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

### 2.10 LLM Client 测试 (tools/llm_client.py)

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-LLM-01** | 正常调用返回内容 | result["content"] 非空 |
| **UT-LLM-02** | 主模型不可用，自动切换 fallback | 使用 fallback 模型 |
| **UT-LLM-03** | 所有模型不可用 | 抛出 AllModelsUnavailable |
| **UT-LLM-04** | Solo emitter 注入 | set_solo_emitter 后调用 llm.start/llm.end |
| **UT-LLM-05** | Token 统计更新 | token.stats 事件被发射 |

### 2.11 Memory 模块测试 (memory/)

| 用例 ID | 场景 | 预期 |
|---------|------|------|
| **UT-MEM-01** | WorkingMemory 存取 | store → retrieve 返回相同值 |
| **UT-MEM-02** | ShortTermMemory SQLite 存取 | store → retrieve 返回相同值 |
| **UT-MEM-03** | LongTermMemory SQLite 存取 | store → retrieve 返回相同值 |
| **UT-MEM-04** | SemanticMemory 未启用返回空 | search() → [] |
| **UT-MEM-05** | MemoryManager.hybrid_search | 跨类型检索正确合并 |
| **UT-MEM-06** | 过期清理 | ShortTermMemory TTL 过期后 retrieve 返回 None |

---

## 第三章：集成测试用例

### 3.1 API 端点测试

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

### 3.2 SOP 流程测试（Workflow + Reflexion 混合）

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-SOP-01** | deep_article 全流程（8 步骤） | 从 topic_research 到 publish 全部完成 |
| **IT-SOP-02** | Workflow 中 Reflexion Writer 迭代 | Writer 步骤 score≥0.85 |
| **IT-SOP-03** | 审核暂停后恢复 | 暂停→审核通过→继续→完成 |
| **IT-SOP-04** | 审核拒绝 | 任务状态 rejected |
| **IT-SOP-05** | Workflow 步骤失败 retry | retry 1 次后成功 |
| **IT-SOP-06** | Workflow 步骤失败 skip | 跳过失败步骤，继续后续 |
| **IT-SOP-07** | 并行组执行 | research 和 seo_analysis 时间重叠 |

### 3.3 插件系统集成测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-PLG-01** | pip 安装插件包 | 安装后自动发现并注册 |
| **IT-PLG-02** | YAML 配置加载插件 | 配置指定 module 路径后自动加载 |
| **IT-PLG-03** | MCP 工具接入 | mcp_servers 配置后 Tool 可用 |
| **IT-PLG-04** | OpenAPI 自动生成 Tool | spec_url 配置后生成对应 Tool |
| **IT-PLG-05** | 插件热加载 | /plugins/reload 后新插件生效 |

### 3.4 跨平台集成测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-XP-01** | Linux 沙箱完整功能 | timeout、memory_limit 均生效 |
| **IT-XP-02** | Windows 沙箱降级 | resource 模块不存在，自动降级为 psutil |
| **IT-XP-03** | Windows 无 psutil | 沙箱仍可执行，仅无内存限制 |
| **IT-XP-04** | 文件路径规范化 | Windows 反斜杠路径正确处理 |
| **IT-XP-05** | 平台检测 API | /system/platform 返回正确 os |

---

## 第四章：E2E 测试场景

### 4.1 Web UI 流程

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

### 4.2 Solo WebSocket 实时事件

| 用例 ID | 场景 | 预期事件序列 |
|---------|------|-------------|
| **E2E-SOLO-01** | 完整 ReAct 流程 | stage.enter → tool.start → tool.end → llm.start → llm.reasoning → llm.stream → llm.end → (循环) → task.completed |
| **E2E-SOLO-02** | Reflexion 迭代 | stage.enter → llm.end (Actor) → llm.reasoning (Evaluator) → llm.reasoning (Reflector) → (循环) → task.completed |
| **E2E-SOLO-03** | Workflow 审核 | stage.enter → ... → review.ready → (用户操作) → review.submitted → task.completed |
| **E2E-SOLO-04** | 断线重连 | WebSocket 断开 → 自动重连 → 发送 replay → 回放断线期间事件 |
| **E2E-SOLO-05** | 事件序号连续 | 所有事件 seq 连续无跳号 |

---

## 第五章：性能测试基准

### 5.1 压力测试指标

| 指标 | 目标 | 测试方法 |
|------|------|---------|
| **单 Agent 执行延迟** | < 2s (不含 LLM API 耗时) | 100 次 TopicAgent.execute() 取 P95 |
| **Workflow 8 步骤执行** | < 30s (不含 LLM API 耗时) | 10 次 deep_article Workflow 取均值 |
| **Reflexion 3 迭代** | < 15s (不含 LLM API 耗时) | 10 次 Reflexion Writer 取均值 |
| **并发创建 10 个不同 persona 任务** | 全部成功，无锁冲突 | 10 并发 POST /tasks |
| **WebSocket 事件延迟** | < 50ms (P95) | Solo 模式下 tool.start 到前端接收 |
| **插件加载时间** | < 500ms (10 个插件) | 启动时扫描 entry_points + YAML |
| **沙箱代码执行** | 启动延迟 < 100ms | 100 次 PythonExecutorTool 取均值 |

### 5.2 压力测试脚本示例

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

---

## 第六章：测试覆盖率目标

| 模块 | 目标覆盖率 | 关键覆盖项 |
|------|-----------|-----------|
| `core/` | ≥ 90% | BaseAgent, BaseTool, TaskContext, DI, Errors |
| `modes/` | ≥ 85% | 所有 9 种执行器核心逻辑 + DefaultLLM 系列 |
| `events/` | ≥ 90% | EventBus, SoloAdapter |
| `tools/` | ≥ 80% | Registry, Sandbox, LLMClient, MCPAdapter |
| `memory/` | ≥ 80% | MemoryManager, 5 种记忆后端 |
| `executor/` | ≥ 80% | HybridExecutor, StateManager |
| `plugins/` | ≥ 75% | PluginManager, entry_points 加载 |

---

# FlowForge 测试用例设计 v5.0（防御与协作增强版）

> **对应文档**：FlowForge 架构设计 v5.0 + 详细设计 v5.0
> **测试策略**：在 v1.1 基础上新增 v5.0 特性的测试用例

---

## 第七章：v5.0 新增单元测试用例

### 7.1 三层防御测试 (test_defense.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-DEF-01** | L1 工具超时触发 | 注册慢工具（sleep 5s），tool_timeout=1 | 返回 `ToolOutput(error="timed out after 1s")` |
| **UT-DEF-02** | L1 工具正常完成不超时 | 注册快工具（sleep 0.1s），tool_timeout=5 | 正常返回 `ToolOutput(result={...})` |
| **UT-DEF-03** | L2 _on_enter 钩子调用 | 自定义 ModeExecutor 覆写 `_on_enter` | `_on_enter` 被调用，ctx 被传入 |
| **UT-DEF-04** | L2 _on_exit 钩子调用 | 自定义 ModeExecutor 覆写 `_on_exit` | `_on_exit` 被调用，result 可被修改 |
| **UT-DEF-05** | L3 reflexion_retry 策略 | SOP 步骤 `on_error: "reflexion_retry"`，步骤失败 | 触发 Reflexion 分析 → 重试 |

### 7.2 安全工具注册表测试 (test_secure_registry.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-SEC-01** | readonly 工具无需审批 | safety_level="readonly" | 直接执行，不触发审批 |
| **UT-SEC-02** | normal 工具正常执行 | safety_level="normal" | 直接执行 |
| **UT-SEC-03** | dangerous 工具需审批 | safety_level="dangerous" + 无审批 | 返回 `ToolOutput(error="Permission denied")` |
| **UT-SEC-04** | dangerous 工具审批通过 | safety_level="dangerous" + 审批通过 | 正常执行 |
| **UT-SEC-05** | 非并发安全工具串行执行 | is_concurrency_safe=False + 2 并发调用 | 通过 asyncio.Lock 串行执行 |
| **UT-SEC-06** | set_tool_safety 动态修改 | `set_tool_safety("tool", "dangerous")` | 工具安全等级被更新 |

### 7.3 TaskBoard 测试 (test_task_board.py)

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

### 7.4 Mailbox 测试 (test_mailbox.py)

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

### 7.5 ContextCompressor 测试 (test_compressor.py)

| 用例 ID | 场景 | 输入 | 预期输出 |
|---------|------|------|---------|
| **UT-CMP-01** | 低于阈值不压缩 | 短消息列表 | 原样返回，不调用 LLM |
| **UT-CMP-02** | 超过阈值触发压缩 | 长消息列表（>85% 上下文窗口） | 早期历史被压缩为摘要消息 |
| **UT-CMP-03** | 关键消息判断 | tool/assistant+tool_calls/system 消息 | `_is_decision_or_tool_result()` 返回 True |
| **UT-CMP-04** | 无 LLM 可用时降级 | 无 LLM 工具 + 无 llm_client | 保持原始消息不压缩 |
| **UT-CMP-05** | set_context_window | `set_context_window(64000)` | 后续压缩使用新的窗口大小 |

### 7.6 CheckpointManager 增强测试

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

## 第八章：v5.0 Multi-Agent 策略集成测试

### 8.1 Subagents 策略测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-MA-01** | 2 个子任务并行执行 | 两个任务结果均返回，互不影响 |
| **IT-MA-02** | 子任务隔离性 | 子任务 state 修改不影响父 context |
| **IT-MA-03** | 子任务失败不影响其他 | 1 个子任务失败，其他正常返回 |
| **IT-MA-04** | 自动任务分解 | 无 sub_tasks 时自动调用 LLM 分解 |

### 8.2 Agent Teams 策略测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-AT-01** | Lead 分解 + 团队认领 | 任务被正确分解到 TaskBoard，团队成员认领执行 |
| **IT-AT-02** | Mailbox 通信 | 成员发送 critical 消息 → Lead 触发 replan |
| **IT-AT-03** | 空闲检测退出 | 连续 N 轮无进展 → 自动退出循环 |
| **IT-AT-04** | 任务失败处理 | 成员任务失败 → fail_task + 通知 Lead |

### 8.3 Swarms 策略测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-SW-01** | Worker 认领 + 执行 + 完成 | Worker 从 TaskBoard 认领任务并完成 |
| **IT-SW-02** | 心跳监控 | Worker 发送心跳 → Coordinator 记录 |
| **IT-SW-03** | 失联检测 | Worker 停止心跳 → Coordinator 重置其任务 |
| **IT-SW-04** | 空闲退出 | 无任务可认领 → max_empty_rounds 后退出 |
| **IT-SW-05** | 任务重试 | 任务失败 → 重试 → 超过 max_retry 后 fail |

---

## 第九章：v5.0 防御集成测试

### 9.1 三层防御联合测试

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-DEF-01** | L1 超时 → L2 检测 → L3 修正 | 工具超时 → 重复检测 → reflexion_retry 自修正 |
| **IT-DEF-02** | 防御配置传递 | `ctx.metadata["defense"]` 正确合并到步骤级 |
| **IT-DEF-03** | SOP 模板渲染 | `{{variable}}` 被正确替换 |
| **IT-DEF-04** | Checkpoint 入口保存 | checkpoint_enabled=True 时，SOP 入口自动保存检查点 |

---

## 第十章：v5.0 测试覆盖率目标

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

**以上为 FlowForge 测试用例设计 v5.0（防御与协作增强版）。** 本版本在 v1.1 基础上新增三层防御、安全工具、协作基础设施、上下文压缩、Multi-Agent 三策略的测试用例，所有 v1.1 内容保持不变。

# FlowForge 测试用例设计 v6.1

> **版本**: 6.1 | **日期**: 2026-05-24 | **状态**: 待评审
> **设计基础**: 逐文件审查 `flowforge/agents/*.py` + `flowforge/modes/*.py` + `flowforge/workflows/*.yaml`
> **核心变化**: v6.0 的预期过程基于"模式执行器在 Workflow 中生效"的错误假设，v6.1 基于 Agent 源码的真实执行链路重写
> **重要发现**: WorkflowExecutor 在步骤有 agent 时跳过 mode executor 直接调用 agent.execute\_with\_context()，详见 testreview\.md

***

## 第一章：测试策略总览

### 1.1 两条执行路径（不可混淆）

| 路径               | 入口                   | 核心方法                          | 事件格式                                                            | 适用场景                   |
| ---------------- | -------------------- | ----------------------------- | --------------------------------------------------------------- | ---------------------- |
| **Workflow API** | `POST /api/v1/tasks` | `_execute_sop_steps()`        | Agent 内部事件 `topic_research.*`, `material_collection.*`          | 按 YAML 定义的 Workflow 执行 |
| **Solo UI**      | WebSocket 对话框        | `_execute_intelligent_chat()` | 动态规划事件 `workflow.step.start`, `tool.start`, `step.intermediate` | 自由对话 + LLM 动态规划        |

**测试必须分别覆盖两条路径**。它们的 LLM 调用次数、工具链、事件序列完全不同。

### 1.2 测试层级

| 层级                      | 框架                     | 数据                 | 目标                                                           |
| ----------------------- | ---------------------- | ------------------ | ------------------------------------------------------------ |
| **单元测试**                | pytest                 | Mock LLM 可用        | 模块/接口/工具函数独立验证                                               |
| **集成测试 (Workflow API)** | pytest + httpx         | **真实 LLM**         | 8 个 Workflow 全流程                                             |
| **集成测试 (Solo UI)**      | pytest + WebSocket 客户端 | **真实 LLM**         | Solo 动态规划全流程                                                 |
| **E2E 测试**              | Playwright             | **真实 LLM + 真实浏览器** | 前端时间线渲染 + WebSocket                                          |
| **通道测试**                | pytest                 | **真实 LLM 分通道**     | doubao-api / doubao-web/chat / openroute-api / openroute-web |

### 1.3 Mock 使用铁律

| 允许 Mock                | 禁止 Mock               |
| ---------------------- | --------------------- |
| BaseAgent.execute 接口验证 | Workflow 端到端验证        |
| TaskContext 深拷贝测试      | Agent 执行链路验证          |
| EventBus 回调调度测试        | Tool 调用链验证            |
| DI 容器解析测试              | LLM 输出格式验证            |
| 数据库 CRUD 测试            | 前端 Solo WebSocket E2E |
| 沙箱安全规则测试               | 多模型通道测试               |

### 1.4 "测试通过"的定义

一个测试用例**通过**意味着：

1. **所有预期阶段按序执行** — 阶段顺序与 Workflow YAML 一致
2. **每个阶段的 Agent 被正确调用** — 输出了 Agent 源码中定义的 EventBus 事件
3. **每个 Agent 的工具调用链符合预期** — 工具名匹配，调用次数在 `[min, max]` 范围内
4. **每个 Agent 的 LLM 调用次数符合预期** — 在 `[min, max]` 范围内
5. **阶段输出格式完整** — 必填字段存在且类型正确
6. **前端时间线正确渲染** — Solo 路径下每个节点的图标、文本、子节点正确
7. **WebSocket 事件序列完整** — 无丢事件，事件序号连续

***

## 第二章：Workflow API 路径测试用例

### 2.0 模型配置要求

```
执行模型: doubao-api/deepseek-v3 (或类似推理模型)
评审模型: doubao-api/gemini-2.5-pro (必须不同！)
网页版模型: doubao-web/chat (非 seed-2.0)
备用通道: openroute-api
```

**执行前必须验证模型可用性**：

- `doubao-web/chat` — 确认模型名已从 seed-2.0 更新
- `openroute-api` — API-only 验证通过后作为备用通道
- 不通过的模型：API 版设置 `enabled: false`，网页版修正 Prompt 约束

***

### 2.1 WF1: 深度长文 Workflow (deep\_article) — 8 步 API 路径

**测试 ID**: IT-WF-API-01

**输入**:

```json
{
  "workflow": "deep_article",
  "persona": "tech_blog",
  "task": "帮我写一篇关于2025年AI Agent发展趋势的深度分析文章，面向技术从业者",
  "platforms": ["local"],
  "auto_approve_review": true
}
```

**预期执行过程** (基于 Agent 源码):

| 阶段                     | Agent                   | WorkflowExecutor 行为                 | Agent 内部步骤                                         | LLM 次数 | 工具调用                                     | EventBus 事件 (关键)                                                                                                                                                                      |
| ---------------------- | ----------------------- | ----------------------------------- | -------------------------------------------------- | ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 topic\_research      | TopicResearchAgent      | 直接调用 agent.execute\_with\_context() | cache→opensieve\_search→web\_search→LLM(回退)        | 0\~1   | opensieve\_search×0\~1, web\_search×0\~1 | `topic_research.opensieve_search_start/complete`, `topic_research.complete`                                                                                                           |
| 2 material\_collection | MaterialCollectionAgent | 直接调用 agent.execute\_with\_context() | cache\_check(opensieve)→web\_search→llm\_summarize | 2\~4   | opensieve\_search×N, web\_search×M       | `material_collection.cache_check_start/complete`, `material_collection.web_search_start/complete`, `material_collection.llm_summarize_start/complete`, `material_collection.complete` |
| 3 writing              | ArticleWritingAgent     | 直接调用 agent.execute\_with\_context() | LLM generate                                       | 1      | 无                                        | `article_writing.generation_start`, `article_writing.complete`                                                                                                                        |
| 4 seo\_opt             | SEOOptimizationAgent    | 直接调用 agent.execute\_with\_context() | planning→optimize                                  | 2      | 无                                        | `seo_optimization.planning_start/complete`, `seo_optimization.optimize_start/complete`                                                                                                |
| 5 fact\_check          | FactCheckAgent          | 直接调用 agent.execute\_with\_context() | url\_check→fact\_verify                            | 1      | httpx HEAD×N                             | `fact_check.url_check_start/complete`, `fact_check.fact_verify_start/complete`, `fact_check.complete`                                                                                 |
| 6 audit                | ContentAuditAgent       | 直接调用 agent.execute\_with\_context() | assess→compliance                                  | 2      | 无                                        | `content_audit.assess_start/complete`, `content_audit.compliance_start/complete`, `content_audit.complete`                                                                            |
| 7 review               | (human)                 | `_pause_for_review()`               | 暂停 (auto\_approve\_review=true 跳过)                 | 0      | 无                                        | `review.ready`                                                                                                                                                                        |
| 8 publish              | PublishingAgent         | 直接调用 agent.execute\_with\_context() | publish per platform                               | 0      | publish\_local×1                         | `publishing.platform_done`, `publishing.complete`                                                                                                                                     |

**汇总**:

- 总 LLM 调用: **8\~11 次**
- 总工具调用: **opensieve\_search 2\~M, web\_search 0\~M, httpx HEAD 0\~N, publish\_local 1**
- 总阶段: **8** (review=auto\_approve 时跳过)

**通过条件**:

1. ✅ 8 个阶段按 `topic_research→material_collection→writing→seo_opt→fact_check→audit→review→publish` 顺序执行
2. ✅ 阶段 1 topic\_research 输出 `topics` 数组，至少 1 个元素含 `title` 和 `url`
3. ✅ 阶段 2 material\_collection 输出 `materials` 数组，至少 1 个元素含 `content`
4. ✅ 阶段 3 writing 输出 `draft` 字段，长度 ≥ 500 字符
5. ✅ 阶段 4 seo\_opt 输出 `seo_title` 字段
6. ✅ 阶段 5 fact\_check 输出 `is_clean` 和 `issues` 字段
7. ✅ 阶段 6 audit 输出 `score` (float) 和 `is_clean` (bool)
8. ✅ 阶段 6 audit 使用的 LLM 模型 ≠ 阶段 1-5 使用的 LLM 模型 (需代码修复)
9. ✅ 阶段 8 publish 输出 `published` 字典，含已发布平台
10. ✅ 总耗时 < 300s

**指标记录**:

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

***

### 2.2 WF1-Solo: 深度长文 — Solo UI 路径

**测试 ID**: IT-SOLO-01

**操作**: 浏览器 Solo 对话框输入: "帮我写一篇关于2025年AI Agent发展趋势的深度分析文章"

**Solo UI 执行路径** (`_execute_intelligent_chat()`):

| 阶段                | 内部步骤                                      | LLM 次数 | 工具调用          | WebSocket 事件                                                                                                                           |
| ----------------- | ----------------------------------------- | ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1 意图识别 (planning) | `_call_llm(planner)`                      | 1      | 无             | `workflow.step.start(step=planning)`, `step.intermediate(规划完成: ...)`, `workflow.step.complete(planning)`                               |
| 2 搜索素材            | `_execute_tool_or_agent(web_search)`      | 0      | web\_search×1 | `workflow.step.start(搜索素材)`, `tool.start(web_search)`, `tool.end(web_search)`, `workflow.step.complete(搜索素材)`                          |
| 3 撰写内容            | `_execute_tool_or_agent(article_writing)` | 1      | 无             | `workflow.step.start(撰写内容)`, `tool.start(article_writing, is_agent=true)`, `tool.end(article_writing)`, `workflow.step.complete(撰写内容)` |
| 4 整理输出 (compile)  | `_call_llm(solo_assistant)`               | 1      | 无             | `workflow.step.start(compile, stage=compile)`, `workflow.step.complete(compile)`                                                       |
| 5 保存文件 (save)     | workspace I/O                             | 0      | file write    | `workflow.step.start(save)`, `draft.file`, `workflow.step.complete(save)`                                                              |

**汇总**:

- 总 LLM 调用: **3\~4 次** (planning + writing agent + compile + 可能搜索回退)
- 总工具调用: **web\_search × 1\~2 + publish × 0 (Solo不发布)**
- 总阶段: **4\~5** (planning→execute→compile→save)

**预期 WebSocket 事件序列**:

```
1. workflow.step.start  {"step": "planning", "stage": "planning"}
2. workflow.step.complete {"step": "planning", "intent_type": "write"}
3. step.intermediate     {"step_name": "规划完成: ..."}
4. workflow.step.start  {"step": "搜索素材", "stage": "搜索素材"}
5. tool.start            {"tool_name": "web_search"}
6. tool.end              {"tool_name": "web_search", "success": true}
7. workflow.step.complete {"step": "搜索素材"}
8. workflow.step.start  {"step": "撰写内容", "stage": "撰写内容"}
9. tool.start            {"tool_name": "article_writing", "is_agent": true}
10. article_writing.generation_start {"topic": "2025年AI Agent..."}
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

**通过条件**:

1. ✅ 前端时间线渲染的节点 ≥ 4 (planning → 搜索素材 → 撰写内容 → compile → save)
2. ✅ 搜索素材节点下显示 `web_search` 子节点（扳手图标）
3. ✅ 撰写内容节点下显示 `article_writing` Agent 子节点
4. ✅ compile 后 `draft.update` 事件内容非空
5. ✅ save 后显示文件下载链接
6. ✅ 所有 `tool.start/tool.end` 成对出现
7. ✅ 事件序号连续无跳号

***

### 2.3 WF2: 快速发文 Workflow (quick\_post) — API 路径

**测试 ID**: IT-WF-API-02

**输入**:

```json
{"workflow": "quick_post", "persona": "news_flash", "task": "写一篇关于GPT-5最新发布消息的速报"}
```

**预期执行过程** (3 步):

| 阶段                | Agent               | Agent 内部步骤                      | LLM 次数 | 工具调用                         |
| ----------------- | ------------------- | ------------------------------- | ------ | ---------------------------- |
| 1 topic\_research | TopicResearchAgent  | cache→opensieve→web\_search→LLM | 0\~1   | opensieve×1 or web\_search×1 |
| 2 writing         | ArticleWritingAgent | LLM generate                    | 1      | 无                            |
| 3 publish         | PublishingAgent     | publish per platform            | 0      | publish\_local×1             |

**汇总**: LLM 1\~2 次, 工具 1\~2 次, 总耗时 < 60s

**通过条件**:

1. ✅ 3 个阶段顺序执行
2. ✅ writing 输出 draft 长度 ≥ 200 字符
3. ✅ publish 输出 published 字典

***

### 2.4 WF3: 热点追踪 Workflow (trend\_article) — API 路径

**测试 ID**: IT-WF-API-03

**输入**:

```json
{"workflow": "trend_article", "persona": "trend_watcher", "task": "追踪本周AI领域最新热点并撰写文章", "domain": "AI"}
```

**预期执行过程** (4 步):

| 阶段                | Agent               | Agent 内部步骤                                     | LLM 次数 | 工具调用                         |
| ----------------- | ------------------- | ---------------------------------------------- | ------ | ---------------------------- |
| 1 trend\_analysis | TrendAnalysisAgent  | collect\_data→analyze\_trends→generate\_report | 2\~3   | web\_search×1                |
| 2 topic\_research | TopicResearchAgent  | cache→opensieve→web\_search→LLM                | 0\~1   | opensieve×1 or web\_search×1 |
| 3 writing         | ArticleWritingAgent | LLM generate                                   | 1      | 无                            |
| 4 publish         | PublishingAgent     | publish per platform                           | 0      | publish\_local×1             |

**合计**: LLM 3\~5 次, 工具 2\~3 次, 总耗时 < 120s

**特殊验证**: 阶段 1 的 `trends` 数组至少含 3 条热点，`heat` 和 `direction` 字段非空

***

### 2.5 WF4: SEO 内容 Workflow (seo\_content) — API 路径

**测试 ID**: IT-WF-API-04

**输入**:

```json
{"workflow": "seo_content", "persona": "seo_writer", "task": "写一篇关于'Python异步编程最佳实践'的SEO优化文章"}
```

**预期执行过程** (6 步):

| 阶段                     | Agent                   | Agent 内部步骤                       | LLM 次数 | 工具调用                         |
| ---------------------- | ----------------------- | -------------------------------- | ------ | ---------------------------- |
| 1 topic\_research      | TopicResearchAgent      | 降级链                              | 0\~1   | opensieve×1 or web\_search×1 |
| 2 seo\_optimization    | SEOOptimizationAgent    | planning→optimize                | 2      | 无                            |
| 3 material\_collection | MaterialCollectionAgent | cache→web\_search→llm\_summarize | 2\~4   | opensieve×N + web\_search×M  |
| 4 writing              | ArticleWritingAgent     | LLM generate                     | 1      | 无                            |
| 5 fact\_check          | FactCheckAgent          | url\_check→fact\_verify          | 1      | httpx HEAD×N                 |
| 6 publish              | PublishingAgent         | publish per platform             | 0      | publish\_local×1             |

**合计**: LLM 6\~9 次, 工具 3\~M 次, 总耗时 < 200s

**特殊验证**: 阶段 2 输出的 `suggested_keywords` 非空

***

### 2.6 WF5: 报告生成 Workflow (report\_generation) — 含并行步骤

**测试 ID**: IT-WF-API-05

**输入**:

```json
{"workflow": "report_generation", "persona": "analyst", "task": "生成一份关于2025年云计算市场格局的深度报告"}
```

**预期执行过程** (8 步 + 并行):

| 阶段                      | Agent                   | LLM 次数 | 工具调用                    | 并行验证                   |
| ----------------------- | ----------------------- | ------ | ----------------------- | ---------------------- |
| 1 topic\_research       | TopicResearchAgent      | 0\~1   | opensieve/web\_search   | -                      |
| 2 parallel: research\_1 | MaterialCollectionAgent | 2\~4   | opensieve + web\_search | **与 research\_2 并发执行** |
| 2 parallel: research\_2 | MaterialCollectionAgent | 2\~4   | opensieve + web\_search | **与 research\_1 并发执行** |
| 3 writing               | ArticleWritingAgent     | 1      | 无                       | -                      |
| 4 seo\_optimization     | SEOOptimizationAgent    | 2      | 无                       | -                      |
| 5 fact\_check           | FactCheckAgent          | 1      | httpx HEAD              | -                      |
| 6 content\_audit        | ContentAuditAgent       | 2      | 无                       | -                      |
| 7 review                | (human pause)           | 0      | -                       | auto\_approve 跳过       |
| 8 publish               | PublishingAgent         | 0      | publish\_local          | -                      |

**合计**: LLM 10\~15 次, 工具 4\~M 次, 总耗时 < 300s

**并行验证**:

1. ✅ `research_1` 和 `research_2` 的开始时间差 < 2s（确认同时启动）
2. ✅ 总耗时 < `(research_1 耗时 + research_2 耗时)` × 1.1（确认不串行）
3. ✅ `research_1` 和 `research_2` 的输出不互相污染（`materials_1` ≠ `materials_2`）

***

### 2.7 WF6: 多语言 Workflow (multilingual) — API 路径

**测试 ID**: IT-WF-API-06

**输入**:

```json
{"workflow": "multilingual", "persona": "global_writer", "task": "写一篇介绍中国茶文化的文章并翻译成英文和日文"}
```

**预期执行过程** (5 步):

| 阶段                     | Agent                   | LLM 次数                      | 工具调用                    |
| ---------------------- | ----------------------- | --------------------------- | ----------------------- |
| 1 topic\_research      | TopicResearchAgent      | 0\~1                        | opensieve/web\_search   |
| 2 material\_collection | MaterialCollectionAgent | 2\~4                        | opensieve + web\_search |
| 3 writing              | ArticleWritingAgent     | 1                           | 无                       |
| 4 translation          | MultilingualAgent       | 3 (detect+translate+verify) | 无                       |
| 5 publish              | PublishingAgent         | 0                           | publish\_local          |

**合计**: LLM 6\~9 次

**特殊验证**: 阶段 4 输出的 `translated` 字段至少含一个目标语言版本

***

### 2.8 WF7: 多平台分发 Workflow (multi\_platform) — API 路径

**测试 ID**: IT-WF-API-07

**输入**:

```json
{"workflow": "multi_platform", "persona": "social_media", "task": "写一篇关于远程办公效率的文章并适配公众号/头条/知乎三个平台", "platforms": ["wechat", "toutiao", "zhihu"]}
```

**预期执行过程** (4 步):

| 阶段                | Agent                  | LLM 次数                            | 工具调用                  |
| ----------------- | ---------------------- | --------------------------------- | --------------------- |
| 1 topic\_research | TopicResearchAgent     | 0\~1                              | opensieve/web\_search |
| 2 writing         | ArticleWritingAgent    | 1                                 | 无                     |
| 3 repurpose       | ContentRepurposerAgent | 1 + 3 (analyze + 3 platforms) = 4 | 无                     |
| 4 publish         | PublishingAgent        | 0                                 | publish\_local        |

**合计**: LLM 5\~6 次

**特殊验证**: 阶段 3 输出的 `variants` 字典含 3 个 key (`wechat`, `toutiao`, `zhihu`)，每个 value 非空且风格不同

***

### 2.9 WF8: 图文并茂 Workflow (image\_article) — API 路径

**测试 ID**: IT-WF-API-08

**输入**:

```json
{"workflow": "image_article", "persona": "visual_writer", "task": "写一篇关于世界各地最美咖啡馆的介绍文章，配上图片"}
```

**预期执行过程** (5 步):

| 阶段                     | Agent                   | LLM 次数 | 工具调用                        |
| ---------------------- | ----------------------- | ------ | --------------------------- |
| 1 topic\_research      | TopicResearchAgent      | 0\~1   | opensieve/web\_search       |
| 2 material\_collection | MaterialCollectionAgent | 2\~4   | opensieve + web\_search     |
| 3 writing              | ArticleWritingAgent     | 1      | 无                           |
| 4 image\_research      | ImageResearchAgent      | 1\~2   | pexels\_image 或 web\_search |
| 5 publish              | PublishingAgent         | 0      | publish\_local              |

**合计**: LLM 4\~8 次, 工具 3\~M 次

**特殊验证**: 阶段 4 输出的 `images` 数组至少含 2 张图片

***

## 第三章：8 个 Workflow × 2 条路径覆盖矩阵

| Workflow           | Workflow API 测试 |  Solo UI 测试  | Solo 事件序列验证 |     前端时间线验证    |
| ------------------ | :-------------: | :----------: | :---------: | :------------: |
| deep\_article      |  ✅ IT-WF-API-01 | ✅ IT-SOLO-01 |      ✅      | ✅ (Playwright) |
| quick\_post        |  ✅ IT-WF-API-02 | ✅ IT-SOLO-02 |      ✅      |        ✅       |
| trend\_article     |  ✅ IT-WF-API-03 | ✅ IT-SOLO-03 |      ✅      |        ✅       |
| seo\_content       |  ✅ IT-WF-API-04 | ✅ IT-SOLO-04 |      ✅      |        ✅       |
| report\_generation |  ✅ IT-WF-API-05 | ✅ IT-SOLO-05 |      ✅      |        ✅       |
| multilingual       |  ✅ IT-WF-API-06 | ✅ IT-SOLO-06 |      ✅      |        ✅       |
| multi\_platform    |  ✅ IT-WF-API-07 | ✅ IT-SOLO-07 |      ✅      |        ✅       |
| image\_article     |  ✅ IT-WF-API-08 | ✅ IT-SOLO-08 |      ✅      |        ✅       |

***

## 第四章：Solo UI 路径专项测试

### 4.1 Solo 简单消息 Fast-path (1 LLM)

**测试 ID**: IT-SOLO-FAST-01
**输入**: "你好"
**预期**: `_is_simple_message()` 返回 True → 跳过 planning → 直接 `_simple_response()` 1 次 LLM
**事件序列**: `workflow.step.start(response)` → `workflow.step.complete(response)` → `draft.update`

### 4.2 Solo 写文章动态规划 (多步骤)

**测试 ID**: IT-SOLO-WRITE-01
**输入**: "写一篇关于量子计算的科普文章"
**预期流程**:

```
planning(LLM×1) → step.intermediate(规划完成: write, 2步) 
→ 搜索素材(web_search) → 撰写内容(article_writing agent, LLM×1) 
→ compile(LLM×1) → save → draft.update
```

**LLM 调用**: 3\~4 次
**验证**: 前端时间线显示 4\~5 个阶段节点

### 4.3 Solo 搜索类任务

**测试 ID**: IT-SOLO-SEARCH-01
**输入**: "搜索2025年Gartner最新技术趋势报告"
**预期流程**: planning→搜索信息(web\_search)→整理回复(generate, LLM×1)→compile(LLM×1)
**LLM 调用**: 3\~4 次

### 4.4 Solo 审核交互

**测试 ID**: IT-SOLO-REVIEW-01
**操作**: 通过 Solo 触发含审核的 Workflow → 等待 review\.ready → 点击"驳回"
**预期**:

1. ✅ review\.ready 事件触发
2. ✅ 前端显示审核按钮
3. ✅ 点击驳回 → review\.submitted
4. ✅ 任务状态变为 rejected

***

## 第五章：多模型通道测试

### 5.1 通道验证矩阵

| 测试 ID     | 通道              | Workflow    | 验证内容               |
| --------- | --------------- | ----------- | ------------------ |
| CH-API-01 | doubao-api      | quick\_post | API 原生 tool\_calls |
| CH-WEB-01 | doubao-web/chat | quick\_post | 网页版 Prompt 约束输出    |
| CH-API-02 | openroute-api   | quick\_post | API 备用通道           |
| CH-WEB-02 | openroute-web   | quick\_post | 网页版备用通道            |

### 5.2 网页版模型 Prompt 约束模板

当使用 doubao-web/chat 或 openroute-web 时（不支持原生 tool\_calls），LLM 客户端自动在 Prompt 中注入：

```
你必须严格按照以下格式输出：

如果需要搜索: 
  [TOOL:web_search]{"query": "搜索词"}

如果最终回答:
  [FINAL_ANSWER]你的回答内容

不要输出任何其他格式。
```

### 5.3 通道验证通过标准

| 通道              | 通过标准                              | 不通过处理               |
| --------------- | --------------------------------- | ------------------- |
| doubao-api      | quick\_post 3 阶段完成 + 工具格式正确       | 作为主通道               |
| doubao-web/chat | quick\_post 3 阶段完成 + TOOL: 格式解析正确 | 不通过则修正 Prompt       |
| openroute-api   | quick\_post 3 阶段完成                | 不通过则 enabled: false |
| openroute-web   | quick\_post 3 阶段完成                | 不通过则 enabled: false |

***

## 第六章：前端 Solo WebSocket E2E (Playwright)

### 6.1 测试环境

- 后端: `http://localhost:8889`
- 前端: `http://localhost:5173`
- WebSocket: `ws://localhost:8889/ws/{task_id}`

### 6.2 E2E-WEB-01: Solo 深度长文全流程时间线

**操作步骤**:

1. 打开 `http://localhost:5173`
2. 点击 "Solo" 模式
3. 在对话框输入: "帮我写一篇关于2025年AI Agent发展趋势的深度分析文章"
4. 点击发送
5. 观察时间线渲染

**验证点** (通过 Playwright 断言):

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

### 6.3 E2E-WEB-02: WebSocket 断线重连

**操作步骤**:

1. Solo 执行中 → 断开 WebSocket (browser offline)
2. 等待 5 秒
3. 恢复网络 → WebSocket 重连

**验证**: 时间线通过 `replay` 事件自动补全断线期间丢失的节点

### 6.4 E2E-WEB-03: 流式渲染验证

**验证点**:

1. ✅ LLM 思考过程中流式显示 `reasoning` 内容
2. ✅ 最终答案逐字渲染（非一次性出现）
3. ✅ react-markdown 正确渲染表格、代码块、链接

***

## 第七章：并发与容错测试

### 7.1 IT-CONC-01: 不同 Persona 并发

**操作**: 10 并发 POST `/api/v1/tasks`，使用 10 个不同 persona，quick\_post
**预期**: 全部 201，无 409

### 7.2 IT-CONC-02: 同 Persona 冲突

**操作**: 2 并发，同一 persona
**预期**: 第 1 个 201，第 2 个 409

### 7.3 IT-CB-01: 熔断触发

**操作**: 配置必失败工具 → 连续调用 5 次
**预期**: 第 6 次返回 Circuit Breaker 开启

### 7.4 IT-CB-02: 429 重试

**操作**: Mock LLM 返回 429 + Retry-After: 3
**预期**: 等待 3s 后重试成功

***

## 第八章：跨 Workflow 组合测试

### 8.1 IT-CROSS-01: deep\_article → quick\_post

**操作**: deep\_article 完成后，对同一 persona 执行 quick\_post
**验证**:

1. ✅ 两个 Workflow 独立完成
2. ✅ deep\_article 的 Memory 在 quick\_post 中可查询
3. ✅ Persona 锁在 deep\_article 完成后正确释放

### 8.2 IT-CROSS-02: deep\_article → multi\_platform

**操作**: deep\_article (含审核) → multi\_platform
**验证**:

1. ✅ multi\_platform 复用 deep\_article 的 draft
2. ✅ 两个 Workflow 的 publish 输出不同

***

## 第九章：Metrics Collector — 自动指标采集器

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

***

## 第十章：单元测试用例（保留 Mock）

以下单元测试保留使用 Mock LLM，验证纯逻辑和接口行为：

| ID          | 场景                                | 预期                            |
| ----------- | --------------------------------- | ----------------------------- |
| UT-AGENT-01 | BaseAgent.execute 返回 AgentOutput  | result 字段存在                   |
| UT-AGENT-02 | execute\_with\_context 传递 context | context 正确传递                  |
| UT-TOOL-01  | BaseTool.validate\_params 通过      | True                          |
| UT-TOOL-02  | BaseTool.validate\_params 失败      | False                         |
| UT-CTX-01   | TaskContext.from\_parent 深拷贝      | 子修改不影响父                       |
| UT-ERR-01   | FlowForgeError status\_code       | 500                           |
| UT-ERR-02   | ConflictError status\_code        | 409                           |
| UT-DEF-01   | L1 工具超时                           | ToolOutput(error="timed out") |
| UT-SEC-01   | readonly 工具直接执行                   | 无需审批                          |
| UT-SEC-02   | dangerous 工具需审批                   | Permission denied             |
| UT-MEM-01   | save\_full 版本递增                   | version 递增                    |
| UT-MEM-02   | restore 恢复                        | state + messages 完整           |

***

## 第十一章：测试执行顺序

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

Phase 2: 通道快速验证 (quick_post × 4 通道)
  ├── CH-API-01: doubao-api → PASS/FAIL
  ├── CH-WEB-01: doubao-web/chat → PASS/FAIL (FAIL → 修正 Prompt)
  ├── CH-API-02: openroute-api → PASS/FAIL
  └── CH-WEB-02: openroute-web → PASS/FAIL

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
  ├── IT-SOLO-FAST-01: 简单消息 fast-path
  ├── IT-SOLO-WRITE-01: 写文章动态规划
  ├── IT-SOLO-SEARCH-01: 搜索类任务
  └── IT-SOLO-REVIEW-01: 审核交互

Phase 5: 前端 Playwright E2E
  ├── E2E-WEB-01: Solo 时间线渲染
  ├── E2E-WEB-02: WebSocket 断线重连
  └── E2E-WEB-03: 流式渲染

Phase 6: 并发 + Circuit Breaker
  ├── IT-CONC-01/02
  └── IT-CB-01/02

Phase 7: 跨 Workflow 组合
  ├── IT-CROSS-01
  └── IT-CROSS-02

Phase 8: 生成报告
  ├── e2e_summary_{date}.md
  ├── e2e_metrics_{date}.json
  └── prompt_issues_{date}.md
```

***

## 第十二章：E2E 测试报告模板

```markdown
# FlowForge v6.1 E2E 测试报告

> 日期: 2026-05-24
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
| IT-SOLO-FAST-01 | 简单消息 | - | - | - | - | - |
| IT-SOLO-WRITE-01 | 写文章 | - | - | - | - | - |
| IT-SOLO-SEARCH-01 | 搜索 | - | - | - | - | - |
| IT-SOLO-REVIEW-01 | 审核 | - | - | - | - | - |

## 四、前端 E2E 结果

| ID | 场景 | 状态 | 备注 |
|----|------|------|------|
| E2E-WEB-01 | 时间线渲染 | - | - |
| E2E-WEB-02 | 断线重连 | - | - |
| E2E-WEB-03 | 流式渲染 | - | - |

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
| Reflexion 生效 | -/0 | - | - |
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
| 目标 | 8/8 | 4/4 | 3/3 | 4/4 | 19/19 |
| 实际 | -/8 | -/4 | -/3 | -/4 | -/19 |

🟢/🔴 **通过/不通过** — 说明
```

***

> **设计完成**。v6.1 核心变化:
>
> - ✅ 预期执行过程基于 Agent 源码真实链路（非模式执行器假设）
> - ✅ 区分 Workflow API 路径和 Solo UI 路径（两条路径分别测试）
> - ✅ 每个测试用例包含完整的 EventBus 事件序列预期
> - ✅ 全量指标模板（LLM/Tool/Agent/Workflow/Memory/Event/Frontend）
> - ✅ Agent-as-Judge 不同模型验证（含代码修复要求）
> - ✅ 前端 Playwright 时间线渲染验证（含具体断言代码）
> - ✅ 网页版模型 Prompt 约束模板
> - ✅ "测试通过"的明确定义（7 个维度）
> - ✅ 自动 MetricsCollector 设计
> - ✅ 发现的 3 个架构问题（testreview\.md 中详细分析）


