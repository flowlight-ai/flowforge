# F042: 运维可进化智能体（蜂鸟·闪电）

> **状态**: ⏳ pending
> **类型**: core
> **创建日期**: 2026-07-19
> **负责人**: 运维Forgekin（蜂鸟·闪电）
> **代号**: 蜂鸟·闪电（Hummingbird Flash）
> **官方名称（P0）**: DevOps Agent / Site Reliability Agent / Operations Automation Agent（运维智能体 / 站点可靠性智能体 / 运维自动化智能体）
> **项目代号（P1）**: DevOpsForgekin
> **形态（Species）**: OrgForgekin（组织形态）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md] + [doc:../decisions/013-all-things-spirit-mind-vision.md]
> **依赖 Feature**: [doc:F027-all-things-spirit-species.md] + [doc:F026-forgemind-app-layer.md] + [doc:F021-side-effect-wal.md] + [doc:F022-tier-1-4-recovery.md]
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.2]（已提取到本文件）

---

## 1. 上下文

### 1.1 问题陈述

FlowForge v7.1 需要运维侧角色负责部署自动化、监控告警、故障排查、灾备恢复、性能优化、容量规划。该角色是开发交付与生产环境之间的运维保障层，确保Forgekin平台本身与 *Forge 业务系统的稳定运行。

### 1.2 当前痛点

- 无专属运维角色，部署 / 监控 / 告警由 operator 手动操作
- 故障自愈能力缺失，依赖人工介入
- 性能 SLO 无持续监控与瓶颈识别
- 容量规划基于经验而非数据

### 1.3 不做的影响

- 部署 / 故障 / 性能问题直接传导到 operator
- 无运维 EchoStore 积累，同类故障重复发生
- 灾备恢复流程无标准化 runbook

---

## 2. 决策

### 2.1 核心设计

DevOpsForgekin 继承 `ForgekinBase`，实现 `observe / act / verify` 三方法契约。核心能力围绕"部署 → 监控 → 自愈 → 调优 → 容量"五环节展开。

| 属性 | 值 |
|------|---|
| **职责** | 部署自动化、监控告警、故障排查、灾备恢复、性能优化、容量规划 |
| **核心能力** | 1. 部署编排（蓝绿 / 金丝雀 / 滚动发布）<br>2. 监控告警（Prometheus / Grafana / AlertManager）<br>3. 故障自愈（自动重启 / 降级 / 切换）<br>4. 性能优化（瓶颈识别 / 资源调优）<br>5. 容量规划（基于历史数据预测） |
| **能力画像盲点** | 倾向于过度保守；对新型故障模式识别慢；容易忽视成本控制 |
| **进化阶** | 初始 E1，可晋升至 E5（自愈级运维） |
| **觉醒阶** | 初始 E1，可晋升至 E4（自进化：可自主优化运维策略，但重大变更需 operator 批准） |
| **工具集** | DeploymentOrchestrator / MonitoringStack / IncidentResponder / PerformanceProfiler / CapacityPlanner |
| **EchoStore 来源** | 部署记录、告警历史、故障处理过程、性能调优记录 |
| **MindCodex 产出** | 故障模式库、运维 runbook、性能调优 playbook |
| **MindCouncil 角色** | 发起运维策略讨论、协调安全官与交付经理之间的资源冲突 |
| **配置文件** | `flowforge/forgemind/config/devops_hummingbird_flash.yaml` |

### 2.2 关键接口

```python
from abc import abstractmethod
from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase


class DevOpsForgekin(ForgekinBase):
    """运维可进化智能体（蜂鸟·闪电）"""

    @abstractmethod
    async def observe(self, env: "OpsEnvironment") -> "Observation":
        """观察运维环境：服务状态、资源使用、告警、日志、指标"""
        return await self._gather_ops_signals(env)

    @abstractmethod
    async def act(self, action: "OpsAction") -> "ActionResult":
        """执行运维动作：部署、扩容、降级、自愈、调优"""
        if action.type == "deploy":
            return await self._deploy_with_canary(action.input)
        elif action.type == "auto_heal":
            return await self._auto_heal(action.input)
        elif action.type == "scale":
            return await self._scale_resources(action.input)
        elif action.type == "degrade":
            return await self._degrade_service(action.input)
        elif action.type == "tune":
            return await self._tune_performance(action.input)
        raise ValueError(f"未知 action.type={action.type}")

    @abstractmethod
    async def verify(self, result: "ActionResult") -> "Verdict":
        """验证运维结果：服务可用性、性能 SLO、资源利用率"""
        return await self._verify_ops_slo(result)
```

### 2.3 关键不变量

- 重大变更（生产环境部署 / 容量缩容）必须 operator 批准（觉醒阶 E4 上限内的限制）
- 自愈动作必须先写 WAL（F021 副作用日志），失败可回滚
- Tier 0 物理副作用（不可逆操作）禁止自愈，必须 operator 介入
- 部署必须支持金丝雀发布（按比例放量）

---

## 3. 实现路径

### 3.1 代码位置

- `flowforge/forgemind/species_impl/org/devops.py` — DevOpsForgekin 类实现
- `flowforge/forgemind/config/devops_hummingbird_flash.yaml` — 配置文件
- `flowforge/forgemind/forging/tests/test_devops.py` — 单元测试

### 3.2 实现步骤

1. 在 `species_impl/org/` 下创建 `devops.py`，继承 `ForgekinBase`
2. 实现 `observe / act / verify` 三方法契约
3. 实现 5 个工具：DeploymentOrchestrator / MonitoringStack / IncidentResponder / PerformanceProfiler / CapacityPlanner
4. 集成 F021 副作用 WAL（自愈动作前先写日志）
5. 集成 F022 Tier 1-4 恢复分级（自愈仅限 Tier 1-2）
6. 集成到 ForgeMindPlugin 的 `register_forgekins` 钩子

### 3.3 依赖关系

- 依赖 F021（副作用日志 WAL）— 自愈动作回滚
- 依赖 F022（Tier 1-4 恢复分级）— 恢复策略
- 依赖 F026（forgemind 应用层）— ForgekinBase 基类
- 依赖 F027（可进化智能体形态分类）— OrgForgekin 形态
- 被 F043（安全官）审计 — 运维部署接受安全审计
- 被 F044（交付经理）跟踪 — 向交付经理报告运维状态

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: DevOpsForgekin 可创建并持久化（通过 ForgePipeline 6 步锻造）
- [ ] AC-2: `observe` 可采集服务状态 / 资源使用 / 告警 / 日志 / 指标 5 类信号
- [ ] AC-3: `act` 支持 deploy / auto_heal / scale / degrade / tune 5 种动作
- [ ] AC-4: 部署支持金丝雀发布（按比例放量）
- [ ] AC-5: 自愈动作先写 WAL，失败可回滚
- [ ] AC-6: Tier 0 物理副作用禁止自愈（必须 operator 介入）
- [ ] AC-7: 重大变更必须 operator 批准（觉醒阶 E4 上限验证）

### 4.2 性能验收

- [ ] AC-8: 监控信号采集延迟 < 30 秒
- [ ] AC-9: 自愈动作响应 < 60 秒
- [ ] AC-10: 部署超时 < 10 分钟

### 4.3 安全验收

- [ ] AC-11: 所有运维操作通过 Repository 层（禁直操作数据库）
- [ ] AC-12: 部署操作接受安全官（F043）审计
- [ ] AC-13: 密钥通过环境变量注入（编程红线第 11 条）

### 4.4 Eval 验收

- [ ] AC-14: 故障自愈成功率 ≥ 80%
- [ ] AC-15: 性能 SLO 达标率 ≥ 95%

---

## 5. 测试计划

### 5.1 单元测试

- 测试 DevOpsForgekin 创建 / 序列化
- 测试 5 种 action.type 路由
- 测试 WAL 写入与回滚

### 5.2 集成测试

- 测试与 ForgePipeline 集成
- 测试与 F021 副作用日志集成

### 5.3 E2E 测试

- 注入故障（服务崩溃 / 资源耗尽），验证自愈流程
- **遵守 T1-T8 铁律**：真实 LLM、真实数据、真实工具调用

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- 安全官Forgekin（狼·阿尔法）— 审计运维安全
- 交付经理Forgekin（象·牛顿）— 验证运维对交付的影响
- operator — 验证运维策略对齐

### 6.2 评估什么

- 故障自愈成功率
- 性能 SLO 达标率
- 容量预测准确率

### 6.3 何时评估

- 每次故障处理后
- 每周 SLO review

### 6.4 评估信号

- trace 信号：运维操作日志
- 探针信号：故障注入测试
- 用户信号：operator 反馈

### 6.5 评估后做什么

- 通过 → 持续累积 EchoStore + 蒸馏 runbook 到 MindCodex
- 失败 → 归因到能力画像盲点（过度保守 / 新型故障识别慢 / 忽视成本控制）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

本 Feature 主要属于：**Built to Persist（复利型基础设施）**

### 7.2 理由

运维Forgekin的 EchoStore / MindCodex（故障模式库 + runbook）/ 能力画像 / 进化阶 / 觉醒阶是跨会话持久化的复利型基础设施。具体的工具集（Prometheus / Grafana 等）跟随工具生态演进，属于 Build to Delete。

### 7.3 sunset 触发条件

工具集随工具生态演进可被替换；核心 ForgekinBase 基础设施无 sunset。

---

## 8. 后果

### 8.1 正面后果

- 运维侧有专属角色，减少 operator 负担
- 故障自愈能力提升 SLO
- 运维知识沉淀到 runbook

### 8.2 负面后果

- 自愈动作有副作用风险（缓解：WAL + Tier 限制）
- 监控告警可能产生噪音（缓解：告警分级 + 智能去重）

### 8.3 风险

- 自愈动作误判导致服务中断（缓解：Tier 0-1 必须人工介入）
- 过度保守导致资源浪费（缓解：成本监控 + Eval 信号反馈）

---

## 9. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.2]（运维Forgekin详细设计）
- [doc:F021-side-effect-wal.md]（副作用日志 WAL）
- [doc:F022-tier-1-4-recovery.md]（Tier 1-4 恢复分级）
- [doc:../decisions/010-distributed-reliability.md]（分布式可靠性 ADR）

---

## 10. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（从 design.md §2.7.2 提取） | 文档员Forgekin（钢笔·文心） |
