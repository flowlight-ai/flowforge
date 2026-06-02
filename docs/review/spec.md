# FlowForge v7.0 功能特性规格说明书

> **版本**：v7.0（评审修订版）
> **日期**：2026-05-26
> **修订依据**：CEO 业务评审 / 产品专家评审 / 架构师评审 / Agent 开发工程师评审 / 全栈工程师评审
> **定位**：从 Agent 编排框架进化为 **Agent 驾驭层 (Harness Layer)**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统。

***

## 修订摘要

本版本 v7.0 基于 v6.0 五方评审结果进行系统性修订，核心变更如下：

| # | 修订项 | v6.0 状态 | v7.0 变更 |
|---|--------|----------|----------|
| 1 | 商业方向 | 18 个方向同时推进 | 聚焦 1-2 个方向，分阶段推进 |
| 2 | 产品矩阵 | FlowForge/OpenRoute/OpenSieve 三产品独立售卖 | OpenRoute/OpenSieve 作为 FlowForge 内置组件 |
| 3 | 场景数量 | 40 场景蓝图 | 缩减为 15 个已验证场景 |
| 4 | 定价策略 | 无免费层 | 增加免费层，调整定价至中国市场现实 |
| 5 | 收入预测 | Phase 1 ¥21K-55K/月 | 修正为 ¥3K-8K/月 |
| 6 | 用户画像 | 4 类用户跨度大 | 聚焦"技术型创业者"为第一用户 |
| 7 | 安全等级命名 | 代码中不一致 | 统一为 `safe/cautious/dangerous` |
| 8 | 压缩阈值 | 配置与实现不一致 | 统一为 0.92 |
| 9 | BaseModeExecutor 接口 | 各模式接口不统一 | 统一为 `execute(input, ctx) -> Output` |
| 10 | API 文档 | 停留在 v4.0 | 更新至 v7.0，补充缺失端点 |
| 11 | 数据库 | SQLite 单写锁 | Phase B 迁移 PostgreSQL |
| 12 | 多租户 | 零支持 | 行级隔离 + tenant_id |
| 13 | AIGC 合规 | 不存在 | AI 生成标识 + 内容留存 + 敏感过滤 |
| 14 | WorkflowExecutor 模式路由 | 忽略 step mode 字段 | 尊重 mode 字段，用 ModeExecutor 包装 |
| 15 | ContentAuditAgent | 无 judge_model | 注册时传入独立评判模型 |
| 16 | FeedbackLoop | 核心方法为占位符 | 实现完整评估管线 |
| 17 | Swarms 模式 | 未实现 | Phase A 实现基础版 |
| 18 | DI 容器 | 形同虚设 | 使用 FastAPI Depends 重构 |
| 19 | 安全体系 | JWT 可选、无速率限制 | JWT 强制 + 速率限制 + API Key 加密 |
| 20 | 部署 | 单阶段 Docker、无 CI/CD | 多阶段构建 + GitHub Actions CI/CD |
| 21 | 数据库迁移 | 无 Alembic | 引入 Alembic 迁移框架 |
| 22 | 前端状态管理 | useState+localStorage+useRef 混乱 | 引入 Zustand 单一状态源 |

***

## 第一章：产品概述与愿景

### 1.1 产品定位

FlowForge v7.0 是一个**企业级 Agent Harness 平台**，它将前沿的 AI Agent 架构模式（9 大模式）、四根 Harness 护栏（上下文工程、架构约束、反馈循环、熵管理）、多协议工具生态（MCP/OpenAPI/GraphQL）、Skill 系统、多 Agent 策略（Subagents/Teams/Swarms）和 Solo 实时交互融合为一体，为上层业务提供**可控、可观测、可进化的 Agent 运行基础设施**。

### 1.2 核心公式

```
Agent = Model (Brain) + Harness (Body)
FlowForge = Harness Layer = 前馈控制 + 反馈控制 + 熵管理 + 可观测性
```

### 1.3 核心愿景（用户语言版）

v7.0 将技术概念翻译为用户可感知的价值：

| 技术概念 | 用户感知价值 |
|---------|------------|
| Harness 驾驭层 | "AI 会自动检查错误并修正" |
| FeedbackLoop 反馈循环 | "每篇内容都经过质量审核，不达标自动重写" |
| EntropyManager 熵管理 | "系统自动发现并修复问题，越用越聪明" |
| 9 大 Agent 思维模式 | "AI 根据任务自动选择最聪明的工作方式" |
| 上下文工程引擎 | "AI 能记住你之前说过的话，不重复犯错" |
| 架构约束引擎 | "AI 写的代码自动符合规范，不越界" |

### 1.4 用户角色定义

v7.0 重新定义用户角色，按阶段聚焦：

#### 第一用户（Phase A-B）：技术型创业者 / 独立开发者

| 属性 | 描述 |
|------|------|
| **画像** | 有 Python 基础，能配置 API Key，运营 1-3 个自媒体账号 |
| **核心诉求** | 用 AI 批量生产高质量内容，降低日更压力 |
| **使用方式** | CLI + YAML 配置 + Solo 实时交互 |
| **付费意愿** | ¥99-299/月（占月收入 2-5%） |

#### 第二用户（Phase B-C）：中小企业 IT 负责人

| 属性 | 描述 |
|------|------|
| **画像** | 负责企业 AI 工具选型，需要私有部署和团队管理 |
| **核心诉求** | 团队协作、权限管控、成本可控、合规安全 |
| **使用方式** | Web UI + 管理后台 |
| **付费意愿** | ¥999-4999/月 |

#### 第三用户（Phase C+）：非技术业务用户

| 属性 | 描述 |
|------|------|
| **画像** | 内容创作者、运营人员，零编程能力 |
| **核心诉求** | 开箱即用、模板驱动、移动端审核 |
| **使用方式** | Web UI 可视化编辑器 + 移动端审核 |
| **付费意愿** | ¥0-99/月 |

> **铁律**：Phase A-B 不做第三用户的功能开发。每增加一个用户群体，意味着一套全新的产品形态和获客体系。

### 1.5 核心业务场景（15 个已验证场景）

v6.0 的 40 场景中，仅 5 个半可用（12.5% 就绪率）。v7.0 缩减为 15 个场景，按可行性分三级：

#### P0 场景（Phase A，已验证可用）

| # | 场景 | 执行模式 | 多Agent策略 | Harness护栏 | 就绪度 |
|---|------|---------|-----------|-----------|--------|
| 1 | 深度长文创作 | workflow | subagents | 反馈循环+熵管理 | 🟢 90% |
| 2 | 快速帖子生成 | rewoo | - | 架构约束 | 🟢 85% |
| 3 | 热点追踪创作 | multi_agent | subagents | 上下文工程 | 🟡 70% |
| 4 | 多平台分发 | workflow | - | 权限管线 | 🟡 65% |
| 5 | SEO 内容生产 | plan_execute | - | 反馈循环 | 🟡 70% |

#### P1 场景（Phase B，骨架存在需完善）

| # | 场景 | 执行模式 | 多Agent策略 | Harness护栏 | 就绪度 |
|---|------|---------|-----------|-----------|--------|
| 6 | 定时批量创作 | workflow | - | 全部 | 🟡 60% |
| 7 | AI 主编实时协作 | workflow | agent_teams | 上下文工程+反馈循环 | 🟡 55% |
| 8 | 代码审查 | reflexion | agent_teams | 架构约束+反馈循环 | 🟡 50% |
| 9 | 文档维护 | plan_execute | - | 熵管理 | 🟡 55% |
| 10 | 邮件营销 | plan_execute | - | 权限管线 | 🟡 45% |

#### P2 场景（Phase C，需新开发）

| # | 场景 | 执行模式 | 多Agent策略 | Harness护栏 | 就绪度 |
|---|------|---------|-----------|-----------|--------|
| 11 | AI 客服 | react | - | 反馈循环+权限管线 | 🔴 20% |
| 12 | 竞品监控 | plan_execute | - | 上下文工程 | 🔴 15% |
| 13 | 智能记账 | plan_execute | - | 架构约束 | 🔴 10% |
| 14 | 需求管理 | plan_execute | agent_teams | 反馈循环 | 🔴 10% |
| 15 | 数据分析报告 | reflexion | subagents | 反馈循环+熵管理 | 🔴 15% |

> **铁律**：P2 场景在 P0/P1 全部达到 🟢 之前，不投入开发资源。

***

## 第二章：分阶段实施策略

### 2.1 三阶段路线图

v7.0 将 v6.0 的"同时铺开"策略改为"先稳后扩"策略：

```
Phase A（第1-8周）：稳定核心
  → 修复技术债 + 实现核心功能 + 3个免费标杆案例

Phase B（第9-20周）：商业化单一方向
  → AI 内容批量化 SaaS + 首批付费客户 + 月收入 ¥10K+

Phase C（第21周起）：扩展
  → 第二方向验证 + 模板市场 + 企业私有部署
```

### 2.2 Phase A：稳定核心（第 1-8 周）

#### 目标

- 0 个阻塞级 Bug
- 核心功能（Workflow + Reflexion + Agent-Judge）在 Solo 和 API 两种模式下可运行
- 3 个免费标杆案例的效果数据报告
- 生产就绪度从 3/10 提升到 6/10

#### 任务清单

| # | 任务 | 优先级 | 预估工时 | 依赖 |
|---|------|--------|---------|------|
| A1 | 修复 WorkflowExecutor 模式路由（B3 Bug） | P0 | 6h | 无 |
| A2 | 修复 ContentAuditAgent judge_model 注册 | P0 | 1h | 无 |
| A3 | 修复 parallel_group 数据竞争（B2 Bug） | P0 | 2h | 无 |
| A4 | 修复 conftest Mock LLM 隔离（B4 Bug） | P0 | 2h | 无 |
| A5 | 统一安全等级命名为 `safe/cautious/dangerous` | P0 | 4h | 无 |
| A6 | 统一压缩阈值为 0.92 | P0 | 2h | 无 |
| A7 | 统一 BaseModeExecutor 接口 | P0 | 8h | A1 |
| A8 | 实现 FeedbackLoop 核心方法 | P0 | 16h | A7 |
| A9 | 实现 Swarms 模式基础版 | P1 | 12h | A7 |
| A10 | DefaultLLMActor/Evaluator 增加 model_override | P0 | 4h | 无 |
| A11 | Solo _infer_steps 与 YAML 对齐 | P1 | 4h | 无 |
| A12 | DI 容器重构（FastAPI Depends） | P1 | 16h | 无 |
| A13 | 安全加固：JWT 强制 + 密码哈希 + secret_key 检查 | P0 | 16h | 无 |
| A14 | API 速率限制（slowapi） | P0 | 4h | A13 |
| A15 | API Key 加密存储（AES-256-GCM） | P0 | 8h | 无 |
| A16 | 引入 Alembic 数据库迁移 | P0 | 8h | 无 |
| A17 | Dockerfile 多阶段构建 + .dockerignore | P0 | 4h | 无 |
| A18 | GitHub Actions CI 流水线 | P1 | 8h | A17 |
| A19 | 补全缺失 API 端点 | P1 | 16h | A12 |
| A20 | API 文档更新至 v7.0 | P1 | 8h | A19 |
| A21 | AIGC 合规：AI 生成标识 + 内容留存 | P0 | 8h | 无 |
| A22 | 敏感内容过滤 | P0 | 8h | 无 |
| A23 | 前端 XSS 修复（react-markdown 替换） | P0 | 2h | 无 |
| A24 | 前端状态管理（Zustand） | P1 | 12h | 无 |

#### 里程碑

| 周次 | 里程碑 | 验收标准 |
|------|--------|---------|
| 第 2 周 | 核心技术债清零 | B1-B4 Bug 全部修复，所有 E2E 测试通过 |
| 第 4 周 | 安全与合规基线 | JWT 强制 + 速率限制 + AIGC 标识 + 敏感过滤 |
| 第 6 周 | 功能补全 | FeedbackLoop + Swarms + 缺失 API 端点 |
| 第 8 周 | 生产就绪 | 3 个免费标杆案例运行 7 天无 P0 故障 |

### 2.3 Phase B：商业化单一方向（第 9-20 周）

#### 目标

- AI 内容批量化 SaaS 上线
- 月收入 ¥10,000+
- 付费客户 10+
- 生产就绪度 7/10

#### 任务清单

| # | 任务 | 优先级 | 预估工时 |
|---|------|--------|---------|
| B1 | SQLite → PostgreSQL 迁移 | P0 | 3d |
| B2 | 多租户支持（行级隔离 + tenant_id） | P0 | 5d |
| B3 | 资源配额管理（per-tenant 限制） | P0 | 3d |
| B4 | 计费与账单系统 | P1 | 5d |
| B5 | 模板市场 MVP | P1 | 5d |
| B6 | Workflow 可视化编辑器 | P1 | 10d |
| B7 | Docker Compose 完整化（8 services） | P0 | 2d |
| B8 | 结构化日志（structlog） | P1 | 2d |
| B9 | Prometheus + Grafana 监控 | P1 | 3d |
| B10 | 前端 E2E 测试（Playwright） | P1 | 5d |
| B11 | OpenRoute 作为内置组件 | P1 | 5d |
| B12 | OpenSieve 作为内置组件 | P1 | 5d |
| B13 | P1 场景实现（6-10号） | P1 | 15d |
| B14 | 算法备案元数据管理 | P1 | 2d |
| B15 | 等保二级基础合规 | P1 | 5d |

#### 收入预测（修正版）

| 阶段 | v6.0 预测 | v7.0 修正 | 修正依据 |
|------|----------|----------|---------|
| Phase B 第 1 月 | ¥21K-55K | ¥3K-8K | 冷启动获客周期 4-8 周 |
| Phase B 第 3 月 | ¥31K-90K | ¥8K-25K | 试用转化率 5-15% |
| Phase B 第 6 月 | ¥66K-270K | ¥15K-50K | 需 5-10 个持续付费客户 |

> **止损线**：Phase B 第 4 个月若无付费客户，则调整方向。

### 2.4 Phase C：扩展（第 21 周起）

#### 目标

- 第二方向 PMF 验证
- 月收入 ¥50,000+
- 生产就绪度 8/10

#### 任务清单

| # | 任务 | 优先级 |
|---|------|--------|
| C1 | K8s 迁移（Helm Chart + ArgoCD） | P2 |
| C2 | PostgreSQL 主从 + 读写分离 | P2 |
| C3 | OpenTelemetry 全链路追踪 | P2 |
| C4 | 企业 SSO（LDAP/SAML/OIDC） | P2 |
| C5 | 企业气隙部署支持 | P2 |
| C6 | 模板安全扫描引擎 | P2 |
| C7 | P2 场景实现（11-15号） | P2 |
| C8 | 移动端审核 | P2 |
| C9 | i18n 国际化 | P2 |
| C10 | a11y 无障碍 | P2 |

***

## 第三章：系统架构总览

### 3.1 六层架构模型

FlowForge v7.0 采用分层解耦的 Harness 架构，整体分为六层：

```
┌─────────────────────────────────────────────────────────────────────┐
│  6. 应用层 (Application Layer)                                      │
│     ContentForge / 其他业务系统                                      │
├─────────────────────────────────────────────────────────────────────┤
│  5. 接入层 (Gateway Layer)                                          │
│     FastAPI REST API + WebSocket (Solo/Events) + Web UI + CLI       │
│     [v7.0 新增] JWT 强制认证 + 速率限制 + 租户解析中间件              │
├─────────────────────────────────────────────────────────────────────┤
│  4. Harness 驾驭层 (Harness Layer) ★ v7.0 核心                      │
│     上下文工程 | 架构约束 | 反馈循环 | 熵管理 | 权限管线 | 会话管理  │
│     [v7.0 新增] AIGC 合规检查 + 敏感内容过滤                         │
├─────────────────────────────────────────────────────────────────────┤
│  3. 执行引擎层 (Engine Layer)                                       │
│     HybridExecutor (TAOR循环) | ModeRegistry (9大模式) | Scheduler  │
│     [v7.0 修复] WorkflowExecutor 尊重 mode 字段                      │
│     [v7.0 新增] 统一 BaseModeExecutor 接口                          │
├─────────────────────────────────────────────────────────────────────┤
│  2. 能力层 (Capability Layer)                                       │
│     Tool生态 (MCP/OpenAPI/GraphQL) | Skill系统 | Agent库 | Memory   │
│     [v7.0 新增] OpenRoute 内置组件 | OpenSieve 内置组件              │
│     [v7.0 修复] 安全等级统一命名 | API Key 加密存储                   │
├─────────────────────────────────────────────────────────────────────┤
│  1. 基础设施层 (Infrastructure Layer)                               │
│     SQLite(Phase A) → PostgreSQL(Phase B) | Redis | LLM API        │
│     [v7.0 新增] Alembic 迁移 | 多租户行级隔离                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 控制回路设计

```
                 ┌─────────────────┐
                 │  前馈控制        │
                 │  · AGENTS.md    │
                 │  · Skill 注入   │
                 │  · Linter 规则  │
                 │  · 权限管线     │
                 │  · AIGC 合规    │  ← v7.0 新增
                 └────────┬────────┘
                          │
                          ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  用户需求    │ → │ Agent 执行  │ → │   输出      │ → │  验证工具   │
│  自然语言    │   │ (9大模式)   │   │ (代码/文章) │   │ (测试/审查) │
└─────────────┘   └─────────────┘   └─────────────┘   └──────┬──────┘
                                                             │
                                                             │ 失败
                                                             ▼
                 ┌─────────────────┐   ┌─────────────────┐
                 │  反馈控制        │ ← │  熵管理         │
                 │  · 独立评判Agent│   │  · 文档园丁     │
                 │  · 四维评分     │   │  · 技术债回收   │
                 │  · 自修正循环   │   │  · 规则进化     │
                 └─────────────────┘   └─────────────────┘
```

### 3.3 Harness Hook 点设计

Harness 层通过 2 个统一入口介入 Agent 执行流程：

```python
# HybridExecutor.run() 中的 Hook 点
if ctx.harness_enabled:
    await self.harness.pre_execute(ctx)      # context.inject() + entropy.check() + aigc.pre_check()

result = await agent.execute_with_context(input, ctx)

if ctx.harness_enabled:
    result = await self.harness.post_execute(result, ctx)  # constraints.validate() + feedback.evaluate() + aigc.label()
```

- **pre_execute**：上下文工程注入 + 熵管理轻量检查 + AIGC 合规前置检查
- **post_execute**：架构约束验证 + 反馈循环评估 + AIGC 标识标记

***

## 第四章：核心功能需求

### 4.1 执行引擎 (Engine Layer)

**FR-ENG-01：HybridExecutor 混合执行器** [P0]

- TAOR 循环（Think-Act-Observe-Repeat）
- Persona 锁：同一 persona 同一时间只允许一个任务运行
- `_is_substep` 参数：Workflow 子步骤跳过锁检查
- 错误处理：支持 `abort/skip/retry/reflexion_retry` 四种策略
- **[v7.0 新增]** 重试策略：指数退避（1s→2s→4s→8s），最大 3 次
- **[v7.0 新增]** 模式降级：Plan-Execute 失败 → ReAct fallback
- **[v7.0 新增]** 部分成功：支持 `partial_completed` 状态 + 手动干预
- **[v7.0 新增]** 幂等性：同一请求重试不产生副作用（幂等 Key + 去重）

**FR-ENG-02：ModeRegistry 模式注册中心** [P0]

- 注册/获取/推荐模式
- 基于任务描述的智能模式推荐
- **[v7.0 新增]** 模式降级链配置：`plan_execute → react → direct`

**FR-ENG-03：9 大内置 Agent 模式** [P0]

| 模式 | 核心机制 | 适用场景 | v7.0 状态 |
|------|---------|---------|----------|
| `react` | Thought → Action → Observation 循环 | 多步动态检索或工具调用 | ✅ 可用 |
| `plan_execute` | Planner 生成步骤清单，Executor 依次执行 | 路径明确、步骤可预测的任务 | ✅ 可用 |
| `reflexion` | Actor → Evaluator → Reflector 三 Agent 迭代 | 需要反复打磨的任务 | ✅ 可用（修复 B3 后） |
| `multi_agent` | Subagents/Teams/Swarms 三种子策略 | 需要多角色配合的复杂任务 | ✅ 可用（修复 B3 后） |
| `workflow` | 预定义 DAG 流程，可混合其他模式 | 长流程、端到端业务流水线 | ✅ 可用 |
| `rewoo` | 一次性规划所有工具调用，批量执行 | 确定性多 API 调用 | ✅ 可用（修复 B3 后） |
| `self_discover` | 任务前自动发现最佳推理结构 | 不确定领域 | ✅ 可用（修复 B3 后） |
| `agent_judge` | 独立 Agent 作为评判者 | 无外部评分标准的任务 | ✅ 可用（修复 B3 后） |
| `graph_of_thoughts` | 图式推理，多思路聚合 | 复杂推理 | ✅ 可用（修复 B3 后） |

> **[v7.0 修复]** WorkflowExecutor 必须尊重步骤的 `mode` 字段。当步骤同时指定 `agent` 和 `mode` 时，使用 ModeExecutor 包装 Agent 执行，而非直接调用 `agent.execute_with_context()`。

**FR-ENG-04：统一 BaseModeExecutor 接口** [P0]

所有模式执行器必须实现统一接口：

```python
class BaseModeExecutor(ABC):
    @abstractmethod
    async def execute(self, input: AgentInput, ctx: TaskContext) -> AgentOutput:
        """统一的执行入口"""
        ...

    @abstractmethod
    def get_mode_name(self) -> str:
        """返回模式名称"""
        ...
```

**[v7.0 修复]** 消除各模式执行器接口不一致的问题：
- `DefaultLLMActor` 和 `Evaluator` 增加 `model_override` 参数
- `SoloModeExecutor._infer_steps` 与 YAML 定义对齐
- 所有 ModeExecutor 的 `execute()` 签名统一

**FR-ENG-05：TaskScheduler 定时调度** [P1]

- 基于 APScheduler + SQLAlchemy job store
- 支持动态添加/删除/暂停/恢复 Cron 任务
- 任务恢复（重启后从 job store 恢复）

**FR-ENG-06：三层防御机制** [P0]

- L1 超时防御：`ToolRegistry.execute()` 中单次工具调用超时
- L2 重复检测：`BaseModeExecutor._on_exit()` 钩子检测重复输出
- L3 自修正：`WorkflowExecutor` 的 `on_error: "reflexion_retry"` 策略

**FR-ENG-07：轨迹记录与评估管线** [P1]

- 记录 Agent 执行全过程的工具调用轨迹、决策点、状态变更
- 每个任务生成一个 Episode（轨迹 + 验证结果）
- 支持基于分类闸门的自动质量判定（Pass/Fail）
- 持久化到 CheckpointManager，供后续分析和 Skill 进化使用
- 定位：轨迹记录管线，不涉及模型训练

### 4.2 Harness 驾驭层 (Harness Layer)

**FR-HRN-01：上下文工程引擎 (ContextEngine)** [P0]

- AGENTS.md 动态知识注入：按任务域（domain）检索相关规则
- 历史失败案例检索：从知识库中检索同类任务的历史教训
- 会话交接物构建：`init_script + progress_log + feature_checklist`
- 按需上下文注入：只在 Agent 需要时注入，不污染上下文窗口
- **[v7.0 新增]** Token 预算强制约束：当 token 使用量达到预算上限时截断

**FR-HRN-02：架构约束引擎 (ArchitectureConstraintEngine)** [P0]

- 分层依赖模型（Types → Config → Repo → Service → Runtime → UI）
- 自定义 Linter 规则库（可扩展）
- CI 门禁：违反约束则阻断
- 违规信息自动注入 Agent 上下文（让 Agent 自我修复）
- 依赖提取：使用 Python `ast` 模块解析 import 语句，配合 `config/layer_mapping.yaml` 配置化模块→层映射
- **[v7.0 新增]** 约束违规自动熔断：连续 3 次违规则暂停执行，通知用户
- Phase 1 仅支持 Python 语言依赖提取

**FR-HRN-03：反馈循环引擎 (FeedbackLoop)** [P0]

- 定位：所有 Agent 输出的**外部质量闸门**，独立于任何模式
- 与 Reflexion 模式的关系：**内环+外环**双层架构
  - 内环（Reflexion 模式）：快速 Actor→Evaluator→Reflector 循环
  - 外环（FeedbackLoop）：四维评分 + 分类闸门，全局生效
- 串行关系：Reflexion 内环先跑完（最多 3 轮），然后交给 FeedbackLoop 外环做一次终审。如果外环 FAIL，直接降级（返回最佳结果 + 质量警告）
- 生成与评判分离：独立的 Evaluator Agent 评判 Generator Agent 的产出
- 四维评分体系：Design Quality / Originality / Craft / Functionality
- 分类闸门：只看工具执行结果，忽略模型自我评价
- evaluation_mode 三档配置：
  - `full`：四维评分 + 分类闸门（2 次 LLM 调用）
  - `lightweight`：仅分类闸门（1 次 LLM 调用，默认）
  - `skip`：跳过外环（内环 Reflexion 仍生效）

**[v7.0 修复]** FeedbackLoop 核心方法必须实现，不允许占位符：

```python
class FeedbackLoop:
    async def evaluate(self, output: AgentOutput, ctx: TaskContext) -> FeedbackResult:
        """完整评估管线：四维评分 + 分类闸门"""
        ...

    async def evaluate_lightweight(self, output: AgentOutput, ctx: TaskContext) -> FeedbackResult:
        """轻量评估：仅分类闸门"""
        ...

    def should_retry(self, result: FeedbackResult, iteration: int, max_iterations: int) -> bool:
        """判断是否需要重试"""
        ...
```

**FR-HRN-04：熵管理引擎 (EntropyManager)** [P1]

- 文档园丁 Agent：后台定时扫描文档-代码不一致，自动提交修复 PR
- 技术债跟踪器：优先级排序 + 持续小额偿还
- 规则进化器：每次 Agent 失败转化为一条工程规则
- 垃圾回收调度：Cron 定时任务自动触发
- 定位：**内置核心能力**，不走插件市场
- **[v7.0 修正]** 熵值度量采用可操作方案：
  - 环路率：统计 ReAct 循环中重复 Action 的比例
  - 工具失败率：统计当前任务中工具调用失败的比例
  - 上下文膨胀率：`current_tokens / initial_tokens` 的增长速率
  - 综合熵值 = `0.4 * 环路率 + 0.3 * 工具失败率 + 0.3 * 上下文膨胀率`
  - 阈值 0.8 触发干预（基于实验校准，Phase A 需收集基线数据）

**FR-HRN-05：权限管线 (PermissionPipeline)** [P0]

- deny → ask → allow 三层管线（deny 永远胜出）
- 四级动作分级：Read / Suggest / Prepare / Execute
- 低风险操作 Auto Mode 静默通过
- 高风险操作必须人工确认

**FR-HRN-06：会话管理器 (SessionManager)** [P0]

- **[v7.0 修复]** 压缩阈值统一为 0.92：当 token 使用量达到模型上下文窗口 92% 时自动压缩
- 计算方式：`utilization = total_tokens / model_context_window`
- 模型上下文窗口从 LLM 配置文件读取，默认 128K
- 保留最近 N 轮完整对话（默认 3，可配置）+ 压缩早期历史为摘要
- 工具输出 Token 截断（默认 25000 tokens）
- 会话交接：检查点保存 + 交接物传递

**FR-HRN-07：AIGC 合规引擎** [P0] ← v7.0 新增

- **AI 生成标识**：所有 AI 生成内容标记 `🤖 AI Generated` + 元数据水印（模型名称、生成时间、任务 ID）
- **内容留存**：输入+输出日志留存 ≥6 个月，不可删除，存储于 `aigc_logs` 表
- **敏感内容过滤**：输入和输出两端敏感词检测 + 正则匹配 + 外部审核 API 可选集成
- **算法备案支撑**：算法名称/原理/应用场景的元数据管理系统
- **个保法合规**：隐私政策 + 用户同意管理 + 数据删除 + 数据导出

### 4.3 能力层 (Capability Layer)

**FR-CAP-01：Tool 生态** [P0]

- 内置 12+ 工具：LLM Client、文件读写、Shell 执行、网络搜索、HelixRAG、Python 沙箱、Git 操作、图片搜索、邮件发送、Webhook、TaskBoard 操作
- 协议适配器：MCP / OpenAPI / GraphQL 三种协议自动转换为 Tool
- 门控工具管线：权限检查 → 安全分类 → 执行 → 输出校验
- **[v7.0 修复]** 安全标记统一命名：`safety_level` 属性取值为 `safe / cautious / dangerous`
- `is_concurrency_safe` 属性保持不变
- 工具输出 Schema 校验

**FR-CAP-02：Skill 系统** [P1]

- 跨格式兼容：原生支持 FlowForge / Claude Code / Anthropic / Trae CN 四种 Skill 格式
- OpenHarness 格式标注为 Roadmap，当前不实现
- 双层加载：全局 Skill（~/.flowforge/skills/）+ 项目 Skill（./.flowforge/skills/）
- Skill 组合技（Combo Skills）：多 Skill 管道编排
- 触发器匹配：自然语言触发词自动匹配并激活 Skill，支持置信度评分 + 上下文增强
- Skill 版本管理：语义化版本 + 依赖管理 + 变更记录
- Skill 的加载由 `skills/registry.py` 独立管理，不走 `plugins/plugin_manager.py`

**FR-CAP-03：MCP 模块** [P1]

- L1 MCP Client：JSON-RPC 2.0 客户端 + stdio / Streamable HTTP 双传输
- L2 MCP Gateway：工具白名单 + Token 预算管理 + 速率限制 + 权限管线集成
- L3 MCP Broker：多服务器聚合 + 动态路由 + 熔断/重试 + 工具名→服务器索引
- L4 MCP Tool Adapter：自动转换为 FlowForge BaseTool + 流式执行支持
- 工具发现缓存（5 分钟 TTL）

**FR-CAP-04：通用 Agent 库** [P0]

- 内容创作类 12 个：TopicResearch、MaterialCollection、ArticleWriting、SEOOptimization、FactCheck、ContentAudit、HeadlineOptimizer、ContentRepurposer、TrendAnalysis、Publishing、ImageResearch、Multilingual
- 代码工具类 8 个：CodeReview、TaskDecomposition、MetaPlanner、Debate、DataAnalysis、PromptOptimizer、TestGeneration、Documentation
- **[v7.0 修复]** ContentAuditAgent 注册时必须传入 `judge_model` 参数，确保执行模型和评判模型分离
- 每个 Agent 标注验证状态：✅ 已验证 / 🔄 设计中 / 📅 待验证

**FR-CAP-05：Memory 系统** [P0]

- 5 种记忆策略：Working / Short-term / Long-term / Semantic / Episodic
- TaskBoard：多 Agent 共享任务板，RETURNING 子句原子认领
- Mailbox：Agent 间通信信箱，支持优先级 + 过滤 + 过期清理
- CheckpointManager：增量保存 + 恢复 + 版本管理
- ContextCompressor：tiktoken + 滑动窗口 + **0.92 阈值触发**（统一值）

**FR-CAP-06：通用 Workflow 库** [P0]

- 15+ 预置 YAML 模板：DeepArticle、QuickPost、TrendArticle、MultiPlatform、SEOContent、ImageArticle、Multilingual、ReportGeneration、DefenseArticle 等
- 每个 Workflow 步骤可指定独立的执行模式
- 支持 `defense` 全局配置（三层防御参数）
- 支持 `human: true` 审核节点
- **[v7.0 修复]** `parallel_group` 步骤中的数据竞争：为并行任务创建独立的 EventBus 代理或加锁

**FR-CAP-07：OpenRoute 内置组件** [P1] ← v7.0 新增

- 定位：FlowForge 的内置模型网关组件，**不独立售卖**
- 功能：多模型智能路由 + 成本优化 + 故障切换 + 速率限制
- 为 FlowForge 提供模型调度能力，高级功能（如成本优化路由）作为付费版增值卖点
- 不建立独立的获客体系和定价体系

**FR-CAP-08：OpenSieve 内置组件** [P1] ← v7.0 新增

- 定位：FlowForge 的内置聚合检索组件，**不独立售卖**
- 功能：多源搜索 + 素材下载 + 版权筛选
- 为 FlowForge 提供知识增强能力，高级功能（如版权筛选）作为付费版增值卖点
- 不建立独立的获客体系和定价体系

### 4.4 多 Agent 策略 (Multi-Agent Strategies)

**FR-MAS-01：Subagents 策略** [P0]

- 完全上下文隔离：每个子 Agent 独立上下文窗口（空状态，无历史污染）
- 并行执行：所有子任务并发处理
- 工具过滤：只暴露子任务需要的最小工具集
- 结果压缩：子 Agent 返回压缩摘要，避免污染父 Agent 上下文
- 令牌预算约束：每个子 Agent 独立令牌预算（默认 50000 tokens）

**FR-MAS-02：Agent Teams 策略** [P0]

- Lead Agent 作为项目经理，维护 TaskBoard 和 Mailbox
- 多 Team Agent 从共享任务板认领任务
- Agent 间通过 Mailbox 通信（支持优先级、标签、过期）
- 三层防御：空闲轮次检测 + 重复结果检测 + 超时任务重发布
- Lead Agent 监控全局状态，处理冲突和死循环

**FR-MAS-03：Swarms 策略** [P1]

- 去中心化集群：无固定 Leader，通过共享任务队列协作
- 心跳机制：每个 Worker 定期报告存活状态
- 失败节点自动恢复：失联 Worker 的任务自动重发布
- 乐观并发控制 + 分布式锁
- **[v7.0 修复]** Phase A 必须实现基础版 Swarms（心跳 + 任务认领 + 失败恢复），不允许仅停留在设计文档

### 4.5 Solo 实时交互 (Solo Mode)

**FR-SOL-01：实时执行流** [P0]

- 17 种 FlowForge 事件 → 16 种 Solo 事件类型全映射
- WebSocket 专用通道 `/ws/solo/{task_id}`
- 事件序号 + 断线重连 + 历史回放

**FR-SOL-02：Solo 三栏布局** [P1]

- 左栏：执行流（虚拟滚动，支持 500+ 条事件）
- 中栏：工具调用/LLM 思考详情面板（可展开/折叠）
- 右栏：Markdown 编辑器（编辑/预览/分屏三种模式）

**FR-SOL-03：审核节点内联** [P0]

- 审核操作直接嵌入执行流，不跳转到独立页面
- 支持审核通过/驳回/编辑提交
- 审核窗口期 5 分钟内可撤回

**FR-SOL-04：任务控制** [P1]

- 暂停/恢复/跳过当前节点
- 实时 Token 统计和费用预估

### 4.6 插件与扩展 (Plugin System)

**FR-PLG-01：三层插件架构** [P1]

- Mode 插件：注册新的执行模式
- Agent 插件：注册新的通用 Agent
- Tool 插件：注册新的工具（含 MCP 协议接入）

**FR-PLG-02：插件发现机制** [P1]

- Python `entry_points` 标准机制
- YAML 配置文件扫描
- 加载失败的插件不影响系统启动

**FR-PLG-03：插件市场** [P2]

- 内部市场：团队共享 Agent/Workflow/Skill
- 公共市场：开源插件分发
- 插件版本管理 + 依赖检查
- Skill 的加载由 `skills/registry.py` 独立管理，不走 `plugins/plugin_manager.py`

### 4.7 可观测性 (Observability)

**FR-OBS-01：全链路追踪** [P1]

- 每个任务生成唯一 `trace_id`
- 注入到所有 Agent 调用和 LLM 请求
- **[v7.0 修复]** trace_id 必须贯穿全链路，包括 WebSocket 端点和后台任务

**FR-OBS-02：Prometheus 指标** [P0]

| 指标名 | 类型 | 描述 | 优先级 |
|--------|------|------|--------|
| `flowforge_tasks_total{mode, status}` | counter | 任务创建总数 | P0 |
| `flowforge_execution_duration_seconds` | histogram | 任务执行耗时 | P0 |
| `flowforge_token_usage_total{model, provider}` | counter | Token 消耗 | P0 |
| `flowforge_tool_calls_total{tool_name, status}` | counter | 工具调用次数 | P0 |
| `flowforge_persona_running{persona}` | gauge | 当前各专栏运行任务数 | P0 |
| `flowforge_websocket_connections` | gauge | WebSocket 连接数 | P1 |
| `flowforge_llm_api_latency_seconds{provider}` | histogram | LLM API 延迟 | P1 |
| `flowforge_error_rate{type}` | gauge | 错误率 | P1 |

**[v7.0 修复]** 使用 `prometheus_client` 原生类型（Counter、Histogram、Gauge），替代自定义字典。

**FR-OBS-03：审计日志** [P0]

- 所有 Agent、Tool 调用均记录在 audit_logs 表中
- 包含输入参数、输出、trace_id、耗时
- 敏感信息脱敏（API Key 仅记录 SHA256 指纹）
- **[v7.0 新增]** AIGC 生成内容日志独立存储于 `aigc_logs` 表，留存 ≥6 个月

**FR-OBS-04：WebSocket 实时推送** [P0]

- 通用事件通道 `/ws/events`
- Solo 专用通道 `/ws/solo/{task_id}`
- 支持断线重连和事件回放
- **[v7.0 修复]** 全局事件流使用 `asyncio.Queue` 替代 `list + pop(0)`，实现 `unsubscribe` 逻辑

**FR-OBS-05：结构化日志** [P1] ← v7.0 新增

- 使用 `structlog` 替代手写 TraceLogger
- 支持 JSON 格式输出 + 自动 trace_id 注入 + 上下文字段
- 统一日志级别，消除 `print()` 调用

### 4.8 安全体系 (Security)

**FR-SEC-01：Fail-closed 工具安全** [P0]

- 所有工具继承 `BaseTool.safety_level` 属性
- **[v7.0 修复]** safety_level 取值统一为 `safe / cautious / dangerous`
- 危险工具默认需要审批
- 只读工具可直接执行

**FR-SEC-02：代码沙箱** [P1]

- 进程级隔离 + 资源限制
- 移除危险内置函数
- 文件系统路径穿越防护
- 跨平台兼容（Linux/Windows）

**FR-SEC-03：并发安全** [P0]

- Persona 锁：同一专栏互斥
- TaskBoard 原子认领（RETURNING 子句 + 应用层锁）
- 非并发安全工具自动加锁

**FR-SEC-04：JWT 强制认证** [P0] ← v7.0 新增

- 所有写操作端点强制 JWT 认证
- 密码使用 `passlib[bcrypt]` 哈希存储，禁止明文
- `SECRET_KEY` 启动时强制检查：若为默认值 `changeme-in-production` 则拒绝启动
- 实现 `get_current_user()` FastAPI 依赖
- 实现 `require_role("admin")` 装饰器，保护管理端点

**FR-SEC-05：API 速率限制** [P0] ← v7.0 新增

- 使用 `slowapi` 中间件
- `POST /api/v1/tasks`：10 次/分钟
- `POST /api/v1/auth/login`：5 次/分钟
- 其他写操作：30 次/分钟
- 读取操作：100 次/分钟

**FR-SEC-06：API Key 加密存储** [P0] ← v7.0 新增

- 存储层：AES-256-GCM 加密
- 运行时：仅在内存中解密，用完即焚
- 审计：记录 Key 使用（SHA256 指纹，不记录明文）
- 轮转：30 天自动提醒密钥轮转

**FR-SEC-07：CORS 安全配置** [P0] ← v7.0 新增

- 生产环境必须配置具体域名白名单
- 禁止 `allow_origins=["*"]` + `allow_credentials=True` 的组合

**FR-SEC-08：前端 XSS 防护** [P0] ← v7.0 新增

- 禁止 `dangerouslySetInnerHTML`
- 使用 `react-markdown` 组件渲染 Markdown，内置 XSS 防护

***

## 第五章：API 设计

### 5.1 API 版本策略

所有路由使用 `/api/v1` 前缀。在 `router.py` 中使用 FastAPI 的 `APIRouter(prefix="/api/v{version}")` 模式，为未来版本预留扩展点。响应头返回 `X-API-Version: 1.0.0`。

### 5.2 统一响应格式

```json
{
  "status": "success",
  "data": { ... },
  "meta": {
    "trace_id": "uuid",
    "timestamp": "2026-05-26T10:00:00Z",
    "api_version": "1.0.0"
  }
}
```

```json
{
  "status": "error",
  "error": {
    "code": "MODE_NOT_FOUND",
    "message": "Mode 'xxx' not found",
    "details": { ... }
  },
  "meta": {
    "trace_id": "uuid",
    "timestamp": "2026-05-26T10:00:00Z",
    "api_version": "1.0.0"
  }
}
```

### 5.3 Pydantic 请求模型

**[v7.0 修复]** 所有端点使用 Pydantic Request/Response 模型，禁止 `payload: dict`：

```python
class CreateTaskRequest(BaseModel):
    intent: str = Field(..., min_length=1, max_length=2000)
    task: str | None = None
    input_data: dict | None = None
    mode: str | None = None
    persona: str | None = None
    workflow: str | None = None
    interaction_mode: Literal["standard", "solo"] = "standard"
    model: str | None = None
    metadata: dict | None = None
    task_id: str | None = None

class SubmitReviewRequest(BaseModel):
    verdict: Literal["approve", "reject", "edit"]
    feedback: str | None = None
    edited_content: str | None = None

class ListTasksQuery(BaseModel):
    status: str | None = None
    persona: str | None = None
    mode: str | None = None
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)
```

### 5.4 核心 API 端点

#### 任务管理

| 方法 | 路径 | 描述 | 认证 | 速率限制 |
|------|------|------|------|---------|
| POST | `/api/v1/tasks` | 创建任务 | 必需 | 10/min |
| GET | `/api/v1/tasks` | 任务列表 | 可选 | 100/min |
| GET | `/api/v1/tasks/{task_id}` | 任务详情 | 可选 | 100/min |
| POST | `/api/v1/tasks/{task_id}/review` | 提交审核 | 必需 | 30/min |
| POST | `/api/v1/tasks/{task_id}/pause` | 暂停任务 | 必需 | 30/min |
| POST | `/api/v1/tasks/{task_id}/resume` | 恢复任务 | 必需 | 30/min |
| POST | `/api/v1/tasks/{task_id}/cancel` | 取消任务 | 必需 | 30/min |
| POST | `/api/v1/tasks/{task_id}/skip` | 跳过节点 | 必需 | 30/min |

#### 模式与工作流

| 方法 | 路径 | 描述 | 认证 | 速率限制 |
|------|------|------|------|---------|
| GET | `/api/v1/modes` | 列出所有模式 | 可选 | 100/min |
| GET | `/api/v1/modes/{mode}` | 模式详情 | 可选 | 100/min |
| GET | `/api/v1/workflows` | 列出所有 Workflow | 可选 | 100/min |
| GET | `/api/v1/workflows/{name}` | Workflow 详情 | 可选 | 100/min |

#### Agent 与工具

| 方法 | 路径 | 描述 | 认证 | 速率限制 |
|------|------|------|------|---------|
| GET | `/api/v1/agents` | 列出所有 Agent | 可选 | 100/min |
| GET | `/api/v1/agents/{name}` | Agent 详情 | 可选 | 100/min |
| GET | `/api/v1/tools` | 列出所有工具 | 可选 | 100/min |
| GET | `/api/v1/tools/{name}` | 工具详情 | 可选 | 100/min |

#### 认证

| 方法 | 路径 | 描述 | 认证 | 速率限制 |
|------|------|------|------|---------|
| POST | `/api/v1/auth/login` | 登录获取 JWT | 无 | 5/min |
| POST | `/api/v1/auth/refresh` | 刷新 JWT | 必需 | 30/min |
| GET | `/api/v1/auth/me` | 当前用户信息 | 必需 | 100/min |

#### 管理

| 方法 | 路径 | 描述 | 认证 | 速率限制 |
|------|------|------|------|---------|
| GET | `/api/v1/admin/models` | 模型列表 | admin | 100/min |
| PUT | `/api/v1/admin/models` | 更新模型配置 | admin | 30/min |
| GET | `/api/v1/admin/settings` | 系统设置 | admin | 100/min |
| PUT | `/api/v1/admin/settings` | 更新设置 | admin | 30/min |
| GET | `/api/v1/admin/agents` | Agent 管理 | admin | 100/min |

### 5.5 v7.0 新增 API 端点

#### Harness 驾驭层

| 方法 | 路径 | 描述 | 认证 | 速率限制 | 优先级 |
|------|------|------|------|---------|--------|
| GET | `/api/v1/harness/constraints` | 查询架构约束规则 | 必需 | 100/min | P1 |
| GET | `/api/v1/harness/constraints/{id}` | 约束规则详情 | 必需 | 100/min | P1 |
| POST | `/api/v1/harness/constraints` | 创建约束规则 | admin | 30/min | P1 |
| GET | `/api/v1/harness/feedback/config` | 反馈循环配置 | 必需 | 100/min | P1 |
| PUT | `/api/v1/harness/feedback/config` | 更新反馈配置 | admin | 30/min | P1 |
| GET | `/api/v1/harness/entropy/metrics` | 熵管理指标 | 必需 | 100/min | P1 |

#### Skill 系统

| 方法 | 路径 | 描述 | 认证 | 速率限制 | 优先级 |
|------|------|------|------|---------|--------|
| GET | `/api/v1/skills` | 列出所有 Skill | 可选 | 100/min | P0 |
| GET | `/api/v1/skills/{id}` | Skill 详情 | 可选 | 100/min | P0 |
| POST | `/api/v1/skills/{id}/configure` | 配置 Skill 参数 | 必需 | 30/min | P0 |
| POST | `/api/v1/skills/{id}/activate` | 激活 Skill | 必需 | 30/min | P1 |
| DELETE | `/api/v1/skills/{id}` | 卸载 Skill | 必需 | 30/min | P1 |

#### MCP 模块

| 方法 | 路径 | 描述 | 认证 | 速率限制 | 优先级 |
|------|------|------|------|---------|--------|
| GET | `/api/v1/mcp/servers` | MCP 服务器列表 | 必需 | 100/min | P1 |
| POST | `/api/v1/mcp/servers` | 注册 MCP 服务器 | admin | 30/min | P1 |
| GET | `/api/v1/mcp/servers/{id}/tools` | 服务器工具列表 | 必需 | 100/min | P1 |
| DELETE | `/api/v1/mcp/servers/{id}` | 移除 MCP 服务器 | admin | 30/min | P1 |

#### 模板市场

| 方法 | 路径 | 描述 | 认证 | 速率限制 | 优先级 |
|------|------|------|------|---------|--------|
| GET | `/api/v1/templates` | 模板列表 | 可选 | 100/min | P0 |
| GET | `/api/v1/templates/{id}` | 模板详情 | 可选 | 100/min | P0 |
| POST | `/api/v1/templates/{id}/install` | 一键安装模板 | 必需 | 10/min | P0 |
| POST | `/api/v1/templates` | 发布模板 | 必需 | 10/min | P1 |
| GET | `/api/v1/templates/{id}/reviews` | 模板评价 | 可选 | 100/min | P2 |

#### 轨迹与可观测性

| 方法 | 路径 | 描述 | 认证 | 速率限制 | 优先级 |
|------|------|------|------|---------|--------|
| GET | `/api/v1/traces/{task_id}` | 任务执行轨迹 | 必需 | 100/min | P1 |
| GET | `/api/v1/traces/{task_id}/episodes` | Episode 列表 | 必需 | 100/min | P1 |
| GET | `/api/v1/metrics/dashboard` | 仪表盘数据聚合 | 必需 | 100/min | P1 |

#### AIGC 合规

| 方法 | 路径 | 描述 | 认证 | 速率限制 | 优先级 |
|------|------|------|------|---------|--------|
| GET | `/api/v1/aigc/logs` | AIGC 生成日志 | admin | 100/min | P0 |
| GET | `/api/v1/aigc/logs/{id}` | 日志详情 | admin | 100/min | P0 |
| GET | `/api/v1/aigc/algorithm-meta` | 算法备案元数据 | admin | 100/min | P1 |
| PUT | `/api/v1/aigc/algorithm-meta` | 更新算法元数据 | admin | 30/min | P1 |

#### 多租户

| 方法 | 路径 | 描述 | 认证 | 速率限制 | 优先级 |
|------|------|------|------|---------|--------|
| GET | `/api/v1/tenants` | 租户列表 | admin | 100/min | P1 |
| POST | `/api/v1/tenants` | 创建租户 | admin | 10/min | P1 |
| GET | `/api/v1/tenants/{id}` | 租户详情 | admin | 100/min | P1 |
| PUT | `/api/v1/tenants/{id}/quotas` | 更新资源配额 | admin | 30/min | P1 |
| GET | `/api/v1/tenants/{id}/usage` | 租户用量统计 | admin | 100/min | P1 |

### 5.6 WebSocket 端点

| 路径 | 描述 | 认证 |
|------|------|------|
| `/ws/solo/{task_id}` | Solo 专用实时通道 | JWT Token 参数 |
| `/ws/events` | 全局事件流 | JWT Token 参数 |
| `/ws/logs` | 日志尾随 | JWT Token 参数 |

**[v7.0 修复]** WebSocket 消息引入类型校验和认证；前端 WebSocket 统一走 Next.js 代理。

***

## 第六章：多租户支持

### 6.1 租户隔离方案

**推荐方案**：行级隔离（Shared Database, Shared Schema, tenant_id）

| 方案 | 隔离强度 | 运维成本 | 资源利用率 | 适用阶段 |
|------|---------|---------|-----------|---------|
| **行级隔离**（推荐） | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | Phase B SaaS 标准版 |
| Schema 隔离 | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | Phase C 企业私有部署 |
| 库级隔离 | ⭐⭐⭐⭐ | ⭐ | ⭐ | Phase C+ 高合规场景 |

### 6.2 核心多租户组件

```python
class TenantContext:
    tenant_id: str
    tier: TenantTier          # FREE / PRO / ENTERPRISE
    quotas: QuotaLimits
    api_key_vault_id: str

class QuotaLimits:
    max_concurrent_workflows: int    # 免费版: 2, 专业版: 20, 企业版: 100
    max_workflows_per_day: int       # 免费版: 10, 专业版: 200, 企业版: unlimited
    max_llm_tokens_per_month: int    # 免费版: 100K, 专业版: 5M, 企业版: 50M
    max_skills: int                  # 免费版: 5, 专业版: 50, 企业版: unlimited
    max_team_members: int            # 免费版: 1, 专业版: 10, 企业版: unlimited
    marketplace_access: bool         # 免费版: False, 专业版+: True
```

### 6.3 数据库行级隔离

所有核心表增加 `tenant_id` 列，Repository 层自动注入 `WHERE tenant_id = current_tenant()`：

```python
class TenantFilteredRepository(BaseRepository):
    async def find_all(self, **filters):
        filters["tenant_id"] = get_current_tenant_id()
        return await super().find_all(**filters)
```

PostgreSQL Row-Level Security 作为双重保障：

```sql
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflows
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

### 6.4 API Key 多租户隔离

- 租户上传的 API Key 使用 AES-256-GCM 加密存储
- Key 仅在内存中解密，用完即焚
- 租户 A 不可读取租户 B 的 Key
- 审计日志记录 Key 使用（SHA256 指纹，不记录明文）

### 6.5 租户解析中间件

```python
class TenantResolverMiddleware:
    async def __call__(self, request: Request, call_next):
        # 从 JWT payload 或 API Key 中解析 tenant_id
        tenant_id = extract_tenant_id(request)
        # 注入到 ContextVar
        set_current_tenant_id(tenant_id)
        response = await call_next(request)
        return response
```

***

## 第七章：AIGC 合规要求

### 7.1 合规功能需求映射

| 合规要求 | 功能需求 | 实现优先级 | 阶段 |
|----------|----------|----------|------|
| **AIGC 标识** | 所有 AI 生成内容标记 `🤖 AI Generated` + 元数据水印 | P0 | Phase A |
| **内容留存** | 输入+输出日志留存 ≥6 个月，不可删除 | P0 | Phase A |
| **敏感内容过滤** | 输入和输出两端敏感词检测 + 拦截 | P0 | Phase A |
| **个保法** | 隐私政策 + 用户同意 + 数据删除 + 数据导出 | P0 | Phase A |
| **ICP 备案** | 非技术需求，法务/行政流程 | P0 | Phase B 上线前 |
| **算法备案** | 算法元数据管理系统 | P1 | Phase B |
| **安全评估** | 自评估报告生成 + 定期更新提醒 | P1 | Phase B |
| **等保二级** | 4A（认证/授权/审计/账号）+ 传输加密 + 备份 | P1 | Phase B |

### 7.2 AIGC 标识实现

```python
class AIGCLabeler:
    """为 AI 生成内容添加标识"""

    def label_output(self, content: str, metadata: dict) -> str:
        """在内容末尾添加 AI 生成标识"""
        label = f"\n\n---\n🤖 AI Generated | Model: {metadata['model']} | Task: {metadata['task_id']} | Time: {metadata['timestamp']}"
        return content + label

    def embed_watermark(self, content: str, metadata: dict) -> str:
        """嵌入隐式元数据水印（HTML meta / Markdown YAML front matter）"""
        watermark = f"<!-- aigc:model={metadata['model']},task={metadata['task_id']},ts={metadata['timestamp']} -->"
        return watermark + content
```

### 7.3 AIGC 日志表

```sql
CREATE TABLE aigc_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    task_id VARCHAR NOT NULL,
    model VARCHAR NOT NULL,
    input_content TEXT NOT NULL,
    output_content TEXT NOT NULL,
    labeled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    retained_until TIMESTAMP WITH TIME ZONE NOT NULL  -- 至少6个月
);

-- 禁止删除（通过触发器）
CREATE OR REPLACE FUNCTION prevent_aigc_log_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AIGC logs cannot be deleted within retention period';
END;
$$ LANGUAGE plpgsql;
```

### 7.4 敏感内容过滤

```python
class SensitiveContentFilter:
    """输入和输出两端敏感词检测"""

    def __init__(self):
        self.keyword_patterns = load_sensitive_keywords()  # 从配置加载
        self.regex_patterns = load_sensitive_regex()       # 正则模式

    async def check_input(self, text: str) -> FilterResult:
        """检查用户输入是否包含敏感内容"""
        ...

    async def check_output(self, text: str) -> FilterResult:
        """检查 AI 输出是否包含敏感内容"""
        ...

    async def check_with_external_api(self, text: str) -> FilterResult:
        """可选：调用外部审核 API"""
        ...
```

***

## 第八章：定价策略

### 8.1 v7.0 定价（含免费层）

#### FlowForge 平台

| 版本 | 月价 | 工作流数 | 并发数 | Token 预算/月 | 高级模式 | 模板市场 | 团队成员 |
|------|------|---------|--------|-------------|---------|---------|---------|
| **免费版** | ¥0 | 3 | 2 | 100K | ReAct/Plan-Execute | 浏览 | 1 |
| **专业版** | ¥99 | 20 | 10 | 5M | 全部9种 | 浏览+安装 | 5 |
| **企业版** | ¥999 | 不限 | 100 | 50M | 全部9种 | 全功能 | 不限 |

#### 内容服务（AI 内容批量化）

| 版本 | 月价 | 文章数/月 | 渠道 | 审核 |
|------|------|----------|------|------|
| **入门版** | ¥99 | 10 | 微信公众号 | 人工审核 |
| **标准版** | ¥299 | 50 | 微信+头条+知乎 | 人工+AI审核 |
| **企业版** | ¥1,999 | 200 | 全渠道 | 全自动审核 |

#### 企业私有部署

| 项目 | 价格 | 包含 |
|------|------|------|
| 标准部署 | ¥50,000/年 | 1年许可 + 基础支持 + 季度更新 |
| 高级部署 | ¥150,000/年 | 1年许可 + 7×12支持 + 月度更新 + SSO集成 |

#### OpenRoute / OpenSieve

- **不独立售卖**，作为 FlowForge 内置组件
- 免费版：基础模型路由 + 基础搜索
- 专业版：成本优化路由 + 版权筛选 + 多源聚合

### 8.2 定价依据

| 指标 | 数据 |
|------|------|
| 中国 SaaS ARPU 中位数 | ¥150-300/月/用户 |
| Dify 免费版 | 200 次消息/月 |
| Jasper 起步价 | $49/月（≈¥350/月） |
| 目标用户月收入 | ¥5,000-15,000 |
| FlowForge 免费版占月收入比 | 0% |
| FlowForge 专业版占月收入比 | 0.7%-2% |

### 8.3 免费层设计原则

1. **足够体验核心价值**：3 个工作流足以完成"选题→写作→发布"基础链路
2. **自然升级路径**：用户触达限制时，提示升级而非硬阻断
3. **数据驱动转化**：追踪免费用户的使用行为，识别高转化信号
4. **获客飞轮**：免费用户 → 效果数据 → 口碑传播 → 付费转化

***

## 第九章：非功能需求 (NFR)

### 9.1 性能要求

| 指标 | Phase A 目标 | Phase B 目标 | Phase C 目标 |
|------|------------|------------|------------|
| 单 Agent 执行延迟（不含 LLM） | < 3s (P95) | < 2s (P95) | < 1s (P95) |
| Workflow 8 步骤执行（不含 LLM） | < 45s | < 30s | < 20s |
| WebSocket 事件延迟 | < 100ms (P95) | < 50ms (P95) | < 30ms (P95) |
| 插件加载时间（10个插件） | < 800ms | < 500ms | < 300ms |
| 并发创建 10 个不同 persona 任务 | 全部成功 | 全部成功 | 全部成功 |
| 并发 Workflow 数 | 10-20 | 50-100 | 500+ |

### 9.2 FeedbackLoop 评估模式

| 模式 | LLM 调用次数 | 适用场景 | 默认 |
|------|------------|---------|------|
| `full` | 2 次（四维评分 + 分类闸门） | 需要深度质量评估的场景 | |
| `lightweight` | 1 次（仅分类闸门） | 日常运行 | ✅ |
| `skip` | 0 次（跳过外环） | 内环 Reflexion 仍生效 | |

### 9.3 可靠性要求

| 指标 | Phase A 目标 | Phase B 目标 | Phase C 目标 |
|------|------------|------------|------------|
| 系统可用性 | > 95% | > 99% | > 99.9% |
| 人工审核通过率 | > 80% | > 90% | > 95% |
| 模型故障自动切换 | < 30s | < 10s | < 5s |
| WebSocket 断线重连 | 指数退避，最多 10 次 | 同左 | 同左 |
| Circuit Breaker 触发 | 5 次连续失败 | 5 次连续失败 | 3 次连续失败 |
| 检查点恢复成功率 | > 90% | > 98% | > 99.5% |
| 幂等性 | 核心操作支持 | 全操作支持 | 全操作支持 |

### 9.4 SLO 目标（Phase B 起）

| SLI | SLO 目标 | 测量方式 |
|-----|----------|----------|
| Workflow 提交成功率 | ≥ 99.5% | `submitted / (submitted + rejected)` |
| Workflow 完成率 | ≥ 95% | `completed / submitted`（排除用户取消） |
| API P99 延迟 | ≤ 2s | Gateway middleware 采集 |
| LLM 调用可用率 | ≥ 99.9% | 多 Provider 聚合 |
| 检查点恢复成功率 | ≥ 98% | `resumed / resume_attempts` |

### 9.5 可扩展性

- **NFR-01**：插件化 Agent/Mode/Tool 注册机制，支持热插拔
- **NFR-02**：MCP 协议接入外部工具服务器
- **NFR-03**：OpenAPI/GraphQL 自动转换为 Tool
- **NFR-04**：配置热重载（harness_v7.yaml 修改后无需重启）

### 9.6 安全性

- **NFR-05**：三层权限管线 + 四级动作分级
- **NFR-06**：代码沙箱 + 文件系统路径穿越防护
- **NFR-07**：Human-in-the-Loop 审核（所有正式发布必须人工确认）
- **NFR-08**：全链路审计追踪
- **NFR-09**：密钥加密存储（AES-256-GCM）
- **NFR-10**：JWT 强制认证 + RBAC [v7.0 新增]
- **NFR-11**：API 速率限制 [v7.0 新增]
- **NFR-12**：前端 XSS 防护 [v7.0 新增]
- **NFR-13**：CORS 白名单 [v7.0 新增]

### 9.7 可维护性

- **NFR-14**：清晰的分层架构和模块边界
- **NFR-15**：声明式 YAML 配置驱动
- **NFR-16**：全链路追踪和结构化日志（structlog）
- **NFR-17**：Prometheus + Grafana 监控
- **NFR-18**：结构化异常体系——`ProxyError` 携带 `context dict`，包含 trace_id、tool_name、原始错误信息
- **NFR-19**：Alembic 数据库迁移 [v7.0 新增]
- **NFR-20**：GitHub Actions CI/CD [v7.0 新增]
- **NFR-21**：多阶段 Docker 构建 [v7.0 新增]

### 9.8 合规性 [v7.0 新增]

- **NFR-22**：AIGC 生成标识（显式标记 + 隐式水印）
- **NFR-23**：内容留存 ≥6 个月
- **NFR-24**：敏感内容过滤
- **NFR-25**：算法备案元数据管理
- **NFR-26**：个保法合规（用户同意 + 数据删除 + 数据导出）
- **NFR-27**：等保二级基础合规（Phase B）

***

## 第十章：数据库设计

### 10.1 数据库选型

| 阶段 | 数据库 | 原因 |
|------|--------|------|
| Phase A | SQLite（WAL 模式） | 快速迭代，单用户开发 |
| Phase B | PostgreSQL | 多租户、行级安全、并发写入 |
| Phase C | PostgreSQL + Redis | 缓存/队列/会话 |

### 10.2 Schema 设计原则

**[v7.0 修复]**：

1. 时间戳使用 `DateTime(timezone=True)` 而非 `String`
2. 高频查询字段（status、mode、persona、interaction_mode、tenant_id）提升为独立列
3. `state_json` 仅存储完整快照数据
4. 所有核心表增加 `tenant_id` 列（Phase B）
5. 使用 Alembic 管理 Schema 演进

### 10.3 核心表设计

```python
class TaskModel(Base):
    __tablename__ = "tasks"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=True)          # Phase B 起必填
    persona = Column(String, nullable=False, index=True)
    mode = Column(String, nullable=False, index=True)
    status = Column(String, default="pending", index=True)
    interaction_mode = Column(String, default="standard")
    intent = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime(timezone=True), nullable=True)
    state_json = Column(Text, nullable=True)            # 完整快照
    trace_id = Column(String, nullable=True, index=True)

class AuditLogModel(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String, nullable=True)
    trace_id = Column(String, nullable=True, index=True)
    action = Column(String, nullable=False)
    actor = Column(String, nullable=True)
    target_type = Column(String, nullable=True)
    target_id = Column(String, nullable=True)
    detail = Column(Text, nullable=True)
    key_fingerprint = Column(String, nullable=True)     # API Key SHA256
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AIGCLogModel(Base):
    __tablename__ = "aigc_logs"
    id = Column(String, primary_key=True, default=uuid4)
    tenant_id = Column(String, nullable=True)
    task_id = Column(String, nullable=False, index=True)
    model = Column(String, nullable=False)
    input_hash = Column(String, nullable=False)         # SHA256
    output_hash = Column(String, nullable=False)        # SHA256
    input_content = Column(Text, nullable=False)        # 加密存储
    output_content = Column(Text, nullable=False)       # 加密存储
    labeled = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    retained_until = Column(DateTime(timezone=True), nullable=False)

class ModelHealthModel(Base):
    __tablename__ = "model_health"
    model_key = Column(String, primary_key=True)
    is_available = Column(Boolean, default=True)
    last_check = Column(DateTime(timezone=True))
    failure_count = Column(Integer, default=0)
```

### 10.4 Session 管理

```python
# 使用 FastAPI 依赖注入 + yield 确保关闭
async def get_session():
    async with async_session() as session:
        yield session
```

### 10.5 Alembic 迁移

```bash
alembic init migrations
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

所有 Schema 变更必须通过 Alembic 迁移脚本执行，禁止 `create_all()` 直接创建。

***

## 第十一章：部署架构

### 11.1 Dockerfile（多阶段构建）

```dockerfile
# 构建阶段
FROM python:3.11-slim-bookworm AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# 运行阶段
FROM python:3.11-slim-bookworm
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY . .
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "4", "--graceful-timeout", "30", "--proxy-headers"]
```

### 11.2 Docker Compose（Phase B 完整版）

```yaml
services:
  flowforge-api:
    build: .
    ports: ["8000:8000"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    environment:
      - DATABASE_URL=postgresql+asyncpg://flowforge:xxx@postgres:5432/flowforge
      - REDIS_URL=redis://redis:6379/0
      - SECRET_KEY=${SECRET_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  flowforge-web:
    build: ./web
    ports: ["3000:3000"]
    depends_on:
      flowforge-api: { condition: service_healthy }

  postgres:
    image: postgres:16-alpine
    volumes: ["pgdata:/var/lib/postgresql/data"]
    environment:
      - POSTGRES_DB=flowforge
      - POSTGRES_USER=flowforge
      - POSTGRES_PASSWORD=${PG_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flowforge"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes: ["redisdata:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s

  prometheus:
    image: prom/prometheus:latest
    volumes: ["./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml"]
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana:latest
    ports: ["3001:3000"]
    depends_on:
      - prometheus

  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes: ["./nginx.conf:/etc/nginx/nginx.conf"]
    depends_on:
      flowforge-api: { condition: service_healthy }
      flowforge-web: { condition: service_started }

volumes:
  pgdata:
  redisdata:
```

### 11.3 CI/CD 流水线

```yaml
# .github/workflows/ci.yml
name: FlowForge CI
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install ruff mypy
      - run: ruff check .
      - run: mypy flowforge/ --ignore-missing-imports

  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install -r requirements.txt
      - run: pytest tests/unit/ -v

  integration-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_DB: test, POSTGRES_USER: test, POSTGRES_PASSWORD: test }
    steps:
      - uses: actions/checkout@v4
      - run: pip install -r requirements.txt
      - run: pytest tests/integration/ -v

  build:
    needs: [lint, unit-test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t flowforge:${{ github.sha }} .
      - run: docker push registry/flowforge:${{ github.sha }}
```

### 11.4 服务器规格

| 阶段 | 配置 | 月成本 | 适用场景 |
|------|------|--------|---------|
| Phase A | 4C8G | ¥200-400 | 单产品 + 10 场景测试 |
| Phase B | 8C16G | ¥500-800 | 多租户 + 50 并发 |
| Phase C | 8C16G×2 | ¥1,200-1,600 | HA 部署 + 200 并发 |
| 规模化 | K8s 3+ 节点 | ¥3,000+/月 | 500+ 并发 + 企业 SLA |

### 11.5 优雅关闭

在 lifespan 的关闭阶段：
1. 遍历 `HybridExecutor._task_futures` 取消所有运行中的任务
2. 保存 checkpoint
3. 通知所有 WebSocket 客户端服务即将关闭
4. SQLite WAL checkpoint（Phase A）
5. 等待所有 asyncio.Task 完成（超时 30s）

***

## 第十二章：前端架构

### 12.1 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 14 | 应用框架 |
| React | 18 | UI 库 |
| TypeScript | 5.x | 类型安全 |
| Tailwind CSS | 3.x | 样式系统 |
| shadcn/ui | latest | 组件库 |
| Zustand | 4.x | 状态管理 [v7.0 新增] |
| react-markdown | latest | Markdown 渲染 [v7.0 修复] |

### 12.2 状态管理（Zustand）

**[v7.0 修复]** 替换 useState + localStorage + useRef 三重状态源：

```typescript
// stores/soloStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SoloState {
  phase: SoloTaskPhase;
  entries: StreamEntry[];
  // ... 其他状态
  setPhase: (phase: SoloTaskPhase) => void;
  addEntry: (entry: StreamEntry) => void;
  // ... 其他 actions
}

export const useSoloStore = create<SoloState>()(
  persist(
    (set) => ({
      phase: 'idle',
      entries: [],
      setPhase: (phase) => set({ phase }),
      addEntry: (entry) => set((state) => ({ entries: [...state.entries, entry] })),
    }),
    { name: 'solo-state' }
  )
);
```

### 12.3 组件体系

**[v7.0 修复]** 系统性替换内联样式为 Tailwind CSS + shadcn/ui：

- Badge、Button、Card、Tabs、Dialog、Toast 等使用 shadcn/ui
- 自定义组件（ExecutionStream、ToolCallCard、ThinkingBlock 等）使用 Tailwind 类名
- 引入 `tailwind-merge` 处理类名合并

### 12.4 WebSocket 走 Next.js 代理

**[v7.0 修复]** 前端 WebSocket 统一走 `ws://${window.location.host}/ws/...`，由 Next.js rewrites 或 Nginx 代理到后端。

### 12.5 虚拟滚动

`ExecutionStream` 组件引入虚拟滚动（`react-virtual` 或 `@tanstack/virtual`），支持 500+ 条事件的流畅渲染。

***

## 第十三章：DI 容器重构

### 13.1 当前问题

`core/di.py` 定义了 `DIContainer` 类，但 `app/main.py` 完全没有使用它。所有依赖通过 `app/deps.py` 的模块级全局变量 + setter 函数注入，导致：
- 无法测试（测试无法替换依赖）
- 启动顺序脆弱
- 循环依赖风险

### 13.2 重构方案

使用 FastAPI 原生的 `Depends()` + `Annotated` 类型注入：

```python
# app/deps.py（重构后）
from typing import Annotated
from fastapi import Depends

async def get_executor() -> HybridExecutor:
    return app.state.executor

async def get_llm_client() -> LLMClient:
    return app.state.llm_client

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session

# 类型别名
ExecutorDep = Annotated[HybridExecutor, Depends(get_executor)]
LLMClientDep = Annotated[LLMClient, Depends(get_llm_client)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]

# 使用
@router.post("/tasks")
async def create_task(
    request: CreateTaskRequest,
    executor: ExecutorDep,
    session: SessionDep,
    user: CurrentUserDep,
):
    ...
```

### 13.3 Bootstrap 类

将 `main.py` 中的初始化逻辑重构为 `Bootstrap` 类：

```python
class Bootstrap:
    def __init__(self, config: SystemConfig):
        self.config = config

    async def initialize(self, app: FastAPI) -> None:
        """按依赖顺序初始化所有组件"""
        app.state.llm_client = await self._init_llm_client()
        app.state.model_service = await self._init_model_service()
        app.state.tool_registry = await self._init_tool_registry()
        app.state.agent_registry = await self._init_agent_registry()
        app.state.mode_registry = await self._init_mode_registry()
        app.state.executor = await self._init_executor()
        app.state.scheduler = await self._init_scheduler()
        app.state.plugin_manager = await self._init_plugin_manager()
```

***

## 第十四章：与 ContentForge 的集成方案

### 14.1 集成架构

FlowForge v7.0 作为底层 Harness 引擎，ContentForge 作为上层业务应用。ContentForge 通过以下方式接入：

1. **注册业务 Agent**：ContentForge 的 7 个业务 Agent（TopicAgent、ResearchAgent、WriterAgent 等）继承 FlowForge BaseAgent，注册到 AgentRegistry
2. **配置 Persona**：内容专栏的 SOUL/MEMORY 转换为 `config/persona/{name}.yaml`
3. **定义 SOP**：创作流程映射为 Workflow YAML 模板
4. **注册业务 Tool**：HelixRAG、ToutiaoPublisher、WeChatPublisher 等注册到 ToolRegistry
5. **使用 Skill**：创作类 Skill（如 weekly-report、book-essence-extractor）直接注入到 Agent 上下文
6. **启用 Harness**：上下文工程、架构约束、反馈循环、熵管理作为全局配置启用

### 14.2 业务场景映射

| ContentForge 场景 | FlowForge v7.0 对应能力 |
| --------------- | --------------------------------------------------- |
| 深度长文创作 | Workflow 模式 + `deep_article` SOP + Reflexion Writer |
| 热点追踪创作 | Multi-Agent (Subagents) + WebSearch Tool |
| 多平台分发 | Workflow 模式 + `multi_platform` SOP |
| SEO 内容生产 | Workflow 模式 + SEOOptimization Agent |
| 定时批量创作 | TaskScheduler + Cron 任务 |
| 人工审核 | Human-in-the-Loop 节点 + Solo 审核块 |
| 模型故障自愈 | ModelService 健康检查 + 级联修复 |
| 文档维护 | 文档园丁 Agent + 技术债回收 |
| AI 主编实时协作 | Solo 模式 + WebSocket 事件流 |

### 14.3 迁移路径

| ContentForge 现有模块 | FlowForge v7.0 对应 | 迁移策略 |
| --- | --- | --- |
| `brain/orchestrator.py` | `engine/hybrid_executor.py` | **包装**：保留 Persona 锁、Solo 回调，核心执行委托 |
| `workers/` | `agents/content/` | **继承**：改继承 FlowForge BaseAgent |
| `tools/registry.py` | `tools/registry.py` | **委托**：包装 FlowForge ToolRegistry |
| `tools/llm/client.py` | `tools/builtin/llm_client.py` | **替换** |
| `core/interfaces/solo_emitter.py` | `events/event_bus.py` + `events/solo_adapter.py` | **桥接** |
| `brain/scheduler.py` | `scheduler/scheduler.py` | **替换** |
| `config/persona/*.yaml` | `config/persona/*.yaml` | **保留** |

### 14.4 增量三步迁移策略

| 步骤 | 内容 | 新增目录 | 修改文件 | 回归测试 |
|------|------|---------|---------|---------|
| **Step 1** | 新增 harness/，灰度开关 | `harness/`（14个新文件） | `HybridExecutor.run()` 增加 Hook 点 | harness 禁用时行为不变 |
| **Step 2** | 重组 tools/agents，import 兼容 | `tools/builtin/` 等子目录 | `__init__.py` re-export + DeprecationWarning | 所有现有 Agent/Tool 测试通过 |
| **Step 3** | executor/→engine/，引入 security/observability | `engine/`, `security/`, `observability/` | 删除旧 import 路径 | 全量回归测试 |

Step 2 的 import 兼容期为 **1 个大版本周期**（v7.0 全周期内保持兼容，v8.0 才删除旧路径），旧 import 路径触发时输出 `DeprecationWarning`。

***

## 第十五章：业务场景支撑矩阵

### P0 场景（Phase A）

| 业务场景 | 执行模式 | 多Agent策略 | Harness护栏 | Tool依赖 | Skill | 交互模式 |
|---------|---------|-----------|-----------|---------|-------|---------|
| 深度长文创作 | workflow | subagents | 反馈循环+熵管理 | helixrag+web_search | article-outline | Solo |
| 快速帖子生成 | rewoo | - | 架构约束 | llm+web_search | - | Standard |
| 热点追踪 | multi_agent | subagents | 上下文工程 | web_search+helixrag | trend-analysis | Standard |
| 多平台分发 | workflow | - | 权限管线 | publish_toutiao+publish_wechat | - | Standard |
| SEO内容生产 | plan_execute | - | 反馈循环 | helixrag+llm | seo-optimizer | Standard |

### P1 场景（Phase B）

| 业务场景 | 执行模式 | 多Agent策略 | Harness护栏 | Tool依赖 | Skill | 交互模式 |
|---------|---------|-----------|-----------|---------|-------|---------|
| 定时批量创作 | workflow | - | 全部 | 全部 | - | Cron |
| AI主编实时协作 | workflow | agent_teams | 上下文工程+反馈循环 | 全部 | 全部 | Solo |
| 代码审查 | reflexion | agent_teams | 架构约束+反馈循环 | git_ops+llm | code-review | Solo |
| 文档维护 | plan_execute | - | 熵管理 | file_rw+git_ops | doc-gardener | Cron |
| 邮件营销 | plan_execute | - | 权限管线 | sendgrid+llm | email-campaign | Standard |

### P2 场景（Phase C）

| 业务场景 | 执行模式 | 多Agent策略 | Harness护栏 | Tool依赖 | Skill | 交互模式 |
|---------|---------|-----------|-----------|---------|-------|---------|
| AI客服 | react | - | 反馈循环+权限管线 | llm+web_search | customer-support | Standard |
| 竞品监控 | plan_execute | - | 上下文工程 | web_scraper+llm | market-monitor | Cron |
| 智能记账 | plan_execute | - | 架构约束 | ocr+llm | auto-accounting | Standard |
| 需求管理 | plan_execute | agent_teams | 反馈循环 | llm+file_rw | product-planner | Solo |
| 数据分析报告 | reflexion | subagents | 反馈循环+熵管理 | llm+python_executor | data-analyst | Solo |

***

## 第十六章：生产就绪度要求

### 16.1 生产就绪度检查清单

| 检查项 | Phase A 目标 | Phase B 目标 | Phase C 目标 |
|--------|------------|------------|------------|
| 认证鉴权 | JWT 强制 + 密码哈希 | + RBAC + SSO | + MFA |
| 速率限制 | slowapi 基础配置 | per-tenant 限制 | 自适应限流 |
| 输入校验 | Pydantic 核心端点 | 全端点 | + WebSocket |
| 数据库迁移 | Alembic 初始化 | + PostgreSQL | + 主从 |
| 优雅关闭 | 基本框架 | + 任务保存 | + 滚动更新 |
| 健康检查 | /health 端点 | + /ready | + 深度探针 |
| 日志聚合 | structlog JSON | + Loki/ELK | + OpenTelemetry |
| 指标监控 | prometheus_client | + Grafana | + 告警规则 |
| 链路追踪 | trace_id 注入 | + Jaeger | + 跨服务 |
| 错误恢复 | Circuit Breaker | + 检查点恢复 | + 自动故障转移 |
| 容器安全 | 多阶段构建 + USER | + .dockerignore | + 镜像扫描 |
| 前端测试 | XSS 修复 | Playwright E2E | + 视觉回归 |
| API 版本化 | /api/v1 前缀 | + 版本协商 | + 废弃通知 |
| 备份恢复 | cron 脚本 | + 增量备份 | + 时间点恢复 |
| AIGC 合规 | 标识 + 留存 + 过滤 | + 算法备案 | + 等保二级 |
| 多租户 | - | 行级隔离 | + Schema 隔离 |

### 16.2 关键风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 | 阶段 |
|------|------|------|---------|------|
| SQLite 并发锁 | 高 | 严重 | Phase B 迁移 PostgreSQL | A |
| JWT 默认密钥被利用 | 高 | 严重 | 启动时强制检查 | A |
| LLM API 费用失控 | 中 | 严重 | 速率限制 + 费用预算 | A |
| 前端 XSS 攻击 | 中 | 高 | react-markdown 替换 | A |
| 数据库 Schema 变更丢数据 | 中 | 严重 | Alembic 迁移 | A |
| Docker 容器被入侵 | 低 | 严重 | 多阶段构建 + USER | A |
| 租户数据泄露 | 中 | 致命 | 行级隔离 + RLS | B |
| AIGC 合规违规 | 中 | 高 | 标识 + 留存 + 过滤 | A |
| 单点故障 | 中 | 严重 | Phase C 主备部署 | C |

***

## 附录 A：Harness 层配置参考

```yaml
# config/harness_v7.yaml
flowforge:
  version: "7.0"
  mode: "harness"  # harness | framework

harness:
  context_engineering:
    enabled: true
    agents_md_path: "config/AGENTS.md"
    dynamic_injection: true
    handoff_enabled: true
    token_budget_enforcement: true    # v7.0 新增

  architecture_constraints:
    enabled: true
    layer_model: ["Types", "Config", "Repo", "Service", "Runtime", "UI"]
    layer_mapping_path: "config/layer_mapping.yaml"
    linter_rules_path: "config/linter_rules.yaml"
    ci_gate: "fail_on_violation"
    auto_circuit_break:              # v7.0 新增
      enabled: true
      max_violations: 3

  feedback_loop:
    enabled: true
    evaluation_mode: "lightweight"  # full | lightweight | skip
    evaluator_model: "sonnet-4.6"
    scoring_dimensions: [design_quality, originality, craft, functionality]
    pass_threshold: 0.8
    max_reflexion_iterations: 3
    cross_validation: true
    # v7.0 新增：重试与降级
    retry_policy:
      max_retries: 3
      backoff_base: 1.0             # 指数退避基数（秒）
    fallback_chain:
      - plan_execute
      - react
      - direct

  permission_pipeline:
    enabled: true
    tiers: [deny, ask, allow]
    action_levels:
      read: auto_approved
      suggest: prompt_user
      prepare: prompt_user
      execute: require_approval

  session_management:
    compaction_threshold: 0.92       # v7.0 统一值
    model_context_window: 128000
    preserved_rounds: 3
    max_tool_output_tokens: 25000
    tool_output_warning_tokens: 10000
    handoff_enabled: true
    checkpoint_interval: 300

  entropy_management:
    enabled: true
    doc_gardener_schedule: "0 2 * * *"
    debt_collection_schedule: "weekly"
    capture_failures_to_rules: true
    # v7.0 新增：可操作度量
    metrics:
      loop_rate_weight: 0.4
      tool_failure_rate_weight: 0.3
      context_inflation_weight: 0.3
      intervention_threshold: 0.8

  aigc_compliance:                   # v7.0 新增
    enabled: true
    labeling:
      explicit_marker: true          # 🤖 AI Generated
      implicit_watermark: true       # HTML meta / YAML front matter
    content_retention:
      enabled: true
      retention_days: 180            # ≥6个月
    sensitive_filter:
      enabled: true
      input_check: true
      output_check: true
      external_api: false            # 可选外部审核 API
```

## 附录 B：架构层映射配置参考

```yaml
# config/layer_mapping.yaml
layers:
  Types:
    - "models"
    - "schemas"
    - "types"
    - "interfaces"
  Config:
    - "config"
    - "settings"
    - "env"
  Repo:
    - "repository"
    - "database"
    - "db"
  Service:
    - "service"
    - "usecase"
    - "domain"
  Runtime:
    - "runner"
    - "executor"
    - "engine"
  UI:
    - "ui"
    - "components"
    - "pages"
```

## 附录 C：安全等级统一命名参考

```yaml
# config/safety_levels.yaml
# v7.0 统一命名规范
safety_levels:
  safe:
    description: "只读操作，无副作用"
    examples: ["web_search", "file_read", "helixrag_query"]
    auto_approved: true
  cautious:
    description: "有副作用但可逆"
    examples: ["file_write", "llm_call", "email_send"]
    auto_approved: false
    requires: "ask"
  dangerous:
    description: "不可逆操作或高成本操作"
    examples: ["shell_command", "python_executor", "publish", "git_push"]
    auto_approved: false
    requires: "execute_approval"
```

## 附录 D：评审修复记录

本规格说明书 v7.0 基于 v6.0 五方评审结果进行系统性修订，以下为关键修复记录：

| # | 修复项 | 来源 | 变更内容 |
|---|--------|------|---------|
| 1 | 商业方向聚焦 | CEO 评审 | 从 18 方向缩减为 1-2 方向，分阶段推进 |
| 2 | OpenRoute/OpenSieve 定位 | CEO 评审 | 从独立产品改为 FlowForge 内置组件 |
| 3 | 收入预测修正 | CEO 评审 | Phase B 首月从 ¥21K-55K 修正为 ¥3K-8K |
| 4 | 用户画像聚焦 | 产品评审 | 第一用户聚焦为"技术型创业者" |
| 5 | Harness 概念翻译 | 产品评审 | 增加用户语言版价值主张 |
| 6 | 场景缩减 | 产品/Agent评审 | 从 40 场景缩减为 15 个已验证场景 |
| 7 | 免费层定价 | 产品评审 | FlowForge 免费版 ¥0（3 工作流） |
| 8 | 安全等级命名统一 | 架构师评审 | 统一为 `safe/cautious/dangerous` |
| 9 | 压缩阈值统一 | 架构师评审 | 统一为 0.92 |
| 10 | BaseModeExecutor 接口统一 | 架构师评审 | 统一为 `execute(input, ctx) -> Output` |
| 11 | API 文档更新 | 架构师评审 | 更新至 v7.0，补充缺失端点 |
| 12 | SQLite→PostgreSQL | 架构师评审 | Phase B 迁移，Phase A 使用 SQLite WAL |
| 13 | 多租户支持 | 架构师评审 | 行级隔离 + tenant_id + RLS |
| 14 | AIGC 合规 | 架构师评审 | AI 生成标识 + 内容留存 + 敏感过滤 |
| 15 | WorkflowExecutor 模式路由 | Agent评审 | 修复 B3 Bug，尊重 step mode 字段 |
| 16 | ContentAuditAgent judge_model | Agent评审 | 注册时传入独立评判模型 |
| 17 | FeedbackLoop 核心方法 | Agent评审 | 实现完整评估管线，禁止占位符 |
| 18 | Swarms 模式实现 | Agent评审 | Phase A 实现基础版 |
| 19 | DefaultLLMActor model_override | Agent评审 | 增加 model_override 参数 |
| 20 | parallel_group 数据竞争 | Agent评审 | 为并行任务创建独立 EventBus 代理 |
| 21 | DI 容器重构 | 全栈评审 | 使用 FastAPI Depends 替代全局变量 |
| 22 | JWT 强制认证 | 全栈评审 | 所有写操作端点强制 JWT + 密码哈希 |
| 23 | API 速率限制 | 全栈评审 | slowapi 中间件 |
| 24 | API Key 加密 | 全栈评审 | AES-256-GCM 加密存储 |
| 25 | Alembic 迁移 | 全栈评审 | 引入数据库迁移框架 |
| 26 | Docker 多阶段构建 | 全栈评审 | 安全加固 + USER 指令 |
| 27 | CI/CD 流水线 | 全栈评审 | GitHub Actions CI |
| 28 | 前端 XSS 修复 | 全栈评审 | react-markdown 替换 |
| 29 | 前端状态管理 | 全栈评审 | Zustand 替代三重状态源 |
| 30 | Pydantic 请求模型 | 全栈评审 | 替换 payload: dict |
| 31 | WebSocket 走代理 | 全栈评审 | 统一走 Next.js 代理 |
| 32 | 全局事件流重构 | 全栈评审 | asyncio.Queue 替代 list+pop(0) |
| 33 | 结构化日志 | 全栈评审 | structlog 替代手写 TraceLogger |
| 34 | Prometheus 原生类型 | 全栈评审 | 使用 prometheus_client 原生 Counter/Histogram/Gauge |
| 35 | Compaction 阈值 | v6.0 评审 | 统一为 92%，计算方式：utilization = total_tokens / model_context_window |
| 36 | FeedbackLoop 定位 | v6.0 评审 | 明确为内环+外环双层架构，串行关系 |
| 37 | 增量迁移策略 | v6.0 评审 | 三步迁移计划，兼容期延至 v8.0 |
| 38 | FR-ENG-07 轨迹记录 | v6.0 评审 | 降级为轨迹记录，不涉及模型训练 |
| 39 | Skill 加载入口 | v6.0 评审 | 统一走 skills/registry.py |
| 40 | agent_registry 归属 | v6.0 评审 | 从 core/ 移入 engine/ |
| 41 | 依赖提取实现 | v6.0 评审 | ast 模块解析 + layer_mapping.yaml |
| 42 | MCP Broker 索引 | v6.0 评审 | tool_name→server_name 映射 |
| 43 | evaluation_mode | v6.0 评审 | full/lightweight/skip 三档配置 |
| 44 | Hook 点设计 | v6.0 评审 | pre_execute + post_execute 两个统一入口 |
| 45 | 熵管理定位 | v6.0 评审 | 内置核心能力，不走插件市场 |

## 附录 E：开源策略

### 协议选择

| 组件 | 协议 | 理由 |
|------|------|------|
| FlowForge 核心 | MIT | 与 LangGraph 一致，吸引开发者 |
| OpenRoute | Apache 2.0 | 与 OpenRouter 一致 |
| OpenSieve | Apache 2.0 | 标准开源协议 |

### 协议变更预留

在 CONTRIBUTING.md 中明确声明："我们保留未来更改开源协议的权利"。

### 开源变现路径

| 变现模式 | 可行性 | 时间线 |
|---------|--------|--------|
| 开源核心 + 商业版功能 | ✅ | 6-12 个月 |
| 托管 SaaS | ✅ | 3-6 个月 |
| 企业私有部署 + 支持 | ✅ | 立即 |
| 模板市场抽成 | ⚠️ | 12-24 个月 |

***

> **本文档为 FlowForge v7.0 的权威功能规格说明书，所有代码开发必须严格遵守本文档中的规范。**
>
> **如有疑问，参考设计文档或直接询问用户，不要猜测或假设。**
>
> **版本历史**：
> - v6.0 (2026-05-12)：初始 Harness 层规格
> - v7.0 (2026-05-26)：基于五方评审的系统性修订版
