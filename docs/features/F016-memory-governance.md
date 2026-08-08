# Feature F016: 记忆治理三要素

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-026] + [doc:roleagent.md#第4章]
> **关联 ADR**: [doc:decisions/008-memory-federation.md]
> **类型**: memory
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.4]（待创建）
> **对应 design.md**: [doc:../design.md#§3.4]（待创建）

---

## 1. 概述（Overview）

记忆治理三要素是 roleagent.md 第 4 章的核心治理机制：①权威性 authority（铁律/已验证决策/候选观察）②触发方式 activation（永远在场/按任务范围/只在查询时出现）③生命周期 status（有效/待复核/已失效/归档）。本 Feature 实现三要素的形式化、检索时过滤、过期知识降权。

这是 Build to Persist 基础设施——编码"旧记忆和新记忆不一视同仁"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-026]` 指出：roleagent.md 治理层三要素——权威性/触发方式/生命周期。v7.0 记忆无权威等级、无触发方式、无生命周期，旧记忆和新记忆一视同仁排序，过期知识可能永远排在前面。

不做这个 Feature，F014 Collection 的 authority_level 无检索语义，F017 消费加权排序缺少 lifecycle 衰减维度，F039 MindCodex 可检索知识库无法识别"已失效知识"。这是 roleagent.md 第 4 章治理层的核心机制。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class Authority(str, Enum):
    HARD_RULE = "hard_rule"               # 铁律（最高权威）
    VERIFIED_DECISION = "verified_decision"  # 已验证决策（ADR）
    CANDIDATE_OBSERVATION = "candidate_observation"  # 候选观察

class Activation(str, Enum):
    ALWAYS_ON = "always_on"               # 永远在场
    TASK_SCOPED = "task_scoped"            # 按任务范围
    QUERY_ONLY = "query_only"             # 只在查询时出现

class LifecycleStatus(str, Enum):
    ACTIVE = "active"                     # 有效
    PENDING_REVIEW = "pending_review"     # 待复核
    DEPRECATED = "deprecated"             # 已失效
    ARCHIVED = "archived"                 # 归档

class GovernanceTag(BaseModel):
    authority: Authority
    activation: Activation
    lifecycle: LifecycleStatus
    last_verified_at: datetime
    expires_at: Optional[datetime]        # 过期时间
```

### 3.2 核心接口

```python
class GovernanceTagger:
    """给记忆条目打治理三要素标签"""
    def tag(self, entry_id: str, tag: GovernanceTag) -> None: ...

class GovernanceFilter:
    """检索时按三要素过滤"""
    def filter(self, hits: list[RetrievalHit], context: QueryContext) -> list[RetrievalHit]: ...

class LifecycleScheduler:
    """过期知识自动转 deprecated"""
    def schedule_expiry_review(self, entry_id: str, expires_at: datetime) -> None: ...
```

### 3.3 关键算法

- **权威排序**：hard_rule > verified_decision > candidate_observation；同权威按 F017 消费加权。
- **触发过滤**：always_on 始终返回；task_scoped 仅当任务范围匹配时返回；query_only 仅查询时返回。
- **生命周期衰减**：deprecated 强制降权（×0.3）；archived 不参与检索；pending_review 标记但不降权。
- **过期自动转态**：expires_at 到期自动转 deprecated 并触发 review 任务。

### 3.4 配置外置（YAML 示例）

```yaml
memory_governance:
  authority_order: [hard_rule, verified_decision, candidate_observation]
  deprecated_weight_multiplier: 0.3
  archived_excluded_from_retrieval: true
  auto_deprecate_on_expiry: true
  expiry_review_assignee: non_author_forgekin
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 三要素可独立打标与查询
- [ ] AC-2: 权威排序 hard_rule > verified_decision > candidate_observation
- [ ] AC-3: task_scoped 仅任务范围匹配时返回
- [ ] AC-4: deprecated 条目强制降权 ×0.3
- [ ] AC-5: 过期自动转 deprecated 并触发 review

## 5. 测试策略

### 5.1 单元测试

- 三要素打标、权威排序、触发过滤、生命周期衰减、过期自动转态。

### 5.2 集成测试

- 接入 F014 Collection、F017 消费加权、F015 三检索入口。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商Forgekin检索含过期知识的 Collection，验证 deprecated 降权 + 过期 review 触发。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第4章]
- [doc:review/review.md#第八章/RA-026]
- [doc:decisions/008-memory-federation.md]
- [doc:design/naming-contract.md#2.5]（EchoStore）
- [doc:features/F014-memory-collection.md]
- [doc:features/F015-three-retrieval-entry.md]
- [doc:features/F017-consumption-weighted-ranking.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
