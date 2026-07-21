# A001: 能力画像（CapabilityProfile）架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.1]（FR-CORE-001）
> **对应 arch.md**: [doc:../arch.md#§3.1]
> **对应 design.md**: [doc:../design.md#§3.1]（待创建）
> **对应 Feature**: [doc:../features/F001-capability-profile.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D001-capability-profile.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/004-capability-profile-routing.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"Forgekin（Evolvable Agent，社区社交称'灵智体'）如何被选择去承担某项任务"的根本问题。当前 `default_llm_actors.py` 把Forgekin固定成岗位槽位（如"你是内容创作者"），违反 roleagent.md 第 0 章"role-agent 是蒸汽马车式误判"的核心主张，导致：

1. 路由基于硬编码角色而非能力匹配，违反编程红线第 10 条（禁止在 flowforge 中写死业务领域代码）与第 11 条（禁止硬编码提示词/路径/密钥/端口）
2. 跨厂商 review 不基于盲点画像，同厂商Forgekin共享盲点的结构性问题无法消除
3. 缺少 Build to Delete vs Built to Persist 半衰期判别器，无法识别哪些机制值得长期投资
4. Agent 状态三层中只有"现实状态"是唯一跨会话持久层，但当前未形式化

CapabilityProfile 在架构层提供"能力 × Harness 契合度"的度量基础，是 roleagent 七大工程路径的根路径。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/capability/` 只能依赖 `core/interfaces/` 与共享内核，禁止反向依赖 *Forge 或 forgemind 应用层
- **DI 容器约束**：CapabilityRouter 与 CapabilityRepository 必须通过构造函数注入，禁止 `CapabilityRouter` 直接实例化
- **Repository 层约束**：能力画像的读写必须通过 `CapabilityRepository` 抽象，禁止直接 `cursor.execute("INSERT INTO capability_profiles...")`
- **配置驱动约束**：路由权重、阈值、维度配置外置到 `flowforge/config/capability.yaml`，禁止在 `.py` 文件中硬编码
- **Plugin V3 协议约束**：*Forge 不可直接注册 CapabilityProfile，必须通过 `register_forgekins` 钩子注入
- **觉醒阶约束**：能力画像不可绕过 Magic Words 逃生舱（F011），不可越过 operator 拉闸权（E5/E6 晋升）

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：TeamAct Owner 步的"谁持球"决策依赖 CapabilityRouter 输出，跨厂商 review 配对依赖盲点不重叠判定
- **对 Harness（A008-A013）的影响**：harness_fit_score 是 CapabilityProfile 的计算输出，所有 Harness 层的投资决策依赖此分数
- **对三方 Agent（A031-A035）的影响**：ExternalAgentProfile 必须融合到 CapabilityProfile，避免两套画像并行
- **对 forgemind（A026）的影响**：ForgePipeline 第 2 步"能力注入"直接调用 CapabilityProfile 构造器
- **对 Eval 自代谢（A018-A020）的影响**：路由正确率、盲点检出率是 Eval Contract 的核心信号，回流刷新画像

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│                       forgemind 应用层 (Layer 2)                    │
│   ForgePipeline 第 2 步 "能力注入" → CapabilityProfile 构造         │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ 依赖注入 (DI)
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                   FlowForge 核心框架层 (Layer 1)                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              core/capability/ (本 Feature 模块)             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │   │
│  │  │ profile.py   │  │ router.py    │  │ blind_spot  │       │   │
│  │  │ CapabilityPro│  │ CapabilityRtr│  │ _detector.py│       │   │
│  │  │ file (六维)   │  │ (路由算法)    │  │ (盲点识别)   │       │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │   │
│  │         │                 │                  │              │   │
│  │         ▼                 ▼                  ▼              │   │
│  │  ┌──────────────────────────────────────────────────────┐    │   │
│  │  │           storage.py (Repository 层抽象)              │    │   │
│  │  │           CapabilityRepository (ABC)                 │    │   │
│  │  └──────────────────────┬───────────────────────────────┘    │   │
│  └─────────────────────────┼────────────────────────────────────┘   │
│                            │                                         │
│  ┌─────────────────────────┼────────────────────────────────────┐   │
│  │  infra/repo/            ▼              core/eval/ (F018)      │   │
│  │  SqliteCapabilityRepo ────── 持久化 ────► Eval 信号回流刷新 │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ 路由查询
                  ┌──────────────┴───────────────┐
                  │  TeamAct Owner 步 (A002)     │
                  │  ExternalAgentAdapter (A031) │
                  └──────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：role 是运行时标签，profile 才是长期主体**
  理由：role 回答"这一步谁负责什么"，profile 回答"为什么是这只Forgekin"。role 每次任务可变，profile 跨 session 持续累积，避免 agent 被固定成岗位槽位。

- **决策 2：能力画像必须包含 blind_spots（半常量层）**
  理由：roleagent.md 第 0 章明确"能力画像不是简历"。盲点决定了谁该 review 谁、谁和谁组队会翻车。空 blind_spots 列表必须在 Schema 层报错。

- **决策 3：可变性分层（常量/半常量/变量/累积/瞬时五层）**
  理由：不同可变性层的更新策略不同。常量层（模型固有能力）几乎不变；累积层（历史表现）单调积累；瞬时层（当前状态）每次任务刷新。混在一起会导致画像失真。

- **决策 4：路由算法延迟必须 < 100ms（10 个候选Forgekin）**
  理由：路由在 TeamAct Owner 步高频调用，若用 LLM 在线判断能力匹配，每次路由都要 LLM 调用，延迟与成本不可接受。改为本地向量匹配 + 缓存预计算。

- **决策 5：跨厂商 review 配对基于盲点不重叠**
  理由：同一家厂商的Forgekin共享训练分布偏差（如 Claude review Claude 漏掉同一类错误）。盲点不重叠是跨厂商 review 的结构性必需，不是锦上添花。

- **决策 6：Build to Delete vs Built to Persist 半衰期标记**
  理由：能力画像本身是 Built to Persist 基础设施（编码 agent 与外部现实的关系，模型越强越值钱），但具体的路由算法可能随模型升级而调整（Build to Delete，标 sunset）。

### 2.3 架构不变量

- CapabilityProfile 必须包含 `blind_spots` 字段，空列表报 SchemaError
- CapabilityProfile 必须通过 Repository 层持久化，禁止直接操作数据库
- 路由算法延迟必须 < 100ms（10 个候选Forgekin，P99）
- 能力画像更新必须由 Eval 信号触发，禁止Forgekin主动修改自己的画像
- 跨厂商 review 配对必须验证盲点不重叠，重叠则拒绝配对
- CapabilityRouter 与 CapabilityRepository 必须通过 DI 容器注入，禁止直接实例化
- 历史表现只能单调累积，禁止回退或清零

---

## 3. 模块设计

### 3.1 模块边界

- **profile.py** — CapabilityProfile Pydantic 数据模型（六维 + 五可变性层 + harness_fit_score）。仅负责数据结构定义与字段级校验，不含业务逻辑。
- **router.py** — CapabilityRouter 路由算法（能力匹配度 + 盲点规避度计算）。负责选 owner，不负责 owner 持球过程。
- **blind_spot.py** — BlindSpot 检测器（基于 Eval 信号识别盲点 + 跨厂商盲点相关性矩阵）。负责盲点识别与补偿策略推荐。
- **storage.py** — CapabilityRepository 抽象基类（ABC）+ SqliteCapabilityRepository 实现。负责持久化，禁直操作数据库。
- **tests/** — 单元测试 + 集成测试 + E2E 测试（遵守 T1-T8 铁律，真实 LLM、真实数据、真实工具调用）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum


class CapabilityProfile(BaseModel):
    """Forgekin能力画像 — 长期主体画像（跨 session 持续）"""
    forgekin_id: str
    model_capability: "ModelCapability"          # 常量层
    cognitive_style: "CognitiveStyle"            # 常量层
    blind_spots: list["BlindSpot"]               # 半常量层（必填，空列表报错）
    skill_packages: list["SkillPackage"] = Field(default_factory=list)  # 变量层
    tool_boundary: "ToolBoundary"                # 变量层
    historical_performance: "PerformanceLog" = Field(default_factory="PerformanceLog")  # 累积层
    current_state: "AgentState" = "idle"         # 瞬时层
    harness_fit_score: float = Field(default=0.5, ge=0.0, le=1.0)
    schema_version: str = "1.0"

    def gap_analysis(self, required: "TaskProfile") -> list[str]:
        """分析能力缺口，返回需要扩展的能力列表"""

    def has_blind_spot_conflict(self, other: "CapabilityProfile") -> bool:
        """检查与另一Forgekin的盲点是否冲突（用于跨厂商 review 配对）"""


class CapabilityRouter(ABC):
    """能力画像路由器 — 基于 capability × task 匹配度路由"""

    @abstractmethod
    async def route(
        self,
        task: "TaskProfile",
        candidates: list[CapabilityProfile],
    ) -> "RoutingDecision":
        """返回最佳 forgekin_id + 候选评分 + 盲点冲突报告

        架构契约:
        - 路由基于能力匹配而非角色
        - 延迟 < 100ms (10 候选, P99)
        - 必须返回可解释的评分明细
        """


class CapabilityRepository(ABC):
    """能力画像 Repository — 唯一持久化入口（禁直操作数据库）"""

    @abstractmethod
    async def save(self, profile: CapabilityProfile) -> str:
        """持久化能力画像，返回 profile_id"""

    @abstractmethod
    async def load(self, forgekin_id: str) -> Optional[CapabilityProfile]:
        """加载Forgekin的能力画像"""

    @abstractmethod
    async def update_performance(
        self,
        forgekin_id: str,
        eval_signal: "EvalSignal",
    ) -> None:
        """基于 Eval 信号累积历史表现（单调累积，禁回退）"""

    @abstractmethod
    async def list_by_capability(
        self,
        required: "TaskProfile",
    ) -> list[CapabilityProfile]:
        """列出符合任务能力要求的候选Forgekin"""


class BlindSpotDetector(ABC):
    """盲点检测器 — 基于 Eval 信号识别盲点"""

    @abstractmethod
    async def detect(
        self,
        forgekin_id: str,
        eval_history: list["EvalSignal"],
    ) -> list["BlindSpot"]:
        """从 Eval 历史中识别盲点"""

    @abstractmethod
    async def check_overlap(
        self,
        author_id: str,
        reviewer_id: str,
    ) -> "BlindSpotOverlapReport":
        """检查 author 与 reviewer 的盲点重叠度（跨厂商 review 配对依据）"""


class RoutingDecision(BaseModel):
    """路由决策输出"""
    selected_forgekin_id: str
    score: float = Field(ge=0.0, le=1.0)
    score_breakdown: dict[str, float]   # 各维度评分明细（可解释性）
    blind_spot_warnings: list[str]
    runner_up_id: Optional[str] = None  # 备选（主选不可用时）
```

### 3.3 数据流

```
任务创建 (TaskProfile)
       │
       ▼
┌──────────────────────────────────────────────┐
│ 1. CapabilityRepository.list_by_capability   │  ← 查询候选Forgekin
│    (Repository 层读 SQLite)                   │
└──────────────────┬───────────────────────────┘
                   │ list[CapabilityProfile]
                   ▼
┌──────────────────────────────────────────────┐
│ 2. CapabilityRouter.route(task, candidates)  │  ← 计算匹配度
│    - 能力匹配度 (skill × task)               │
│    - 盲点规避度 (blind_spots × forbidden)    │
│    - 历史表现 (Wilson 下界)                   │
│    - harness_fit_score 加权                   │
└──────────────────┬───────────────────────────┘
                   │ RoutingDecision
                   ▼
┌──────────────────────────────────────────────┐
│ 3. BlindSpotDetector.check_overlap           │  ← 跨厂商 review 配对
│    (author × reviewer 盲点矩阵)              │
└──────────────────┬───────────────────────────┘
                   │ BlindSpotOverlapReport
                   ▼
┌──────────────────────────────────────────────┐
│ 4. TeamAct Owner 步 (A002) 接管              │  ← owner 持球
│    + 写入 RoutingDecision 到 Evidence (F009) │
└──────────────────────────────────────────────┘
                   ▲
                   │ Eval 信号回流
                   │
┌──────────────────────────────────────────────┐
│ 5. 任务完成后                                │
│    CapabilityRepository.update_performance   │  ← 单调累积
│    BlindSpotDetector.detect (周期)           │  ← 识别新盲点
└──────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F008 Durable State Surfaces** — CapabilityProfile 必须持久化到 6 类 Durable Surface 中的 `memory_federation`（权威等级 2）与 `task_queue`（权威等级 3）双写
- **F009 Evidence & Sensors** — RoutingDecision 必须写入 Evidence 作为路由证据，供 Eval 信号回流
- **F018 Eval Contract** — 历史表现累积的输入是 Eval 信号（trace 信号 + 用户信号 + 探针信号三方交叉）

### 4.2 下游影响

- **F002 TeamAct Loop** — Owner 步直接调用 `CapabilityRouter.route` 选定持球者
- **F003 Handoff Capsule** — 交接胶囊的 `blind_spot_hints` 自动从 author CapabilityProfile 注入
- **F007 Push Back** — Push Back 的 evidence_refs 必须锚定到 F009 证据，间接依赖画像评估"是否是 reviewer 盲点 vs author 盲点"
- **F031 External Agent Adapter** — ExternalAgentProfile 融合到 CapabilityProfile（gap_analysis 驱动三方 Agent 调用决策）
- **F028 ForgePipeline** — 锻造流水线第 2 步"能力注入"调用 `CapabilityProfile` 构造器

### 4.3 跨模块不变量

- CapabilityProfile 与 TeamActState 必须保持 owner 一致性（路由选定的 forgekin_id 必须 == TeamActState.current_owner）
- 跨厂商 review 配对的 reviewer 必须满足 `BlindSpotOverlapReport.overlap_score < 0.3`
- 能力画像更新后必须广播事件到 EventBus（供 Eval 控制面与 forgemind marketplace 感知）
- ExternalAgentProfile 融合到 CapabilityProfile 时必须保留原厂商溯源（不可降级为"内部能力"）

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/capability/` 不 import 任何 *Forge 或 forgemind 模块（单向依赖通过）
- [ ] AC-2: CapabilityRouter 与 CapabilityRepository 通过 DI 容器注入，无直接实例化
- [ ] AC-3: 所有画像读写通过 `CapabilityRepository` 抽象，无 `cursor.execute` 直操作数据库
- [ ] AC-4: 路由权重与阈值外置到 `flowforge/config/capability.yaml`，无硬编码
- [ ] AC-5: CapabilityProfile 替换 `default_llm_actors.py` 硬编码角色（编程红线第 10/11 条通过）

### 5.2 架构不变量验收

- [ ] AC-6: `blind_spots` 为空列表时 `CapabilityProfile` 构造抛 SchemaError
- [ ] AC-7: 路由算法 P99 延迟 < 100ms（10 候选Forgekin，基准测试）
- [ ] AC-8: `update_performance` 调用后 `historical_performance.success_count` 单调递增，无回退
- [ ] AC-9: 跨厂商 review 配对 `overlap_score >= 0.3` 时配对被拒绝
- [ ] AC-10: 路由正确率 ≥ 85%（基于 Eval 信号 100 次任务基准）
- [ ] AC-11: 跨厂商 review 盲点检出率 ≥ 70%（基于 Eval 信号）

---

## 6. 引用

- [doc:../spec.md#§3.1]（FR-CORE-001 能力画像）
- [doc:../arch.md#§3.1]（CapabilityProfile × Harness 契合度）
- [doc:../features/F001-capability-profile.md]（同号 Feature 级 SRS）
- [doc:../decisions/004-capability-profile-routing.md]（能力画像路由 ADR）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR，harness_fit_score 来源）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR，跨厂商 review 链）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）
- [doc:../../../hiclaw/rules.md#编程红线]（第 10/11/12/13 条）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F001 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
