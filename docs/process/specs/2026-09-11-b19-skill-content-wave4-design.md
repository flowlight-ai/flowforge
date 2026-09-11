# 设计文档：B19 技能内容资产四波迁移（wave 4）

> 实例：`b19-skill-content-wave4`
> 依据：review_code.md B19 行 / Q5 裁决（2026-09-10：技能框架已落地，内容资产按命名契约随 B8 技能域分批补齐，核心包优先）
> 日期：2026-09-11 ｜ 状态：设计稿
> 分级：Bounded（内容资产迁移，格式受既有框架 `readSkillMeta`/`parseManifestSkillMeta` 约束）

## 1. 目标（Goal）

wave 1 调研/协作/交接/调试；wave 2 工程流程 tdd/计划/自检/合入；wave 3 评审反馈环四包。wave 4 承接「核心包优先」第四波，聚焦**协作与编排域**四个核心包：`thread-orchestration` / `cross-thread-sync` / `collaborative-thinking` / `custody-recognition`，迁入 `forgekin/governance/skills/`，让既有技能查询框架能读取。

## 2. 架构（Architecture）

```
packages/forgekin/governance/skills/
├── README.md        # 追加 wave 4 命名映射 + 批次登记（wave 1/2/3 已登记）
├── manifest.yaml    # wave 1-3 各 4 包 + wave 4 4 包路由 = 16 键
├── thread-orchestration/SKILL.md
├── cross-thread-sync/SKILL.md
├── collaborative-thinking/SKILL.md
└── custody-recognition/SKILL.md
```

- 框架消费面零改动：`readSkillMeta(<skills>/<name>)` 读 SKILL.md frontmatter；`parseManifestSkillMeta(<skills>)` 读 `manifest.yaml` `skills:` map——均已实现，本批只追加内容 + manifest 键。
- `querySkill(projectRoot, name, skillsSource)` 以 skillsSource 显式传入，本批目录即其内容源之一。

## 3. 内容与命名契约（Content & Naming）

- **正文**：4 个 `SKILL.md` 逐包原样迁入（策展 prompt 内容为现存真相，不做正文改写）。frontmatter 与 `readSkillMeta` 解析兼容性由契约测试锁定。源文件换行为 CRLF → 需规范化为 LF（wave 1/2/3 已确证框架正则仅匹配 LF）。
- **manifest.yaml**：在 wave 1+2+3 `skills:` map 基础上追加 4 包路由元数据，结构对齐 `parseManifestSkillMeta`。
- **命名契约（naming-contract.md）**：技能目录名沿用源 `kebab-case` id；官方能力概念名（P0）与中文官方名锚定落在 `README.md` 命名映射表，不在 SKILL.md 正文强改。社交/别名语不出现在正式内容。

## 4. 技术栈（Tech Stack）

内容资产（Markdown + YAML）+ 契约测试（vitest，真实文件）。

## 5. 全局约束

- 不修改框架代码（skill-meta/skill-query 零改动）；仅新增内容与测试。
- 命名契约严守：本目录正式内容只用官方概念名，中文名对照 naming-contract。
- 契约测试真实读文件，不 Mock。

## 6. 交付物清单（Deliverables）

1. `skills/thread-orchestration/SKILL.md`、`cross-thread-sync/SKILL.md`、`collaborative-thinking/SKILL.md`、`custody-recognition/SKILL.md`（原样内容，LF）。
2. `skills/manifest.yaml` 追加（wave 1-3 各 4 + wave 4 4 = 16 键）。
3. `skills/README.md` 追加（wave 4 命名映射 + 批次登记）。
4. 契约测试：`readSkillMeta` 读 4 包 frontmatter 非空 + `parseManifestSkillMeta` 解析 wave 4 4 键（合计 ≥16） + `querySkill` 返回 detail。

## 7. 决策门（DCP）

| 方案 | 判定 | 依据 |
|---|---|---|
| 协作与编排域（thread-orchestration / cross-thread-sync / collaborative-thinking / custody-recognition）为 wave 4 | ✅ | 四包构成多 agent 主动拆解编排→跨线程协同→思辨收敛→接球权识别的编排闭环；接 wave 1 交接域 / wave 3 协作侧 |
| 记忆与导航域（memory-navigation / proactive-memory-judgment / context-self-management 等） | 备选 | 可作为记忆侧专项 wave，不影响本波 |
| 进化域（self-evolution / capability-evolution / feat-lifecycle 等） | 备选 | 可作后续 wave，不影响本波 |

**结论**：wave 4 采用协作与编排域 4 包；其余核心包留待后续 wave。

## 8. 验收（DoD）

1. 4 包 SKILL.md 已在位且 `readSkillMeta` 能解析（description + triggers 非空）。
2. `manifest.yaml` wave 4 4 键被 `parseManifestSkillMeta` 正确解析（合计 ≥16 键）。
3. `querySkill` 对 wave 4 4 包返回 detail。
4. 契约测试全绿、tsc exit 0、oxlint 0。
5. `README.md` 命名映射追加 wave 4 4 包 P0 官方名与中文对照。