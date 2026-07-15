# NovelForge 工具架构迁移指南：从 BaseTool 继承到 MCP Server 模式

## 1. 迁移背景

### 1.1 为什么需要迁移

在 FlowForge 生态中，上层 *forge 项目（contentforge、devforge、novelforge、mallforge）是专注于特定业务场景的智能体应用，它们应通过**配置驱动**的方式接入 FlowForge 底座能力，而非通过代码继承。

旧架构中，NovelForge 的 7 个工具直接继承 FlowForge 的内部类（`ToolPlugin`、`StateQueryTool`、`BaseTool`），这带来了严重的架构问题：

- **上层项目不应写代码继承 flowforge 的 BaseTool / StateQueryTool / ToolPlugin**。如果需要写代码继承，说明 flowforge 的工具框架不够用，框架设计存在缺陷。
- **正确做法**：通过 MCP 协议或声明式配置注入到 flowforge 工具系统，上层项目只通过 SDK 公共接口访问底层能力。
- **flowforge 应支持通用 MCP 或标准协议**，可接入任何符合协议的工具服务，而非要求工具作者理解 flowforge 内部类层次。

### 1.2 迁移目标

| 维度 | 旧架构 | 新架构 |
|------|--------|--------|
| 耦合方式 | 代码继承（is-a） | 协议通信（has-a） |
| 依赖方向 | 上层 import flowforge 内部类 | 上层只通过 SDK 公共接口 |
| 配置方式 | Python 代码注册 | YAML 声明式配置 |
| 可替换性 | 强绑定 flowforge 版本 | MCP 标准协议，任何客户端可调用 |
| 扩展性 | 新工具必须继承基类 | 新工具只需写 handler 函数 |

---

## 2. 架构对比

### 2.1 旧架构（BaseTool / ToolPlugin 继承）

```
novelforge/tools/
  ├── search_character.py
  │    └── class CharacterSearchTool(ToolPlugin)     # 直接继承 flowforge 内部类
  │         ├── from flowforge.core.interfaces.tools import PluginManifest, PluginState, PluginHealth, ToolPlugin
  │         ├── from flowforge.core.tracing import get_logger
  │         └── from novelforge.tools._world_state_helper import load_state, fallback_web_search
  │
  ├── search_timeline.py
  │    └── class TimelineSearchTool(ToolPlugin)
  │
  ├── check_foreshadowing.py
  │    └── class ForeshadowingTrackerTool(ToolPlugin)
  │
  ├── verify_power_system.py
  │    └── class PowerSystemVerifierTool(ToolPlugin)
  │
  ├── compare_geography.py
  │    └── class GeographyComparatorTool(ToolPlugin)
  │
  ├── inspiration_search.py
  │    └── class InspirationSearchTool(ToolPlugin)
  │
  ├── novel_store.py
  │    └── class NovelStoreTool(ToolPlugin)
  │
  └── _world_state_helper.py        # 共享辅助函数，内部直接操作 memory 对象

novelforge/config/plugins.yaml       # transport: local + entry_point 指向 Python 类
```

**问题清单**：

1. **强耦合 flowforge 内部实现** — 上层项目必须理解 `ToolPlugin`、`PluginManifest`、`PluginState`、`PluginHealth` 等内部接口
2. **上层项目必须理解 flowforge 的类层次结构** — 需要知道该继承 `BaseTool`、`StateQueryTool` 还是 `ToolPlugin`
3. **flowforge 修改内部类会破坏上层项目** — 例如 `ToolPlugin` 接口变更会导致所有 *forge 工具编译失败
4. **违反"配置驱动"架构原则** — 工具注册需要写 Python 代码（`entry_point: novelforge.tools.search_character:CharacterSearchTool`），而非声明式配置
5. **反向依赖** — `_world_state_helper` 直接操作 flowforge 的 memory 对象，绕过了 SDK 公共接口
6. **无法独立测试** — 工具测试必须启动完整的 flowforge 运行时

### 2.2 新架构（MCP Server + 声明式配置）

```
novelforge/mcp_server/
  ├── server.py              # NovelForgeMCPServer — MCP Server，JSON-RPC 2.0 协议
  │    ├── class NovelForgeMCPServer
  │    │    ├── handle_request()     # JSON-RPC 2.0 请求分发
  │    │    ├── _call_tool()         # 工具调用 → handler 函数
  │    │    └── get_fastapi_router() # FastAPI 路由挂载
  │    └── create_standalone_app()   # 独立 FastAPI 应用
  │
  └── tools.py               # 7 个工具的 MCP handler 函数
       ├── _get_sdk()                 # 懒加载 FlowForgeSDK
       ├── _load_state()              # 通过 SDK 公共接口访问 Memory
       ├── _llm_call() / _llm_json_call()  # 通过 SDK 公共接口调用 LLM
       ├── _web_search()              # 通过 flowforge 工具执行搜索
       ├── TOOL_DEFINITIONS           # 7 个工具的 MCP 元数据
       ├── handle_search_character()  # 独立 async handler 函数
       ├── handle_search_timeline()
       ├── handle_check_foreshadowing()
       ├── handle_verify_power_system()
       ├── handle_compare_geography()
       ├── handle_inspiration_search()
       └── handle_novel_store()

novelforge/config/tools/              # 声明式工具定义（HTTP 类型）
  ├── search_character.yaml
  ├── search_timeline.yaml
  ├── check_foreshadowing.yaml
  ├── verify_power_system.yaml
  ├── compare_geography.yaml
  ├── inspiration_search.yaml
  └── novel_store.yaml

novelforge/config/plugins.yaml        # transport: mcp — MCP 传输协议
```

**优势清单**：

1. **零代码继承** — handler 是独立的 `async def` 函数，不继承任何 flowforge 内部类
2. **只通过 SDK 公共接口访问** — `sdk.memory`、`sdk.llm` 是稳定的公共 API，flowforge 内部重构不影响上层
3. **MCP 标准协议** — JSON-RPC 2.0，可被任何 MCP 客户端调用（Claude Desktop、Cursor 等）
4. **声明式配置** — 工具定义在 YAML 文件中，修改无需改代码
5. **可独立运行** — `python -m novelforge.mcp_server.server --port 9100` 即可启动独立服务
6. **双端点兼容** — 同时提供 JSON-RPC 2.0 和 REST 风格端点

---

## 3. 迁移步骤

### 3.1 创建 MCP Server

创建 `novelforge/mcp_server/server.py`，实现 `NovelForgeMCPServer` 类：

- 支持 MCP 协议的三个核心方法：`initialize`、`tools/list`、`tools/call`
- 提供 FastAPI 路由挂载（`get_fastapi_router()`），可挂载到主应用或独立运行
- 同时提供 REST 风格端点（`/tools`、`/tools/{tool_name}`）兼容 flowforge 的 HTTPTool 调用
- 默认端口 `9100`，路由前缀 `/mcp/novelforge`

```python
# server.py 核心结构
class NovelForgeMCPServer:
    SERVER_NAME = "novelforge"
    SERVER_VERSION = "1.0.0"

    def __init__(self) -> None:
        self._tools = {}          # name → tool definition
        self._tool_handlers = {}  # name → handler function
        self._register_all_tools()

    async def handle_request(self, request: dict) -> dict:
        # JSON-RPC 2.0 请求分发
        ...

    def get_fastapi_router(self):
        # FastAPI 路由：JSON-RPC + REST 双端点
        ...
```

### 3.2 迁移工具逻辑

将每个工具从 `class XxxTool(ToolPlugin)` 迁移为独立的 `async def handle_xxx(arguments)` 函数：

**关键变更**：

| 旧实现 | 新实现 |
|--------|--------|
| `class CharacterSearchTool(ToolPlugin)` | `async def handle_search_character(arguments: Dict)` |
| `self._memory` 直接操作 Memory 对象 | `sdk = _get_sdk(); memory = sdk.memory` |
| `self._llm_client.execute(...)` | `result = await sdk.llm.chat(prompt)` |
| `from flowforge.core.interfaces.tools import ...` | `from flowforge.sdk import FlowForgeSDK` |
| `from novelforge.tools._world_state_helper import load_state` | 内置 `_load_state()` 函数，通过 SDK 访问 |

**SDK 公共接口调用模式**：

```python
def _get_sdk():
    """获取 FlowForge SDK 实例（懒加载）。"""
    from flowforge.sdk import FlowForgeSDK
    return FlowForgeSDK(project="novelforge")

async def _load_state(entity_id: str, scope: int) -> dict:
    """通过 SDK 公共接口访问 Memory。"""
    sdk = _get_sdk()
    memory = sdk.memory
    if not memory:
        return {}
    key = f"novel:{entity_id}:world_state"
    raw_data = memory.working.get(key) or {}
    # ... 合并逻辑 ...

async def _llm_call(prompt: str) -> str:
    """通过 SDK 公共接口调用 LLM。"""
    sdk = _get_sdk()
    result = await sdk.llm.chat(prompt)
    return result
```

### 3.3 创建声明式工具配置

为每个工具创建 YAML 声明式配置文件，放在 `novelforge/config/tools/` 目录下：

```yaml
# search_character.yaml 示例
name: search_character
description: "搜索角色信息：在已构建的世界状态中查找角色属性、关系、状态变化，支持LLM语义增强"
type: http
safety_level: normal
parameters_schema:
  type: object
  required: [query]
  properties:
    query: {type: string, description: "查询关键词（角色名或特征描述）"}
    novel_id: {type: string, description: "小说ID"}
    chapter_number: {type: integer, description: "截至章节号"}
    use_llm: {type: boolean, description: "是否启用LLM语义增强（默认true）"}
http:
  base_url: "http://localhost:9100"
  method: POST
  path: "/mcp/novelforge/tools/search_character"
  timeout: 60.0
```

flowforge 的 `DeclarativeTool` 模块（`flowforge/core/declarative_tool.py`）会自动将此 YAML 加载为 `HTTPTool` 实例，通过 HTTP POST 调用 MCP Server 的 REST 端点。

### 3.4 更新 plugins.yaml

将 `plugins.yaml` 中的工具注册从 `transport: local` + `entry_point` 改为 `transport: mcp`：

**旧配置**（代码继承）：

```yaml
plugins:
  - name: search_character
    transport: local
    entry_point: novelforge.tools.search_character:CharacterSearchTool
    description: "搜索角色信息"
    ...
```

**新配置**（MCP 协议）：

```yaml
plugins:
  - name: search_character
    transport: mcp
    url: "http://localhost:9100/mcp/novelforge"
    description: "搜索角色信息：在已构建的世界状态中查找角色属性、关系、状态变化"
    ...
```

### 3.5 标记旧代码为 deprecated

在旧的工具模块中添加 `DeprecationWarning`，引导开发者使用新的 MCP 实现：

```python
"""CharacterSearchTool — 搜索角色信息。

.. deprecated::
    此模块已废弃，请使用 novelforge.mcp_server.tools 中的 MCP 实现。
    工具现在通过 MCP 协议暴露，由 novelforge.mcp_server.server.NovelForgeMCPServer 管理。
    声明式配置见 novelforge/config/tools/search_character.yaml。
"""

import warnings

warnings.warn(
    "novelforge.tools.search_character 已废弃，"
    "请使用 novelforge.mcp_server.tools.handle_search_character (MCP 协议)。",
    DeprecationWarning,
    stacklevel=2,
)
```

### 3.6 迁移 Loop 配置

NovelForge 的 4 个 Loop 模板（章节写作、概念孵化、润色、审核）通过 V2 钩子 `register_loops` 自动接入 flowforge 的 `LoopRegistry`，无需编写任何 Python 注册代码。

**迁移步骤**：

1. **保留 YAML 文件原位**：将 `novelforge/config/loops/` 下的 4 个 YAML 文件（`novel_chapter_loop.yaml`、`novel_concept_loop.yaml`、`novel_polish_loop.yaml`、`novel_review_loop.yaml`）保持在原目录，无需移动
2. **在 `create_plugin()` 调用中添加 `loops_dir` 参数**：在 NovelForge 的插件创建入口添加 `loops_dir="config/loops"` 参数，指示 AutoPlugin 扫描该目录

   ```python
   plugin = sdk.create_plugin(
       name="novelforge",
       tools_dir="config/tools",
       loops_dir="config/loops",   # ← 新增：Loop 模板目录
       agents_dir="config/agents",
       # ... 其他 *_dir 参数
   )
   ```

3. **AutoPlugin 的 `register_loops` 方法自动扫描该目录**：`auto_discover_plugins()` 在启动时会调用 `AutoPlugin.register_loops()`，自动遍历 `config/loops/*.yaml` 并将每个 Loop 模板注册到 `LoopRegistry`
4. **`LoopRegistry.register()` 方法兼容 `_scan_yaml_dir` 机制**：`register_loops` 内部复用与 `register_tools`、`register_agents` 相同的 `_scan_yaml_dir` 工具函数读取 YAML，保证 Loop 模板加载流程与其他声明式配置一致

**注意事项**：

- Loop YAML 文件的 schema 必须符合 flowforge `LoopTemplate` 规范（包含 `name`、`mode`、`max_retries`、`steps` 等字段）
- 若 `loops_dir` 参数缺省，`register_loops` 钩子将跳过执行（no-op），不会影响其他 `register_*` 钩子
- 迁移完成后，旧版通过 Python 代码注册 Loop 的逻辑应标记为 `deprecated`

---

## 4. 七个工具的迁移详情

### 4.1 search_character — 角色搜索

**旧实现**：

```python
# novelforge/tools/search_character.py
from flowforge.core.interfaces.tools import PluginManifest, PluginState, PluginHealth, ToolPlugin
from flowforge.core.tracing import get_logger
from novelforge.tools._world_state_helper import load_state, fallback_web_search, _is_empty_result, llm_enhance

class CharacterSearchTool(ToolPlugin):
    manifest = PluginManifest(name="search_character", ...)
    STATE_KEY_TEMPLATE = "novel:{entity_id}:world_state"
    STATE_MERGE_FIELDS = ("characters",)

    def __init__(self, **kwargs):
        self._memory = kwargs.get("memory", None)
        self._llm_client = kwargs.get("llm_client", None)

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        state_data = await load_state(memory=self._memory, ...)
        # ... 搜索逻辑 ...
```

**新实现**：

```python
# novelforge/mcp_server/tools.py
async def handle_search_character(arguments: Dict[str, Any]) -> Dict[str, Any]:
    query = arguments.get("query", "")
    entity_id = arguments.get("novel_id", "")
    scope = arguments.get("chapter_number", 999)
    use_llm = arguments.get("use_llm", True)

    state_data = await _load_state(entity_id, scope)  # 通过 SDK 公共接口
    characters = state_data.get("characters", {})

    matched = [/* 关键词匹配 */]

    if use_llm and matched:
        prompt = get_prompt("novelforge.tool.search_character", ...)
        analysis = await _llm_json_call(prompt)  # 通过 SDK 公共接口
        result["analysis"] = analysis

    return result
```

**声明式配置**：

```yaml
# novelforge/config/tools/search_character.yaml
name: search_character
description: "搜索角色信息：在已构建的世界状态中查找角色属性、关系、状态变化，支持LLM语义增强"
type: http
safety_level: normal
parameters_schema:
  type: object
  required: [query]
  properties:
    query: {type: string, description: "查询关键词（角色名或特征描述）"}
    novel_id: {type: string, description: "小说ID"}
    chapter_number: {type: integer, description: "截至章节号"}
    use_llm: {type: boolean, description: "是否启用LLM语义增强（默认true）"}
http:
  base_url: "http://localhost:9100"
  method: POST
  path: "/mcp/novelforge/tools/search_character"
  timeout: 60.0
```

---

### 4.2 search_timeline — 时间线搜索

**旧实现**：

```python
# novelforge/tools/search_timeline.py
from flowforge.core.interfaces.tools import PluginManifest, PluginState, PluginHealth, ToolPlugin
from novelforge.tools._world_state_helper import load_state, fallback_web_search, _is_empty_result, llm_enhance

class TimelineSearchTool(ToolPlugin):
    manifest = PluginManifest(name="search_timeline", ...)
    STATE_KEY_TEMPLATE = "novel:{entity_id}:world_state"
    STATE_MERGE_FIELDS = ("timeline",)
```

**新实现**：

```python
# novelforge/mcp_server/tools.py
async def handle_search_timeline(arguments: Dict[str, Any]) -> Dict[str, Any]:
    query = arguments.get("query", "")
    entity_id = arguments.get("novel_id", "")
    scope = arguments.get("chapter_number", 999)
    use_llm = arguments.get("use_llm", True)

    state_data = await _load_state(entity_id, scope)
    timeline = state_data.get("timeline", {})

    matched = [/* 关键词匹配 */]

    if use_llm and matched:
        prompt = get_prompt("novelforge.tool.search_timeline", ...)
        analysis = await _llm_json_call(prompt)
        result["analysis"] = analysis

    return result
```

**声明式配置**：

```yaml
# novelforge/config/tools/search_timeline.yaml
name: search_timeline
description: "搜索时间线事件：查找特定时间点或时间范围内的事件，支持LLM语义增强"
type: http
safety_level: normal
parameters_schema:
  type: object
  required: [query]
  properties:
    query: {type: string, description: "查询关键词（时间点、事件名或描述）"}
    novel_id: {type: string, description: "小说ID"}
    chapter_number: {type: integer, description: "截至章节号"}
    use_llm: {type: boolean, description: "是否启用LLM语义增强（默认true）"}
http:
  base_url: "http://localhost:9100"
  method: POST
  path: "/mcp/novelforge/tools/search_timeline"
  timeout: 60.0
```

---

### 4.3 check_foreshadowing — 伏笔追踪

**旧实现**：

```python
# novelforge/tools/check_foreshadowing.py
from flowforge.core.interfaces.tools import PluginManifest, PluginState, PluginHealth, ToolPlugin
from novelforge.tools._world_state_helper import load_state, fallback_web_search, _is_empty_result, llm_enhance

class ForeshadowingTrackerTool(ToolPlugin):
    manifest = PluginManifest(name="check_foreshadowing", ...)
    STATE_KEY_TEMPLATE = "novel:{entity_id}:world_state"
    STATE_LIST_FIELDS = ("foreshadowing",)
```

**新实现**：

```python
# novelforge/mcp_server/tools.py
async def handle_check_foreshadowing(arguments: Dict[str, Any]) -> Dict[str, Any]:
    query = arguments.get("query", "")
    entity_id = arguments.get("novel_id", "")
    scope = arguments.get("chapter_number", 999)
    use_llm = arguments.get("use_llm", True)

    state_data = await _load_state(entity_id, scope)
    all_foreshadowing = state_data.get("foreshadowing", [])

    # 统计伏笔状态：planted / resolved / unresolved
    stats = {
        "total": len(all_foreshadowing),
        "planted": len([f for f in all_foreshadowing if f.get("status") == "planted"]),
        "resolved": len([f for f in all_foreshadowing if f.get("status") == "resolved"]),
        "unresolved": len([f for f in all_foreshadowing if f.get("status") != "resolved"]),
        "recovery_rate": len(resolved) / max(len(all_foreshadowing), 1),
    }

    if use_llm and matched:
        prompt = get_prompt("novelforge.tool.check_foreshadowing", ...)
        analysis = await _llm_json_call(prompt)
        result["analysis"] = analysis

    return result
```

**声明式配置**：

```yaml
# novelforge/config/tools/check_foreshadowing.yaml
name: check_foreshadowing
description: "追踪伏笔：检查伏笔的埋设和回收状态，支持LLM语义增强检测遗漏伏笔"
type: http
safety_level: normal
parameters_schema:
  type: object
  required: [query]
  properties:
    query: {type: string, description: "查询关键词（伏笔描述或相关情节）"}
    novel_id: {type: string, description: "小说ID"}
    chapter_number: {type: integer, description: "截至章节号"}
    use_llm: {type: boolean, description: "是否启用LLM语义增强（默认true）"}
http:
  base_url: "http://localhost:9100"
  method: POST
  path: "/mcp/novelforge/tools/check_foreshadowing"
  timeout: 60.0
```

---

### 4.4 verify_power_system — 力量体系验证

**旧实现**：

```python
# novelforge/tools/verify_power_system.py
from flowforge.core.interfaces.tools import PluginManifest, PluginState, PluginHealth, ToolPlugin
from novelforge.tools._world_state_helper import load_state, fallback_web_search, _is_empty_result, llm_enhance

class PowerSystemVerifierTool(ToolPlugin):
    manifest = PluginManifest(name="verify_power_system", ...)
    STATE_KEY_TEMPLATE = "novel:{entity_id}:world_state"
    STATE_MERGE_FIELDS = ("power_system",)
```

**新实现**：

```python
# novelforge/mcp_server/tools.py
async def handle_verify_power_system(arguments: Dict[str, Any]) -> Dict[str, Any]:
    query = arguments.get("query", "")
    entity_id = arguments.get("novel_id", "")
    scope = arguments.get("chapter_number", 999)
    use_llm = arguments.get("use_llm", True)

    state_data = await _load_state(entity_id, scope)
    power_system = state_data.get("power_system", {})

    # 规则矛盾检测：检查 !! 前缀标记
    violations = []
    for rule_name, rule_info in power_system.items():
        for key, value in rule_info.items():
            if isinstance(value, str) and value.startswith("!!"):
                violations.append({...})

    # LLM 语义矛盾检测
    if use_llm and power_system:
        prompt = get_prompt("novelforge.tool.verify_power_system", ...)
        llm_result = await _llm_json_call(prompt)
        llm_violations = llm_result.get("contradictions", [])
        # 合并去重
        violations.extend(llm_violations)

    return {"rules": power_system, "consistent": len(violations) == 0, "violations": violations}
```

**声明式配置**：

```yaml
# novelforge/config/tools/verify_power_system.yaml
name: verify_power_system
description: "验证力量体系：检查能力描述与设定规则的一致性，支持LLM语义矛盾检测"
type: http
safety_level: normal
parameters_schema:
  type: object
  required: [query]
  properties:
    query: {type: string, description: "查询关键词（能力名或规则描述）"}
    novel_id: {type: string, description: "小说ID"}
    chapter_number: {type: integer, description: "截至章节号"}
    use_llm: {type: boolean, description: "是否启用LLM语义验证（默认true）"}
http:
  base_url: "http://localhost:9100"
  method: POST
  path: "/mcp/novelforge/tools/verify_power_system"
  timeout: 60.0
```

---

### 4.5 compare_geography — 地理比对

**旧实现**：

```python
# novelforge/tools/compare_geography.py
from flowforge.core.interfaces.tools import PluginManifest, PluginState, PluginHealth, ToolPlugin
from novelforge.tools._world_state_helper import load_state, fallback_web_search, _is_empty_result, llm_enhance

class GeographyComparatorTool(ToolPlugin):
    manifest = PluginManifest(name="compare_geography", ...)
    STATE_KEY_TEMPLATE = "novel:{entity_id}:world_state"
    STATE_MERGE_FIELDS = ("geography",)
```

**新实现**：

```python
# novelforge/mcp_server/tools.py
async def handle_compare_geography(arguments: Dict[str, Any]) -> Dict[str, Any]:
    query = arguments.get("query", "")
    entity_id = arguments.get("novel_id", "")
    scope = arguments.get("chapter_number", 999)
    use_llm = arguments.get("use_llm", True)

    state_data = await _load_state(entity_id, scope)
    geography = state_data.get("geography", {})

    # 地理矛盾检测：检查 !! 前缀标记
    matched = []
    inconsistencies = []
    for loc_name, loc_info in geography.items():
        if query.lower() in loc_name.lower() or query.lower() in str(loc_info).lower():
            matched.append({...})
            # 检查矛盾标记

    # LLM 语义矛盾检测
    if use_llm and matched:
        prompt = get_prompt("novelforge.tool.compare_geography", ...)
        llm_result = await _llm_json_call(prompt)
        inconsistencies.extend(llm_result.get("contradictions", []))

    return {"locations": matched, "consistent": len(inconsistencies) == 0, "inconsistencies": inconsistencies}
```

**声明式配置**：

```yaml
# novelforge/config/tools/compare_geography.yaml
name: compare_geography
description: "地理比对：检查地点描述与地理设定的一致性，支持LLM语义矛盾检测"
type: http
safety_level: normal
parameters_schema:
  type: object
  required: [query]
  properties:
    query: {type: string, description: "查询关键词（地点名或地理描述）"}
    novel_id: {type: string, description: "小说ID"}
    chapter_number: {type: integer, description: "截至章节号"}
    use_llm: {type: boolean, description: "是否启用LLM语义验证（默认true）"}
http:
  base_url: "http://localhost:9100"
  method: POST
  path: "/mcp/novelforge/tools/compare_geography"
  timeout: 60.0
```

---

### 4.6 inspiration_search — 创作灵感搜索

**旧实现**：

```python
# novelforge/tools/inspiration_search.py
from flowforge.core.interfaces.tools import PluginManifest, PluginState, PluginHealth, ToolPlugin
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.tracing import get_logger

class InspirationSearchTool(ToolPlugin):
    manifest = PluginManifest(name="inspiration_search", ...)

    def __init__(self, **kwargs):
        self._llm_client = kwargs.get("llm_client", None)

    async def execute(self, params):
        # Step 1: web_search
        from novelforge.tools._world_state_helper import fallback_web_search
        web_results = await fallback_web_search(query)
        # Step 2: LLM fallback
        llm_result = await self._llm_fallback(query, search_type, max_results)
```

**新实现**：

```python
# novelforge/mcp_server/tools.py
async def handle_inspiration_search(arguments: Dict[str, Any]) -> Dict[str, Any]:
    query = arguments.get("query", "")
    search_type = arguments.get("search_type", "inspiration")
    max_results = arguments.get("max_results", 5)

    # 搜索类型前缀增强
    prefixes = {
        "inspiration": "小说创作灵感",
        "genre_convention": "小说类型惯例 写作技巧",
        "historical_fact": "历史事实考证",
        "literary_reference": "文学参考 经典作品",
        "name_meaning": "名字含义 文化寓意",
    }
    enhanced_query = f"{prefix} {query}"

    # 优先使用 web_search
    search_results = await _web_search(enhanced_query, max_results)
    if search_results:
        return {"results": search_results[:max_results], "source": "web_search"}

    # 降级到 LLM
    prompt = get_prompt("novelforge.tool.inspiration_search.llm_fallback", ...)
    content = await _llm_call(prompt)
    return {"results": [...], "source": "llm_fallback"}
```

**声明式配置**：

```yaml
# novelforge/config/tools/inspiration_search.yaml
name: inspiration_search
description: "创作灵感搜索：通过 web search 搜索写作灵感、类型惯例、历史事实和文学参考"
type: http
safety_level: normal
parameters_schema:
  type: object
  required: [query]
  properties:
    query: {type: string, description: "搜索查询"}
    search_type:
      type: string
      default: inspiration
      enum: [inspiration, genre_convention, historical_fact, literary_reference, name_meaning]
      description: "搜索类型"
    max_results: {type: integer, default: 5, description: "最大结果数"}
http:
  base_url: "http://localhost:9100"
  method: POST
  path: "/mcp/novelforge/tools/inspiration_search"
  timeout: 60.0
```

---

### 4.7 novel_store — 小说结构存储

**旧实现**：

```python
# novelforge/tools/novel_store.py
from flowforge.core.interfaces.tools import PluginManifest, PluginState, PluginHealth, ToolPlugin
from flowforge.core.tracing import get_logger

class NovelStoreTool(ToolPlugin):
    manifest = PluginManifest(name="novel_store", ...)

    def __init__(self, **kwargs):
        data_dir = kwargs.get("data_dir", "")
        self._data_dir = Path(data_dir) if data_dir else _DEFAULT_DATA_DIR

    async def execute(self, params):
        action = params.get("action", "")
        handler = getattr(self, f"_action_{action}", None)
        return await handler(params)
```

**新实现**：

```python
# novelforge/mcp_server/tools.py
async def handle_novel_store(arguments: Dict[str, Any]) -> Dict[str, Any]:
    action = arguments.get("action", "")
    novel_id = arguments.get("novel_id", "default")

    handler_map = {
        "save_outline": _action_save_outline,
        "load_outline": _action_load_outline,
        "save_character": _action_save_character,
        "load_character": _action_load_character,
        "load_characters": _action_load_characters,
        "save_world": _action_save_world,
        "load_world": _action_load_world,
        "save_chapter": _action_save_chapter,
        "load_chapter": _action_load_chapter,
        "list_chapters": _action_list_chapters,
    }

    handler = handler_map.get(action)
    return await handler(arguments)
```

**声明明配置**：

```yaml
# novelforge/config/tools/novel_store.yaml
name: novel_store
description: "小说结构存储：管理小说的大纲、角色、世界观和章节数据的持久化存取"
type: http
safety_level: normal
parameters_schema:
  type: object
  required: [action]
  properties:
    action:
      type: string
      enum:
        - save_outline
        - load_outline
        - save_character
        - load_character
        - load_characters
        - save_world
        - load_world
        - save_chapter
        - load_chapter
        - list_chapters
      description: "操作类型"
    novel_id: {type: string, default: "default"}
    data: {type: object}
    chapter_number: {type: integer}
    character_name: {type: string}
http:
  base_url: "http://localhost:9100"
  method: POST
  path: "/mcp/novelforge/tools/novel_store"
  timeout: 60.0
```

---

### 4.8 Loop 配置迁移详情

NovelForge 在 `novelforge/config/loops/` 目录下共有 4 个 Loop 模板 YAML 文件，分别对应小说创作流程中的不同循环场景。这些文件通过 V2 钩子 `register_loops` 自动注册到 flowforge 的 `LoopRegistry`，无需修改任何 Python 代码。

| Loop 配置文件 | 用途 | 模式（mode） | max_retries | 说明 |
|--------------|------|:------------:|:-----------:|------|
| novel_chapter_loop.yaml | 章节写作循环 | reflexion | 2 | 章节生成后通过反思机制自我修正，最多重试 2 次 |
| novel_concept_loop.yaml | 概念孵化循环 | plan_execute + graph_of_thoughts | — | 结合计划执行与思维图谱两种模式进行概念发散与收敛 |
| novel_polish_loop.yaml | 润色循环 | rewoo | 2 | 通过 Reasoning Without Observation 模式迭代润色，最多重试 2 次 |
| novel_review_loop.yaml | 审核循环 | multi_agent | 1 | 多 Agent 协同审核，最多重试 1 次 |

**迁移要点**：

1. **保持文件原位**：4 个 YAML 文件继续保留在 `novelforge/config/loops/` 目录下，由 `register_loops` 钩子自动扫描
2. **schema 校验**：每个 YAML 文件需包含 `name`、`mode`、`max_retries`、`steps` 等字段，符合 flowforge `LoopTemplate` 规范
3. **混合模式支持**：`novel_concept_loop.yaml` 同时使用 `plan_execute` 与 `graph_of_thoughts` 两种模式，需确认 `LoopRegistry` 已支持混合模式解析
4. **重试上限**：`max_retries` 字段控制循环最大重试次数，避免无限循环；迁移时需保留原值
5. **无需创建 MCP handler**：Loop 模板属于声明式配置，由 flowforge 的 `LoopRegistry` 直接消费，不经过 MCP Server

---

## 5. Auto-Discover 自动发现机制

### 5.1 工作原理

flowforge 的 `auto_discover_plugins()` 函数在应用启动时自动扫描上层 *forge 项目的 `config/` 目录，加载声明式配置，无需任何 Python 代码注册。

**调用链**：

```
flowforge/app/main.py::lifespan()
  └── auto_discover_plugins()
       ├── 扫描 contentforge/config/、devforge/config/、novelforge/config/、mallforge/config/
       ├── 检查标准子目录：agents/、workflows/、tools/、personas/、prompts/、...
       ├── 发现 YAML 文件 → 通过 FlowForgeSDK.create_plugin() 创建 AutoPlugin
       └── _load_single_plugin() → 注册到 ToolRegistry / AgentRegistry / ...
```

### 5.2 扫描的标准子目录

```python
_AUTO_DISCOVER_SUBDIRS = [
    "agents", "workflows", "tools", "personas", "prompts",
    "gates", "quality_gates", "evaluators", "context_layers", "loops", "sops",
]
```

### 5.2.1 V2 钩子与目录映射

flowforge 的 V2 插件协议（`AutoPlugin`）为每个标准子目录定义了对应的 V2 钩子方法。当 `auto_discover_plugins()` 扫描到对应目录下的 YAML 文件时，会自动调用 `create_plugin()` 创建 `AutoPlugin` 实例，并由 `AutoPlugin` 内部根据目录类型分发到对应的 `register_*` 钩子方法。上层 *forge 项目无需手动注册，只需把 YAML 文件放到对应目录即可。

| 标准子目录 | V2 钩子方法 | 说明 |
|-----------|------------|------|
| agents/ | register_agents | Agent YAML 配置自动扫描 |
| workflows/ | register_workflows | Workflow YAML 配置自动扫描 |
| loops/ | register_loops | Loop 模板 YAML 自动扫描 |
| sops/ | register_sops | SOP YAML 配置自动扫描 |
| tools/ | register_tools | 声明式工具 YAML 自动扫描 |
| personas/ | register_personas | Persona YAML 自动扫描 |
| gates/ | register_gates | Gate YAML 自动扫描 |
| quality_gates/ | register_quality_gates | Quality Gate YAML 自动扫描 |
| evaluators/ | register_evaluators | Evaluator YAML 自动扫描 |
| context_layers/ | register_context_layers | Context Layer YAML 自动扫描 |
| prompts/ | register_prompts | Prompts YAML 自动扫描 |

**调用流程**：

```
auto_discover_plugins()
  └── 发现 novelforge/config/loops/*.yaml
       └── create_plugin(name="novelforge", loops_dir="config/loops", ...)
            └── AutoPlugin.register_loops()
                 └── LoopRegistry.register()  # 兼容 _scan_yaml_dir 机制
```

**关键说明**：

1. **register_loops** 是 Loop 模板的专属 V2 钩子，专门用于扫描 `loops/` 目录下的 YAML 文件
2. 每个 `register_*` 钩子方法内部都使用统一的 `_scan_yaml_dir` 机制读取 YAML 并注册到对应的 Registry
3. 上层项目只需在 `create_plugin()` 调用中通过参数（如 `loops_dir="config/loops"`）指定目录路径，钩子方法会自动被 `auto_discover` 触发
4. 若未指定对应 `*_dir` 参数，对应 `register_*` 钩子将跳过执行（no-op），不会报错

### 5.3 控制开关

自动发现可通过以下方式控制：

| 方式 | 配置项 | 默认值 |
|------|--------|--------|
| 环境变量 | `FLOWFORGE_AUTO_DISCOVER` | `true` |
| 环境变量 | `FLOWFORGE_FORGE_DIRS` | 自动扫描兄弟目录 |
| YAML 配置 | `system.auto_discover` | `true` |
| YAML 配置 | `system.forge_dirs` | 自动扫描兄弟目录 |

### 5.4 声明式工具加载流程

当 `auto_discover_plugins()` 发现 `novelforge/config/tools/search_character.yaml` 时：

1. **读取 YAML** → `DeclarativeToolConfig(name="search_character", type="http", http={...})`
2. **创建 HTTPTool** → `HTTPTool(config)`，内部使用 `httpx.AsyncClient` 调用 MCP Server
3. **注册到 ToolRegistry** → `tool_registry.register(http_tool)`
4. **Agent 调用** → `tool_registry.execute("search_character", ToolInput(params={...}))`
5. **HTTPTool 转发** → `POST http://localhost:9100/mcp/novelforge/tools/search_character`
6. **MCP Server 处理** → `handle_search_character(arguments)` → 返回结果

### 5.5 MCP 集成层

flowforge 的 `MCPIntegration`（`flowforge/core/mcp_integration.py`）提供了另一种接入方式：

```python
# 通过 MCP 协议连接（JSON-RPC 2.0 over HTTP/SSE）
mcp = MCPIntegration(tool_registry=tool_registry)
await mcp.connect_server(
    name="novelforge",
    url="http://localhost:9100/mcp/novelforge",
)
# 所有 MCP 工具自动注册为 mcp.novelforge.search_character 等
```

`MCPIntegration` 使用 `MCPClient` 进行 JSON-RPC 2.0 通信，将 MCP 工具包装为 `MCPToolWrapper(BaseTool)` 注册到 ToolRegistry。

---

## 6. 其他 *Forge 项目迁移指南

### 6.1 通用迁移步骤

所有上层 *forge 项目的迁移遵循相同的模式：

1. **创建 MCP Server** — `{forge}/mcp_server/server.py`
2. **迁移工具逻辑** — `{forge}/mcp_server/tools.py`，handler 函数通过 SDK 公共接口访问 flowforge 能力
3. **创建声明式配置** — `{forge}/config/tools/*.yaml`，type: http
4. **更新 plugins.yaml** — transport 从 `local` 改为 `mcp`
5. **标记旧代码为 deprecated** — 旧模块添加 `DeprecationWarning`
6. **验证** — 启动 MCP Server + flowforge，确认工具可正常调用

### 6.2 ContentForge 迁移

ContentForge 的工具主要涉及内容创作与分发：

```
contentforge/mcp_server/
  ├── server.py          # ContentForgeMCPServer，端口 9101
  └── tools.py           # handler 函数

contentforge/config/tools/
  ├── topic_research.yaml
  ├── material_search.yaml
  ├── article_writing.yaml
  ├── content_review.yaml
  └── publish.yaml
```

**迁移要点**：
- 发布工具（publish）需要调用微信公众号 API，保持 HTTP Tool 类型
- 选题和素材搜索依赖 helixrag/opensieve，通过 SDK 公共接口调用
- 审核流程使用 `interrupt_before=["review"]`，MCP Server 需支持长连接

### 6.3 DevForge 迁移

DevForge 的工具主要涉及软件开发：

```
devforge/mcp_server/
  ├── server.py          # DevForgeMCPServer，端口 9102
  └── tools.py           # handler 函数

devforge/config/tools/
  ├── code_search.yaml
  ├── linter.yaml
  ├── test_runner.yaml
  ├── git_tool.yaml
  └── code_review.yaml
```

**迁移要点**：
- 代码搜索和 lint 工具已有 flowforge 内置实现，DevForge 可直接复用
- Git 工具涉及文件系统操作，需注意 MCP Server 的沙箱权限
- Test Runner 需要长超时配置（`timeout: 300.0`）

### 6.4 MallForge 迁移

MallForge 的工具主要涉及电商运营：

```
mallforge/mcp_server/
  ├── server.py          # MallForgeMCPServer，端口 9104
  └── tools.py           # handler 函数

mallforge/config/tools/
  ├── product_copy.yaml
  ├── competitor_analysis.yaml
  ├── customer_service.yaml
  └── supply_chain.yaml
```

**迁移要点**：
- 竞品分析需要 web_search 能力，通过 SDK 公共接口调用
- 客服工具需要实时对话能力，考虑使用 SSE 传输
- 供应链管理涉及外部 API 调用，使用 HTTP Tool 的 auth 配置

### 6.5 端口分配

| 项目 | MCP Server 端口 | 路由前缀 |
|------|:---------------:|---------|
| NovelForge | 9100 | `/mcp/novelforge` |
| ContentForge | 9101 | `/mcp/contentforge` |
| DevForge | 9102 | `/mcp/devforge` |
| MallForge | 9104 | `/mcp/mallforge` |

### 6.6 迁移检查清单

每个 *forge 项目迁移完成后，需确认以下事项：

- [ ] MCP Server 可独立启动（`python -m {forge}.mcp_server.server --port {port}`）
- [ ] `/health` 端点返回 healthy 状态
- [ ] `/tools` 端点列出所有工具
- [ ] 每个工具的 REST 端点可正常调用
- [ ] 声明式 YAML 配置被 `auto_discover_plugins()` 正确加载
- [ ] 旧代码已标记 `DeprecationWarning`
- [ ] SDK 公共接口（`sdk.memory`、`sdk.llm`）可正常访问
- [ ] 无 `from flowforge.core.interfaces.tools import ToolPlugin` 等内部类导入
- [ ] 无 `from flowforge.core.base_tool import BaseTool` 等内部类导入
- [ ] 无 `from flowforge.app.deps import get_llm_client` 等反向依赖
- [ ] config/loops/ 目录下的 YAML 文件已保留
- [ ] create_plugin() 中已设置 loops_dir="config/loops"
- [ ] LoopRegistry.register() 兼容性已验证
- [ ] register_loops V2 钩子已通过 auto_discover 自动调用
