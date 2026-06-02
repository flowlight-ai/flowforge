# FlowForge 开发者架构改进方案（Arch-Dev v1.0）

> **定位**: 基于代码审查的务实架构改进，每个改进都有明确的代码位置和修复方案
> **原则**: 先修缺陷，再做增强。每个改进标注优先级和工时。
> **日期**: 2026-05-26

---

## 一、核心缺陷修复（P0，阻塞生产上线）

### ARCH-FIX-01: WorkflowExecutor 双路径统一

**当前架构问题**:

```
WorkflowExecutor._execute_sop_steps()
├── agent路径 (L107-191): agent.execute_with_context() → 跳过mode executor
└── mode路径 (L199-253): ctx.executor.run(sub_ctx, mode_hint=mode) → 正确路由
```

**问题**: 两条路径行为不一致。agent路径忽略了 `step["mode"]`。

**修复方案**: 统一为单一执行路径

```python
# 修复后的执行逻辑
for step in sop_steps:
    agent_name = step.get("agent")
    step_mode = step.get("mode")
    force_mode = step.get("force_mode", False)

    if agent_name:
        agent = ctx.agents.get(agent_name) if ctx.agents else None
        if agent:
            # 使用 mode executor 包装 agent 调用
            effective_mode = step_mode or agent.default_mode or "plan_execute"
            sub_input = {**context_data, "_agent_name": agent_name}
            sub_ctx = TaskContext.from_parent(
                ctx,
                input_data=sub_input,
                metadata={"_workflow_depth": depth + 1, "_agent": agent_name}
            )
            # 核心：通过 executor.run 路由到正确的 mode executor
            result = await asyncio.wait_for(
                ctx.executor.run(sub_ctx, mode_hint=effective_mode, _is_substep=True),
                timeout=step_timeout,
            )
            context_data[step.get("output", step_name)] = result
            continue

    # 无 agent 或无 mode → 现有 mode executor 路径
    ...
```

**关键变化**:
1. 不再直接调用 `agent.execute_with_context()`
2. Agent 调用通过 `ctx.executor.run()` 路由，让 mode executor 处理
3. Mode executor 内部可以通过 `ctx.metadata["_agent_name"]` 获取目标 agent

**影响范围**: `modes/workflow.py` 的 `_execute_sop_steps` 方法
**工时**: 4-6h
**风险**: 中等。需要验证所有现有 Workflow YAML 的行为一致性。

---

### ARCH-FIX-02: EventBus 通配符模式匹配

**当前实现** (`events/event_bus.py`):

```python
def emit(self, task_id: str, event_type: str, payload: dict):
    # 仅精确匹配 + "*" 全量匹配
    for cb in self._subscribers.get(event_type, []): ...
    for cb in self._subscribers.get('*', []): ...
```

**修复方案**: 添加 glob 风格通配符（`workflow.*`、`*.start`）

```python
import fnmatch

class EventBus:
    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}
        self._pattern_subscribers: List[tuple] = []  # [(pattern, callback)]

    def subscribe(self, event_type: str, callback: Callable):
        if '*' in event_type:
            self._pattern_subscribers.append((event_type, callback))
        else:
            self._subscribers.setdefault(event_type, []).append(callback)

    def emit(self, task_id: str, event_type: str, payload: dict):
        event = {
            "type": event_type, "payload": payload,
            "task_id": task_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        # 精确匹配
        for cb in self._subscribers.get(event_type, []):
            self._invoke(cb, event)
        # 通配符匹配（含 "*"）
        for cb in self._subscribers.get('*', []):
            self._invoke(cb, event)
        # glob 模式匹配
        for pattern, cb in self._pattern_subscribers:
            if fnmatch.fnmatch(event_type, pattern):
                self._invoke(cb, event)

    def _invoke(self, cb, event):
        try:
            result = cb(event)
            if asyncio.iscoroutine(result):
                asyncio.ensure_future(result)
        except Exception:
            logger.exception(f"Event callback error")
```

**使用举例**:
```python
# MetricsCollector 订阅所有 tool 事件
event_bus.subscribe("tool.*", self._on_tool_event)

# Solo UI 订阅所有 workflow 事件
event_bus.subscribe("workflow.*", self._on_workflow_event)

# 审计日志订阅所有事件
event_bus.subscribe("*", self._on_any_event)
```

**工时**: 1-2h
**风险**: 低。向后兼容，不改变现有订阅行为。

---

## 二、测试架构改进（P0）

### ARCH-TEST-01: 测试环境分层隔离

**当前问题**:

```
tests/
├── conftest.py          # 全局Mock LLM fixture → 污染所有测试
├── conftest_e2e.py      # 真实LLM fixtures → 但未完全隔离
├── unit/                # 单元测试
├── integration/         # 集成测试
└── e2e/                 # E2E测试
```

**修复方案**: 分层 conftest.py

```
tests/
├── conftest.py                    # 基础 fixtures（event_bus, 路径等）
├── conftest_e2e.py                # E2E专用 (FLOWFORGE_REAL_LLM=1)
├── pytest.ini                     # 按路径指定 conftest
├── unit/
│   └── conftest.py                # Mock LLM fixture ← 移到这里
├── integration/
│   └── conftest.py                # 真实LLM（需要时手动skip）
└── e2e/
    └── conftest.py                # 真实LLM（必需）
```

**pytest.ini 配置**:
```ini
[pytest]
asyncio_mode = auto
testpaths = tests/
norecursedirs = .git __pycache__ .venv node_modules

# conftest 覆盖规则：子目录 conftest 优先
# unit/conftest.py 的 mock_llm_tool 不会影响 e2e/ 下的测试
```

**核心代码** (`tests/unit/conftest.py`):
```python
@pytest.fixture
def mock_llm_tool():
    """仅在单元测试中使用 Mock LLM"""
    from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
    class MockLLM(BaseTool):
        name = "llm"
        async def execute(self, input: ToolInput) -> ToolOutput:
            return ToolOutput(result={"content": '{"score": 0.9, "issues": []}'})
    return MockLLM()
```

**`tests/e2e/conftest.py`**:
```python
@pytest.fixture(autouse=True)
def require_real_llm():
    """E2E测试必须设置 FLOWFORGE_REAL_LLM=1"""
    if os.environ.get("FLOWFORGE_REAL_LLM") != "1":
        pytest.skip("E2E测试需要真实LLM，设置 FLOWFORGE_REAL_LLM=1 后运行")
```

**工时**: 2h
**风险**: 低。pytest 的 conftest 层级机制天然支持此隔离。

---

### ARCH-TEST-02: Solo UI WebSocket 测试框架

**当前问题**: `tests/e2e/test_solo_ui.py` 存在但内容极少，无真正的 WebSocket 交互测试。

**架构设计**:

```python
# tests/e2e/test_solo_ws.py

class SoloWebSocketClient:
    """Solo UI WebSocket 测试客户端"""

    def __init__(self, base_url: str):
        self.base_url = base_url
        self.ws = None
        self.events: list = []
        self.draft_content: str = ""

    async def connect(self, session_id: str):
        self.ws = await websockets.connect(f"{self.base_url}/ws/solo/{session_id}")
        # 启动事件监听协程
        asyncio.create_task(self._listen())

    async def send_message(self, text: str):
        await self.ws.send(json.dumps({"type": "message", "text": text}))

    async def _listen(self):
        """持续监听并分类事件"""
        async for msg in self.ws:
            event = json.loads(msg)
            self.events.append(event)
            if event["type"] == "draft.update":
                self.draft_content = event["payload"].get("content", "")

    async def wait_for_event(self, event_type: str, timeout: float = 60):
        """等待特定事件类型"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            for e in self.events:
                if e["type"] == event_type:
                    return e
            await asyncio.sleep(0.1)
        raise TimeoutError(f"等待 {event_type} 超时")

    async def wait_for_step(self, step_name: str, timeout: float = 60):
        """等待特定工作流步骤"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            for e in self.events:
                if e["type"] == "workflow.step.complete":
                    if e["payload"].get("step") == step_name:
                        return e
            await asyncio.sleep(0.1)
        raise TimeoutError(f"等待步骤 {step_name} 超时")


@pytest.mark.asyncio
async def test_solo_write_article():
    """Solo UI: 写文章 → 验证 planning → execute → compile 完整链路"""
    client = SoloWebSocketClient("ws://127.0.0.1:8000")
    await client.connect("test_write_article")

    # 发送写文章指令
    await client.send_message("帮我写一篇关于AI Agent发展趋势的分析文章")

    # 验证 planning 阶段
    planning = await client.wait_for_event("workflow.step.complete", timeout=120)
    assert planning["payload"]["step"] == "planning"
    assert planning["payload"]["intent_type"] == "write"

    # 验证至少有一个执行步骤
    # Solo UI 走 _execute_intelligent_chat → 动态规划 → 执行步骤 → compile
    step_completes = [e for e in client.events if e["type"] == "workflow.step.complete"]
    assert len(step_completes) >= 2, f"预期至少2个步骤，实际 {len(step_completes)}"

    # 验证最终输出
    await client.wait_for_event("draft.update", timeout=180)
    assert len(client.draft_content) > 200, f"输出内容过短: {len(client.draft_content)} 字符"


@pytest.mark.asyncio
@pytest.mark.parametrize("intent,expected_type", [
    ("你好", "chat"),
    ("帮我写一篇关于Python的文章", "write"),
    ("搜索最新的AI新闻", "search"),
    ("把这段中文翻译成英文", "translate"),
])
async def test_solo_intent_routing(intent, expected_type):
    """Solo UI: 验证意图识别正确路由"""
    client = SoloWebSocketClient("ws://127.0.0.1:8000")
    await client.connect(f"test_intent_{expected_type}")
    await client.send_message(intent)

    event = await client.wait_for_event("workflow.step.complete", timeout=60)
    if expected_type == "chat":
        # 简单对话应跳过 planning，直接 response
        planning_events = [e for e in client.events if "planning" in str(e.get("payload", {}).get("step", ""))]
        assert len(planning_events) == 0 or planning_events[0].get("type") != "workflow.step.start"
```

**工时**: 8-12h
**风险**: 中等。需要服务端运行且真实 LLM 可用。

---

## 三、多租户数据隔离设计（P1）

### ARCH-MT-01: 多租户数据隔离架构

**当前状态**: FlowForge 是单用户系统，没有租户概念。

**目标**: 支持多个用户/公司各自拥有独立的 Skill、Workflow、Task 数据。

**设计方案**:

```
数据库层:
┌──────────────────────────────────────────┐
│              flowforge.db                 │
│                                           │
│  workspaces (tenant_id, name, ...)        │
│  workspace_members (ws_id, user_id, role) │
│  tasks (ws_id, task_id, ...)             │
│  workflows (ws_id, yaml_config, ...)     │
│  skills (ws_id, yaml_config, ...)        │
│  agents (ws_id, agent_name, config, ...) │
│  event_logs (ws_id, task_id, ...)       │
│  api_keys (ws_id, key, quota, ...)      │
└──────────────────────────────────────────┘
```

**隔离层级**:
| 资源 | 隔离级别 | 说明 |
|------|---------|------|
| Task执行 | 严格隔离 | 不同租户的Task不能互相访问 |
| Workflow模板 | 可选共享 | 官方模板全局可见，用户模板私有 |
| Skill | 可选共享 | 同上 |
| API Key | 严格隔离 | 每个租户独立的API Key和配额 |
| Event日志 | 严格隔离 | 便于审计和计费 |

**核心代码模式**:
```python
class TenantContext:
    """租户上下文 — 请求级别"""
    workspace_id: str
    user_id: str
    permissions: List[str]

    @classmethod
    def from_request(cls, request: Request) -> "TenantContext":
        # 从 JWT/ApiKey 中提取 workspace_id
        ...

class TaskContext:
    """增强版 — 添加租户绑定"""
    workspace_id: str  # 新增
    tenant: TenantContext  # 新增
    ...
```

**工时**: 16-24h
**前提**: FR-DEBT-01 修复完成

---

## 四、CI/CD 改进方案（P1）

### ARCH-CI-01: 真实 LLM 测试流水线

**当前状态**: CI配置不存在，没有自动化测试流水线。

**GitHub Actions 设计**:

```yaml
# .github/workflows/ci.yml
name: FlowForge CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r requirements.txt
      - run: pip install pytest pytest-asyncio pytest-cov
      # 单元测试使用 Mock LLM（快速，无外部依赖）
      - run: pytest tests/unit/ -v --cov=flowforge --cov-report=xml

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    # 仅在有 LLM API Key 时运行
    if: ${{ secrets.OPENROUTER_API_KEY != '' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r requirements.txt
      - name: 启动 FlowForge 服务
        run: python run_server.py &
      - name: 等待服务就绪
        run: |
          for i in $(seq 1 30); do
            curl -s http://localhost:8000/health && break
            sleep 2
          done
      - name: 运行集成测试
        env:
          FLOWFORGE_REAL_LLM: "1"
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        run: pytest tests/integration/ -v

  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    # 仅在 main 分支或手动触发时运行（费时费钱）
    if: github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r requirements.txt
      - run: pip install websockets
      - name: 启动 FlowForge 服务
        run: python run_server.py &
      - name: 运行 E2E 测试
        env:
          FLOWFORGE_REAL_LLM: "1"
          FLOWFORGE_BASE_URL: "http://localhost:8000"
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        run: pytest tests/e2e/ -v --timeout=300
```

**工时**: 4-6h
**前提**: ARCH-TEST-01（测试分层隔离）

---

## 五、Agent 执行架构统一（P1）

### ARCH-AGENT-01: ModeExecutor 包装所有 Agent 调用

**目标**: 确保所有 Agent 调用（无论来自 Workflow、Solo、API）都经过 ModeExecutor。

**架构图**:

```
                    ┌─────────────┐
                    │  API Layer   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ HybridExecutor │  ← 统一入口
                    └──────┬──────┘
                           │ mode_hint
                    ┌──────▼──────────┐
                    │ ModeRegistry     │
                    │ ┌──────────────┐ │
                    │ │ Workflow     │ │ → SOP steps
                    │ │ Reflexion    │ │ → Actor → Evaluate → Reflect
                    │ │ Agent-Judge  │ │ → Actor → Judge
                    │ │ Plan-Execute │ │ → Plan → Execute
                    │ │ ReAct        │ │ → Think → Act → Observe
                    │ │ ReWOO        │ │ → Plan tools → Execute all
                    │ │ Self-Discover│ │ → Discover → Apply
                    │ │ GoT          │ │ → Graph reasoning
                    │ │ Multi-Agent  │ │ → Teams/Subagents/Swarms
                    │ └──────────────┘ │
                    └──────┬───────────┘
                           │
                    ┌──────▼──────┐
                    │ AgentRegistry│  ← Agent 查找
                    │ ┌──────────┐ │
                    │ │ article_ │ │
                    │ │ writing  │ │ → execute_with_context()
                    │ │ content_ │ │
                    │ │ audit    │ │
                    │ │ ...15个  │ │
                    │ └──────────┘ │
                    └──────────────┘
```

**核心约束**: Agent 不再被直接调用。所有 Agent 调用必须经过 `ModeExecutor._execute_core()` → `ctx.agents.get(agent_name).execute_with_context()`。

**这意味着**:
1. `WorkflowExecutor` 不再直接调用 `agent.execute_with_context()`
2. `_run_react_loop` 中的 Agent 调用也通过 ModeExecutor
3. Solo UI 的 `_execute_intelligent_chat` 中的 Agent 调用同理

**工时**: 8-12h（涉及多处代码修改和回归测试）
**前提**: FR-DEBT-01

---

## 六、架构改进工时汇总

| 改进项 | 优先级 | 工时 | 依赖 |
|--------|--------|------|------|
| ARCH-FIX-01: WorkflowExecutor 双路径统一 | P0 | 6h | 无 |
| ARCH-FIX-02: EventBus 通配符 | P0 | 2h | 无 |
| ARCH-TEST-01: 测试环境分层隔离 | P0 | 2h | 无 |
| ARCH-TEST-02: Solo UI WebSocket 测试框架 | P0 | 12h | ARCH-TEST-01 |
| ARCH-MT-01: 多租户数据隔离 | P1 | 20h | ARCH-FIX-01 |
| ARCH-CI-01: CI/CD 流水线 | P1 | 6h | ARCH-TEST-01 |
| ARCH-AGENT-01: Agent执行架构统一 | P1 | 10h | ARCH-FIX-01 |
| **总计** | | **58h** | |

---

## 七、架构演进路线图

```
第1-2周: 缺陷修复
├── ARCH-FIX-01: WorkflowExecutor 双路径统一
├── ARCH-FIX-02: EventBus 通配符
└── ARCH-TEST-01: 测试环境分层
        ↓
第3-4周: 测试补齐
├── ARCH-TEST-02: Solo UI WebSocket 测试
└── ARCH-CI-01: CI/CD 流水线
        ↓
第5-8周: 架构加固
├── ARCH-AGENT-01: Agent 执行架构统一
└── 基于统一架构验证所有现有 Workflow
        ↓
第9-16周: 平台化能力
└── ARCH-MT-01: 多租户数据隔离
        ↓
第17周+: 生产就绪
└── 监控、告警、自动扩容、灾备
```

---

## 八、架构决策记录（ADR）

### ADR-001: Agent 调用必须经过 ModeExecutor

**状态**: 提议中
**背景**: 当前 WorkflowExecutor 中有两条 Agent 调用路径——直接调用和通过 ModeExecutor。这导致 Reflexion/Agent-Judge 等高级模式在 Workflow 中不生效。
**决策**: 所有 Agent 调用统一通过 `ctx.executor.run()` 路由。
**后果**:
- 正面: 所有模式在所有上下文中一致可用
- 负面: 增加一层间接调用，约 5-10ms 额外开销

### ADR-002: EventBus 支持 glob 通配符

**状态**: 提议中
**背景**: 当前仅支持精确类型匹配和 "*"。
**决策**: 新增 `fnmatch` 风格的 `*` 和 `?` 通配符支持。
**后果**:
- 正面: MetricsCollector 和前端可高效订阅事件家族
- 负面: 略微增加 emit 开销（对每个 pattern 做 fnmatch）

### ADR-003: 测试环境按目录分层

**状态**: 提议中
**背景**: Mock LLM 污染集成/E2E 测试。
**决策**: `mock_llm_tool` fixture 仅存在于 `tests/unit/conftest.py`，E2E 测试通过环境变量 `FLOWFORGE_REAL_LLM=1` 控制。
**后果**:
- 正面: 单元测试快（Mock）、集成测试真（Real LLM）
- 负面: 需要开发者理解分层约定

---

> **本架构文档基于实际代码审查编写，每个改进都有明确的代码位置、实现方案和工时估算。优先实施 P0 项（缺陷修复），再推进 P1 项（架构增强）。**