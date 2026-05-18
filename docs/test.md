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
