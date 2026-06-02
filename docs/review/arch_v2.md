# FlowForge 架构设计文档 v2.0

> **版本**：v2.0（SaaS 平台级架构升级）
> **基于**：v6.0 六层 Harness 架构 + architect_review.md 审核建议
> **日期**：2026-05-26
> **关联文档**：spec_v2.md、architect_review.md

---

## 目录

- [一、架构总览](#一架构总览)
- [二、核心架构决策（ADR）](#二核心架构决策adr)
- [三、分层架构详解](#三分层架构详解)
  - [3.1 应用层（Application Layer）](#31-应用层application-layer)
  - [3.2 接入层（Gateway Layer）](#32-接入层gateway-layer)
  - [3.3 驾驭层（Harness Layer）](#33-驾驭层harness-layer)
  - [3.4 执行引擎层（Engine Layer）](#34-执行引擎层engine-layer)
  - [3.5 能力层（Capability Layer）](#35-能力层capability-layer)
  - [3.6 基础设施层（Infrastructure Layer）](#36-基础设施层infrastructure-layer)
- [四、多租户架构设计](#四多租户架构设计)
- [五、模板市场架构](#五模板市场架构)
- [六、企业私有部署架构](#六企业私有部署架构)
- [七、部署拓扑与基础设施](#七部署拓扑与基础设施)
- [八、安全架构](#八安全架构)
- [九、数据架构](#九数据架构)
- [十、可观测性架构](#十可观测性架构)

---

## 一、架构总览

### 1.1 架构全景图

```mermaid
graph TB
    subgraph "FlowForge v2.0 平台架构"
        direction TB
        
        subgraph "第6层：应用层"
            WEB[Web UI<br/>Next.js 14]
            API[Public API<br/>REST + WebSocket]
            ADMIN[Admin Panel]
        end
        
        subgraph "第5层：接入层"
            GW[API Gateway<br/>Traefik / Nginx]
            AUTH[Auth Service<br/>JWT + OAuth2]
            TR[TenantResolver<br/>多租户路由]
            RL[Rate Limiter]
        end
        
        subgraph "第4层：Harness 驾驭层 ★"
            CE[ContextEngine]
            ACE[ArchitectureConstraintEngine]
            FL[FeedbackLoop<br/>内环+外环]
            EM[EntropyManager v2<br/>可操作指标]
            RP[ResiliencePipeline<br/>熔断+降级+隔舱]
        end
        
        subgraph "第3层：执行引擎层"
            ORCH[Orchestrator<br/>Workflow 调度]
            MODES[9种执行模式]
            SOP[SOP 引擎]
            REVIEW[审核引擎]
        end
        
        subgraph "第2层：能力层"
            LLM[LLM Client<br/>多Provider路由]
            SKILL[Skill Registry]
            MCP[MCP Ecosystem]
            TOOLS[Tool Registry]
            PUBLISH[Publish Engine]
        end
        
        subgraph "第1层：基础设施层"
            PG[(PostgreSQL<br/>主从)]
            REDIS[(Redis<br/>缓存/队列/Session)]
            MQ[Message Queue<br/>Redis Stream/RabbitMQ]
            FS[File Storage<br/>S3/MinIO]
        end
        
        WEB --> GW
        API --> GW
        ADMIN --> GW
        GW --> TR
        TR --> AUTH
        TR --> RL
        
        GW --> ORCH
        ORCH --> CE
        ORCH --> ACE
        ORCH --> FL
        ORCH --> EM
        ORCH --> RP
        
        ORCH --> MODES
        MODES --> SOP
        SOP --> REVIEW
        
        MODES --> LLM
        MODES --> SKILL
        MODES --> MCP
        MODES --> TOOLS
        MODES --> PUBLISH
        
        LLM --> PG
        SKILL --> PG
        ORCH --> REDIS
        ORCH --> MQ
        MODES --> FS
    end
    
    subgraph "外部系统"
        EXT_LLM[LLM Providers<br/>OpenAI/Anthropic/DeepSeek/...]
        EXT_PLATFORM[内容平台<br/>微信/知乎/头条/...]
        EXT_SSO[企业SSO<br/>LDAP/SAML/OIDC]
    end
    
    LLM --> EXT_LLM
    PUBLISH --> EXT_PLATFORM
    AUTH --> EXT_SSO
    
    style GW fill:#4ecdc4,color:#fff
    style TR fill:#4ecdc4,color:#fff
    style RP fill:#ffd93d
```

### 1.2 v6.0 → v2.0 架构变更总览

| 层级 | v6.0 | v2.0 变更 | 影响 |
|------|------|-----------|------|
| **应用层** | FastAPI 直接暴露 | 增加 API Gateway（Traefik）+ Admin Panel | 统一入口、安全管控 |
| **接入层** | 无独立网关 | **新增 Gateway Layer**：Auth Service + TenantResolver + Rate Limiter | 多租户核心能力 |
| **Harness 层** | 4 根护栏 | EntropyManager 改用可操作指标；**新增 ResiliencePipeline** | 可靠性质变 |
| **执行引擎** | 同步阻塞 | Orchestrator 接入 TaskQueue（Redis），Worker Pool 异步执行 | 并发能力 5x 提升 |
| **能力层** | 无 LLM Router | **新增 LLM Router**（多 Key 轮转 + Provider 降级） | LLM 可用率 99.9% |
| **基础设施** | SQLite | **PostgreSQL 主从 + Redis + MQ** | 写入 TPS 50→5000 |

### 1.3 核心架构原则

| 原则 | 说明 | 实施方式 |
|------|------|----------|
| **单向依赖** | 上层可依赖下层，下层禁止导入上层 | 分层目录隔离 + import-linter CI 检查 |
| **无状态 API** | API 层不持有任何会话状态 | Session 全部存储在 Redis |
| **有状态 Worker** | Worker 可持有 Workflow 上下文 | Worker 进程独立，按类型分池 |
| **配置外部化** | 所有配置通过环境变量 / ConfigMap | 12-Factor App 标准 |
| **防御性多租户** | 应用层 + 数据库层双重隔离 | Middleware tenant_id 注入 + PostgreSQL RLS |
| **韧性优先** | 所有外部调用都有超时/重试/熔断 | ResiliencePipeline 统一管控 |

---

## 二、核心架构决策（ADR）

### ADR-001：数据库选型 — PostgreSQL

| 维度 | 决策 |
|------|------|
| **选择** | PostgreSQL 15+ |
| **拒绝** | SQLite（v6.0）、MySQL |
| **理由** | Row-Level Security（RLS）原生支持多租户隔离；JSONB 支持灵活 Schema；pgvector 扩展支持向量检索；成熟的主从复制 |
| **代价** | 运维复杂度 +1，需独立部署 |
| **缓解** | Docker Compose 一键部署；Phase 4 迁移到托管 PostgreSQL（RDS） |

### ADR-002：消息队列 — 分阶段演进

| 阶段 | 选择 | 理由 |
|------|------|------|
| Phase 2 (MVP) | **Redis Stream** | 最小化新依赖，Redis 同时承担缓存+Session+队列 |
| Phase 3 (Beta) | **Redis Stream + 死信队列** | 增加消息持久化和失败重试 |
| Phase 4 (GA) | **RabbitMQ**（可选） | 需持久化 + 优先级队列 + 复杂路由时迁移 |

### ADR-003：多租户隔离 — 行级隔离 + RLS

| 维度 | 决策 |
|------|------|
| **选择** | Shared DB, Shared Schema + tenant_id 行级隔离 + PostgreSQL RLS |
| **拒绝** | 库级隔离（运维成本高）、Schema 隔离（不够灵活） |
| **理由** | 资源利用率最高；开发和运维最简单；RLS 提供数据库层强制隔离 |
| **代价** | 隔离强度弱于库级隔离，应用层必须正确注入 tenant_id |
| **缓解** | TenantContext Middleware 保证注入；Repository 基类自动过滤；集成测试验证隔离 |

### ADR-004：异步执行模型 — TaskQueue + Worker Pool

| 维度 | 决策 |
|------|------|
| **选择** | API 层接收请求 → 写入 TaskQueue → Worker Pool 异步消费 |
| **拒绝** | API 内同步执行（v6.0 模型）、Celery（过重） |
| **理由** | API 层保持低延迟（P99 < 500ms）；Worker 独立扩缩；支持优先级队列 |
| **代价** | 架构复杂度 +1，需处理异步状态通知（WebSocket push） |
| **缓解** | WebSocket 实时推送状态变更；Workflow 状态机清晰定义 |

### ADR-005：LLM 多 Provider — Router Pattern

| 维度 | 决策 |
|------|------|
| **选择** | LLM Router：主 Provider + 备 Provider + 缓存降级 |
| **拒绝** | 固定 Provider、随机轮转 |
| **理由** | 避免单点 LLM 故障导致全平台停服；成本优化（按 Token 价格路由） |
| **代价** | 需维护多 Provider 适配器 |
| **缓解** | Provider Adapter 接口标准化，新增 Provider 只需实现接口 |

---

## 三、分层架构详解

### 3.1 应用层（Application Layer）

#### 3.1.1 Web UI

- **技术栈**：Next.js 14 + React 18 + TypeScript + Tailwind CSS + shadcn/ui
- **核心页面**：Workflow 编辑器（拖拽式 DAG）、模板市场、租户管理、数据分析面板

#### 3.1.2 Public API

```python
# FastAPI 路由结构 v2.0
POST   /api/v2/tenants                          # 创建租户
GET    /api/v2/tenants/{tenant_id}               # 获取租户信息
PUT    /api/v2/tenants/{tenant_id}               # 更新租户配置

POST   /api/v2/tenants/{tenant_id}/workflows     # 创建 Workflow
GET    /api/v2/tenants/{tenant_id}/workflows     # 列出 Workflow
GET    /api/v2/tenants/{tenant_id}/workflows/{id} # 获取 Workflow 详情
POST   /api/v2/tenants/{tenant_id}/workflows/{id}/execute   # 执行 Workflow
POST   /api/v2/tenants/{tenant_id}/workflows/{id}/resume    # 从检查点恢复

GET    /api/v2/marketplace/templates              # 浏览模板市场
POST   /api/v2/marketplace/templates              # 发布模板
POST   /api/v2/marketplace/templates/{id}/install # 安装模板

GET    /api/v2/admin/tenants                      # 超管：管理所有租户
GET    /api/v2/admin/audit                        # 超管：审计日志

GET    /api/v2/metrics                            # Prometheus 指标

WS     /ws/v2/workflows/{id}                       # WebSocket：实时状态推送
```

#### 3.1.3 WebSocket 实时通信

```python
# Workflow 状态变更推送协议
{
    "type": "workflow.status_changed",
    "workflow_id": "wf_xxx",
    "tenant_id": "t_xxx",
    "old_status": "running",
    "new_status": "completed",
    "node_id": "node_5",
    "timestamp": "2026-05-26T10:30:00Z",
    "metrics": {
        "elapsed_seconds": 120,
        "tokens_consumed": 3500,
        "cost_estimate": 0.035
    }
}
```

---

### 3.2 接入层（Gateway Layer）

> **v2.0 全新层**，v6.0 中不存在。

#### 3.2.1 API Gateway（Traefik / Nginx）

```mermaid
graph TD
    CLIENT[客户端] --> GW[API Gateway<br/>Traefik]
    
    GW -->|"/api/v2/*"| API[FastAPI Service]
    GW -->|"/ws/*"| API
    GW -->|"/admin/*"| ADMIN[Admin Service]
    GW -->|"/marketplace/*"| MP[Marketplace Service]
    
    GW --> TLS[TLS 1.3<br/>Let's Encrypt]
    GW --> RL[Rate Limiter<br/>100 req/min per IP]
    GW --> CORS[CORS Policy]
    
    subgraph "Middleware Chain"
        TRACE[Request Tracing<br/>trace_id注入]
        TENANT[TenantResolver<br/>JWT → tenant_id]
        AUTH[Auth Middleware<br/>JWT 验证]
        QUOTA[Quota Check<br/>资源配额验证]
    end
    
    GW --> TRACE --> TENANT --> AUTH --> QUOTA
```

#### 3.2.2 TenantResolver（多租户路由）

```python
class TenantResolver:
    """
    从 JWT Token 中提取 tenant_id，注入到请求上下文中。
    所有后续处理都基于此 tenant_id 进行数据隔离。
    """
    
    async def resolve(self, request: Request) -> TenantContext:
        token = self._extract_token(request)
        claims = self._verify_jwt(token)
        
        tenant_id = claims["tenant_id"]
        tier = claims["tier"]  # FREE / PRO / ENTERPRISE
        
        # 从缓存获取配额信息
        quotas = await self.quota_cache.get(tenant_id)
        
        return TenantContext(
            tenant_id=tenant_id,
            tier=TenantTier(tier),
            quotas=quotas,
            user_id=claims["sub"],
            role=TenantRole(claims["role"]),
        )
```

#### 3.2.3 Auth Service

```python
class AuthService:
    """
    统一认证服务：JWT 签发/验证/刷新 + OAuth2 第三方登录
    """
    
    async def login(self, email: str, password: str) -> TokenPair:
        """邮箱密码登录，返回 access_token + refresh_token"""
        ...
    
    async def oauth_login(self, provider: OAuthProvider, code: str) -> TokenPair:
        """第三方登录：GitHub / Google / 微信"""
        ...
    
    async def refresh(self, refresh_token: str) -> TokenPair:
        """刷新 access_token"""
        ...
    
    async def verify(self, access_token: str) -> AuthClaims:
        """验证 token 并返回 claims"""
        ...
```

---

### 3.3 驾驭层（Harness Layer）

> v6.0 的四根护栏升级为五根（新增 ResiliencePipeline），EntropyManager 重大改造。

#### 3.3.1 ContextEngine（上下文管理）

```python
class ContextEngine:
    """
    v2.0 升级：增加强制 Token 预算约束
    
    职责：
    1. 滑动窗口管理（保留最近 N 轮对话）
    2. Token 预算监控（硬上限 + 软上限）
    3. 超限自动摘要（软上限触发摘要，硬上限触发截断）
    """
    
    def __init__(
        self,
        soft_token_limit: int = 8000,   # 软上限：触发摘要
        hard_token_limit: int = 16000,  # 硬上限：强制截断
        window_size: int = 20,          # 滑动窗口保留轮数
    ):
        ...
    
    async def add_turn(self, role: str, content: str) -> ContextSnapshot:
        """添加一轮对话，返回当前上下文快照"""
        ...
    
    async def compress(self) -> CompressedContext:
        """软上限触发：对早期对话进行摘要压缩"""
        ...
```

#### 3.3.2 ArchitectureConstraintEngine（架构约束）

```python
class ArchitectureConstraintEngine:
    """
    v2.0 升级：增加约束违规自动熔断
    
    职责：
    1. SOP 步骤顺序约束（步骤 B 必须在步骤 A 之后）
    2. 模式锁定（选定 Plan-Execute 后不可随意切换）
    3. 工具白名单（per-Workflow 可用的工具集）
    4. 约束违规熔断（违规 > 3次 → 暂停 Workflow）
    """
    
    def __init__(self, max_violations: int = 3):
        self.violations: dict[str, int] = {}  # workflow_id → 违规计数
    
    async def check_step(self, workflow_id: str, step: SOPStep) -> ConstraintResult:
        """检查步骤是否违反架构约束"""
        if self.violations.get(workflow_id, 0) >= self.max_violations:
            return ConstraintResult(
                allowed=False,
                action=ConstraintAction.CIRCUIT_BREAK,
                reason=f"约束违规超过{self.max_violations}次，已熔断"
            )
        ...
```

#### 3.3.3 FeedbackLoop（反馈环）

```python
class FeedbackLoop:
    """
    v2.0 升级：增加重试策略 + 模式降级链
    
    内环（节点级）：
    1. 每步完成后评估：full / lightweight / skip
    2. 评估失败 → 指数退避重试（1s→2s→4s→8s，最大3次）
    3. 3次重试仍失败 → 标记节点为 failed
    
    外环（Workflow 级）：
    1. Workflow 完成后全局总结
    2. 模式降级检查：Plan-Execute 失败 → 降级到 ReAct
    3. 降级仍失败 → 标记部分成功（partial_completed）
    """
    
    def __init__(self):
        self.retry_policy = ExponentialBackoffRetry(
            base_delay=1.0,
            max_delay=8.0,
            max_retries=3,
        )
        self.fallback_chain = FallbackChain([
            ModeFallback(from_mode="plan_execute", to_mode="react"),
            ModeFallback(from_mode="multi_agent", to_mode="single_agent"),
        ])
    
    async def evaluate_node(self, node_output: NodeOutput) -> NodeEvaluation:
        """内环：评估单个节点输出"""
        ...
    
    async def evaluate_workflow(self, workflow_result: WorkflowResult) -> WorkflowEvaluation:
        """外环：评估整个 Workflow"""
        ...
```

#### 3.3.4 EntropyManager v2（混乱度监控 — 重大改造）

```python
class EntropyManager:
    """
    v2.0 重大改造：从模糊的"熵值"切换到可操作指标
    
    指标集（OperationsMetrics）：
    1. failure_rate        — 最近10步的失败比例
    2. retry_count         — 当前 Workflow 的累计重试次数
    3. context_length      — 上下文窗口使用率 (tokens_used / hard_limit)
    4. step_deviation      — 实际步骤与 SOP 规划的偏离度
    5. llm_error_rate      — LLM 调用的错误比例（最近10次）
    
    干预策略（分级响应）：
    - 黄灯（1-2项超标）：记录告警，继续执行
    - 红灯（3-4项超标）：暂停 Workflow，推送用户通知
    - 黑灯（5项全超标）：自动熔断，等待管理员介入
    """
    
    THRESHOLDS = {
        "failure_rate": 0.3,       # 30% 以上标记
        "retry_count": 5,          # 累计重试 > 5 次标记
        "context_length": 0.9,     # 上下文使用率 > 90% 标记
        "step_deviation": 0.5,     # 偏离度 > 50% 标记
        "llm_error_rate": 0.2,     # LLM 错误率 > 20% 标记
    }
    
    async def evaluate(self, metrics: OperationsMetrics) -> AlertLevel:
        exceeded = sum(1 for name, threshold in self.THRESHOLDS.items()
                       if getattr(metrics, name) > threshold)
        
        if exceeded >= 5:
            return AlertLevel.BLACK  # 自动熔断
        elif exceeded >= 3:
            return AlertLevel.RED    # 暂停+通知
        elif exceeded >= 1:
            return AlertLevel.YELLOW # 告警
        return AlertLevel.GREEN
```

#### 3.3.5 ResiliencePipeline（韧性管道 — v2.0 新增）

```python
class ResiliencePipeline:
    """
    v2.0 全新组件：统一管理所有外部调用的韧性策略
    
    组成：
    1. CircuitBreaker   — 熔断器（连续失败 N 次 → 打开 → 冷却 → 半开）
    2. RetryPolicy      — 重试策略（指数退避 + 抖动）
    3. FallbackChain    — 降级链（有序尝试备选方案）
    4. Bulkhead         — 隔舱（限制并发调用数，防止雪崩）
    5. TimeoutPolicy    — 超时控制（per-call 超时）
    """
    
    def __init__(self):
        self.circuit_breaker = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=60,  # 60s 后进入半开状态
            half_open_max_calls=3,
        )
        self.retry_policy = ExponentialBackoffRetry(
            base_delay=1.0,
            max_delay=8.0,
            max_retries=3,
            jitter=True,
        )
        self.bulkhead = Bulkhead(
            max_concurrent_calls=10,
            max_queue_size=20,
        )
    
    async def execute(
        self,
        call_name: str,
        call_fn: Callable,
        fallback_fns: list[Callable] | None = None,
        timeout: float = 30.0,
    ) -> ResilienceResult:
        """
        通过韧性管道执行一次调用
        
        Flow: Bulkhead → CircuitBreaker → (call_fn with Retry) → FallbackChain
        """
        ...
```

---

### 3.4 执行引擎层（Engine Layer）

#### 3.4.1 Orchestrator v2（异步调度）

```python
class Orchestrator:
    """
    v2.0 升级：异步调度架构
    
    核心变更：
    1. 不再同步执行 Workflow（v6.0 模型）
    2. 接收请求 → 写入 TaskQueue → Worker Pool 异步消费
    3. WebSocket 推送状态变更
    """
    
    async def submit_workflow(
        self,
        tenant: TenantContext,
        workflow_def: WorkflowDefinition,
    ) -> WorkflowSubmission:
        """提交 Workflow（非阻塞，立即返回）"""
        
        # 1. 配额检查
        await self.quota_manager.check_and_reserve(tenant)
        
        # 2. 幂等性检查
        idempotency_key = workflow_def.idempotency_key
        if idempotency_key:
            existing = await self.idempotency_store.get(tenant.tenant_id, idempotency_key)
            if existing:
                return WorkflowSubmission(status="duplicate", workflow_id=existing.workflow_id)
        
        # 3. 生成任务并入队
        task = await self.task_factory.create(tenant, workflow_def)
        await self.task_queue.enqueue(
            queue_name=f"workflow.{task.priority}",
            task=task,
        )
        
        # 4. 写入幂等记录
        if idempotency_key:
            await self.idempotency_store.set(tenant.tenant_id, idempotency_key, task.workflow_id)
        
        return WorkflowSubmission(status="accepted", workflow_id=task.workflow_id)
    
    async def resume_workflow(
        self,
        tenant: TenantContext,
        workflow_id: str,
        from_checkpoint: str | None = None,
    ) -> WorkflowSubmission:
        """从检查点恢复 Workflow"""
        ...
```

#### 3.4.2 Worker Pool

```python
class WorkerPool:
    """
    Worker 进程池，按优先级分池
    
    池类型：
    - high_priority:   用户触发的实时 Workflow（最多并发 10）
    - normal_priority: 定时触发的 Workflow（最多并发 20）
    - batch_priority:  批量/后台 Workflow（最多并发 5）
    """
    
    def __init__(self):
        self.pools = {
            "high": ProcessPoolExecutor(max_workers=10),
            "normal": ProcessPoolExecutor(max_workers=20),
            "batch": ProcessPoolExecutor(max_workers=5),
        }
    
    async def dispatch(self, task: WorkflowTask) -> None:
        pool = self.pools[task.priority]
        pool.submit(self._execute_workflow, task)
    
    def _execute_workflow(self, task: WorkflowTask) -> None:
        """在独立进程中执行 Workflow"""
        # 每个 Worker 进程独立运行 LangGraph
        # 不阻塞 API 进程的事件循环
        ...
```

#### 3.4.3 执行模式（保留 v6.0 全部 9 种）

```python
class ExecutionMode(Enum):
    REACT = "react"                    # ReAct 推理-行动循环
    PLAN_EXECUTE = "plan_execute"     # 先规划后执行
    REFLEXION = "reflexion"            # 反思式自我改进
    MULTI_AGENT = "multi_agent"        # 多 Agent 协作
    WORKFLOW = "workflow"             # 硬编码工作流
    REWOO = "rewoo"                   # 无观察推理
    SELF_DISCOVER = "self_discover"   # 自发现推理结构
    AGENT_JUDGE = "agent_judge"       # Agent-裁判双角色
    GRAPH_OF_THOUGHT = "got"           # 图思维推理
```

> 9 种模式的详细设计继承自 v6.0 arch.md，v2.0 新增：模式组合、自动模式推荐、模式降级链。

---

### 3.5 能力层（Capability Layer）

#### 3.5.1 LLM Router（v2.0 新增）

```python
class LLMRouter:
    """
    多 Provider 智能路由
    
    功能：
    1. 多 Key 池化（轮转使用，避免单 Key 限流）
    2. Provider 健康检查（30s 心跳，不可用自动摘除）
    3. 成本优化路由（按 Token 价格选择最廉 Provider）
    4. 故障切换（主 Provider 失败 → 备 Provider → 缓存降级）
    """
    
    def __init__(self):
        self.providers: dict[str, LLMProvider] = {}
        self.key_pool: KeyPool = KeyPool()
        self.health_checker: HealthChecker = HealthChecker(interval=30)
        self.resilience: ResiliencePipeline = ResiliencePipeline()
    
    async def route(self, request: LLMRequest) -> LLMResponse:
        """智能路由 LLM 请求"""
        provider = await self._select_provider(request)
        
        return await self.resilience.execute(
            call_name=f"llm.{provider.name}",
            call_fn=lambda: provider.call(request),
            fallback_fns=[self._fallback_provider_call, self._cache_fallback],
            timeout=30.0,
        )
```

#### 3.5.2 Skill Registry（继承 v6.0 + 安全增强）

```python
class SkillRegistry:
    """
    Skill 注册中心 v2.0
    
    升级：
    1. YAML 安全扫描（禁止 eval/exec/os.system）
    2. Skill 沙箱执行（受限命名空间）
    3. 与模板市场集成（一键安装/更新）
    """
    
    FORMAT_ADAPTERS = {
        "flowforge": FlowForgeAdapter,
        "claude_code": ClaudeCodeAdapter,
        "anthropic": AnthropicSkillAdapter,
        "trae_cn": TraeCNAdapter,
    }
```

---

### 3.6 基础设施层（Infrastructure Layer）

```mermaid
graph TD
    subgraph "基础设施层 v2.0"
        subgraph "数据存储"
            PG_MASTER[(PostgreSQL<br/>主库<br/>读写)]
            PG_REPLICA1[(PostgreSQL<br/>副本1<br/>只读)]
            PG_REPLICA2[(PostgreSQL<br/>副本2<br/>只读)]
            
            PG_MASTER -->|流复制| PG_REPLICA1
            PG_MASTER -->|流复制| PG_REPLICA2
        end
        
        subgraph "缓存与会话"
            REDIS_MAIN[(Redis<br/>缓存/Session)]
            REDIS_QUEUE[(Redis<br/>TaskQueue)]
        end
        
        subgraph "消息队列"
            MQ_HIGH[Redis Stream<br/>高优先级]
            MQ_NORMAL[Redis Stream<br/>标准优先级]
            MQ_BATCH[Redis Stream<br/>批量优先级]
        end
        
        subgraph "文件存储"
            S3[MinIO / S3<br/>Skill文件/模板文件/导出]
        end
    end
    
    API[API Layer] --> PG_MASTER
    API --> REDIS_MAIN
    WORKER[Worker Pool] --> PG_REPLICA1
    WORKER --> REDIS_QUEUE
    WORKER --> MQ_HIGH
    WORKER --> S3
```

---

## 四、多租户架构设计

### 4.1 租户数据模型

```python
# 租户核心模型
class Tenant(BaseModel):
    tenant_id: uuid.UUID          # 全局唯一租户ID
    name: str                     # 租户名称
    slug: str                     # URL 友好的唯一标识
    tier: TenantTier              # FREE / PRO / ENTERPRISE
    status: TenantStatus          # active / suspended / deleted
    config: TenantConfig          # 租户配置
    quotas: QuotaLimits           # 资源配额
    created_at: datetime
    updated_at: datetime

class TenantConfig(BaseModel):
    timezone: str = "Asia/Shanghai"
    language: str = "zh-CN"
    logo_url: str | None = None
    custom_domain: str | None = None  # Enterprise only
    sso_config: SSOConfig | None = None  # Enterprise only
    features: FeatureFlags             # 功能开关

class QuotaLimits(BaseModel):
    max_concurrent_workflows: int
    max_workflows_per_day: int | None   # None = unlimited
    max_llm_tokens_per_month: int | None
    max_skills: int | None
    max_team_members: int | None
```

### 4.2 数据库行级隔离

```sql
-- 所有核心业务表增加 tenant_id 列
ALTER TABLE workflows ADD COLUMN tenant_id UUID NOT NULL;
ALTER TABLE skills ADD COLUMN tenant_id UUID NOT NULL;
ALTER TABLE agents ADD COLUMN tenant_id UUID NOT NULL;
ALTER TABLE api_keys ADD COLUMN tenant_id UUID NOT NULL;
ALTER TABLE audit_logs ADD COLUMN tenant_id UUID NOT NULL;

-- 创建索引以支持 tenant_id 过滤查询
CREATE INDEX idx_workflows_tenant ON workflows(tenant_id);
CREATE INDEX idx_skills_tenant ON skills(tenant_id);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);

-- 启用 Row-Level Security（数据库层强制隔离）
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_workflows ON workflows
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 审计日志：禁止删除，禁止修改 tenant_id
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_readonly ON audit_logs
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
-- 不创建 INSERT/UPDATE/DELETE policy = 应用层通过 Repository 写入
```

### 4.3 租户感知 Repository

```python
class TenantAwareRepository(Generic[T]):
    """
    所有 Repository 的基类，自动注入 tenant_id 过滤条件。
    子类无需手动添加 tenant_id 过滤。
    """
    
    def __init__(self, db: AsyncSession, tenant_context: TenantContext):
        self.db = db
        self.tenant_id = tenant_context.tenant_id
    
    async def find_all(self, **filters) -> list[T]:
        """自动添加 tenant_id 过滤"""
        filters["tenant_id"] = self.tenant_id
        stmt = select(self.model).filter_by(**filters)
        result = await self.db.execute(stmt)
        return result.scalars().all()
    
    async def find_by_id(self, id: uuid.UUID) -> T | None:
        """按 ID 查询，自动验证 tenant_id"""
        stmt = select(self.model).where(
            self.model.id == id,
            self.model.tenant_id == self.tenant_id,
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
    
    async def create(self, entity: T) -> T:
        """创建时自动设置 tenant_id"""
        entity.tenant_id = self.tenant_id
        self.db.add(entity)
        await self.db.commit()
        return entity
```

### 4.4 配额管理器

```python
class QuotaManager:
    """
    租户资源配额管理
    
    职责：
    1. 并发 Workflow 数量限制
    2. 每日 Workflow 提交次数限制
    3. 月度 LLM Token 使用量限制
    4. 配额耗尽时的处理策略
    """
    
    async def check_and_reserve(self, tenant: TenantContext) -> QuotaCheckResult:
        """检查配额并预留资源"""
        checks = []
        
        # 并发 Workflow 限制
        current_concurrent = await self._get_concurrent_count(tenant.tenant_id)
        checks.append(
            QuotaCheck("concurrent_workflows",
                       current_concurrent < tenant.quotas.max_concurrent_workflows,
                       current_concurrent, tenant.quotas.max_concurrent_workflows)
        )
        
        # 每日限制
        today_count = await self._get_today_count(tenant.tenant_id)
        if tenant.quotas.max_workflows_per_day is not None:
            checks.append(
                QuotaCheck("daily_workflows",
                           today_count < tenant.quotas.max_workflows_per_day,
                           today_count, tenant.quotas.max_workflows_per_day)
            )
        
        # Token 限制
        month_tokens = await self._get_month_tokens(tenant.tenant_id)
        if tenant.quotas.max_llm_tokens_per_month is not None:
            checks.append(
                QuotaCheck("monthly_tokens",
                           month_tokens < tenant.quotas.max_llm_tokens_per_month,
                           month_tokens, tenant.quotas.max_llm_tokens_per_month)
            )
        
        # 所有检查通过
        if all(c.passed for c in checks):
            await self._reserve(tenant.tenant_id)
            return QuotaCheckResult(passed=True)
        
        # 如果有未通过的，返回详细失败信息
        return QuotaCheckResult(
            passed=False,
            failed_checks=[c for c in checks if not c.passed],
        )
```

### 4.5 租户计费架构

```mermaid
graph TD
    subgraph "计费系统架构"
        USAGE[用量采集] --> AGG[聚合器<br/>每小时聚合]
        AGG --> STORE[(用量存储<br/>PostgreSQL)]
        
        STORE --> BILL[账单生成<br/>每月1号]
        BILL --> INVOICE[(账单表)]
        
        STORE --> ALERT[配额预警<br/>80%/90%/100%]
        ALERT --> NOTIFY[通知服务]
        NOTIFY --> EMAIL[邮件]
        NOTIFY --> WEBHOOK[Webhook]
        
        STORE --> DASHBOARD[用量面板<br/>租户实时查看]
    end
    
    subgraph "用量指标"
        U1[LLM Token 消耗]
        U2[Workflow 执行次数]
        U3[模板购买]
        U4[存储空间]
    end
    
    U1 --> USAGE
    U2 --> USAGE
    U3 --> USAGE
    U4 --> USAGE
```

---

## 五、模板市场架构

### 5.1 市场架构总览

```mermaid
graph TD
    subgraph "模板市场架构 v2.0"
        subgraph "发布流程"
            AUTHOR[模板作者] -->|"1. 提交"| REVIEW_QUEUE[(审核队列)]
            REVIEW_QUEUE -->|"2. 自动扫描"| SCANNER[安全扫描引擎]
            SCANNER -->|"通过"| HUMAN[人工审核]
            SCANNER -->|"不通过"| REJECT[驳回 + 原因]
            HUMAN -->|"通过"| PUBLISH[发布到市场]
            HUMAN -->|"不通过"| REJECT
        end
        
        subgraph "市场服务"
            PUBLISH --> REGISTRY[(Template Registry<br/>PostgreSQL)]
            REGISTRY --> SEARCH[搜索引擎<br/>全文检索]
            REGISTRY --> BROWSE[浏览API<br/>分类/筛选/排序]
        end
        
        subgraph "消费流程"
            USER[租户用户] -->|"3. 浏览/搜索"| BROWSE
            USER -->|"4. 查看详情"| DETAIL[模板详情]
            USER -->|"5. 一键安装"| INSTALL[安装服务]
            INSTALL -->|"付费模板"| PAYMENT[支付服务]
            INSTALL -->|"免费模板"| WORKSPACE[(租户工作空间)]
            PAYMENT --> WORKSPACE
        end
        
        subgraph "商业化"
            INSTALL --> TRANS[(交易记录)]
            TRANS --> SETTLE[结算引擎<br/>月度结算<br/>15% 平台抽佣]
            SETTLE --> AUTHOR_PAY[作者收益]
        end
    end
```

### 5.2 模板安全扫描引擎

```python
class SecurityScanner:
    """
    模板安全扫描引擎
    
    扫描维度：
    1. 代码注入检测 — YAML 中是否包含危险函数调用
    2. API 泄露检测 — 是否硬编码 API Key/Token
    3. 文件访问检测 — Skill 是否访问越权路径
    4. 网络调用检测 — 是否向未知外部地址发起请求
    5. 依赖安全检测 — Python 包是否有已知 CVE
    """
    
    DANGEROUS_PATTERNS = [
        r'\beval\s*\(',
        r'\bexec\s*\(',
        r'\bos\.system\s*\(',
        r'\bsubprocess\.',
        r'\b__import__\s*\(',
        r'\bcompile\s*\(',
    ]
    
    API_KEY_PATTERNS = [
        r'sk-[a-zA-Z0-9]{20,}',          # OpenAI
        r'sk-ant-[a-zA-Z0-9]{20,}',      # Anthropic
        r'AKIA[0-9A-Z]{16}',             # AWS
    ]
    
    async def scan(self, template: MarketplaceTemplate) -> ScanReport:
        results = ScanReport(
            template_id=template.template_id,
            checks=[],
        )
        
        # 1. 代码注入检测
        yaml_content = template.yaml_definition
        for pattern in self.DANGEROUS_PATTERNS:
            if re.search(pattern, yaml_content):
                results.add(ScanCheck(
                    type="code_injection",
                    severity="CRITICAL",
                    pattern=pattern,
                    message=f"检测到危险函数调用: {pattern}",
                ))
        
        # 2. API Key 泄露检测
        for pattern in self.API_KEY_PATTERNS:
            if re.search(pattern, yaml_content):
                results.add(ScanCheck(
                    type="api_key_leak",
                    severity="CRITICAL",
                    pattern=pattern,
                    message="检测到疑似 API Key 硬编码",
                ))
        
        # 3. 网络调用检测
        urls = re.findall(r'https?://[^\s\'"]+', yaml_content)
        for url in urls:
            if not self._is_known_safe_url(url):
                results.add(ScanCheck(
                    type="network_call",
                    severity="WARNING",
                    detail=url,
                    message=f"检测到未知外部地址: {url}",
                ))
        
        return results
```

### 5.3 模板兼容性管理

```python
class TemplateCompatibilityChecker:
    """
    模板版本兼容性检查
    
    规则：
    1. 语义化版本匹配（^1.0.0, ~1.0.0, >=1.0.0,<2.0.0）
    2. 依赖的 Skill/Agent 版本检查
    3. FlowForge 平台版本检查
    """
    
    async def check_compatibility(
        self,
        template: MarketplaceTemplate,
        target_tenant: TenantContext,
    ) -> CompatibilityReport:
        report = CompatibilityReport(template_id=template.template_id)
        
        # 平台版本检查
        platform_version = await self._get_platform_version()
        if not self._version_in_range(platform_version, template.flowforge_version_range):
            report.add_issue(
                severity="BLOCKING",
                message=f"模板要求 FlowForge {template.flowforge_version_range}，"
                        f"当前平台版本 {platform_version}",
            )
        
        # 依赖检查
        for dep in template.dependencies:
            installed = await self._get_installed_version(target_tenant.tenant_id, dep.name)
            if installed is None:
                report.add_issue(
                    severity="WARNING",
                    message=f"缺少依赖: {dep.name} {dep.version_range}",
                )
            elif not self._version_in_range(installed, dep.version_range):
                report.add_issue(
                    severity="BLOCKING",
                    message=f"依赖版本不匹配: {dep.name} 需要 {dep.version_range}, "
                            f"已安装 {installed}",
                )
        
        return report
```

---

## 六、企业私有部署架构

### 6.1 部署拓扑

```mermaid
graph TD
    subgraph "FlowForge Cloud（控制平面）"
        LS[License Server]
        MP_SYNC[Marketplace Sync]
        UPDATE[Update Server]
        MONITOR[Monitoring<br/>可选遥测]
    end
    
    subgraph "企业客户 A（私有部署）"
        direction TB
        FW_A[防火墙/VPN]
        
        subgraph "应用层"
            API_A[FlowForge API]
            WK_A[Worker Pool]
            UI_A[Web UI]
        end
        
        subgraph "数据层（客户自管）"
            PG_A[(PostgreSQL)]
            REDIS_A[(Redis)]
            MINIO_A[(MinIO)]
        end
        
        subgraph "企业集成"
            SSO_A[LDAP/SAML]
            CI_A[CI/CD]
            AUDIT_A[本地审计日志]
        end
        
        FW_A --> API_A
        API_A --> PG_A
        API_A --> REDIS_A
        WK_A --> PG_A
        WK_A --> REDIS_A
        API_A --> SSO_A
        WK_A --> CI_A
    end
    
    subgraph "企业客户 B（气隙部署）"
        FW_B[防火墙/VPN<br/>完全离线]
        ALL_B[FlowForge 全栈<br/>Docker Compose]
    end
    
    API_A -.->|"HTTPS<br/>心跳+用量(可选)"| LS
    API_A -.->|"HTTPS<br/>模板同步"| MP_SYNC
    API_A -.->|"HTTPS<br/>版本检查"| UPDATE
    
    ALL_B -.->|"离线包<br/>U盘导入"| UPDATE
    ALL_B -.->|"离线包<br/>U盘导入"| MP_SYNC
```

### 6.2 License 管理

```python
class LicenseManager:
    """
    企业 License 管理
    
    流程：
    1. 企业购买 License → 生成 License Key
    2. License Key 在客户侧激活 → 绑定硬件指纹
    3. 定期向 License Server 上报心跳（可选）
    4. 离线容忍 7 天 → 超期功能降级
    5. License 到期 → 功能完全锁定
    """
    
    OFFLINE_TOLERANCE_DAYS = 7
    
    async def activate(self, license_key: str) -> LicenseActivation:
        """激活 License"""
        # 1. 验证 License Key 签名
        if not self._verify_signature(license_key):
            raise InvalidLicenseError("License Key 无效")
        
        # 2. 解析 License 信息
        license_info = self._parse_license(license_key)
        
        # 3. 生成硬件指纹
        hardware_fingerprint = self._generate_hardware_fingerprint()
        
        # 4. 在线激活
        try:
            response = await self._online_activate(license_key, hardware_fingerprint)
            return LicenseActivation(status="activated", method="online", **response)
        except NetworkError:
            # 5. 离线激活（首次激活需要至少一次在线验证）
            if not self._has_prior_online_activation():
                raise LicenseActivationError("首次激活需要网络连接")
            return LicenseActivation(status="activated", method="offline",
                                     offline_until=datetime.now() + timedelta(days=self.OFFLINE_TOLERANCE_DAYS))
    
    async def check_status(self) -> LicenseStatus:
        """检查 License 状态（每次服务启动时调用）"""
        license_info = await self._load_local_license()
        
        # 检查过期
        if license_info.expires_at < datetime.now():
            return LicenseStatus(
                valid=False,
                reason="License 已过期",
                degraded_features=["workflow_execution", "marketplace_access"],
            )
        
        # 离线天数检查
        days_since_last_sync = (datetime.now() - license_info.last_sync).days
        if days_since_last_sync > self.OFFLINE_TOLERANCE_DAYS:
            return LicenseStatus(
                valid=True,
                degraded=True,
                reason=f"已离线 {days_since_last_sync} 天（容忍 {self.OFFLINE_TOLERANCE_DAYS} 天）",
                degraded_features=["marketplace_sync", "update_check"],
            )
        
        return LicenseStatus(valid=True, degraded=False)
    
    def _generate_hardware_fingerprint(self) -> str:
        """生成硬件指纹（MAC + 主板序列号 + CPU ID 的 hash）"""
        components = [
            self._get_mac_address(),
            self._get_motherboard_serial(),
            self._get_cpu_id(),
        ]
        return hashlib.sha256("|".join(components).encode()).hexdigest()
```

### 6.3 企业配置注入

```yaml
# enterprise.yaml — 企业部署配置覆盖
enterprise:
  name: "XX公司"
  license_key: "${LICENSE_KEY}"
  
  branding:
    logo_url: "https://cdn.xx.com/logo.png"
    primary_color: "#1a73e8"
    custom_domain: "ai.xx.com"
  
  sso:
    provider: "ldap"
    ldap:
      server: "ldap://ldap.xx.com:389"
      base_dn: "dc=xx,dc=com"
      user_filter: "(uid={username})"
    # 或 SAML/OIDC
  
  audit:
    local_only: true          # 不上报 FlowForge Cloud
    retention_days: 365       # 本地保留天数
  
  network:
    allow_outbound: false     # 阻断所有出站连接（气隙模式）
    marketplace_sync: false   # 禁用在线模板同步
  
  storage:
    type: "minio"             # 使用企业自建 MinIO
    endpoint: "minio.xx.com:9000"
```

---

## 七、部署拓扑与基础设施

### 7.1 三阶段部署演进

```mermaid
graph TD
    subgraph "Phase 2: Docker Compose 单节点（MVP）"
        direction TB
        P2_HOST[4C8G 服务器<br/>¥200-400/月]
        
        P2_DC["Docker Compose"]
        P2_DC --> P2_API[FlowForge API]
        P2_DC --> P2_WK[Worker x2]
        P2_DC --> P2_PG[PostgreSQL]
        P2_DC --> P2_RD[Redis]
        P2_DC --> P2_CADDY[Caddy<br/>SSL + 反向代理]
        
        P2_STORAGE[本地磁盘<br/>SQLite备份 → PostgreSQL]
        
        P2_CAP["承载能力<br/>10-20 并发 Workflow<br/>1-5 租户<br/>99% 可用性"]
    end
    
    subgraph "Phase 3: Docker Compose 双节点（Beta）"
        direction TB
        P3_A[节点1: 8C16G<br/>¥500-800/月]
        P3_B[节点2: 8C16G<br/>¥500-800/月]
        
        P3_LB[Nginx LB<br/>主备切换]
        
        P3_A --> P3_API[API x2]
        P3_A --> P3_WK[Worker x4]
        P3_B --> P3_PG[(PostgreSQL<br/>主)]
        P3_B --> P3_PGR[(PostgreSQL<br/>副本)]
        P3_A --> P3_RD[Redis]
        P3_B --> P3_PROM[Prometheus+Grafana]
        
        P3_CAP["承载能力<br/>50-100 并发 Workflow<br/>20-50 租户<br/>99.5% 可用性"]
    end
    
    subgraph "Phase 4: K8s 集群（GA）"
        direction TB
        P4_K8S["K8s 集群<br/>min 3 Worker Node<br/>¥3000+/月"]
        
        P4_K8S --> P4_IG[Ingress<br/>Traefik]
        P4_K8S --> P4_API[API Service<br/>HPA min3 max10]
        P4_K8S --> P4_WK[Worker Service<br/>HPA min3 max20]
        P4_K8S --> P4_PG[(PostgreSQL<br/>StatefulSet 主从)]
        P4_K8S --> P4_RD[(Redis Sentinel<br/>HA)]
        P4_K8S --> P4_MQ[RabbitMQ<br/>StatefulSet]
        P4_K8S --> P4_OTE[OpenTelemetry]
        
        P4_CAP["承载能力<br/>500+ 并发 Workflow<br/>500+ 租户<br/>99.9% 可用性"]
    end
    
    P2_HOST -->|"用户 > 50"| P3_A
    P3_A -->|"用户 > 500 或 企业SLA"| P4_K8S
```

### 7.2 Docker Compose v2 配置（Phase 2/3）

```yaml
# docker-compose.v2.yml — FlowForge v2.0 部署配置
version: "3.9"

services:
  # ========== 反向代理 ==========
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      - api

  # ========== FlowForge API ==========
  api:
    build: ./contentforge
    environment:
      - DATABASE_URL=postgresql+asyncpg://flowforge:${DB_PASSWORD}@postgres:5432/flowforge
      - REDIS_URL=redis://redis:6379/0
      - JWT_SECRET=${JWT_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - ENVIRONMENT=production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  # ========== Worker Pool ==========
  worker:
    build: ./contentforge
    command: python -m flowforge.worker
    environment:
      - DATABASE_URL=postgresql+asyncpg://flowforge:${DB_PASSWORD}@postgres:5432/flowforge
      - REDIS_URL=redis://redis:6379/0
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - WORKER_COUNT=4
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2"

  # ========== PostgreSQL ==========
  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=flowforge
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=flowforge
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flowforge"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ========== Redis ==========
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ========== Prometheus + Grafana ==========
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    restart: unless-stopped

  grafana:
    image: grafana/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana
    depends_on:
      - prometheus
    restart: unless-stopped

volumes:
  caddy_data:
  postgres_data:
  redis_data:
  prometheus_data:
  grafana_data:
```

### 7.3 K8s 部署清单（Phase 4）

```
flowforge-k8s/
├── helm/
│   └── flowforge/
│       ├── Chart.yaml
│       ├── values.yaml
│       ├── values-production.yaml
│       └── templates/
│           ├── api-deployment.yaml
│           ├── api-hpa.yaml
│           ├── api-service.yaml
│           ├── worker-deployment.yaml
│           ├── worker-hpa.yaml
│           ├── postgres-statefulset.yaml
│           ├── redis-statefulset.yaml
│           ├── rabbitmq-statefulset.yaml
│           ├── ingress.yaml
│           ├── configmap.yaml
│           ├── secrets.yaml
│           ├── servicemonitor.yaml     # Prometheus Operator
│           └── networkpolicy.yaml
├── argocd/
│   └── application.yaml               # ArgoCD Application
└── terraform/
    ├── main.tf                         # 云资源 (RDS/ElastiCache)
    └── variables.tf
```

---

## 八、安全架构

### 8.1 安全分层模型

```mermaid
graph TD
    subgraph "10 层安全防护 v2.0"
        L1[第1层: 网络隔离<br/>VPC + 安全组 + UFW]
        L2[第2层: TLS 1.3<br/>全链路加密]
        L3[第3层: WAF<br/>Web应用防火墙]
        L4[第4层: API Gateway<br/>认证 + 限流 + CORS]
        L5[第5层: 租户隔离<br/>TenantResolver + RLS]
        L6[第6层: 输入校验<br/>防SQL注入/XSS/CSRF]
        L7[第7层: 密钥管理<br/>AES-256-GCM + 内存解密]
        L8[第8层: 审计日志<br/>不可删除 + 不可篡改]
        L9[第9层: 内容合规<br/>AIGC标识 + 敏感内容过滤]
        L10[第10层: 依赖安全<br/>定期CVE扫描]
    end
    
    L1 --> L2 --> L3 --> L4 --> L5 --> L6 --> L7 --> L8 --> L9 --> L10
```

### 8.2 密钥管理详解

```python
class KeyVault:
    """
    API Key 安全存储
    
    加密方案：
    1. Master Encryption Key (MEK)：从环境变量/KMS 读取，32字节
    2. Data Encryption Key (DEK)：服务启动时从 MEK 派生，存储在内存
    3. API Key：使用 DEK 进行 AES-256-GCM 加密后存入数据库
    4. 加密记录包含：ciphertext + nonce + auth_tag
    
    生命周期：
    - 存储：加密后写入 PostgreSQL
    - 使用：内存解密 → 调用 LLM → 立即从内存清除
    - 轮转：30天自动轮转 DEK，用新 DEK 重新加密所有 Key
    - 撤销：标记为 revoked，即时生效
    """
    
    def encrypt(self, api_key: str) -> EncryptedKey:
        """加密 API Key"""
        nonce = secrets.token_bytes(12)
        cipher = Cipher(algorithms.AES(self.dek), modes.GCM(nonce))
        encryptor = cipher.encryptor()
        ciphertext = encryptor.update(api_key.encode()) + encryptor.finalize()
        
        return EncryptedKey(
            ciphertext=base64.b64encode(ciphertext).decode(),
            nonce=base64.b64encode(nonce).decode(),
            tag=base64.b64encode(encryptor.tag).decode(),
            key_fingerprint=hashlib.sha256(api_key.encode()).hexdigest(),
        )
    
    def decrypt(self, encrypted: EncryptedKey) -> str:
        """解密 API Key（仅在内存中，用完即焚）"""
        nonce = base64.b64decode(encrypted.nonce)
        tag = base64.b64decode(encrypted.tag)
        ciphertext = base64.b64decode(encrypted.ciphertext)
        
        cipher = Cipher(algorithms.AES(self.dek), modes.GCM(nonce, tag))
        decryptor = cipher.decryptor()
        plaintext = decryptor.update(ciphertext) + decryptor.finalize()
        
        return plaintext.decode()
```

---

## 九、数据架构

### 9.1 核心数据表 v2.0

```sql
-- ========== 租户相关 ==========
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    tier VARCHAR(20) NOT NULL DEFAULT 'FREE',   -- FREE / PRO / ENTERPRISE
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active / suspended / deleted
    config JSONB NOT NULL DEFAULT '{}',
    quotas JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ                          -- 软删除
);
CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);

-- ========== 用户相关 ==========
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,         -- bcrypt
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',  -- admin / editor / viewer
    display_name VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- ========== API Key 加密存储 ==========
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    provider VARCHAR(50) NOT NULL,               -- openai / anthropic / deepseek
    label VARCHAR(255),
    encrypted_key JSONB NOT NULL,                -- {ciphertext, nonce, tag, fingerprint}
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active / revoked
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    UNIQUE(tenant_id, provider)                   -- 每个 Provider 一个 Key
);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);

-- ========== Workflow 相关 ==========
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    mode VARCHAR(50) NOT NULL,                   -- react / plan_execute / ...
    status VARCHAR(30) NOT NULL DEFAULT 'draft', -- draft / queued / running / completed / failed / partial_completed
    yaml_definition TEXT NOT NULL,
    input_data JSONB,
    output_data JSONB,
    checkpoints JSONB DEFAULT '[]',              -- [{node_id, timestamp, state_snapshot}]
    idempotency_key VARCHAR(255),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    
    -- 执行指标
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    elapsed_seconds INTEGER,
    tokens_consumed INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    llm_error_count INTEGER DEFAULT 0,
    
    -- AIGC 合规
    aigc_labeled BOOLEAN DEFAULT FALSE,
    content_retained_until TIMESTAMPTZ,          -- ≥6个月
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(tenant_id, idempotency_key)
);
CREATE INDEX idx_workflows_tenant_status ON workflows(tenant_id, status);
CREATE INDEX idx_workflows_tenant_created ON workflows(tenant_id, created_at DESC);

-- ========== 审计日志（不可删除/不可篡改） ==========
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    event_type VARCHAR(50) NOT NULL,             -- workflow.created / key.used / data.exported
    actor_id UUID NOT NULL REFERENCES users(id),
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB NOT NULL,
    ip_address INET,
    trace_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 注意：此表不创建 DELETE/UPDATE 权限的应用角色
-- 只通过 INSERT 写入，不允许删除或修改
CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);

-- ========== 模板市场 ==========
CREATE TABLE marketplace_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,               -- workflow / skill / agent / mcp
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    version VARCHAR(50) NOT NULL,                -- 语义化版本
    flowforge_version_range VARCHAR(50) NOT NULL,
    yaml_definition_encrypted TEXT NOT NULL,      -- 付费模板加密存储
    icon_url TEXT,
    install_count INTEGER DEFAULT 0,
    avg_rating DECIMAL(3,2),
    verified BOOLEAN DEFAULT FALSE,
    security_scan_passed BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending / published / rejected / deprecated
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_marketplace_category ON marketplace_templates(category, status);
CREATE INDEX idx_marketplace_rating ON marketplace_templates(avg_rating DESC);

-- ========== 交易记录 ==========
CREATE TABLE marketplace_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES marketplace_templates(id),
    buyer_tenant_id UUID NOT NULL REFERENCES tenants(id),
    amount DECIMAL(10,2) NOT NULL,
    platform_fee DECIMAL(10,2) NOT NULL,         -- 15% 平台抽佣
    author_earning DECIMAL(10,2) NOT NULL,
    settled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========== 租户模板安装 ==========
CREATE TABLE tenant_installed_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    template_id UUID NOT NULL REFERENCES marketplace_templates(id),
    installed_version VARCHAR(50) NOT NULL,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, template_id)
);

-- ========== 用量统计（计费基础） ==========
CREATE TABLE usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    metric_type VARCHAR(50) NOT NULL,            -- llm_tokens / workflow_exec / storage_bytes
    quantity BIGINT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_usage_tenant_month ON usage_records(tenant_id, recorded_at);
```

### 9.2 数据库 ER 图

```mermaid
erDiagram
    TENANTS ||--o{ USERS : "has members"
    TENANTS ||--o{ API_KEYS : "owns"
    TENANTS ||--o{ WORKFLOWS : "executes"
    TENANTS ||--o{ AUDIT_LOGS : "generates"
    TENANTS ||--o{ USAGE_RECORDS : "consumes"
    TENANTS ||--o{ TENANT_INSTALLED_TEMPLATES : "installs"
    TENANTS ||--o{ MARKETPLACE_TEMPLATES : "publishes"
    
    USERS ||--o{ AUDIT_LOGS : "triggers"
    
    MARKETPLACE_TEMPLATES ||--o{ MARKETPLACE_TRANSACTIONS : "has sales"
    MARKETPLACE_TEMPLATES ||--o{ TENANT_INSTALLED_TEMPLATES : "installed as"
    
    TENANTS {
        uuid id PK
        string name
        string slug UK
        string tier
        string status
        jsonb config
        jsonb quotas
    }
    
    USERS {
        uuid id PK
        uuid tenant_id FK
        string email
        string password_hash
        string role
    }
    
    WORKFLOWS {
        uuid id PK
        uuid tenant_id FK
        string status
        string mode
        text yaml_definition
        jsonb checkpoints
        string idempotency_key UK
    }
    
    API_KEYS {
        uuid id PK
        uuid tenant_id FK
        string provider
        jsonb encrypted_key
        string status
    }
    
    AUDIT_LOGS {
        uuid id PK
        uuid tenant_id FK
        string event_type
        uuid actor_id FK
        jsonb details
    }
    
    MARKETPLACE_TEMPLATES {
        uuid id PK
        uuid author_tenant_id FK
        string category
        decimal price
        string version
        bool verified
    }
    
    MARKETPLACE_TRANSACTIONS {
        uuid id PK
        uuid template_id FK
        uuid buyer_tenant_id FK
        decimal amount
        decimal platform_fee
    }
```

---

## 十、可观测性架构

### 10.1 三支柱：Traces + Metrics + Logs

```mermaid
graph TD
    subgraph "可观测性架构 v2.0"
        subgraph "数据采集"
            OAPI[API Service<br/>OpenTelemetry SDK] --> OTE_COL[OTel Collector]
            OWK[Worker Service<br/>OpenTelemetry SDK] --> OTE_COL
            OGATE[Gateway<br/>OpenTelemetry SDK] --> OTE_COL
        end
        
        subgraph "数据处理"
            OTE_COL -->|Traces| JAEGER[Jaeger<br/>链路追踪]
            OTE_COL -->|Metrics| PROM[Prometheus<br/>指标存储]
            OTE_COL -->|Logs| LOKI[Loki<br/>日志聚合]
        end
        
        subgraph "可视化与告警"
            JAEGER --> JAEGER_UI[Jaeger UI]
            PROM --> GRAFANA[Grafana<br/>统一面板]
            LOKI --> GRAFANA
            PROM --> ALERTMANAGER[AlertManager<br/>告警管理]
            ALERTMANAGER --> EMAIL[邮件]
            ALERTMANAGER --> WEBHOOK[Webhook<br/>钉钉/飞书/Slack]
            ALERTMANAGER --> SMS[短信]
        end
    end
```

### 10.2 核心指标定义

```python
# Prometheus 指标定义
from prometheus_client import Counter, Histogram, Gauge

# Workflow 指标
workflow_submitted_total = Counter(
    "flowforge_workflow_submitted_total",
    "Total number of workflow submissions",
    ["tenant_id", "tier", "mode"],
)

workflow_completed_total = Counter(
    "flowforge_workflow_completed_total",
    "Total number of completed workflows",
    ["tenant_id", "tier", "mode", "status"],
)

workflow_duration_seconds = Histogram(
    "flowforge_workflow_duration_seconds",
    "Workflow execution duration",
    ["tenant_id", "mode"],
    buckets=[10, 30, 60, 120, 300, 600, 1800, 3600],
)

# LLM 调用指标
llm_call_total = Counter(
    "flowforge_llm_call_total",
    "Total LLM API calls",
    ["provider", "model", "status"],  # status: success / error / rate_limited
)

llm_call_duration_seconds = Histogram(
    "flowforge_llm_call_duration_seconds",
    "LLM API call duration",
    ["provider", "model"],
    buckets=[0.5, 1, 2, 5, 10, 20, 30, 60],
)

llm_tokens_consumed_total = Counter(
    "flowforge_llm_tokens_consumed_total",
    "Total LLM tokens consumed",
    ["tenant_id", "provider", "type"],  # type: prompt / completion
)

# 系统健康指标
api_request_duration_seconds = Histogram(
    "flowforge_api_request_duration_seconds",
    "API request duration",
    ["endpoint", "method", "status_code"],
    buckets=[0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
)

active_workflows = Gauge(
    "flowforge_active_workflows",
    "Currently active workflows",
    ["tenant_id"],
)

circuit_breaker_state = Gauge(
    "flowforge_circuit_breaker_state",
    "Circuit breaker state (0=closed, 1=open, 2=half-open)",
    ["circuit_name"],
)
```

### 10.3 关键告警规则

```yaml
# prometheus/rules/alerts.yml
groups:
  - name: flowforge_critical
    rules:
      # P0: Workflow 提交成功率过低
      - alert: WorkflowSubmissionRateLow
        expr: |
          rate(flowforge_workflow_submitted_total{status="error"}[5m])
          / rate(flowforge_workflow_submitted_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Workflow submission error rate > 1%"
          
      # P0: 数据库连接池耗尽
      - alert: DatabaseConnectionPoolExhausted
        expr: flowforge_db_pool_available_connections < 5
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Database connection pool nearly exhausted"
          
      # P1: LLM Provider 全部不可用
      - alert: AllLLMProvidersDown
        expr: |
          count(flowforge_llm_provider_health{status="up"}) == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "All LLM providers are down"
          
      # P1: Redis 不可用
      - alert: RedisDown
        expr: redis_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis is down"
          
      # P1: 熔断器打开
      - alert: CircuitBreakerOpen
        expr: flowforge_circuit_breaker_state == 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Circuit breaker {{ $labels.circuit_name }} is open"
          
      # P2: Worker 队列积压
      - alert: WorkerQueueBacklog
        expr: flowforge_task_queue_length > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Task queue backlog: {{ $value }} tasks"
```

---

> **本架构设计文档基于 spec.md v6.0、arch.md v6.0、design.md v6.0 以及 architect_review.md 审核报告全面升级编写。v2.0 在保留 v6.0 六层架构核心设计的基础上，新增了多租户体系、模板市场、企业私有部署、韧性管道、安全密钥管理和基础设施升级等关键模块，确保 FlowForge 从"单机原型"向"SaaS 平台"的架构跨越具备坚实的技术基础。**