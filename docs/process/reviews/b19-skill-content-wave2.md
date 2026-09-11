# review: B19 技能内容资产二波迁移（wave 2）

> 实例：`b19-skill-content-wave2` ｜ 规格：`docs/process/specs/2026-09-11-b19-skill-content-wave2-design.md` ｜ 计划：`docs/process/plans/2026-09-11-b19-skill-content-wave2.md`

## 审查范围

- 4 个开发流程域核心技能包内容资产迁入 `packages/forgekin/governance/skills/`（tdd / writing-plans / quality-gate / merge-gate）。
- `manifest.yaml` wave1 4 包 + wave2 4 包共 8 包路由（category/description/triggers）。
- `README.md` 追加 wave 2 P0 命名映射 + 批次登记。
- 契约测试 `tests/b19-skill-content-wave2.spec.ts`。

## 规格合规（spec 核对）

- 框架零改动：未触碰 `skill-meta.ts` / `skill-query.ts`，仅新增内容与测试 ✅
- 4 包 SKILL.md 在位，frontmatter 原样迁移；manifest 结构对齐 `parseManifestSkillMeta` 的 `skills:` map ✅
- 命名契约：README 追加 4 包 P0 官方名 + 中文对照，正文无社交/别名语 ✅
- DoD 1-5：readSkillMeta 解析 / manifest ≥8 键 / querySkill detail / 测试+tsc+oxlint 全绿 / README 命名映射 ✅

## 代码质量（契约测试审查）

- 测试真实读文件（skillsSource 锚定仓库根），无 Mock ✅
- `process.cwd()` 锚定路径（vitest 转译下稳定），断言覆盖三消费面 ✅
- wave2 断言集与 wave1 同构，仅扩至 4 新包；含 indicate≥8 的合并路由断言 ✅

## 实现过程中的关键处置（经验记录）

1. **EOL 陷阱复现与规避**：源 `SKILL.md` 为 CRLF，frontmatter 正则仅匹配 LF；延续 wave1 做法，内容不变仅 EOL→LF 规范化，契约测试锁定。
2. **YAML 块标量**：manifest `description` 统一使用 `>` 折叠块标量，规避多行内含冒号的解析失败（同 wave1 处置）。
3. **打包测试**：wave1 测试已在仓库根通过；wave2 测试同样从仓库根跑通，路径锚定稳定无回归。

## 验收结论

全部通过：3/3 契约测试、包级 tsc exit 0、oxlint 0（16 files）。B19 wave 2 可接受。