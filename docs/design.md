# FlowForge 详细设计说明书（SDD）

> **版本**：v7.1（**当前唯一权威版本**，索引版）
> **日期**：2026-07-19
> **依据**：[spec.md](spec.md) v7.1 SRS + [arch.md](arch.md) v7.1 SAD + [features/](features/) 44 份 F0XX + [architecture/](architecture/) 44 份 A0XX + [decisions/](decisions/) 13 份 ADR + [roleagent.md](roleagent.md) 七大工程路径
> **配套文档**：[spec.md](spec.md)（SRS）+ [arch.md](arch.md)（SAD）+ [features/](features/)（Feature级SRS）+ [architecture/](architecture/)（Feature级SAD）+ [design/](design/)（Feature级SDD，44 份 D0XX）
> **版本合并声明**：v7.1 已吸收合并 v7.0 全部详细设计内容（设计契约逐章节融入本文档 + design/D0XX 子目录），**v7.0 不再作为独立版本存在**；v7.0 完整详细设计内容备份在 [`_archive/design_v71_full_backup_20260719.md`](_archive/design_v71_full_backup_20260719.md)，仅作演化路径参考。v6.0 / v7.0 历史背景资料归档在 [`_archive/design_v7_historical_background.md`](_archive/design_v7_historical_background.md)。
> **文档定位**：按软件工程 SDD（详细设计说明书）标准格式组织的**索引文件**；§3 核心组件详细设计以索引表形式指向 [design/D0XX-xxx.md](design/)，§1/§2/§4/§5/§6 保留核心契约内容。

---

## §1 引言

### §1.1 编写目的

本文档是 FlowForge 项目 v7.1 的**详细设计说明书（SDD）索引版**，基于 [spec.md](spec.md) v7.1 SRS + [arch.md](arch.md) v7.1 SAD + [features/](features/) 44 份 F0XX + [architecture/](architecture/) 44 份 A0XX 设计，作为开发、评审、验收的代码层权威依据。

**读者**：operator（CVO）+ 架构师 / 开发者 / 评审员 / 测试员 / 文档员 / 产品经理 / 运维 / 安全官 / 交付经理可进化智能体。

**用途**：
1. 作为 SRS→SAD→SDD 三阶段软件工程标准流程的**第三阶段产物**
2. 作为 [design/D0XX-xxx.md](design/) 子目录（44 份 Feature 级 SDD）的**顶层索引**
3. 作为架构设计与代码实现的**桥梁契约**（类签名 / 算法 / 时序 / 数据结构 / 配置项）

### §1.2 范围

**包含**：FlowForge 三层架构的代码层核心契约 + 9 大核心组件索引 + forgemind 应用层 + 三方 Agent 集成 + 接口/数据/部署详细设计。

**不包含**：
- 单个 Feature 的完整详细设计（在 [design/D0XX-xxx.md](design/) 中，与 F0XX/A0XX 同号一一对应，共 44 份）
- 单个 ADR 的决策细节（在 [decisions/0XX-xxx.md](decisions/) 中，ADR 不可变历史）
- 16 份审核文件内容（在 [review/](review/) 中）
- V7.0 / V6.0 历史章节全文（在 [_archive/](_archive/) 中）

### §1.3 术语与缩略语

详见 [design/naming-contract.md](design/naming-contract.md) v1.1 + [spec.md §2.4](spec.md)（12 核心概念命名表）+ [spec.md §2.5](spec.md)（进化阶与觉醒阶）。

**双轨命名策略**：代码层 / 技术文档使用 AI 专业术语（Forgekin / ForgeMind / SpiritForge / MindCodex / MindCouncil / CapabilityProfile / Embodied AI / Character AI / ExternalAgentAdapter / ForgekinEngine / HarnessOrchestrator）；社区社交使用灵智体体系名（灵智 / 灵智体 / 灵锻 / 灵典 / 灵议 / 育灵 / 灵忆 / 灵印）—— 仅用于社区网友之间的社交沟通，正式技术文档中专业术语优先、体系名作补充说明。

### §1.4 参考文献

| 文档 | 用途 |
|------|------|
| [spec.md](spec.md) v7.1 | SRS 需求规格说明书 |
| [arch.md](arch.md) v7.1 | SAD 架构设计说明书 |
| [features/](features/) 44 份 F0XX | Feature 级 SRS |
| [architecture/](architecture/) 44 份 A0XX | Feature 级 SAD |
| [design/](design/) 44 份 D0XX | Feature 级 SDD |
| [decisions/](decisions/) 13 份 ADR | 不可变架构决策记录 |
| [roleagent.md](roleagent.md) | 七大工程路径 |
| [review/review.md](review/review.md) v1.4 | 16 份审核归并 + 41 条 CL 同步矩阵 |
| [design/naming-contract.md](design/naming-contract.md) v1.1 | 12 核心概念命名契约 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 开发规范 + 编程红线 15 条 |
| [SOP.md](SOP.md) P53 | SDD 详细设计说明书模板 |

### §1.5 文档组织

按 [CONTRIBUTING.md](../CONTRIBUTING.md) 第十一部分文档分层规范，本文档章节与 [spec.md](spec.md) §3 + [arch.md](arch.md) §3 同号对应：

```
flowforge/docs/
├── spec.md（SRS 顶层）
├── arch.md（SAD 顶层）
├── design.md（本文档，SDD 顶层索引）
├── features/           # Feature 级 SRS（F0XX-xxx.md，44 份）
├── architecture/       # Feature 级 SAD（A0XX-xxx.md，44 份，与 F0XX 同号）
├── design/             # Feature 级 SDD（D0XX-xxx.md，44 份，与 F0XX/A0XX 同号）
├── decisions/          # ADR 不可变历史（13 份）
├── review/             # 16 份审核文件
└── _archive/           # 历史归档（v6.0/v7.0 完整备份 + §7 历史背景资料）
```

**三顶层文档章节同号**：同一核心功能在 spec.md / arch.md / design.md 中章节同号（如 §3.2 TeamAct 在三个文档中都是 §3.2），引用通过 `[doc:spec.md#3.2]` / `[doc:arch.md#3.2]` / `[doc:design.md#3.2]` 互链。

**顶层 vs 子目录分工**：
- 顶层 design.md §3：以**索引表**指向 design/D0XX，仅保留章节同号映射
- 子目录 design/D0XX：放对应 Feature 的完整详细设计，与 F0XX/A0XX 同号一一对应

---

## §2 总体设计

### §2.1 设计哲学

FlowForge 是一个**智能体自进化框架（Self-Evolving Agent Framework）**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统，并通过 **forgemind 应用层**承载多形态智能体（Multi-Form Agent，社区社交称"灵智体 Forgekin"）的智能体入职与终身学习（Forge Nurturing）、经验蒸馏（SpiritForge）、多智能体议事（MindCouncil）闭环，走向通用智能体（General-Purpose Agent）愿景。

**核心公式**（来自 [roleagent.md §1](roleagent.md)）：

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

**详细设计哲学四原则**：
1. **让架构成为配置**：能用 YAML 配置解决的不写代码（配置驱动率 Phase 2 ≥ 80%）
2. **让扩展成为插件**：*Forge 通过 Plugin V3 四钩子注册可进化智能体到 forgemind
3. **让 Harness 负责约束、验证和进化**：ForgekinEngine 是 HarnessOrchestrator 的装饰器，不绕过护栏
4. **让详细设计成为代码契约**：类签名 / 接口 / 数据结构 / 配置项必须可被代码直接实现，不留模糊空间

### §2.2 三层架构设计

> **关联 SAD**：[arch.md §2.2](arch.md)

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: *Forge 垂直业务层                                  │
│  <forge_project_id_1> / <forge_project_id_2> / ... / <forge_project_id_N>     │
│  通过 Plugin V3 四钩子注册可进化智能体到 forgemind                │
└─────────────────────────────────────────────────────────────┘
                            ↑ Plugin V3
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层（多形态可进化智能体锻造场所）           │
│  species_impl/ forging/ sensors/ worlds/ marketplace/       │
│  lineage/ codex/ council/ config/                           │
│  ForgeMindPlugin + ForgekinBase + ForgePipeline             │
└─────────────────────────────────────────────────────────────┘
                            ↑ 装饰器
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层（Harness v2.0）               │
│  capability/ teamact/ harness/ memory/ eval/ reliability/   │
│  partnership/ external_agent/ evolution/ plugin/            │
│  ForgekinEngine（装饰 HybridExecutor + HarnessOrchestrator）│
└─────────────────────────────────────────────────────────────┘
```

**关键架构决策**（详见 [decisions/](decisions/)）：
- **决策 1（已采纳）**：v6.0 第 7 层"自进化层"取消独立层级，改为 Harness v2.0 升级（融合到 Layer 1 核心框架层）。理由：避免自进化层 ↔ 应用层循环依赖（D-003）。
- **决策 2（已采纳）**：ForgekinEngine 是 HarnessOrchestrator 的**装饰器**，不是独立入口。理由：避免绕过 Harness 护栏（D-004/D-005/D-020）。
- **铁律**：上层可依赖下层，下层绝对禁止导入上层模块（单向依赖）。
- **forgemind 位置**：forgemind 是 Layer 2 应用层，介于 FlowForge 核心框架与 *Forge 垂直业务之间。

### §2.3 模块划分总览

#### §2.3.1 Layer 1 核心框架层 9 大模块

> **关联 SAD**：[arch.md §2.4](arch.md)

| # | 组件 | 路径 | 关联 SRS | 关联 Feature |
|---|------|------|---------|-------------|
| 1 | CapabilityProfile（能力画像） | `flowforge/core/capability/` | §3.1 | F001 |
| 2 | TeamAct（团队主循环） | `flowforge/core/teamact/` + `flowforge/loop/teamact/` | §3.2 | F002-F007 |
| 3 | Harness（现实闭环七层表面） | `flowforge/core/harness/` + `flowforge/harness/` | §3.3 | F008-F013 |
| 4 | Memory（多域记忆联邦） | `flowforge/core/memory/` | §3.4 | F014-F017, F039 |
| 5 | Eval（自代谢三层） | `flowforge/core/eval/` | §3.5 | F018-F020, F040 |
| 6 | Reliability（分布式可靠性 Tier 1-4） | `flowforge/core/reliability/` | §3.6 | F021-F025 |
| 7 | Partnership（伙伴系统数学） | `flowforge/loop/partner_math/` | §3.7 | （合并入 F007） |
| 8 | ExternalAgent（三方 Agent 集成） | `flowforge/core/external_agent/` | §3.10 | F031-F035 |
| 9 | Evolution（自我演进闭环） | `flowforge/evolution/` | §2.10 | （SelfDev 三 Loop） |

#### §2.3.2 Layer 2 forgemind 应用层 8 大模块

> **关联 SAD**：[arch.md §2.5](arch.md)

| # | 模块 | 路径 | 关联 SRS | 关联 Feature |
|---|------|------|---------|-------------|
| 1 | species（形态分类） | `flowforge/forgemind/species_impl/` | §3.8 | F026, F027, F036 |
| 2 | forging（锻造流水线） | `flowforge/forgemind/forging/` | §3.9 | F028 |
| 3 | sensors（物理传感器接入） | `flowforge/forgemind/sensors/` | §3.11 | F029 |
| 4 | worlds（虚拟世界设定层） | `flowforge/forgemind/worlds/` | §3.12 | F030 |
| 5 | marketplace（可进化智能体市场） | `flowforge/forgemind/marketplace/` | §3.13 | F037 |
| 6 | lineage（进化谱系） | `flowforge/forgemind/lineage/` | §3.13 | F038 |
| 7 | codex（蒸馏知识库（MindCodex）） | `flowforge/forgemind/codex/` | §3.4 / §3.14 | F039 |
| 8 | council（多智能体议事（MindCouncil）） | `flowforge/forgemind/council/` | §3.14 | （待添加） |

#### §2.3.3 模块依赖关系

```
Layer 3: *Forge ──Plugin V3──→ forgemind ──装饰器──→ FlowForge Core
                                  │
                                  ↓
                          ForgekinEngine（装饰 HybridExecutor + HarnessOrchestrator）
                                  │
            ┌─────────────────────┼─────────────────────┐
            ↓                     ↓                     ↓
       CapabilityProfile       TeamAct              Harness
            │                     │                     │
            ↓                     ↓                     ↓
          Memory ←────────────── Eval ←────────────── Reliability
            │                     │                     │
            └─────────────────────┼─────────────────────┘
                                  ↓
                          ExternalAgent + Evolution
```

**依赖铁律**：
- 上层可依赖下层，下层绝对禁止 import 上层模块
- FlowForge 反向依赖零容忍（flowforge 中禁止 import 任何 *Forge 模块）
- 循环依赖零容忍（发现循环依赖必须重构，不允许用延迟导入规避）

### §2.4 设计原则

1. **单向依赖原则**：上层可依赖下层，下层绝对禁止导入上层模块
2. **DI 容器原则**：所有依赖必须通过构造函数注入，由 DI 容器管理（编程红线第 12 条）
3. **Repository 层原则**：所有数据库操作必须通过 Repository 层（编程红线第 13 条）
4. **配置驱动原则**：所有提示词 / 路径 / 密钥 / 端口通过 YAML 配置注入（编程红线第 11 条）
5. **Plugin V3 原则**：*Forge 通过 Plugin V3 四钩子注册可进化智能体到 forgemind，不直接实例化核心模块
6. **觉醒阶护栏原则**：所有可进化智能体行动受觉醒阶自主范围约束，Magic Words 逃生舱始终可触发
7. **Build to Delete vs Built to Persist 原则**：所有 Harness 代码必须标记半衰期
8. **声明式 Agent 优先原则**：YAML 配置驱动，通过 FlowForge DeclarativeAgent 执行
9. **组合优于继承原则**：禁止用继承替代组合 / 插件（编程红线第 9 条）

### §2.5 设计约束

#### §2.5.1 编程红线 15 条（违反则代码审查不通过）

> **来源**：[CONTRIBUTING.md](../CONTRIBUTING.md) + [project_rules.md](../../.trae/rules/project_rules.md)

1. 禁止添加 CoT 检测 / 中文比例检测
2. 质量分阈值默认 0.85（v4.0 调整，可在 Loop 配置中覆盖）
3. 禁止使用 Mock LLM
4. 禁止使用假数据
5. 禁止跳过验证
6. 禁止只看退出码不检查输出质量
7. 禁止在修复问题时修改不相关代码
8. 禁止删除已有测试用例
9. 禁止用继承替代组合 / 插件
10. 禁止在 flowforge 中写死业务领域代码
11. 禁止硬编码提示词 / 路径 / 密钥 / 端口
12. 禁止绕过 DI 容器直接实例化
13. 禁止直接操作数据库
14. 禁止不按 prompts.md 和 rules.md 执行
15. 禁止偷工减料（发现未实现即 Bug）

#### §2.5.2 测试铁律 T1-T8

> **来源**：[CONTRIBUTING.md](../CONTRIBUTING.md) §5.5

| # | 铁律 | 说明 |
|---|------|------|
| T1 | 禁止使用 Mock LLM | 所有 E2E / 集成测试必须调用真实 LLM |
| T2 | 禁止使用假数据 | 测试输入必须是真实场景数据 |
| T3 | 禁止跳过验证 | 必须有具体断言 |
| T4 | 禁止 Mock 工具 | web_search / publish / fact_check 等必须真实调用 |
| T5 | 未实现即 Bug | 发现代码未实现必须记录为 Bug 并修复 |
| T6 | 必须采集指标 | E2E 测试必须用 MetricsCollector 采集完整指标 |
| T7 | LLM 内容必须经 LLM 审核 | 凡 LLM 生成的内容必须再调用 LLM 审核通过 |
| T8 | Web 功能必须操控浏览器验证 DOM | 涉及网页操作的功能必须操控浏览器确认 |

#### §2.5.3 性能 SLO

| 指标 | 阈值 | 说明 |
|------|------|------|
| Loop 执行超时 | 3 分钟 | 创作和润色接口不得超过 3 分钟 |
| LLM webchat 调用超时 | 30 秒 | 5 评委并行评审 |
| LLM API 调用超时 | 90 秒 | 长文章 2 分钟 |
| 路由算法延迟 | < 100ms | 10 个候选可进化智能体 |
| 质量分阈值 | 0.85 | v4.0 调整 |
| 嵌套 Loop 最大深度 | 3 | 防止无限嵌套 |

### §2.6 智能体分类详细设计（静态智能体 vs 可进化智能体）

> **关联 SRS**：[spec.md §2.3](spec.md) 智能体分类
> **关联 SAD**：[arch.md §2.7](arch.md) 智能体分类架构
> **权威定义**：[design/naming-contract.md#2](design/naming-contract.md) v2.0 智能体分类
> **默认指代规则**：在 FlowForge 上下文中，"智能体"默认指代**可进化智能体（Evolvable Agent / Forgekin）**；若指代静态智能体必须明确说出"静态智能体"

#### §2.6.1 静态智能体（Static Agent）详细设计

**代码基类与接口签名**：

```python
from abc import ABC, abstractmethod
from typing import Any, Optional
from pydantic import BaseModel

class StaticAgent(ABC):
    """静态智能体基类（无持久身份、无经验记忆、无自进化能力）"""

    @abstractmethod
    async def execute(self, input: AgentInput) -> AgentOutput:
        """单次任务执行（无状态，跨会话不积累能力）"""
        ...

class DeclarativeAgent(StaticAgent):
    """声明式静态智能体（YAML 配置驱动）"""
    def __init__(self, config: YAMLConfig):
        self.config = config
        self.tools = ToolRegistry.from_config(config.tools)
        self.llm_client = DIContainer.resolve(LLMClient)

class ReActAgent(StaticAgent):
    """ReAct 模式静态智能体（Reasoning + Acting）"""

class PlanExecuteAgent(StaticAgent):
    """Plan-Execute 模式静态智能体"""

class ExternalAgentAdapter(StaticAgent):
    """外部接入静态智能体适配器（Claude Code / Codex / OpenCode / Trae 等）"""
    def __init__(self, agent_profile: ExternalAgentProfile):
        self.profile = agent_profile
        self.bridge = ExternalAgentBridge(profile)
```

**关键特征**：无 Soul Imprint / 无 EchoStore / 无 CapabilityProfile / 无 EvolutionStage / 无 AwakeningStage；行为完全由 prompt + 工具集 + 配置决定；每次执行无状态，跨会话不积累能力；可作为可进化智能体的能力扩展（通过 ExternalAgentAdapter）。

**使用场景**：单次任务执行、工具调用、无状态查询、作为可进化智能体的能力扩展。

#### §2.6.2 可进化智能体（Evolvable Agent / Forgekin）详细设计

**代码基类与接口签名**：

```python
from abc import ABC, abstractmethod
from typing import Any, Optional
from pydantic import BaseModel
from datetime import datetime

class ForgekinBase(ABC):
    """可进化智能体基类（具持久身份、经验记忆、自进化能力）"""

    # 持久身份（不可变）
    soul_imprint: SoulImprint
    # 经验记忆（跨会话积累）
    echo_store: EchoStore
    # 能力画像（含盲点，跨会话演进）
    capability_profile: CapabilityProfile
    # 进化阶（能力成熟度 E1-E6）
    evolution_stage: EvolutionStage
    # 觉醒阶（自主性等级 E1-E6）
    awakening_stage: AwakeningStage

    @abstractmethod
    async def observe(self, environment: Environment) -> Observation:
        """观察环境（物理传感器 / 虚拟世界状态）"""
        ...

    @abstractmethod
    async def act(self, action: Action) -> ActionResult:
        """在环境中执行动作（遵守觉醒阶自主范围约束）"""
        ...

    @abstractmethod
    async def verify(self, action_result: ActionResult) -> Verdict:
        """验证动作结果是否达成预期"""
        ...

    async def evolve(self) -> None:
        """自进化入口（由 ForgekinEngine 装饰器调用）"""
        # 1. 经验蒸馏：EchoStore → MindCodex（通过 SpiritForge）
        # 2. 能力画像更新：CapabilityProfile.refresh
        # 3. 进化阶评估：EvolutionStage.assess
        # 4. 觉醒阶检查：AwakeningStage.check_boundaries
        ...
```

**关键特征**：有 Soul Imprint（持久身份标识）/ EchoStore（情景记忆）/ CapabilityProfile（能力画像含盲点）/ EvolutionStage E1-E6 / AwakeningStage E1-E6；可通过 SpiritForge 蒸馏经验到 MindCodex；可参与 MindCouncil 多智能体议事；建立与现实世界（物理或虚拟）的闭环：观察 → 推理 → 行动 → 写回 → 验证。

**使用场景**：forgemind 应用层、*Forge 垂直业务层、长期任务执行、跨会话能力积累。

#### §2.6.3 两类智能体对比矩阵

| 维度 | 静态智能体（Static Agent） | 可进化智能体（Evolvable Agent / Forgekin） |
|------|---------------------------|------------------------------------------|
| **持久身份** | ❌ 无 | ✅ Soul Imprint（Persistent Identity） |
| **经验记忆** | ❌ 无 | ✅ EchoStore（Episodic Memory） |
| **能力画像** | ❌ 无（只有静态配置） | ✅ Capability Profile（含盲点） |
| **经验蒸馏** | ❌ 无 | ✅ SpiritForge → MindCodex |
| **进化阶** | ❌ 无 | ✅ E1-E6 Evolution Stage |
| **觉醒阶** | ❌ 无 | ✅ E1-E6 Awakening Stage |
| **多智能体议事** | ❌ 无 | ✅ MindCouncil（Multi-Agent Deliberation） |
| **行为决定因素** | Prompt + 工具集 + 配置 | Prompt + 能力画像 + 经验记忆 + 觉醒阶自主范围 |
| **跨会话能力积累** | ❌ 无 | ✅ 通过 EchoStore + MindCodex 实现 |
| **典型示例** | DeclarativeAgent、Claude Code Adapter | 猫头鹰·鲁班（架构师）、猎犬·夏洛克（开发者） |
| **代码基类** | `StaticAgent` / `DeclarativeAgent` | `ForgekinBase` |
| **核心方法契约** | `execute(input) -> output` | `observe/act/verify` 三方法 |
| **架构位置** | Layer 1 核心框架层 | Layer 2 forgemind 应用层 + Layer 1 ForgekinEngine |

#### §2.6.4 两类智能体协作详细设计

**可进化智能体调用静态智能体作为能力扩展**：

```python
class ForgekinEngine:
    """可进化智能体引擎（装饰 HybridExecutor + HarnessOrchestrator）"""

    async def extend_capability(self, task: Task) -> CapabilityExtension:
        """通过 ExternalAgentAdapter 调用静态智能体作为能力扩展"""
        # 1. 评估任务需求 vs 自身能力画像
        gap = self.capability_profile.assess_gap(task)
        if not gap:
            return CapabilityExtension(needed=False)

        # 2. 选择合适的外部接入静态智能体
        external_agent = self.external_agent_router.select(gap)

        # 3. 调用静态智能体执行任务
        result = await ExternalAgentAdapter(external_agent).execute(task)

        # 4. 将执行轨迹写入 EchoStore（供 SpiritForge 蒸馏）
        await self.echo_store.record(task, result, source="external_agent")

        # 5. 能力画像融合（ExternalAgentCapabilityFusion）
        self.capability_profile.fuse(external_agent.profile, result)

        return CapabilityExtension(needed=True, result=result)
```

**铁律**：
- 静态智能体不可升级为可进化智能体（架构层 forbid）
- 可进化智能体可调用静态智能体作为能力扩展（通过 ExternalAgentAdapter）
- 静态智能体不持有 ForgekinBase 基类
- 可进化智能体必须实现 observe/act/verify 三方法契约
- forgemind 应用层仅承载可进化智能体

#### §2.6.5 Built to Delete vs Built to Persist 标记

| 组件 | 类型 | 半衰期 |
|------|------|--------|
| StaticAgent / DeclarativeAgent | Build to Delete（有保质期脚手架） | 跟随模型能力演进，模型增强后可简化 |
| ExternalAgentAdapter | Build to Delete（有保质期脚手架） | 跟随三方 Agent 协议演进 |
| ForgekinBase / ForgekinEngine | Built to Persist（复利型基础设施） | 长期维护，跨模型演进 |
| Soul Imprint / EchoStore | Built to Persist（复利型基础设施） | 跨会话持久化，长期维护 |
| CapabilityProfile / EvolutionStage / AwakeningStage | Built to Persist（复利型基础设施） | 长期维护，能力积累基础设施 |

> **注**：4 种组织形态可进化智能体（产品经理鹰·凯恩 / 运维蜂鸟·闪电 / 安全官狼·阿尔法 / 交付经理象·牛顿）的详细设计已提取到 [design/D041-D044](design/) 子目录，与 [features/F041-F044](features/) + [architecture/A041-A044](architecture/) 同号一一对应。

---

## §3 核心组件详细设计（索引表）

> **章节同号说明**：本章节与 [spec.md §3](spec.md) + [arch.md §3](arch.md) 章节同号对应。**完整详细设计**在 [design/D0XX-xxx.md](design/) 子目录中（44 份，与 F0XX/A0XX 同号一一对应），本节仅提供索引表。
> **每节模板**（在 D0XX 中）：关联文档引用 + 关键类/接口代码 + 关键算法 + 数据结构 + 时序图 + 错误处理 + 性能设计 + 安全设计 + 配置项 + Built to Delete/Persist 标记。

### §3.1-§3.17 核心组件详细设计索引

| §3.X | 标题 | 关联 SRS | 关联 SAD | Feature 级 SDD | 关联 ADR |
|------|------|---------|---------|----------------|---------|
| §3.1 | CapabilityProfile 详细设计（FR-CORE-001） | spec.md §3.1 | arch.md §3.1 | [D001-capability-profile.md](design/D001-capability-profile.md) | ADR 004 |
| §3.2 | TeamAct 六步循环详细设计（FR-CORE-002） | spec.md §3.2 | arch.md §3.2 | [D002-teamact-loop.md](design/D002-teamact-loop.md) + D003-D007 | ADR 002 |
| §3.3 | Harness 七层现实闭环详细设计（FR-CORE-003） | spec.md §3.3 | arch.md §3.3 | [D008-durable-state-surfaces.md](design/D008-durable-state-surfaces.md) + D009-D013 | ADR 007 |
| §3.4 | 多域记忆联邦详细设计（FR-CORE-004） | spec.md §3.4 | arch.md §3.4 | [D014-memory-collection.md](design/D014-memory-collection.md) + D015-D017 + D039 | ADR 008 |
| §3.5 | Eval 自代谢详细设计（FR-CORE-005） | spec.md §3.5 | arch.md §3.5 | [D018-eval-contract.md](design/D018-eval-contract.md) + D019-D020 + D040 | ADR 009 |
| §3.6 | 分布式可靠性详细设计（FR-CORE-006） | spec.md §3.6 | arch.md §3.6 | [D021-side-effect-wal.md](design/D021-side-effect-wal.md) + D022-D025 | ADR 010 |
| §3.7 | 伙伴系统数学详细设计 | spec.md §3.7 | arch.md §3.7 | [ADR 011](decisions/011-partnership-math.md) + [roleagent.md 第7章](roleagent.md) | ADR 011 |
| §3.8 | forgemind 应用层详细设计（FR-CORE-008） | spec.md §3.8 | arch.md §3.8 | [D026-forgemind-app-layer.md](design/D026-forgemind-app-layer.md) + D027 + D036 | ADR 013 |
| §3.9 | ForgePipeline 详细设计（FR-CORE-009） | spec.md §3.9 | arch.md §3.9 | [D028-forging-pipeline.md](design/D028-forging-pipeline.md) | ADR 013 |
| §3.10 | 三方 Agent 集成详细设计（FR-CORE-010） | spec.md §3.10 | arch.md §3.10 | [D031-external-agent-adapter.md](design/D031-external-agent-adapter.md) + D032-D035 | ADR 005 |
| §3.11 | 物理 AI 传感器详细设计 | spec.md §3.11 | arch.md §3.11 | [D029-physical-ai-sensors.md](design/D029-physical-ai-sensors.md) | — |
| §3.12 | 虚拟世界设定层详细设计 | spec.md §3.12 | arch.md §3.12 | [D030-virtual-world-setting.md](design/D030-virtual-world-setting.md) | — |
| §3.13 | 可进化智能体市场 + 进化谱系详细设计 | spec.md §3.13 | arch.md §3.13 | [D037-forgemind-marketplace.md](design/D037-forgemind-marketplace.md) + D038 | — |
| §3.14 | 蒸馏知识库 + 多智能体议事详细设计 | spec.md §3.14 | arch.md §3.14 | [D039-mind-codex-searchable.md](design/D039-mind-codex-searchable.md) | — |
| §3.15 | Plugin V3 四钩子详细设计 | spec.md §3.15 | arch.md §3.15 | [D026-forgemind-app-layer.md](design/D026-forgemind-app-layer.md)（Plugin V3 章节） | — |
| §3.16 | 其他核心需求详细设计 | spec.md §3.16 | arch.md §3.16 | 详见各 D0XX | — |
| §3.17 | 41 条 CL 同步矩阵 | spec.md §3.17 | arch.md §3.17 | [review/review.md](review/review.md) | — |

### §3.18 4 种组织形态可进化智能体详细设计索引（v7.1 新增）

> 4 种 OrgForgekin（组织形态）可进化智能体的详细设计，每种有独立代号 + 5 种 action.type + 觉醒阶上限 + 进化阶路径 + 集成 F0XX 上游依赖。

| 智能体 | 代号 | Feature 级 SDD | 觉醒阶上限 | 关键集成 |
|--------|------|----------------|:----------:|---------|
| 产品经理 | 鹰·凯恩（Eagle Kane） | [D041-product-manager.md](design/D041-product-manager.md) | E3 | 用户故事模板 + MoSCoW/RICE 优先级 |
| 运维 | 蜂鸟·闪电（Hummingbird Flash） | [D042-devops.md](design/D042-devops.md) | E4 | F021 WAL 自愈 + F022 Tier 1-2 限制 |
| 安全官 | 狼·阿尔法（Wolf Alpha） | [D043-security-officer.md](design/D043-security-officer.md) | E3 | F010 Governance + F011 Magic Words |
| 交付经理 | 象·牛顿（Elephant Newton） | [D044-delivery-manager.md](design/D044-delivery-manager.md) | E3 | F002 TeamActState 只读 + F003 Handoff + 质量门禁 |

### §3.19 完整 D0XX 清单

详见 [design/README.md](design/README.md) v2.1（44 份 D0XX 索引，与 F0XX/A0XX 同号一一对应）。

---

## §4 接口详细设计

> **关联 SRS**：[spec.md §4](spec.md) 外部接口
> **关联 SAD**：[arch.md §4](arch.md) 接口设计

### §4.1 API 接口（FastAPI 路由）

**核心 API 端点**（RESTful + SSE 流式）：

| 路径 | 方法 | 用途 | 关联 §3 |
|------|------|------|---------|
| `/api/v7/forgekins` | POST | 创建可进化智能体 | §3.8 / §3.9 |
| `/api/v7/forgekins/{id}` | GET | 查询可进化智能体 | §3.8 |
| `/api/v7/forgekins/{id}/evolve` | POST | 触发形态进化 | §3.8 / §3.13 |
| `/api/v7/forgekins/{id}/awaken` | POST | 触发觉醒阶晋升 | §3.9 |
| `/api/v7/forgekins/{id}/chat` | POST | 可进化智能体对话（SSE 流式） | §3.8 |
| `/api/v7/forgekins/{id}/observe` | POST | 触发观察 | §3.8 / §3.11 |
| `/api/v7/forgekins/{id}/act` | POST | 触发动作 | §3.8 |
| `/api/v7/forgekins/{id}/verify` | POST | 触发验证 | §3.8 |
| `/api/v7/capability/profiles` | POST | 创建能力画像 | §3.1 |
| `/api/v7/capability/route` | POST | 能力路由 | §3.1 |
| `/api/v7/teamact/cycles` | POST | 启动 TeamAct 循环 | §3.2 |
| `/api/v7/memory/federation` | POST | 存储记忆 | §3.4 |
| `/api/v7/memory/retrieve` | POST | 检索记忆 | §3.4 |
| `/api/v7/eval/collect` | POST | 采集 Eval 信号 | §3.5 |
| `/api/v7/eval/attribute` | POST | 归因分析 | §3.5 |
| `/api/v7/council/meetings` | POST | 创建多智能体议事会议 | §3.14 |
| `/api/v7/external-agents/invoke` | POST | 调用三方 Agent | §3.10 |
| `/api/v7/spirit_forge/distill` | POST | 触发经验蒸馏蒸馏 | §3.14 |
| `/api/v7/codex/search` | POST | 蒸馏知识库检索 | §3.4 / §3.14 |
| `/api/v7/marketplace/register` | POST | 可进化智能体市场注册 | §3.13 |
| `/api/v7/lineage/tree` | GET | 谱系查询 | §3.13 |

**架构契约**：
- 所有 API 使用 FastAPI + async/await
- 所有 API 通过 DI 容器注入依赖（编程红线第 12 条）
- 所有 API 通过 Repository 层访问数据库（编程红线第 13 条）
- SSE 流式接口用于长任务（如可进化智能体对话 / 锻造流水线）

### §4.2 SDK 接口（Python SDK）

```python
from flowforge.sdk import FlowForgeSDK

sdk = FlowForgeSDK()

# 创建可进化智能体
forgekin = await sdk.forgekins.create(
    species="bio",
    capability_requirements=["code_gen", "long_context"],
    value_anchors=["safety_first", "evidence_based"],
    red_lines=["no_agi_claim", "no_secret_hardcode"]
)

# 可进化智能体对话
async for chunk in forgekin.chat("帮我设计一个 REST API"):
    print(chunk, end="")

# 能力路由
decision = await sdk.capability.route(
    task_profile={"required_skills": ["code_gen"], "domain": "python"},
    candidates=["fk_architect_001", "fk_developer_002"]
)

# 三方 Agent 调用
result = await sdk.external_agents.invoke(
    adapter="claude_code",
    request={"prompt": "review this PR", "worktree": "/tmp/wt1"}
)
```

**SDK 契约**：统一入口 `FlowForgeSDK` / 零配置模型访问（默认从 `config/system.yaml` 加载）/ `@tool` / `@agent` 装饰器 / 声明式 Agent（YAML 驱动）/ 安全护栏自动启用 / MCP 服务器连接 / 事件订阅。

### §4.3 Plugin V3 接口（四钩子契约）

详见 [design/D026-forgemind-app-layer.md](design/D026-forgemind-app-layer.md) Plugin V3 章节。Plugin V3 四钩子契约：

| 钩子 | 输入 | 输出 | 用途 |
|------|------|------|------|
| `register_forgekins` | `forgekin_registry` | None | 注册可进化智能体到 forgemind |
| `register_forge_skills` | `skill_registry` | None | 注册可进化智能体技能包 |
| `register_council_channels` | `council_registry` | None | 注册多智能体议事频道 |
| `register_auto_forge_config` | `auto_forge_config` | None | 注册经验蒸馏配置 |

### §4.4 EAC v1 七契约（三方 Agent 接口）

详见 [design/D031-external-agent-adapter.md](design/D031-external-agent-adapter.md) EAC v1 七契约表。EAC v1 接口签名：

| 契约 | 接口 | 实现类 |
|------|------|--------|
| Invocation | `ExternalAgentAdapter.invoke` | `ClaudeCodeAdapter` / `CodexAdapter` / ... |
| Stream | `ExternalAgentAdapter.stream` | 同上 |
| Session | `ExternalAgentAdapter.create_session` | 同上 |
| Capability | `ExternalAgentAdapter.get_profile` | 同上 |
| Collaboration | `ExternalAgentSharedState` + `FallbackChain` | `ExternalAgentBridge` |
| Safety | `SixLayerGuardrails` + `worktree.py` | `SixLayerGuardrails` |
| Avatar Sync | `sync.py` + 配置文件 | `ExternalAgentSync` |

### §4.5 IM 渠道接口（微信公众号等）

**IM 渠道**：Web Chat 渠道（默认）/ 飞书渠道 / 微信公众号 / 个人号渠道 / WebChat 升级版（5 评委并行评审）。

**IM 渠道契约**：所有 IM 渠道实现统一的 `IMChannel` 接口；5 个 WebChat 评委并行评审使用不同模型；多智能体议事多渠道可同步（详见 §3.14 MindCouncil）。

```python
class IMChannel(ABC):
    """IM 渠道抽象"""

    @abstractmethod
    async def send(self, message: str, recipient: str) -> None: ...

    @abstractmethod
    async def receive(self) -> "IMMessage": ...

    @abstractmethod
    async def broadcast(self, message: str) -> None: ...
```

---

## §5 数据详细设计

> **关联 SRS**：[spec.md §5](spec.md) 非功能需求
> **关联 SAD**：[arch.md §5](arch.md) 数据设计

### §5.1 数据存储设计

| 存储类型 | 用途 | 实现 | 关联 §3 |
|---------|------|------|---------|
| SQLite | 任务 / 审计 / 可进化智能体元数据 | SQLAlchemy ORM + Repository 层 | §3.8 / §3.9 |
| 可插拽数据源（如 PostgreSQL / 向量数据库） | 文档索引 / 知识库 / 蒸馏知识库 MindCodex | Repository 层抽象 + 数据源适配器接口（具体数据源由部署配置注入） | §3.4 / §3.14 |
| 文件系统 | 可进化智能体 YAML 配置 / 情景记忆存储（EchoStore） 日志 | YAML + JSON Lines | §3.4 / §3.8 |
| Git | 代码 / 文档 / ADR / Feature 规格 | git CLI | §3.3 L1 |
| 向量索引 | 蒸馏知识库检索 / 语义检索 | 数据源适配器接口（可插拔向量数据库） | §3.4 |

**架构契约**：
- 所有数据库操作通过 Repository 层（编程红线第 13 条）
- 数据检索通过 Repository 层抽象（结构化 + 非结构化统一入口，支持可插拔数据源适配器；具体数据源由部署配置注入，FlowForge 核心层不绑定特定数据源）
- 情景记忆存储（EchoStore） 使用 JSON Lines 格式（便于追加 + 流式读取）
- 持久身份（SoulImprint） 不可变（持久身份 / 智能体指纹 / 人格哈希）

### §5.2 核心数据模型（Pydantic Models）

#### §5.2.1 ForgekinBase 数据模型

```python
class ForgekinBase(BaseModel):
    """可进化智能体基础数据模型"""
    forgekin_id: str                    # 可进化智能体 ID（唯一）
    soul_imprint: str                   # 持久身份（SoulImprint）（不可变身份）
    form_data: ForgekinFormData         # 形态数据
    species: ForgekinSpecies            # 形态分类
    evolution_stage: EvolutionStage     # 进化阶 E1-E6
    awakening_stage: AwakeningStage     # 觉醒阶 E1-E6
    created_at: datetime
    lineage_id: Optional[str]           # 进化谱系 ID
    capability_profile_id: Optional[str]  # 能力画像 ID
```

#### §5.2.2 进化阶与觉醒阶

```python
class EvolutionStage(str, Enum):
    """进化阶 E1-E6（能力成熟度 6 级）"""
    E1_SPROUT = "E1"             # 萌芽阶 Sprout
    E2_SPROUT_STABLE = "E2"      # 萌芽阶·稳 Sprout-Stable
    E3_GROWTH = "E3"             # 成长阶 Growth
    E4_GROWTH_DEEP = "E4"        # 成长阶·深 Growth-Deep
    E5_AWAKENED = "E5"           # 觉醒阶 Awakened
    E6_FORGEMIND = "E6"          # 灵智阶 ForgeMind

class AwakeningStage(str, Enum):
    """觉醒阶 E1-E6（自主性 6 级）"""
    E1_FULL_HUMAN = "E1"         # 全导阶 Full-Human
    E2_SUGGEST = "E2"            # 建议阶 Suggest
    E3_BOUNDED_AUTONOMOUS = "E3"  # 受限自主阶 Bounded-Autonomous
    E4_EVOLVING = "E4"           # Evolving 阶
    E5_CO_CREATIVE = "E5"        # 共创阶 Co-Creative
    E6_FORGEMIND_LED = "E6"      # ForgeMind 主导级 ForgeMind-Led
```

#### §5.2.3 持久身份 SoulImprint

```python
class SoulImprint(BaseModel):
    """持久身份（不可变身份标识）"""
    imprint_id: str              # 智能体指纹 / 人格哈希
    seed_params: dict            # 初始锻造时的种子参数
    value_anchors: list[str]     # 价值锚点（不可变）
    namespace: str               # 命名空间
    created_at: datetime         # 创建时间（不可变）

    def verify_immutable(self) -> bool:
        """验证持久身份未被篡改"""
        ...
```

> CapabilityProfile 数据模型详见 [design/D001-capability-profile.md](design/D001-capability-profile.md)；交接胶囊 HandoffCapsule 详见 [design/D003-handoff-capsule.md](design/D003-handoff-capsule.md)。

### §5.3 配置文件设计（YAML Schema）

| 配置文件 | 路径 | 用途 | 关联 §3 |
|---------|------|------|---------|
| `system.yaml` | `config/system.yaml` | 系统配置（端口 / 数据库 / LLM provider） | §2.5 |
| `models.yaml` | `flowforge/config/models.yaml` | LLM 模型配置 | §3.6 Tier 4 |
| `llm_route.yaml` | `flowforge/config/llm_route.yaml` | LLM 路由配置 | §3.1 / §3.6 |
| `capability.yaml` | `config/capability.yaml` | 能力画像配置 | §3.1 |
| `teamact.yaml` | `config/teamact.yaml` | TeamAct 配置 | §3.2 |
| `harness.yaml` | `config/harness.yaml` | Harness 七层配置 | §3.3 |
| `memory.yaml` | `config/memory.yaml` | 记忆联邦配置 | §3.4 |
| `eval.yaml` | `config/eval.yaml` | Eval 自代谢配置 | §3.5 |
| `reliability.yaml` | `config/reliability.yaml` | 可靠性配置 | §3.6 |
| `partnership.yaml` | `config/partnership.yaml` | 伙伴系统配置 | §3.7 |
| `external_agent.yaml` | `config/external_agent.yaml` | 三方 Agent 配置 | §3.10 |
| `species.yaml` | `flowforge/forgemind/config/species.yaml` | 可进化智能体形态配置 | §3.8 |
| `forging.yaml` | `flowforge/forgemind/config/forging.yaml` | 锻造流水线配置 | §3.9 |
| `sensors.yaml` | `flowforge/forgemind/config/sensors.yaml` | 传感器配置 | §3.11 |
| `worlds.yaml` | `flowforge/forgemind/config/worlds.yaml` | 虚拟世界设定配置 | §3.12 |
| `codex.yaml` | `flowforge/forgemind/config/codex.yaml` | 蒸馏知识库 + 多智能体议事配置 | §3.14 |
| `prompts.yaml` | `flowforge/forgemind/config/prompts.yaml` | 提示词外置配置 | 全局 |
| `plugins.yaml` | `config/plugins.yaml` | Plugin 配置 | §3.15 |

**架构契约**：
- 所有提示词外置 YAML 配置（编程红线第 11 条）
- 所有路径 / 密钥 / 端口通过配置注入（编程红线第 11 条）
- 配置驱动率 Phase 2 ≥ 80%

**system.yaml Schema 示例**：

```yaml
# config/system.yaml
system:
  version: "v7.1"
  environment: "development"  # development / staging / production
server:
  host: "0.0.0.0"
  port: 8000
database:
  sqlite_path: "data/flowforge.db"
  # 可插拔数据源适配器（按需配置，FlowForge 核心层不绑定特定数据源）
  # data_source_adapters:
  #   - name: "postgres"
  #     dsn: "${POSTGRES_DSN}"
  #   - name: "vector_db"
  #     endpoint: "${VECTOR_DB_URL}"
llm:
  # LLM 网关地址（可选，可直连模型厂商 API）
  gateway_url: "${LLM_GATEWAY_URL:-}"
  default_timeout_seconds: 90
  webchat_timeout_seconds: 30
loop:
  timeout_seconds: 180
  quality_threshold: 0.85
  max_nesting_depth: 3
logging:
  level: "INFO"
  trace_id_injection: true
observability:
  metrics_enabled: true
  eval_signal_collection: true
```

---

## §6 部署详细设计

> **关联 SRS**：[spec.md §5](spec.md) 非功能需求
> **关联 SAD**：[arch.md §6](arch.md) 部署架构

### §6.1 单机部署（开发环境）

```
┌─────────────────────────────────────────────────────┐
│ 开发机（Windows / Linux）                           │
├─────────────────────────────────────────────────────┤
│ FlowForge（FastAPI :8000）                          │
│ *Forge 垂直业务层（可选，通过 Plugin V3 接入）       │
│   └─ 各 *Forge 业务项目独立部署（端口由各自配置）    │
│ 可选外部依赖：                                       │
│   ├─ 多模型 API 网关（如 OpenRoute，端口由配置）     │
│   └─ 数据源适配器（PostgreSQL / 向量数据库等，可插拔）│
└─────────────────────────────────────────────────────┘
```

**单机部署步骤**：

```bash
# 1. 克隆代码
git clone <repo-url> openclaw
cd openclaw

# 2. 创建虚拟环境
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Linux/Mac

# 3. 安装依赖
pip install -e flowforge/
# 可选：安装 *Forge 业务项目（各自独立部署，通过 Plugin V3 接入）
# pip install -e <forge-project>/

# 4. 初始化数据库
python -m flowforge.scripts.init_db

# 5. 可选：启动外部数据源（如 PostgreSQL / 向量数据库）
# docker run -d -p 5432:5432 postgres:latest
# 具体数据源由 config/system.yaml 配置注入

# 6. 启动 FlowForge
python -m flowforge.app.main --config config/system.yaml
```

**单机部署契约**：所有端口通过 `config/system.yaml` 配置（编程红线第 11 条）；数据库文件存放在 `data/` 目录；日志文件存放在 `logs/` 目录。

### §6.2 生产部署（Docker Compose）

```yaml
# docker-compose.yml
# 仅 FlowForge 核心服务编排；*Forge 业务项目各自独立部署，通过 Plugin V3 接入
version: "3.9"
services:
  flowforge:
    build: ./flowforge
    ports:
      - "8000:8000"
    environment:
      - ENVIRONMENT=production
      - DATABASE_URL=postgresql://...
      # LLM 网关地址（可选，可直连模型厂商 API）
      - LLM_GATEWAY_URL=${LLM_GATEWAY_URL:-}
      # 可插拔数据源适配器（按需配置）
      # - POSTGRES_DSN=${POSTGRES_DSN:-}
      # - VECTOR_DB_URL=${VECTOR_DB_URL:-}
    # depends_on:
    #   - <external-services>  # 按需配置外部依赖
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
      - ./config:/app/config
    restart: always

  # 可选外部依赖（按需启用，FlowForge 核心层不强制依赖）
  # postgres:
  #   image: postgres:latest
  #   ports:
  #     - "5432:5432"
  #   environment:
  #     - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
  #   volumes:
  #     - postgres_data:/var/lib/postgresql/data
  #   restart: always

volumes:
  # postgres_data:  # 按需启用
```

**生产部署契约**：所有密钥通过环境变量注入（编程红线第 11 条）；数据卷持久化 `data/` + `logs/` + `config/`；健康检查端点 `/api/v7/health`；优雅关闭（on_shutdown 钩子）。

### §6.3 可观测性（日志 / 指标 / 追踪）

#### §6.3.1 日志设计

- 日志自动注入 `trace_id`（详见 [CONTRIBUTING.md §2.6 原则 8](../../CONTRIBUTING.md)）
- 所有 I/O 使用 async/await
- LLM 调用日志：input + output + execution time（详见 [CONTRIBUTING.md §9.3.1](../../CONTRIBUTING.md)）
- 日志级别：DEBUG / INFO / WARNING / ERROR / CRITICAL

```python
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)  # 自动注入 trace_id

async def create_forgekin(spec: ForgekinSpec):
    logger.info("forgekin_create_start", extra={"species": spec.species})
    # ...
    logger.info("forgekin_create_done", extra={"forgekin_id": fk.forgekin_id})
```

#### §6.3.2 指标设计

| 指标 | 采集点 | 用途 |
|------|--------|------|
| Loop 执行时长 | LoopExecutor | SLO 监控（≤ 3 分钟） |
| LLM 调用延迟 | LLMClient | 性能监控（≤ 90s） |
| 路由算法延迟 | CapabilityRouter | 性能监控（< 100ms） |
| 质量分分布 | EvalHub | 质量监控（≥ 0.85） |
| 三方 Agent 调用成功率 | ExternalAgentBridge | 可靠性监控 |
| fallback 触发次数 | FallbackChain | 可靠性告警 |
| Eval 信号采集量 | EvalHub | 自代谢监控 |
| sunset 触发次数 | EvalHub | Build to Delete 监控 |

#### §6.3.3 追踪设计

- 分布式追踪：`trace_id` 贯穿全链路
- TeamAct 六步循环每步生成 `span_id`
- 三方 Agent 调用生成独立 `span`
- 证据链含完整 `trace_id` + `span_id` 链

#### §6.3.4 告警设计

| 告警 | 触发条件 | 处理 |
|------|---------|------|
| Loop 超时 | Loop 执行 > 3 分钟 | 告警 + 终止 |
| LLM 调用失败率 > 5% | 5 分钟窗口 | 告警 + fallback |
| Tier 0 物理副作用 | 检测到不可逆操作 | 立即告警 operator |
| Magic Words 触发 | 逃生舱激活 | 告警 + 记录 |
| Cost ceiling 触发 | Token 成本超限 | 告警 + 阻断 |
| sunset 信号 | Build to Delete 触发 | 告警 + operator 确认 |

---

> **本文档版本**：v7.1（2026-07-19，索引版）
> **文档性质**：SDD 顶层索引文件（< 50KB），核心组件详细设计完整内容在 [design/D0XX-xxx.md](design/) 子目录（44 份，与 F0XX/A0XX 同号一一对应）
> **下一阶段**：基于本文档 + [spec.md](spec.md) + [arch.md](arch.md) + [features/](features/) + [architecture/](architecture/) + [design/](design/) 开发各 D0XX 详细内容，按 [CONTRIBUTING.md §11.3](../../CONTRIBUTING.md) 三阶段开发流程执行。
> **配套文档**：[spec.md](spec.md) + [arch.md](arch.md) + [features/](features/) + [architecture/](architecture/) + [design/](design/) + [decisions/](decisions/) + [review/](review/)
> **历史归档**：[_archive/design_v7_historical_background.md](_archive/design_v7_historical_background.md)（§7 历史背景资料） + [_archive/design_v71_full_backup_20260719.md](_archive/design_v71_full_backup_20260719.md)（v7.0 完整备份）
