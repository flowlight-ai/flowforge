---
feature_ids: [F006]
related_features: [F002, F003, F004, F005, F007]
topics: [teamact, push-back, debate, evidence]
doc_kind: spec
created: 2026-07-21
---

# F006: 推回协议（Push Back Protocol）

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/002-teamact-collaboration-protocol.md]
> **依赖 Feature**: [doc:features/F002-teamact-loop.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径（RA-015 推回权）
> **关联 VISION**: [doc:VISION.md#4]（协作单位：动态能力画像路由）

## 1. 上下文

### 1.1 问题陈述

TeamAct 六步循环（F002）的 VERDICT 步骤如果只支持单向 review（reviewer → author 修复），当 reviewer 判断错误时 author 被迫执行错误修复，浪费 LLM 调用成本且产出质量下降。roleagent.md RA-015 要求任何角色的灵智体都有权推回不合理任务或 review 意见，但必须携带证据（evidence）、适用性论证（reason）和替代方案。无证据的推回是非法的；有证据的推回必须被严肃对待。本 Feature 提供 PushBackProtocol，把单向 review 升级为双向辩论，未解决的推回会阻塞 F002 QUALITY_BAR_MET 终止条件。

### 1.2 当前痛点

- author 被迫接受错误的 review 意见，产出质量下降
- 推回无结构化记录，reviewer 不知道 author 为什么拒绝
- 无证据的推回（"我觉得不对"）浪费团队时间
- 未解决推回不影响终止条件，任务带着分歧"强行完成"
- 推回状态不可观测，operator 无法知道团队是否存在分歧

### 1.3 不做的影响

- TeamAct VERDICT 步骤退化为单向 review，违反 RA-015
- 错误 review 意见被强制执行，LLM 调用成本浪费
- 团队分歧被掩盖，F002 `vision_converged` 终止条件失真
- operator 无法感知团队阻塞点，无法及时干预

## 2. 决策

### 2.1 核心设计

PushBackProtocol 由 `flowforge/core/teamact/push_back.py` 实现，核心设计：

- **PushBack dataclass 8 字段**：`from_owner` / `to_owner` / `reason` / `evidence` / `created_at` / `resolved` / `resolution` / `push_back_id`
- **推回三要素强制**：`create_push_back()` 强制 `from_owner` / `to_owner` / `reason` 非空 + `evidence` 至少一个 anchor，违反抛 `TeamActError`（RA-015：无证据推回非法）
- **`resolved` 默认 False**：推回必须被显式 `resolve(push_back_id, resolution)` 才能关闭，禁自动关闭
- **`resolution` 自由文本**：接受 / 拒绝 / 升级均由调用方填入，protocol 不强制枚举（保留灵活性）
- **`list_unresolved()`**：返回所有未解决推回，供 F002 检查是否阻塞 QUALITY_BAR_MET
- **`push_back_id` 自动生成**：`pb-{uuid4_hex[:10]}` 前缀，与 F003 `ta-hc-` / F005 `lease-` 风格一致
- **`created_at` timezone-aware**：`datetime.now(timezone.utc)`，避免跨时区歧义
- **日志通过 `get_logger`**：注入 trace_id，符合铁律 5

### 2.2 关键接口

```python
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from flowforge.core.errors import TeamActError


@dataclass
class PushBack:
    """A structured push-back from one owner to another.

    Fields:
        from_owner:  the agent issuing the push-back (typically the author)
        to_owner:    the agent being pushed back on (typically the reviewer)
        reason:      applicability argument — why the original ask/review is wrong
        evidence:    anchors supporting the push-back (commits, traces, test runs)
        created_at:  when the push-back was raised
        resolved:    whether the push-back has been resolved
        resolution:  free-text resolution once settled (accept / reject / escalate)
    """
    from_owner: str = ""
    to_owner: str = ""
    reason: str = ""
    evidence: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    resolved: bool = False
    resolution: str = ""
    push_back_id: str = field(default_factory=lambda: f"pb-{uuid.uuid4().hex[:10]}")


class PushBackProtocol:
    """Track push-backs and their resolution state."""

    def create_push_back(
        self,
        from_owner: str,
        to_owner: str,
        reason: str,
        evidence: list[str],
    ) -> PushBack:
        """Create a push-back; raise TeamActError if reason/evidence empty."""

    def resolve(self, push_back_id: str, resolution: str) -> None:
        """Resolve a push-back; raise TeamActError if not found or resolution empty."""

    def list_unresolved(self) -> list[PushBack]:
        """Return all unresolved push-backs (blocks QUALITY_BAR_MET)."""

    def list_all(self) -> list[PushBack]:
        """Return all push-backs (resolved + unresolved)."""

    def get(self, push_back_id: str) -> PushBack:
        """Get a push-back by id; raise TeamActError if not found."""
```

### 2.3 协作流程

PushBackProtocol 在 TeamAct 生态中与其他 4 份子 Feature 协作：

- **F003 HandoffCapsule**：推回生成 capsule 通知 `to_owner`（被推回方），capsule 的 `summary` 携带推回理由摘要，`next_action_hint` 建议替代方案
- **F004 AtMentionRouter**：推回消息通过 `@to_owner` 行首指令路由；接收方收到 @ 后进入 VERDICT 重新评审
- **F005 BallCustodyRegistry**：推回期间 `from_owner` 保持 lease 不释放；推回不是球权转移，是球权持有期间的辩论
- **F007 PingPongCircuitBreaker**：推回不计入 `record_failure`（推回是显式辩论，非持球失败）；但无限推回可由 operator 触发 magic_word 拉闸

推回生命周期：`create_push_back`（VERDICT 步骤）→ `@to_owner` 路由 → to_owner 评审 → `resolve`（accept/reject/escalate）→ 解除 QUALITY_BAR_MET 阻塞。

### 2.4 关键不变量

- INV-1: 推回三要素（`from_owner` / `reason` / `evidence`）永不为空，违反抛 `TeamActError`（RA-015）
- INV-2: `resolved` 默认 False，必须显式 `resolve(push_back_id, resolution)` 才能关闭，禁自动关闭
- INV-3: `resolve` 的 `resolution` 必须非空，禁空字符串静默关闭
- INV-4: 未解决推回（`list_unresolved()` 非空）阻塞 F002 QUALITY_BAR_MET 终止条件
- INV-5: 推回不计入 F007 failure count（推回是显式辩论，非持球失败）
- INV-6: `push_back_id` 自动生成且全局唯一（`pb-` 前缀 + 10 位 hex），禁手工填充

### 2.5 失败模式与恢复

| # | 失败模式 | 检测 | 恢复 |
|---|---------|------|------|
| FM-1 | 推回无证据（`evidence` 为空） | `create_push_back()` 抛 `TeamActError` | 补充真实证据 anchor 后重新创建（T2 铁律） |
| FM-2 | 推回无限阻塞 QUALITY_BAR_MET | `list_unresolved()` 持续非空 | operator magic_word 拉闸或 F007 熔断升级 |
| FM-3 | evidence 伪造（假 commit sha） | T7 LLM 审核 + T2 真实数据铁律 | 拒绝伪造证据，推回视为非法 |
| FM-4 | `resolve` 后未更新 `resolution` 文本 | `resolve()` 抛 `TeamActError` | 调用方填写 accept/reject/escalate 文本 |
| FM-5 | 推回被滥用拖延任务 | F007 熔断器限制互传；推回必须有证据 | operator 监控推回次数，干预恶意推回 |

恢复原则：推回三要素强制（RA-015）；未解决推回阻塞终止条件，禁任务带分歧强行完成。

触发阈值：VERDICT 步骤检查 `list_unresolved()` 非空即阻塞 QUALITY_BAR_MET；推回无限循环由 operator 拉闸。

## 3. 验收标准

### Phase A（推回三要素 + 显式 resolve）

- [ ] AC-A1: `PushBack` 含 8 字段（from_owner / to_owner / reason / evidence / created_at / resolved / resolution / push_back_id）
- [ ] AC-A2: `create_push_back` 在 `from_owner` 为空时抛 `TeamActError`
- [ ] AC-A3: `create_push_back` 在 `to_owner` 为空时抛 `TeamActError`
- [ ] AC-A4: `create_push_back` 在 `reason` 为空时抛 `TeamActError`（RA-015：无理由推回非法）
- [ ] AC-A5: `create_push_back` 在 `evidence` 为空列表时抛 `TeamActError`（RA-015：无证据推回非法）
- [ ] AC-A6: `push_back_id` 自动生成 `pb-{10hex}` 格式
- [ ] AC-A7: `resolve(push_back_id, resolution)` 后 `resolved=True`，`resolution` 非空
- [ ] AC-A8: `resolve` 对未知 push_back_id 抛 `TeamActError`
- [ ] AC-A9: `resolve` 对空 resolution 抛 `TeamActError`
- [ ] AC-A10: `list_unresolved()` 只返回 `resolved=False` 的推回

### Phase B（TeamAct 集成 + 终止条件阻塞）

- [ ] AC-B1: F002 VERDICT 步骤检查 `list_unresolved()`，非空时阻塞 QUALITY_BAR_MET 终止条件
- [ ] AC-B2: 推回通过 F004 `@mention` 路由通知 `to_owner`
- [ ] AC-B3: 推回期间 F005 lease 由 `from_owner` 保持持有（不释放球权）
- [ ] AC-B4: 推回证据（evidence）必须是真实 anchor（commit sha / trace id / 测试报告路径），禁假数据（T2 铁律）
- [ ] AC-B5: E2E 测试 — reviewer 提出错误 review 意见，author 用真实证据推回，reviewer 接受推回，任务正确完成
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: F002（TeamAct 主循环 VERDICT 步骤）
- **Blocked by**: F002
- **Related**: F003（推回可触发 HandoffCapsule 交接给 to_owner）、F004（@mention 路由通知 to_owner）、F005（推回期间 from_owner 保持 lease）、F007（多次推回互传触发熔断升级 operator）、F001（CapabilityProfile 决定谁能推回）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 推回被滥用拖延任务 | F007 熔断器限制互传次数；推回必须有证据 |
| `resolution` 自由文本格式漂移 | 由架构师灵智体 review；后续可加 Pydantic 枚举 |
| 未解决推回无限阻塞 QUALITY_BAR_MET | operator 可 magic_word 拉闸或 F007 熔断升级 |
| 推回证据伪造 | 证据 anchor 必须 commit sha / trace id 等可验证形式（T2 铁律） |
| 推回与 F007 熔断冲突 | 推回是显式辩论非互传踢皮球，不计入 F007 failure count |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | `resolution` 是否需要结构化为枚举（accept / reject / escalate）？ | ⬜ 未定 |
| OQ-2 | 推回是否需要支持第三方仲裁（如 operator 或灵议 MindCouncil）？ | ⬜ 未定 |
| OQ-3 | 推回证据是否需要 LLM 审核真实性（T7 铁律）？ | ⬜ 未定 |
| OQ-4 | 推回是否需要超时自动升级（避免无限阻塞）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 推回三要素强制（from_owner + reason + evidence） | RA-015：无证据推回非法 | 2026-07-21 |
| KD-2 | `resolved` 默认 False，必须显式 `resolve()` | 防止推回被静默关闭 | 2026-07-21 |
| KD-3 | `resolution` 自由文本 | 保留 accept / reject / escalate 灵活性，不强制枚举 | 2026-07-21 |
| KD-4 | 未解决推回阻塞 QUALITY_BAR_MET | 防止任务带着分歧"强行完成" | 2026-07-21 |
| KD-5 | 推回不计入 F007 failure count | 推回是显式辩论，非互传踢皮球 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，基于 ADR-002 与 F002 提取推回协议子 Feature 规格 |

## 9. Review Gate

- Phase A: 单元测试通过（三要素强制 + resolve 全分支覆盖 + list_unresolved 过滤验证），由架构师灵智体 review
- Phase B: E2E 测试由跨厂商 reviewer 灵智体 review，真实推回辩论场景验证 + 未解决推回阻塞终止条件验证

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/002-teamact-collaboration-protocol.md` | TeamAct 协作协议决策 |
| **Feature** | `docs/features/F002-teamact-loop.md` | TeamAct 主循环 |
| **Feature** | `docs/features/F003-handoff-capsule.md` | 交接胶囊 |
| **Feature** | `docs/features/F004-at-mention-router.md` | @mention 路由 |
| **Feature** | `docs/features/F005-ball-custody-lease.md` | 球权租借 |
| **Feature** | `docs/features/F007-pingpong-circuit-breaker.md` | 乒乓球熔断器 |
| **代码** | `flowforge/core/teamact/push_back.py` | PushBackProtocol 实现 |
