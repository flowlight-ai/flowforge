# 设计文档：B19 技能内容资产首波迁移（wave 1）

> 实例：`b19-skill-content-wave1`
> 依据：review_code.md B19 行 / Q5 裁决（Q5，2026-09-10：技能框架已落地，内容资产按命名契约随 B8 技能域分批补齐，核心包优先）
> 日期：2026-09-11 ｜ 状态：设计稿
> 分级：Bounded（内容资产迁移，格式受既有框架 `readSkillMeta`/`parseManifestSkillMeta` 约束）

## 1. 目标（Goal）

按 Q5 裁决启动 B19「核心包优先」首波：把 clowder `cat-cafe-skills/` 四个核心技能包的内容资产迁入 FlowForge，作为 `forgekin/governance` 技能内容源（skillsSource）的第一批落地内容，并让既有技能查询框架（skill-meta/skill-query）能读取它们。

## 2. 架构（Architecture）

```
packages/forgekin/governance/skills/          ← 本批新落地 skillsSource
├── README.md        # 目录约定 + 命名契约(P0 官方名锚定) + 后续批次登记
├── manifest.yaml    # 4 包路由（category/description/triggers），供 parseManifestSkillMeta
└── <name>/SKILL.md  # 4 个核心技能包正文（deep-research/expert-panel/cross-cat-handoff/debugging）
```

- 框架消费面零改动：`readSkillMeta(<skills>/<name>)` 读 `SKILL.md` frontmatter；`parseManifestSkillMeta(<skills>)` 读 `manifest.yaml` `skills:` map——两者均已实现，本批只喂数据。
- `querySkill(projectRoot, name, skillsSource)` 以 skillsSource 显式传入，本批目录即其默认内容源之一。

## 3. 内容与命名契约（Content & Naming）

- **正文**：4 个 `SKILL.md` 逐包原样迁入（策展 prompt 内容为现存真相，不做正文改写——改写有破坏前文案风险）。frontmatter 与 `readSkillMeta` 解析兼容性由契约测试锁定。
- **manifest.yaml**：仅抽取 4 包路由元数据（category/description/triggers），结构对齐 `parseManifestSkillMeta` 的 `skills:` 顶层键。
- **命名契约（naming-contract.md）**：技能目录名沿用源 `kebab-case` id；官方能力概念名（P0）与中文官方名锚定落在 `README.md` 命名映射表，不在 SKILL.md 正文强改。社交/别名语（如灵智系列）不出现于本目录正式内容。

## 4. 技术栈（Tech Stack）

内容资产（Markdown + YAML）+ 契约测试（vitest，真实文件）。

## 5. 全局约束

- 不修改框架代码（skill-meta/skill-query 零改动）；仅新增内容与测试。
- 命名契约严守：本目录正式内容只用官方概念名，中文名对照 naming-contract。
- 契约测试真实读文件，不 Mock。

## 6. 交付物清单（Deliverables）

1. `skills/deep-research/SKILL.md`、`expert-panel/SKILL.md`、`cross-cat-handoff/SKILL.md`、`debugging/SKILL.md`（原样内容）。
2. `skills/manifest.yaml`（4 包路由）。
3. `skills/README.md`（目录约定 + P0 命名映射 + 批次登记表）。
4. 契约测试：`readSkillMeta` 读 4 包 frontmatter 非空 + `parseManifestSkillMeta` 能解析 4 键 + `querySkill` 返回细节。

## 7. 决策门（DCP）

| 方案 | 京东 | 依据 |
|---|---|---|
| 落 `governance/skills/`（本设计） | ✅ | 与 B8 skill-meta/query 同域，技能框架就近；B20 类比 assets 目录 |
| 落仓库根 `skills/` / `forgekin/sop` | 备选 | 全局源 / 与 SOP 同仓，均可后续 wave 调整，不影响本波 |

**结论**：首波采用 `governance/skills/`；后续 wave 如需全局源可在 manifest 层叠加。

## 8. 验收（DoD）

1. 4 包 SKILL.md 已在位且 `readSkillMeta` 能解析（description + triggers 非空）。
2. `manifest.yaml` 4 键被 `parseManifestSkillMeta` 正确解析。
3. `querySkill` 对 4 包返回 detail。
4. 契约测试全绿、tsc exit 0、oxlint 0。
5. `README.md` 命名映射含 4 包 P0 官方名与中文对照。