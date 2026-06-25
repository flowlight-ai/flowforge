# FlowForge 提示词与开发规范

> **定位**：FlowForge 项目的提示词模板、开发规范与测试规范补充说明。
> **关系**：本文档作为 `arch.md`（架构设计）与 `test.md`（测试用例）的补充，聚焦于开发与测试过程中的规范要求。

---

## 声明式配置接入规范

### 上层 *Forge 项目接入要求

1. **只允许声明式配置**：上层 *Forge 项目的 config/ 目录下只能放置 YAML 配置文件，禁止放置 .py 代码文件
2. **禁止代码继承**：不得继承 flowforge 的 BaseTool/BaseAgent/StateQueryTool 等内部基类
3. **禁止强依赖引用**：不得直接 import flowforge.core.* / flowforge.tools.* / flowforge.app.* 等内部模块
4. **自定义工具通过 MCP 协议接入**：如需自定义工具逻辑，实现 MCP Server，通过 config/tools/*.yaml 声明式配置注入
5. **自动发现机制**：FlowForge 启动时自动扫描同级 *Forge 项目的 config/ 目录，无需手动注册

### 测试规范补充

- 测试上层 *Forge 项目时，验证 config/ 目录下无 .py 代码文件
- 测试自动发现机制：在 config/agents/ 下新增 YAML 文件，重启 FlowForge 后验证是否自动加载
- 测试 MCP 工具调用：通过 API 触发工具调用，验证 MCP 协议端到端是否正常

---

## React 模式工具调用规范

### Function Calling 修复说明

**背景**：React 模式的 `ReActExecutor` 原先未将工具 schema 传递给 LLM，导致 LLM 无法通过 function calling 调用工具，只能以文本形式"描述"要调用什么工具，`action_history` 始终为空。

**修复要点**（[react.py](file:///d:\software\openclaw\flowforge\modes\react.py)）：

1. **`_build_tool_schemas(ctx)`**：从 `ctx.tools` 构建 OpenAI 兼容的 tool schemas
   - 使用 `ctx.tools.get_tool(name)` 获取工具实例（非 `get()`）
   - 使用 `tool.parameters_schema` 获取参数 schema（非 `parameters`）
   - 跳过 `llm` 和 `shell_command` 工具
   - 限制最多 8 个 schema 避免上下文膨胀

2. **`_generate_thought(ctx, messages)`**：将 tool schemas 通过 `llm_params["tools"]` 传递给 LLM
   - 返回 `(content, tool_calls)` 元组
   - LLM 优先通过 function calling 调用工具

3. **`_execute_core(ctx)`**：优先处理 function calling 响应
   - 如果 `tool_calls` 非空，解析每个 `function` 调用并执行
   - 回退到文本解析（`_parse_action`）仅作为兜底

### 验证标准

- React 模式任务的 `action_history` 必须非空（LLM 实际调用了工具）
- 后端日志必须出现 `built N tool schemas for function calling` 和 `has_tools=True`
- 长程任务（8步 React 循环）不得中断

---

## 模型候选链解析规范

### 模型 ID 格式要求

FlowForge 的 LLM 客户端要求候选链中的模型 ID 必须为 `provider/model_id` 格式。`_resolve_model_candidates()` 方法负责将裸模型 ID 解析为正确格式：

| 场景 | 输入 | 输出 | 说明 |
|------|------|------|------|
| 已有 provider 前缀 | `openroute/auto` | `openroute/auto` | 直接保留 |
| 裸模型名 | `Doubao-Seed2.0` | `openroute/Doubao-Seed2.0` | 从 `_available_models` 反查 provider |
| OpenRouter 模型 | `openai/gpt-oss-120b:free` | `openrouter/openai/gpt-oss-120b:free` | 完整字符串作为 model_id，provider 为 `openrouter` |

### 配置规则

1. **models.yaml 中的 `assignments`**：`primary` 和 `fallbacks` 可以使用裸模型 ID，`_resolve_model_candidates` 会自动解析
2. **models.yaml 中的 `models` 列表**：每个模型必须声明 `provider` 和 `id`，`_available_models` 据此构建反查表
3. **已知 provider**：`openroute`、`openrouter`、`doubao`、`ark`、`aliyncs` 等（定义在 `PROVIDER_BASE_URLS` 和 `providers` 配置中）

### 验证标准

- 后端日志不得出现 `格式无效（缺少provider前缀）` 或 `无 base_url` 跳过日志
- 主模型（如 `Doubao-Seed2.0`）必须被直接调用，而非回退到 `openroute/auto`
- 健康状态日志应显示 `provider/model_id 调用成功`
