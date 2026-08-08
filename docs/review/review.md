# 审核追溯索引（review.md）

> **文件性质**：本文件是审核记录的追溯索引，不是过程记录本身。
> **目的**：保留 spec.md / arch.md / design.md / features/F0XX / design/D0XX 等正式文档中对 `review/review.md#RA-XXX` / `#FM-XXX` / `#FR-XXX` / `#CL-XXX` 引用的路径有效性。
> **过程记录归档**：完整的审核过程记录、审核意见原文、修订历程已归档到 [`_archive/`](../_archive/) 目录，本文件仅提供归档导航。

---

## 1. 审核记录归档导航

### 1.1 spec 审核修订记录

| 版本 | 归档路径 | 主要内容 |
|------|---------|---------|
| v3.0 | [`_archive/spec-review-revisions-v3.0.md`](../_archive/spec-review-revisions-v3.0.md) | spec v3.0 审核修订记录 |
| v2.2 | [`_archive/spec-review-revisions-v2.2.md`](../_archive/spec-review-revisions-v2.2.md) | spec v2.2 审核修订记录 |
| v2.1 | [`_archive/spec-review-revisions-v2.1.md`](../_archive/spec-review-revisions-v2.1.md) | spec v2.1 审核修订记录 |

### 1.2 arch 审核修订记录

| 版本 | 归档路径 | 主要内容 |
|------|---------|---------|
| v2.1-v3.0 | [`_archive/arch-review-revisions-v2.1-v3.0.md`](../_archive/arch-review-revisions-v2.1-v3.0.md) | arch v2.1-v3.0 审核修订记录 |

### 1.3 设计审核快照

| 主题 | 归档路径 | 主要内容 |
|------|---------|---------|
| spec 审核 | [`_archive/spec-audit-2026-06-25.md`](../_archive/spec-audit-2026-06-25.md) | spec 审核快照（2026-06-25） |
| arch 审核 | [`_archive/arch-audit-2026-06-25.md`](../_archive/arch-audit-2026-06-25.md) | arch 审核快照（2026-06-25） |
| design 审核 | [`_archive/design-audit-2026-06-25.md`](../_archive/design-audit-2026-06-25.md) | design 审核快照（2026-06-25） |

### 1.4 v7.1 完整备份（含 review 引用上下文）

| 备份文件 | 归档路径 | 包含的 review 引用上下文 |
|---------|---------|----------------------|
| spec v7.1 完整备份 | [`_archive/spec_v71_full_backup_20260719.md`](../_archive/spec_v71_full_backup_20260719.md) | v7.1-§9 41 条 CL 同步矩阵 + 第十三章/第十四章深度补审 |
| arch v7.1 完整备份 | [`_archive/arch_v71_full_backup_20260719.md`](../_archive/arch_v71_full_backup_20260719.md) | RA-001~RA-042 / FM-001~FM-012 / FR-001~FR-004 审核意见上下文 |
| design v7.1 完整备份 | [`_archive/design_v71_full_backup_20260719.md`](../_archive/design_v71_full_backup_20260719.md) | 同上 |

---

## 2. 审核 ID 命名空间说明

本文件被 spec.md / arch.md / design.md / features/F0XX / design/D0XX 等正式文档引用，引用格式为 `[doc:review/review.md#<ID>]`。审核 ID 命名空间如下：

| ID 前缀 | 含义 | 数量范围 | 归档位置 |
|---------|------|---------|---------|
| `RA-XXX` | roleagent.md 补审意见 | RA-001 ~ RA-042 | _archive/spec_v71_full_backup_20260719.md（含上下文） |
| `FM-XXX` | forgemind 补审意见 | FM-001 ~ FM-012 | _archive/spec_v71_full_backup_20260719.md（含上下文） |
| `FR-XXX` | 可进化智能体可靠性治理补审意见 | FR-001 ~ FR-004 | _archive/spec_v71_full_backup_20260719.md（含上下文） |
| `CL-XXX` | 深度补审意见 | CL-001 ~ CL-041 | _archive/spec_v71_full_backup_20260719.md §v7.1-§9（同步矩阵） |

### 2.1 引用追溯示例

当正式文档中出现 `[doc:review/review.md#RA-013]` 时：
1. 该 ID 表示"roleagent.md 第 2 章补审第 13 条意见"
2. 完整审核意见原文已归档到 [`_archive/spec_v71_full_backup_20260719.md`](../_archive/spec_v71_full_backup_20260719.md)
3. 引用方（如 features/F005-at-mention-routing.md）已在文档内复述该意见的核心要点，读者可直接阅读引用方文档理解需求背景

---

## 3. 文件维护说明

- **本文件不记录审核过程**：审核过程记录已归档到 _archive/，本文件仅提供导航
- **本文件不承载审核意见原文**：审核意见原文已在引用方文档中复述，并在 _archive/ 中保留完整上下文
- **新增审核 ID**：当 _archive/ 中新增审核记录时，在本文件 §1 表格中追加归档路径
- **引用稳定性**：正式文档中的 `[doc:review/review.md#XXX]` 引用路径保持不变，确保追溯链不断裂
