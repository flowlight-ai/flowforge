# 存量治理台账（EP0-7）

> **来源**：`@flowforge/plugin-dev` EP0-7（`docs/refactor/33-stage-ep0-plugin-dev.md` §7）
> **基线命令**：`node packages/plugins/dev/bin/ff_doctor.mjs docs --repo <root>`（数字以工具输出为准）
> **治理节奏（决策点 D2 已采纳）**："改动哪块、治理哪块"——每批次（EP1-EP4）开工前跑 `ff_doctor docs`
> 取本域盘点，治理项并入该批次任务清单；全量对账在 EP4 收尾批统一验收。

## 1. 盘点基线（2026-09-07，流程切换声明生效日）

### 1.1 存量文档盘点

| 目录 | 数量 | 属性 | 治理动作 |
|---|---|---|---|
| `docs/features/` | 72 | Python 遗留 SRS 层（F0XX） | F-A-D-T 齐全性核对，缺 A/D 同号文档的补齐或裁决归档 |
| `docs/architecture/` | 46 | Python 遗留 SAD 层（A0XX） | 同上；与 F0XX 对号 |
| `docs/design/` | 51 | Python 遗留 SDD 层（D0XX） | 同上；与 F0XX 对号 |
| `docs/decisions/` | 16 | ADR（不可变历史） | 保持不可变纪律；变更走新增 ADR |
| `docs/rules/` | 9 | 活跃规范层（含 13-dev-process） | 已按 plugin-dev 流程回填（EP0-6）✅ |
| `docs/prompts/` | 4 | 提示词模板 | 与 L3 流程资产核对，防双头维护 |
| `docs/test/` | 27 | 测试规范 | 与 T1-T9 铁律对齐核对 |
| `docs/refactor/` | 26 | TS 重写活规范（首要依据） | 已按 plugin-dev 流程回填（04-code-standards §6 衔接）✅ |
| `docs/process/` | 24 | 流程资产层（Plane 1） | 本轮新建 ✅ |

**F-A-D-T 结构性缺口**：features(72) vs architecture(46) vs design(51) 数量不对齐——
存在缺同号 A0XX/D0XX 的 feature（Python 遗留未补全），按 D2 节奏在触碰对应 feature 的批次中补全。

### 1.2 存量代码测试覆盖

- 有测试的包：280；无测试的包：2
- 无测试清单（纳入改动批次的补测清单）：
  - `packages/attachment/attachment`
  - `packages/util/brand`

### 1.3 反向融合核对表（flowforge 自有思想 → plugin-dev 落点）

| flowforge 自有资产 | plugin-dev 落点 | 状态 |
|---|---|---|
| `docs/rules/11-doc-layering.md`（F/A/D 静态分层） | design/plan 模板内嵌 F/A/D 结构 | ✅ EP0-2 |
| `docs/rules/12-doc-refactor-methodology.md`（三阶段递进） | greenfield 工作流 design 阶段方法 | ✅ EP0-3 |
| mgr 分支池 / PR 规范 | ⑫ finishing-a-development-branch 资产 + finish 阶段 mgr 收尾 | ✅ EP0-1 |
| 测试铁律 T1-T9 | ⑥ TDD / ⑩ 完成前验证资产 + evidence 命令证据化 | ✅ EP0-1/EP0-5 |
| git-workflow / AGENTS.md 红线 | 入口三件套 L0 引导 + 13-dev-process §13.6 引用关系 | ✅ EP0-4/EP0-6 |
| devforge DCP/TR 决策门 | workflows.ts 四模板门禁配置（数值照搬） | ✅ EP0-3 |
| clowder 两阶段审查 / P1-P3 分级 | review-protocol.ts + review 模板 | ✅ EP0-2/EP0-5 |

## 2. 治理进度跟踪

| 日期 | 批次 | 治理动作 | 状态 |
|---|---|---|---|
| 2026-09-07 | EP0-7 | 基线盘点（本文件 §1）+ 台账建立 | ✅ |
| （待办） | EP1 开工前 | 重跑 `ff_doctor docs`，EP1 域内文档 F-A-D-T 补全 + 两无测试包补测 | ⏳ |
| （待办） | EP2-EP4 各批次 | 同上，"改动哪块、治理哪块" | ⏳ |
| （待办） | EP4 收尾批 | 全量对账验收（存量治理 DoD） | ⏳ |

## 3. 存量治理 DoD（EP4 收尾验收标准）

1. `ff_doctor docs` 报告中无测试包清零（280+2 → 全覆盖）；
2. 活跃 feature 的 F0XX/A0XX/D0XX 同号齐全（Python 遗留层的缺口全部补全或裁决归档入 `_archive/`）；
3. 不合适/过期的遗留文档重构或归档完毕（`docs/_archive/`，遵循 12-doc-refactor-methodology）；
4. 本台账治理动作全部闭环，仅剩"保持绿"的例行项。
