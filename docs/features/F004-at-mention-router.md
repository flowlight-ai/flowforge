---
feature_ids: [F004]
related_features: [F002, F003, F005, F006, F007]
topics: [teamact, routing, at-mention, directive]
doc_kind: spec
created: 2026-07-21
---

# F004: @mention 路由（AtMention Router）

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/002-teamact-collaboration-protocol.md]
> **依赖 Feature**: [doc:features/F002-teamact-loop.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径（RA-013 行首 @ 路由）
> **关联 VISION**: [doc:VISION.md#4]（协作单位：动态能力画像路由）

## 1. 上下文

### 1.1 问题陈述

TeamAct 六步循环（F002）的 ROUTE 步骤需要一个明确的路由协议：当前持球灵智体如何在消息中表达"把球传给谁"。roleagent.md RA-013 指出，路由指令必须出现在行首，埋在句中的 `@` 是叙述性引用而非路由——把两者混用是"球掉地上"故障的主要来源。本 Feature 提供 AtMentionRouter，解析行首 `@` 路由指令，支持 4 种语义（精确 / 广播 / 按角色 / 按 forgekin id），让 F003 HandoffCapsule 的 `to_owner` 字段能被结构化填充。

### 1.2 当前痛点

- 路由指令与叙述性 @ 混用，球权归属歧义
- 没有"广播给全员"语义（`@all`），无法发起 standup / 同步信号
- 没有"按角色路由"语义（`@role:xxx`），无法驱动 F001 CapabilityProfile 路由
- 没有"按 forgekin id 路由"语义（`@forgekin:xxx`），无法精确路由到具体灵智体
- 解析逻辑散落在各 Agent 代码中，无法被跨厂商 review 复用

### 1.3 不做的影响

- TeamAct ROUTE 步骤退化为"猜球该给谁"，违反 RA-013
- F003 HandoffCapsule 的 `to_owner` 字段无统一来源
- F001 CapabilityProfile 路由缺少触发入口
- 球权归属歧义导致 F005 BallCustodyRegistry 双持球冲突

## 2. 决策

### 2.1 核心设计

AtMentionRouter 由 `flowforge/core/teamact/at_mention_router.py` 实现，核心设计：

- **行首 @ 才是路由**：用正则 `^@([^\s]+)\s*(.*)$` 匹配行首 @，句中 @ 视为叙述性引用，`to_owner` 返回空字符串（调用方保留当前持球者）
- **4 种路由语义**：
  - `@coder fix bug` → 精确路由到 owner="coder"（bare name）
  - `@all standup` → 广播，owner="all"，`is_broadcast=True`
  - `@role:reviewer check` → 按角色路由，owner="reviewer"，`mentioned_capabilities=["reviewer"]`，后续由 F001 CapabilityProfile 解析
  - `@forgekin:fk-001 fix bug` → 按 forgekin id 路由，owner="fk-001"
- **RoutingDecision dataclass**：包含 `to_owner` / `message_body` / `mentioned_capabilities`，提供 `is_broadcast` 与 `has_routing_directive` 两个属性
- **常量 `BROADCAST_OWNER = "all"`**：广播语义的统一标识，禁 magic string
- **错误处理**：None 输入抛 `TeamActError`，`@role:` / `@forgekin:` 后为空抛 `TeamActError`
- **日志**：通过 `core.tracing.get_logger` 注入 trace_id，符合铁律 5

### 2.2 关键接口

```python
import re
from dataclasses import dataclass, field
from flowforge.core.errors import TeamActError

_AT_PREFIX_RE = re.compile(r"^@([^\s]+)\s*(.*)$", re.DOTALL)
BROADCAST_OWNER: str = "all"


@dataclass
class RoutingDecision:
    """Outcome of routing a message."""
    to_owner: str = ""
    message_body: str = ""
    mentioned_capabilities: list[str] = field(default_factory=list)

    @property
    def is_broadcast(self) -> bool:
        return self.to_owner == BROADCAST_OWNER

    @property
    def has_routing_directive(self) -> bool:
        return bool(self.to_owner)


class AtMentionRouter:
    """Parse a leading @ routing directive out of a message."""

    def route(self, message: str) -> RoutingDecision:
        if message is None:
            raise TeamActError("route() requires a non-None message")
        stripped = message.lstrip()
        if not stripped.startswith("@"):
            return RoutingDecision(to_owner="", message_body=message)
        match = _AT_PREFIX_RE.match(stripped)
        if match is None:
            raise TeamActError(f"could not parse @ routing directive from {message!r}")
        token, body = match.group(1), match.group(2)
        if token.startswith("role:"):
            role = token[len("role:"):]
            if not role:
                raise TeamActError("@role: directive requires a role name")
            return RoutingDecision(to_owner=role, message_body=body, mentioned_capabilities=[role])
        elif token.startswith("forgekin:"):
            owner = token[len("forgekin:"):]
            if not owner:
                raise TeamActError("@forgekin: directive requires a forgekin id")
            return RoutingDecision(to_owner=owner, message_body=body)
        elif token == BROADCAST_OWNER:
            return RoutingDecision(to_owner=BROADCAST_OWNER, message_body=body)
        else:
            return RoutingDecision(to_owner=token, message_body=body)
```

### 2.3 协作流程

AtMentionRouter 在 TeamAct 生态中与其他 4 份子 Feature 协作：

- **F003 HandoffCapsule**：`route()` 返回的 `to_owner` 填充 capsule 的对应字段；`mentioned_capabilities` 填充 capsule 的 `required_capabilities`（当 `@role:xxx` 触发能力路由时）
- **F005 BallCustodyRegistry**：非广播路由（`is_broadcast=False`）触发 `acquire(ball_id, to_owner, ttl)`；广播路由（`@all`）不触发 acquire，避免全员抢球
- **F006 PushBackProtocol**：推回消息通过 `@to_owner` 行首指令路由通知被推回方；推回期间球权不转移
- **F007 PingPongCircuitBreaker**：熔断后通过 `@operator` 路由升级；`@all` 广播用于团队级告警与 standup 召集

路由优先级：行首 @ 优先于一切；无行首 @ 时保留当前持球者，不触发球权转移，调用方自行决定下一步。

### 2.4 关键不变量

- INV-1: 行首 @ 才是路由指令，句中 @ 视为叙述性引用（`has_routing_directive=False`）
- INV-2: `@all` 广播不触发 F005 acquire（`is_broadcast=True` 时禁球权转移）
- INV-3: `@role:xxx` 的 role 必须非空，否则抛 `TeamActError`
- INV-4: `@forgekin:xxx` 的 forgekin id 必须非空，否则抛 `TeamActError`
- INV-5: None 输入抛 `TeamActError`，禁静默返回空 Decision
- INV-6: `BROADCAST_OWNER = "all"` 常量化，禁 magic string 散落

### 2.5 失败模式与恢复

| # | 失败模式 | 检测 | 恢复 |
|---|---------|------|------|
| FM-1 | 句中 @ 被误解析为路由 | 正则 `^@` 锚定行首 | 句中 @ 返回空 `to_owner`，保留当前持球者 |
| FM-2 | `@role:xxx` 的 role 与 F001 命名不一致 | 路由后 F001 返回空 owner | 升级 operator，架构师灵智体对齐命名契约 |
| FM-3 | None 输入 | `route()` 抛 `TeamActError` | 调用方前置校验，禁传 None |
| FM-4 | `@all` 广播引发全员抢球 | `is_broadcast=True` 时不触发 F005 acquire | 广播仅通知，不转移球权 |
| FM-5 | bare name 与 forgekin id 混淆 | bare name 视为 name；精确 id 用 `@forgekin:` 前缀 | 命名契约明确，架构师灵智体 review |

恢复原则：行首 @ 优先于一切；无行首 @ 时保留当前持球者，调用方自行决定下一步。

触发阈值：`route()` 每次调用即解析；解析失败抛 `TeamActError`，禁静默返回错误 Decision。

## 3. 验收标准

### Phase A（4 种路由语义 + 解析逻辑）

- [ ] AC-A1: `@coder fix bug` 解析为 `to_owner="coder"`，`message_body="fix bug"`
- [ ] AC-A2: `@all standup` 解析为 `to_owner="all"`，`is_broadcast=True`
- [ ] AC-A3: `@role:reviewer check` 解析为 `to_owner="reviewer"`，`mentioned_capabilities=["reviewer"]`
- [ ] AC-A4: `@forgekin:fk-001 fix bug` 解析为 `to_owner="fk-001"`
- [ ] AC-A5: 句中 @（如 "hey @coder what's up"）解析为 `to_owner=""`，`has_routing_directive=False`
- [ ] AC-A6: None 输入抛 `TeamActError`
- [ ] AC-A7: `@role:` 后为空抛 `TeamActError`；`@forgekin:` 后为空抛 `TeamActError`
- [ ] AC-A8: 日志通过 `get_logger` 注入 trace_id（铁律 5）

### Phase B（TeamAct 集成 + E2E）

- [ ] AC-B1: F002 ROUTE 步骤调用 `AtMentionRouter.route()` 填充 F003 HandoffCapsule 的 `to_owner`
- [ ] AC-B2: `@role:xxx` 触发 F001 CapabilityProfile 路由，从团队中选出具备该 capability 的灵智体
- [ ] AC-B3: `@all` 广播不触发球权转移（`is_broadcast=True` 时 F005 BallCustodyRegistry 不 acquire 新 lease）
- [ ] AC-B4: 路由解析延迟 < 5ms（纯正则，无 LLM 调用）
- [ ] AC-B5: E2E 测试 — 真实 3 灵智体协作场景，4 种路由语义全部覆盖
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: F002（TeamAct 主循环 ROUTE 步骤）
- **Blocked by**: F002
- **Related**: F001（CapabilityProfile 解析 `@role:xxx`）、F003（HandoffCapsule 消费 `to_owner`）、F005（BallCustodyRegistry 依据路由 acquire lease）、F006（PushBack 通过 @ 路由推回）、F007（熔断后 @ 升级给 operator）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| `@role:xxx` 的 role 命名与 F001 CapabilityProfile 不一致 | 由架构师灵智体 review 命名契约 |
| bare name 与 forgekin id 混淆（如 `@coder` 是 name 还是 id） | bare name 视为 name；精确 id 必须用 `@forgekin:` 前缀 |
| 句中 @ 被误解析为路由 | 正则锚定行首 `^@`，句中 @ 不匹配 |
| 广播 `@all` 引发并发 acquire 冲突 | `is_broadcast=True` 时不触发 F005 acquire |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 是否需要支持 `@team:xxx` 按 TeamAct 团队路由？ | ⬜ 未定 |
| OQ-2 | bare name 是否需要先查 F001 CapabilityProfile 验证存在性？ | ⬜ 未定 |
| OQ-3 | 是否需要支持组合路由（如 `@coder,@reviewer`）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 行首 @ 才是路由 | RA-013：句中 @ 是叙述性引用，混用是球掉地主因 |
| KD-2 | 4 种路由语义（bare / all / role: / forgekin:） | 覆盖精确 / 广播 / 按角色 / 按 id 全部场景 |
| KD-3 | `BROADCAST_OWNER = "all"` 常量化 | 禁 magic string，便于全局检索与重命名 |
| KD-4 | None 输入抛 `TeamActError` 而非返回空 Decision | 强制调用方处理 None，避免静默错误 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，基于 ADR-002 与 F002 提取 @mention 路由子 Feature 规格 |

## 9. Review Gate

- Phase A: 单元测试通过（4 种路由 + None + 空前缀全部分支覆盖），由架构师灵智体 review
- Phase B: E2E 测试由跨厂商 reviewer 灵智体 review，4 种路由语义在真实协作场景中全部命中

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/002-teamact-collaboration-protocol.md` | TeamAct 协作协议决策 |
| **Feature** | `docs/features/F002-teamact-loop.md` | TeamAct 主循环 |
| **Feature** | `docs/features/F003-handoff-capsule.md` | 交接胶囊 |
| **Feature** | `docs/features/F005-ball-custody-lease.md` | 球权租借 |
| **Feature** | `docs/features/F006-push-back-protocol.md` | 推回协议 |
| **Feature** | `docs/features/F007-pingpong-circuit-breaker.md` | 乒乓球熔断器 |
| **代码** | `flowforge/core/teamact/at_mention_router.py` | AtMentionRouter 实现 |
