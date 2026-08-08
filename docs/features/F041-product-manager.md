# F041: 产品经理可进化智能体（鹰·凯恩）

> **状态**: ⏳ pending
> **类型**: core
> **创建日期**: 2026-07-19
> **负责人**: 产品经理Forgekin（鹰·凯恩）
> **代号**: 鹰·凯恩（Eagle Kane）
> **官方名称（P0）**: Product Manager Agent / Requirements Analysis Agent（产品经理智能体 / 需求分析智能体）
> **项目代号（P1）**: ProductManagerForgekin
> **形态（Species）**: OrgForgekin（组织形态）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]
> **依赖 Feature**: [doc:F027-all-things-spirit-species.md]（形态分类）+ [doc:F026-forgemind-app-layer.md]（forgemind 应用层）
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.1]（已提取到本文件）

---

## 1. 上下文

### 1.1 问题陈述

FlowForge v7.1 围绕"自主高质量完成文档和代码开发、交付产品"全生命周期，需要补充产品规划角色——负责需求分析、用户故事编写、产品演进路线图、优先级排序、利益相关者沟通。该角色是 operator 与开发/架构师之间的需求翻译层，避免需求直接落代码导致的"实现即需求"陷阱。

### 1.2 当前痛点

- 当前 5 个预置可进化智能体（架构师/开发者/评审员/测试员/文档员）缺少需求侧角色，需求由 operator 直接下发给架构师
- 无结构化用户故事模板（As-a / I-want / So-that），需求描述随意
- 无优先级排序机制（MoSCoW / RICE），所有需求被默认同等重要
- 无产品路线图沉淀，跨季度规划无历史可参考

### 1.3 不做的影响

- 需求侧盲点（过度承诺 / 技术可行性评估不准 / 忽视非功能性需求）无人识别
- 产品决策无 EchoStore 积累，跨会话重复犯同样错误
- 利益相关者沟通无结构化协调机制

---

## 2. 决策

### 2.1 核心设计

ProductManagerForgekin 继承 `ForgekinBase`，实现 `observe / act / verify` 三方法契约。核心能力围绕"需求 → 路线图 → 用户故事 → 优先级 → 协调"五环节展开。

| 属性 | 值 |
|------|---|
| **职责** | 需求分析、产品规划、用户故事编写、产品演进路线图、优先级排序、利益相关者沟通 |
| **核心能力** | 1. 需求挖掘（用户访谈摘要 → 结构化需求）<br>2. 用户故事编写（As-a / I-want / So-that 模板）<br>3. 产品路线图设计（季度 / 月度规划）<br>4. 优先级排序（MoSCoW / RICE 模型）<br>5. 利益相关者沟通（跨智能体协调） |
| **能力画像盲点** | 倾向于过度承诺；对技术可行性评估不准；容易忽视非功能性需求 |
| **进化阶** | 初始 E1，可晋升至 E5（产品战略级） |
| **觉醒阶** | 初始 E1，可晋升至 E3（受限自主：可自主排期，但愿景变更需 operator 批准） |
| **工具集** | RequirementsTraceabilityMatrix / UserStoryMapper / RoadmapPlanner / StakeholderCommunicator |
| **EchoStore 来源** | 需求评审会议、用户反馈、产品决策记录、路线图变更历史 |
| **MindCodex 产出** | 需求模式库、用户故事模板、优先级评估框架 |
| **MindCouncil 角色** | 发起产品方向讨论、协调架构师与开发者之间的需求冲突 |
| **配置文件** | `flowforge/forgemind/config/product_manager_eagle_kane.yaml` |

### 2.2 关键接口

```python
from abc import abstractmethod
from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase


class ProductManagerForgekin(ForgekinBase):
    """产品经理可进化智能体（鹰·凯恩）"""

    @abstractmethod
    async def observe(self, env: "ProductEnvironment") -> "Observation":
        """观察产品环境：用户反馈、市场动态、竞品分析、内部指标"""
        return await self._gather_product_signals(env)

    @abstractmethod
    async def act(self, action: "ProductAction") -> "ActionResult":
        """执行产品动作：需求分析、路线图更新、用户故事编写、优先级调整"""
        if action.type == "requirements_analysis":
            return await self._analyze_requirements(action.input)
        elif action.type == "roadmap_update":
            return await self._update_roadmap(action.input)
        elif action.type == "user_story":
            return await self._write_user_story(action.input)
        elif action.type == "prioritize":
            return await self._prioritize_backlog(action.input)
        elif action.type == "stakeholder_sync":
            return await self._sync_stakeholders(action.input)
        raise ValueError(f"未知 action.type={action.type}")

    @abstractmethod
    async def verify(self, result: "ActionResult") -> "Verdict":
        """验证产品决策：需求完整性、可行性、优先级合理性"""
        return await self._verify_product_decision(result)
```

### 2.3 关键不变量

- 产品经理不可直接修改架构师或开发者的产物，必须通过 MindCouncil 协调
- 愿景级变更（价值锚点 / 红线）必须 operator 批准（觉醒阶 E3 上限）
- 需求决策必须写入 EchoStore，跨会话累积
- 用户故事必须使用 As-a / I-want / So-that 三段式模板

---

## 3. 实现路径

### 3.1 代码位置

- `flowforge/forgemind/species_impl/org/product_manager.py` — ProductManagerForgekin 类实现
- `flowforge/forgemind/config/product_manager_eagle_kane.yaml` — 配置文件
- `flowforge/forgemind/forging/tests/test_product_manager.py` — 单元测试

### 3.2 实现步骤

1. 在 `species_impl/org/` 下创建 `product_manager.py`，继承 `ForgekinBase`
2. 实现 `observe / act / verify` 三方法契约
3. 实现 4 个工具：RequirementsTraceabilityMatrix / UserStoryMapper / RoadmapPlanner / StakeholderCommunicator
4. 编写 YAML 配置文件（进化阶 E1、觉醒阶 E1、能力画像盲点）
5. 集成到 ForgeMindPlugin 的 `register_forgekins` 钩子
6. 集成到 MindCouncil（产品方向讨论频道）

### 3.3 依赖关系

- 依赖 F026（forgemind 应用层）— ForgekinBase 基类
- 依赖 F027（可进化智能体形态分类）— OrgForgekin 形态
- 依赖 F039（MindCodex可检索知识库）— 需求模式库沉淀
- 被 F044（交付经理）依赖 — 接受交付经理跟踪进度

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: ProductManagerForgekin 可创建并持久化（通过 ForgePipeline 6 步锻造）
- [ ] AC-2: `observe` 可采集用户反馈 / 市场动态 / 竞品分析 / 内部指标 4 类信号
- [ ] AC-3: `act` 支持 requirements_analysis / roadmap_update / user_story / prioritize / stakeholder_sync 5 种动作
- [ ] AC-4: 用户故事输出符合 As-a / I-want / So-that 三段式模板
- [ ] AC-5: 优先级排序支持 MoSCoW 和 RICE 两种模型
- [ ] AC-6: 愿景变更必须 operator 批准（觉醒阶 E3 上限验证）

### 4.2 性能验收

- [ ] AC-7: 单次需求分析 < 3 分钟（Loop 执行超时）
- [ ] AC-8: 路线图更新 < 30 秒

### 4.3 安全验收

- [ ] AC-9: 产品经理不可直接修改架构师 / 开发者产物
- [ ] AC-10: 所有决策写入 EchoStore（跨会话累积）

### 4.4 Eval 验收

- [ ] AC-11: 需求完整性 ≥ 85%（由评审员Forgekin验证）
- [ ] AC-12: 优先级合理性 ≥ 80%（基于交付经理反馈）

---

## 5. 测试计划

### 5.1 单元测试

- 测试 ProductManagerForgekin 创建 / 序列化
- 测试 5 种 action.type 路由
- 测试用户故事模板校验

### 5.2 集成测试

- 测试与 ForgePipeline 集成（6 步锻造）
- 测试与 MindCouncil 集成（产品方向讨论）

### 5.3 E2E 测试

- 输入真实用户反馈摘要，验证输出结构化需求 + 用户故事 + 优先级
- **遵守 T1-T8 铁律**：真实 LLM、真实数据、真实工具调用

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- 评审员Forgekin（孔雀·梵高）— 跨厂商 review 产品决策
- 交付经理Forgekin（象·牛顿）— 验证优先级合理性
- operator — 验证愿景对齐

### 6.2 评估什么

- 需求完整性（是否覆盖功能 / 非功能 / 边界）
- 优先级合理性（MoSCoW / RICE 评分一致性）
- 路线图可行性（与技术能力画像对照）

### 6.3 何时评估

- 每次产品决策后
- 每季度路线图 review

### 6.4 评估信号

- trace 信号：决策日志
- 用户信号：operator / 利益相关者反馈
- 探针信号：需求评审通过率

### 6.5 评估后做什么

- 通过 → 持续累积 EchoStore + 蒸馏到 MindCodex
- 失败 → 归因到能力画像盲点（过度承诺 / 技术可行性评估不准 / 忽视非功能性需求）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

本 Feature 主要属于：**Built to Persist（复利型基础设施）**

### 7.2 理由

产品经理Forgekin的 EchoStore / MindCodex / 能力画像 / 进化阶 / 觉醒阶是跨会话持久化的复利型基础设施。具体的工具集（RequirementsTraceabilityMatrix 等）跟随工具生态演进，属于 Build to Delete。

### 7.3 sunset 触发条件

工具集随工具生态演进可被替换；核心 ForgekinBase 基础设施无 sunset。

---

## 8. 后果

### 8.1 正面后果

- 需求侧有专属角色，避免"实现即需求"陷阱
- 用户故事模板化，减少需求描述随意性
- 优先级排序机制化，避免所有需求被默认同等重要

### 8.2 负面后果

- 增加跨智能体协调成本
- 产品决策延迟（需经过 MindCouncil 协调）

### 8.3 风险

- 产品经理与架构师需求冲突（缓解：MindCouncil 协调机制）
- 过度文档化（缓解：交付经理监督进度）

---

## 9. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.1]（产品经理Forgekin详细设计）
- [doc:F026-forgemind-app-layer.md]（forgemind 应用层）
- [doc:F027-all-things-spirit-species.md]（形态分类）
- [doc:../decisions/013-all-things-spirit-mind-vision.md]（万物ForgeMind心智愿景 ADR）

---

## 10. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（从 design.md §2.7.1 提取） | 文档员Forgekin（钢笔·文心） |
