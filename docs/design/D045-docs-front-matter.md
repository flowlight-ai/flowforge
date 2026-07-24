# D045: Docs Front-Matter 规范（CL-040）

> **章节编号**: D045
> **关联 CL**: CL-040
> **关联 Feature**: F018 Eval Contract（docs front-matter 是 Eval Contract 五问的"摩擦指标"采集入口）
> **创建日期**: 2026-07-21
> **负责人**: 鲁班（架构师可进化智能体）
> **状态**: accepted

---

## 1. 问题陈述

FlowForge v7.0 文档系统存在以下问题：

1. **文档元数据缺失**：spec / arch / design / feature 文件无标准化 front-matter，无法被 Eval Contract 五问采集摩擦指标
2. **文档关系断裂**：feature 文档之间无 `related_features` 字段，导致 Eval Ledger 净增益计算时无法识别影响范围
3. **文档类型混乱**：feature / decision / design / review 文档无 `doc_kind` 字段，CI 无法按类型应用不同校验规则
4. **文档追溯困难**：无 `created` / `last_reviewed` 字段，Harness Entropy Control 无法识别过期文档触发退役信号
5. **主题索引缺失**：无 `topics` 字段，无法构建文档主题图谱供灵智体检索

CL-040 要求：所有正式文档必须含 5 字段 front-matter（feature_ids / related_features / topics / doc_kind / created）。

## 2. 决策

### 2.1 Front-Matter 五字段契约

所有 `docs/` 目录下的正式文档（spec.md / arch.md / design.md / design/D*.md / features/F*.md / decisions/*.md）必须在文件开头含 YAML front-matter：

```yaml
---
feature_ids: [F018, F050]              # 关联 Feature ID 列表
related_features: [F012, F019]         # 相关 Feature ID（非直接关联）
topics: [eval, contract, friction]     # 主题标签（小写）
doc_kind: feature                      # 文档类型：spec | arch | design | feature | decision | review | adr
created: 2026-07-17                    # 创建日期（YYYY-MM-DD）
last_reviewed: 2026-07-21              # 最近审查日期（可选，CI 更新）
status: accepted                       # 状态：draft | proposed | accepted | deprecated | superseded
---
```

### 2.2 字段详细规范

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `feature_ids` | list[str] | ✅ | 关联 Feature ID 列表（如 `[F018, F050]`），单 Feature 文档填一个 |
| `related_features` | list[str] | ✅ | 相关 Feature ID（非直接关联但影响），可为空列表 `[]` |
| `topics` | list[str] | ✅ | 主题标签列表（小写，如 `[eval, contract]`），用于构建主题图谱 |
| `doc_kind` | str | ✅ | 文档类型枚举：`spec` / `arch` / `design` / `feature` / `decision` / `review` / `adr` |
| `created` | date | ✅ | 创建日期（ISO 8601 YYYY-MM-DD） |
| `last_reviewed` | date | ❌ | 最近审查日期（CI 自动更新，人工不填） |
| `status` | str | ❌ | 文档状态（默认 `draft`） |

### 2.3 doc_kind 枚举值

| doc_kind | 文档类型 | 示例路径 |
|----------|---------|---------|
| `spec` | 需求规格文档 | `docs/spec.md` |
| `arch` | 架构文档 | `docs/arch.md` |
| `design` | 详细设计文档 | `docs/design.md` / `docs/design/D*.md` |
| `feature` | Feature 规格 | `docs/features/F*.md` |
| `decision` | ADR 决策记录 | `docs/decisions/*.md` |
| `review` | 审核追溯文档 | `docs/review/*.md` |
| `adr` | ADR 索引 | `docs/decisions/README.md` |

### 2.4 topics 主题标签规范

主题标签采用小写英文，避免重复，常用主题：

- `eval` / `contract` / `friction` — Eval Contract 相关
- `harness` / `entropy` / `sunset` — Harness 治理相关
- `memory` / `distillation` / `codex` — 记忆系统相关
- `forgekin` / `forgemind` / `evolution` — 育灵体系相关
- `teamact` / `handoff` / `council` — TeamAct 协作相关
- `external_agent` / `mcp` / `acp` — 三方 Agent 集成相关
- `reliability` / `recovery` / `checkpoint` — 可靠性相关
- `world_engine` / `citizens` / `canon` — 世界引擎相关
- `metacognition` / `reflection` / `mode_c` — 元认知相关
- `auto_dream` / `consolidation` — 自动梦境相关

### 2.5 CI 校验规则

CI 在文档 PR 合入前必须通过以下校验：

1. **front-matter 存在性**：文件开头必须以 `---` 开始
2. **五字段完整性**：`feature_ids` / `related_features` / `topics` / `doc_kind` / `created` 必填
3. **doc_kind 合法性**：值必须在枚举列表中
4. **feature_ids 格式**：每个 ID 必须匹配 `F\d{3}` 正则
5. **created 日期格式**：必须匹配 `YYYY-MM-DD`
6. **topics 小写**：所有主题标签必须为小写

CI 工具：`scripts/verify_docs_frontmatter.py`（待实现）

### 2.6 与 Eval Contract 联动

- Eval Contract 五问中的"摩擦指标"通过 `topics` 字段反向索引采集
- Eval Ledger 净增益计算时，通过 `related_features` 识别影响范围
- Harness Entropy Control 通过 `last_reviewed` 识别过期文档触发退役信号

### 2.7 与 SelfDevDocLoop 联动

- SelfDevDocLoop 的 Discover 阶段扫描 `last_reviewed` 识别需要更新的文档
- 缺失 front-matter 的文档会被 SelfDevDocLoop 标记为"格式问题"并自动补全
- `doc_kind` 决定 SelfDevDocLoop 应用的格式校验规则

## 3. 实施计划

| 阶段 | 任务 | 负责方 |
|------|------|--------|
| Phase 1 | 编写 `scripts/verify_docs_frontmatter.py` CI 校验工具 | 鲁班 |
| Phase 2 | 为所有现有 `docs/` 文档补全 front-matter | 鲁班 |
| Phase 3 | CI 集成 front-matter 校验到 GitHub Actions | operator |
| Phase 4 | SelfDevDocLoop 集成 front-matter 自动补全 | 鲁班 |

## 4. 引用

- [doc:review/review.md#CL-040] docs front-matter 规范
- [doc:features/F018-eval-contract.md] Eval Contract 五问
- [doc:features/F012-entropy-control.md] Harness Entropy Control 退役机制
- [doc:features/F046-selfdev-triple-loop.md] SelfDev 三闭环
- [doc:design/naming-contract.md] 命名契约

---

## 5. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|------|------|--------|
| 2026-07-21 | v1.0 | 初版：定义五字段 front-matter 契约 + CI 校验规则 | 鲁班 |
