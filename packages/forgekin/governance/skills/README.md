# governance/skills — 技能内容源（SkillsSource）

B19 技能内容迁入目录。每包一个 `<kebab-case-id>/SKILL.md`，路由元数据集中在 `manifest.yaml`。
框架消费面零改动：`readSkillMeta(<skills>/<name>)` 读 SKILL.md frontmatter；`parseManifestSkillMeta(<skills>)` 读 manifest.yaml `skills:` map。

## 目录约定

- 一包一目录：`<id>/SKILL.md`（正文原样迁入，不做改写——保 frontmatter 与 `readSkillMeta` 解析兼容）。
- 路由单一真源：`manifest.yaml` 的 `skills:` map（category / description / triggers），对齐 `parseManifestSkillMeta` 消费面。
- 分波登记：每波在「批次登记」追加；本目录为 wave 1 起点。

## 命名映射（P0 官方名锚定，对照 naming-contract.md）

| 目录 id | 官方能力概念名 | 中文对照 |
|---|---|---|
| deep-research | Deep Research | 深度调研 |
| expert-panel | Expert Panel | 专家评审团 |
| cross-cat-handoff | Cross-cat Handoff | 跨智能体交接 |
| debugging | Systematic Debugging | 系统化调试 |

> 本目录正式内容仅使用官方概念名与中文对照；社交/别名语（如灵智系列别称）不进入本目录正文。

## 批次登记

- **wave 1**（2026-09-11）：`deep-research` / `expert-panel` / `cross-cat-handoff` / `debugging` 四核心包内容迁入（B19 首波）。
- 后续 wave：按 B8 技能域分批补齐其余核心包（见 review_code.md §15 Q5）。