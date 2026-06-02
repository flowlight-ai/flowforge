# FlowForge 全栈实现与商业化评审报告

> **评审日期**：2026-05-26
> **评审角色**：Senior Full-Stack Engineer
> **评审范围**：FlowForge 全栈代码库（后端 ~17,000 行 / 前端 ~40 文件 / 8 E2E 测试套件 / Docker 部署配置）
> **评审方法**：逐文件代码审查 + 架构模式分析 + 生产就绪度评估
> **总体结论**：**后端架构设计有远见但实现存在系统性缺陷，前端处于原型阶段，距生产级交付仍需 8-12 周集中投入。核心风险在于 DI 容器形同虚设、数据库无迁移策略、安全机制可绕过、前端零测试覆盖。**

---

## 1. 后端架构 — 评分：6/10

### 1.1 FastAPI 应用结构

**优点**：
- `lifespan` 上下文管理器正确处理启动/关闭生命周期，插件健康监控和调度器启停逻辑清晰
- 路由模块化拆分合理：17 个 endpoint 模块按职责域划分（tasks、modes、auth、plugins、workflows 等）
- `/health` 端点实现了组件级健康检查（mode_registry、plugin_registry、tool_registry、database、model_service、openroute），粒度到位

**严重问题**：

#### 问题 1：DI 容器形同虚设，全局变量反模式泛滥

`core/di.py` 定义了 `DIContainer` 类，但 `app/main.py` 中**完全没有使用它**。所有依赖通过 `app/deps.py` 的模块级全局变量 + setter 函数注入：

```python
# app/deps.py — 实际的"DI"实现
_executor_instance: HybridExecutor = None       # 模块级全局变量
_llm_client_instance: LLMClient = None
_model_service_instance: ModelService = None
_scheduler_instance: TaskScheduler = None
_plugin_manager_instance: PluginManager = None
_plugin_registry_instance: PluginRegistry = None
_tool_chain_executor_instance: ToolChainExecutor = None

def set_executor_instance(executor: HybridExecutor):   # setter 函数
    global _executor_instance
    _executor_instance = executor
```

这导致：
- **无法测试**：测试无法替换依赖，必须 mock 模块级全局变量
- **启动顺序脆弱**：`main.py` 中 200+ 行的初始化代码必须严格按顺序执行，任何顺序错误都会导致 `None` 引用
- **循环依赖风险**：`main.py` 中存在多处 `from flowforge.app.api.endpoints.xxx import ...` 的延迟导入，是规避循环依赖的临时方案

**建议**：使用 FastAPI 原生的 `Depends()` + `Annotated` 类型注入，或引入 `python-inject` / `lagom` 等轻量 DI 框架。将 `main.py` 中的初始化逻辑重构为 `Bootstrap` 类。

#### 问题 2：main.py 承担过多职责

`app/main.py`（294 行）同时负责：
- FastAPI 实例创建和中间件配置
- 所有注册中心的初始化（AgentRegistry、ModeRegistry、ToolRegistry、PluginRegistry）
- 14 个 Agent 的工厂注册
- 9 个 Mode Executor 的注册
- 可选工具的条件注册（带 try/except ImportError）
- WebSocket Manager 注入
- Graph API / Prompts API / Memory API 的初始化回调
- Health / Metrics 端点定义

**建议**：拆分为 `bootstrap.py`（依赖组装）、`routes.py`（路由注册）、`middleware.py`（中间件配置），`main.py` 只保留 `app = create_app()` 入口。

#### 问题 3：CORS 配置过于宽松

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # 允许所有来源
    allow_credentials=True,       # 同时允许凭据
    allow_methods=["*"],
    allow_headers=["*"],
)
```

`allow_origins=["*"]` + `allow_credentials=True` 是**安全反模式**——浏览器规范禁止此组合，实际行为是忽略 `credentials`。生产环境必须配置具体域名白名单。

### 1.2 错误处理

**优点**：
- `core/errors.py` 定义了结构化异常层次：`FlowForgeError` → `ConfigurationError` / `ModeNotFoundError` / `ConflictError` / `ToolNotFoundError` / `SandboxError` / `AllModelsUnavailableError` / `HarnessViolationError` / `StepTimeoutError`，覆盖了主要业务场景
- 每个 API 端点使用统一的 `_make_response()` / `_make_error()` 辅助函数，响应格式一致

**问题**：
- **缺少全局异常处理器**：FastAPI 的 `@app.exception_handler(FlowForgeError)` 未注册，异常到 HTTP 响应的映射散落在各个 endpoint 的 try/except 中
- **HybridExecutor.run() 吞没异常**：`asyncio.TimeoutError` 和 `StepTimeoutError` 被捕获后返回 `{"error": ...}` 而非抛出，调用方无法区分"正常完成但结果含错误"和"执行失败"
- **WebSocket 端点异常静默吞没**：`websocket.py` 中所有 except 块都是 `pass`，连接断开无日志记录

**建议**：注册 FastAPI 全局异常处理器，将 `FlowForgeError` 子类自动映射到对应 HTTP 状态码；WebSocket 断连至少记录 warning 级别日志。

---

## 2. 前端架构 — 评分：4/10

### 2.1 Next.js 结构

**优点**：
- App Router 路由结构清晰：`solo/[taskId]`、`review/[taskId]`、`admin/agents|models|settings`、`tasks`
- `next.config.js` 配置了 API 代理和 WebSocket 代理，开发体验良好
- `proxyTimeout: 180000` 考虑了 LLM 长请求场景

**问题**：

#### 问题 1：状态管理混乱——useState + localStorage + useRef 三重状态

`useSoloWebSocket.ts`（499 行）是前端最核心的 hook，但状态管理方式存在严重问题：

```typescript
// 三重状态源
const [phase, setPhase] = useState<SoloTaskPhase>(restored.phase || "idle");  // React state
const entriesRef = useRef<StreamEntry[]>(restored.entries || []);             // useRef
localStorage.setItem(getLSKey(brand), JSON.stringify(merged));                 // localStorage
```

- **useState** 用于触发重渲染
- **useRef** 用于在回调中获取最新值（避免闭包陷阱）
- **localStorage** 用于持久化和跨页面恢复

三者之间没有同步保证，容易出现：
- `entriesRef.current` 和 `entries` state 不一致
- localStorage 写入失败（配额超限）时无降级
- `saveState()` 在每次事件到来时都执行 JSON.stringify + localStorage.setItem，高频场景下性能堪忧

**建议**：引入 Zustand 作为单一状态源，配合 `zustand/middleware` 的 `persist` 中间件替代手写 localStorage 逻辑。useRef 仅用于 WebSocket 实例等不需要触发渲染的值。

#### 问题 2：组件内联样式泛滥

`ExecutionStream.tsx`、`SoloEditor.tsx`、`SoloStatusBar.tsx` 等核心组件大量使用 `style={{}}` 内联对象：

```tsx
// ExecutionStream.tsx 第 83-96 行
<div style={{
    fontSize: "40px",
    marginBottom: "12px",
    opacity: 0.6,
}}>
```

package.json 声明了 `tailwind-merge` 依赖但**从未使用**。项目声称使用 Tailwind + shadcn/ui 技术栈，实际实现完全不符。

**建议**：系统性替换为 Tailwind CSS 类名，引入 shadcn/ui 组件库（Badge、Button、Card、Tabs 等），统一设计语言。

#### 问题 3：SoloEditor 的 Markdown 渲染不安全

```typescript
// SoloEditor.tsx 第 14-25 行
function renderSimpleMarkdown(md: string): string {
    let html = md
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        // ...
    return `<p>${html}</p>`;
}

// 第 83 行
dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(content) }}
```

`renderSimpleMarkdown` 没有任何 XSS 防护，用户输入的 HTML 标签会被直接注入。package.json 已包含 `react-markdown` 依赖但未使用。

**建议**：立即替换为 `react-markdown` 组件，它内置了 XSS 防护。

### 2.2 组件设计

**优点**：
- Solo UI 组件拆分粒度合理：`ExecutionStream`（事件流）、`ToolCallCard`（工具调用卡片）、`ThinkingBlock`（推理过程）、`StageTransition`（阶段切换）、`SoloEditor`（编辑器）、`SoloStatusBar`（状态栏）
- `solo-types.ts` 定义了完整的类型系统（ChatMessage、StepGroupData、TaskHistoryItem、DynNode、DynEdge）
- `useSoloWebSocket` 实现了断线重连（指数退避，最大 10 次）、事件缓冲回放、任务超时检测

**问题**：
- **无虚拟滚动**：`ExecutionStream` 直接 `entries.map()` 渲染所有事件，500+ 事件时将导致严重性能问题
- **DynamicGraph 是空壳**：`DynamicGraph.tsx` 仅渲染占位文本，DAG 图可视化未实现
- **ModeSelector 未联动**：`ModeSelector` 组件存在但未与后端 9 大模式注册中心集成

---

## 3. API 设计 — 评分：5/10

### 3.1 REST API 质量

**优点**：
- 统一的响应格式：`{ status, data, meta: { trace_id, timestamp } }` / `{ status, error: { code, message, details }, meta }`
- 任务 API 设计合理：创建、列表（分页+过滤）、详情、审核、暂停/恢复/取消/跳过，覆盖完整生命周期
- 输入校验到位：intent 非空校验、mode 白名单校验、workflow 存在性校验、verdict 枚举校验

**问题**：

#### 问题 1：API 版本策略单一

所有路由硬编码为 `/api/v1`，没有版本协商机制。当需要引入 breaking change 时，只能：
- 在 v1 路径上修改（破坏向后兼容）
- 新增 `/api/v2` 路径（但无框架级支持）

**建议**：在 `router.py` 中使用 FastAPI 的 `APIRouter(prefix="/api/v{version}")` 模式，为未来版本预留扩展点。同时在响应头中返回 `X-API-Version: 1.0.0`。

#### 问题 2：API 文档不完整

FastAPI 自带的 `/docs` (Swagger UI) 和 `/redoc` 虽然可用，但：
- 大量端点使用 `payload: dict` 而非 Pydantic 模型，导致文档无法自动生成请求体 Schema
- `create_task` 的 `payload: dict` 包含 10+ 个可选字段（intent、task、input_data、mode、persona、workflow、interaction_mode、model、metadata、task_id），但文档中看不到这些字段
- Harness / Skill / MCP 相关的 API 端点在文档中完全缺失

**建议**：为每个端点定义 Pydantic Request/Response 模型，替换 `payload: dict`。至少覆盖 `CreateTaskRequest`、`SubmitReviewRequest`、`ListTasksQuery` 等核心模型。

#### 问题 3：缺少 API 速率限制

当前所有 API 端点无任何速率限制。`POST /api/v1/tasks` 可以被无限调用，导致：
- LLM API 费用失控
- Persona 并发锁被恶意占用
- SQLite 写入竞争

**建议**：引入 `slowapi` 或自定义中间件，至少对 `POST /api/v1/tasks` 实施 10 次/分钟的速率限制。

### 3.2 缺失的 API 端点

| 缺失 API | 影响 | 优先级 |
|----------|------|--------|
| `GET /api/v1/templates` | 模板市场无法运作 | P0 |
| `POST /api/v1/templates/{id}/install` | 场景一键安装不可用 | P0 |
| `GET /api/v1/skills` | Skill 管理无 API | P0 |
| `POST /api/v1/skills/{id}/configure` | Skill 配置无 API | P0 |
| `GET /api/v1/mcp/servers` | MCP 服务发现无 API | P1 |
| `GET /api/v1/harness/constraints` | Harness 约束查询无 API | P1 |
| `GET /api/v1/metrics/dashboard` | 仪表盘数据聚合无 API | P1 |

---

## 4. WebSocket 实现 — 评分：7/10

### 4.1 实现质量

**优点**：
- **三端点设计合理**：`/ws/solo/{task_id}`（Solo 专用）、`/ws/events`（全局事件流）、`/ws/logs`（日志尾随），职责分离清晰
- **事件缓冲回放**：`ConnectionManager._event_buffers` 在无客户端连接时缓存事件，首个客户端连接后自动回放，解决了后端先于前端启动的竞态条件
- **前端断线重连**：`useSoloWebSocket` 实现了指数退避重连（最大 10 次，上限 30s），包含 `intentionalDisconnectRef` 防止主动断开时误重连
- **心跳机制**：Solo WebSocket 支持 `ping/pong` 保活
- **序列号机制**：`_seq_counter` 单调递增，前端可通过 `from_seq` 请求事件回放

**问题**：

#### 问题 1：WebSocket 不经过 Next.js 代理

`next.config.js` 配置了 WebSocket 代理：
```javascript
{ source: "/ws/:path*", destination: "http://127.0.0.1:8000/ws/:path*" }
```

但 `useSoloWebSocket.ts` 直接连接后端：
```typescript
const WS_BASE = config.wsBaseUrl || `ws://${window.location.hostname}:8000`;
const ws = new WebSocket(`${WS_BASE}/ws/solo/${tid}`);
```

这意味着：
- 生产环境暴露后端 8000 端口，破坏了 Nginx 反向代理的统一入口
- CORS 策略对 WebSocket 无效，无法通过 Next.js 中间件做认证
- 部署时需要额外配置 Nginx WebSocket 代理

**建议**：前端 WebSocket 统一走 `ws://${window.location.host}/ws/...`，由 Next.js rewrites 或 Nginx 代理到后端。

#### 问题 2：全局事件流 (/ws/events) 实现粗糙

```python
# websocket.py 第 153-181 行
received_events = []
event_bus.subscribe("*", lambda e: received_events.append(e))

while True:
    while received_events:
        event = received_events.pop(0)
        await websocket.send_json(event)
    await asyncio.sleep(0.1)  # 100ms 轮询
```

- 使用 `list` + `pop(0)` 而非 `asyncio.Queue`，`pop(0)` 是 O(n) 操作
- 100ms 轮询间隔引入不必要的延迟
- `subscribe("*", ...)` 无取消订阅机制，连接断开后回调仍会执行
- 无事件过滤，客户端收到所有任务的所有事件

**建议**：替换为 `asyncio.Queue`，实现 `unsubscribe` 逻辑，支持客户端通过查询参数指定事件过滤条件。

#### 问题 3：日志尾随 (/ws/logs) 直接读文件

```python
with open(log_file, "r", encoding="utf-8") as f:
    f.seek(pos)
    new_lines = f.readlines()
```

每 500ms 打开文件读取新行，在高并发日志写入场景下可能丢失行或读到不完整的行。应使用 `watchdog` 或 `asyncio` 原生日志订阅机制。

---

## 5. 数据库设计 — 评分：3/10

### 5.1 Schema 设计

**当前状态**：`memory/stores/sqlite_store.py` 定义了 3 张表：

```python
class TaskModel(Base):
    __tablename__ = "tasks"
    id = Column(String, primary_key=True)
    persona = Column(String, nullable=False)
    mode = Column(String, nullable=False)
    status = Column(String, default="pending")
    state_json = Column(Text, nullable=True)       # 整个状态序列化为 JSON Text
    created_at = Column(String)                     # 时间戳用 String 而非 DateTime
    completed_at = Column(String, nullable=True)

class AuditLogModel(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    detail = Column(Text, nullable=True)            # 审计详情用 Text 存储

class ModelHealthModel(Base):
    __tablename__ = "model_health"
    model_key = Column(String, primary_key=True)
```

**严重问题**：

#### 问题 1：无数据库迁移策略

项目**没有 Alembic 或任何迁移工具**。Schema 变更只能通过 `Base.metadata.create_all(engine)` 创建新表，无法：
- 修改已有表结构（添加列、修改类型、重命名）
- 回滚到之前版本
- 在生产环境安全地执行 Schema 演进

**建议**：立即引入 Alembic，执行 `alembic init migrations`，将 `create_all()` 替换为 `alembic upgrade head`。

#### 问题 2：时间戳使用 String 类型

```python
created_at = Column(String, default=lambda: datetime.now(timezone.utc).isoformat())
```

- 无法使用 SQL 日期函数进行范围查询和排序
- 不同时区的 ISO 字符串比较结果不正确
- 占用更多存储空间

**建议**：改用 `Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))`。

#### 问题 3：state_json 反模式

`TaskModel.state_json` 将整个任务状态序列化为 JSON Text 存储：
- 无法对状态内部字段建立索引
- 无法执行 SQL 级别的状态过滤（如 `WHERE state_json->>'status' = 'running'`）
- JSON 序列化/反序列化开销随状态增大而增加

**建议**：将高频查询字段（status、mode、persona、interaction_mode）提升为独立列，`state_json` 仅存储完整的快照数据。

#### 问题 4：Session 管理不安全

```python
def get_session():
    Session = sessionmaker(bind=engine)
    return Session()  # 每次创建新 Session，无上下文管理
```

没有使用 `with` 上下文管理器，Session 不会自动关闭，可能导致连接泄漏。应使用 `get_session()` 作为 FastAPI 依赖注入，配合 `yield` 确保关闭。

#### 问题 5：SQLite 并发限制

`connect_args={"check_same_thread": False}` 禁用了 SQLite 的线程安全检查，但 SQLite 本身只支持单写者。在多 Worker 模式下（`uvicorn --workers 4`）会出现 `database is locked` 错误。

**建议**：生产环境应切换到 PostgreSQL（HelixRAG 已有 PostgreSQL 实例可复用），或至少启用 WAL 模式 + 合理的 busy_timeout。

---

## 6. 部署架构 — 评分：4/10

### 6.1 Docker 配置

**Dockerfile 问题**：

```dockerfile
FROM python:3.10-slim              # ❌ 未固定小版本，应 python:3.10.14-slim-bookworm
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt  # ❌ 非多阶段构建
COPY . .                           # ❌ 无 .dockerignore，tests/data/logs/.git 全部拷入
RUN mkdir -p data logs
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
                                   # ❌ 单 Worker、无 graceful_timeout、无 USER 指令
```

**建议**：
```dockerfile
FROM python:3.10.14-slim-bookworm AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.10.14-slim-bookworm
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY . .
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "4", "--graceful-timeout", "30", "--proxy-headers"]
```

### 6.2 Docker Compose

当前 `docker-compose.yml` 仅定义了 `flowforge` 一个服务，与任务描述的"8 services"不符。缺少：
- `flowforge-web`（Next.js 前端）
- `nginx`（反向代理）
- `openroute`（LLM 路由）
- `helixrag` / `opensieve`（RAG 服务）
- `prometheus` + `grafana`（监控）
- `redis`（缓存/队列，可选）

**建议**：补全完整的 Docker Compose 配置，每个服务添加 healthcheck，使用 `depends_on.condition: service_healthy` 保证启动顺序。

### 6.3 CI/CD

**完全缺失**。项目没有 `.github/workflows/` 目录，没有 CI/CD 配置文件。

**建议**：至少建立以下流水线：
1. **PR 检查**：`ruff check` + `mypy` + `pytest tests/unit/`（< 2 分钟）
2. **集成测试**：`pytest tests/integration/`（需要 FlowForge 服务运行）
3. **构建推送**：Docker 镜像构建 + 推送到 Registry
4. **部署**：SSH 到服务器 + `docker compose pull && docker compose up -d`

### 6.4 优雅关闭

`main.py` 的 `lifespan` 中有基本的关闭逻辑：
```python
yield
await plugin_registry.shutdown_all()
if system_config.scheduler_enabled:
    scheduler.shutdown()
```

但缺少：
- 正在执行的 LLM 调用的取消和状态保存
- WebSocket 连接的优雅关闭通知
- SQLite WAL checkpoint
- 正在运行的 asyncio.Task 的取消和等待

**建议**：在 lifespan 的关闭阶段，遍历 `HybridExecutor._task_futures` 取消所有运行中的任务，保存 checkpoint，通知所有 WebSocket 客户端服务即将关闭。

---

## 7. 安全性 — 评分：3/10

### 7.1 认证机制

**当前状态**：
- JWT 认证已实现（`auth.py`），但**完全可选**——没有任何端点强制要求认证
- 默认凭据硬编码：`admin/admin123`、`editor/editor123`、`viewer/viewer123`
- 用户存储在内存字典中，不支持动态用户管理

```python
# auth.py 第 24-28 行
_users_db = {
    "admin": {"password": os.getenv("FLOWFORGE_ADMIN_PASSWORD", "admin123"), "role": "admin"},
    "editor": {"password": os.getenv("FLOWFORGE_EDITOR_PASSWORD", "editor123"), "role": "editor"},
    "viewer": {"password": os.getenv("FLOWFORGE_VIEWER_PASSWORD", "viewer123"), "role": "viewer"},
}
```

**问题**：
1. **密码明文存储**：没有 bcrypt/scrypt 哈希，内存中直接保存明文密码
2. **无认证中间件**：JWT 签发后，没有任何 FastAPI 依赖检查请求中的 Bearer Token
3. **无 RBAC 执行**：虽然 JWT payload 包含 `role` 字段，但没有角色权限检查逻辑
4. **SECRET_KEY 默认值**：`SystemConfig.secret_key = "changeme-in-production"`，如果未配置环境变量，JWT 可被任何人伪造

**建议**：
1. 引入 `passlib[bcrypt]` 对密码哈希
2. 实现 `get_current_user()` FastAPI 依赖，在所有写操作端点上强制认证
3. 实现 `require_role("admin")` 装饰器，保护管理端点
4. 启动时检查 `secret_key` 是否为默认值，如果是则拒绝启动

### 7.2 输入验证

**当前状态**：
- `create_task` 的 `payload: dict` 没有使用 Pydantic 模型校验
- `submit_review` 的 `payload: dict` 同样缺少模型校验
- WebSocket 接收的消息仅做 `json.loads()`，无 Schema 验证

**风险**：
- JSON 注入：恶意构造的 payload 可能包含超长字符串、嵌套对象等
- WebSocket 消息伪造：`review_submit` 消息可被任何连接的客户端发送，无认证

**建议**：为所有 API 端点定义 Pydantic Request 模型；WebSocket 消息引入类型校验和认证。

### 7.3 速率限制

**完全缺失**。所有 API 端点无任何速率限制。

**建议**：使用 `slowapi` 中间件，至少配置：
```python
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@limiter.limit("10/minute")
async def create_task(...): ...
```

### 7.4 SecretStore

`core/secret_store.py` 存在但 API Key 的存储和访问路径不透明。需要确认：
- Secret 是否加密存储在 `data/secrets.db` 中
- 日志中是否会泄露 API Key
- 环境变量回退链（DB → env var → .env → default）是否安全

---

## 8. 可观测性 — 评分：5/10

### 8.1 日志

**优点**：
- `core/tracing.py` 实现了 `TraceLogger`，自动注入 `trace_id`
- 支持 JSON 格式日志输出
- 文件日志自动创建 `logs/` 目录

**问题**：
- **trace_id 未贯穿全链路**：`trace_id` 通过 `ContextVar` 存储，但 WebSocket 端点和后台任务（`asyncio.ensure_future`）中 trace_id 丢失
- **日志级别不统一**：部分模块使用 `logger.info()`，部分使用 `print()`
- **无结构化日志字段**：日志格式为 `[trace_id=xxx] message key=value`，非标准 JSON 结构，不利于日志聚合平台解析

**建议**：使用 `structlog` 替代手写 TraceLogger，支持 JSON 输出 + 自动 trace_id 注入 + 上下文字段。

### 8.2 指标

**优点**：
- `observability/metrics_collector.py` 实现了 5 大 Prometheus 指标（tasks_total、execution_duration、token_usage、tool_calls、persona_running）
- `/metrics` 端点支持 Prometheus 格式输出
- E2E 测试的 `E2EMetricsCollector` 采集 28 项指标，覆盖 LLM/Tool/Agent/Workflow/Memory/WebSocket 六个维度

**问题**：
- **MetricsCollector 是内存存储**：重启后所有指标丢失，不适合生产环境
- **未集成 prometheus_client 的实际 Counter/Histogram/Gauge**：虽然 requirements.txt 包含 `prometheus-client`，但代码中使用自定义的 `_counters` / `_histograms` / `_gauges` 字典
- **缺少关键业务指标**：WebSocket 连接数、任务队列长度、LLM API 延迟百分位、错误率

**建议**：使用 `prometheus_client` 的原生类型（Counter、Histogram、Gauge），通过 `/metrics` 端点直接暴露。

### 8.3 链路追踪

**完全缺失**。没有 OpenTelemetry / Jaeger / Zipkin 集成。

**建议**：Phase 2 引入 `opentelemetry-instrumentation-fastapi` + `opentelemetry-exporter-otlp`，实现跨服务的请求追踪。

---

## 9. 开发体验 — 评分：5/10

### 9.1 后端 DX

**优点**：
- `pyproject.toml` + `requirements.txt` 双轨依赖管理
- `pytest.ini` 配置了测试发现路径
- `conftest.py` 提供了测试夹具
- E2E 测试框架完善：`E2EMetricsCollector` + `SoloUITestBase` + `assert_metrics()`

**问题**：
- **无类型检查配置**：没有 `mypy.ini` 或 `pyproject.toml [tool.mypy]` 配置
- **无代码格式化配置**：没有 `ruff.toml` 或 `pyproject.toml [tool.ruff]` 配置
- **无 pre-commit 配置**：没有 `.pre-commit-config.yaml`
- **启动脚本缺失**：`run_server.py` 存在但未在文档中说明用法

### 9.2 前端 DX

**优点**：
- `package.json` 定义了 `dev` / `build` / `start` / `lint` 脚本
- TypeScript 配置完整（`tsconfig.json`）
- Next.js 开发服务器端口 5174 已配置

**问题**：
- **无测试框架**：没有 `jest` / `vitest` / `playwright` 依赖
- **无 ESLint 配置**：`next lint` 使用默认配置，无自定义规则
- **无 Prettier 配置**：代码格式不统一
- **Tailwind CSS 未配置**：`package.json` 没有 `tailwindcss` / `postcss` / `autoprefixer` 依赖，`globals.css` 中无 Tailwind 指令

### 9.3 文档

**优点**：
- `docs/` 目录包含 10+ 设计文档（架构、API、测试、Phase 规划等）
- `docs/review/` 包含多轮评审报告（architect、product、agent developer 等）

**问题**：
- API 文档与实际代码不同步（v4.0 文档 vs 当前实现）
- 缺少 `CONTRIBUTING.md` 和开发者上手指南
- 缺少环境变量参考文档（`system_config` 的所有配置项未列出）

---

## 10. 生产就绪度 — 评分：3/10

### 10.1 生产就绪度检查清单

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 认证鉴权 | 🔴 | JWT 可选，无强制认证，默认凭据不安全 |
| 速率限制 | 🔴 | 完全缺失 |
| 输入校验 | 🟡 | 部分端点有校验，但使用 `dict` 而非 Pydantic 模型 |
| 数据库迁移 | 🔴 | 无 Alembic，Schema 变更无法安全执行 |
| 优雅关闭 | 🟡 | 有基本框架，但缺少任务取消和状态保存 |
| 健康检查 | 🟢 | `/health` 端点组件级检查完善 |
| 日志聚合 | 🟡 | 有文件日志，但无结构化输出和聚合方案 |
| 指标监控 | 🟡 | 有 Prometheus 格式输出，但使用内存存储 |
| 链路追踪 | 🔴 | 完全缺失 |
| 错误恢复 | 🟡 | 有 Circuit Breaker 和 Checkpoint，但未测试 |
| 容器安全 | 🔴 | 无 USER 指令，无多阶段构建，无 .dockerignore |
| 前端测试 | 🔴 | 零测试覆盖 |
| API 版本化 | 🟡 | 有 /api/v1 前缀，但无版本协商机制 |
| 备份恢复 | 🔴 | 无备份策略，SQLite WAL 模式备份有坑 |
| i18n | 🔴 | 完全缺失，UI 硬编码中文 |
| a11y | 🔴 | 完全缺失，无 ARIA 标签、无键盘导航 |

### 10.2 关键风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| SQLite 并发锁导致服务不可用 | 高 | 严重 | 切换 PostgreSQL 或启用 WAL + busy_timeout |
| JWT 默认密钥被利用 | 高 | 严重 | 启动时强制检查 secret_key |
| LLM API 费用失控 | 中 | 严重 | 实施速率限制 + 费用预算 |
| 前端 XSS 攻击 | 中 | 高 | 替换 dangerouslySetInnerHTML 为 react-markdown |
| 数据库 Schema 变更导致数据丢失 | 中 | 严重 | 引入 Alembic 迁移 |
| Docker 容器被入侵 | 低 | 严重 | 多阶段构建 + USER 指令 + 最小权限 |

---

## 综合评分卡

| # | 评审维度 | 得分 (1-10) | 关键发现 |
|---|---------|:-----------:|---------|
| 1 | 后端架构 | **6** | DI 容器形同虚设，main.py 职责过重，CORS 配置不安全；但 lifespan 管理、路由模块化、错误体系设计合理 |
| 2 | 前端架构 | **4** | 状态管理三重源混乱，内联样式泛滥，Markdown 渲染有 XSS 风险；但组件拆分粒度合理，WebSocket hook 较完善 |
| 3 | API 设计 | **5** | 响应格式统一、输入校验到位；但缺少 Pydantic 模型、速率限制、版本策略，模板/Skill/MCP API 完全缺失 |
| 4 | WebSocket 实现 | **7** | 三端点设计合理，事件缓冲回放解决竞态，前端断线重连完善；但全局事件流实现粗糙，绕过 Next.js 代理 |
| 5 | 数据库设计 | **3** | 无迁移策略、时间戳用 String、state_json 反模式、Session 管理不安全、SQLite 并发限制严重 |
| 6 | 部署架构 | **4** | Dockerfile 缺少多阶段构建和安全加固，Docker Compose 不完整，CI/CD 完全缺失，优雅关闭不完整 |
| 7 | 安全性 | **3** | JWT 可选无强制认证、密码明文存储、SECRET_KEY 默认值、无速率限制、WebSocket 无认证、前端 XSS 风险 |
| 8 | 可观测性 | **5** | 有 trace_id 注入和 Prometheus 指标框架；但 trace_id 不贯穿全链路、指标用内存存储、链路追踪缺失 |
| 9 | 开发体验 | **5** | E2E 测试框架完善、文档丰富；但无类型检查/格式化/pre-commit 配置，前端零测试，Tailwind 未配置 |
| 10 | 生产就绪度 | **3** | 16 项检查中仅 2 项达标，6 项严重缺失；核心风险在于安全、数据库、部署三大领域 |

**综合得分：4.5/10**

---

## 优先修复路线图

### P0 — 阻塞性问题（1-2 周）

| # | 任务 | 预估工时 | 影响范围 |
|---|------|---------|---------|
| 1 | **安全加固**：JWT 强制认证 + 密码哈希 + secret_key 启动检查 + 速率限制 | 3 天 | `app/api/endpoints/auth.py` + 新增中间件 |
| 2 | **数据库迁移**：引入 Alembic + 修复时间戳类型 + state_json 拆分 | 2 天 | `memory/stores/sqlite_store.py` + 新增 `migrations/` |
| 3 | **前端 XSS 修复**：替换 dangerouslySetInnerHTML 为 react-markdown | 0.5 天 | `SoloEditor.tsx` |
| 4 | **Dockerfile 安全加固**：多阶段构建 + USER 指令 + .dockerignore | 1 天 | `Dockerfile` + 新增 `.dockerignore` |
| 5 | **API Pydantic 模型**：为 create_task / submit_review 等核心端点定义 Request 模型 | 2 天 | `app/api/endpoints/tasks.py` 等 |

### P1 — 架构改进（3-5 周）

| # | 任务 | 预估工时 |
|---|------|---------|
| 6 | 重构 DI：用 FastAPI Depends 替代全局变量 | 3 天 |
| 7 | 前端状态管理：引入 Zustand 替代 useState + localStorage | 3 天 |
| 8 | 前端组件体系：引入 shadcn/ui + Tailwind CSS | 5 天 |
| 9 | WebSocket 走 Next.js 代理 + 全局事件流重构 | 2 天 |
| 10 | 补全 Docker Compose（8 services + healthcheck） | 2 天 |
| 11 | CI/CD 流水线搭建 | 3 天 |
| 12 | 结构化日志（structlog）+ prometheus_client 原生类型 | 2 天 |

### P2 — 生产强化（6-10 周）

| # | 任务 | 预估工时 |
|---|------|---------|
| 13 | SQLite → PostgreSQL 迁移 | 3 天 |
| 14 | 前端 E2E 测试（Playwright） | 5 天 |
| 15 | OpenTelemetry 链路追踪 | 3 天 |
| 16 | 模板市场 API + Skill 管理 API | 5 天 |
| 18 | i18n 框架（next-intl） | 3 天 |
| 19 | a11y 审计和修复 | 3 天 |
| 20 | 备份恢复策略 + 灾难恢复演练 | 2 天 |

---

> **最终结论**：FlowForge 的后端架构设计展现了清晰的分层思维（9 大模式注册中心、Harness 四根护栏、Skill/Plugin/MCP 三级扩展），但实现层面存在系统性缺陷——DI 容器未使用、数据库无迁移、安全机制可绕过、前端处于原型阶段。WebSocket 实现是全栈最成熟的部分（7/10），但数据库设计（3/10）和安全性（3/10）是最大的短板。建议在继续功能开发之前，先完成 P0 级别的安全加固和数据库迁移，否则任何生产部署都存在严重风险。
