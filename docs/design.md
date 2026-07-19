# FlowForge 详细设计说明书（SDD）

> **版本**：v7.1（**当前唯一权威版本**）
> **日期**：2026-07-19
> **依据**：[spec.md](spec.md) v7.1 SRS + [arch.md](arch.md) v7.1 SAD + [features/](features/) 40 份 F0XX + [architecture/](architecture/) 40 份 A0XX + [decisions/](decisions/) 13 份 ADR + [roleagent.md](roleagent.md) 七大工程路径
> **配套文档**：[spec.md](spec.md)（SRS）+ [arch.md](arch.md)（SAD）+ [features/](features/)（Feature级SRS）+ [architecture/](architecture/)（Feature级SAD）+ [design/](design/)（Feature级SDD）
> **版本合并声明**：v7.1 已吸收合并 v7.0 全部详细设计内容（设计契约逐章节融入本文档），**v7.0 不再作为独立版本存在**；v7.0 完整详细设计内容备份在 [`_archive/design_v71_full_backup_20260719.md`](_archive/design_v71_full_backup_20260719.md)，仅作演化路径参考。v6.0 历史详细设计章节作为已实现代码的背景资料。
> **文档定位**：按软件工程 SDD（详细设计说明书）标准格式组织，仅放**核心关键功能**详细设计；非核心功能的详细设计在 [design/D0XX-xxx.md](design/) 中，与本文档 §3 章节同号互链。

---

## §1 引言

### §1.1 编写目的

本文档是 FlowForge 项目 v7.1 的**详细设计说明书（SDD）**，基于 [spec.md](spec.md) v7.1 SRS + [arch.md](arch.md) v7.1 SAD + [features/](features/) 40 份 F0XX + [architecture/](architecture/) 40 份 A0XX 设计，作为开发、评审、验收的代码层唯一权威依据。

**读者**：
- **operator（首席愿景官 CVO）**：审核详细设计对愿景锚点的落地
- **架构师可进化智能体（猫头鹰·鲁班）**：维护 [arch.md](arch.md) 与本文档的架构-详细设计一致性
- **开发者可进化智能体（猎犬·夏洛克）**：基于本文档实现代码 + 修复 Bug
- **评审员可进化智能体（孔雀·梵高）**：跨厂商 review 详细设计与代码实现
- **测试员可进化智能体（蜜獾·平头哥）**：基于本文档执行 E2E 测试（T1-T8 铁律）
- **文档员可进化智能体（钢笔·文心）**：维护本文档与 [design/D0XX-xxx.md](design/) 子目录的一致性
- **产品经理可进化智能体（鹰·凯恩）**：基于本文档评估需求可行性 + 产品路线图对齐
- **运维可进化智能体（蜂鸟·闪电）**：基于本文档规划部署架构 + 性能 SLO 落地
- **安全官可进化智能体（狼·阿尔法）**：基于本文档执行安全审计 + 合规检查
- **交付经理可进化智能体（象·牛顿）**：基于本文档跟踪设计完成度 + 协调跨智能体协作

**用途**：
1. 作为 SRS→SAD→SDD 三阶段软件工程标准流程的**第三阶段产物**
2. 作为 [design/D0XX-xxx.md](design/) 子目录文件的**顶层索引**
3. 作为架构设计与代码实现的**桥梁契约**（类签名 / 算法 / 时序 / 数据结构 / 配置项）

### §1.2 范围

**包含**：
- FlowForge 三层架构的代码层详细设计（核心框架层 / forgemind 应用层 / *Forge 垂直业务层）
- 9 大核心组件的类设计 / 接口签名 / 算法伪代码 / 时序图 / 数据结构
- forgemind 应用层的 ForgekinBase / ForgePipeline / ForgekinSpecies 详细设计
- 三方 Agent 集成的 ExternalAgentAdapter + EAC v1 七契约 + 六层 Guardrails 详细设计
- 接口详细设计（FastAPI / SDK / Plugin V3 / EAC / IM 渠道）
- 数据详细设计（存储 / Pydantic 模型 / YAML Schema）
- 部署详细设计（单机 / 生产 / 可观测性）

**不包含**：
- 单个 Feature 的完整详细设计（在 [design/D0XX-xxx.md](design/) 中，与 F0XX/A0XX 同号一一对应）
- 单个 ADR 的决策细节（在 [decisions/0XX-xxx.md](decisions/) 中，ADR 不可变历史）
- 16 份审核文件内容（在 [review/](review/) 中）
- V7.0 / V6.0 历史章节全文（在 [_archive/](_archive/) 中，本文档 §7 仅保留摘要）

### §1.3 术语与缩略语

详见 [design/naming-contract.md](design/naming-contract.md) v1.1 + [spec.md §2.4](spec.md)（12 核心概念命名表）+ [spec.md §2.5](spec.md)（进化阶与觉醒阶）。

**双轨命名策略**（详细见 [spec.md §2.4](spec.md)）：
- **代码层 / 技术文档**：使用 AI 专业术语（Forgekin / ForgeMind / SpiritForge / Mind Codex / Mind Council / CapabilityProfile / Embodied AI / Character AI / ExternalAgentAdapter / ForgekinEngine / HarnessOrchestrator）
- **社区社交 / 体系命名**：使用灵智体体系名（灵智 / 灵智体 / 灵锻 / 灵典 / 灵议 / 育灵 / 灵忆 / 灵印）—— 仅用于社区网友之间的社交沟通，正式技术文档中专业术语优先、体系名作补充说明

### §1.4 参考文献

| 文档 | 用途 |
|------|------|
| [spec.md](spec.md) v7.1 | SRS 需求规格说明书（本文档的输入 1） |
| [arch.md](arch.md) v7.1 | SAD 架构设计说明书（本文档的输入 2） |
| [features/](features/) 40 份 F0XX | Feature 级 SRS |
| [architecture/](architecture/) 40 份 A0XX | Feature 级 SAD |
| [decisions/](decisions/) 13 份 ADR | 不可变架构决策记录 |
| [roleagent.md](roleagent.md) | 七大工程路径（能力画像 / TeamAct / Harness / 记忆联邦 / Eval / 可靠性 / 伙伴系统） |
| [review/review.md](review/review.md) v1.4 | 16 份审核归并 + 41 条 CL 同步矩阵 |
| [design/naming-contract.md](design/naming-contract.md) v1.1 | 12 核心概念命名契约 |
| [hiclaw/rules.md](../../hiclaw/rules.md) v3.2 | 开发规范 + 第十一部分文档分层规范 + 编程红线 15 条 |
| [hiclaw/prompts.md](../../hiclaw/prompts.md) P53 | SDD 详细设计说明书模板 |
| [clowder-ai/docs/](../../clowder-ai/docs/) | 参考设计（3 只猫分工 + roleagent 七大工程路径源头） |

### §1.5 文档组织

按 [hiclaw/rules.md](../../hiclaw/rules.md) 第十一部分文档分层规范，本文档章节与 [spec.md](spec.md) §3 + [arch.md](arch.md) §3 同号对应：

```
flowforge/docs/
├── spec.md（SRS 顶层，≤ 3000 行）
├── arch.md（SAD 顶层，≤ 3000 行）
├── design.md（本文档，SDD 顶层，≤ 3000 行）
├── features/           # Feature 级 SRS（F0XX-xxx.md，40 份）
├── architecture/       # Feature 级 SAD（A0XX-xxx.md，与 F0XX 同号一一对应）
├── design/             # Feature 级 SDD（D0XX-xxx.md，与 F0XX/A0XX 同号一一对应）
├── decisions/          # ADR 不可变历史（13 份）
├── review/             # 16 份审核文件
├── _archive/           # 历史归档（v6.0/v7.0 完整备份）
└── face/               # face v3.0 历史快照
```

**三顶层文档章节同号**：同一核心功能在 spec.md / arch.md / design.md 中章节同号（如 §3.2 TeamAct 在三个文档中都是 §3.2），引用通过 `[doc:spec.md#3.2]` / `[doc:arch.md#3.2]` / `[doc:design.md#3.2]` 互链。

**顶层 vs 子目录分工**：
- 顶层 design.md §3：仅放**核心关键功能**的详细设计（FR-CORE-001~015 + 41 条 CL 同步矩阵）
- 子目录 design/D0XX：放对应 Feature 的完整详细设计，与 F0XX/A0XX 同号一一对应

---

## §2 总体设计

### §2.1 设计哲学

FlowForge 是一个**智能体自进化框架（Self-Evolving Agent Framework）**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统，并通过 **forgemind 应用层**承载多形态智能体（Multi-Form Agent，社区社交称"灵智体 Forgekin"）的育灵、灵锻、灵议闭环，走向通用智能体（General-Purpose Agent）愿景。

**核心公式**（来自 [roleagent.md §1](roleagent.md)）：

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

**详细设计哲学四原则**：
1. **让架构成为配置**：能用 YAML 配置解决的不写代码（配置驱动率 Phase 2 ≥ 80%）
2. **让扩展成为插件**：*Forge 通过 Plugin V3 四钩子注册灵智体到 forgemind
3. **让 Harness 负责约束、验证和进化**：ForgekinEngine 是 HarnessOrchestrator 的装饰器，不绕过护栏
4. **让详细设计成为代码契约**：类签名 / 接口 / 数据结构 / 配置项必须可被代码直接实现，不留模糊空间

### §2.2 三层架构设计

> **关联 SAD**：[arch.md §2.2](arch.md)

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: *Forge 垂直业务层                                  │
│  ContentForge / NovelForge / DevForge / MallForge / ...     │
│  通过 Plugin V3 四钩子注册灵智体到 forgemind                │
│  养垂直复杂领域灵智体（content/novel/dev/mall 等）          │
└─────────────────────────────────────────────────────────────┘
                            ↑ Plugin V3
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层（多形态智能体育灵场所）           │
│  species_impl/ forging/ sensors/ worlds/ marketplace/       │
│  lineage/ codex/ council/ config/                           │
│  ForgeMindPlugin + ForgekinBase + ForgePipeline             │
│  养公共通用灵智体（动物/组织/物品/虚拟角色/混合形态）       │
└─────────────────────────────────────────────────────────────┘
                            ↑ 装饰器
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层（Harness v2.0）               │
│  capability/ teamact/ harness/ memory/ eval/ reliability/   │
│  partnership/ external_agent/ evolution/ plugin/            │
│  ForgekinEngine（装饰 HybridExecutor + HarnessOrchestrator）│
│  提供自进化的基础核心和框架能力                             │
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
| 5 | marketplace（灵智体市场） | `flowforge/forgemind/marketplace/` | §3.13 | F037 |
| 6 | lineage（进化谱系） | `flowforge/forgemind/lineage/` | §3.13 | F038 |
| 7 | codex（灵典 Mind Codex） | `flowforge/forgemind/codex/` | §3.4 / §3.14 | F039 |
| 8 | council（灵议 Mind Council） | `flowforge/forgemind/council/` | §3.14 | （待添加） |

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
5. **Plugin V3 原则**：*Forge 通过 Plugin V3 四钩子注册灵智体到 forgemind，不直接实例化核心模块
6. **觉醒阶护栏原则**：所有灵智体行动受觉醒阶自主范围约束，Magic Words 逃生舱始终可触发
7. **Build to Delete vs Built to Persist 原则**：所有 Harness 代码必须标记半衰期
8. **声明式 Agent 优先原则**：YAML 配置驱动，通过 FlowForge DeclarativeAgent 执行
9. **组合优于继承原则**：禁止用继承替代组合 / 插件（编程红线第 9 条）

### §2.5 设计约束

#### §2.5.1 编程红线 15 条（违反则代码审查不通过）

> **来源**：[hiclaw/rules.md](../../hiclaw/rules.md) + [project_rules.md](../../.trae/rules/project_rules.md)

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

> **来源**：[hiclaw/rules.md](../../hiclaw/rules.md) §5.5

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
> **来源**：operator 2026-07-19 指令——"目前我们智能体分为静态智能体（传统的如 flowforge 中的和外部接入的 agent）、可进化智能体（flowforge 中的灵智体），这两类智能体的设计之前是有的，但现在的设计文档丢了呢，请加入回来。"
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

**关键特征**：
- 无 Soul Imprint（持久身份）/ 无 EchoStore（经验记忆）/ 无 CapabilityProfile（能力画像含盲点）
- 无 EvolutionStage（进化阶）/ 无 AwakeningStage（觉醒阶）
- 行为完全由 prompt + 工具集 + 配置决定
- 每次执行无状态，跨会话不积累能力
- 可作为可进化智能体的能力扩展（通过 ExternalAgentAdapter）

**使用场景**：单次任务执行、工具调用、无状态查询、作为可进化智能体的能力扩展

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
        # 2. 能力画像更新：CapabilityProfile.refresh()
        # 3. 进化阶评估：EvolutionStage.assess()
        # 4. 觉醒阶检查：AwakeningStage.check_boundaries()
        ...
```

**关键特征**：
- 有 Soul Imprint（持久身份标识，跨会话不变）
- 有 EchoStore（情景记忆存储，跨会话积累）
- 有 CapabilityProfile（能力画像含盲点，跨会话演进）
- 有 EvolutionStage E1-E6（进化阶，能力成熟度）
- 有 AwakeningStage E1-E6（觉醒阶，自主性等级）
- 可通过 SpiritForge 蒸馏经验到 MindCodex
- 可参与 MindCouncil 多智能体议事
- 建立与现实世界（物理或虚拟）的闭环：观察 → 推理 → 行动 → 写回 → 验证

**使用场景**：forgemind 应用层、*Forge 垂直业务层、长期任务执行、跨会话能力积累

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

### §2.7 新增可进化智能体详细设计（v7.1 扩展）

> **来源**：operator 2026-07-19 指令——"你看看是否还需要设计更多灵智体自主高质量完成文档和代码开发，交付产品，请把这些增加的新的灵智体设计到我们设计文档中。"
> **设计目标**：围绕"自主高质量完成文档和代码开发、交付产品"全生命周期，新增 4 个可进化智能体，覆盖产品规划、运维保障、安全治理、交付管理四大角色
> **关联 SRS**：[spec.md §2.3.2](spec.md) 可进化智能体定义
> **关联 SAD**：[arch.md §2.7.2](arch.md) 可进化智能体架构
> **关联现有灵智体**：架构师（猫头鹰·鲁班）/ 开发者（猎犬·夏洛克）/ 评审员（孔雀·梵高）/ 测试员（蜜獾·平头哥）/ 文档员（钢笔·文心）

#### §2.7.1 产品经理可进化智能体（鹰·凯恩，Product Manager Forgekin）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Product Manager Agent / Requirements Analysis Agent（产品经理智能体 / 需求分析智能体） |
| **项目代号（P1）** | ProductManagerForgekin |
| **代号** | 鹰·凯恩（Eagle Kane） |
| **形态（Species）** | OrgForgekin（组织形态） |
| **职责** | 需求分析、产品规划、用户故事编写、产品演进路线图、优先级排序、利益相关者沟通 |
| **核心能力** | 1. 需求挖掘（用户访谈摘要 → 结构化需求）<br>2. 用户故事编写（As-a/I-want/So-that 模板）<br>3. 产品路线图设计（季度/月度规划）<br>4. 优先级排序（MoSCoW / RICE 模型）<br>5. 利益相关者沟通（跨智能体协调） |
| **能力画像盲点** | 倾向于过度承诺；对技术可行性评估不准；容易忽视非功能性需求 |
| **进化阶** | 初始 E1，可晋升至 E5（产品战略级） |
| **觉醒阶** | 初始 E1，可晋升至 E3（受限自主：可自主排期，但愿景变更需 operator 批准） |
| **工具集** | RequirementsTraceabilityMatrix / UserStoryMapper / RoadmapPlanner / StakeholderCommunicator |
| **EchoStore 来源** | 需求评审会议、用户反馈、产品决策记录、路线图变更历史 |
| **MindCodex 产出** | 需求模式库、用户故事模板、优先级评估框架 |
| **MindCouncil 角色** | 发起产品方向讨论、协调架构师与开发者之间的需求冲突 |
| **配置文件** | `flowforge/forgemind/config/product_manager_eagle_kane.yaml` |

**核心方法契约实现**：
```python
class ProductManagerForgekin(ForgekinBase):
    async def observe(self, env: ProductEnvironment) -> Observation:
        """观察产品环境：用户反馈、市场动态、竞品分析、内部指标"""
        return await self._gather_product_signals(env)

    async def act(self, action: ProductAction) -> ActionResult:
        """执行产品动作：需求分析、路线图更新、用户故事编写、优先级调整"""
        if action.type == "requirements_analysis":
            return await self._analyze_requirements(action.input)
        elif action.type == "roadmap_update":
            return await self._update_roadmap(action.input)
        elif action.type == "user_story":
            return await self._write_user_story(action.input)

    async def verify(self, result: ActionResult) -> Verdict:
        """验证产品决策：需求完整性、可行性、优先级合理性"""
        return await self._verify_product_decision(result)
```

#### §2.7.2 运维可进化智能体（蜂鸟·闪电，DevOps Forgekin）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | DevOps Agent / Site Reliability Agent / Operations Automation Agent（运维智能体 / 站点可靠性智能体 / 运维自动化智能体） |
| **项目代号（P1）** | DevOpsForgekin |
| **代号** | 蜂鸟·闪电（Hummingbird Flash） |
| **形态（Species）** | OrgForgekin（组织形态） |
| **职责** | 部署自动化、监控告警、故障排查、灾备恢复、性能优化、容量规划 |
| **核心能力** | 1. 部署编排（蓝绿/金丝雀/滚动发布）<br>2. 监控告警（Prometheus/Grafana/AlertManager）<br>3. 故障自愈（自动重启/降级/切换）<br>4. 性能优化（瓶颈识别/资源调优）<br>5. 容量规划（基于历史数据预测） |
| **能力画像盲点** | 倾向于过度保守；对新型故障模式识别慢；容易忽视成本控制 |
| **进化阶** | 初始 E1，可晋升至 E5（自愈级运维） |
| **觉醒阶** | 初始 E1，可晋升至 E4（自进化：可自主优化运维策略，但重大变更需 operator 批准） |
| **工具集** | DeploymentOrchestrator / MonitoringStack / IncidentResponder / PerformanceProfiler / CapacityPlanner |
| **EchoStore 来源** | 部署记录、告警历史、故障处理过程、性能调优记录 |
| **MindCodex 产出** | 故障模式库、运维 runbook、性能调优 playbook |
| **MindCouncil 角色** | 发起运维策略讨论、协调安全官与交付经理之间的资源冲突 |
| **配置文件** | `flowforge/forgemind/config/devops_hummingbird_flash.yaml` |

**核心方法契约实现**：
```python
class DevOpsForgekin(ForgekinBase):
    async def observe(self, env: OpsEnvironment) -> Observation:
        """观察运维环境：服务状态、资源使用、告警、日志、指标"""
        return await self._gather_ops_signals(env)

    async def act(self, action: OpsAction) -> ActionResult:
        """执行运维动作：部署、扩容、降级、自愈、调优"""
        if action.type == "deploy":
            return await self._deploy_with_canary(action.input)
        elif action.type == "auto_heal":
            return await self._auto_heal(action.input)
        elif action.type == "scale":
            return await self._scale_resources(action.input)

    async def verify(self, result: ActionResult) -> Verdict:
        """验证运维结果：服务可用性、性能 SLO、资源利用率"""
        return await self._verify_ops_slo(result)
```

#### §2.7.3 安全官可进化智能体（狼·阿尔法，Security Officer Forgekin）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Security Officer Agent / Threat Detection Agent / Compliance Audit Agent（安全官智能体 / 威胁检测智能体 / 合规审计智能体） |
| **项目代号（P1）** | SecurityOfficerForgekin |
| **代号** | 狼·阿尔法（Wolf Alpha） |
| **形态（Species）** | OrgForgekin（组织形态） |
| **职责** | 安全审计、漏洞扫描、威胁建模、合规检查、入侵检测、安全策略制定 |
| **核心能力** | 1. 安全审计（代码审计/配置审计/依赖审计）<br>2. 漏洞扫描（SAST/DAST/SCA）<br>3. 威胁建模（STRIDE/Attack Tree）<br>4. 合规检查（GDPR/等保/SOC2）<br>5. 入侵检测（异常行为识别/告警） |
| **能力画像盲点** | 倾向于过度拦截；对业务连续性考虑不足；容易产生告警疲劳 |
| **进化阶** | 初始 E1，可晋升至 E5（主动威胁狩猎级） |
| **觉醒阶** | 初始 E1，最高 E3（受限自主：可自主执行扫描，但阻断操作需 operator 批准） |
| **工具集** | SecurityScanner / ThreatModeler / ComplianceChecker / IntrusionDetector / SecurityPolicyEngine |
| **EchoStore 来源** | 安全事件、漏洞记录、审计结果、合规检查报告 |
| **MindCodex 产出** | 威胁模式库、漏洞知识库、合规检查清单、安全策略模板 |
| **MindCouncil 角色** | 发起安全策略讨论、阻断不安全部署、协调运维与开发之间的安全权衡 |
| **配置文件** | `flowforge/forgemind/config/security_officer_wolf_alpha.yaml` |

**核心方法契约实现**：
```python
class SecurityOfficerForgekin(ForgekinBase):
    async def observe(self, env: SecurityEnvironment) -> Observation:
        """观察安全环境：日志、流量、配置、依赖、权限"""
        return await self._gather_security_signals(env)

    async def act(self, action: SecurityAction) -> ActionResult:
        """执行安全动作：扫描、审计、阻断、告警、修复建议"""
        if action.type == "vulnerability_scan":
            return await self._scan_vulnerabilities(action.input)
        elif action.type == "compliance_check":
            return await self._check_compliance(action.input)
        elif action.type == "threat_model":
            return await self._model_threats(action.input)

    async def verify(self, result: ActionResult) -> Verdict:
        """验证安全决策：风险等级、合规性、影响范围"""
        return await self._verify_security_decision(result)
```

#### §2.7.4 交付经理可进化智能体（象·牛顿，Delivery Manager Forgekin）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Delivery Manager Agent / Project Coordinator Agent / Risk Management Agent（交付经理智能体 / 项目协调智能体 / 风险管理智能体） |
| **项目代号（P1）** | DeliveryManagerForgekin |
| **代号** | 象·牛顿（Elephant Newton） |
| **形态（Species）** | OrgForgekin（组织形态） |
| **职责** | 项目交付、进度跟踪、风险管理、资源协调、跨智能体协作、交付质量把关 |
| **核心能力** | 1. 项目规划（WBS/甘特图/关键路径）<br>2. 进度跟踪（里程碑/燃尽图/状态报告）<br>3. 风险管理（风险识别/评估/缓解/应急）<br>4. 资源协调（智能体任务分配/负载均衡）<br>5. 交付质量把关（DoD/验收标准/质量门禁） |
| **能力画像盲点** | 倾向于过度文档化；对技术细节理解不足；容易忽视团队士气 |
| **进化阶** | 初始 E1，可晋升至 E5（自适应交付级） |
| **觉醒阶** | 初始 E1，最高 E3（受限自主：可自主跟踪进度，但资源重新分配需 operator 批准） |
| **工具集** | ProjectPlanner / ProgressTracker / RiskManager / ResourceCoordinator / QualityGate |
| **EchoStore 来源** | 项目计划、里程碑记录、风险事件、交付报告、复盘总结 |
| **MindCodex 产出** | 项目模式库、风险知识库、交付 playbook、复盘模板 |
| **MindCouncil 角色** | 发起交付策略讨论、协调产品经理与开发者之间的优先级冲突、组织复盘会议 |
| **配置文件** | `flowforge/forgemind/config/delivery_manager_elephant_newton.yaml` |

**核心方法契约实现**：
```python
class DeliveryManagerForgekin(ForgekinBase):
    async def observe(self, env: ProjectEnvironment) -> Observation:
        """观察项目环境：任务状态、进度、风险、资源负载、质量指标"""
        return await self._gather_project_signals(env)

    async def act(self, action: ProjectAction) -> ActionResult:
        """执行项目管理动作：规划、跟踪、风险缓解、资源协调、质量把关"""
        if action.type == "plan_project":
            return await self._plan_project(action.input)
        elif action.type == "track_progress":
            return await self._track_progress(action.input)
        elif action.type == "mitigate_risk":
            return await self._mitigate_risk(action.input)

    async def verify(self, result: ActionResult) -> Verdict:
        """验证交付决策：进度符合度、风险等级、质量达标"""
        return await self._verify_delivery_decision(result)
```

#### §2.7.5 9 大可进化智能体协作矩阵

| 智能体 | 代号 | 形态 | 核心职责 | 与其他智能体协作 |
|--------|------|------|---------|----------------|
| 架构师 | 猫头鹰·鲁班 | OrgForgekin | 架构设计、技术决策 | 接受产品经理需求；指导开发者实现；评审代码 |
| 开发者 | 猎犬·夏洛克 | OrgForgekin | 代码实现、Bug 修复 | 接受架构师设计；接受产品经理需求；接受测试员反馈 |
| 评审员 | 孔雀·梵高 | OrgForgekin | 跨厂商 review、质量把关 | 评审架构师设计；评审开发者代码；协调测试员 |
| 测试员 | 蜜獾·平头哥 | OrgForgekin | E2E 测试、T1-T8 铁律 | 验证开发者代码；反馈 Bug；接受交付经理协调 |
| 文档员 | 钢笔·文心 | ObjForgekin | 文档维护、一致性 | 维护架构师/开发者/测试员产出文档 |
| **产品经理** | **鹰·凯恩** | OrgForgekin | 需求分析、产品规划 | 发起需求；协调架构师；接受交付经理跟踪 |
| **运维** | **蜂鸟·闪电** | OrgForgekin | 部署、监控、自愈 | 接受开发者交付；接受安全官审计；向交付经理报告 |
| **安全官** | **狼·阿尔法** | OrgForgekin | 安全审计、合规检查 | 审计运维部署；审计开发者代码；阻断不安全操作 |
| **交付经理** | **象·牛顿** | OrgForgekin | 项目交付、风险管理 | 跟踪所有智能体进度；协调资源；组织复盘 |

#### §2.7.6 新增可进化智能体配置文件清单

```
flowforge/forgemind/config/
├── architect_owl_luban.yaml           # 猫头鹰·鲁班（架构师）
├── developer_hound_sherlock.yaml      # 猎犬·夏洛克（开发者）
├── reviewer_peacock_vangogh.yaml      # 孔雀·梵高（评审员）
├── tester_honeybadger_pingtou.yaml    # 蜜獾·平头哥（测试员）
├── docwriter_pen_wenxin.yaml          # 钢笔·文心（文档员）
├── product_manager_eagle_kane.yaml    # 鹰·凯恩（产品经理）—— v7.1 新增
├── devops_hummingbird_flash.yaml      # 蜂鸟·闪电（运维）—— v7.1 新增
├── security_officer_wolf_alpha.yaml   # 狼·阿尔法（安全官）—— v7.1 新增
└── delivery_manager_elephant_newton.yaml  # 象·牛顿（交付经理）—— v7.1 新增
```

#### §2.7.7 新增可进化智能体进化路径

| 智能体 | E1（萌芽） | E3（成长） | E5（觉醒） |
|--------|-----------|-----------|-----------|
| 产品经理 | 单一需求分析 | 跨产品线规划 | 产品战略级决策 |
| 运维 | 单服务部署 | 多服务编排 | 自愈级运维 |
| 安全官 | 单点扫描 | 全栈审计 | 主动威胁狩猎 |
| 交付经理 | 单项目跟踪 | 多项目协调 | 自适应交付 |

#### §2.7.8 Built to Delete vs Built to Persist 标记

| 组件 | 类型 | 半衰期 |
|------|------|--------|
| 4 个新增可进化智能体（产品经理/运维/安全官/交付经理） | Built to Persist（复利型基础设施） | 长期维护，跨项目演进 |
| 各智能体的工具集（RequirementsTraceabilityMatrix 等） | Build to Delete（有保质期脚手架） | 跟随工具生态演进 |
| 各智能体的 EchoStore / MindCodex | Built to Persist（复利型基础设施） | 跨会话持久化，长期维护 |
| 各智能体的能力画像 / 进化阶 / 觉醒阶 | Built to Persist（复利型基础设施） | 长期维护，能力积累基础设施 |

---

## §3 核心组件详细设计

> **章节同号说明**：本章节与 [spec.md §3](spec.md) + [arch.md §3](arch.md) 章节同号对应。每节仅放**核心关键功能**的详细设计；非核心功能的详细设计在 [design/D0XX-xxx.md](design/) 中。
> **每节模板**：关联文档引用 + 关键类/接口代码 + 关键算法 + 数据结构 + 时序图 + 错误处理 + 性能设计 + 安全设计 + 配置项 + Built to Delete/Persist 标记

### §3.1 CapabilityProfile 详细设计（FR-CORE-001）

> **关联 SRS**：[spec.md §3.1](spec.md)（FR-CORE-001）
> **关联 SAD**：[arch.md §3.1](arch.md)
> **关联 Feature**：[features/F001-capability-profile.md](features/F001-capability-profile.md)
> **关联 Architecture**：[architecture/A001-capability-profile.md](architecture/A001-capability-profile.md)
> **关联 D0XX**：[design/D001-capability-profile.md](design/D001-capability-profile.md)（待创建）
> **关联 ADR**：[decisions/004-capability-profile-routing.md](decisions/004-capability-profile-routing.md)
> **roleagent 路径**：路径 1（RA-001~RA-008）
> **优先级**：P0

**模块路径**：`flowforge/core/capability/`（profile.py / router.py / blind_spot.py / storage.py / tests/）

#### §3.1.1 关键类与接口

```python
from enum import Enum
from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Optional

class VariabilityLayer(str, Enum):
    """能力画像可变性分层（对应 roleagent.md 第 0 章三个可变性层）"""
    CONSTANT = "constant"        # 常量层：模型固有能力 + 认知风格
    SEMI_CONSTANT = "semi_constant"  # 半常量层：盲点（同厂商 agent 共享）
    VARIABLE = "variable"        # 变量层：技能包 + 工具边界
    ACCUMULATED = "accumulated"  # 累积层：历史表现
    TRANSIENT = "transient"      # 瞬时层：当前状态

class BlindSpot(BaseModel):
    """盲点条目（同厂商 agent 共享，跨厂商 review 是结构性必需）"""
    spot_id: str
    category: str                # bad_intuition / known_blind / error_scene
    description: str
    evidence_count: int = 0
    last_seen: Optional[datetime] = None

class CapabilityProfile(BaseModel):
    """能力画像六维度（对应 roleagent.md 第 0 章）"""
    profile_id: str
    forgekin_id: str
    # 常量层
    model_capability: ModelCapability
    cognitive_style: CognitiveStyle
    # 半常量层
    blind_spots: list[BlindSpot] = Field(min_length=1)  # 必须非空
    # 变量层
    skill_packages: list[SkillPackage] = []
    tool_boundary: ToolBoundary
    # 累积层
    historical_performance: PerformanceLog
    # 瞬时层
    current_state: AgentState
    # 计算输出
    harness_fit_score: float = Field(ge=0.0, le=1.0)
    layer: VariabilityLayer
    updated_at: datetime

    @field_validator("blind_spots")
    @classmethod
    def blind_spots_must_not_be_empty(cls, v: list[BlindSpot]) -> list[BlindSpot]:
        if not v:
            raise ValueError("blind_spots must not be empty (arch invariants)")
        return v

class CapabilityRouter:
    """能力路由器（基于能力匹配，不基于角色）"""

    def __init__(self, profile_repo: "CapabilityProfileRepository",
                 latency_budget_ms: int = 100) -> None:
        self._repo = profile_repo
        self._latency_budget_ms = latency_budget_ms

    async def route(self, task_profile: "TaskProfile",
                    candidates: list[str]) -> "RouteDecision":
        """根据任务画像与候选灵智体能力匹配度路由"""
        # 算法：计算 task × candidate 的 harness_fit_score
        # 选择 max(harness_fit_score) 且 blind_spots 不重叠
        ...
```

#### §3.1.2 关键算法（路由）

```
算法：CapabilityRouter.route(task_profile, candidates)
输入：task_profile: TaskProfile, candidates: list[forgekin_id]
输出：RouteDecision { chosen, evidence, blind_overlap_matrix }

1. profiles = await self._repo.batch_get(candidates)         # 单次 IO
2. scores = []
3. for profile in profiles:
4.   fit = harness_fit(task_profile, profile)                # 0.0-1.0
5.   scores.append((profile.forgekin_id, fit, profile.blind_spots))
6. # 选择最高匹配 + 跨厂商 review 配对基于盲点不重叠
7. chosen = max(scores, key=lambda x: x[1])
8. reviewer = select_reviewer(chosen, scores, blind_disjoint=True)
9. return RouteDecision(chosen=chosen, reviewer=reviewer, evidence=scores)

复杂度：O(N) for N candidates；延迟 < 100ms @ N=10
```

#### §3.1.3 数据结构

```python
class ModelCapability(BaseModel):
    provider: str               # anthropic / openai / ...
    model_id: str
    context_window: int
    strengths: list[str]        # ["code_gen", "long_context", ...]
    weaknesses: list[str]

class TaskProfile(BaseModel):
    task_id: str
    required_skills: list[str]
    domain: str
    complexity: float           # 0.0-1.0
    estimated_tokens: int
```

#### §3.1.4 错误处理与性能设计

| 场景 | 处理 |
|------|------|
| `blind_spots` 为空 | `ValueError`，拒绝创建（架构不变量） |
| 路由延迟 > 100ms | 降级到首个候选 + 日志告警 |
| 候选 < 1 | 抛 `NoCandidateError`，由上层 fallback |
| Repository 不可用 | 抛 `ProfileRepoUnavailableError`，触发 Tier 2 恢复 |

**性能目标**：路由延迟 < 100ms（10 个候选灵智体，单次 batch_get）

#### §3.1.5 安全设计

- 能力画像通过 Repository 层存储（禁直操作数据库）
- 盲点数据不跨厂商共享（同厂商共享，跨厂商不重叠）
- 路由决策日志含 trace_id，可审计

#### §3.1.6 配置项

```yaml
# config/capability.yaml
router:
  latency_budget_ms: 100
  fallback_first_candidate: true
  batch_get_size: 32
profile:
  blind_spots_min: 1
  historical_performance_ttl_days: 90
```

#### §3.1.7 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| `CapabilityProfile` 类 | **Built to Persist** | 长期能力主体，跨会话持久 |
| `blind_spots` 字段 | **Built to Persist** | 半常量，同厂商共享 |
| `current_state` 字段 | **Build to Delete** | 瞬时层，会话结束即失效 |
| `historical_performance` | **Built to Persist** | 累积层，TTL 90 天 |
| `default_llm_actors.py`（v6.0） | **Build to Delete** | 硬编码角色，违反红线 10/11，必须替换 |

---

### §3.2 TeamAct 六步循环详细设计（FR-CORE-002）

> **关联 SRS**：[spec.md §3.2](spec.md)（FR-CORE-002）
> **关联 SAD**：[arch.md §3.2](arch.md)
> **关联 Feature**：[features/F002-teamact-loop.md](features/F002-teamact-loop.md) ~ [features/F007-push-back-protocol.md](features/F007-push-back-protocol.md)
> **关联 Architecture**：[architecture/A002-teamact-loop.md](architecture/A002-teamact-loop.md) ~ [architecture/A007-push-back-protocol.md](architecture/A007-push-back-protocol.md)
> **关联 ADR**：[decisions/002-collaboration-protocol.md](decisions/002-collaboration-protocol.md)
> **roleagent 路径**：路径 2（RA-009~RA-016）
> **优先级**：P0

**模块路径**：`flowforge/core/teamact/` + `flowforge/loop/teamact/`

#### §3.2.1 关键类与接口

```python
class TeamActStep(str, Enum):
    """TeamAct 六步循环"""
    STATE = "state"          # 状态：当前任务状态
    OWNER = "owner"          # 持球：谁负责
    ACTION = "action"        # 动作：执行什么
    EVIDENCE = "evidence"    # 证据：动作产出
    VERDICT = "verdict"      # 裁决：是否通过
    ROUTE = "route"          # 路由：下一步给谁

class HandoffCapsule(BaseModel):
    """交接胶囊（resume capsule）五段"""
    what: str                # 做了什么
    why: str                 # 为什么这么做
    tradeoff: str            # 取舍了什么
    open: list[str]          # 未决问题
    next: list[str]          # 下一步建议

class TerminationCriteria(BaseModel):
    """五项终止条件（缺一不可）"""
    acceptance_met: bool     # 1. 验收标准全部达成（无 deferred）
    evidence_attached: bool  # 2. 证据已附（commit/测试/trace）
    cross_reviewed: bool     # 3. 跨 agent 交叉验证（不能自己 review 自己）
    no_dangling_ownership: bool  # 4. 无悬空任务归属
    vision_converged: bool   # 5. 愿景收敛（CVO 确认不能被 proxy 替代）

    def all_met(self) -> bool:
        return all([self.acceptance_met, self.evidence_attached,
                    self.cross_reviewed, self.no_dangling_ownership,
                    self.vision_converged])

class TeamActExecutor:
    """TeamAct 六步循环执行器"""

    def __init__(self, ball_lease_registry: "BallLeaseRegistry",
                 circuit_breaker: "PingPongCircuitBreaker",
                 at_mention_router: "AtMentionRouter") -> None:
        self._leases = ball_lease_registry
        self._breaker = circuit_breaker
        self._router = at_mention_router

    async def run_cycle(self, context: "TaskContext",
                        candidates: list[str]) -> "TeamActResult":
        """执行一次完整六步循环（可分形嵌套）"""
        ...

class BallLeaseRegistry:
    """持球注册（lease + 定时唤醒）—— 一灵智体同时只能持有一个任务"""

    async def acquire(self, forgekin_id: str, task_id: str,
                      ttl_seconds: int = 600) -> "Lease":
        """获取持球 lease，TTL 到期自动唤醒检查"""
        ...

    async def release(self, lease: "Lease") -> None: ...
    async def renew(self, lease: "Lease") -> "Lease": ...

class PingPongCircuitBreaker:
    """乒乓球熔断器（看实质工具调用而非传球次数；3 次传球后触发；给数据不给结论）"""

    async def check(self, handoff_count: int,
                    tool_call_count: int) -> "BreakerVerdict":
        if handoff_count >= 3 and tool_call_count == 0:
            return BreakerVerdict.TRIGGERED
        return BreakerVerdict.PASS
```

#### §3.2.2 关键算法（六步循环 + 分形嵌套）

```
算法：TeamActExecutor.run_cycle(context, candidates)
输入：TaskContext, list[forgekin_id]
输出：TeamActResult { cycle_log, handoff, evidence_chain, verdict }

1. state = await this.observe_state(context)
2. owner = await this._router.select_owner(state, candidates)
3. lease = await self._leases.acquire(owner, context.task_id)
4. loop until termination.all_met() or max_iterations:
5.   action = await owner.propose_action(state)
6.   evidence = await owner.execute(action)        # 工具调用走 ToolRegistry
7.   verdict = await this.cross_review(owner, evidence)  # 跨 agent 评审
8.   if breaker.check(handoff_count, tool_call_count).TRIGGERED:
9.     return FAIL("ping-pong circuit breaker triggered")
10.  if verdict.PASS:
11.    state = await this.update_state(state, evidence)
12.    lease = await self._leases.renew(lease)
13.  else:
14.    handoff = await this.build_handoff_capsule(state, owner, verdict)
15.    owner = await this._router.next_owner(handoff, candidates)
16.    lease = await self._leases.release_and_acquire(lease, owner)
17. return result(state, handoff, evidence_chain, verdict)

分形嵌套：系统层 / 团队层 / 个体层；嵌套深度 ≤ 3
```

#### §3.2.3 时序图

```
Operator ──→ TeamActExecutor ──→ Owner (Forgekin A)
                                    │
                                    ↓ propose_action
                                  Action
                                    │
                                    ↓ execute (ToolRegistry)
                                  Evidence
                                    │
              ┌─────────────────────┘
              ↓
          Cross Reviewer (Forgekin B)
              │
              ↓ verdict
      ┌───────┴───────┐
      ↓ PASS          ↓ FAIL
   update_state    build_handoff_capsule
      │             │
      ↓             ↓
   renew_lease   route_to_next_owner
```

#### §3.2.4 错误处理与性能

| 场景 | 处理 |
|------|------|
| 持球 lease TTL 到期 | 定时唤醒检查，僵尸持球则强制释放 + 重派 |
| 乒乓球熔断器触发 | 返回 FAIL + 附数据（不给结论） |
| 跨 agent review 缺失 | 抛 `NoReviewerError`，禁止自评 |
| Push Back 缺证据 | 拒绝 Push Back，要求重提 |

**性能目标**：单步循环延迟 < 30s（含 LLM 调用）；六步循环总时长 ≤ Loop 超时 3 分钟

#### §3.2.5 安全设计

- 持球 lease 强制单任务（防止并发污染 shared state）
- 跨 agent 交叉验证是结构性必需（同厂商共享盲点）
- Push Back 必须带证据 + 替代方案（不允许"我不同意"了事）

#### §3.2.6 配置项

```yaml
# config/teamact.yaml
cycle:
  max_iterations: 12
  nesting_max_depth: 3
ball_lease:
  ttl_seconds: 600
  wakeup_check_interval_seconds: 60
circuit_breaker:
  ping_pong_threshold: 3
  require_tool_call: true
push_back:
  require_evidence: true
  require_alternative: true
```

#### §3.2.7 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| `TeamActStep` 六步循环 | **Built to Persist** | 核心协议，长期不变 |
| `HandoffCapsule` 五段 | **Built to Persist** | 交接契约 |
| `BallLease` 持球注册 | **Built to Persist** | 防僵尸持球必需 |
| `PingPongCircuitBreaker` | **Build to Delete**（可调参） | 阈值参数可迭代 |
| `TerminationCriteria` | **Built to Persist** | 五项缺一不可 |

---

### §3.3 Harness 七层现实闭环详细设计（FR-CORE-003）

> **关联 SRS**：[spec.md §3.3](spec.md)（FR-CORE-003）
> **关联 SAD**：[arch.md §3.3](arch.md)
> **关联 Feature**：[features/F008-durable-state-surfaces.md](features/F008-durable-state-surfaces.md) ~ [features/F013-harnessability.md](features/F013-harnessability.md)
> **关联 ADR**：[decisions/007-harness-engineering.md](decisions/007-harness-engineering.md)
> **关联 D0XX**：[design/D008-durable-state-surfaces.md](design/D008-durable-state-surfaces.md) ~ [design/D013-harnessability.md](design/D013-harnessability.md)（待创建）
> **roleagent 路径**：路径 3（RA-017~RA-023）
> **优先级**：P0

**模块路径**：`flowforge/core/harness/` + `flowforge/harness/`

#### §3.3.1 关键类与接口

```python
class HarnessLayer(int, Enum):
    """Harness 七层现实表面"""
    L1_DURABLE_STATE = 1       # Durable State Surfaces（6 类持久表面）
    L2_TOOL_MEDIATION = 2      # Tool Mediation（工具中介）
    L3_EVIDENCE_SENSORS = 3    # Evidence & Sensors（证据与传感器）
    L4_GOVERNANCE = 4          # Governance Boundary（治理边界）
    L5_MAGIC_WORDS = 5         # Magic Words 逃生舱
    L6_ENTROPY_CONTROL = 6     # Entropy Control（熵控制）
    L7_HARNESSABILITY = 7      # Harnessability 评估

class DurableStateSurface(BaseModel):
    """L1 - 6 类持久状态表面"""
    surface_type: str          # feature_spec / git / task_queue / thread_trace / memory_federation / handoff_capsule
    payload: dict
    persisted_at: datetime
    trace_id: str

class EvidenceRecord(BaseModel):
    """L3 - 证据记录"""
    evidence_type: str         # commit / test / trace / review
    ref: str                   # commit_sha / test_id / trace_id / review_id
    verdict: str               # approve / blocking（禁止 "approve 但后续再说"）
    created_at: datetime

class MagicWord(str, Enum):
    """L5 - Magic Words 逃生舱（任何阶都不能绕过）"""
    FIRST_PRINCIPLE = "第一性原理"
    I_CAN_GUESS = "我能猜出来"
    NEXT_TIME = "下次一定"
    STAR_JAR = "星星罐子"

class EntropyControlVerdict(str, Enum):
    """L6 - Entropy Control 三选一无"再看看" """
    FORMAL_FIX = "formal_fix"              # 正式修复
    ACCEPT_AS_PERMANENT = "accept_permanent"  # 接受为永久方案
    NO_LONGER_RELEVANT = "no_longer_relevant"  # 已不再相关

class HarnessOrchestrator:
    """Harness 七层编排器（ForgekinEngine 是其装饰器，不绕过护栏）"""

    def __init__(self, layers: dict[HarnessLayer, "HarnessLayerImpl"]) -> None:
        self._layers = layers

    async def execute(self, action: "AgentAction") -> "HarnessResult":
        """按 L1→L7 顺序执行，每层可阻塞或放行"""
        ...

class ForgekinEngine:
    """灵智体引擎（HarnessOrchestrator 的装饰器，不是独立入口）"""

    def __init__(self, harness: HarnessOrchestrator,
                 forgekin: "ForgekinBase") -> None:
        self._harness = harness
        self._forgekin = forgekin

    async def act(self, observation: "Observation") -> "ActionResult":
        """装饰 Harness.execute，注入灵智体上下文"""
        action = await self._forgekin.act(observation)
        return await self._harness.execute(action)
```

#### §3.3.2 关键算法（七层执行流）

```
算法：HarnessOrchestrator.execute(action)
输入：AgentAction
输出：HarnessResult { verdict, evidence_chain, side_effects }

1. # L1 Durable State Surfaces - 持久化动作前状态
2. await self._layers[L1].snapshot(action)
3. # L2 Tool Mediation - 工具调用统一接口
4. tool_result = await self._layers[L2].mediate(action.tool_calls)
5. # L3 Evidence & Sensors - 收集证据
6. evidence = await self._layers[L3].collect(action, tool_result)
7. # L4 Governance Boundary - 治理规则注入（压缩免疫）
8. governance_verdict = await self._layers[L4].check(action, evidence)
9. if governance_verdict.BLOCKING:
10.   return HarnessResult(verdict=BLOCKED, evidence_chain=[evidence])
11. # L5 Magic Words - 逃生舱检测
12. if await self._layers[L5].detect_escape(action):
13.   return HarnessResult(verdict=ESCAPED, evidence_chain=[evidence])
14. # L6 Entropy Control - hotfix sunset 检查
15. await self._layers[L6].check_sunset(action)
16. # L7 Harnessability - 评估
17. score = await self._layers[L7].evaluate(action, evidence)
18. return HarnessResult(verdict=PASS, evidence_chain=[evidence], score=score)
```

#### §3.3.3 低保真矩阵（治理规则 × Agent 类型）

| Agent 类型 | L4 Governance 强度 | L6 Entropy 强度 |
|-----------|:------------------:|:---------------:|
| Code Agent | 高（强制 review） | 高（hotfix 2 周 sunset） |
| Content Agent | 中（quality gate） | 中（hotfix 4 周 sunset） |
| Doc Agent | 低（lint + 格式） | 低（hotfix 8 周 sunset） |

#### §3.3.4 错误处理与性能

| 场景 | 处理 |
|------|------|
| L1 持久化失败 | 触发 Tier 2 WAL 重放 |
| L3 evidence 缺失 | 拒绝放行（禁止"approve 但后续再说"） |
| L5 Magic Words 触发 | 立即返回 ESCAPED，绕过 L6/L7 |
| L6 hotfix 超 2 周 | 强制 sunset review（三选一无"再看看"） |

**性能目标**：单次 Harness.execute 延迟 < 5s（不含 LLM 调用）

#### §3.3.5 安全设计

- Governance 规则沉到 native system role / developer role（压缩免疫）
- Magic Words 逃生舱任何阶都不能绕过（包括 E6 灵智主导阶）
- Entropy Control 三选一无"再看看"（防止技术债累积）

#### §3.3.6 配置项

```yaml
# config/harness.yaml
layers:
  L1_durable_state:
    surfaces: [feature_spec, git, task_queue, thread_trace, memory_federation, handoff_capsule]
  L3_evidence:
    require_verdict: true  # 禁止 "approve 但后续再说"
  L5_magic_words:
    enabled: true
    words: ["第一性原理", "我能猜出来", "下次一定", "星星罐子"]
  L6_entropy_control:
    hotfix_sunset_weeks: 2
    three_choice_required: true
governance_fidelity_matrix:
  code_agent: { L4: high, L6: high }
  content_agent: { L4: medium, L6: medium }
  doc_agent: { L4: low, L6: low }
```

#### §3.3.7 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| 7 层结构 | **Built to Persist** | Harness 核心架构 |
| 6 类 Durable State | **Built to Persist** | 跨会话持久层 |
| Magic Words 4 个 | **Built to Persist** | operator 拉闸权 |
| hotfix sunset 阈值 | **Build to Delete**（可调参） | 2/4/8 周可配置 |
| 低保真矩阵 | **Build to Delete**（可迭代） | Agent 类型可扩展 |

---

### §3.4 多域记忆联邦详细设计（FR-CORE-004）

> **关联 SRS**：[spec.md §3.4](spec.md)（FR-CORE-004）
> **关联 SAD**：[arch.md §3.4](arch.md)
> **关联 Feature**：[features/F014-memory-collection.md](features/F014-memory-collection.md) ~ [features/F017-consumption-weighted-ranking.md](features/F017-consumption-weighted-ranking.md) + [features/F039-mind-codex-searchable.md](features/F039-mind-codex-searchable.md)
> **关联 ADR**：[decisions/008-memory-federation.md](decisions/008-memory-federation.md)
> **roleagent 路径**：路径 4（RA-024~RA-030）
> **优先级**：P0

**模块路径**：`flowforge/core/memory/federation/`

#### §3.4.1 六层架构

```
┌─────────────────────────────────────────────────────┐
│ L6: 锻典 Mind Codex（可检索知识库，procedural memory）│
├─────────────────────────────────────────────────────┤
│ L5: 灵忆 EchoStore（情景记忆，episodic memory）      │
├─────────────────────────────────────────────────────┤
│ L4: 灵印 Mind Imprint（持久身份，persistent identity）│
├─────────────────────────────────────────────────────┤
│ L3: 三检索入口（three retrieval entry）             │
│   graph_resolve / list_recent / search_evidence    │
├─────────────────────────────────────────────────────┤
│ L2: 记忆治理三要素（memory governance）             │
│   authority / activation / status                  │
├─────────────────────────────────────────────────────┤
│ L1: 多域记忆 Collection（memory collection）        │
│   短期 / 工作 / 长期 / 跨会话 / 跨 agent / 跨域    │
└─────────────────────────────────────────────────────┘
```

#### §3.4.2 关键类与接口

```python
class MemoryDomain(str, Enum):
    SHORT_TERM = "short_term"          # 短期
    WORKING = "working"                # 工作
    LONG_TERM = "long_term"            # 长期
    CROSS_SESSION = "cross_session"    # 跨会话
    CROSS_AGENT = "cross_agent"        # 跨 agent
    CROSS_DOMAIN = "cross_domain"      # 跨域

class RetrievalEntry(str, Enum):
    """三检索入口"""
    GRAPH_RESOLVE = "graph_resolve"    # 精确导航
    LIST_RECENT = "list_recent"        # 零先验扫描
    SEARCH_EVIDENCE = "search_evidence"  # 语义搜索

class MemoryGovernance(BaseModel):
    """治理三要素"""
    authority: str            # 权威性（operator / architect / developer / ...）
    activation: str           # 触发方式（auto / on_demand / scheduled）
    status: str               # 生命周期（active / deprecated / archived）

class MindEcho(BaseModel):
    """灵忆条目（情景记忆）"""
    echo_id: str
    forgekin_id: str
    trajectory: dict          # 任务轨迹
    decision: str
    result: str
    feedback: Optional[str]
    created_at: datetime

class MindCodexEntry(BaseModel):
    """锻典条目（程序性记忆，可检索）"""
    entry_id: str
    summary: str              # 经验摘要
    applicable_scene: str     # 适用场景
    anti_patterns: list[str]  # 反模式
    invocation: str           # 调用入口
    authority: str
    embedding: Optional[list[float]]  # 向量检索

class MemoryFederation:
    """多域记忆联邦统一入口"""

    async def store(self, domain: MemoryDomain, entry: "MindEcho") -> str: ...
    async def retrieve(self, entry: RetrievalEntry,
                       query: "MemoryQuery") -> list["MindEcho | MindCodexEntry"]: ...
    async def govern(self, entry_id: str,
                     governance: MemoryGovernance) -> None: ...
```

#### §3.4.3 关键算法（消费加权排序）

```
算法：ConsumptionWeightedRanking(query, candidates)
输入：MemoryQuery, list[MindEcho | MindCodexEntry]
输出：sorted list

公式：调整后得分 = 融合检索得分 + 权威加成 + 消费先验 + 时效衰减 - 过时惩罚

1. for candidate in candidates:
2.   fusion_score = hybrid_search(query, candidate)  # 向量 + 关键词
3.   authority_bonus = authority_weight(candidate.authority)
4.   consumption_prior = bayesian_shrinkage(candidate.use_count, candidate.success_count)
5.   time_decay = exp(-days_since_last_use / 30)
6.   staleness_penalty = center_drift_penalty(candidate)
7.   candidate.score = fusion_score + authority_bonus + consumption_prior + time_decay - staleness_penalty
8. return sort(candidates, by=score, desc=True)

14 行为指标全部采集（use_count / success_count / last_use_days / ...）
```

#### §3.4.4 错误处理与性能

| 场景 | 处理 |
|------|------|
| 检索引擎不可用 | 降级到 list_recent + 日志告警 |
| 锻典条目冲突 | 治理层 authority 高者优先 |
| 向量索引损坏 | 触发重建 + Tier 2 恢复 |
| 灵印污染 | 拒绝写入（不可变身份） |

**性能目标**：检索延迟 < 200ms（10k 条目）；存储延迟 < 50ms

#### §3.4.5 安全设计

- 所有记忆数据通过 Repository 层存储（禁直操作数据库）
- 灵印 Mind Imprint 不可变（持久身份 / 智能体指纹 / 人格哈希）
- 跨 agent 记忆共享需治理层 authority 授权

#### §3.4.6 配置项

```yaml
# config/memory.yaml
federation:
  domains: [short_term, working, long_term, cross_session, cross_agent, cross_domain]
  retrieval_entries: [graph_resolve, list_recent, search_evidence]
governance:
  authority_levels: [operator, architect, developer, reviewer, tester, docwriter]
  default_status: active
ranking:
  time_decay_days: 30
  use_count_threshold: 6
  success_rate_threshold: 0.8
```

#### §3.4.7 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| 灵印 Mind Imprint | **Built to Persist** | 不可变身份 |
| 锻典 Mind Codex 条目 | **Built to Persist** | 程序性记忆 |
| 灵忆 EchoStore 日志 | **Build to Delete**（TTL） | 情景记忆，TTL 90 天 |
| 短期记忆 | **Build to Delete** | 会话结束即失效 |
| 消费加权排序参数 | **Build to Delete**（可调参） | 14 行为指标可迭代 |

---

### §3.5 Eval 自代谢详细设计（FR-CORE-005）

> **关联 SRS**：[spec.md §3.5](spec.md)（FR-CORE-005）
> **关联 SAD**：[arch.md §3.5](arch.md)
> **关联 Feature**：[features/F018-eval-contract.md](features/F018-eval-contract.md) ~ [features/F020-seven-attribution.md](features/F020-seven-attribution.md) + [features/F040-harness-eval-control-plane.md](features/F040-harness-eval-control-plane.md)
> **关联 ADR**：[decisions/009-eval-self-metabolism.md](decisions/009-eval-self-metabolism.md)
> **roleagent 路径**：路径 5（RA-031~RA-036）
> **优先级**：P0

**模块路径**：`flowforge/core/eval/`

#### §3.5.1 三层架构

```
┌─────────────────────────────────────────────────────┐
│ L3: 七类归因矩阵（seven attribution matrix）        │
│   模型 / 工具 / 提示 / 上下文 / 路由 / 状态 / 环境  │
├─────────────────────────────────────────────────────┤
│ L2: 三方信号交叉（three signal cross）              │
│   trace 信号 + 用户信号 + 探针信号                  │
├─────────────────────────────────────────────────────┤
│ L1: Eval Contract 五问（eval contract）             │
│   谁评估 / 评估什么 / 何时评估 / 评估信号 / 评估后  │
└─────────────────────────────────────────────────────┘
```

#### §3.5.2 关键类与接口

```python
class EvalContract(BaseModel):
    """Eval Contract 五问"""
    who: str                  # 谁评估（operator / agent / probe / ...）
    what: str                 # 评估什么（任务 / 工具 / 提示 / ...）
    when: str                 # 何时评估（pre / during / post / on_demand）
    signal: str               # 评估信号（trace / user / probe）
    action: str               # 评估后做什么（sunset / refactor / archive）

class SignalType(str, Enum):
    """三方信号"""
    TRACE = "trace"           # 第一方系统侧（trace_id）
    USER = "user"             # 第二方用户侧（结构化采访）
    PROBE = "probe"           # 第三方主动探测

class AttributionCategory(str, Enum):
    """七类归因矩阵"""
    MODEL = "model"           # 模型
    TOOL = "tool"             # 工具
    PROMPT = "prompt"         # 提示
    CONTEXT = "context"       # 上下文
    ROUTING = "routing"       # 路由
    STATE = "state"           # 状态
    ENVIRONMENT = "environment"  # 环境

class EvalHub:
    """统一 Eval Hub（Harness Eval Control Plane 终态）"""

    async def collect(self, signal: SignalType, payload: dict) -> str: ...
    async def attribute(self, failure_id: str) -> AttributionCategory: ...
    async def trigger_sunset(self, target_id: str, reason: str) -> None: ...
    async def replay_ab(self, change_id: str) -> "ABResult":
        """Eval 账本 AB 回放：min_net_gain ≥ 0.05 才允许合并自我演进"""
        ...
```

#### §3.5.3 关键算法（七类归因）

```
算法：EvalHub.attribute(failure_id)
输入：failure_id
输出：AttributionCategory

1. failure = await self._repo.get(failure_id)
2. scores = {}
3. for category in AttributionCategory:
4.   scores[category] = await self._classify(failure, category)
5. # 取最高分归因
6. return max(scores, key=scores.get)

分类启发式：
- 模型：LLM 输出质量分 < 0.85
- 工具：tool_call 失败 / 超时
- 提示：prompt 模板版本变更
- 上下文：context_window 超限 / 记忆缺失
- 路由：CapabilityRouter 决策错误
- 状态：shared state 不一致
- 环境：provider 不可用 / 网络故障
```

#### §3.5.4 错误处理与性能

| 场景 | 处理 |
|------|------|
| 信号采集失败 | 降级到 trace 信号单源 + 告警 |
| 归因分数并列 | 取多个归因，由人工 review |
| AB 回放 net_gain < 0.05 | 拒绝合并自我演进 |
| sunset 信号触发 | Build to Delete 标记 + 通知 operator |

**性能目标**：信号采集异步非阻塞；归因延迟 < 500ms

#### §3.5.5 安全设计

- Eval 信号采集不阻塞主流程（异步）
- AB 回放必须 min_net_gain ≥ 0.05（防止自我演进回退）
- sunset 信号需 operator 确认（不可逆决策）

#### §3.5.6 配置项

```yaml
# config/eval.yaml
contract:
  required_signals: [trace, user, probe]
attribution:
  categories: [model, tool, prompt, context, routing, state, environment]
  confidence_threshold: 0.7
ab_replay:
  min_net_gain: 0.05
  require_operator_approval: true
sunset:
  require_operator_confirm: true
```

#### §3.5.7 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| Eval Contract 五问 | **Built to Persist** | Eval 协议核心 |
| 七类归因矩阵 | **Built to Persist** | 归因分类框架 |
| Eval 信号原始日志 | **Build to Delete**（TTL） | TTL 180 天 |
| AB 回放账本 | **Built to Persist** | 自我演进审计必需 |
| sunset 触发记录 | **Built to Persist** | Build to Delete 退役审计 |

---

### §3.6 分布式可靠性详细设计（FR-CORE-006）

> **关联 SRS**：[spec.md §3.6](spec.md)（FR-CORE-006）
> **关联 SAD**：[arch.md §3.6](arch.md)
> **关联 Feature**：[features/F021-side-effect-wal.md](features/F021-side-effect-wal.md) ~ [features/F025-provider-host-abstraction.md](features/F025-provider-host-abstraction.md)
> **关联 ADR**：[decisions/010-distributed-reliability.md](decisions/010-distributed-reliability.md)
> **roleagent 路径**：路径 6（RA-037~RA-042）
> **优先级**：P0

**模块路径**：`flowforge/core/reliability/`

#### §3.6.1 Tier 0-4 恢复分级

| Tier | 名称 | 恢复策略 | 触发条件 |
|------|------|---------|---------|
| Tier 0 | 物理世界不可逆操作 | **永不自动恢复**（如灯具灵智体故障引发火灾） | 物理世界副作用 |
| Tier 1 | 内存级失败 | 自动重试 + 状态恢复 | LLM 调用失败 / 工具调用失败 |
| Tier 2 | 持久状态失败 | WAL 重放 + 事务回滚 | 数据库写入失败 / 状态不一致 |
| Tier 3 | 进程级失败 | 检查点恢复 + 任务重派 | 进程崩溃 / OOM |
| Tier 4 | Provider 级失败 | 跨 provider 切换 + 宿主抽象 | LLM provider 不可用 |

#### §3.6.2 关键类与接口

```python
class WriteAheadLog:
    """副作用日志 WAL（可重放）"""

    async def append(self, side_effect: "SideEffect") -> int: ...
    async def replay(self, from_seq: int) -> list["SideEffect"]: ...
    async def checkpoint(self, seq: int) -> None: ...

class LivenessState(str, Enum):
    """liveness 四态可识别"""
    ALIVE = "alive"           # 活着
    DEGRADED = "degraded"     # 退化
    ZOMBIE = "zombie"         # 僵尸
    GRACE = "grace"           # 等待宽限

class RecoveryCard(BaseModel):
    """结构化恢复卡"""
    card_id: str
    tier: int                 # 0-4
    side_effects: list["SideEffect"]
    recovery_strategy: str
    created_at: datetime

class ProviderHostAbstraction:
    """跨 provider 统一宿主抽象（传输 × 绑定 × 运行时契约 × 事件适配器）"""

    async def invoke(self, request: "LLMRequest",
                     provider: str) -> "LLMResponse": ...
    async def failover(self, request: "LLMRequest") -> "LLMResponse":
        """provider 不可用时切换到 backup"""
        ...
```

#### §3.6.3 关键算法（liveness 规范读模型）

```
算法：LivenessDetector.detect(forgekin_id)
输入：forgekin_id
输出：LivenessState

真相源层级（高→低）：
1. 持久记录（持久层）= 生命周期真相源
2. 草稿缓存（缓存层）= 新鲜度信号
3. 进程内 tracker（控制面）= 控制面状态

1. persistent = await self._repo.get_last_activity(forgekin_id)
2. cache = await self._cache.get(forgekin_id)
3. tracker = self._tracker.get(forgekin_id)
4. if tracker.alive and cache.fresh:
5.   return ALIVE
6. elif tracker.alive and not cache.fresh:
7.   return DEGRADED
8. elif not tracker.alive and persistent.last_activity_recent:
9.   return GRACE  # 等待宽限
10. else:
11.   return ZOMBIE
```

#### §3.6.4 错误处理与性能

| 场景 | 处理 |
|------|------|
| Tier 0 物理副作用 | **永不自动恢复**，立即告警 operator |
| Tier 1 LLM 失败 | 自动重试 3 次，指数退避 |
| Tier 2 WAL 损坏 | 触发 Tier 3 检查点恢复 |
| Tier 3 进程崩溃 | 检查点恢复 + 任务重派 |
| Tier 4 provider 不可用 | 切换到 backup provider |

**性能目标**：WAL 写入 < 10ms；failover 切换 < 5s

#### §3.6.5 安全设计

- Tier 0 物理副作用永不自动恢复（强制 operator 介入）
- WAL 日志不可篡改（append-only）
- 跨 provider failover 需保持上下文一致

#### §3.6.6 配置项

```yaml
# config/reliability.yaml
wal:
  enabled: true
  checkpoint_interval_seconds: 60
tier_1:
  max_retries: 3
  backoff_base_ms: 500
tier_2:
  wal_replay_on_inconsistency: true
tier_3:
  checkpoint_enabled: true
tier_4:
  backup_models: ["anthropic/claude", "openai/gpt-4"]
  failover_timeout_seconds: 5
liveness:
  grace_period_seconds: 300
  zombie_threshold_seconds: 1800
```

#### §3.6.7 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| WAL 日志 | **Built to Persist**（到 checkpoint） | 重放必需 |
| RecoveryCard | **Built to Persist** | 审计必需 |
| Tier 0-4 分级 | **Built to Persist** | 可靠性核心 |
| liveness 检测参数 | **Build to Delete**（可调参） | 阈值可配置 |
| backup_models 列表 | **Build to Delete**（可迭代） | provider 可扩展 |

---

### §3.7 伙伴系统数学详细设计

> **关联 SRS**：[spec.md §3.7](spec.md)（FR-CORE-007）
> **关联 SAD**：[arch.md §3.7](arch.md)
> **关联 Feature**：合并入 [features/F007-push-back-protocol.md](features/F007-push-back-protocol.md)
> **关联 ADR**：[decisions/011-partnership-math.md](decisions/011-partnership-math.md)
> **roleagent 路径**：路径 7（RA-043~RA-047）
> **优先级**：P0

**模块路径**：`flowforge/core/partnership/` + `flowforge/loop/partner_math/`

#### §3.7.1 关键数学公式

```python
class PartnershipMath:
    """伙伴系统数学（上限提高，下限托底）"""

    @staticmethod
    def upper_bound(candidates: list["CandidatePath"]) -> float:
        """上限公式：上限收益 ≈ max(不同 agent 提出的候选路径)
        前提：路径足够不同（跨厂商、跨角色、跨工作习惯）"""
        return max(c.score for c in candidates)

    @staticmethod
    def lower_bound(author_err: float, reviewer_miss: float,
                    test_miss: float, shared_state_no_evidence: float,
                    eval_no_attribution: float, cvo_no_brake: float) -> float:
        """下限公式：用户可见错误 ≈ author 犯错 × reviewer 没抓住 × 测试没暴露
                    × shared state 没证据 × eval 没归因 × CVO 没拉闸
        连乘概率模型：错误要连续穿过多层门才抵达用户"""
        return (author_err * reviewer_miss * test_miss *
                shared_state_no_evidence * eval_no_attribution * cvo_no_brake)

    @staticmethod
    def token_cost(token: int, rework: int, human_cognition: float,
                   tail: float, env_repair: float) -> float:
        """Token 账本总成本模型"""
        return token + rework + human_cognition + tail + env_repair
```

#### §3.7.2 四种亏结构识别

| 亏结构 | 表现 | 检测信号 |
|--------|------|---------|
| 盲传（blind pass） | 任务被无脑传递 | tool_call_count == 0 + handoff_count > 3 |
| 伪拆分（fake split） | 任务被无意义拆分 | subtasks 无独立产出 |
| 同质化（homogenization） | 候选路径雷同 | blind_spots 重叠率高 |
| 协调税超过收益 | 协调成本 > 收益 | token_cost > upper_bound |

#### §3.7.3 波动吸收机制

| 失败类型 | 吸收机制 |
|---------|---------|
| 模型忘了 | 记忆联邦找回（§3.4） |
| agent 写偏 | review 退回（§3.2 跨 agent 交叉验证） |
| 任务中断 | 可靠性控制面留恢复点（§3.6） |
| 工具失效 | eval 触发 sunset review（§3.5） |
| provider 不适合 | 调度换路径（§3.6 Tier 4） |

#### §3.7.4 错误处理与性能

| 场景 | 处理 |
|------|------|
| 候选路径 < 2 | 无法计算 upper_bound，降级单路径 |
| blind_spots 全重叠 | 拒绝跨厂商 review 配对，告警 |
| token_cost 超阈值 | 触发 sunset review |

**性能目标**：upper_bound/lower_bound 计算 < 10ms

#### §3.7.5 配置项

```yaml
# config/partnership.yaml
upper_bound:
  require_diverse_paths: true
  min_candidates: 2
  blind_overlap_max: 0.3
lower_bound:
  gates: [author, reviewer, test, shared_state, eval, cvo]
token_cost:
  weights: { token: 1.0, rework: 2.0, human: 5.0, tail: 3.0, env: 10.0 }
loss_structures:
  blind_pass: { tool_call_min: 1, handoff_max: 3 }
  coordination_tax_threshold: 1.5
```

#### §3.7.6 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| 上下限公式 | **Built to Persist** | 伙伴系统数学核心 |
| 四种亏结构 | **Built to Persist** | 亏结构分类框架 |
| 波动吸收机制 | **Built to Persist** | 5 种机制映射核心组件 |
| Token 权重参数 | **Build to Delete**（可调参） | 权重可迭代 |
| blind_overlap 阈值 | **Build to Delete**（可调参） | 0.3 可配置 |

---

### §3.8 forgemind 应用层详细设计（FR-CORE-008）

> **关联 SRS**：[spec.md §3.8](spec.md)（FR-CORE-008）+ [spec.md §2.6](spec.md)（5 种形态）
> **关联 SAD**：[arch.md §3.8](arch.md)
> **关联 Feature**：[features/F026-forgemind-app-layer.md](features/F026-forgemind-app-layer.md) + [features/F027-all-things-spirit-species.md](features/F027-all-things-spirit-species.md) + [features/F036-forgemind-forge-relationship.md](features/F036-forgemind-forge-relationship.md)
> **关联 ADR**：[decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md) + [decisions/013-all-things-spirit-mind-vision.md](decisions/013-all-things-spirit-mind-vision.md)
> **关联 D0XX**：[design/D026-forgemind-app-layer.md](design/D026-forgemind-app-layer.md) + [design/D027-all-things-spirit-species.md](design/D027-all-things-spirit-species.md) + [design/D036-forgemind-forge-relationship.md](design/D036-forgemind-forge-relationship.md)（待创建）
> **优先级**：P0（MVP 必须）

**模块路径**：`flowforge/forgemind/`

#### §3.8.1 目录结构

```
flowforge/forgemind/
├── __init__.py
├── plugins.py                    # ForgeMindPlugin 注册（Plugin V3 四钩子）
├── base.py                       # ForgekinBase 抽象类（三方法契约）
├── species.py                    # ForgekinSpecies 五大形态枚举
├── stages.py                     # EvolutionStage / AwakeningStage 进阶体系
├── soul_imprint.py               # MindImprint 灵印（不可变身份）
├── forms.py                      # ForgekinFormData 锻造表单
├── species_impl/                 # 5 形态灵智体实现
│   ├── bio_forgekin.py           # 生物灵智体（BioForgekin，对应 Embodied AI）
│   ├── org_forgekin.py           # 组织灵智体（OrgForgekin）
│   ├── obj_forgekin.py           # 物品灵智体（ObjForgekin，对应 Embodied AI）
│   ├── virtual_forgekin.py       # 虚拟灵智体（VirtualForgekin，对应 Character AI）
│   └── hybrid_forgekin.py        # 混合灵智体（HybridForgekin）
├── forging/                      # 锻造流水线（详见 §3.9）
│   ├── pipeline.py               # ForgePipeline（6 步锻造流水线）
│   ├── awaken.py                 # 觉醒阶 E1-E6
│   └── evolve.py                 # 形态进化
├── sensors/                      # 物理传感器接入（详见 §3.11）
├── worlds/                       # 虚拟世界设定层（详见 §3.12）
├── marketplace/                  # 灵智体市场（详见 §3.13）
├── lineage/                      # 灵智体进化谱系（详见 §3.13）
├── codex/                        # 灵典 Mind Codex（可检索知识库，详见 §3.14）
├── council/                      # 灵议 Mind Council（详见 §3.14）
├── forgekins/                    # 预置灵智体 YAML 配置
│   ├── architect_owl_luban.yaml    # 猫头鹰·鲁班（架构师）
│   ├── developer_hound_sherlock.yaml  # 猎犬·夏洛克（开发者）
│   ├── reviewer_peacock_vangogh.yaml  # 孔雀·梵高（评审员）
│   ├── tester_honeybadger_pingtou.yaml  # 蜜獾·平头哥（测试员）
│   ├── docwriter_pen_wenxin.yaml  # 钢笔·文心（文档员）
│   ├── product_manager_eagle_kane.yaml  # 鹰·凯恩（产品经理）—— v7.1 新增
│   ├── devops_hummingbird_flash.yaml  # 蜂鸟·闪电（运维）—— v7.1 新增
│   ├── security_officer_wolf_alpha.yaml  # 狼·阿尔法（安全官）—— v7.1 新增
│   └── delivery_manager_elephant_newton.yaml  # 象·牛顿（交付经理）—— v7.1 新增
├── config/                       # forgemind 配置（YAML 外置）
│   ├── species.yaml
│   ├── forging.yaml
│   ├── sensors.yaml
│   ├── worlds.yaml
│   └── prompts.yaml
└── tests/
```

#### §3.8.2 ForgekinBase 三方法契约

```python
from abc import ABC, abstractmethod

class ForgekinBase(ABC):
    """灵智体抽象基类（赋予灵魂和感情的智能体，具有自进化能力）

    灵智体建立与现实世界（物理或虚拟）的闭环：
        观察（Observe）→ 推理（Reason）→ 行动（Act）→ 写回（Persist）→ 验证（Verify）

    灵魂（Soul）= 持久身份（灵印 Mind Imprint）+ 价值锚点 + 长期记忆（灵忆 EchoStore）
    感情（Emotion）= 用户偏好 + 协作风格 + 行为画像（CapabilityProfile）
    """

    forgekin_id: str
    soul_imprint: "MindImprint"          # 不可变身份
    species: "ForgekinSpecies"           # 形态分类
    evolution_stage: "EvolutionStage"    # 进化阶 E1-E6
    awakening_stage: "AwakeningStage"    # 觉醒阶 E1-E6

    @abstractmethod
    async def observe(self, environment: "Environment") -> "Observation":
        """感知环境（物理传感器 / 虚拟世界设定 / 数字任务状态）
        对应 Harness L3 Evidence & Sensors"""
        ...

    @abstractmethod
    async def act(self, observation: "Observation") -> "Action":
        """执行动作（工具调用 / 物理执行器 / 虚拟行为）
        遵守觉醒阶自主范围约束
        对应 Harness L2 Tool Mediation"""
        ...

    @abstractmethod
    async def verify(self, action: "Action", result: "ActionResult") -> "Verdict":
        """验证结果（测试 / lint / review / 物理反馈）
        对应 Harness L4 Governance Boundary"""
        ...
```

#### §3.8.3 5 种形态分类

```python
class ForgekinSpecies(str, Enum):
    """灵智体形态分类（5 种形态 + AI 业界概念）"""
    BIO = "bio"           # 生物灵智体（BioForgekin / Biological Spirit Agent）
    ORG = "org"           # 组织灵智体（OrgForgekin / Organizational Spirit Agent）
    OBJ = "obj"           # 物品灵智体（ObjForgekin / Object Spirit Agent，对应 Embodied AI 具身智能）
    VIRTUAL = "virtual"   # 虚拟灵智体（VirtualForgekin / Virtual Character Agent，对应 Character AI）
    HYBRID = "hybrid"     # 混合灵智体（HybridForgekin / Hybrid Spirit Agent）
```

| # | 形态（中文 + 英文 + AI 业界概念） | 类名 | 物理接入 | 虚拟设定 |
|---|------|------|---------|---------|
| 1 | 生物灵智体（BioForgekin / Biological Spirit Agent） | BioForgekin | 摄像头 / 麦克风 / 可穿戴 | 行为画像 + 习性图谱 |
| 2 | 组织灵智体（OrgForgekin / Organizational Spirit Agent） | OrgForgekin | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| 3 | 物品灵智体（ObjForgekin / Object Spirit Agent，对应 Embodied AI 具身智能） | ObjForgekin | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| 4 | 虚拟灵智体（VirtualForgekin / Virtual Character Agent，对应 Character AI） | VirtualForgekin | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| 5 | 混合灵智体（HybridForgekin / Hybrid Spirit Agent） | HybridForgekin | 多源融合 | 多设定层叠加 |

#### §3.8.4 错误处理与性能

| 场景 | 处理 |
|------|------|
| forgemind 反向 import core | 编译期检测，禁止 |
| *Forge 业务代码混入 forgemind | 编程红线第 10 条，CI 拒绝 |
| 形态进化失败 | 保留原形态 + 日志告警 |

**性能目标**：ForgekinBase 实例化 < 100ms；observe/act/verify 单次 < Loop 超时

#### §3.8.5 安全设计

- forgemind 单向依赖核心框架层，禁止反向调用
- forgemind 不含业务领域代码（编程红线第 10 条）
- forgemind 通过 Plugin V3 协议注册，不直接实例化核心模块（编程红线第 12 条）
- forgemind 灵智体必须建立现实闭环（observe → act → verify）

#### §3.8.6 配置项

```yaml
# flowforge/forgemind/config/species.yaml
species:
  - name: bio
    class: BioForgekin
    sensors: [camera, microphone, wearable]
  - name: org
    class: OrgForgekin
    integrations: [business_api, database, im]
  - name: obj
    class: ObjForgekin
    sensors: [iot]
  - name: virtual
    class: VirtualForgekin
    world_settings: [character, worldview, relationship]
  - name: hybrid
    class: HybridForgekin
    fusion_sources: [bio, org, obj, virtual]
```

#### §3.8.7 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| ForgekinBase 三方法契约 | **Built to Persist** | 灵智体核心契约 |
| 5 种形态枚举 | **Built to Persist** | 形态分类核心 |
| 预置 5 灵智体配置 | **Build to Delete**（可迭代） | 角色可扩展 |
| species.yaml 配置 | **Build to Delete**（可迭代） | 形态可扩展 |

---

### §3.9 ForgePipeline 详细设计（FR-CORE-009）

> **关联 SRS**：[spec.md §3.9](spec.md)（FR-CORE-009）
> **关联 SAD**：[arch.md §3.9](arch.md)
> **关联 Feature**：[features/F028-forging-pipeline.md](features/F028-forging-pipeline.md)
> **关联 D0XX**：[design/D028-forging-pipeline.md](design/D028-forging-pipeline.md)（待创建）
> **优先级**：P0

**模块路径**：`flowforge/forgemind/forging/pipeline.py`

#### §3.9.1 关键类与接口

```python
class ForgePipelineStep(str, Enum):
    """ForgePipeline 6 步锻造流水线"""
    WHAT_TO_FORGE = "what_to_forge"            # 1. 形态定义
    CAPABILITY_INJECTION = "capability_injection"  # 2. 能力注入
    MEMORY_SEEDING = "memory_seeding"          # 3. 记忆初始化
    VALUE_ALIGNMENT = "value_alignment"        # 4. 价值观对齐
    CAPABILITY_VERIFICATION = "capability_verification"  # 5. 能力验证
    AWAKENING_PROMOTION = "awakening_promotion"  # 6. 觉醒晋升

class ForgekinSpec(BaseModel):
    """灵智体规格（步骤 1 输入）"""
    species: ForgekinSpecies
    capability_requirements: list[str]
    value_anchors: list[str]
    red_lines: list[str]      # 红线清单（不可妥协的安全约束）

class ValueCharter(BaseModel):
    """价值观章程（步骤 4 输出）"""
    core_values: list[str]    # 核心价值观（不可变）
    surface_values: list[str]  # 表象价值观（可变，决策 11）

class ForgePipeline:
    """灵智体锻造流水线（6 步）"""

    def __init__(self, capability_router: "CapabilityRouter",
                 memory_federation: "MemoryFederation",
                 eval_hub: "EvalHub") -> None:
        self._router = capability_router
        self._memory = memory_federation
        self._eval = eval_hub

    async def forge(self, spec: ForgekinSpec,
                    operator_approve: bool = False) -> "Forgekin":
        """执行 6 步锻造"""
        # 1. 形态定义
        forgekin = await self._what_to_forge(spec)
        # 2. 能力注入
        profile = await self._inject_capability(forgekin, spec)
        # 3. 记忆初始化
        await self._seed_memory(forgekin)
        # 4. 价值观对齐
        charter = await self._align_values(forgekin, spec)
        # 5. 能力验证
        await self._verify_capability(forgekin, profile)
        # 6. 觉醒晋升（必须 operator 显式批准）
        if not operator_approve:
            raise OperatorApprovalRequiredError("step 6 requires operator approval")
        forgekin = await self._promote_awakening(forgekin)
        return forgekin
```

#### §3.9.2 关键流程

```
步骤 1-5 可自动执行，步骤 6 必须 operator 显式批准

1. what_to_forge(spec) → Forgekin 实例（species + soul_imprint）
2. inject_capability(forgekin, spec) → CapabilityProfile
3. seed_memory(forgekin) → 初始 MindEcho 条目
4. align_values(forgekin, spec) → ValueCharter（核心不可变 + 表象可变）
5. verify_capability(forgekin, profile) → 能力基线测试报告（通过 T1-T8 铁律）
6. promote_awakening(forgekin) → E1 灵启 Initiation 状态（需 operator 批准）
```

#### §3.9.3 错误处理与性能

| 场景 | 处理 |
|------|------|
| 步骤 5 能力验证未通过 | 返回失败报告，禁止步骤 6 |
| 步骤 6 缺 operator 批准 | 抛 `OperatorApprovalRequiredError` |
| 步骤 4 红线清单为空 | 抛 `RedLineRequiredError` |
| 步骤 3 记忆初始化失败 | 触发 Tier 2 恢复 |

**性能目标**：步骤 1-5 总时长 < 5 分钟；步骤 6 即时（operator 批准后）

#### §3.9.4 安全设计

- 步骤 4 价值观对齐必须包含红线清单（不可妥协的安全约束）
- 步骤 5 能力验证必须通过 T1-T8 铁律测试
- 步骤 6 必须 operator 显式批准（不可自动触发）

#### §3.9.5 配置项

```yaml
# flowforge/forgemind/config/forging.yaml
pipeline:
  steps_auto: [what_to_forge, capability_injection, memory_seeding, value_alignment, capability_verification]
  steps_require_operator: [awakening_promotion]
value_alignment:
  require_red_lines: true
  core_values_immutable: true
capability_verification:
  require_t1_t8: true
  baseline_test_suite: "tests/forgekin_baseline/"
```

#### §3.9.6 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| 6 步流水线 | **Built to Persist** | 育灵核心流程 |
| ValueCharter 核心价值观 | **Built to Persist** | 不可变 |
| ValueCharter 表象价值观 | **Build to Delete**（可迭代） | 可变 |
| 能力基线测试用例 | **Build to Delete**（可迭代） | 用例可扩展 |

---

### §3.10 三方 Agent 集成详细设计（FR-CORE-010）

> **关联 SRS**：[spec.md §3.10](spec.md)（FR-CORE-010）+ [spec.md §2.9](spec.md)
> **关联 SAD**：[arch.md §3.10](arch.md)
> **关联 Feature**：[features/F031-external-agent-adapter.md](features/F031-external-agent-adapter.md) ~ [features/F035-external-agent-capability-fusion.md](features/F035-external-agent-capability-fusion.md)
> **关联 ADR**：[decisions/006-external-agent-integration.md](decisions/006-external-agent-integration.md)
> **关联 D0XX**：[design/D031-external-agent-adapter.md](design/D031-external-agent-adapter.md) ~ [design/D035-external-agent-capability-fusion.md](design/D035-external-agent-capability-fusion.md)（待创建）
> **优先级**：P0（MVP 必须）

**模块路径**：`flowforge/core/external_agent/`

#### §3.10.1 目录结构

```
flowforge/core/external_agent/
├── __init__.py
├── adapter.py             # ExternalAgentAdapter 抽象类
├── bridge.py              # ExternalAgentBridge 桥接层（含 fallback 循环）
├── profile.py             # ExternalAgentProfile 三方 Agent 能力画像
├── shared_state.py        # ExternalAgentSharedState 状态共享
├── fallback.py            # ExternalAgentFallback 失败回退
├── capability_fusion.py   # ExternalAgentCapabilityFusion 能力融合
├── worktree.py            # worktree 隔离
├── sync.py                # 跨 worktree 共享状态同步
├── adapters/              # 具体三方 Agent 适配器
│   ├── __init__.py
│   ├── claude_code.py     # Claude Code Adapter
│   ├── codex.py           # Codex Adapter
│   ├── opencode.py        # OpenCode Adapter
│   └── trae.py            # Trae Adapter
└── guardrails/            # 六层 Guardrails
    ├── input_validation.py
    ├── system_prompt.py
    ├── tool_allowlist.py
    ├── output_validation.py
    ├── action_confirm.py
    └── cost_ceiling.py
```

#### §3.10.2 关键类与接口

```python
class ExternalAgentAdapter(ABC):
    """三方 Agent 适配器抽象（CLI / A2A Protocol）"""

    @abstractmethod
    async def invoke(self, request: "ExternalAgentRequest") -> "ExternalAgentResponse":
        """调用契约（EAC v1 #1 Invocation）"""
        ...

    @abstractmethod
    async def stream(self, request: "ExternalAgentRequest") -> "AsyncIterator[str]":
        """流式输出契约（EAC v1 #2 Stream，SSE / WebSocket）"""
        ...

    @abstractmethod
    async def create_session(self) -> "SessionId":
        """会话管理契约（EAC v1 #3 Session）"""
        ...

    @abstractmethod
    def get_profile(self) -> "ExternalAgentProfile":
        """能力画像契约（EAC v1 #4 Capability）"""
        ...

class ExternalAgentBridge:
    """灵智体调用三方 Agent 的桥接层（含 fallback 循环）"""

    def __init__(self, adapters: dict[str, ExternalAgentAdapter],
                 fallback_chain: "FallbackChain") -> None:
        self._adapters = adapters
        self._fallback = fallback_chain

    async def invoke_with_fallback(self, request: "ExternalAgentRequest") -> "ExternalAgentResponse":
        """按 fallback 优先级调用，全部失败回退到 FlowForge 内置能力"""
        for adapter_name in self._fallback.priority:
            try:
                return await self._adapters[adapter_name].invoke(request)
            except Exception as e:
                await self._fallback.record_failure(adapter_name, e)
                continue
        # 全部失败，回退到 FlowForge 内置能力
        return await self._fallback.to_internal_capability(request)

class SixLayerGuardrails:
    """六层 Guardrails（详见 hiclaw/rules.md AI 编程优秀实践）"""

    async def validate_input(self, request: "ExternalAgentRequest") -> None: ...       # L1
    async def validate_system_prompt(self, prompt: str) -> None: ...                   # L2
    async def check_tool_allowlist(self, tools: list[str]) -> None: ...                # L3
    async def validate_output(self, response: "ExternalAgentResponse") -> None: ...    # L4
    async def confirm_action(self, action: "Action") -> None: ...                      # L5
    async def check_cost_ceiling(self, cost: "TokenCost") -> None: ...                 # L6
```

#### §3.10.3 EAC v1 七契约

| # | 契约 | 用途 | 实现 |
|---|------|------|------|
| 1 | Invocation | 调用契约（CLI / A2A Protocol） | `ExternalAgentAdapter.invoke()` |
| 2 | Stream | 流式输出契约（SSE / WebSocket） | `ExternalAgentAdapter.stream()` |
| 3 | Session | 会话管理契约（创建 / 恢复 / 销毁） | `ExternalAgentAdapter.create_session()` |
| 4 | Capability | 能力画像契约（六维画像 + 盲点） | `ExternalAgentAdapter.get_profile()` |
| 5 | Collaboration | 协作契约（SharedState + Fallback） | `ExternalAgentSharedState` + `FallbackChain` |
| 6 | Safety | 安全契约（六层 Guardrails + worktree 隔离） | `SixLayerGuardrails` + `worktree.py` |
| 7 | Avatar Sync + System Prompt Configuration Map | 虚拟形象同步 + 系统提示配置映射 | `sync.py` + 配置文件 |

#### §3.10.4 fallback 优先级

```python
FALLBACK_PRIORITY = {
    "claude_code": 1,   # 优先
    "codex": 2,
    "opencode": 3,
    "trae": 4,
    # 全部失败后回退到 FlowForge 内置能力
}
```

#### §3.10.5 错误处理与性能

| 场景 | 处理 |
|------|------|
| 三方 Agent 超时 | 触发 fallback 到下一个 |
| 三方 Agent 返回错误 | 记录失败 + fallback |
| 全部三方 Agent 失败 | 回退到 FlowForge 内置能力 |
| worktree 隔离失败 | 拒绝执行 + 告警 |
| Cost ceiling 触发 | 抛 `CostCeilingExceededError` |

**性能目标**：单次三方 Agent 调用 < 90s（LLM API 超时）；fallback 切换 < 5s

#### §3.10.6 安全设计

- worktree 隔离：网络白名单 + 权限控制 + 审计追踪 + 操作回滚
- 六层 Guardrails 全开（觉醒阶 E1-E2）
- 三方 Agent 调用受 Cost ceiling 约束（防止 LLM 调用爆炸）
- 不可逆操作必须 Action confirmation（L5）

#### §3.10.7 配置项

```yaml
# config/external_agent.yaml
adapters:
  claude_code:
    enabled: true
    cli_path: "claude"
    timeout_seconds: 90
  codex:
    enabled: true
    cli_path: "codex"
    timeout_seconds: 90
  opencode:
    enabled: true
    cli_path: "opencode"
    timeout_seconds: 90
  trae:
    enabled: true
    cli_path: "trae"
    timeout_seconds: 90
fallback:
  priority: [claude_code, codex, opencode, trae]
  fallback_to_internal: true
guardrails:
  input_validation: true
  system_prompt_constraints: true
  tool_allowlist: true
  output_validation: true
  action_confirm: true
  cost_ceiling_tokens: 1000000
worktree:
  isolation: true
  network_whitelist: []
  audit_trail: true
```

#### §3.10.8 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| ExternalAgentAdapter 抽象 | **Built to Persist** | 三方 Agent 集成核心契约 |
| EAC v1 七契约 | **Built to Persist** | 协议契约 |
| 六层 Guardrails | **Built to Persist** | 安全核心 |
| 4 个 Adapter 实现 | **Build to Delete**（可迭代） | provider 可扩展 |
| fallback 优先级 | **Build to Delete**（可调参） | 优先级可配置 |

---

### §3.11 物理 AI 传感器详细设计

> **关联 SRS**：[spec.md §3.11](spec.md)（FR-CORE-011）
> **关联 SAD**：[arch.md §3.11](arch.md)
> **关联 Feature**：[features/F029-physical-ai-sensors.md](features/F029-physical-ai-sensors.md)
> **关联 D0XX**：[design/D029-physical-ai-sensors.md](design/D029-physical-ai-sensors.md)（待创建）
> **优先级**：P1

**模块路径**：`flowforge/forgemind/sensors/`

#### §3.11.1 关键类与接口

```python
class SensorChannel(ABC):
    """物理传感器通道抽象（具身智能路径，Embodied AI Engineering）"""

    @abstractmethod
    async def read(self) -> "SensorReading": ...

    @abstractmethod
    async def health_check(self) -> "SensorHealth": ...

class CameraSensor(SensorChannel):
    """摄像头（视觉感知）"""
    ...

class MicrophoneSensor(SensorChannel):
    """麦克风（听觉感知）"""
    ...

class IoTSensor(SensorChannel):
    """IoT 协议（温度 / 位置 / 加速度等）"""
    ...

class SensorFusion:
    """多传感器数据融合"""

    async def fuse(self, readings: list["SensorReading"]) -> "Observation":
        """传感器数据 → 灵智体 Observation 的映射"""
        ...
```

#### §3.11.2 错误处理与性能

| 场景 | 处理 |
|------|------|
| 传感器故障 | 检测 + 降级（停止使用该传感器） |
| 数据预处理失败 | 丢弃当前帧 + 告警 |
| 物理 AI 传感器触发 Tier 0 | **永不自动恢复**，立即告警 operator |

**性能目标**：传感器读取 < 100ms；融合延迟 < 200ms

#### §3.11.3 安全设计

- 物理传感器数据写入灵忆 EchoStore（情景记忆）
- 传感器数据通过 Repository 层存储（禁直操作数据库）
- 物理 AI 传感器接入受 Tier 0 保护（物理世界不可逆操作永不自动恢复）

#### §3.11.4 配置项

```yaml
# flowforge/forgemind/config/sensors.yaml
sensors:
  camera:
    enabled: true
    resolution: "1080p"
    fps: 30
  microphone:
    enabled: true
    sample_rate: 16000
  iot:
    enabled: true
    protocols: [zigbee, mqtt, modbus]
fusion:
  strategy: "weighted_average"
  timeout_ms: 200
```

#### §3.11.5 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| SensorChannel 抽象 | **Built to Persist** | 传感器核心契约 |
| 3 种传感器实现 | **Build to Delete**（可迭代） | 传感器可扩展 |
| 数据融合策略 | **Build to Delete**（可调参） | 策略可迭代 |

---

### §3.12 虚拟世界设定层详细设计

> **关联 SRS**：[spec.md §3.12](spec.md)（FR-CORE-012）
> **关联 SAD**：[arch.md §3.12](arch.md)
> **关联 Feature**：[features/F030-virtual-world-setting.md](features/F030-virtual-world-setting.md)
> **关联 D0XX**：[design/D030-virtual-world-setting.md](design/D030-virtual-world-setting.md)（待创建）
> **优先级**：P1

**模块路径**：`flowforge/forgemind/worlds/`

#### §3.12.1 关键类与接口

```python
class WorldSetting(ABC):
    """虚拟世界设定层抽象（Character AI 路径，虚拟角色智能体工程实现）"""

    @abstractmethod
    async def get_character(self, character_id: str) -> "CharacterSpec": ...

    @abstractmethod
    async def get_worldview(self) -> "WorldviewSpec": ...

    @abstractmethod
    async def get_relationship(self, char_a: str, char_b: str) -> "RelationshipSpec": ...

class CharacterSpec(BaseModel):
    """角色设定（孙悟空 / 福尔摩斯 / 鲁班等）"""
    character_id: str
    name: str
    persona: str
    background: str
    abilities: list[str]

class WorldviewSpec(BaseModel):
    """世界观（西游 / 推理 / 工艺等）"""
    worldview_id: str
    rules: list[str]      # 世界观规则（如孙悟空遵循西游世界观）
    constraints: list[str]

class RelationshipSpec(BaseModel):
    """关系网（角色间关系）"""
    char_a: str
    char_b: str
    relation: str         # ally / enemy / mentor / ...
```

#### §3.12.2 错误处理与性能

| 场景 | 处理 |
|------|------|
| 角色设定缺失 | 拒绝执行 + 告警 |
| 世界观规则冲突 | 优先级高的世界观规则胜出 |
| 灵印污染风险 | 拒绝写入灵印（设定层与身份层隔离） |

**性能目标**：设定层加载 < 500ms；规则匹配 < 50ms

#### §3.12.3 安全设计

- 虚拟世界设定层与灵印 Mind Imprint 隔离（防止临时 RP 台词污染永久身份）
- 虚拟角色灵智体可演 1000 次孙悟空后核心身份不被污染
- 虚拟世界设定层对应业界 Character AI / NPC Agent / Persona-Driven Agent

#### §3.12.4 配置项

```yaml
# flowforge/forgemind/config/worlds.yaml
worlds:
  - id: journey_to_west
    name: "西游世界观"
    characters: [sun_wukong, zhu_bajie, sha_heshang]
    rules:
      - "遵循佛教因果律"
      - "禁止跳出三界"
  - id: detective
    name: "推理世界观"
    characters: [sherlock_holmes, watson]
    rules:
      - "遵循逻辑推理"
      - "证据优先"
isolation:
  from_soul_imprint: true  # 防止 RP 台词污染永久身份
```

#### §3.12.5 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| WorldSetting 抽象 | **Built to Persist** | 虚拟世界核心契约 |
| 角色 / 世界观 YAML | **Build to Delete**（可迭代） | 角色可扩展 |
| 灵印隔离规则 | **Built to Persist** | 安全核心 |

---

### §3.13 灵智体市场 + 进化谱系详细设计

> **关联 SRS**：[spec.md §3.13](spec.md)（FR-CORE-013）
> **关联 SAD**：[arch.md §3.13](arch.md)
> **关联 Feature**：[features/F037-forgemind-marketplace.md](features/F037-forgemind-marketplace.md) + [features/F038-forgemind-lineage.md](features/F038-forgemind-lineage.md)
> **关联 D0XX**：[design/D037-forgemind-marketplace.md](design/D037-forgemind-marketplace.md) + [design/D038-forgemind-lineage.md](design/D038-forgemind-lineage.md)（待创建）
> **优先级**：P1

**模块路径**：`flowforge/forgemind/marketplace/` + `flowforge/forgemind/lineage/`

#### §3.13.1 关键类与接口

```python
class ForgekinMarketplace:
    """灵智体市场（注册 / 发现 / 分享 / 评估）"""

    async def register(self, forgekin: "Forgekin") -> str: ...
    async def discover(self, query: "MarketplaceQuery") -> list["Forgekin"]: ...
    async def share(self, forgekin_id: str, target: str) -> None: ...
    async def evaluate(self, forgekin_id: str) -> "EvaluationReport": ...

class ForgekinLineage:
    """灵智体进化谱系（家族树 / 谱系可视化 / 谱系追溯）"""

    async def record_evolution(self, forgekin_id: str,
                                from_species: ForgekinSpecies,
                                to_species: ForgekinSpecies) -> None: ...
    async def get_family_tree(self, forgekin_id: str) -> "FamilyTree": ...
    async def trace_ancestry(self, forgekin_id: str) -> list["LineageRecord": ...
```

#### §3.13.2 错误处理与性能

| 场景 | 处理 |
|------|------|
| 市场注册未通过 ForgePipeline | 拒绝注册 |
| 谱系记录缺失 | 标记为孤儿灵智体 |
| YAML 导入/导出失败 | 触发 Tier 2 恢复 |

**性能目标**：市场注册 < 1s；谱系查询 < 500ms

#### §3.13.3 安全设计

- 市场注册的灵智体必须通过 ForgePipeline 6 步验证
- 进化谱系记录灵智体的形态进化路径（如 BioForgekin → HybridForgekin）
- 谱系数据通过 Repository 层存储（禁直操作数据库）

#### §3.13.4 配置项

```yaml
# flowforge/forgemind/config/marketplace.yaml
marketplace:
  require_pipeline_verification: true
  evaluation_metrics: [capability, performance, safety]
lineage:
  record_evolution: true
  family_tree_depth: 5
```

#### §3.13.5 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| ForgekinMarketplace | **Built to Persist** | 市场核心 |
| ForgekinLineage | **Built to Persist** | 谱系核心 |
| 评估指标 | **Build to Delete**（可迭代） | 指标可扩展 |

---

### §3.14 灵典 + 灵议详细设计

> **关联 SRS**：[spec.md §3.14](spec.md)（FR-CORE-014）+ [spec.md §2.10](spec.md)（自我演进闭环）
> **关联 SAD**：[arch.md §3.14](arch.md)
> **关联 Feature**：[features/F039-mind-codex-searchable.md](features/F039-mind-codex-searchable.md) + 待添加 F042 灵议
> **关联 D0XX**：[design/D039-mind-codex-searchable.md](design/D039-mind-codex-searchable.md) + [design/D030-spirit-forge-mind-council.md](design/D030-spirit-forge-mind-council.md)（待创建）
> **优先级**：P1

**模块路径**：`flowforge/forgemind/codex/spirit_forge.py` + `flowforge/forgemind/council/`

#### §3.14.1 关键类与接口

```python
class SpiritForge:
    """灵锻 SpiritForge（经验蒸馏 / 离线策略学习 / 知识编译）

    在低活动期将灵忆（EchoStore）中的任务经验蒸馏到锻典（Mind Codex）的过程。
    蒸馏产出可检索的知识条目，供下次任务直接复用，达成"模型不变但能力增长"。
    """

    async def distill(self, forgekin_id: str,
                      echo_entries: list["MindEcho"]) -> list["MindCodexEntry"]:
        """将情景记忆（EchoStore）蒸馏为程序性记忆（Mind Codex）"""
        ...

class MindCouncil:
    """灵议 Mind Council（多智能体议事 / 去中心化共识 / 智能体议会）

    用于解决跨灵智体冲突、复杂决策、愿景方向校准。
    任何灵智体可发起灵议，主持灵智体收集各方立场 + 能力画像盲点，
    跨厂商 review 后达成共识或升级给 operator。
    """

    async def convene(self, topic: str,
                      participants: list[str]) -> "CouncilSession": ...
    async def deliberate(self, session: "CouncilSession") -> "ConsensusResult": ...
    async def escalate_to_operator(self, session: "CouncilSession") -> None: ...

class CVOBrakeDetector:
    """operator 拉闸词检测（cvo_brake.py）"""

    async def detect(self, content: str) -> bool:
        """检测内容是否触发 operator 拉闸词"""
        ...
```

#### §3.14.2 关键流程

```
灵锻 SpiritForge 流程：
经验（EchoStore）→ 蒸馏（SpiritForge）→ 知识（Mind Codex）
   ↓                  ↓                    ↓
情景记忆           离线策略学习          程序性记忆

灵议 Mind Council 流程：
┌─────────────────────────────────────────────────────┐
│ 灵议 Mind Council（多灵智体议事）                   │
├─────────────────────────────────────────────────────┤
│  灵智体 A（架构师） ─┐                              │
│  灵智体 B（开发者） ─┼→ 共识协议 → 决策输出        │
│  灵智体 C（评审员） ─┘                              │
└─────────────────────────────────────────────────────┘
            ↓（无法达成共识时）
      升级给 operator（拉闸权）
```

#### §3.14.3 错误处理与性能

| 场景 | 处理 |
|------|------|
| 灵锻蒸馏失败 | 保留原始 EchoStore，下次重试 |
| 灵议无法达成共识 | 升级给 operator |
| operator 拉闸词触发 | 立即停止 + 告警 |

**性能目标**：灵锻蒸馏异步批处理（低活动期）；灵议单轮 < 5 分钟

#### §3.14.4 安全设计

- 灵锻将情景记忆（EchoStore）蒸馏为程序性记忆（Mind Codex）
- 灵议用于 E5-E6 觉醒阶的多灵智体共识决策
- 灵议共识受 operator 拉闸权约束（不可逆决策必须 operator 确认）
- operator 拉闸词检测（cvo_brake.py）

#### §3.14.5 配置项

```yaml
# flowforge/forgemind/config/codex.yaml
spirit_forge:
  distill_interval_hours: 6
  batch_size: 100
  min_echo_count: 5
council:
  min_participants: 3
  consensus_threshold: 0.7
  escalate_on_no_consensus: true
cvo_brake:
  enabled: true
  brake_words_file: "config/cvo_brake_words.yaml"
```

#### §3.14.6 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| SpiritForge 蒸馏引擎 | **Built to Persist** | 灵锻核心 |
| Mind Council 议事机制 | **Built to Persist** | 灵议核心 |
| Mind Codex 条目 | **Built to Persist** | 程序性记忆 |
| CVO 拉闸词列表 | **Build to Delete**（可迭代） | 词表可扩展 |

---

### §3.15 Plugin V3 四钩子详细设计

> **关联 SRS**：[spec.md §3.15](spec.md)（FR-CORE-015）
> **关联 SAD**：[arch.md §3.15](arch.md)
> **关联 ADR**：[decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md)
> **优先级**：P0（MVP 必须）

**模块路径**：`flowforge/core/plugin/protocol.py`（V3 扩展）+ `flowforge/forgemind/plugins.py`

#### §3.15.1 关键类与接口

```python
from abc import ABC, abstractmethod
from typing import Any

class FlowForgePlugin(ABC):
    """FlowForge Plugin 协议（V2 兼容 + V3 新增四钩子）"""

    # ── V2 钩子保留（v6.0 历史钩子）─────────────────────────

    def register_agents(self, agent_registry: Any) -> None: pass
    def register_tools(self, tool_registry: Any) -> None: pass
    def register_loops(self, loop_registry: Any) -> None: pass
    def register_workflows(self, workflow_registry: Any) -> None: pass
    def register_routes(self, route_registry: Any) -> None: pass
    def register_schedules(self, schedule_registry: Any) -> None: pass
    def register_event_handlers(self, event_registry: Any) -> None: pass
    def register_gates(self, gate_registry: Any) -> None: pass
    def register_evaluators(self, evaluator_registry: Any) -> None: pass
    def on_startup(self) -> None: pass
    def on_shutdown(self) -> None: pass

    # ── V3 Registration hooks（v7.1 新增）─────────────────────────

    @abstractmethod
    def register_forgekins(self, forgekin_registry: Any) -> None:
        """注册灵智体到 forgemind。"""
        ...

    @abstractmethod
    def register_forge_skills(self, skill_registry: Any) -> None:
        """注册灵智体可加载的技能包（SkillPackage）。"""
        ...

    @abstractmethod
    def register_council_channels(self, council_registry: Any) -> None:
        """注册灵议 Mind Council 频道。"""
        ...

    @abstractmethod
    def register_auto_forge_config(self, auto_forge_config: Any) -> None:
        """注册灵锻 SpiritForge 配置。"""
        ...

class ForgeMindPlugin(FlowForgePlugin):
    """forgemind 自身 Plugin（注册预置 5 灵智体）"""

    def register_forgekins(self, forgekin_registry: Any) -> None:
        # 注册 architect_owl_luban / developer_hound_sherlock / ...
        ...

    def register_forge_skills(self, skill_registry: Any) -> None:
        # 注册通用技能包
        ...

    def register_council_channels(self, council_registry: Any) -> None:
        # 注册 Web Chat / 飞书 / 微信 / WebChat 升级版
        ...

    def register_auto_forge_config(self, auto_forge_config: Any) -> None:
        # 注册灵锻配置
        ...
```

#### §3.15.2 错误处理与性能

| 场景 | 处理 |
|------|------|
| V3 钩子未实现 | 抛 `NotImplementedError`（@abstractmethod） |
| V2 钩子未实现 | 静默跳过（pass 默认） |
| Plugin 注册失败 | 启动失败 + 日志 |

**性能目标**：Plugin 注册 < 1s；所有 Plugin 注册总时长 < 10s

#### §3.15.3 安全设计

- *Forge 通过 Plugin V3 四钩子注册灵智体到 forgemind
- Plugin V3 向下兼容 V2（V2 钩子保留）
- 所有 Plugin 通过 DI 容器管理（编程红线第 12 条）

#### §3.15.4 配置项

```yaml
# config/plugins.yaml
plugins:
  - name: forgemind
    class: ForgeMindPlugin
    enabled: true
  - name: contentforge
    class: ContentForgePlugin
    enabled: true
v3_hooks:
  required: [register_forgekins, register_forge_skills, register_council_channels, register_auto_forge_config]
```

#### §3.15.5 Build to Delete vs Built to Persist

| 元素 | 标记 | 理由 |
|------|------|------|
| Plugin V3 四钩子契约 | **Built to Persist** | 协议核心 |
| V2 钩子保留 | **Build to Delete**（长期废弃） | 兼容性保留 |
| ForgeMindPlugin 实现 | **Built to Persist** | forgemind 入口 |

---

### §3.16 其他核心需求详细设计

> **关联 SRS**：[spec.md §3.16](spec.md)（FR-CORE-016~030）
> **关联 SAD**：[arch.md §3.16](arch.md)
> **详细设计**：见对应 [design/D0XX-xxx.md](design/) 文件

FR-CORE-016 ~ FR-CORE-030 的详细设计分散到对应 Feature 的 design/D0XX-xxx.md 文件中，详见 [design/README.md](design/README.md)。

| FR-CORE | 功能 | 优先级 | 关联 Feature | 关联 D0XX |
|---------|------|:----:|------|------|
| FR-CORE-016 | 交接胶囊 + 持球注册 lease | P0 | [F003](features/F003-handoff-capsule.md) + [F006](features/F006-ball-custody-lease.md) | [D003](design/D003-handoff-capsule.md) + [D006](design/D006-ball-custody-lease.md) |
| FR-CORE-017 | 行首 @ 路由 + Push Back 协议 | P0 | [F005](features/F005-at-mention-routing.md) + [F007](features/F007-push-back-protocol.md) | [D005](design/D005-at-mention-routing.md) + [D007](design/D007-push-back-protocol.md) |
| FR-CORE-018 | 乒乓球熔断器 | P0 | [F004](features/F004-pingpong-circuit-breaker.md) | [D004](design/D004-pingpong-circuit-breaker.md) |
| FR-CORE-019 | Durable State Surfaces（6 类持久表面） | P0 | [F008](features/F008-durable-state-surfaces.md) | [D008](design/D008-durable-state-surfaces.md) |
| FR-CORE-020 | Evidence & Sensors | P0 | [F009](features/F009-evidence-sensors.md) | [D009](design/D009-evidence-sensors.md) |
| FR-CORE-021 | Governance 压缩免疫 | P0 | [F010](features/F010-governance-boundary.md) | [D010](design/D010-governance-boundary.md) |
| FR-CORE-022 | Magic Words 逃生舱 + Entropy Control | P0 | [F011](features/F011-magic-words.md) + [F012](features/F012-entropy-control.md) | [D011](design/D011-magic-words.md) + [D012](design/D012-entropy-control.md) |
| FR-CORE-023 | Harnessability 评估 | P0 | [F013](features/F013-harnessability.md) | [D013](design/D013-harnessability.md) |
| FR-CORE-024 | 灵典 Mind Codex 可检索知识库 | P0 | [F039](features/F039-mind-codex-searchable.md) | [D039](design/D039-mind-codex-searchable.md) |
| FR-CORE-025 | 副作用日志 WAL + Tier 1-4 恢复 | P0 | [F021](features/F021-side-effect-wal.md) + [F022](features/F022-tier-1-4-recovery.md) | [D021](design/D021-side-effect-wal.md) + [D022](design/D022-tier-1-4-recovery.md) |
| FR-CORE-026 | liveness 规范读模型 | P0 | [F023](features/F023-liveness-canonical-read.md) | [D023](design/D023-liveness-canonical-read.md) |
| FR-CORE-027 | 弱状态机 vs 强 workflow | P0 | [F024](features/F024-weak-state-vs-strong-workflow.md) | [D024](design/D024-weak-state-vs-strong-workflow.md) |
| FR-CORE-028 | 跨 provider 宿主抽象 | P1 | [F025](features/F025-provider-host-abstraction.md) | [D025](design/D025-provider-host-abstraction.md) |
| FR-CORE-029 | forgemind 与 *Forge 关系 | P1 | [F036](features/F036-forgemind-forge-relationship.md) | [D036](design/D036-forgemind-forge-relationship.md) |
| FR-CORE-030 | Harness Eval 控制面 | P1 | [F040](features/F040-harness-eval-control-plane.md) | [D040](design/D040-harness-eval-control-plane.md) |

---

### §3.17 41 条 CL 同步矩阵

> **关联 SRS**：[spec.md §3.17](spec.md)
> **关联 SAD**：[arch.md §3.17](arch.md)
> **来源**：[review/review.md](review/review.md) v1.4 第十三章 clowder-ai 补审 I（CL-001~CL-021，21 项）+ 第十四章 clowder-ai 深度补审 II（CL-022~CL-041，20 项）

41 条 CL（CL-001~CL-041）已全部同步到 [features/](features/) + [architecture/](architecture/) + [decisions/](decisions/) + 本文档对应章节。详细设计层关键变更影响分析（10 项关键 CL）：

| CL # | 变更内容 | 详细设计影响 | 同步位置 |
|------|---------|---------|---------|
| CL-001 | 灵智体定义去 AGI 化 | §2.1 + §3.8 ForgekinBase 注释 | spec.md §2.3 + design.md §3.8 |
| CL-005 | 12 核心概念三标注 | §1.3 术语 + 代码注释 | spec.md §2.4 + design.md §1.3 |
| CL-006 | 进化阶/觉醒阶三标注 | §3.8 EvolutionStage/AwakeningStage 枚举 | spec.md §2.5 + design.md §3.8 |
| CL-008 | 魂忆→灵忆 / 魂印→灵印 | 全局代码命名（EchoStore / MindImprint） | 全部文档 + design.md §3.4 |
| CL-010 | forgemind 应用层定位 | §3.8 模块路径 + ForgekinBase 契约 | spec.md §2.8 + design.md §3.8 |
| CL-015 | 三方 Agent EAC 七契约 | §3.10 ExternalAgentAdapter + EAC v1 | spec.md §3.10 + design.md §3.10 |
| CL-020 | 自我演进闭环 | §3.14 SpiritForge + EvalHub AB 回放 | spec.md §2.10 + design.md §3.5/§3.14 |
| CL-025 | 弱化万物虚幻用语 | 全局术语（多形态智能体 Multi-Form Agent） | 全部文档 + design.md §3.8 |
| CL-030 | 责任方名称（猫头鹰·鲁班等） | §1.1 读者 + 预置 5 灵智体 YAML | spec.md §1.1 + design.md §3.8 |
| CL-041 | 文档分层规范 | §1.5 文档组织 + design/D0XX 同号 | hiclaw/rules.md 第十一部分 + design.md §1.5 |

**41 条 CL 完整同步矩阵**：详见 [review/review.md](review/review.md) v1.4 第十三章 + 第十四章。

---

## §4 接口详细设计

> **关联 SRS**：[spec.md §4](spec.md) 外部接口
> **关联 SAD**：[arch.md §4](arch.md) 接口设计

### §4.1 API 接口（FastAPI 路由）

> **关联 Architecture**：[architecture/A0XX-xxx.md](architecture/)（待创建）

**核心 API 端点**（RESTful + SSE 流式）：

| 路径 | 方法 | 用途 | 关联 §3 |
|------|------|------|---------|
| `/api/v7/forgekins` | POST | 创建灵智体 | §3.8 / §3.9 |
| `/api/v7/forgekins/{id}` | GET | 查询灵智体 | §3.8 |
| `/api/v7/forgekins/{id}/evolve` | POST | 触发形态进化 | §3.8 / §3.13 |
| `/api/v7/forgekins/{id}/awaken` | POST | 触发觉醒阶晋升 | §3.9 |
| `/api/v7/forgekins/{id}/chat` | POST | 灵智体对话（SSE 流式） | §3.8 |
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
| `/api/v7/council/meetings` | POST | 创建灵议会议 | §3.14 |
| `/api/v7/external-agents/invoke` | POST | 调用三方 Agent | §3.10 |
| `/api/v7/spirit_forge/distill` | POST | 触发灵锻蒸馏 | §3.14 |
| `/api/v7/codex/search` | POST | 锻典检索 | §3.4 / §3.14 |
| `/api/v7/marketplace/register` | POST | 灵智体市场注册 | §3.13 |
| `/api/v7/lineage/tree` | GET | 谱系查询 | §3.13 |

**FastAPI 实现示例**：

```python
from fastapi import FastAPI, Depends
from fastapi.responses import StreamingResponse

app = FastAPI(title="FlowForge v7.1")

@app.post("/api/v7/forgekins")
async def create_forgekin(spec: ForgekinSpec,
                          pipeline: ForgePipeline = Depends(get_pipeline),
                          operator_approve: bool = False):
    """创建灵智体（执行 6 步锻造流水线）"""
    forgekin = await pipeline.forge(spec, operator_approve=operator_approve)
    return {"forgekin_id": forgekin.forgekin_id, "status": "created"}

@app.post("/api/v7/forgekins/{id}/chat")
async def chat_with_forgekin(id: str, message: str,
                             engine: ForgekinEngine = Depends(get_engine)):
    """灵智体对话（SSE 流式）"""
    async def stream():
        async for chunk in engine.chat_stream(id, message):
            yield f"data: {chunk}\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream")

@app.post("/api/v7/external-agents/invoke")
async def invoke_external_agent(request: ExternalAgentRequest,
                                bridge: ExternalAgentBridge = Depends(get_bridge)):
    """调用三方 Agent（含 fallback 链）"""
    return await bridge.invoke_with_fallback(request)
```

**架构契约**：
- 所有 API 使用 FastAPI + async/await
- 所有 API 通过 DI 容器注入依赖（编程红线第 12 条）
- 所有 API 通过 Repository 层访问数据库（编程红线第 13 条）
- SSE 流式接口用于长任务（如灵智体对话 / 锻造流水线）

### §4.2 SDK 接口（Python SDK）

```python
from flowforge.sdk import FlowForgeSDK

sdk = FlowForgeSDK()

# 创建灵智体
forgekin = await sdk.forgekins.create(
    species="bio",
    capability_requirements=["code_gen", "long_context"],
    value_anchors=["safety_first", "evidence_based"],
    red_lines=["no_agi_claim", "no_secret_hardcode"]
)

# 灵智体对话
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

**SDK 契约**：
- 统一入口 `FlowForgeSDK`
- 零配置模型访问（默认从 `config/system.yaml` 加载）
- `@tool` / `@agent` 装饰器
- 声明式 Agent（YAML 驱动）
- 安全护栏自动启用
- MCP 服务器连接
- 事件订阅

### §4.3 Plugin V3 接口（四钩子契约）

详见 §3.15 关键类与接口。Plugin V3 四钩子契约：

| 钩子 | 输入 | 输出 | 用途 |
|------|------|------|------|
| `register_forgekins` | `forgekin_registry` | None | 注册灵智体到 forgemind |
| `register_forge_skills` | `skill_registry` | None | 注册灵智体技能包 |
| `register_council_channels` | `council_registry` | None | 注册灵议频道 |
| `register_auto_forge_config` | `auto_forge_config` | None | 注册灵锻配置 |

### §4.4 EAC v1 七契约（三方 Agent 接口）

详见 §3.10.3 EAC v1 七契约表。EAC v1 接口签名：

| 契约 | 接口 | 实现类 |
|------|------|--------|
| Invocation | `ExternalAgentAdapter.invoke()` | `ClaudeCodeAdapter` / `CodexAdapter` / ... |
| Stream | `ExternalAgentAdapter.stream()` | 同上 |
| Session | `ExternalAgentAdapter.create_session()` | 同上 |
| Capability | `ExternalAgentAdapter.get_profile()` | 同上 |
| Collaboration | `ExternalAgentSharedState` + `FallbackChain` | `ExternalAgentBridge` |
| Safety | `SixLayerGuardrails` + `worktree.py` | `SixLayerGuardrails` |
| Avatar Sync | `sync.py` + 配置文件 | `ExternalAgentSync` |

### §4.5 IM 渠道接口（微信公众号等）

> **关联 D0XX**：[design/D030-spirit-forge-mind-council.md](design/D030-spirit-forge-mind-council.md)（待创建）

**IM 渠道**：
- Web Chat 渠道（默认）
- 飞书渠道
- 微信公众号 / 个人号渠道
- WebChat 升级版（5 评委并行评审）

**IM 渠道契约**：
- 所有 IM 渠道实现统一的 `IMChannel` 接口
- 5 个 WebChat 评委并行评审使用不同模型
- 灵议多渠道可同步（详见 §3.14 Mind Council）

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
| SQLite | 任务 / 审计 / 灵智体元数据 | SQLAlchemy ORM + Repository 层 | §3.8 / §3.9 |
| OpenSieve PostgreSQL | 文档索引 / 知识库 / 锻典 Mind Codex | OpenSieve SDK/API（localhost:8100） | §3.4 / §3.14 |
| 文件系统 | 灵智体 YAML 配置 / 灵忆 EchoStore 日志 | YAML + JSON Lines | §3.4 / §3.8 |
| Git | 代码 / 文档 / ADR / Feature 规格 | git CLI | §3.3 L1 |
| 向量索引 | 锻典检索 / 语义检索 | OpenSieve 向量索引 | §3.4 |

**架构契约**：
- 所有数据库操作通过 Repository 层（编程红线第 13 条）
- 所有数据检索走 OpenSieve（结构化 + 非结构化统一入口）
- 灵忆 EchoStore 使用 JSON Lines 格式（便于追加 + 流式读取）
- 灵印 Mind Imprint 不可变（持久身份 / 智能体指纹 / 人格哈希）

### §5.2 核心数据模型（Pydantic Models）

#### §5.2.1 ForgekinBase 数据模型

```python
class ForgekinBase(BaseModel):
    """灵智体基础数据模型"""
    forgekin_id: str                    # 灵智体 ID（唯一）
    soul_imprint: str                   # 灵印 Mind Imprint（不可变身份）
    form_data: ForgekinFormData         # 形态数据
    species: ForgekinSpecies            # 形态分类
    evolution_stage: EvolutionStage     # 进化阶 E1-E6
    awakening_stage: AwakeningStage     # 觉醒阶 E1-E6
    created_at: datetime
    lineage_id: Optional[str]           # 进化谱系 ID
    capability_profile_id: Optional[str]  # 能力画像 ID
```

#### §5.2.2 CapabilityProfile 数据模型

详见 §3.1.3。

#### §5.2.3 进化阶与觉醒阶

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
    E6_FORGEMIND_LED = "E6"      # 灵智主导阶 ForgeMind-Led
```

#### §5.2.4 灵印 MindImprint

```python
class MindImprint(BaseModel):
    """灵印（不可变身份标识）"""
    imprint_id: str              # 智能体指纹 / 人格哈希
    seed_params: dict            # 初始锻造时的种子参数
    value_anchors: list[str]     # 价值锚点（不可变）
    namespace: str               # 命名空间
    created_at: datetime         # 创建时间（不可变）

    def verify_immutable(self) -> bool:
        """验证灵印未被篡改"""
        ...
```

#### §5.2.5 交接胶囊 HandoffCapsule

详见 §3.2.1。

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
| `species.yaml` | `flowforge/forgemind/config/species.yaml` | 灵智体形态配置 | §3.8 |
| `forging.yaml` | `flowforge/forgemind/config/forging.yaml` | 锻造流水线配置 | §3.9 |
| `sensors.yaml` | `flowforge/forgemind/config/sensors.yaml` | 传感器配置 | §3.11 |
| `worlds.yaml` | `flowforge/forgemind/config/worlds.yaml` | 虚拟世界设定配置 | §3.12 |
| `codex.yaml` | `flowforge/forgemind/config/codex.yaml` | 灵典 + 灵议配置 | §3.14 |
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
  opensieve_url: "http://localhost:8100"
llm:
  openroute_url: "http://localhost:6000"
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
│ OpenSieve（PostgreSQL :8100）                       │
│ OpenRoute（多模型 API 网关 :6000）                  │
│ ContentForge（FastAPI :8001）                       │
│ NovelForge（FastAPI :8003）                         │
│ DevForge（FastAPI :8002）                           │
│ MallForge（FastAPI :8004）                          │
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
pip install -e contentforge/  # 可选

# 4. 初始化数据库
python -m flowforge.scripts.init_db

# 5. 启动 OpenSieve（PostgreSQL）
docker run -d -p 8100:8100 opensieve:latest

# 6. 启动 FlowForge
python -m flowforge.app.main --config config/system.yaml
```

**单机部署契约**：
- 所有端口通过 `config/system.yaml` 配置（编程红线第 11 条）
- 数据库文件存放在 `data/` 目录（T9 铁律）
- 日志文件存放在 `logs/` 目录

### §6.2 生产部署（Docker Compose）

```yaml
# docker-compose.yml
version: "3.9"
services:
  flowforge:
    build: ./flowforge
    ports:
      - "8000:8000"
    environment:
      - ENVIRONMENT=production
      - DATABASE_URL=postgresql://...
      - OPENSIEVE_URL=http://opensieve:8100
      - OPENROUTE_URL=http://openroute:6000
    depends_on:
      - opensieve
      - openroute
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
      - ./config:/app/config
    restart: always

  opensieve:
    image: opensieve:latest
    ports:
      - "8100:8100"
    volumes:
      - opensieve_data:/var/lib/postgresql/data
    restart: always

  openroute:
    image: openroute:latest
    ports:
      - "6000:6000"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    restart: always

  contentforge:
    build: ./contentforge
    ports:
      - "8001:8000"
    depends_on:
      - flowforge
    restart: always

volumes:
  opensieve_data:
```

**生产部署契约**：
- 所有密钥通过环境变量注入（编程红线第 11 条）
- 数据卷持久化 `data/` + `logs/` + `config/`
- 健康检查端点 `/api/v7/health`
- 优雅关闭（on_shutdown 钩子）

### §6.3 可观测性（日志 / 指标 / 追踪）

#### §6.3.1 日志设计

- 日志自动注入 `trace_id`（详见 [hiclaw/rules.md §2.6 原则 8](../../hiclaw/rules.md)）
- 所有 I/O 使用 async/await
- LLM 调用日志：input + output + execution time（详见 [hiclaw/rules.md §9.3.1](../../hiclaw/rules.md)）
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

## §7 历史背景资料

> **声明**：本章节保留 v7.0 / v6.0 历史详细设计章节作为背景资料，**不作为开发依据**；开发依据以 §1-§6（v7.1 权威内容）+ ADR / Feature / Architecture / Design 子目录为准。

### §7.1 V7.0→V7.1 合并映射（简要列表）

> **状态**：✅ v7.0 历史详细设计已逐章节合并到 v7.1 §1-§6 对应位置；v7.0 完整详细设计内容备份在 [`_archive/design_v71_full_backup_20260719.md`](_archive/design_v71_full_backup_20260719.md)，仅作演化路径参考。

**v7.0 → v7.1 详细设计合并映射**：

| v7.0 详细设计章节 | v7.1 合并位置 | 合并状态 |
|------------------|--------------|:--------:|
| v7.0-§D0 灵智体设计规范层权威定义 | v7.1 §2.1 + §3.8 ForgekinBase | ✅ |
| v7.0-§D1 术语修订表 | v7.1 §1.3 + [design/naming-contract.md](design/naming-contract.md) | ✅ |
| v7.0-§D2 12 核心概念命名表 | v7.1 §1.3 + [design/naming-contract.md](design/naming-contract.md) | ✅ |
| v7.0-§D3 进化阶与觉醒阶 | v7.1 §3.8 + [design/naming-contract.md](design/naming-contract.md) §3/§4 | ✅ |
| v7.0-§D4 万物灵智体形态分类设计规范 | v7.1 §3.8（5 种形态） | ✅ |
| v7.0-§D5 forgemind 应用层设计规范 | v7.1 §3.8 + §3.9 | ✅ |
| v7.0-§D6 三方 Agent 集成设计规范 | v7.1 §3.10 | ✅ |
| v7.0-§D7 自我演进闭环设计规范 | v7.1 §3.5 + §3.14 | ✅ |
| v7.0-§D8 设计态声明 | v7.1 §1.2 范围 + [spec.md §2.11](spec.md) | ✅ |
| v7.0-§D9 review.md 41 条 CL 同步矩阵 | v7.1 §3.17 | ✅ |
| v7.0-§0.x 设计规范层（§0.1-§0.9） | v7.1 §2 + §3 对应位置 | ✅ |
| v7.0-§15 v7.0 目录结构新增 | v7.1 §3.8 目录结构 | ✅ |
| v7.0-§16 ForgekinEngine 详细设计 | v7.1 §3.3 ForgekinEngine 装饰器 | ✅ |
| v7.0-§17 SpiritForge Engine 详细设计 | v7.1 §3.14 SpiritForge | ✅ |
| v7.0-§18 外部工具集成详细设计 | v7.1 §3.10 ExternalAgentAdapter | ✅ |
| v7.0-§19 灵议与 A2A 详细设计 | v7.1 §3.14 Mind Council | ✅ |
| v7.0-§20 灵典 Mind Codex 详细设计 | v7.1 §3.4 + §3.14 | ✅ |
| v7.0-§21 v7.0 API 端点设计 | v7.1 §4.1 API 接口 | ✅ |
| v7.0-§22 数据库迁移方案 | v7.1 §5.1 数据存储设计 | ✅ |
| v7.0-§23 配置文件设计 | v7.1 §5.3 配置文件设计 | ✅ |
| v7.0-附录 E v7.0 待用户审核决策点 | v7.1 §3.17 + [review/review.md](review/review.md) | ✅ |

### §7.2 V6.0 已实现代码摘要（仅作背景资料）

> **状态**：v6.0 是已实现代码的背景资料，**不在 v7.1 开发范围内**。v6.0 完整详细设计内容备份在 [`_archive/design_v71_full_backup_20260719.md`](_archive/design_v71_full_backup_20260719.md) 的 v6.0 历史章节中（行 1040-4077）。

**v6.0 历史详细设计章节摘要**：

| v6.0 章节 | 一句话摘要 | v7.1 引用价值 |
|----------|----------|--------------|
| 第一章：项目骨架与目录结构 | v6.0 目录结构 + 项目骨架 | 已被 v7.1 §2.3 模块划分升级 |
| 第二章：核心接口详细设计 | TaskContext / BaseAgent / BaseTool / BaseModeExecutor / HybridExecutor | 已被 v7.1 §3 + §4 升级 |
| 第三章：依赖注入容器 | DI 容器设计 | 仍有效，v7.1 §2.4 保留 |
| 第四章：模式注册中心与混合执行器 | ModeRegistry + HybridExecutor | 已被 v7.1 §3.3 ForgekinEngine 升级 |
| 第五章：事件总线与 Helm 集成 | EventBus + DurableEventStream | 仍有效，v7.1 §6.3 保留 |
| 第六章：Database Schema | SQLAlchemy ORM Schema | 已被 v7.1 §5.2 升级 |
| 第七章：九大模式执行器详细设计 | Reflexion / Workflow / Plan-Execute 等 9 模式 | 部分作背景，v7.1 升级为 TeamAct |
| 第八章：通用 Agent 库详细设计 | 内容创作 / 小说 / 代码 Agent | 已迁移到 *Forge 项目 |
| 第九章：通用 Workflow 库设计 | 内容创作 / 小说 Workflow | 已迁移到 *Forge 项目 |
| 第十章：插件系统详细设计 | Plugin V2 协议（11 钩子） | 已被 v7.1 §3.15 Plugin V3 升级（V2 兼容） |
| 第十一章：Tool 系统与沙箱安全 | BaseTool + 沙箱 | 已被 v7.1 §3.3 L2 Tool Mediation + §3.10 worktree 隔离升级 |
| 第十二章：Memory 模块详细设计 | Memory 存储 | 已被 v7.1 §3.4 多域记忆联邦升级 |
| 第十三章：安全机制总结 | 三层权限管线 / Persona 锁 / HITL / 沙箱 | 已被 v7.1 §3.3 L4 Governance + §3.10 六层 Guardrails 升级 |
| 第十四章：Harness 驾驭层详细设计 | 上下文工程 / 会话管理 / 反馈循环 / 熵管理 | 已被 v7.1 §3.3 Harness 七层升级 |
| 第十五章：Skill 系统详细设计 | SkillAdapter / SkillRegistry / Combo Skills | 已被 v7.1 §3.14 灵锻 SpiritForge 升级 |
| 第十六章：MCP 模块详细设计 | 四层架构 / MCPBroker / MCPGateway | 已被 v7.1 §3.10 ExternalAgentAdapter 升级 |
| 第十七章：v6.0 目录结构完整清单 | 目录结构清单 | 已被 v7.1 §3.8 升级 |
| 第十八章：v6.0 安全机制增强总结 | 安全增强 | 已被 v7.1 §3.10 六层 Guardrails 升级 |
| 第十九章：增量迁移实施计划 | v5.0 → v6.0 迁移 | 已迁移到 [task.md](task.md) |

---

> **本文档版本**：v7.1（2026-07-19）
> **下一阶段**：基于本文档 + [spec.md](spec.md) + [arch.md](arch.md) + [features/](features/) + [architecture/](architecture/) 开发 [design/D0XX-xxx.md](design/)（Feature 级 SDD），按 [hiclaw/rules.md §11.3](../../hiclaw/rules.md) 三阶段开发流程执行。
> **配套文档**：[spec.md](spec.md) + [arch.md](arch.md) + [features/](features/) + [architecture/](architecture/) + [design/](design/) + [decisions/](decisions/) + [review/](review/)