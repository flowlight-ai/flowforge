# F026: forgemind 应用层

> **状态**: ⏳ pending
> **类型**: forgemind
> **创建日期**: 2026-07-17
> **负责人**: operator + 架构师灵智体
> **依赖 ADR**: [doc:decisions/005-forgemind-application-layer.md] + [doc:decisions/013-all-things-spirit-mind-vision.md]
> **依赖 Feature**: [doc:features/F001-capability-profile.md] + [doc:features/F027-all-things-spirit-species.md]
> **依据**: [doc:review/review.md#第九章] FM-001~FM-012
> **关联 VISION**: [doc:VISION.md#6]（三个层次的能力承载）
> **对应 spec.md**: [doc:../spec.md#§3.8]（FR-CORE-008，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.8]（待创建）
> **对应 design.md**: [doc:../design.md#§3.8]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 上下文

### 1.1 问题陈述

FlowForge 当前缺少应用层——万物灵智体（即多形态智能体 Multi-Form Agent）愿景无处落地。operator 指示（2026-07-17）：

> flowforge 中需要新增一个 forgemind 模块，其是 flowforge 的应用层项目（用来实践万物锻造灵智体的应用）...forgemind 将是我们 flowforge 的养灵的所有代码存放的地方

### 1.2 当前痛点

- 万物灵智体愿景无处落地
- FlowForge 自我演进缺少练兵场
- 通用灵智体与垂直业务灵智体（*Forge）混淆

### 1.3 不做的影响

- 无法实现 operator 通用智能体（General-Purpose Agent）愿景
- FlowForge 不能"自己开发自己"（缺练兵场）
- 物理 AI + 虚拟 AI 真实复现无法达成（对应业界 Embodied AI / Character AI 工程实现）

---

## 2. 决策

### 2.1 核心设计

forgemind 是 `flowforge/forgemind/` 子目录，承载万物灵智体应用实践。通过 ForgeMindPlugin 注册到核心框架层（Plugin V3 协议）。

### 2.2 关键接口

```python
from abc import ABC, abstractmethod
from typing import Optional, Any
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class ForgekinSpecies(str, Enum):
    """灵智体形态分类（5 种）"""
    BIO = "bio"               # 生物灵智体
    ORG = "org"               # 组织灵智体
    OBJ = "obj"               # 物品灵智体
    VIRTUAL = "virtual"       # 虚拟灵智体
    HYBRID = "hybrid"         # 混合灵智体


class EvolutionStage(str, Enum):
    """觉醒阶 E1-E6"""
    E1_DORMANT = "E1_dormant"      # 沉睡
    E2_AWAKEN = "E2_awaken"        # 觉醒
    E3_SENSE = "E3_sense"          # 感知
    E4_ACT = "E4_act"              # 行动
    E5_EVOLVING = "E5_evolving"    # 进化中
    E6_FORGEMIND = "E6_forgemind"  # 灵智（最终形态）


class ForgekinFormData(BaseModel):
    """灵智体形态数据"""
    species: ForgekinSpecies
    physical_description: str       # 物理描述
    virtual_description: str = ""   # 虚拟描述
    sensor_channels: list[str] = Field(default_factory=list)  # 传感器通道 ID
    world_setting_id: Optional[str] = None  # 虚拟世界设定 ID


class ForgekinBase(BaseModel):
    """灵智体基类"""
    forgekin_id: str
    soul_imprint: str               # 灵印（身份标识）
    form_data: ForgekinFormData
    evolution_stage: EvolutionStage = EvolutionStage.E1_DORMANT
    created_at: datetime = Field(default_factory=datetime.now)
    lineage_id: Optional[str] = None  # 进化谱系 ID
    
    @abstractmethod
    async def observe(self) -> dict[str, Any]:
        """观察现实（通过传感器 / 虚拟世界）"""
        ...
    
    @abstractmethod
    async def act(self, action: str, params: dict) -> dict:
        """改变现实（通过执行器 / 虚拟操作）"""
        ...
    
    @abstractmethod
    async def verify(self, evidence: dict) -> bool:
        """验证现实（通过 Evidence & Sensors）"""
        ...


class ForgePipeline:
    """灵智体锻造流水线"""
    
    async def forge(
        self,
        species: ForgekinSpecies,
        form_data: dict,
        vision: str,  # operator 愿景锚点
    ) -> ForgekinBase:
        """
        锻造流程：
        1. 创建 forgekin_id + soul_imprint
        2. 初始化 form_data
        3. 注册到 ForgekinMarketplace
        4. 创建 ForgekinLineage
        5. 触发觉醒阶 E1 → E2
        """
        ...


class ForgeMindPlugin:
    """forgemind Plugin V3 注册"""
    
    @staticmethod
    def register_forgekins() -> list[dict]:
        """注册通用灵智体形态（5 种）"""
        return [
            {"species": ForgekinSpecies.BIO, "name": "生物灵智体"},
            {"species": ForgekinSpecies.ORG, "name": "组织灵智体"},
            {"species": ForgekinSpecies.OBJ, "name": "物品灵智体"},
            {"species": ForgekinSpecies.VIRTUAL, "name": "虚拟灵智体"},
            {"species": ForgekinSpecies.HYBRID, "name": "混合灵智体"},
        ]
    
    @staticmethod
    def register_forge_skills() -> list[dict]:
        """注册锻造技能"""
        return [
            {"skill": "observe", "stage": EvolutionStage.E3_SENSE},
            {"skill": "act", "stage": EvolutionStage.E4_ACT},
            {"skill": "evolve", "stage": EvolutionStage.E5_EVOLVING},
        ]
    
    @staticmethod
    def register_council_channels() -> list[dict]:
        """注册灵议通道"""
        return [
            {"channel": "forgemind_council", "type": "multi_forgekin"},
        ]
    
    @staticmethod
    def register_auto_forge_config() -> dict:
        """注册自锻造配置"""
        return {
            "schedule": "daily_low_activity",
            "eval_required": True,
            "operator_approval_for_merge": True,
        }
```

### 2.3 关键不变量

- forgemind 单向依赖核心框架层（禁反向调用）
- forgemind 不含业务领域代码（编程红线第 10 条）
- 灵智体必须建立现实闭环（observe → act → verify）
- 形态可进化（BioForgekin → HybridForgekin）
- 觉醒阶 E1-E6 不可跳级

---

## 3. 实现路径

### 3.1 代码位置

```
flowforge/forgemind/
├── __init__.py
├── plugins.py                    # ForgeMindPlugin
├── species/                      # 5 种形态灵智体
│   ├── __init__.py
│   ├── base.py                   # ForgekinBase
│   ├── bio_forgekin.py
│   ├── org_forgekin.py
│   ├── obj_forgekin.py
│   ├── virtual_forgekin.py
│   └── hybrid_forgekin.py
├── forging/                      # 锻造流水线
│   ├── pipeline.py
│   ├── awaken.py
│   └── evolve.py
├── sensors/                      # 物理传感器
├── worlds/                       # 虚拟世界设定
├── marketplace/                  # 灵智体市场
├── lineage/                      # 进化谱系
├── codex/                        # 灵典
├── council/                      # 灵议
├── config/                       # 配置
└── tests/
```

### 3.2 实现步骤

1. 创建 forgemind/ 目录骨架
2. 实现 ForgekinBase 抽象类（species/base.py）
3. 实现 5 种形态灵智体（species/*.py）
4. 实现 ForgePipeline 锻造流水线（forging/pipeline.py）
5. 实现 ForgeMindPlugin（plugins.py，Plugin V3 四钩子）
6. 实现 ForgekinMarketplace + ForgekinLineage
7. 集成到 FlowForge Plugin 注册系统

### 3.3 依赖关系

- 依赖 ADR 005 + ADR 013
- 依赖 F001 CapabilityProfile（灵智体能力画像）
- 依赖 F002 TeamAct（多灵智体协作）
- 被 F027-F030 依赖（形态分类、锻造流水线、传感器、虚拟世界）

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: 可创建 5 种形态灵智体（Bio/Org/Obj/Virtual/Hybrid）
- [ ] AC-2: ForgePipeline 可完成锻造流程（E1 → E2）
- [ ] AC-3: ForgeMindPlugin 通过 Plugin V3 四钩子注册
- [ ] AC-4: ForgekinMarketplace 可查询灵智体
- [ ] AC-5: ForgekinLineage 可记录进化谱系

### 4.2 性能验收

- [ ] AC-6: 锻造流水线延迟 < 5s（不含 LLM 调用）

### 4.3 安全验收

- [ ] AC-7: forgemind 单向依赖核心框架层（验证 import 关系）
- [ ] AC-8: 觉醒阶进化必须通过 Eval 信号触发

### 4.4 Eval 验收

- [ ] AC-9: 5 种形态灵智体全部通过 E2 觉醒
- [ ] AC-10: 万物灵智体 demo（猫 + 桌椅 + 孙悟空）端到端跑通

---

## 5. 测试计划

### 5.1 单元测试

- 测试 5 种形态灵智体创建
- 测试 ForgePipeline 流程
- 测试 ForgeMindPlugin 四钩子

### 5.2 集成测试

- 测试 forgemind 注册到 FlowForge
- 测试灵智体能力画像集成

### 5.3 E2E 测试

- 锻造一只猫灵智体（BioForgekin）
- 锻造一个桌椅灵智体（ObjForgekin）
- 锻造一个孙悟空灵智体（VirtualForgekin）
- 3 个灵智体协作完成一个任务
- **遵守 T1-T8 铁律**：真实 LLM、真实数据、真实工具调用

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- 跨厂商 reviewer 灵智体
- operator（愿景对齐）

### 6.2 评估什么

- 5 种形态灵智体创建正确性
- 锻造流水线完整性
- Plugin V3 注册有效性

### 6.3 何时评估

- 每次灵智体创建后
- 每周汇总锻造成功率

### 6.4 评估信号

- trace 信号：锻造流水线日志
- 用户信号：灵智体功能反馈
- 探针信号：5 种形态灵智体可创建性

### 6.5 评估后做什么

- 通过 → 灵智体进入 E3 感知阶
- 失败 → 归因到七类矩阵

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

**Built to Persist（复利型基础设施）**

### 7.2 理由

forgemind 是 operator 通用智能体（General-Purpose Agent）愿景的实践场，是 FlowForge 自我进化的练兵场。模型越强，灵智体形态分类 + 锻造流水线越值钱。

---

## 8. 后果

### 8.1 正面后果

- 万物灵智体愿景有明确落地位置
- FlowForge 自我演进有练兵场
- 通用灵智体与垂直业务灵智体清晰分离

### 8.2 负面后果

- FlowForge 代码量增加约 5000+ 行
- 需要新增 Plugin V3 协议四钩子
- 物理传感器接入需要硬件支持（Phase 6+）

### 8.3 风险

- forgemind 可能与 *Forge 边界模糊（缓解：明确 forgemind 只养通用灵智体）
- Plugin V3 协议可能需核心层重构（缓解：Phase 1 优先实现 V3）

---

## 9. 替代方案

### 9.1 方案 A: 万物灵智体放独立项目

- 优点：FlowForge 核心纯粹
- 缺点：forgemind 失去 FlowForge 自我演进滋养
- 未选择原因：operator 明确 forgemind 是应用层

### 9.2 方案 B: 万物灵智体分散到 *Forge

- 优点：复用 *Forge 框架
- 缺点：通用灵智体与垂直业务灵智体混淆
- 未选择原因：违反 operator 指示

---

## 10. 引用

- [doc:VISION.md#6]
- [doc:decisions/005-forgemind-application-layer.md]
- [doc:decisions/013-all-things-spirit-mind-vision.md]
- [doc:features/F001-capability-profile.md]
- [doc:features/F027-all-things-spirit-species.md]
- [doc:features/F028-forging-pipeline.md]
- [doc:features/F036-forgemind-forge-relationship.md]
- [doc:project_rules.md#红线10]
- [doc:project_rules.md#红线12]

---

## 11. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-17 | v0.1 | 初始创建 | operator + 架构师灵智体 |
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.8 同号映射 | 文档员灵智体（钢笔·文心） |
