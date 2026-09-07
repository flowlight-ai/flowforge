# specs/ — 设计文档产物目录（design 阶段）

七阶段流程 `design` 阶段的产物落点；`ff_dev gate <name> design --evidence <本目录文件>`
以此处文件作为 designApproved 门禁证据。

## 命名约定

- 标准格式：`YYYY-MM-DD-<topic>-design.md`（例：`2026-09-07-plugin-dev-design.md`）
- 模板：`docs/process/templates/design-template.md`（含 DCP-1/DCP-2 决策门记录块）
- 结构要求：目标 / 架构（F/A/D 分层）/ 技术栈 / 规范引用 / 全局约束 / 决策门签核

## 治理规则

- 文档入库提交（与实例状态文件同批），是跨工具接续的真相源之一。
- 每份 spec 必须能被 `ff_doctor state` 校验到（路径登记进实例状态）。
