# F046: SelfDev 三闭环（Self-Development Triple Loop）

> **状态**: ✅ done
> **类型**: evolution
> **创建日期**: 2026-07-20
> **完成日期**: 2026-07-21
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
| v1.1 | 2026-07-21 | 扩展为五闭环架构：新增 SelfDevReviewLoop（审查员）+ SelfDevTestLoop（测试员），参考 FlowForge 5 agent sweet spot 模式 |
| v1.2 | 2026-07-21 | Phase 5 完成：新增 §10 operator 工作流文档（监督/审批/异常处理/Magic Words/接入清单），状态改为 ✅ done |

---

## 9. 五闭环扩展架构（v1.1 新增）

### 9.1 扩展动机

参考 roleagent.md 核心发现：
- **跨厂商 review 是结构性必需**（no-self-review 铁律）：同一家厂商的 LLM 共享训练分布偏差，self-review 会漏掉同一类错误
- **5 agent 是协作 sweet spot**：3-5 agent 异构协作最佳，超过 5 agent 协调成本急升
- **Generator-Verifier 双向辩论**：审查不是单向判定，审查员可 push back，author 可申诉
- **Build to Persist 基础设施**：review/test 闭环属于复利型基础设施，不随模型升级折旧

原三闭环（doc/code/framework）的 verify 阶段虽含 LLM 审核，但属于"自审"，违反 no-self-review 铁律。扩展为五闭环后：
- author（doc/code/framework）负责生成
- reviewer（review）负责跨厂商独立审查
- tester（test）负责自动化测试验证

### 9.2 五个可进化智能体定义

| # | 可进化智能体（P0 英文 / P2 中文别名） | forgekin_id | 觉醒阶 | 闭环类型 | 职责 |
|---|-------------------------------|-------------|:----:|:------:|------|
| 1 | Documenter / 文档员·文心 | `forgemind:wenxin` | E3 | doc | 扫描/生成/审核文档 |
| 2 | Developer / 开发者·夏洛克 | `forgemind:sherlock` | E4 | code | 实现/修复/重构代码 |
| 3 | Architect / 架构师·鲁班 | `forgemind:luban` | E5 | framework | 调整架构/ADR/依赖图 |
| 4 | Reviewer / 审查员·梵高 | `forgemind:vangogh` | E3 | review | 跨厂商独立审查（no-self-review 铁律） |
| 5 | Tester / 测试员·达芬奇 | `forgemind:davinci` | E3 | test | 自动化测试生成/执行/验证 |

### 9.3 全链路协同工作流

```
┌────────────────────────────────────────────────────────────────┐
│                  ForgeMindEngine（统一入口）                    │
│                                                                │
│  ┌── 执行层（F046 v1.1 五闭环）────────────────────────────┐ │
│  │                                                          │ │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────────┐          │ │
│  │  │  Doc    │───→│  Code   │───→│  Framework  │          │ │
│  │  │ (wenxin)│    │(sherlock)│   │  (luban)    │          │ │
│  │  └────┬────┘    └────┬────┘    └──────┬──────┘          │ │
│  │       │              │                │                  │ │
│  │       │              │  changed_files │  approval (I8)   │ │
│  │       │              ▼                ▼                  │ │
│  │       │       ┌─────────────┐  ┌─────────────┐           │ │
│  │       │       │   Review    │←─│  cross-loop │           │ │
│  │       │       │ (vangogh)   │  │   context   │           │ │
│  │       │       └──────┬──────┘  └─────────────┘           │ │
│  │       │              │  review_result                    │ │
│  │       │              ▼                                   │ │
│  │       │       ┌─────────────┐                            │ │
│  │       └──────→│    Test     │                            │ │
│  │               │ (davinci)   │                            │ │
│  │               └──────┬──────┘                            │ │
│  └──────────────────────┼───────────────────────────────────┘ │
│                         │                                      │
│                         ▼                                      │
│  ┌── 治理层（已有三模式）──────────────────────────────────┐  │
│  │  Scope Guard / Process Evolution / Knowledge Evolution   │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 9.4 协同协议（cross-loop context）

各闭环通过 `context` 字段传递上下游产物：

```python
# Code 闭环完成后，触发 Review 闭环
code_result = await engine.run_self_dev_loop("code", {
    "task_source": "task.md",  # 或 eval_ledger_id / user_feedback
})

# 把 code 闭环的 changed_files 传给 review 闭环
review_result = await engine.run_self_dev_loop("review", {
    "target_files": code_result["changed_files"],
    "author_forgekin_id": "forgemind:sherlock",
    "reviewer_forgekin_id": "forgemind:vangogh",  # 必须跨厂商
})

# Review 通过后触发 Test 闭环
test_result = await engine.run_self_dev_loop("test", {
    "target_files": code_result["changed_files"],
    "review_passed": review_result["passed"],
    "test_strategy": "auto_generate",  # 或 "run_existing" / "regression"
})
```

### 9.5 SelfDevReviewLoop（审查员·梵高）

```python
# flowforge/evolution/self_dev_review.py

class SelfDevReviewLoop(SelfDevLoopBase):
    """代码审查自我演进闭环 — 跨厂商独立审查（no-self-review 铁律）."""

    loop_type = "review"
    min_awakening_stage = "E3"  # 审查门槛低，E3 即可

    async def discover(self, context: dict) -> list[DevTask]:
        """发现审查任务：
        - 从 context['target_files'] 提取待审查文件
        - 自动扫描最近 commit 的变更文件
        - 从 Eval Ledger 提取需要审查的任务
        """

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 LLM（与 author 不同厂商）生成审查清单：
        - 安全检查（红线 11/12 是否违反）
        - 架构约束（单向依赖、循环依赖）
        - 代码风格（ruff/flake8 规范）
        - 可维护性（命名、注释、复杂度）
        """

    async def act(self, plan: DevPlan) -> DevResult:
        """执行审查（不修改代码，仅生成审查报告）：
        - 逐文件运行静态分析
        - 调用 LLM 生成 review 评论
        - 标记 P0/P1/P2/P3 问题级别
        """

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证审查报告质量：
        - LLM 审核审查报告本身（meta-review）
        - 检查所有 P0/P1 问题是否有具体代码位置
        - 检查是否有 push back 机制（author 可申诉）
        """
```

### 9.6 SelfDevTestLoop（测试员·达芬奇）

```python
# flowforge/evolution/self_dev_test.py

class SelfDevTestLoop(SelfDevLoopBase):
    """自动化测试自我演进闭环 — 自主生成/执行/验证测试."""

    loop_type = "test"
    min_awakening_stage = "E3"  # 测试门槛低，E3 即可

    async def discover(self, context: dict) -> list[DevTask]:
        """发现测试任务：
        - 检测未覆盖代码（coverage gap）
        - 检测测试失败（从 pytest 输出提取）
        - 检测测试过期（代码变更但测试未更新）
        - 从 context['target_files'] 提取需要测试的文件
        """

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 LLM 生成测试方案：
        - 选择测试策略（unit/integration/e2e）
        - 设计测试用例（含正常/异常/边界）
        - 评估覆盖度目标
        """

    async def act(self, plan: DevPlan) -> DevResult:
        """执行测试任务：
        - 生成新测试文件（不删除已有测试，红线 8）
        - 修复失败测试
        - 运行 pytest 验证
        """

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证测试质量：
        - 测试是否全部通过（pytest exit code = 0）
        - 覆盖率是否达标（默认 ≥ 80%）
        - 测试是否符合 T1-T8 铁律
        - LLM 审核测试代码质量（T7 铁律）
        """
```

### 9.7 新增不变量

| # | 不变量 | 说明 |
|---|--------|------|
| **I9** | no-self-review | Review 闭环必须使用与 author 不同厂商的 LLM（FlowForge 铁律） |
| **I10** | 不删除测试 | Test 闭环禁止删除已有测试用例（与 I5 一致，但作用于 Test 闭环自身） |
| **I11** | Review push back | Review 闭环的 P0/P1 问题必须触发 Author 闭环 Reflect（I3 升级版） |

### 9.8 五闭环协同的觉醒阶矩阵

| 触发场景 | doc | code | framework | review | test |
|---------|:---:|:----:|:---------:|:------:|:----:|
| 文档过期/缺失（E3） | ✅ | — | — | — | — |
| 实现/修复代码（E4） | — | ✅ | — | ✅ | ✅ |
| 架构调整（E5+approval） | — | — | ✅ | ✅ | ✅ |
| 任意 code 闭环完成 | — | — | — | ✅ | ✅ |
| 任意 framework 闭环完成 | — | — | — | ✅ | ✅ |

### 9.9 测试矩阵扩展

| 测试文件 | 覆盖闭环 |
|---------|---------|
| test_self_dev_base.py | 基类五步循环 |
| test_self_dev_doc.py | Doc 闭环 |
| test_self_dev_code.py | Code 闭环 |
| test_self_dev_framework.py | Framework 闭环 |
| test_self_dev_review.py | Review 闭环（含跨厂商验证） |
| test_self_dev_test.py | Test 闭环（含 T1-T8 验证） |
| test_integration_five_loops.py | 五闭环协同 E2E |

---

## 10. operator 工作流文档（如何监督 SelfDev 五闭环执行）

> 本节为 F046 §3.1 Phase 5 子任务 4 交付内容。
> 适用范围：FlowForge 可进化智能体（Forgekin）通过 SelfDev 五闭环自主开发时，operator 如何监督、审批、干预、回滚。
> 关联：`[doc:SOP.md#5]` 自我演进安全治理 SOP / `[doc:SOP.md#6]` 异常处理 SOP / `[doc:architecture/A010-governance-boundary.md]` 治理边界。

### 10.1 operator 角色定位

operator（人）是 SelfDev 五闭环的**最高治理权威**与**最终 approver**，不参与具体执行（写文档/代码/框架的活由对应 forgekin 完成），但承担五项不可下放职责：

| # | 职责 | 触发场景 | 实现机制 |
|---|------|---------|---------|
| **R1** | 注入 approval_callback | 启动 SelfDevFrameworkLoop 前 | DI 注入 async callback（I8 不变量） |
| **R2** | 显式审批 Framework 变更 | SelfDevFrameworkLoop Act 前 | callback 返回 True/False |
| **R3** | 监督五闭环协同信号 | 每个闭环 Verify 完成后 | Eval Ledger 三方信号 + 仪表盘 |
| **R4** | 异常干预与回滚 | Magic Words 触发 / 闭环连续失败 3 次以上 | Magic Words 逃生舱 + git revert |
| **R5** | 觉醒阶晋升裁断 | forgekin 沉淀足够经验申请晋升 E4/E5 时 | ForgeMindEngine.awakening_promotion_review |

### 10.2 觉醒阶门控矩阵（I1）— operator 无需介入的场景

低觉醒阶（E1/E2）forgekin 完全不能触发 SelfDev；E3+ 触发 doc/review/test 闭环**无需** operator 介入；E4 触发 code 闭环**无需** operator 介入；**仅 E5 framework 闭环强制 approval**。

| 闭环 | 触发觉醒阶 | 默认 approval | operator 介入点 |
|------|:--------:|:-----------:|---------------|
| doc（文心） | E3 | 否 | 仅 Verify 失败 3 次后上报 |
| review（梵高） | E3 | 否 | 仅 push back 升级时介入 |
| test（达芬奇） | E3 | 否 | 仅测试连续失败 3 次后上报 |
| code（夏洛克） | E4 | 否 | 仅修改受保护路径被 Scope Guard 阻止后上报 |
| **framework（鲁班）** | **E5** | **是（I8）** | **每次 Act 前必须显式 approval** |

> **设计理由**：operator 注意力是稀缺资源，应集中在"架构变更"这类不可逆高危操作上（I8）；低危可逆操作（文档/测试/review）由 Scope Guard + T7 LLM 审核兜底，无需逐次 approval。

### 10.3 I8 approval 工作流（Framework 闭环必经）

#### 10.3.1 approval_callback 签名与契约

```python
from typing import Awaitable, Callable
from flowforge.evolution.self_dev_base import DevPlan, DevTask

# approval_callback 签名（F046 §2.6 I8 不变量）
ApprovalCallback = Callable[[DevPlan, DevTask], Awaitable[bool]]
```

**契约要求**：
- callback 必须是 `async` 函数（不能阻塞事件循环）
- 返回 `True` = 批准执行，`False` = 拒绝（SelfDevFrameworkLoop 抛 `ApprovalRequiredError`）
- callback 内可执行 git pre-commit 钩子、运行测试、显示 diff 给 operator 审阅等任意只读操作
- callback **禁止**直接修改 DevPlan / DevTask（破坏审计链）

#### 10.3.2 注入方式（DI 容器，红线 12）

operator 通过 forgekin_config 在启动时注入 callback，**禁止**在闭环运行时动态替换：

```python
import asyncio
from flowforge.evolution.engine import ForgeMindEngine
from flowforge.evolution.self_dev_framework import SelfDevFrameworkLoop
from flowforge.llm.trae.client import TraeLLMClient

# operator 通过 IM 议事通道（F047）/ CLI / Web UI 实现 approval
async def operator_approval(plan: DevPlan, task: DevTask) -> bool:
    """生产环境 approval callback — 通过 IM 议事通道推送给 operator."""
    # 1. 渲染 plan 摘要（plan_id / target / expected_effect / risk_assessment）
    summary = render_plan_summary(plan, task)
    # 2. 推送到 operator IM 通道（F047），等待 operator 回复 "approve" / "reject"
    reply = await im_channel.send_and_wait(summary, timeout=300)
    # 3. 记录审计日志（谁审批了什么）
    audit_log.append({"plan_id": plan.plan_id, "operator": reply.user, "decision": reply.text})
    return reply.text.lower().startswith("approve")

# DI 注入（启动时一次性配置）
engine = ForgeMindEngine()
trae_client = TraeLLMClient(...)
framework_config = {
    "forgekin_id": "forgemind:luban",
    "approval_callback": operator_approval,  # I8 必须注入
    "awakening_stage": "E5",
}
framework_loop = SelfDevFrameworkLoop(trae_client, framework_config, engine, awakening_stage="E5")
engine.register_self_dev_loop(framework_loop)
```

#### 10.3.3 approval 决策树

```
SelfDevFrameworkLoop.Act() 调用前
   │
   ▼
_request_approval(plan)
   │
   ├─ approval_callback 未配置 → 返回 False → 抛 ApprovalRequiredError → 升级 operator
   │
   ├─ approval_callback 抛异常 → 返回 False → 记录 exception → 升级 operator
   │
   ├─ approval_callback 返回 False → 抛 ApprovalRequiredError → 触发 Reflect（I3，最多 3 次）
   │     └─ Reflect 后重新 Plan → 重新 approval（最多 3 轮，超过上报 operator）
   │
   └─ approval_callback 返回 True → 继续执行 Act → 写入 YAML / 创建新 ADR
```

#### 10.3.4 operator 审批要素（决策依据）

operator 在审批时**必须**核对以下要素（任一不满足即拒绝）：

| # | 审批要素 | 来源 |
|---|---------|------|
| **A1** | plan.expected_effect 与 VISION.md §7 一致 | VISION.md |
| **A2** | plan.risk_assessment 已识别所有受影响模块 | plan 字段 |
| **A3** | plan.steps 不修改 13 份核心 ADR / VISION / rules | Scope Guard 前置 |
| **A4** | plan.steps 不跨 *Forge 项目复制配置（铁律 6） | Scope Guard 前置 |
| **A5** | 已有对应 ADR 草稿（创建新 ADR 场景） | plan.context |
| **A6** | LLM 已生成方案影响评估（Plan 阶段产物） | plan.context.llm_review |

### 10.4 五闭环协同监督（operator 监督信号）

五闭环通过 `cross-loop context` 协同（§9.4），operator 在每个闭环 Verify 完成后收到信号：

```
doc（wenxin）  ──┐
                 │
code（sherlock）─┼─→ review（vangogh） ──→ test（davinci） ──→ framework（luban, I8）
                 │
   changed_files │   review_result      test_result        new ADR / config
                 │
                 ▼
         ┌───────────────────────────────────────┐
         │  Eval Ledger（F040）                  │
         │  - trace 信号：延迟 / 重试 / 通过率   │
         │  - 用户信号：operator 干预频率        │
         │  - 探针信号：KnowledgeObject 复用次数 │
         └───────────────────────────────────────┘
```

**operator 监督仪表盘**（每闭环显示字段）：

| 闭环 | 关键监督字段 | 异常阈值 |
|------|------------|---------|
| doc | changed_files / verify.passed / distill_count | 连续 3 次失败 |
| code | changed_files / pytest_passed / coverage | 覆盖率 < 0.8 |
| review | p0_count / p1_count / push_back_count | P0 > 0 |
| test | new_tests / pytest_passed / coverage_delta | 测试通过率 < 100% |
| framework | approval_decision / new_adr_id / affected_modules | approval 被拒 |

### 10.5 异常处理与 Magic Words 逃生舱

#### 10.5.1 闭环级异常处理

| 异常 | 触发条件 | operator 动作 |
|------|---------|--------------|
| `AwakeningStageBlockedError` | forgekin 觉醒阶低于 min | 拒绝晋升申请，等待经验沉淀 |
| `ScopeGuardBlockedError` | 修改受保护路径 | 检查 forgekin 是否偏离 VISION，必要时回滚 |
| `ApprovalRequiredError` | Framework 未获批准 | 审阅 plan，决定 approve/reject/修改后重提 |
| `LLMReviewFailedError` | T7 LLM 审核未通过 | 审阅 LLM 审核报告，决定退回 Reflect 或人工修订 |
| `MaxReflectRetriesExceeded` | Reflect 3 次仍失败 | 接管任务，人工分析根因（归因到七类矩阵） |

#### 10.5.2 Magic Words 逃生舱（A011）

operator 任何时候可喊出 Magic Words 强制中断 SelfDev：

| Magic Word | 效果 | 适用场景 |
|-----------|------|---------|
| **停止** | 立即中断当前闭环，进入 idle | 发现 forgekin 偏离 VISION |
| **回滚** | git revert 最近一次 SelfDev 产物 | 发现产物破坏了核心模块 |
| **降阶** | forgekin 觉醒阶 -1（如 E4 → E3） | 多次 Reflect 失败表明能力不足 |
| **休眠** | forgekin 进入休眠态（不响应触发） | 需要长期停用某 forgekin |

Magic Words 触发后**必须**记录到 `harness-feedback/magic-words/` 并归因到七类矩阵（F020）。

### 10.6 operator 工作流典型场景

#### 场景 1：日常文档维护（E3，无需 approval）

```
1. 文心（wenxin, E3）扫描发现 F046 文档过期
2. 文心自主执行 doc 闭环：Discover → Plan → Act → Verify → Persist
3. Verify 阶段 LLM 审核通过（T7）→ 落盘
4. operator 仪表盘收到 trace 信号（changed_files=["F046-xxx.md"]）
5. operator 不介入，仅归档 trace 信号到 Eval Ledger
```

#### 场景 2：bug 修复全链路（E4，无需 approval）

```
1. 夏洛克（sherlock, E4）从 pytest 失败发现 bug
2. 夏洛克执行 code 闭环：Discover → Plan → Act → Verify
3. Act 写入 .py 修改，Verify 运行 pytest 通过
4. 自动触发梵高（vangogh, E3）review 闭环：跨厂商审查
5. review 通过后自动触发达芬奇（davinci, E3）test 闭环：补测试
6. operator 仪表盘收到三闭环协同信号，全程不介入
```

#### 场景 3：架构调整（E5，强制 approval）

```
1. 鲁班（luban, E5）检测到配置不一致
2. 鲁班执行 framework 闭环：Discover → Plan
3. Plan 阶段生成方案，requires_approval=True
4. Act 前调用 approval_callback → IM 推送给 operator
5. operator 审阅 A1-A6 六要素
   ├─ approve → 鲁班执行 Act → 创建新 ADR-014
   └─ reject  → 鲁班触发 Reflect（I3，最多 3 次）
6. 完成后 operator 仪表盘显示 new_adr_id / affected_modules
```

### 10.7 operator 接入清单（生产部署）

部署 SelfDev 五闭环到生产环境时，operator 必须：

- [ ] **C1**：配置 5 个 forgekin YAML（wenxin/sherlock/luban/vangogh/davinci）
- [ ] **C2**：注入 TraeLLMClient 实例（F045 桥接已就绪）
- [ ] **C3**：注入 `approval_callback` 到 luban config（I8 不变量）
- [ ] **C4**：注册 5 个 SelfDev 闭环到 ForgeMindEngine（DI，红线 12）
- [ ] **C5**：配置 Eval Ledger 三方信号采集（F040）
- [ ] **C6**：开启 Magic Words 监听通道（IM / CLI / Web UI）
- [ ] **C7**：配置审计日志落盘到 `harness-feedback/self-dev/`
- [ ] **C8**：weekly review Eval Ledger 信号，归因失败到七类矩阵

### 10.8 监督边界（operator 不应做的事）

为避免破坏 SelfDev 自治能力，operator **不应**：

- ❌ 直接修改 forgekin YAML 配置（应通过 framework 闭环 + approval 流程）
- ❌ 跳过 approval_callback 直接修改 ADR / VISION / rules
- ❌ 替 forgekin 写代码 / 写文档 / 写测试（破坏"可进化智能体主导自主开发"愿景）
- ❌ 关闭 Scope Guard / T7 LLM 审核 / Eval Ledger 信号采集
- ❌ 在非紧急场景下使用 Magic Words（应让 forgekin 自我纠错）

> **唯一例外**：forgekin 触发不可逆破坏性变更（如删除核心模块）时，operator 必须立即 Magic Words 介入 + 回滚（§10.5.2）。

