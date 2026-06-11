# FlowForge 架构设计原则

> 本文档定义了 FlowForge 项目的核心架构设计原则，所有贡献者必须遵守。
> 违反原则的代码将在审查中被拒绝。

---

## 1. 底座能力原则（Base Capability Principle）

**核心思想**：所有基础能力必须在 FlowForge 中实现，上层应用（ContentForge、DevForge、NovelForge 等）通过继承或扩展来复用，禁止重复实现。

### 1.1 能力分层

```
FlowForge（底座）    →  通用 Agent、通用 Workflow、模型治理、配置管理、日志追踪、Helm 交互
ContentForge（上层） →  内容创作 Agent、内容 SOP、专栏配置、发布渠道
DevForge（上层）     →  开发 Agent、IPD 工作流、代码审查、部署流程
NovelForge（上层）   →  小说创作 Agent、连载管理、章节编排
```

### 1.2 判定标准

一个能力属于 FlowForge 底座，当且仅当：
- 至少 2 个上层应用需要此能力
- 该能力不包含任何业务特定逻辑
- 该能力可以独立运行和测试

### 1.3 已下层到 FlowForge 的能力

| 能力 | 原属模块 | 下层时间 |
|------|---------|---------|
| 模型治理（ModelService + API + 健康检查 + 自动修复） | ContentForge + Hiclaw | 2025-05 |
| 多平台网页 Chat 代理（豆包/Kimi/DeepSeek/元宝/千问 + 轮询负载均衡） | Hiclaw | 2025-05 |
| 通用 Workflow（ReAct/Plan-Execute/Iterative/Pipeline/Review） | 无（新增） | 2025-05 |
| 通用 Agent（Thinker/Planner/Drafter/Critic/Analyst 等 17 个） | 无（新增） | 2025-05 |
| 动态配置管理（API Key 存储、Web UI 配置） | 无（新增） | 2025-05 |
| Helm 交互界面（三栏布局、对话流、审批卡片、命令系统） | ContentForge | 2025-05 |

---

## 2. 单向依赖原则（Unidirectional Dependency）

**铁律**：上层可以依赖下层，下层**绝对禁止**导入上层模块。

```
✅ ContentForge → import flowforge.xxx
✅ DevForge → import flowforge.xxx
❌ FlowForge → import contentforge.xxx
❌ FlowForge → import devforge.xxx
```

违反此原则的代码必须重构，不允许用延迟导入规避。

---

## 3. 配置外置原则（External Configuration）

**核心思想**：所有密钥、路径、环境相关配置必须通过配置系统注入，禁止硬编码。

### 3.1 禁止事项

- ❌ 硬编码 API Key：`api_key = "sk-xxx"`
- ❌ 硬编码路径：`path = "/home/user/project/..."`
- ❌ 硬编码端口/URL：`url = "http://localhost:13000"`
- ❌ 在 docker-compose.yml 中写死环境变量值

### 3.2 正确做法

- ✅ 通过 `config/system.yaml` 或 `.env` 注入
- ✅ 通过 Web UI 动态配置（API Key 存储在加密数据库中）
- ✅ 使用 `system_config.xxx` 读取配置
- ✅ 使用 `tempfile` 替代硬编码临时路径
- ✅ docker-compose.yml 引用 `.env` 文件或动态配置 API

### 3.3 API Key 管理

所有第三方 API Key（OPENROUTER_API_KEY、ALIYUN_API_KEY、ARK_API_KEY、TAVILY_API_KEY 等）：
- 存储在 `data/secrets.db`（SQLite，加密存储）
- 通过 Web UI「设置 → 密钥管理」界面增删改查
- 后端通过 `SecretStore.get(key)` 获取，优先级：数据库 > 环境变量 > .env 文件
- Docker 环境通过启动脚本从 secrets.db 读取并注入环境变量

---

## 4. 真实实现原则（No Fake Data/Logic）

**铁律**：禁止使用假数据、假逻辑、模拟返回。

- ❌ 返回硬编码的 `{"status": "ok"}`
- ❌ 模拟向量搜索返回空结果
- ❌ 模拟发布返回假 URL
- ✅ 所有检索、存储、发布必须使用真实实现
- ✅ 配置缺失时返回明确错误信息，而非静默返回空结果

---

## 5. 依赖注入原则（Dependency Injection）

**铁律**：禁止绕过 DI 容器直接实例化服务。

- ❌ `from workers.topic_agent import TopicAgent; agent = TopicAgent()`
- ❌ `repo = TaskRepo(get_session())`
- ✅ 所有依赖必须通过构造函数注入，由 DI 容器管理
- ✅ API 端点通过 `Depends()` 注入依赖

---

## 6. 数据访问原则（Repository Pattern）

**铁律**：禁止直接操作数据库。

- ❌ `cursor.execute("INSERT INTO tasks ...")`
- ❌ `session.query(Task).filter(...)`
- ✅ 所有数据库操作必须通过 Repository 层
- ✅ Repository 由 DI 容器管理生命周期

---

## 7. 接口隔离原则（Interface Segregation）

- 所有抽象基类在 `core/interfaces/` 中定义
- Agent 继承 `BaseAgent`，实现 `execute(input: AgentInput) -> AgentOutput`
- Tool 继承 `BaseTool`，实现 `execute(input: ToolInput) -> ToolOutput`
- 输入输出通过 Pydantic 模型校验

---

## 8. 可观测性原则（Observability）

- 日志使用 `core/tracing.py` 的 `get_logger`，自动注入 `trace_id`
- 所有 I/O 操作使用 `async/await`
- Agent 禁止直接导入 LLM SDK，必须通过 `LLMClient`
- 工具调用必须通过 `ToolRegistry.execute()`，禁止直接 import
- 执行错误必须记录到日志文件和审计系统

---

## 9. 开箱即用原则（Out-of-Box Experience）

**核心思想**：FlowForge 作为底座，必须提供开箱即用的默认配置，用户无需繁琐配置即可运行。

- ✅ 预制 5 个通用 Workflow + 17 个通用 Agent
- ✅ 预制 5 个 Provider + 9 个默认 Model 配置（含 6 个网页 Chat 代理）
- ✅ 默认使用 openroute（多平台网页 Chat 代理），无需 API Key 即可运行
- ✅ 模型治理自动健康检查和自动修复
- ✅ Helm 交互界面直接可用，无需额外配置

---

## 10. 循环依赖零容忍原则（Zero Circular Dependency）

- 发现循环依赖必须重构，不允许用延迟导入规避
- 修改后必须检查模块依赖图
- 使用 `import-linter` 或类似工具在 CI 中检测

---

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2025-05-14 | v1.0 | 初始版本，确立 10 大架构原则 |
