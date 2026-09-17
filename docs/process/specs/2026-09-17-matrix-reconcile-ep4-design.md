# 设计文档：EP4 遗留矩阵对账（docs↔代码实态）

> 实例：`matrix-reconcile-ep4`
> 依据：`docs/refactor/10-stage-map.md` §3 矩阵、`docs/refactor/review_code.md` §4、`docs/refactor/task.md`、`docs/refactor/31-stage11-sunset.md`
> 日期：2026-09-17 ｜ 状态：设计稿
> 分级：**Bounded**（纯文档对账，不改功能代码；判定受「代码实态为准」准则约束）
> 开工基线：`origin/master` = `2a2efa93`

## 1. 目标（Goal）· 需求清单

EP4 主线（阶段 11 日落前的功能全集收口）在代码层已大面积交付，但 `10-stage-map.md` §3 矩阵与
`review_code.md` §4 的状态列**系统性滞后于代码实态**，导致：

1. 阶段 11 的前置核算（`31-stage11-sunset.md` §1 P1）把已交付项误判为「EP4 遗留项」；
2. 后续批次排期（EP4-3 收尾）基于错误清单，可能重复劳动。

**需求**：以**代码实态为准**，逐项核对并修正矩阵/清单的状态标记与证据注记，使文档回到可据以排期的真实状态。

**分级依据**：产物为 3 份既有 Markdown 的状态单元格与注记；不新增包、不改运行时行为、不改接口契约。

### 1.1 需求清单（对账项，全部已逐项取证）

| # | 文档 | 定位 | 现标注 | 代码实态 | 判定 |
|---|---|---|---|---|---|
| R1 | `10-stage-map.md` | D9 状态列 | `✅（mcp-client；server 侧 ⬜ EP1-1）` | `packages/mcp/{mcp-client,mcp-server}` 双包在位；server 侧 EP1-1a（PR #163）+ EP1-1b 四家族 33 组 128 工具（PR #192/#193/#194/#195）全交付 | 滞后，改 `✅` |
| R2 | `10-stage-map.md` | D55 状态列 | `⬜（EP4-3）` | `packages/subprocess/win32-process`、`packages/test-support/session-snapshot`、`packages/util/stdlib`、`packages/host/directory-picker-auto`、`packages/examples/{acp-demo,jsonrpc-demo,agent-spine-demo}` 均在位（EP4-P12 / PR #171 批次）；A11 `agent-team` 依 Q1 裁决暂缓 stretch、A13 `code-runtime-python` 随 S6 stretch | 主体已交付，改 `🟦` + 残余注记 |
| R3 | `10-stage-map.md` | C49 状态列 | `⬜（EP4-3）` | 六组落点齐备：`cats/services-panel`(11 src/2 tests)、`cats/tool-usage`(15/5)、`limb/runtime-session`(6/1)、`cats/frustration`(6/1)、`cats/cloud-bridge`(12/1)、`cats/bootcamp-quest`(4/1) | 已交付，改 `✅` |
| R4 | `10-stage-map.md` | C50 状态列 | `⬜（EP4-3，diff 后并入 forgekin/governance 或独立包）` | `governance/src/{skill-meta,skill-query,skill-sync}.ts`；mount/skillsSync 语义内联 `governance-bootstrap.ts`（L87-271 `mountPaths`/`skillsSync`）；`capabilities/src/mcp-drift-{detector,resolver}.ts`；utils 归位 `util/stdlib`。**与 `review_code.md` §4 B8/B9/B11 三行 🟦 证据一致** | 与 review_code 不一致，改 `🟦` + 残余注记 |
| R5 | `10-stage-map.md` | C51 状态列 | `⬜（EP4-3，⚠ Q3/Q5 裁决）` | 拆分后：finance 依 Q3 剔除；B19 技能内容 ✅（PR #190，wave1-12）；B20 SOP 定义 ✅（PR #171）；B22 路由平台面 → `packages/cats/routes/src/{router,ports,index}.ts` 已落；B21 assets 静态资源**确未迁**（随 S2/平台路由，P2） | 混合态，改 `🟦` + 逐项注记 |
| R6 | `10-stage-map.md` | S1 状态列 | `🟪（框架本体 ⬜ C44/EP1-2；…）` | C44 行自身已 `🟩（EP1-2）`，`packages/infrastructure/connectors` 在位 → S1 内嵌的「⬜ C44/EP1-2」为**自相矛盾陈述** | 改 `🟪` 保留，删除陈旧内嵌标记 |
| R7 | `review_code.md` §4 | A5 状态列 | `阶段 3 补录` | `packages/bundle/acp-app` 在位（EP1-12，D51 已 ✅） | 状态列非状态语义，补 `✅` |
| R8 | `review_code.md` §4 | A30 状态列 | `` `packages/host/` `` | `packages/host/directory-picker-auto` 在位 | 同上，补 `✅` |
| R9 | `review_code.md` §4 | A31 状态列 | `` `packages/examples/` `` | `packages/examples/{acp-demo,jsonrpc-demo,agent-spine-demo}` 在位 | 同上，补 `✅` |
| R10 | `review_code.md` §4 | B22 状态列 | `EP3 验收项` | `packages/cats/routes` 已落，且 EP3 验收已闭环（task.md EP3 全 🟩） | 同上，补 `✅` |
| R11 | `31-stage11-sunset.md` | §1 P1 两处 | 「**D55 / C49-C51 / F44-F45 为 EP4 遗留项**」「剩余 D55/C49-C51/F44-F45 归 EP4-3」 | 经 R2-R5 对账后，实际剩余仅 `F44-F45` + C51 的 B21 assets + 两项 stretch 裁决 | 同步修正遗留项口径 |

## 2. 对账准则（判定规则，本批的「架构」）

1. **代码实态为准**：状态以仓库内可验证的包/文件为准，不以 task.md 自述为准（task.md 亦可能滞后）。
2. **不升级有明确残余的项**：`review_code.md` §4 B8/B9/B11 已 🟦 且逐条登记了残余（「剩余纯工具待后续 diff 复核」「skill 级 drift 待 operator 裁决」），
   故 C50 取 `🟦` 与之对齐，**不得**升级为 `✅`。
3. **只改状态与对账注记**：不重写既有证据链正文（避免抹掉历史取证），仅在状态前缀与必要注记上改。
4. **状态语义**：`✅` 完成 ｜ `🟦` 进行中（主体已交付、残余已登记）｜ `⬜` 未开始 ｜ `🟪` stretch/待裁决。
5. **不改功能代码**：本批零 `src/` 变更；验证为「文档断言 vs 代码事实」的可复算核对。

## 3. 技术栈（Tech Stack）

既有 Markdown 文档 + 仓库内文件存在性/符号核对（`ls`/`grep`/`git log`）。无新增依赖、无构建产物变更。

## 4. 全局约束

- 单文件不新增超 1000 行；保持既有表格列结构（不增删列）。
- 每处修改必须能回指本文 §1.1 的某一行（可追溯）。
- 不触碰 `docs/refactor/` 之外的文档；不动 `python/legacy/`（S11.2 归档态）。

## 5. 交付物清单（Deliverables）

1. `docs/refactor/10-stage-map.md`：D9 / D55 / C49 / C50 / C51 / S1 六处状态修正。
2. `docs/refactor/review_code.md` §4：A5 / A30 / A31 / B22 四处状态列补正。
3. `docs/refactor/31-stage11-sunset.md` §1 P1：遗留项口径修正（两处）。
4. 本设计文档 + 对应 plan/review/verification 流程产物。

## 6. 决策门（DCP）

| 方案 | 取舍 | 依据 |
|---|---|---|
| **A. 只对账状态字（本设计）** | ✅ 采用 | 变更面小、可逐项取证、与既有 review_code 证据链不冲突；立即修正阶段 11 前置核算 |
| B. 顺带把 C49/C50 残余代码补齐 | ❌ 本批不做 | 残余项（skill 级 drift）属**待 operator 裁决**，非对账范畴；补齐应由独立批次承担 |
| C. 重写 review_code §4 全表证据 | ❌ | 会抹掉既有逐文件 diff 取证历史，违反准则 3 |

**结论**：采用 A；B/C 另立批次。

## 7. 验收（DoD）

1. §1.1 的 R1-R11 十一项全部落地，`git diff` 可逐处回溯到本设计。
2. `10-stage-map.md` 中不再出现「server 侧 ⬜ EP1-1」（D9）、「框架本体 ⬜ C44/EP1-2」（S1）等已失效陈述。
3. C50 状态与 `review_code.md` §4 B8/B9/B11 一致（同为 🟦 且残余口径相同）。
4. `31-stage11-sunset.md` §1 P1 的遗留项口径为 `F44-F45` + B21 assets + 两项 stretch，不再含已交付的 D55/C49/C50。
5. `ff_doctor all` 合规；本批零 `src/` 变更（`git diff --name-only` 仅 `docs/`）。
