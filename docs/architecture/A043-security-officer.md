# A043: 安全官可进化智能体（狼·阿尔法）架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.3]
> **对应 Feature**: [doc:../features/F043-security-officer.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D043-security-officer.md]（同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md] + [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge v7.1 在 forgemind 应用层缺少安全侧角色，导致：

1. 安全审计由 operator 临时介入，无持续监控机制
2. 漏洞扫描依赖外部工具一次性扫描，无持续基线
3. 合规检查（GDPR / 等保 / SOC2）无系统化流程
4. 入侵检测无异常行为基线，告警疲劳风险高

SecurityOfficerForgekin 在架构层补充"审计 → 扫描 → 建模 → 合规 → 检测"五环节的安全治理能力，作为平台与外部威胁之间的安全治理层。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/forgemind/species_impl/org/security_officer.py` 只能依赖 `core/` 与 `forgemind/` 内部模块
- **DI 容器约束**：SecurityOfficerForgekin 通过 `ForgePipeline` 第 2 步"能力注入"构造，禁止直接实例化
- **ForgekinBase 契约约束**：必须实现 `observe / act / verify` 三方法契约
- **配置驱动约束**：进化阶 / 觉醒阶 / 能力画像盲点 / 工具集外置到 `flowforge/forgemind/config/security_officer_wolf_alpha.yaml`
- **Plugin V3 协议约束**：通过 `ForgeMindPlugin.register_forgekins` 钩子注册
- **觉醒阶约束**：最高 E3（受限自主），阻断操作必须 operator 批准；Magic Words 逃生舱始终可触发
- **Governance Boundary 约束**：安全策略不可被 prompt 注入绕过（F010）
- **Magic Words 约束**：安全阻断时逃生舱仍可触发（F011）

### 1.3 架构影响

- **对 A010 Governance Boundary 的影响**：安全官执行的安全策略必须挂接到 Governance Boundary，不可被 prompt 注入绕过
- **对 A011 Magic Words 的影响**：安全阻断时逃生舱仍可触发，避免安全官过度拦截导致系统不可用
- **对 A026 forgemind 应用层的影响**：`species_impl/org/` 新增 `security_officer.py`
- **对 A042 运维的影响**：审计运维部署
- **对开发者 Forgekin的影响**：审计开发者代码

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              代码 / 配置 / 依赖 / 流量 / 权限                       │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ 日志 / 流量 / 配置 / 依赖 / 权限
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              forgemind 应用层 (Layer 2)                             │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │            SecurityOfficerForgekin (本组件)                │   │
│   │  ────────────────────────────────────────────────────────  │   │
│   │  + soul_imprint: SoulImprint (持久身份)                    │   │
│   │  + echo_store: EchoStore (安全事件记忆)                    │   │
│   │  + capability_profile: CapabilityProfile (含盲点)          │   │
│   │  + evolution_stage: E1→E5                                  │   │
│   │  + awakening_stage: E1→E3 (上限)                           │   │
│   │  ────────────────────────────────────────────────────────  │   │
│   │  + observe(env) → Observation                              │   │
│   │  + act(action) → ActionResult (5 种 action.type)           │   │
│   │  + verify(result) → Verdict                                │   │
│   │  + evolve() → 经验蒸馏到 MindCodex (威胁模式库)            │   │
│   └──────────┬────────────────────────────┬────────────────────┘   │
│              │                            │                         │
│              ▼                            ▼                         │
│   ┌──────────────────────┐    ┌──────────────────────────────┐     │
│   │  5 个工具            │    │  MindCouncil (安全策略讨论)    │     │
│   │  - SecurityScanner   │    │  + 阻断不安全部署             │     │
│   │  - ThreatModeler     │    │  + 协调运维与开发安全权衡      │     │
│   │  - ComplianceCheck   │    └──────────────────────────────┘     │
│   │  - IntrusionDetect   │                                         │
│   │  - SecurityPolicyEn  │    ┌──────────────────────────────┐     │
│   │    gine              │    │  F010 Governance Boundary     │     │
│   └──────────────────────┘    │  + 安全策略压缩免疫          │     │
│                                │  F011 Magic Words            │     │
│                                │  + 逃生舱始终可触发          │     │
│                                └──────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ ForgePipeline 6 步锻造
                                 │
┌────────────────────────────────────────────────────────────────────┐
│              FlowForge 核心框架层 (Layer 1)                         │
│   ForgekinEngine (装饰 HybridExecutor + HarnessOrchestrator)        │
│   + F010 Governance Boundary (压缩免疫)                             │
│   + F011 Magic Words (逃生舱)                                       │
│   + CapabilityProfile / EchoStore / MindCodex                       │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：安全官属 OrgForgekin 形态（组织形态）**
  理由：安全官是组织角色，承担跨智能体的安全治理职能。

- **决策 2：觉醒阶上限 E3（受限自主）**
  理由：扫描 / 审计 / 告警可自主执行（E3），但阻断操作（停止部署 / 隔离服务 / 撤销权限）必须 operator 批准，避免安全官过度拦截导致系统不可用。

- **决策 3：安全策略挂接 F010 Governance Boundary**
  理由：安全策略必须不可被 prompt 注入绕过。Governance Boundary 提供压缩免疫层，确保安全策略在 LLM 上下文压缩时保留。

- **决策 4：Magic Words 逃生舱优先于安全阻断**
  理由：避免安全官过度拦截导致 operator 无法介入。Magic Words 是 operator 的最终逃生舱，安全阻断不可覆盖。

- **决策 5：5 种 action.type 路由（vulnerability_scan / compliance_check / threat_model / audit / alert）**
  理由：覆盖安全治理全生命周期，每种 action 有独立工具与提示词模板。

### 2.3 架构不变量

- SecurityOfficerForgekin 必须通过 ForgePipeline 6 步锻造构造，禁直接实例化
- 必须实现 observe / act / verify 三方法契约
- 觉醒阶不可超过 E3（阻断操作必须 operator 批准）
- 安全策略必须挂接 F010 Governance Boundary（压缩免疫）
- Magic Words 逃生舱在安全阻断时仍可触发（F011）
- 安全事件必须写入 EchoStore（跨会话累积）
- 安全官自身不可被 prompt 注入（Governance Boundary 保护）

---

## 3. 模块设计

### 3.1 模块边界

- **security_officer.py** — SecurityOfficerForgekin 类实现，继承 ForgekinBase，实现三方法契约
- **security_officer_wolf_alpha.yaml** — Forgekin配置（进化阶 / 觉醒阶 / 能力画像盲点 / 工具集 / 阻断权限）
- **tests/test_security_officer.py** — 单元测试 + 集成测试 + E2E 测试

### 3.2 接口契约

```python
from abc import abstractmethod
from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase


class SecurityOfficerForgekin(ForgekinBase):
    """安全官可进化智能体（狼·阿尔法）— 5 种 action.type 路由"""

    @abstractmethod
    async def observe(self, env: "SecurityEnvironment") -> "Observation":
        """观察安全环境: 日志 / 流量 / 配置 / 依赖 / 权限"""

    @abstractmethod
    async def act(self, action: "SecurityAction") -> "ActionResult":
        """5 种 action.type:
        - vulnerability_scan: 漏洞扫描（SAST / DAST / SCA）
        - compliance_check: 合规检查（GDPR / 等保 / SOC2）
        - threat_model: 威胁建模（STRIDE / Attack Tree）
        - audit: 安全审计（代码 / 配置 / 依赖）
        - alert: 入侵检测告警（阻断需 operator 批准）
        """

    @abstractmethod
    async def verify(self, result: "ActionResult") -> "Verdict":
        """验证安全决策: 风险等级 / 合规性 / 影响范围"""
```

### 3.3 数据流

```
代码 / 配置 / 依赖 / 流量 / 权限信号
       │
       ▼
┌──────────────────────────────────────────────┐
│ 1. SecurityOfficerForgekin.observe(env)      │  ← 采集安全信号
│    - 日志 / 流量 / 配置 / 依赖 / 权限         │
└──────────────────┬───────────────────────────┘
                   │ Observation
                   ▼
┌──────────────────────────────────────────────┐
│ 2. SecurityOfficerForgekin.act(action)       │  ← 5 种动作路由
│    - vulnerability_scan (自主)               │
│    - compliance_check (自主)                 │
│    - threat_model / audit / alert (自主)     │
│    - 阻断操作 → operator 批准                 │
└──────────────────┬───────────────────────────┘
                   │ ActionResult
                   ▼
┌──────────────────────────────────────────────┐
│ 3. SecurityOfficerForgekin.verify(result)    │  ← 验证决策
│    - 风险等级 / 合规性 / 影响范围             │
└──────────────────┬───────────────────────────┘
                   │ Verdict
                   ▼
┌──────────────────────────────────────────────┐
│ 4. EchoStore.record(安全事件)                │  ← 跨会话累积
│    + MindCodex.蒸馏(威胁模式库)              │
│    + F044 交付经理.报告(安全审计进度)        │
│    + F010 Governance Boundary.挂接策略       │
└──────────────────────────────────────────────┘
                   ▲
                   │ Eval 信号回流
                   │
┌──────────────────────────────────────────────┐
│ 5. 评审员 / operator / 外部合规审计评估       │
│    - 漏洞检出率 / 误报率 / 合规覆盖率         │
└──────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F010 Governance Boundary** — 安全策略压缩免疫
- **F011 Magic Words** — 逃生舱始终可触发
- **F026 forgemind 应用层** — ForgekinBase 基类与 ForgePipeline
- **F027 可进化智能体形态分类** — OrgForgekin 形态定义

### 4.2 下游影响

- **F042 运维** — 审计运维部署
- **F044 交付经理** — 跟踪安全审计进度
- **开发者 Forgekin** — 审计开发者代码
- **A010 Governance Boundary** — 安全策略挂接

### 4.3 跨模块不变量

- 阻断操作必须 operator 批准（觉醒阶 E3 上限）
- 安全策略必须挂接 F010 Governance Boundary
- Magic Words 逃生舱在安全阻断时仍可触发
- 安全事件必须同步到 TeamActState（供交付经理跟踪）

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/forgemind/species_impl/org/security_officer.py` 不 import 任何 *Forge 模块
- [ ] AC-2: SecurityOfficerForgekin 通过 ForgePipeline 6 步锻造构造，无直接实例化
- [ ] AC-3: 进化阶 / 觉醒阶 / 阻断权限外置到 YAML 配置
- [ ] AC-4: 通过 ForgeMindPlugin.register_forgekins 钩子注册
- [ ] AC-5: 觉醒阶 E3 上限校验（阻断操作需 operator 批准）

### 5.2 架构不变量验收

- [ ] AC-6: observe / act / verify 三方法契约全部实现
- [ ] AC-7: 安全策略挂接 F010 Governance Boundary（压缩免疫）
- [ ] AC-8: Magic Words 逃生舱在安全阻断时仍可触发
- [ ] AC-9: 安全官自身不可被 prompt 注入
- [ ] AC-10: 阻断操作有完整审计日志

---

## 6. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.3]（安全官Forgekin详细设计）
- [doc:../features/F043-security-officer.md]（同号 Feature 级 SRS）
- [doc:../decisions/010-distributed-reliability.md]（分布式可靠性 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F043 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
