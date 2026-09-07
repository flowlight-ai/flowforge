# verifications/ — 验证证据产物目录（verify 阶段）

七阶段流程 `verify` 阶段的产物落点；`ff_dev evidence <name> --command "..." --exit 0
--summary "..."` 追加证据条目，是 verify→finish 硬门禁（verificationEvidence）的唯一输入。

## 命名约定

- 标准格式：`<instance-name>.md`（与流程实例同名）
- 模板：`docs/process/templates/verification-template.md`
- 条目结构：命令 / 退出码 / 输出摘要 / 耗时 / ISO 时间戳

## 铁律（verification-before-completion ⑩）

- 没有新鲜的验证证据，就没有完成宣称；失败证据（exit ≠ 0）禁止登记为通过。
- 摘要必须带具体数字（几条测试、几秒），禁止"跑过了"式描述（T3）。
- verify 硬门禁对一切工作流（含 hotfix fastpass）永不豁免。
