# FlowForge 架构决策记录（ADR）

> **文档编号**: decisions/README.md（v1.0）
> **依据**: `[doc:review/review.md#12.1]` 文档拆分目标结构
> **参考**: `[doc:clowder-ai/docs/decisions/]` 目录结构

---

## 1. ADR 规范

每个架构决策记录（ADR）遵循以下格式：

```markdown
# ADR 0XX: 决策标题

> **状态**: proposed | accepted | deprecated | superseded by ADR 0YY
> **日期**: YYYY-MM-DD
> **决策者**: operator | 架构师灵智体 | 灵议 Mind Council
> **依赖**: [doc:xxx]

## 上下文
[为什么需要这个决策？当前问题是什么？]

## 决策
[我们决定什么？]

## 后果
[决策带来的正面 / 负面后果]

## 替代方案
[考虑过但未选择的方案]

## 引用
- [doc:features/F0XX-xxx.md]
- [doc:roleagent.md#第X章]
```

**不可变性规则**：ADR 一旦 accepted 不可修改，决策变更通过新增 ADR 引用旧 ADR（superseded by）。

---

## 2. ADR 清单（13 份核心 ADR）

| ADR | 标题 | 状态 | 依据 |
|-----|------|:----:|------|
| [001-agent-invocation-approach.md](001-agent-invocation-approach.md) | Agent 调用方式 | ⏳ | roleagent.md §3 |
| [002-collaboration-protocol.md](002-collaboration-protocol.md) | TeamAct 协作协议 | ⏳ | RA-009~RA-016 |
| [003-project-thread-architecture.md](003-project-thread-architecture.md) | 线程架构 | ⏳ | roleagent.md §3 |
| [004-capability-profile-routing.md](004-capability-profile-routing.md) | 能力画像路由 | ⏳ | RA-001~RA-008 |
| [005-forgemind-application-layer.md](005-forgemind-application-layer.md) | forgemind 应用层 | ⏳ | FM-001~FM-012 |
| [006-external-agent-integration.md](006-external-agent-integration.md) | 三方 Agent 集成 | ⏳ | EX-001~EX-010 |
| [007-harness-engineering.md](007-harness-engineering.md) | Harness 工程路径 | ⏳ | RA-017~RA-023 |
| [008-memory-federation.md](008-memory-federation.md) | 多域记忆联邦 | ⏳ | RA-024~RA-030 |
| [009-eval-self-metabolism.md](009-eval-self-metabolism.md) | Eval 自代谢 | ⏳ | RA-031~RA-036 |
| [010-distributed-reliability.md](010-distributed-reliability.md) | 分布式可靠性 | ⏳ | RA-037~RA-042 |
| [011-partnership-math.md](011-partnership-math.md) | 伙伴系统数学 | ⏳ | RA-043~RA-047 |
| [012-naming-fusion.md](012-naming-fusion.md) | 命名融合（ForgeMind 主名） | ⏳ | review.md §6 |
| [013-all-things-spirit-mind-vision.md](013-all-things-spirit-mind-vision.md) | 万物灵智体愿景 | ⏳ | VISION.md |

---

## 3. ADR 优先级

### P0（Phase 0 必须完成）
- ADR 004: 能力画像路由
- ADR 005: forgemind 应用层
- ADR 006: 三方 Agent 集成
- ADR 012: 命名融合
- ADR 013: 万物灵智体愿景

### P1（Phase 1 完成前必须完成）
- ADR 002: TeamAct 协作协议
- ADR 007: Harness 工程路径
- ADR 008: 多域记忆联邦

### P2（Phase 4 完成前必须完成）
- ADR 009: Eval 自代谢
- ADR 010: 分布式可靠性
- ADR 011: 伙伴系统数学

### P3（背景 ADR）
- ADR 001: Agent 调用方式
- ADR 003: 线程架构

---

## 4. ADR 决策者

| ADR 类别 | 决策者 | 备注 |
|---------|--------|------|
| 愿景类（013） | operator | 不可委托 |
| 命名类（012） | operator | 不可委托 |
| 架构类（002-011） | 架构师灵智体 + operator 审核 | 灵议 Mind Council 协助 |
| 应用层类（005） | operator + 架构师灵智体 | 涉及万物灵智体愿景 |
| 三方 Agent 类（006） | 架构师灵智体 + 三方厂商视角 | 灵议协助 |

---

## 5. ADR 引用约定

其他文档引用 ADR 使用：`[doc:decisions/0XX-title.md]`

示例：`[doc:decisions/004-capability-profile-routing.md]` 引用能力画像路由决策。
