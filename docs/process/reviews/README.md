# reviews/ — 审查记录产物目录（review 阶段）

七阶段流程 `review` 阶段的产物落点：两阶段审查记录（阶段 1 规格符合性 +
阶段 2 代码质量），P1/P2/P3 分级与处置、跨模型评审约束、AI→人工降级记录。

## 命名约定

- 标准格式：`<instance-name>.md`（与流程实例同名，例：`ep0-1.md`）
- 模板：`docs/process/templates/review-template.md`

## 规则

- P1（阻断）/P2（技术缺陷）未清零 = 任务未完成（两阶段裁决缺一不可）。
- P3（风格建议）可延后，不阻塞。
- 审查者应与实现者来自不同模型族（跨模型评审约束）。
- 审查范围从任务起始 commit 起（`baseSha..headSha`），禁止只看 HEAD~1。
