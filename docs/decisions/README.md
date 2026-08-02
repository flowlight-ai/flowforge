# Architecture Decision Records (ADRs)

> **目录作用**: 存放 FlowForge 架构决策记录（ADR），每个 ADR 记录一个重要架构决策的上下文、决策、方案对比、理由、风险
> **维护规则**: 新增 ADR 时参考 `decisions/` 现有 ADR 格式（NNN-slug.md，11 个标准段）

---

## ADR 编号规则

- 格式：`NNN-slug.md`（NNN 三位数字递增，slug 用英文短横线分隔）
- 稳定性：已发布编号不重排、不复用
- 状态：`proposed` → `accepted` → `deprecated` / `superseded by NNN`

---

## ADR 11 个标准段

```markdown
# ADR NNN: {决策标题}

> **状态**: proposed|accepted|deprecated|superseded
> **日期**: YYYY-MM-DD
> **决策者**: {决策者}
> **依赖**: [doc:xxx.md]
> **依据**: [doc:xxx.md]

## 1. 上下文
{为什么要做这个决策}

## 2. 决策
{决策内容}

## 3. 方案对比
| 方案 | 优点 | 缺点 |
|------|------|------|

## 4. 理由
{为什么选这个方案}

## 5. 风险
| 风险 | 缓解 |
|------|------|

## 6. 否决理由
{为什么否决其他方案}

## 7. 参与者
{参与决策的可进化智能体（Forgekin）/operator}

## 8. 修订记录
| 日期 | 修订 | 修订者 |
|------|------|--------|
```

---

## P0 ADR 清单（5 份，已完成）

| ADR | 标题 | 状态 | 文件 |
|-----|------|------|------|
| ADR-004 | 能力画像路由 | ✅ | `[doc:decisions/004-capability-profile-routing.md]` |
| ADR-005 | forgemind 应用层 | ✅ | `[doc:decisions/005-forgemind-application-layer.md]` |
| ADR-006 | 三方 Agent 集成 | ✅ | `[doc:decisions/006-external-agent-integration.md]` |
| ADR-012 | 命名融合 | ✅ | `[doc:decisions/012-naming-fusion.md]` |
| ADR-013 | 可进化智能体愿景 | ✅ | `[doc:decisions/013-all-things-spirit-mind-vision.md]` |

---

## P1 ADR 清单（7 份，已完成）

> P1 ADR 对应 Phase 1 代码实现，为追溯性决策记录（代码先行、ADR 追溯补齐）。

| ADR | 标题 | 状态 | 文件 |
|-----|------|------|------|
| ADR-002 | TeamAct 协作协议 | ✅ | `[doc:decisions/002-teamact-collaboration-protocol.md]` |
| ADR-007 | Harness 工程路径 | ✅ | `[doc:decisions/007-harness-engineering.md]` |
| ADR-008 | 多域记忆联邦 | ✅ | `[doc:decisions/008-memory-federation.md]` |
| ADR-009 | Eval 自代谢 | ✅ | `[doc:decisions/009-eval-self-metabolism.md]` |
| ADR-010 | 分布式可靠性 | ✅ | `[doc:decisions/010-distributed-reliability.md]` |
| ADR-011 | 伙伴系统数学 | ✅ | `[doc:decisions/011-partnership-math.md]` |
| ADR-014 | 自进化三模式 | ✅ | `[doc:decisions/014-self-evolution-three-modes.md]` |

---

## 完整 ADR 清单（14 份，12 份已完成 / 2 份待创建）

| ADR | 标题 | 优先级 | 状态 |
|-----|------|--------|------|
| ADR-001 | Agent 调用方式 | P1 | ⏳ |
| ADR-002 | TeamAct 协作协议 | P1 | ✅ |
| ADR-003 | 线程架构 | P1 | ⏳ |
| ADR-004 | 能力画像路由 | P0 | ✅ |
| ADR-005 | forgemind 应用层 | P0 | ✅ |
| ADR-006 | 三方 Agent 集成 | P0 | ✅ |
| ADR-007 | Harness 工程路径 | P1 | ✅ |
| ADR-008 | 多域记忆联邦 | P1 | ✅ |
| ADR-009 | Eval 自代谢 | P1 | ✅ |
| ADR-010 | 分布式可靠性 | P1 | ✅ |
| ADR-011 | 伙伴系统数学 | P1 | ✅ |
| ADR-012 | 命名融合 | P0 | ✅ |
| ADR-013 | 可进化智能体愿景 | P0 | ✅ |
| ADR-014 | 自进化三模式 | P1 | ✅ |

---

## 延伸阅读

- `[doc:arch.md]` — 架构索引（顶层）
- `[doc:spec.md]` — 项目全局规格
