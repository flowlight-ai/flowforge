# [实例名] 验证证据（verification-template）

> 用途：`verify` 阶段产物，verification-before-completion（⑩）的落盘模板。
> 落点：`docs/process/verifications/<name>.md`。
> **铁律**：没有新鲜的验证证据，就没有完成宣称。证据三要素：命令、退出码、输出摘要。

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `<name>` |
| 工作流 | feature / greenfield / change / hotfix |
| 日期 | `YYYY-MM-DD` |

## 证据条目（Evidence Log）

每条验证一条记录（`ff_dev evidence <name> --command "..." --exit 0 --summary "..."` 自动追加本格式）：

### [YYYY-MM-DD HH:mm:ss] pnpm vitest run <路径>

- **命令**：`pnpm vitest run <路径>`
- **退出码**：0
- **输出摘要**：`Test Files  N passed (N)` / `Tests  M passed (M)`
- **耗时**：Ns
- **结论**：目标测试全绿

### [YYYY-MM-DD HH:mm:ss] pnpm typecheck

- **命令**：`pnpm typecheck`
- **退出码**：0
- **输出摘要**：无错误
- **结论**：类型干净

## 回归验证（红-绿循环，bug 修复必须）

- [ ] 写复现测试 → 通过
- [ ] **还原修复 → 测试必须失败**（证明测试有效）
- [ ] 恢复修复 → 测试通过

## 需求核对（finish 前置）

- [ ] 重读实施计划，逐项 checklist 核对
- [ ] 每项验证输出含具体数字（N passed / exit 0），无"跑过了"式表述

## DCP-3 发布决策（feature 工作流；hotfix 为 DCP 发布门）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| release_risk | 0.40 | 0.6 | | |
| test_coverage | 0.35 | 0.80 | | |
| security | 0.25 | 0.8 | | |

加权总分 ___ / 阈值 0.75；**操作者签核**（verify→finish 硬门禁）：操作者 ___，日期 ___。
登记：`ff_dev gate <name> verify --score ___ --evidence <本文件>`。
