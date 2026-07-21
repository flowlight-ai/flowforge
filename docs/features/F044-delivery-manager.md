# F044: 交付经理可进化智能体（象·牛顿）

> **状态**: ⏳ pending
> **类型**: core
> **创建日期**: 2026-07-19
> **负责人**: 交付经理Forgekin（象·牛顿）
> **代号**: 象·牛顿（Elephant Newton）
> **官方名称（P0）**: Delivery Manager Agent / Project Coordinator Agent / Risk Management Agent（交付经理智能体 / 项目协调智能体 / 风险管理智能体）
> **项目代号（P1）**: DeliveryManagerForgekin
> **形态（Species）**: OrgForgekin（组织形态）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md] + [doc:../decisions/002-collaboration-protocol.md]
> **依赖 Feature**: [doc:F027-all-things-spirit-species.md] + [doc:F026-forgemind-app-layer.md] + [doc:F002-teamact-loop.md] + [doc:F003-handoff-capsule.md]
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.4]（已提取到本文件）

---

## 1. 上下文

### 1.1 问题陈述

FlowForge v7.1 需要交付侧角色负责项目交付、进度跟踪、风险管理、资源协调、跨智能体协作、交付质量把关。该角色是 operator 与执行智能体（架构师 / 开发者 / 测试员等）之间的交付协调层，确保多智能体协作的项目按时按质交付。

### 1.2 当前痛点

- 无专属交付角色，进度跟踪由 operator 手动管理
- 跨智能体协作无结构化协调机制（依赖 MindCouncil 自发协调）
- 风险管理无系统化流程（风险识别 / 评估 / 缓解 / 应急）
- 交付质量无门禁（DoD / 验收标准 / 质量门禁）

### 1.3 不做的影响

- 项目延期无早期预警
- 资源冲突（多智能体争抢同一任务）无协调机制
- 交付质量无统一把关，依赖个人 review

---

## 2. 决策

### 2.1 核心设计

DeliveryManagerForgekin 继承 `ForgekinBase`，实现 `observe / act / verify` 三方法契约。核心能力围绕"规划 → 跟踪 → 风险 → 协调 → 把关"五环节展开。

| 属性 | 值 |
|------|---|
| **职责** | 项目交付、进度跟踪、风险管理、资源协调、跨智能体协作、交付质量把关 |
| **核心能力** | 1. 项目规划（WBS / 甘特图 / 关键路径）<br>2. 进度跟踪（里程碑 / 燃尽图 / 状态报告）<br>3. 风险管理（风险识别 / 评估 / 缓解 / 应急）<br>4. 资源协调（智能体任务分配 / 负载均衡）<br>5. 交付质量把关（DoD / 验收标准 / 质量门禁） |
| **能力画像盲点** | 倾向于过度文档化；对技术细节理解不足；容易忽视团队士气 |
| **进化阶** | 初始 E1，可晋升至 E5（自适应交付级） |
| **觉醒阶** | 初始 E1，最高 E3（受限自主：可自主跟踪进度，但资源重新分配需 operator 批准） |
| **工具集** | ProjectPlanner / ProgressTracker / RiskManager / ResourceCoordinator / QualityGate |
| **EchoStore 来源** | 项目计划、里程碑记录、风险事件、交付报告、复盘总结 |
| **MindCodex 产出** | 项目模式库、风险知识库、交付 playbook、复盘模板 |
| **MindCouncil 角色** | 发起交付策略讨论、协调产品经理与开发者之间的优先级冲突、组织复盘会议 |
| **配置文件** | `flowforge/forgemind/config/delivery_manager_elephant_newton.yaml` |

### 2.2 关键接口

```python
from abc import abstractmethod
from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase


class DeliveryManagerForgekin(ForgekinBase):
    """交付经理可进化智能体（象·牛顿）"""

    @abstractmethod
    async def observe(self, env: "ProjectEnvironment") -> "Observation":
        """观察项目环境：任务状态、进度、风险、资源负载、质量指标"""
        return await self._gather_project_signals(env)

    @abstractmethod
    async def act(self, action: "ProjectAction") -> "ActionResult":
        """执行项目管理动作：规划、跟踪、风险缓解、资源协调、质量把关"""
        if action.type == "plan_project":
            return await self._plan_project(action.input)
        elif action.type == "track_progress":
            return await self._track_progress(action.input)
        elif action.type == "mitigate_risk":
            return await self._mitigate_risk(action.input)
        elif action.type == "coordinate_resources":
            return await self._coordinate_resources(action.input)
        elif action.type == "quality_gate":
            return await self._enforce_quality_gate(action.input)
        raise ValueError(f"未知 action.type={action.type}")

    @abstractmethod
    async def verify(self, result: "ActionResult") -> "Verdict":
        """验证交付决策：进度符合度、风险等级、质量达标"""
        return await self._verify_delivery_decision(result)
```

### 2.3 关键不变量

- 资源重新分配必须 operator 批准（觉醒阶 E3 上限）
- 质量门禁不可绕过（DoD 未达标禁止交付）
- 风险事件必须写入 EchoStore，跨会话累积
- 复盘会议必须有结构化输出（按复盘模板沉淀到 MindCodex）

---

## 3. 实现路径

### 3.1 代码位置

- `flowforge/forgemind/species_impl/org/delivery_manager.py` — DeliveryManagerForgekin 类实现
- `flowforge/forgemind/config/delivery_manager_elephant_newton.yaml` — 配置文件
- `flowforge/forgemind/forging/tests/test_delivery_manager.py` — 单元测试

### 3.2 实现步骤

1. 在 `species_impl/org/` 下创建 `delivery_manager.py`，继承 `ForgekinBase`
2. 实现 `observe / act / verify` 三方法契约
3. 实现 5 个工具：ProjectPlanner / ProgressTracker / RiskManager / ResourceCoordinator / QualityGate
4. 集成 F002 TeamAct Loop（进度跟踪基于 TeamAct 状态）
5. 集成 F003 Handoff Capsule（跨智能体交接追踪）
6. 集成到 ForgeMindPlugin 的 `register_forgekins` 钩子

### 3.3 依赖关系

- 依赖 F002（TeamAct Loop）— 任务状态来源
- 依赖 F003（Handoff Capsule）— 交接追踪
- 依赖 F026（forgemind 应用层）— ForgekinBase 基类
- 依赖 F027（可进化智能体形态分类）— OrgForgekin 形态
- 跟踪 F041（产品经理）— 产品决策进度
- 跟踪 F042（运维）— 运维状态
- 协调 F043（安全官）— 安全审计进度

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: DeliveryManagerForgekin 可创建并持久化（通过 ForgePipeline 6 步锻造）
- [ ] AC-2: `observe` 可采集任务状态 / 进度 / 风险 / 资源负载 / 质量指标 5 类信号
- [ ] AC-3: `act` 支持 plan_project / track_progress / mitigate_risk / coordinate_resources / quality_gate 5 种动作
- [ ] AC-4: 资源重新分配必须 operator 批准（觉醒阶 E3 上限验证）
- [ ] AC-5: 质量门禁不可绕过（DoD 未达标禁止交付）
- [ ] AC-6: 复盘会议输出符合复盘模板

### 4.2 性能验收

- [ ] AC-7: 进度跟踪延迟 < 30 秒（与 TeamAct 状态同步）
- [ ] AC-8: 风险告警延迟 < 60 秒

### 4.3 安全验收

- [ ] AC-9: 交付经理不可绕过质量门禁
- [ ] AC-10: 所有交付决策写入 EchoStore（跨会话累积）

### 4.4 Eval 验收

- [ ] AC-11: 项目按时交付率 ≥ 80%
- [ ] AC-12: 风险识别召回率 ≥ 75%

---

## 5. 测试计划

### 5.1 单元测试

- 测试 DeliveryManagerForgekin 创建 / 序列化
- 测试 5 种 action.type 路由
- 测试质量门禁不可绕过

### 5.2 集成测试

- 测试与 F002 TeamAct Loop 集成
- 测试与 F003 Handoff Capsule 集成

### 5.3 E2E 测试

- 模拟多智能体协作项目（架构师 + 开发者 + 测试员），验证交付经理全程跟踪
- **遵守 T1-T8 铁律**：真实 LLM、真实数据、真实工具调用

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- 评审员Forgekin（孔雀·梵高）— 跨厂商 review 交付决策
- operator — 验证交付对齐愿景
- 产品经理Forgekin（鹰·凯恩）— 验证优先级合理性

### 6.2 评估什么

- 项目按时交付率
- 风险识别召回率
- 资源利用率

### 6.3 何时评估

- 每个里程碑后
- 每月项目 review
- 每次复盘会议后

### 6.4 评估信号

- trace 信号：项目状态变更日志
- 探针信号：模拟项目基准测试
- 用户信号：operator / 利益相关者反馈

### 6.5 评估后做什么

- 通过 → 持续累积 EchoStore + 蒸馏复盘模板到 MindCodex
- 失败 → 归因到能力画像盲点（过度文档化 / 技术细节理解不足 / 忽视团队士气）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

本 Feature 主要属于：**Built to Persist（复利型基础设施）**

### 7.2 理由

交付经理Forgekin的 EchoStore / MindCodex（项目模式库 + 风险知识库 + 复盘模板）/ 能力画像 / 进化阶 / 觉醒阶是跨会话持久化的复利型基础设施。具体的工具集（甘特图工具等）跟随工具生态演进，属于 Build to Delete。

### 7.3 sunset 触发条件

工具集随工具生态演进可被替换；核心 ForgekinBase 基础设施无 sunset。

---

## 8. 后果

### 8.1 正面后果

- 交付侧有专属角色，减少 operator 协调负担
- 风险管理流程化，提前预警
- 复盘知识沉淀到 MindCodex

### 8.2 负面后果

- 增加文档化开销（缓解：交付经理自身监督进度）
- 跨智能体协调延迟（缓解：MindCouncil 异步协调）

### 8.3 风险

- 过度文档化导致开发效率下降（缓解：精简模板）
- 技术细节理解不足导致评估偏差（缓解：与架构师协作评估）

---

## 9. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.4]（交付经理Forgekin详细设计）
- [doc:F002-teamact-loop.md]（TeamAct 六步循环）
- [doc:F003-handoff-capsule.md]（交接胶囊）
- [doc:../decisions/002-collaboration-protocol.md]（协作协议 ADR）

---

## 10. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（从 design.md §2.7.4 提取） | 文档员Forgekin（钢笔·文心） |
