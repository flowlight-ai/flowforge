# instances/ — 流程实例状态目录（状态契约）

**状态契约核心载体**：每个流程实例一个 JSON 文件（`<name>.json`），
由 `ff_dev` 命令族读写。流程状态承载于仓库文件而非会话记忆——
这是"换 AI 工具 / 换 LLM 模型 / 换会话均可接续"的唯一真相源（33-stage §5）。

## 结构（schemaVersion 1）

```json
{
  "schemaVersion": 1,
  "name": "ep0-1",
  "workflow": "feature",
  "snapshot": {
    "phase": "implement",
    "gates": { "designApproved": true, "planValidated": true, "verificationEvidence": false },
    "artifacts": { "design": "...", "plan": "...", "review": "...", "verification": "..." },
    "history": [{ "phase": "requirement", "enteredAt": "..." }]
  },
  "updatedAt": "2026-09-07T00:00:00.000Z"
}
```

## 规则

- 禁止手改：一切变更经 `ff_dev`（init/advance/gate/evidence/snapshot），
  `ff_doctor state` 会校验阶段-门禁一致性与产物路径有效性。
- 实例文件入库提交（决策 D3），跨 clone 接续依赖它。
- 已完结（finish）实例保留作归档，`ff_dev resume` 只列出活跃实例。
