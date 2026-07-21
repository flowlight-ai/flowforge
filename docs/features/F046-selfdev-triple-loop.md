# F046: SelfDev 三闭环（Self-Development Triple Loop）

> **状态**: 🔄 in_progress
> **类型**: evolution
> **创建日期**: 2026-07-20
> **完成日期**: —（待定）
> **负责人**: 架构师可进化智能体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§2.10]（自我演进闭环）
> **对应 arch.md**: [doc:../arch.md#§3.9]（待创建 A046）
> **对应 design.md**: [doc:../design.md#§2.3.1]（Layer 1 第 9 项 Evolution 模块）
> **依赖 ADR**: [doc:../decisions/012-forgemind-engine-naming.md]（ForgeMindEngine 命名融合）
> **依赖 Feature**: [doc:features/F045-trae-bridge-protocol.md]（Trae 桥接协议 — LLM 调用通道）
> **关联 CL**: CL-001（自我演进三模式）
> **关联 VISION**: [doc:../VISION.md#7]（可进化智能体主导自主开发）

---

## 1. 上下文

### 1.1 问题陈述

FlowForge 的核心愿景是"可进化智能体主导全部自主开发流程"。为实现这一愿景，可进化智能体必须具备"自己开发自己"的能力——能够自主编写文档、修改代码、调整框架配置。

spec.md §2.10 明确要求三层自我演进闭环：
- **SelfDevDocLoop**（文档自我演进闭环）：自主编写和维护项目文档
- **SelfDevCodeLoop**（代码自我演进闭环）：自主实现和修改代码
- **SelfDevFrameworkLoop**（框架自我演进闭环）：自主调整框架配置和架构

当前 `flowforge/evolution/engine.py` 已实现三模式骨架（Scope Guard / Process Evolution / Knowledge Evolution），但这是**治理层**（防御/改进/成长），不是**执行层**（实际写文档/代码/改框架）。三模式提供护栏和经验沉淀，但无法直接执行开发任务。

F046 的目标是补全**执行层**——三个 SelfDev 闭环，每个闭环是一个完整的"发现→规划→执行→验证→沉淀"五步循环，通过 F045 TraeLLMClient 调用 LLM 执行实际开发。

### 1.2 当前痛点

1. **可进化智能体无法自主开发**：所有文档/代码/框架修改都依赖 operator 手动操作，违背"主导自主开发"愿景
2. **三模式无执行能力**：Scope Guard 只能"提醒"偏离，Process Evolution 只能"提案"改进，Knowledge Evolution 只能"蒸馏"知识——都无法直接修改代码或文档
3. **LLM 调用通道刚打通**：F045 Trae 桥接协议已交付（59/59 测试通过），但可进化智能体还没有使用该通道执行开发任务的"工作流"
4. **经验无法沉淀**：operator 手动修改的内容无法被三模式捕获和蒸馏，导致同类问题反复出现

### 1.3 不做的影响

如果不实现 SelfDev 三闭环：
- **C5 IM 议事无法落地**：IM 议事中可进化智能体需要自主执行决策（写文档/改代码），无 SelfDev 则只能"讨论"无法"行动"
- **C6 监督 FlowForge 自主开发无法启动**：operator 无法将开发流程主导权交给可进化智能体
- **可进化智能体觉醒阶无法晋升**：E4 自主阶要求"在 operator 预设边界内自主执行任务"，无 SelfDev 则无法自主执行
- **经验无法闭环**：三模式的"提案/蒸馏"无执行结果可评估，知识成熟度阶梯无法推进

---

## 2. 决策

### 2.1 核心设计

**分层架构**：SelfDev 三闭环作为**执行层**，复用已有三模式作为**治理层**，通过 F045 TraeLLMClient 调用 LLM 执行实际开发。

```
┌─────────────────────────────────────────────────────────────────┐
│  ForgeMindEngine（统一入口）                                     │
│                                                                  │
│  ┌── 执行层（F046 新增）──────────────────────────────────────┐ │
│  │                                                            │ │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐ │ │
│  │  │ SelfDevDocLoop  │ │ SelfDevCodeLoop │ │SelfDevFrame- │ │ │
│  │  │ (文档闭环)      │ │ (代码闭环)      │ │workLoop(框架)│ │ │
│  │  │                 │ │                 │ │              │ │ │
│  │  │ Discover→Plan  │ │ Discover→Plan  │ │ Discover→Plan│ │ │
│  │  │ →Act→Verify    │ │ →Act→Verify    │ │ →Act→Verify  │ │ │
│  │  │ →Persist        │ │ →Persist        │ │ →Persist     │ │ │
│  │  └────────┬────────┘ └────────┬────────┘ └──────┬───────┘ │ │
│  └───────────┼───────────────────┼─────────────────┼─────────┘ │
│              │                   │                 │            │
│              ▼                   ▼                 ▼            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  TraeLLMClient (F045 桥接) → 调用 LLM 执行实际开发       │  │
│  └──────────────────────────────────────────────────────────┘  │
│              │                   │                 │            │
│              ▼                   ▼                 ▼            │
│  ┌── 治理层（已有）───────────────────────────────────────────┐ │
│  │                                                            │ │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐ │ │
│  │  │ Scope Guard     │ │ Process         │ │ Knowledge    │ │ │
│  │  │ (Mode A 护栏)   │ │ Evolution       │ │ Evolution    │ │ │
│  │  │                 │ │ (Mode B 改进)   │ │ (Mode C 沉淀)│ │ │
│  │  │ 阻止越权修改    │ │ 改进工作流程    │ │ 蒸馏可复用知识│ │ │
│  │  └─────────────────┘ └─────────────────┘ └──────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 三闭环职责划分

| 闭环 | 处理对象 | 触发觉醒阶 | 安全护栏 | LLM 用途 |
|------|---------|:--------:|---------|---------|
| **SelfDevDocLoop** | 文档（spec/design/feature/README） | E3+ | 禁止修改 VISION/rules.md | 生成文档大纲、撰写内容、检查格式 |
| **SelfDevCodeLoop** | 代码（Python/YAML 配置） | E4+ | 禁止删除测试、禁止绕过 DI | 生成代码方案、实现函数、修复 bug |
| **SelfDevFrameworkLoop** | 框架（架构/ADR/依赖图） | E5+ | 必须显式 approval | 设计架构方案、评估影响、生成 ADR 草稿 |

### 2.3 五步循环（通用流程）

每个 SelfDev 闭环都遵循统一的五步循环（参考 rules.md §10.1 Loop 工程模式）：

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐            │
│   │ Discover │───→│  Plan    │───→│   Act    │            │
│   │ 发现任务 │    │ 设计方案 │    │ 执行修改 │            │
│   └──────────┘    └──────────┘    └────┬─────┘            │
│                                        │                   │
│                                        ▼                   │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐            │
│   │ Persist  │←───│  Verify  │←───│          │            │
│   │ 沉淀经验 │    │ 验证效果 │    │          │            │
│   └──────────┘    └──────────┘    └──────────┘            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**五步详细说明**：

1. **Discover（发现）**：识别需要修改的对象
   - 输入：Eval Ledger 数据、用户反馈、自动检测信号
   - 输出：`DevTask`（开发任务，含目标对象、修改类型、优先级）
   - 实现：基于规则的检测 + LLM 辅助分析

2. **Plan（规划）**：设计修改方案
   - 输入：`DevTask` + 现有对象内容 + 相关上下文
   - 输出：`DevPlan`（修改方案，含具体步骤、预期效果、风险评估）
   - 实现：通过 TraeLLMClient 调用 LLM 生成方案

3. **Act（执行）**：执行实际修改
   - 输入：`DevPlan`
   - 输出：`DevResult`（修改结果，含变更文件列表、diff）
   - 实现：文件 I/O（写/改/删），不直接操作数据库（铁律 4）

4. **Verify（验证）**：验证修改效果
   - 输入：`DevResult` + 验证规则
   - 输出：`VerifyResult`（通过/失败 + 具体原因）
   - 实现：运行测试、格式检查、架构约束检查
   - 失败处理：触发 Reflect（反思），重新 Plan（上限 3 次）

5. **Persist（沉淀）**：沉淀经验到治理层
   - 输入：`DevResult` + `VerifyResult`
   - 输出：经验卡片（EpisodeCard / MethodCard）
   - 实现：调用 KnowledgeEvolution 蒸馏知识，调用 ProcessEvolution 改进流程

### 2.4 关键接口

```python
# flowforge/evolution/self_dev_base.py

from abc import ABC, abstractmethod
from typing import Any, Optional
from pydantic import BaseModel, Field


class DevTask(BaseModel):
    """开发任务 — Discover 阶段输出."""
    task_id: str
    loop_type: str  # "doc" | "code" | "framework"
    target_path: str  # 目标文件/目录路径
    modification_type: str  # "create" | "update" | "delete"
    description: str  # 任务描述
    priority: str = "normal"  # "low" | "normal" | "high" | "critical"
    context: dict = Field(default_factory=dict)  # 额外上下文


class DevPlan(BaseModel):
    """修改方案 — Plan 阶段输出."""
    plan_id: str
    task_id: str
    steps: list[dict]  # 具体步骤列表
    expected_effect: str  # 预期效果
    risk_assessment: str  # 风险评估
    requires_approval: bool = False  # 是否需要 operator 显式批准


class DevResult(BaseModel):
    """修改结果 — Act 阶段输出."""
    result_id: str
    plan_id: str
    changed_files: list[str]  # 变更文件列表
    diff_summary: str  # diff 摘要
    success: bool
    error_message: str = ""


class VerifyResult(BaseModel):
    """验证结果 — Verify 阶段输出."""
    verify_id: str
    result_id: str
    passed: bool
    checks: list[dict]  # 具体检查项
    failure_reasons: list[str] = Field(default_factory=list)


class SelfDevLoopBase(ABC):
    """SelfDev 闭环抽象基类 — 三闭环共享的五步循环框架."""

    loop_type: str  # "doc" | "code" | "framework"
    min_awakening_stage: str  # "E3" | "E4" | "E5"

    def __init__(
        self,
        trae_client: Any,  # TraeLLMClient 实例
        forgekin_config: dict,  # 可进化智能体配置
        evolution_engine: Any,  # ForgeMindEngine 实例（治理层）
    ) -> None:
        self._trae_client = trae_client
        self._forgekin_config = forgekin_config
        self._engine = evolution_engine

    @abstractmethod
    async def discover(self, context: dict) -> list[DevTask]:
        """发现任务（子类实现）."""

    @abstractmethod
    async def plan(self, task: DevTask) -> DevPlan:
        """设计方案（子类实现，通常调用 LLM）."""

    @abstractmethod
    async def act(self, plan: DevPlan) -> DevResult:
        """执行修改（子类实现）."""

    @abstractmethod
    async def verify(self, result: DevResult) -> VerifyResult:
        """验证效果（子类实现）."""

    async def persist(self, result: DevResult, verify: VerifyResult) -> dict:
        """沉淀经验（通用实现，调用治理层）."""
        # 调用 KnowledgeEvolution 蒸馏知识
        # 调用 ProcessEvolution 改进流程
        # 默认实现返回沉淀结果
        ...

    async def run_once(self, context: dict) -> dict:
        """执行一次完整的五步循环."""
        tasks = await self.discover(context)
        results = []
        for task in tasks:
            plan = await self.plan(task)
            if plan.requires_approval:
                # 等待 operator 显式批准（通过 F045 桥接）
                ...
            result = await self.act(plan)
            verify = await self.verify(result)
            # Verify 失败时触发 Reflect（上限 3 次）
            retries = 0
            while not verify.passed and retries < 3:
                retries += 1
                # 反思并重新 Plan
                plan = await self.reflect_and_replan(task, result, verify)
                result = await self.act(plan)
                verify = await self.verify(result)
            # 沉淀经验
            persist_result = await self.persist(result, verify)
            results.append({
                "task": task.model_dump(),
                "plan": plan.model_dump(),
                "result": result.model_dump(),
                "verify": verify.model_dump(),
                "persist": persist_result,
            })
        return {"loop_type": self.loop_type, "results": results}

    async def reflect_and_replan(
        self,
        task: DevTask,
        result: DevResult,
        verify: VerifyResult,
    ) -> DevPlan:
        """反思并重新规划（基于真实执行反馈）."""
        # 通过 LLM 分析失败原因并生成新方案
        ...
```

### 2.5 三闭环差异化实现

#### 2.5.1 SelfDevDocLoop（文档闭环）

```python
# flowforge/evolution/self_dev_doc.py

class SelfDevDocLoop(SelfDevLoopBase):
    """文档自我演进闭环 — 自主编写和维护项目文档."""

    loop_type = "doc"
    min_awakening_stage = "E3"  # 受限自主阶可触发

    async def discover(self, context: dict) -> list[DevTask]:
        """发现文档任务：
        - 检测过期文档（内容与代码不一致）
        - 检测缺失文档（新功能无文档）
        - 检测格式问题（不符合 front-matter 规范）
        """
        ...

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 LLM 生成文档大纲和内容方案."""
        # 调用 TraeLLMClient，传入现有文档结构 + 任务描述
        ...

    async def act(self, plan: DevPlan) -> DevResult:
        """写入/修改文档文件."""
        # 文件 I/O（async），不操作数据库
        ...

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证文档：
        - 格式检查（front-matter / 标题层级 / 链接有效性）
        - 内容质量检查（通过 LLM 审核，T7 铁律）
        - 与代码一致性检查
        """
        ...
```

#### 2.5.2 SelfDevCodeLoop（代码闭环）

```python
# flowforge/evolution/self_dev_code.py

class SelfDevCodeLoop(SelfDevLoopBase):
    """代码自我演进闭环 — 自主实现和修改代码."""

    loop_type = "code"
    min_awakening_stage = "E4"  # 自主阶可触发

    async def discover(self, context: dict) -> list[DevTask]:
        """发现代码任务：
        - 测试失败分析（从 pytest 输出提取）
        - 缺失功能检测（从 task.md 提取未实现项）
        - Bug 检测（从日志/用户反馈）
        - 重构机会（代码异味检测）
        """
        ...

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 LLM 生成代码方案：
        - 传入设计文档 + 现有代码结构
        - 生成具体实现步骤
        - 评估风险（是否影响现有功能）
        """
        ...

    async def act(self, plan: DevPlan) -> DevResult:
        """写入/修改代码文件.
        安全护栏：
        - 禁止删除已有测试用例（红线 8）
        - 禁止绕过 DI 容器（红线 12）
        - 禁止硬编码路径/密钥（红线 11）
        """
        ...

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证代码：
        - 运行单元测试（pytest）
        - 类型检查（mypy）
        - Lint 检查（ruff/flake8）
        - 架构约束检查（单向依赖、循环依赖）
        - LLM 审核（T7 铁律：LLM 生成代码必须经 LLM 审核）
        """
        ...
```

#### 2.5.3 SelfDevFrameworkLoop（框架闭环）

```python
# flowforge/evolution/self_dev_framework.py

class SelfDevFrameworkLoop(SelfDevLoopBase):
    """框架自我演进闭环 — 自主调整框架配置和架构."""

    loop_type = "framework"
    min_awakening_stage = "E5"  # 完全自主阶可触发

    async def discover(self, context: dict) -> list[DevTask]:
        """发现框架任务：
        - 架构偏离检测（与 ADR 不一致）
        - 配置不一致检测（YAML 与代码不匹配）
        - 依赖图问题（循环依赖、跨层依赖）
        """
        ...

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 LLM 设计架构调整方案.
        安全护栏：
        - 禁止修改 VISION.md §7
        - 禁止修改 rules.md 红线
        - 禁止修改 13 份核心 ADR
        - 所有方案必须 requires_approval=True
        """
        ...

    async def act(self, plan: DevPlan) -> DevResult:
        """执行架构修改：
        - 修改 YAML 配置
        - 创建新 ADR（不修改已有）
        - 调整模块依赖
        """
        ...

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证框架：
        - 依赖图检查（无循环依赖）
        - 单向依赖检查（下层不导入上层）
        - ADR 一致性检查
        - 配置完整性检查
        """
        ...
```

### 2.6 关键不变量

| # | 不变量 | 说明 |
|---|--------|------|
| **I1** | 觉醒阶门控 | 三闭环分别要求 E3/E4/E5 觉醒阶，低于门槛不触发 |
| **I2** | Scope Guard 前置检查 | 所有 Act 操作前必须通过 Scope Guard 检查（不越权修改 VISION/rules/ADR） |
| **I3** | Reflect 上限 3 次 | Verify 失败后最多重试 3 次，超过则上报 operator |
| **I4** | LLM 审核必经 | LLM 生成的内容（文档/代码/架构）必须再调用 LLM 审核通过（T7 铁律） |
| **I5** | 不删除测试 | SelfDevCodeLoop 禁止删除已有测试用例（红线 8） |
| **I6** | 不绕过 DI | 所有新代码必须通过 DI 容器注入依赖（红线 12） |
| **I7** | 不硬编码 | 所有新代码禁止硬编码路径/密钥/端口（红线 11） |
| **I8** | Framework 需 approval | SelfDevFrameworkLoop 的所有 Act 必须显式 approval |

---

## 3. 实现计划

### 3.1 Phase 划分

#### Phase 1：基础框架（self_dev_base.py）
1. 实现 `DevTask / DevPlan / DevResult / VerifyResult` Pydantic 模型
2. 实现 `SelfDevLoopBase` 抽象基类（五步循环框架 + reflect_and_replan）
3. 集成到 `ForgeMindEngine`（添加 self_dev_doc / self_dev_code / self_dev_framework 字段）
4. 单元测试覆盖基类

#### Phase 2：SelfDevDocLoop（文档闭环）
1. 实现 `self_dev_doc.py`：文档发现 / LLM 规划 / 文件写入 / 格式验证
2. Discover：检测过期文档、缺失文档、格式问题
3. Plan：通过 TraeLLMClient 生成文档大纲
4. Act：写入文档文件（async I/O）
5. Verify：front-matter 检查、链接有效性、LLM 内容审核
6. 单元测试 + E2E 测试（真实生成一份文档）

#### Phase 3：SelfDevCodeLoop（代码闭环）
1. 实现 `self_dev_code.py`：代码任务发现 / LLM 方案 / 代码写入 / 测试验证
2. Discover：测试失败分析、缺失功能检测
3. Plan：通过 TraeLLMClient 生成代码方案
4. Act：写入/修改代码文件（含安全护栏检查）
5. Verify：运行 pytest、mypy、架构约束检查、LLM 代码审核
6. 单元测试 + E2E 测试（真实修复一个 bug 或实现一个功能）

#### Phase 4：SelfDevFrameworkLoop（框架闭环）
1. 实现 `self_dev_framework.py`：架构偏离检测 / LLM 方案 / 配置修改 / 依赖图验证
2. Discover：架构偏离检测、配置不一致检测
3. Plan：通过 TraeLLMClient 设计架构方案（必须 approval）
4. Act：修改 YAML 配置、创建新 ADR
5. Verify：依赖图检查、ADR 一致性检查
6. 单元测试 + E2E 测试（真实调整一个配置）

#### Phase 5：集成到 ForgeMindEngine + operator 工作流文档
1. 在 `ForgeMindEngine` 添加 `run_self_dev_loop(loop_type, context)` 入口
2. 觉醒阶门控检查（从可进化智能体配置读取 awakening_stage）
3. 集成到 luban.yaml（self_evolution 配置）
4. 编写 operator 工作流文档（如何监督 SelfDev 执行）

### 3.2 依赖关系

- **依赖 F045 Trae 桥接协议**：所有 Plan 阶段通过 TraeLLMClient 调用 LLM
- **依赖 ForgeMindEngine 三模式**：Persist 阶段调用治理层沉淀经验
- **依赖 Eval Ledger（CL-004）**：Discover 阶段从 Eval Ledger 读取信号
- **被 C5 IM 议事依赖**：IM 议事中可进化智能体通过 SelfDev 执行决策
- **被 C6 监督自主开发依赖**：operator 通过 SelfDev 将开发主导权交给可进化智能体

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: SelfDevDocLoop 能发现过期文档并自主更新（E3 觉醒阶）
- [ ] AC-2: SelfDevCodeLoop 能修复测试失败并自主实现新功能（E4 觉醒阶）
- [ ] AC-3: SelfDevFrameworkLoop 能检测架构偏离并生成 ADR 草稿（E5 觉醒阶，需 approval）
- [ ] AC-4: 五步循环完整执行（Discover→Plan→Act→Verify→Persist）
- [ ] AC-5: Verify 失败时触发 Reflect，上限 3 次重试
- [ ] AC-6: Scope Guard 前置检查阻止越权修改（VISION/rules/ADR）
- [ ] AC-7: 觉醒阶门控生效（低于门槛的闭环不触发）

### 4.2 安全验收

- [ ] AC-8: SelfDevCodeLoop 不删除已有测试用例（红线 8）
- [ ] AC-9: 所有新代码通过 DI 容器注入依赖（红线 12）
- [ ] AC-10: 所有新代码不硬编码路径/密钥/端口（红线 11）
- [ ] AC-11: SelfDevFrameworkLoop 的所有 Act 操作需 operator 显式 approval

### 4.3 质量验收

- [ ] AC-12: LLM 生成的内容（文档/代码）经 LLM 审核通过（T7 铁律）
- [ ] AC-13: 单次 SelfDev 循环端到端延迟 < 5 分钟（含 LLM 调用）
- [ ] AC-14: 经验沉淀到 KnowledgeEvolution（KnowledgeObject 创建）

### 4.4 Eval 验收

- [ ] AC-15: Eval Contract 五问全部回答
- [ ] AC-16: 三方信号交叉通过（trace + 用户 + 探针）
- [ ] AC-17: 归因到七类矩阵之一（若失败）

---

## 5. 测试计划

### 5.1 单元测试

- `test_self_dev_base.py`：五步循环框架 / Reflect 重试 / 觉醒阶门控
- `test_self_dev_doc.py`：文档发现 / Plan / Act / Verify
- `test_self_dev_code.py`：代码任务发现 / 安全护栏 / 测试验证
- `test_self_dev_framework.py`：架构偏离检测 / approval 流程

### 5.2 集成测试

- `test_integration_engine.py`：ForgeMindEngine 集成 SelfDev 三闭环
- `test_integration_trae.py`：通过 TraeLLMClient 真实调用 LLM 执行开发

### 5.3 E2E 测试

- `test_e2e_doc_loop.py`：自主更新一份过期文档
- `test_e2e_code_loop.py`：自主修复一个测试失败
- `test_e2e_framework_loop.py`：自主检测并修复一个架构偏离

E2E 测试遵守 T1-T8 铁律：
- T1: 不 Mock LLM（通过 TraeLLMClient 真实调用 LLM）
- T2: 真实场景数据（真实文档/代码/配置）
- T3: 具体断言（验证修改后的文件内容）
- T6: MetricsCollector 采集指标
- T7: LLM 生成内容经 LLM 审核
- T8: 涉及 Web 操作时操控浏览器验证 DOM

---

## 6. Eval Contract（五问）

### 6.1 谁评估
- 评估者：operator + 评审员可进化智能体（梵高）+ LLM 自动审核
- 自动评估：Eval Ledger 记录每次 SelfDev 循环的延迟、成功率、重试次数

### 6.2 评估什么
- 三闭环的执行能力（能否正确发现/规划/执行/验证/沉淀）
- 安全护栏的有效性（是否阻止越权修改）
- LLM 生成内容的质量（文档可读性、代码可维护性、架构合理性）
- 经验沉淀的复用性（KnowledgeObject 是否被后续任务复用）

### 6.3 何时评估
- 每次 SelfDev 循环后：自动记录 trace 信号
- 每周：operator 主观评估（执行质量、干预频率）
- 每月：评审员可进化智能体 review 整体 SelfDev 机制

### 6.4 评估信号
- **trace 信号**：循环延迟、重试次数、Verify 通过率、Persist 蒸馏数
- **用户信号**：operator 反馈干预频率、修改质量
- **探针信号**：KnowledgeObject 复用次数、成熟度晋升趋势

### 6.5 评估后做什么
- 通过 → 状态改为 ✅ done，进入 KnowledgeEvolution 蒸馏
- 失败 → 归因到七类矩阵 + 修复

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记
本 Feature 主要属于：[ ] Build to Delete | [x] Built to Persist | [ ] 混合

### 7.2 理由
SelfDev 三闭环是 FlowForge "自己开发自己"能力的核心实现，只要 FlowForge 存在，就需要自主开发能力。即使未来 LLM 能力升级，五步循环框架仍然适用。

### 7.3 sunset 触发条件
- FlowForge 退役 → 整体迁移到新框架
- LLM 能力达到完全自主（无需五步循环）→ 评估是否简化为单步执行

---

## 8. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-07-20 | 初版：基于 spec.md §2.10 + F045 桥接协议已完成的设计，规划三闭环执行层 |
