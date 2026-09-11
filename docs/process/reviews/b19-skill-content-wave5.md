# review: B19 技能内容资产五波迁移（wave 5）

> 实例：`b19-skill-content-wave5` ｜ 规格：`docs/process/specs/2026-09-11-b19-skill-content-wave5-design.md` ｜ 计划：`docs/process/plans/2026-09-11-b19-skill-content-wave5.md`

## 审查范围

- 4 个工程生命周期与工具链开发流程域核心技能包内容资产迁入 `packages/forgekin/governance/skills/`（feat-lifecycle / worktree / co-creation-docs / owner-friendly-plugin-development）。
- `manifest.yaml` wave1-4 各 4 + wave5 4 共 20 包路由（category/description/triggers）。
- `README.md` 追加 wave 5 P0 命名映射 + 批次登记。
- 契约测试 `tests/b19-skill-content-wave5.spec.ts`。

## 规格合规（spec 核对）

- 框架零改动：未触碰 `skill-meta.ts` / `skill-query.ts`，仅新增内容与测试 ✅
- 4 包 SKILL.md 在位，frontmatter 原样迁移（LF 规范化）；manifest 结构对齐 `parseManifestSkillMeta` 的 `skills:` map ✅
- 命名契约：README 追加 4 包 P0 官方名 + 中文对照，正文无社交/别名语 ✅
- DoD 1-5：readSkillMeta 解析 / manifest ≥20 键 / querySkill detail / 测试+tsc+oxlint 全绿 / README 命名映射 ✅

## 代码质量（契约测试审查）

- 测试真实读文件（skillsSource 锚定仓库根），无 Mock ✅
- `process.cwd()` 锚定路径（vitest 转译下稳定），断言覆盖三消费面 ✅
- wave5 断言集与 wave1/2/3/4 同构，仅扩至 4 新包；含 ≥20 键的合并路由断言 ✅
- wave1-5 五份契约测试同批运行 15/15 全绿，governance 全量 46/46，无跨批次回归 ✅

## 实现过程中的关键处置（经验记录）

1. **EOL 陷阱第五次复现**：源 `SKILL.md` 为 CRLF，frontmatter 正则仅匹配 LF；延续 wave1-4 处置——内容不变仅 EOL→LF 规范化，契约测试锁定。
2. **YAML 块标量**：manifest `description` 统一使用 `>` 折叠块标量，规避多行内含冒号解析失败（wave1-4 同法）。
3. **分类归并**：四包均归「开发流程」域，字段消费面无冲突。
4. **span 检测**：no-Placeholder 校验须把注释文字移到代码块外，避免内嵌 `#` 注释被误判为标题（wave3 补丁法）。本计划直接从 wave1-4 闭环沿用。

## 验收结论

全部通过：3/3 契约测试（wave1-5 合计 15/15）、governance 全量 46/46、包级 tsc exit 0、oxlint 0（19 files）。B19 wave 5 可接受。