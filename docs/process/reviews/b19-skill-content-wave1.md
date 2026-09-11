# review: B19 技能内容资产首波迁移（wave 1）

> 实例：`b19-skill-content-wave1` ｜ 规格：`docs/process/specs/2026-09-11-b19-skill-content-wave1-design.md` ｜ 计划：`docs/process/plans/2026-09-11-b19-skill-content-wave1.md`

## 审查范围

- 4 个核心技能包内容资产迁入 `packages/forgekin/governance/skills/`（deep-research / expert-panel / cross-cat-handoff / debugging）。
- `manifest.yaml` 4 包路由（category/description/triggers）。
- `README.md` 目录约定 + P0 命名映射 + 批次登记。
- 契约测试 `tests/b19-skill-content.spec.ts`。

## 规格合规（spec 核对）

- 框架零改动：未触碰 `skill-meta.ts` / `skill-query.ts`，仅新增内容与测试 ✅
- 4 包 SKILL.md 在位，frontmatter 原样迁移；manifest 结构对齐 `parseManifestSkillMeta` 的 `skills:` map ✅
- 命名契约：README 提供 4 包 P0 官方名 + 中文对照，正文无社交/别名语 ✅
- DoD 1-5：readSkillMeta 解析 / manifest 4 键 / querySkill detail / 测试+tsc+oxlint 全绿 / README 命名映射 ✅

## 代码质量（契约测试审查）

- 测试真实读文件（skillsSource 锚定仓库根），无 Mock ✅
- `import.meta.url`→`process.cwd()` 锚定路径（vitest 转译下稳定）✅
- 断言覆盖三消费面：readSkillMeta / parseManifestSkillMeta / querySkill ✅

## 实现过程中的关键处置（经验记录）

1. **换行符（EOL）陷阱**：clowder 源 `SKILL.md` 为 CRLF，而 `readSkillMeta` 的 frontmatter 正则 `^---\n...` 仅匹配 LF → frontmatter 解析静默失败返回 `{}`。处置：内容不变仅规范化 EOL→LF（不改框架），契约测试锁定。
2. **YAML 块标量缩进**：manifest `description` 初始用普通多行标量，内含 `Use when:` 冒号导致 YAML 解析失败返回空 map；改为 `>` 折叠块标量（同源 manifest 写法）后解析正常。
3. **vitest 路径锚定**：`__dirname` 在 ESM 下不可用；`import.meta.url` 在 vitest 转译下不可靠。最终以 `process.cwd()`（仓库根）为准，测试从根跑通。

## 验收结论

全部通过：3/3 契约测试、包级 tsc exit 0、oxlint 0（15 files）。B19 wave 1 可接受。