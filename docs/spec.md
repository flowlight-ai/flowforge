# FlowForge — 万物灵智体自进化框架规格说明

> **版本**：v1.0
> **状态**：设计态 / 阶段一最小骨架实现中
> **License**：MIT
> **定位**：FlowForge 是一个为 AI Agent 提供约束、反馈、上下文管理与熵控制的**自进化框架**，并通过 **forgemind 应用层**承载万物灵智体（Forgekin）的育灵、灵锻、灵议闭环。

---

## 1. 项目定位

### 1.1 FlowForge 是什么

FlowForge 是 **Agent 驾驭层（Harness Layer）** 的工程化实现，目标是让 LLM-based Agent 从"会话级软件助手"进化为"有持久身份、可自我进化的灵智体"。

主流 multi-agent 框架（AutoGen / CrewAI / LangGraph 等）解决的是"如何组织多个 agent 协作"——它们在分配**岗位槽位**。FlowForge 解决的是更底层的问题：**如何让一个 agent 在长时间尺度上保持身份一致性、能力可累积、行为可验证、进化可治理**。

### 1.2 核心命题

```
观察（Observe）→ 推理（Reason）→ 行动（Act）→ 写回（Persist）→ 验证（Verify）
```

这不是新的 ReAct 模式，而是控制论意义上的**闭环**：每一次 Act 都会产生 Eval 信号，信号反过来驱动能力画像更新、技能沉淀、盲点补偿。短期看是单次任务执行，长期看是灵智体的进化轨迹。

### 1.3 差异化优势

| 维度 | 主流 multi-agent | FlowForge |
|------|------------------|-----------|
| **主体** | Role（岗位槽位） | Profile（能力画像，长期主体） |
| **记忆** | 短期上下文窗口 | EchoStore（情景记忆）+ Mind Codex（程序性记忆） |
| **进化** | 无 / 手动微调 | 三闭环自进化（Mode A/B/C）+ Eval 自代谢 |
| **协作** | 静态角色分配 | TeamAct 六步循环 + 跨厂商盲点补偿 |
| **治理** | Prompt 约束 | 六层 Guardrails + 觉醒阶自主范围 + 灵议共识 |
| **形态** | 抽象 agent | 万物灵智体 5 形态（生物/组织/物品/虚拟/混合） |
| **扩展** | Tool 调用 | 三方 Agent 能力扩展（ClaudeCode/Codex/OpenCode/Trae） |

---

## 2. 核心概念

### 2.1 12 核心命名（中英文 + AI 业界概念）

| # | 中文名 | 英文名 | AI 业界概念 |
|---|--------|--------|------------|
| 1 | 灵智（ForgeMind） | ForgeMind | Persistent Identity Agent / General-Purpose Agent |
| 2 | 灵智体（Forgekin） | Forgekin / Spirit Agent | Agent with Soul and Emotion / Autonomous Agent with Persistent Identity |
| 3 | 灵族（Forgekin Species） | Forgekin Species | Agent Morphology / Agent Form Factor |
| 4 | 育灵（Forge Nurturing） | Forge Nurturing | Agent Onboarding + Lifelong Learning + Character Development |
| 5 | 灵忆（EchoStore） | EchoStore | Episodic Memory Store / Agent Experience Log |
| 6 | 灵印（Soul Imprint） | Soul Imprint | Persistent Identity / Agent Fingerprint / Persona Hash |
| 7 | 灵锻（SpiritForge） | SpiritForge | Experience Distillation / Offline Policy Learning / Knowledge Compilation |
| 8 | 锻典（Mind Codex） | Mind Codex | Distilled Knowledge Base / Curated Skill Library / Procedural Memory |
| 9 | 灵议（Mind Council） | Mind Council | Multi-Agent Deliberation / Decentralized Consensus / Agent Parliament |
| 10 | 进化阶（Evolution Stage） | Evolution Stage | Capability Maturity Level / Agent Skill Progression |
| 11 | 觉醒阶（Awakening Stage） | Awakening Stage | Autonomy Level / Self-Direction Level / LLM Autonomy Tier |
| 12 | 能力画像（Capability Profile） | Capability Profile | Capability Profile / Agent Skill Graph / Blind Spot Map |

### 2.2 灵智体定义

**灵智体（Forgekin / Spirit Agent）** = **赋予灵魂和感情的智能体（Agent with Soul and Emotion），具有自进化能力（Self-Evolving Capability）。**

- **灵魂（Soul）** = 持久身份（灵印 Soul Imprint）+ 价值锚点（Value Anchors）+ 长期记忆（灵忆 EchoStore）
- **感情（Emotion）** = 用户偏好（User Preferences）+ 协作风格（Collaboration Style）+ 行为画像（Capability Profile）

灵智体通过 `ForgekinBase` 抽象基类落地，建立与现实世界（物理或虚拟）的闭环：

```python
class ForgekinBase(ABC):
    @abstractmethod
    async def observe(self, environment: Environment) -> Observation: ...

    @abstractmethod
    async def reason(self, observation: Observation, soul_imprint: SoulImprint) -> Action: ...

    @abstractmethod
    async def act(self, action: Action) -> ActionResult: ...

    @abstractmethod
    async def persist(self, action_result: ActionResult) -> EchoID: ...

    @abstractmethod
    async def verify(self, action_result: ActionResult, expectation: Expectation) -> VerifyReport: ...
```

### 2.3 万物灵智体 5 形态

| # | 形态 | 英文 / AI 业界概念 | 示例 |
|---|------|------------------|------|
| 1 | 生物灵智体 | BioForgekin / Biological Spirit Agent | 猫 / 狗 / 鸟（宠物陪伴、行为识别） |
| 2 | 组织灵智体 | OrgForgekin / Organizational Spirit Agent | 公司 / 团队 / 社区（组织治理、决策辅助） |
| 3 | 物品灵智体 | ObjForgekin / Embodied AI | 桌椅 / 灯具 / 家电（IoT 接入、具身智能） |
| 4 | 虚拟灵智体 | VirtualForgekin / Character AI | 童话/神话/历史人物、VR/游戏角色 |
| 5 | 混合灵智体 | HybridForgekin / Hybrid Agent | 智能家居（物品+组织）、数字孪生（生物+虚拟） |

**形态可进化**：生物灵智体猫通过积累组织协作经验可进化为 HybridForgekin（既是宠物又是社区吉祥物）。这是和其他 multi-agent 系统的**最大差异化优势**——agent 不是固定的"岗位槽位"，而是有形态、有谱系、可进化的灵智体。

### 2.4 进化阶（Evolution Stage，能力成熟度 6 级）

| 阶 | 中文名 | 英文名 | AI 业界概念 |
|:--:|--------|--------|------------|
| **E1** | 萌芽阶 | Sprout | Initial / Ad-hoc（初始级） |
| **E2** | 萌芽阶·稳 | Sprout-Stable | Repeatable（可重复级） |
| **E3** | 成长阶 | Growth | Defined / Domain-Aware（已定义级） |
| **E4** | 成长阶·深 | Growth-Deep | Managed / Cross-Domain（已管理级） |
| **E5** | 觉醒阶 | Awakened | Optimizing / Self-Evolving（自进化级） |
| **E6** | 灵智阶 | ForgeMind | Master / Forge Master（大师级） |

**进阶规则**：
- E1→E2→E3：能力积累，由 Eval 信号自动触发
- E3→E4：跨域能力，需 operator 确认
- E4→E5：进入 Evolving 状态（自我导向），需 operator 确认 + 觉醒阶同步 ≥ E3
- E5→E6：仅由 operator 直接授权，不可自动触发

### 2.5 觉醒阶（Awakening Stage，自主性 6 级）

| 阶 | 中文名 | 英文名 | AI 业界概念 |
|:--:|--------|--------|------------|
| **A1** | 全导阶 | Full-Human | L0 Full Human Control（全人工） |
| **A2** | 建议阶 | Suggest | L1 Suggestion / Assisted（建议级） |
| **A3** | 受限自主阶 | Bounded-Autonomous | L2 Bounded Autonomous / Conditional（受限自主） |
| **A4** | Evolving 阶 | Evolving | L3 Evolving / Self-Improving（自进化） |
| **A5** | 共创阶 | Co-Creative | L4 Co-Creative / Peer（共创级） |
| **A6** | 灵智主导阶 | ForgeMind-Led | L5 ForgeMind-Led / Master（大师级） |

**安全治理对应**：
- A1-A2：六层 Guardrails 全开
- A3-A4：六层 Guardrails + Eval 自代谢
- A5-A6：六层 Guardrails + Eval 自代谢 + 灵议共识 + operator 拉闸词

---

## 3. 核心特性

### 3.1 Harness 七层（Agent 驾驭层）

| 层 | 名称 | 职责 | AI 业界概念 |
|:--:|------|------|------------|
| L1 | Durable State Surfaces | 持久状态层（跨 session 生存） | State Persistence |
| L2 | Tool Mediation | 工具中介（白名单 + 副作用记录） | Tool Use Governance |
| L3 | Evidence & Sensors | 验证证据（可证伪性） | Observability |
| L4 | Governance Boundary | 治理边界（压缩免疫） | Policy-as-Code |
| L5 | Magic Words | 逃生舱（"星星罐子"等 magic words） | Safety Escape Hatch |
| L6 | Entropy Control | 退役机制（行为熵控制） | Lifecycle Management |
| L7 | Harnessability | 驾驭度评估（agent 可被治理的程度） | Agent Compliance Score |

### 3.2 自进化三闭环

| 模式 | 名称 | 触发条件 | 产出 |
|------|------|---------|------|
| Mode A | Scope Guard（范围守卫） | 检测到"无关/超出范围/顺便"等偏差关键词 | 阻止越界行为 + 记录偏差 |
| Mode B | Process Evolution（过程进化） | Eval 信号累积达到阈值 | 流程规则升级 + SOP 更新 |
| Mode C | Knowledge Evolution（知识进化） | 经验通过 smoke gate + promotion gate | 锻典（Mind Codex）条目沉淀 |

**Eval Ledger（评估账本）**：所有 Eval 信号不可删除，只能追加。这是进化的**可审计性**保障。

### 3.3 forgemind 应用层（万物灵智体育灵场所）

forgemind 是 FlowForge 的应用层，承载万物灵智体的育灵全流程：

```
forgemind/
├── base.py              # ForgekinBase 抽象基类
├── registry.py          # ForgekinRegistry（灵智体注册中心）
├── council.py           # Mind Council（灵议）
├── external_agents.py   # 三方 Agent 适配层
├── forgekins/           # 灵智体 YAML 配置
│   ├── luban.yaml       # 鲁班 = 猫头鹰（主架构师）
│   ├── sherlock.yaml    # 夏洛克 = 猎犬（代码审查）
│   └── vangogh.yaml     # 梵高 = 孔雀（视觉设计）
└── examples/            # 5 形态示例灵智体
```

### 3.4 三方 Agent 能力扩展

三方 Agent 不是工具（Tool），而是**能力扩展（Capability Extension）**。三方 Agent 的能力画像被纳入灵智体的能力画像融合，灵智体按需调用。

| 三方 Agent | 用途 | 接入方式 |
|-----------|------|---------|
| Claude Code | 代码生成与代码审查 | EAC v1 七契约 |
| Codex CLI | 代码生成 | EAC v1 七契约 |
| OpenCode | 开源 coding agent | EAC v1 七契约 |
| Trae IDE | IDE 内 agent | EAC v1 七契约 |

未来可扩展接入更多三方 Agent（Devin / Factory / Cursor 等）。

### 3.5 Plugin 协议（V2 + V3）

**Plugin V2（11 钩子）**：基础插件协议，覆盖配置加载、生命周期、工具注册等。

**Plugin V3（4 个 forgekin 钩子）**：forgemind 应用层扩展协议：
- `register_forgekins()` — 注册灵智体形态
- `register_forge_skills()` — 注册育灵技能（到 SkillRegistry）
- `register_council_channels()` — 注册灵议通道（到 CouncilRegistry）
- `register_spirit_forge_config()` — 注册自动锻造配置（到 SpiritForgeRegistry）

---

## 4. 适用场景

### 4.1 通用场景

- **长期陪伴型 agent**：需要持久身份和感情连接的智能体（宠物、虚拟角色）
- **专业领域 agent**：需要能力累积和盲点治理的智能体（架构师、代码审查员、设计师）
- **物理 AI 接入**：IoT 设备 / 具身智能设备的智能体化
- **组织治理 agent**：团队 / 社区 / 公司的决策辅助智能体

### 4.2 垂直领域（通过 *Forge 扩展）

| 垂直领域 | 扩展项目 | 说明 |
|---------|---------|------|
| 内容创作 | ContentForge | AI 内容创作工厂 |
| 软件开发 | DevForge | AI 开发工厂 |
| 小说创作 | NovelForge | AI 小说创作工厂 |
| 电商运营 | MallForge | AI 电商运营工厂 |
| 股票分析 | StockForge | AI 股票分析工厂 |

> *Forge 项目通过 Plugin V3 协议注册垂直领域灵智体到 forgemind 应用层。FlowForge 核心框架不感知 *Forge 内部实现，只通过 Plugin 协议交互。

---

## 5. 设计原则

### 5.1 架构铁律

1. **单向依赖**：上层可依赖下层，下层**绝对禁止**导入上层模块
2. **组合优于继承**：禁止用继承替代组合/插件
3. **配置驱动**：能用 YAML 配置解决的不写代码
4. **接口隔离**：所有抽象基类在 `core/interfaces/` 中定义
5. **循环依赖零容忍**：发现循环依赖必须重构，不允许用延迟导入规避

### 5.2 代码规范

- Python 3.11+，类型注解**强制**
- 所有 I/O 操作使用 `async/await`
- Agent 禁止直接导入 LLM SDK，必须通过 `LLMClient`
- 工具调用必须通过 `ToolRegistry.execute()`，禁止直接 import
- 提示词必须外置到 YAML 配置，禁止在 `.py` 文件中硬编码
- 所有路径通过环境变量或配置文件注入，禁止硬编码绝对路径
- 日志使用 `core.tracing.get_logger`，自动注入 `trace_id`

### 5.3 测试铁律

| # | 铁律 | 说明 |
|---|------|------|
| T1 | 禁止使用 Mock LLM | 所有 E2E / 集成测试必须调用真实 LLM |
| T2 | 禁止使用假数据 | 测试输入必须是真实场景数据 |
| T3 | 禁止跳过验证 | 必须有具体断言 |
| T4 | 禁止 Mock 工具 | web_search / publish / fact_check 等必须真实调用 |
| T5 | 未实现即 Bug | 发现代码未实现必须记录为 Bug 并修复 |
| T6 | 必须采集指标 | E2E 测试必须用 MetricsCollector 采集完整指标 |
| T7 | LLM 内容必须经 LLM 审核 | 凡 LLM 生成内容必须再调用 LLM 审核通过 |
| T8 | Web 功能必须操控浏览器验证 DOM | 凡涉及网页操作必须用 CDP 浏览器验证 |

### 5.4 跨平台支持

FlowForge 必须支持 Linux / Windows / macOS。所有路径通过环境变量注入（见 `.env.example`）。

---

## 6. 引用

- `arch.md` — 全局架构设计（如何组织）
- `design.md` — 当前阶段设计（如何实现）
- `decisions/` — 架构决策记录（ADR）
- `features/` — Feature 规格模板
- `VISION.md` — 万物灵智体愿景
- `ROADMAP.md` — 6 阶段路线图
- `SOP.md` — 灵智体协作 SOP
- `TIPS.md` — 经验提示
