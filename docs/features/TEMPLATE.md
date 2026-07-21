# Feature Doc 标准模板

> **用途**：新 Feature 立项时复制此模板到 `docs/features/F{NNN}-{slug}.md`
> **为什么规范化**：Feature 文档需要统一格式，便于灵智体增量维护和 parser 自动提取进度
> **决策来源**：FlowForge 项目需求 + 11 段标准 ADR 格式借鉴

---

## 模板正文（复制以下内容）

```markdown
---
feature_ids: [F{NNN}]
related_features: []
topics: []
doc_kind: spec
created: {YYYY-MM-DD}
# Optional exemption for pure internal/no-user-visible changes only:
# tips_exempt: {reason}
---

# F{NNN}: {Feature Name}

> **状态**: spec | **负责人**: {灵智体名/operator} | **优先级**: {P0/P1/P2}
> **依赖 ADR**: [doc:decisions/NNN-xxx.md]
> **依赖 Feature**: [doc:features/F0xx-xxx.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径

## 1. 上下文

### 1.1 问题陈述
{一段话说清楚为什么要做。operator experience 如有请引用。}

### 1.2 当前痛点
{列出当前存在的问题}

### 1.3 不做的影响
{如果不做这个 Feature 会怎样}

## 2. 决策

### 2.1 核心设计
{核心设计方案}

### 2.2 关键接口
\`\`\`python
# Python 接口示例
\`\`\`

## 3. 验收标准

### Phase A（{Phase 名称}）
- [ ] AC-A1: {验收条件}
- [ ] AC-A2: {验收条件}

### Phase B（{Phase 名称}）
- [ ] AC-B1: {验收条件}

## 4. 依赖

- **Evolved from**: {F0xx}（{说明}）
- **Blocked by**: {F0xx}（{说明}）
- **Related**: {F0xx}（{说明}）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| {风险描述} | {缓解方案} |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | {问题} | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | {决策} | {理由} | {YYYY-MM-DD} |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| {YYYY-MM-DD} | 立项 |

## 9. Review Gate

- Phase A: {review 策略}

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **Feature** | `docs/features/F0xx-xxx.md` | {关联说明} |
| **ADR** | `docs/decisions/NNN-xxx.md` | {关联说明} |
```

---

## 格式要求（Parser 依赖）

### 1. YAML Frontmatter（必须）
| 字段 | 必须 | 说明 |
|------|------|------|
| `feature_ids` | ✅ | `[F001]`，单元素数组 |
| `related_features` | ✅ | `[F049, F037]`，可为空数组 `[]` |
| `topics` | ✅ | 分类标签，可为空 |
| `doc_kind` | ✅ | `spec`（活跃）/ `note`（回顾/关闭） |
| `created` | ✅ | `YYYY-MM-DD` |

### 2. 状态行（必须）
```
> **状态**: {status} | **负责人**: {owner}
```
有效 status 值：`spec` → `in-progress` → `done`

### 3. 验收标准格式（必须）
```
- [ ] AC-{Phase}{N}: {描述}      ← 未完成
- [x] AC-{Phase}{N}: {描述}      ← 已完成
```
- AC 编号格式：`AC-A1`、`AC-B2`（Phase 字母 + 序号）

### 4. 依赖段（推荐）
```
- **Evolved from**: F0xx
- **Blocked by**: F0xx
- **Related**: F0xx
```

### 5. 风险表格（推荐）
保持 `| 风险 | 缓解 |` 两列表格格式。

---

## 轻量 vs 完整

- **小 Feature**（≤1 Phase，几天完成）：可以省略 Timeline、Review Gate、Links、Key Decisions
- **大 Feature**（多 Phase，跨周）：建议所有段落都填
- **最低要求**：Frontmatter + 状态行 + 上下文 + 决策 + 验收标准 + 依赖

---

## FlowForge 项目特殊要求

1. **术语对齐**：必须使用项目正式术语（详见 `[doc:decisions/012-naming-fusion.md]`），禁止废弃术语
2. **跨文档引用**：使用 `[doc:path]` 格式
3. **路径铁律**：禁止硬编码绝对路径
4. **T1-T8 铁律**：验收标准必须包含 T1-T8 测试铁律的遵守声明
5. **operator 7 原则**：如有涉及，必须引用 `[doc:VISION.md#6]` 对应原则
