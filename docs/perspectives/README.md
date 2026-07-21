# perspectives 视角文档

> **目录作用**: 存放多视角文档，从不同利益相关方角度阐述对 FlowForge 万物灵智体世界的理解，包括 operator 愿景、架构师画像、灵智体第一人称体验、三方 Agent 厂商视角等
> **维护规则**: 新增视角文档时按 `{视角}-{slug}.md` 或 `{Feature}/` 子目录组织；视角文档强调主观体验与方向性论述，不替代架构文档的客观描述

---

## 子目录与文档清单

### 核心视角文档（待创建）

| 文档 | 名称 | 状态 |
|------|------|------|
| `operator-vision.md` | operator 愿景视角（7 条不可妥协原则） | ⏳ |
| `architect-portrait.md` | 架构师画像视角（七层架构设计动机） | ⏳ |
| `forgekin-first-person.md` | 灵智体第一人称体验视角（觉醒/锻造/进化） | ⏳ |
| `third-party-agent-vendor.md` | 三方 Agent 厂商视角（claude code/codex/opencode/trae） | ⏳ |
| `end-user-experience.md` | 终端用户体验视角（万物灵智体交互） | ⏳ |
| `community-contributor.md` | 社区贡献者视角（开源治理参与路径） | ⏳ |

### Feature 关联视角（待创建）

| 子目录 | 名称 | 状态 |
|--------|------|------|
| `F209/` | 记忆召回优化视角（Phase D 定向文档） | ⏳ |

---

## 视角分类

| 视角类型 | 说明 | 代表文档 |
|---------|------|---------|
| **决策视角** | operator / 架构师的决策动机与原则 | `operator-vision.md`、`architect-portrait.md` |
| **主体视角** | 灵智体自身的第一人称体验 | `forgekin-first-person.md` |
| **外部视角** | 三方厂商 / 终端用户 / 社区贡献者 | `third-party-agent-vendor.md` 等 |
| **Feature 视角** | 单个 Feature 的阶段定向文档 | `F209/f209-phase-d-orientation.md` |

---

## 维护规则

- 视角文档以主观叙事为主，但不脱离 `[doc:VISION.md]` 愿景锚点与项目正式术语表
- Feature 关联视角按 `F{NNN}/` 子目录组织，与 `features/F{NNN}-{slug}.md` 对应
- 视角演进时不覆盖旧版本，按日期追加新文档（如 `F209/f209-phase-d-orientation.md`）
- 禁止在视角文档中做架构决策（决策须走 ADR 流程，见 `[doc:decisions/README.md]`）
- 禁止硬编码绝对路径，跨文档引用统一使用 `[doc:perspectives/xxx.md]` 格式
- 视角文档变更须同步更新 `[doc:VISION.md]` 中关联章节

---

## 延伸阅读

- `[doc:VISION.md]` — 万物灵智体愿景（operator 7 条不可妥协原则）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 万物灵智体愿景 ADR
- `[doc:roleagent.md]` — 多智能体工程路径白皮书
