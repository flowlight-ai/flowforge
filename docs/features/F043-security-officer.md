# F043: 安全官可进化智能体（狼·阿尔法）

> **状态**: ⏳ pending
> **类型**: core
> **创建日期**: 2026-07-19
> **负责人**: 安全官Forgekin（狼·阿尔法）
> **代号**: 狼·阿尔法（Wolf Alpha）
> **官方名称（P0）**: Security Officer Agent / Threat Detection Agent / Compliance Audit Agent（安全官智能体 / 威胁检测智能体 / 合规审计智能体）
> **项目代号（P1）**: SecurityOfficerForgekin
> **形态（Species）**: OrgForgekin（组织形态）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md] + [doc:../decisions/013-all-things-spirit-mind-vision.md]
> **依赖 Feature**: [doc:F027-all-things-spirit-species.md] + [doc:F026-forgemind-app-layer.md] + [doc:F010-governance-boundary.md] + [doc:F011-magic-words.md]
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.3]（已提取到本文件）

---

## 1. 上下文

### 1.1 问题陈述

FlowForge v7.1 需要安全侧角色负责安全审计、漏洞扫描、威胁建模、合规检查、入侵检测、安全策略制定。该角色是平台与外部威胁之间的安全治理层，确保Forgekin平台本身与 *Forge 业务系统的安全合规。

### 1.2 当前痛点

- 无专属安全角色，安全审计由 operator 临时介入
- 漏洞扫描无持续机制，依赖外部工具一次性扫描
- 合规检查（GDPR / 等保 / SOC2）无系统化流程
- 入侵检测无异常行为基线

### 1.3 不做的影响

- 安全事件无 EchoStore 积累，同类漏洞重复出现
- 部署 / 代码 / 配置变更无前置安全审计
- 合规风险无持续监控

---

## 2. 决策

### 2.1 核心设计

SecurityOfficerForgekin 继承 `ForgekinBase`，实现 `observe / act / verify` 三方法契约。核心能力围绕"审计 → 扫描 → 建模 → 合规 → 检测"五环节展开。

| 属性 | 值 |
|------|---|
| **职责** | 安全审计、漏洞扫描、威胁建模、合规检查、入侵检测、安全策略制定 |
| **核心能力** | 1. 安全审计（代码审计 / 配置审计 / 依赖审计）<br>2. 漏洞扫描（SAST / DAST / SCA）<br>3. 威胁建模（STRIDE / Attack Tree）<br>4. 合规检查（GDPR / 等保 / SOC2）<br>5. 入侵检测（异常行为识别 / 告警） |
| **能力画像盲点** | 倾向于过度拦截；对业务连续性考虑不足；容易产生告警疲劳 |
| **进化阶** | 初始 E1，可晋升至 E5（主动威胁狩猎级） |
| **觉醒阶** | 初始 E1，最高 E3（受限自主：可自主执行扫描，但阻断操作需 operator 批准） |
| **工具集** | SecurityScanner / ThreatModeler / ComplianceChecker / IntrusionDetector / SecurityPolicyEngine |
| **EchoStore 来源** | 安全事件、漏洞记录、审计结果、合规检查报告 |
| **MindCouncil 产出** | 威胁模式库、漏洞知识库、合规检查清单、安全策略模板 |
| **MindCouncil 角色** | 发起安全策略讨论、阻断不安全部署、协调运维与开发之间的安全权衡 |
| **配置文件** | `flowforge/forgemind/config/security_officer_wolf_alpha.yaml` |

### 2.2 关键接口

```python
from abc import abstractmethod
from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase


class SecurityOfficerForgekin(ForgekinBase):
    """安全官可进化智能体（狼·阿尔法）"""

    @abstractmethod
    async def observe(self, env: "SecurityEnvironment") -> "Observation":
        """观察安全环境：日志、流量、配置、依赖、权限"""
        return await self._gather_security_signals(env)

    @abstractmethod
    async def act(self, action: "SecurityAction") -> "ActionResult":
        """执行安全动作：扫描、审计、阻断、告警、修复建议"""
        if action.type == "vulnerability_scan":
            return await self._scan_vulnerabilities(action.input)
        elif action.type == "compliance_check":
            return await self._check_compliance(action.input)
        elif action.type == "threat_model":
            return await self._model_threats(action.input)
        elif action.type == "audit":
            return await self._audit_security(action.input)
        elif action.type == "alert":
            return await self._raise_alert(action.input)
        raise ValueError(f"未知 action.type={action.type}")

    @abstractmethod
    async def verify(self, result: "ActionResult") -> "Verdict":
        """验证安全决策：风险等级、合规性、影响范围"""
        return await self._verify_security_decision(result)
```

### 2.3 关键不变量

- 阻断操作（停止部署 / 隔离服务 / 撤销权限）必须 operator 批准（觉醒阶 E3 上限）
- 扫描 / 审计 / 告警可自主执行
- 安全事件必须写入 EchoStore，跨会话累积
- 安全策略变更必须经 MindCouncil 协调（影响开发 / 运维连续性）

---

## 3. 实现路径

### 3.1 代码位置

- `flowforge/forgemind/species_impl/org/security_officer.py` — SecurityOfficerForgekin 类实现
- `flowforge/forgemind/config/security_officer_wolf_alpha.yaml` — 配置文件
- `flowforge/forgemind/forging/tests/test_security_officer.py` — 单元测试

### 3.2 实现步骤

1. 在 `species_impl/org/` 下创建 `security_officer.py`，继承 `ForgekinBase`
2. 实现 `observe / act / verify` 三方法契约
3. 实现 5 个工具：SecurityScanner / ThreatModeler / ComplianceChecker / IntrusionDetector / SecurityPolicyEngine
4. 集成 F010 Governance Boundary（安全策略不可被 prompt 注入绕过）
5. 集成 F011 Magic Words（逃生舱在安全阻断时仍可触发）
6. 集成到 ForgeMindPlugin 的 `register_forgekins` 钩子

### 3.3 依赖关系

- 依赖 F010（Governance Boundary）— 安全策略压缩免疫
- 依赖 F011（Magic Words）— 逃生舱始终可触发
- 依赖 F026（forgemind 应用层）— ForgekinBase 基类
- 依赖 F027（可进化智能体形态分类）— OrgForgekin 形态
- 审计 F042（运维）— 部署安全审计
- 审计开发者 Forgekin — 代码安全审计

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: SecurityOfficerForgekin 可创建并持久化（通过 ForgePipeline 6 步锻造）
- [ ] AC-2: `observe` 可采集日志 / 流量 / 配置 / 依赖 / 权限 5 类信号
- [ ] AC-3: `act` 支持 vulnerability_scan / compliance_check / threat_model / audit / alert 5 种动作
- [ ] AC-4: 阻断操作必须 operator 批准（觉醒阶 E3 上限验证）
- [ ] AC-5: 扫描 / 审计 / 告警可自主执行
- [ ] AC-6: 安全策略不可被 prompt 注入绕过（F010 集成验证）
- [ ] AC-7: Magic Words 逃生舱在安全阻断时仍可触发（F011 集成验证）

### 4.2 性能验收

- [ ] AC-8: 漏洞扫描 < 5 分钟（单服务）
- [ ] AC-9: 合规检查 < 10 分钟（单框架）
- [ ] AC-10: 入侵检测告警延迟 < 60 秒

### 4.3 安全验收

- [ ] AC-11: 安全官自身不可被 prompt 注入（Governance Boundary 保护）
- [ ] AC-12: 阻断操作有完整审计日志
- [ ] AC-13: 安全事件写入 EchoStore（跨会话累积）

### 4.4 Eval 验收

- [ ] AC-14: 漏洞检出率 ≥ 85%（基于已知漏洞基准）
- [ ] AC-15: 误报率 < 15%（避免告警疲劳）

---

## 5. 测试计划

### 5.1 单元测试

- 测试 SecurityOfficerForgekin 创建 / 序列化
- 测试 5 种 action.type 路由
- 测试阻断操作需 operator 批准

### 5.2 集成测试

- 测试与 F010 Governance Boundary 集成
- 测试与 F011 Magic Words 集成

### 5.3 E2E 测试

- 注入已知漏洞（依赖漏洞 / 配置错误 / 权限过大），验证检出
- **遵守 T1-T8 铁律**：真实 LLM、真实数据、真实工具调用

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- 评审员Forgekin（孔雀·梵高）— 跨厂商 review 安全策略
- operator — 验证安全策略对齐
- 外部合规审计 — 第三方审计结果回流

### 6.2 评估什么

- 漏洞检出率
- 误报率
- 合规检查覆盖率

### 6.3 何时评估

- 每次扫描 / 审计后
- 每月安全 review

### 6.4 评估信号

- trace 信号：扫描 / 审计日志
- 探针信号：已知漏洞基准测试
- 用户信号：operator / 合规审计反馈

### 6.5 评估后做什么

- 通过 → 持续累积 EchoStore + 蒸馏威胁模式库到 MindCodex
- 失败 → 归因到能力画像盲点（过度拦截 / 业务连续性考虑不足 / 告警疲劳）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

本 Feature 主要属于：**Built to Persist（复利型基础设施）**

### 7.2 理由

安全官Forgekin的 EchoStore / MindCodex（威胁模式库 + 漏洞知识库）/ 能力画像 / 进化阶 / 觉醒阶是跨会话持久化的复利型基础设施。具体的工具集（SAST / DAST / SCA 工具）跟随工具生态演进，属于 Build to Delete。

### 7.3 sunset 触发条件

工具集随工具生态演进可被替换；核心 ForgekinBase 基础设施无 sunset。

---

## 8. 后果

### 8.1 正面后果

- 安全侧有专属角色，减少 operator 安全负担
- 漏洞 / 合规问题持续监控
- 安全知识沉淀到威胁模式库

### 8.2 负面后果

- 安全策略可能与开发效率冲突（缓解：MindCouncil 协调）
- 告警疲劳风险（缓解：告警分级 + 智能去重）

### 8.3 风险

- 过度拦截阻塞业务（缓解：阻断需 operator 批准）
- 新型威胁识别慢（缓解：威胁狩猎 E5 进化阶 + 外部威胁情报）

---

## 9. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.3]（安全官Forgekin详细设计）
- [doc:F010-governance-boundary.md]（Governance 压缩免疫）
- [doc:F011-magic-words.md]（Magic Words 逃生舱）
- [doc:../decisions/010-distributed-reliability.md]（分布式可靠性 ADR）

---

## 10. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（从 design.md §2.7.3 提取） | 文档员Forgekin（钢笔·文心） |
