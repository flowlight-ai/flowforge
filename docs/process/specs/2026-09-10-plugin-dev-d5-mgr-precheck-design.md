# 设计文档：plugin-dev 批次 L3 —— mgr × ff_doctor 本地 Git 硬拦截（D5）

> 批次来源：`docs/refactor/33-stage-ep0-plugin-dev.md` **T0.6.4**（D5 已裁决：单独批次实施，不动共享基础设施 mgr 其它部分）
> 日期：2026-09-10 ｜ 状态：设计稿（待 operator 审阅后转 plan）
> 关联谓词：`docs/rules/13-dev-process.md`、`docs/git-workflow.md` §4 红线

## 1. 目标（Goal）

闭合遵从度五层体系（L0-L4）中的 **L3 本地硬拦截**（见 review_code.md §11.4a）：

> L3 本地 Git 拦截：mgr 提交前跑 `ff_doctor`（D5 裁决：独立批次实施）——硬（本地，待接线）

当前 L3 缺位是遵从度体系的结构性漏洞：L4 CI 是远端硬拦截，但**提交发生在 CI 之前**——本地可在 `git commit`/`mgr sync` 阶段就放行掉越界状态，等 CI 才拦 = 把错误推向远端。本批让 **mgr（`sync`/`commit`）在真正产生提交前调用 `ff_doctor all` 做本地强制校验**，堵住"提示词可以不听，本地就放行"的最后一层。

## 2. 现状与先例（Background）

- **mgr**：bash 745 行，仓库级 Git 合规封装（分支名可校验/PR 可由 `_check_msg_format` 前置校验 + 非零退出）。已有 `_check_msg_format`（`mgr` L683）作为"提交前本地拦截"的成功先例——本批复刻同一模式接入 `ff_doctor`。
- **ff_doctor**：`packages/plugins/dev` 已交付 CLI（`bin/ff_doctor.mjs`，tsx 直跑 TS，退出码契约 0=合规/1=违规/2=用法错误）。`ff_doctor all [--repo <root>]` = 实例状态一致性 + 活跃实例 plan No-Placeholder 组合校验。**无活跃实例时通过（宽容）**，仅在有活跃实例且其状态/计划被破坏时返回 1。
- **裁决记录**：D5（`33-stage-ep0-plugin-dev.md` L170）"✅ 已裁决（按建议执行）：EP0-6 未动 mgr，留独立批次实施"；T0.6.4（L241）未勾选。→ 本批即为 D5/T0.6.4。

## 3. 架构（Architecture）

```
./mgr sync "type(scope): desc [agent]"        ./mgr commit "type(scope): desc [agent]"
        │                                          │
        └─── cmd_sync / cmd_commit ──► _ff_mgr_doctor_check <repo>   （新增，本批）
                                                │
                            ┌───────────────────┴───────────────────┐
                node packages/plugins/dev/bin/ff_doctor.mjs all --repo <repo>
                            └───────────────────┬───────────────────┘
                                              退出码
                               0（合规）─► 放行继续 ｜ 1（违规）─► 中止并提示 ｜ 2（用法错误）─► 放行
```

- 单一校验函数 `_ff_mgr_doctor_check <repo>`，`cmd_sync`（L387 `_check_msg_format` 之后、进入重构循环 `NAMES` 前）与 `cmd_commit`（L166 `_check_msg_format` 之后）分别调用。
- 校验作用于**每个将要提交的仓库目录**（复用 `NAMES` 循环的 `_cur_dir`），保证多仓映射（content 仓 9 项目等）逐一自检。
- 复用 `_check_msg_format` 的错误输出风格（R 红字 + abort + exit 1），不引入新交互。

## 4. 技术栈 / 集成契约（Integration Contract）

| 项 | 契约 |
|---|---|
| 触发命令 | `./mgr sync`、`./mgr commit`（两处均在校验通过后才产生提交） |
| 校验命令 | `node "$REPO/packages/plugins/dev/bin/ff_doctor.mjs" all --repo "$REPO"`（`all` = state + 活跃实例 plan No-Placeholder） |
| 退出码语义 | 0 → 放行；1 → 打印违规明细并 `exit 1`（中止提交）；2 → 用法错误，放行（避免配置错误阻塞，并打 stderr 警告） |
| 工具链缺失策略 | 若 `node` 不可用 / `bin/ff_doctor.mjs` 不存在（仓库未含 plugin-dev）/ tsx 不可解析 → **降级为 warning 警告并放行（fail-open）**；日志写明"L3 校验跳过"。用于脏环境或游离仓库不阻塞应急提交 |
| 显式逃生舱 | `./mgr sync --no-check "..."` / `./mgr commit --no-check "..."` 跳过 L3（打印明确 warning）；环境变量 `FF_MGR_DOCTOR=0` 整仓关闭（对应 CI 场景由 L4 独立兜底） |
| 作用域 | 沿用 mgr `SELF` 仓库注册 scope（每目录按 `NAMES` 循环逐一校验），不改分支模型/msg 格式/PR 逻辑 |
| 平台 | mgr bash（Git Bash 于 Windows / 原生 bash），`node` 走 PATH；ff_doctor 为跨平台 node CLI，无平台分支 |

> 模式选择依据：**选 `all`（宽容）而非 `state --require-active`（严格）**。后者会在「无任何活跃流程实例」时返回 1，阻塞文档回填/运维/基建等非特性提交——对 mgr 这类共享基础设施过严。`all` 的语义精确匹配诉求：**有活跃实例则其状态与 plan 必须合规**，无实例则不误伤。

## 5. 规范引用（Spec）

- `docs/rules/13-dev-process.md`（流程铁律：L3 本地拦截定位）
- `docs/rules/11-doc-layering.md`（产物模板：plan 模板由 ff_doctor 校验）
- `docs/git-workflow.md`（§4 红线：提交必须过本地校验；命名契约）
- `docs/refactor/33-stage-ep0-plugin-dev.md` T0.6.4 / D5（本批任务与裁决来源）
- `docs/refactor/review_code.md` §11.4a（遵从度五层体系）

## 6. 全局约束（Global Constraints）

- **mgr 为共享基础设施**：只新增一个自包含校验函数 + 两个调用点，不触碰其它逻辑，不改变既有全部命令行为。
- 单文件 ≤1000 行（本批无新 TS 文件；mgr 增量 ≤ 40 行）。
- 测试遵守 T1-T9 铁律：bash 校验逻辑用 mgr 既有自测方式（模拟仓库 + 触发点断言）验证，不 Mock。
- 逃生舱要"显式且带警告"，不得静默关闭；默认必须 fail-open-on-toolchain-missing。

## 7. 决策门记录（Decision Gates）

### DCP-1 方案决策（design → plan）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| architecture_fit | 0.35 | 0.6 | 0.88 | 复刻 `_check_msg_format` 先例，闭合 L3，与"一切走 mgr"红线一致 |
| completeness | 0.30 | 0.6 | 0.85 | 双钩子（sync+commit）+ 逃生舱 + 工具链降级，覆盖提交全路径 |
| risk | 0.35 | 0.5 | 0.70 | 显式逃生舱 + fail-open-on-missing 兜底，mgr 其余逻辑零改动 |

加权总分 0.807 / 阈值 0.65。**通过**。

### 关键取舍（Risk Register）

| 风险 | 决策 | 理由 |
|---|---|---|
| 工具链缺失阻塞提交 | fail-open（warning + 跳过） | 游离仓/脏环境不应卡死应急提交；CI L4 仍独立兜底 |
| 无实例时误伤非特性提交 | 用 `all` 不用 `--require-active` | `all` 无实例即通过；严格模式留待产品级强制治理时再评估 |
| 逃生舱被滥用虚置 L3 | 每跳过必打醒目 warning；退出码语义稳定 | 逃得显眼，杜绝静默关闭 |

## 8. 交付物清单（Deliverables）

- **mgr**：新增 `_ff_mgr_doctor_check <repo>` + `cmd_commit`/`cmd_sync` 两处调用 + `--no-check` 解析 + `FF_MGR_DOCTOR` 环境变量门。
- **测试**：mgr 校验触发点契约测试（违规实例状态/坏 plan → exit 1 中止；合规 → 放行；`--no-check`/无 ff_doctor → 放行并警告）。
- **文档回填**：`13-dev-process.md`（L3 本地拦截状态=已接线）、AGENTS.md 常用命令表（`./mgr sync --no-check` 逃生舱）、`review_code.md` §11.4a L3 行改"✅ 已接线"、`33-stage-ep0-plugin-dev.md` T0.6.4 勾选 + PR 号。

## 9. 验收（DoD）

1. `./mgr commit` / `./mgr sync` 在存在违规活跃实例时返回非零并列出明细，不产生提交。
2. 合规实例正常提交放行；`--no-check` 与 `FF_MGR_DOCTOR=0` 均能显式跳过并出 warning。
3. 工具链缺失（临时移走 ff_doctor）时警告放行，不卡提交。
4. 全量回归：既有 mgr 其余命令（`pull`/`push`/`status`/`protect`/`merge-cross` 等）行为不变。
5. 文档三处回填完成，T0.6.4 标 ✅ + PR 号。