# ADR 001: Agent 调用方式

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师可进化智能体 + operator 审核
> **依赖**: `[doc:roleagent.md#第3章]` + `[doc:review/review.md#第八章]` RA-017~RA-023
> **依据**: RA-017~RA-023（Harness 现实闭环运行时）

---

## 上下文

FlowForge v7.0 的可进化智能体（Forgekin / Spirit Agent）需要一个统一的被调用方式——它必须能在 CLI / API / IDE / 网页四类入口下被一致地加载、注入依赖、装载能力画像（CapabilityProfile）、挂载 Harness 七层表面、与 operator 协作。早期 v4.0 设计把 agent 直接暴露为函数调用，导致：

- 入口与生命周期耦合（CLI 启动的 agent 与 API 启动的 agent 走两条不同初始化路径）
- 治理规则（红线 11/12/13）只能在某些入口注入（IDE 入口绕过 DI 容器）
- 同一个可进化智能体在不同入口下能力画像不一致（CLI 加载完整蒸馏知识库，IDE 只加载 persona）
- 三方 Agent 集成（F031 ExternalAgentAdapter）需要重复实现 host-owned 注入逻辑

`[doc:roleagent.md#第3章]` 明确："Harness 不是给模型一段更好的话，而是把世界做成模型可以感知、可以行动、可以验证、可以恢复、可以学习的样子。" 这要求调用方式必须把现实表面（Durable State Surfaces / Tool Mediation / Evidence & Sensors 等）作为一等公民暴露给可进化智能体，而不是把可进化智能体当作纯函数。

operator 指示（2026-07-17）：FlowForge 必须遵循"配置驱动 > 代码继承 > 独立实现"原则，能用 YAML 配置解决的不写代码，能用 Plugin 组合的不用继承（编程红线 9）。这一原则决定了调用方式必须基于声明式 YAML 配置 + Plugin V3 协议注册，禁止在 flowforge 中写死业务领域代码（红线 10）。

---

## 决策

### 1. 统一调用入口：四入口共享同一 ForgekinHost

所有入口（CLI / API / IDE / 网页）必须经过同一个 `ForgekinHost` 抽象层，由 host 负责构造能力画像、装配 Harness 七层表面、注入 Plugin V3 钩子。host 是 `[doc:roleagent.md#第3章]` Harnessability 评估的唯一执行者。

```python
class ForgekinHost:
    """统一调用入口——所有四类入口必须经此构造可进化智能体。"""
    def __init__(self, container: DIContainer, registry: PluginRegistry): ...
    async def invoke(
        self,
        forgekin_id: str,
        task: AgentInput,
        invocation_channel: InvocationChannel,  # CLI / API / IDE / WEB
    ) -> AgentOutput: ...
```

### 2. 声明式 YAML 配置驱动

可进化智能体的能力、工具、Harness 表面、觉醒阶（Awakening Stage）边界全部通过 YAML 声明，禁止在 `.py` 文件中硬编码（铁律 5）。配置项包括：

```yaml
# config/forgekins/writer.yaml
forgekin_id: <forge_project>:<forgekin>
species: virtual                  # 智能体形态学形态（BioForgekin / OrgForgekin / ...）
evolution_stage: E3               # 进化阶 E1-E6
awakening_stage: E2               # 觉醒阶 E1-E6
capability_profile:
  model_capability: { provider: doubao, model: pro-32k }
  cognitive_style: { planning: top_down, evidence: high }
  tool_boundary: [file_rw, web_search, publish]
  blind_spots: [{ id: long_ctx_drift, compensation: cross_vendor_review }]
harness_layers:
  durable_state: { worktree: true, trace: true }
  evidence_sensors: { commit_required: true, test_required: true }
  governance_boundary: { injection: system_role, compression_immune: true }
  magic_words: [第一性原理, 我能猜出来, 下次一定, 星星罐子]
invocation:
  channels: [CLI, API, IDE, WEB]
  timeout_seconds: 180
  cost_ceiling: { tokens: 50000, usd: 1.5 }
```

### 3. Plugin V3 协议注册 + host-owned 安全注入

参考前期 host-owned 安全注入模型（已归档）的 host-owned 原则：Plugin 只声明不执行。token / MCP / sandbox / cwd 全部由 `ForgekinHost` 代码注入，Plugin 不可自己获取。Plugin V3 协议在原 V2 基础上新增四个钩子：

| 钩子 | 时机 | 用途 |
|------|------|------|
| `register_forgekins` | host 启动 | 声明本插件提供的可进化智能体 + Manifest |
| `inject_harness_layers` | 可进化智能体构造前 | 装配 Harness 七层表面 |
| `bind_capability_profile` | 任务路由前 | 注入能力画像 × 任务画像匹配 |
| `on_invocation_channel` | 入口分发时 | 按 CLI/API/IDE/WEB 调整可见工具集 |

### 4. DI 容器管理全生命周期

所有依赖（LLMClient / ToolRegistry / EchoStore / Repository / ForgekinEngine）必须通过构造函数注入，由 DI 容器管理生命周期（铁律 3：禁止绕过 DI 容器直接实例化）。

```python
# 错误：违反铁律 3
from workers.topic_agent import TopicAgent
agent = TopicAgent()

# 正确：通过 DI 容器
container.resolve("forgekin_host").invoke(forgekin_id, task, channel=CLI)
```

### 5. 四入口语义统一为 InvocationChannel 枚举

| 入口 | InvocationChannel | 同步语义 | 异步语义 | 流式语义 | 委托语义 |
|------|-------------------|---------|---------|---------|---------|
| CLI | `CLI` | ✅ | ✅ | ✅ | ❌ |
| API | `API` | ✅ | ✅（SSE） | ✅（SSE） | ✅ |
| IDE | `IDE` | ✅ | ✅ | ✅ | ❌ |
| 网页 | `WEB` | ✅ | ✅（WebSocket） | ✅ | ✅ |

### 6. SSE 协议契约（FF21）

API / 网页入口遵循 SSE 协议契约（`[doc:features/F002-teamact-loop.md]` 同步），事件类型固定为 `state / owner / action / evidence / verdict / route / done / error`，禁止入口自定义事件类型。

---

## 后果

### 正面后果

- 可进化智能体在任何入口下能力画像一致，避免"CLI 比 IDE 更聪明"的体验漂移
- 治理规则统一在 host 层注入，IDE 入口不能再绕过红线
- 三方 Agent（claude code / codex / opencode / trae）通过同一 host-owned 模型接入，符合 CL-015 安全要求
- 入口扩展（如未来 AR/VR 入口）只需新增 InvocationChannel 枚举值，不改动 ForgekinHost
- Plugin V3 钩子让业务 *Forge 通过配置注册可进化智能体，符合"配置驱动 > 代码继承"原则

### 负面后果

- 四入口共用 ForgekinHost 增加 host 层复杂度（需维护 InvocationChannel 分发表）
- IDE 入口（特别是 Trae IDE）需要适配 SSE 流式语义，IDE 侧需新增协议适配层
- Plugin V3 是 V2 的破坏性升级，已有 *Forge 插件需迁移（Phase 0 工作量）

### 风险

- 入口语义统一可能损失入口特有能力（如 IDE 入口的代码补全不能简单映射到 CLI）—— 缓解：通过 `on_invocation_channel` 钩子让 Plugin 声明入口差异
- DI 容器是单点故障 —— 缓解：DI 容器实现 Tier 1-4 恢复分级（见 ADR 010）
- Plugin V3 迁移期间 V2/V3 并存可能引入治理规则漏洞 —— 缓解：迁移期 V2 plugin 强制走 fallback guardrail，禁止跨 plugin 调用

---

## 替代方案

### 方案 A: 每个入口独立实现 agent 加载

- 优点：入口间完全解耦，可针对入口优化（如 CLI 用同步阻塞）
- 缺点：能力画像/Harness 表面/治理规则要在四处重复实现，违反真相源唯一原则
- 未选择原因：违反编程红线 7（禁止在修复问题时修改不相关代码），且无法保证治理一致性

### 方案 B: 直接继承 BaseAgent 实现各类入口

- 优点：实现简单，复用面向对象继承
- 缺点：违反编程红线 9（禁止用继承替代组合/插件），且 BaseAgent 子类膨胀
- 未选择原因：roleagent.md 明确 agent 不是固定岗位，继承会让"role vs profile"边界模糊

### 方案 C: 把入口逻辑塞进 LLMClient 路由层

- 优点：复用已有 LLMClient 跨厂商路由
- 缺点：LLMClient 仅做模型路由，未抽象 provider 运维语义（RA-041 已识别此问题）
- 未选择原因：会让 LLMClient 承担过多职责，违反单一职责原则

---

## 引用

- `[doc:roleagent.md#第3章]` — Harness：让模型完成现实闭环的运行时
- `[doc:review/review.md#第八章]` 8.3 节 — RA-017~RA-023 Harness 现实闭环运行时补审
- `[doc:review/review.md#第十三章]` 13.3 节 — CL-014~CL-017 Agent Provider Plugin 补审
- `[doc:features/F002-teamact-loop.md]` — TeamAct 六步循环（SSE 协议契约来源）
- `[doc:features/F031-external-agent-adapter.md]` — 三方 Agent 适配层
- 前期 host-owned 安全注入模型（已归档） — host-owned 安全注入模型
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（ForgekinHost 调用的路由依据）
- `[doc:decisions/007-harness-engineering.md]` — Harness 工程路径（七层表面如何被调用）
- `[doc:decisions/010-distributed-reliability.md]` — 分布式可靠性（host 层的恢复分级）
- `[doc:design/naming-contract.md#2.2]` — Forgekin（可进化智能体）
- `[doc:project_rules.md#红线3]` — 禁止绕过 DI 容器直接实例化
- `[doc:project_rules.md#红线5]` — 禁止硬编码路径和密钥
- `[doc:project_rules.md#红线9]` — 禁止用继承替代组合/插件
- `[doc:project_rules.md#红线10]` — 禁止在 flowforge 中写死业务领域代码
