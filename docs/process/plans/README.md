# plans/ — 实施计划产物目录（plan 阶段）

七阶段流程 `plan` 阶段的产物落点；`ff_dev gate <name> plan --evidence <本目录文件>`
在 No-Placeholder 校验通过后打开 planValidated 门禁（plan→implement 唯一通道）。

## 命名约定

- 标准格式：`YYYY-MM-DD-<feature>.md`（例：`2026-09-07-plugin-dev-cli.md`）
- 模板：`docs/process/templates/plan-template.md`
- 铁律：禁止 TBD/TODO/待补充/"类似任务 N" 等占位与惰性引用（writing-plans ②），
  `ff_doctor plan <path>` 与 `ff_dev gate plan` 双重拦截。

## 校验

任务头五要素（Goal/Architecture/Tech Stack/Spec 引用/Global Constraints）+ 任务级
checkbox 步骤 + 每任务含代码块与测试步骤（hotfix fastpass 豁免代码/测试项，不豁免占位符）。
