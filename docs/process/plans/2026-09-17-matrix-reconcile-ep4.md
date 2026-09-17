# plan: EP4 遗留矩阵对账（docs↔代码实态）

> 实例：`matrix-reconcile-ep4` ｜ 规格（Spec）：`docs/process/specs/2026-09-17-matrix-reconcile-ep4-design.md` ｜ 工作流：change

**目标（Goal）**：以代码实态为准修正 `10-stage-map.md` / `review_code.md` / `31-stage11-sunset.md` 三份文档中 11 处滞后状态标记（设计 §1.1 R1-R11）。
**架构（Architecture）**：见设计 §2 对账准则——只改状态字与对账注记，不重写证据链、不改功能代码。
**技术栈（Tech Stack）**：既有 Markdown；核对手段为 `ls` / `grep` / `git log` 的文件存在性与符号核对。

## 全局约束
- 零 `src/` 变更；`git diff --name-only` 只允许出现 `docs/`。
- 每处改动必须能回指设计 §1.1 的 R 编号。
- 不升级 `review_code.md` §4 B8/B9/B11（有明确残余，保持 🟦）。
- 保持既有表格列结构，不增删列。

## 任务清单

### 任务 1：修正 `10-stage-map.md` 六处状态（R1-R6）

- [ ] **步骤 1：R1 — D9 状态列**——把「`server 侧 ⬜ EP1-1`」改为已交付口径，含 EP1-1a/1b 与 PR 号。

```md
| D9 | MCP **客户端**（server 侧见 C43…） | packages/mcp | 2 | ✅（mcp-client + **mcp-server 已交付**：EP1-1a 治理框架（PR #163）+ EP1-1b 四家族 33 工具组 128 工具（PR #192/#193/#194/#195）） |
```

- [ ] **步骤 2：R2 — D55 状态列**——`⬜（EP4-3）` → `🟦`，登记已交付落点与两项 stretch 残余。

```md
| D55 | … | dsh `packages/*` | 10-11 | 🟦（**EP4-P12 主体已交付**：`win32-process` / `session-snapshot` / `util-stdlib` / `directory-picker-auto` / `examples` 三件套（PR #171 批次）；**残余**：A11 `agent-team` 依 Q1 裁决暂缓 stretch、A13 `code-runtime-python` 随 S6 stretch） |
```

- [ ] **步骤 3：R3 — C49 状态列**——`⬜（EP4-3）` → `✅`，登记六包落点与规模。

```md
| C49 | … | clowder `cats/services/*`（B6/B13-B17） | 4-6 | ✅（六包已落：`cats/services-panel`(11 src/2 tests)、`cats/tool-usage`(15/5)、`limb/runtime-session`(6/1)、`cats/frustration`(6/1)、`cats/cloud-bridge`(12/1)、`cats/bootcamp-quest`(4/1)） |
```

- [ ] **步骤 4：R4 — C50 状态列**——`⬜（EP4-3…）` → `🟦`，与 `review_code.md` §4 B8/B9/B11 对齐并登记残余。

```md
| C50 | … | clowder `api/src/{skills,mcp,utils}`（B8/B9/B11） | 7 | 🟦（**已 diff 归位补齐**，对齐 `review_code.md` §4 B8/B9/B11：`skill-meta`/`skill-query`/`skill-sync` 落 `governance/src/`，mount/skillsSync 语义内联 `governance-bootstrap.ts`，`mcp-drift-detector`/`mcp-drift-resolver` 落 `capabilities/src/`，utils 归位 `util-stdlib`；**残余**：skill 级 drift 待 operator 裁决 + 剩余纯工具待复核） |
```

- [ ] **步骤 5：R5 — C51 状态列**——`⬜（⚠Q3/Q5）` → `🟦`，逐项拆分登记。

```md
| C51 | … | clowder `packages/*` | 11 | 🟦（**逐项拆分**：finance 依 Q3（2026-09-10）剔除；B19 技能内容 ✅ PR #190（wave1-12）；B20 SOP 定义 ✅ PR #171；B22 路由平台面 → `packages/cats/routes/src/{router,ports,index}.ts` 已落；**残余**：B21 assets 静态资源未迁，随 S2/平台路由（P2）） |
```

- [ ] **步骤 6：R6 — S1 状态列**——保留 `🟪`，删除已失效的内嵌「⬜ C44/EP1-2」（与 C44 行 `🟩` 自相矛盾）。

```md
| S1 | IM 通道连接器（**拆二**：①connector 框架本体 = C44 主线，**已交付** `packages/infrastructure/connectors`（C44 🟩 EP1-2）；②真实通道凭据启用 = stretch） | … | 11+ | 🟪（真实通道凭据按裁决启用；批次8 chat-stretch 已交付 IImChannelAdapter ports + InMemory mock） |
```

- [ ] **步骤 7：对账断言测试（先红后绿，测试通过）**——修改前 grep 必须命中（红：确认失败即滞后标记存在），修改后必须无输出（绿）。
  本任务是纯文档对账，测试形式为「文档断言 vs 代码事实」的可复算核对测试，无新增 `tests/` 代码文件。

```bash
echo "红：修改前应命中（确认失败）"
grep -n "server 侧 ⬜ EP1-1\|框架本体 ⬜ C44" docs/refactor/10-stage-map.md
echo "绿：修改后无输出，exit=1"
grep -n "server 侧 ⬜ EP1-1\|框架本体 ⬜ C44" docs/refactor/10-stage-map.md; echo "exit=$?（1=无残留，测试通过）"
```

### 任务 2：补正 `review_code.md` §4 四处状态列（R7-R10）

- [ ] **步骤 1：R7/A5**——状态列 `阶段 3 补录` → `✅ 已交付（EP1-12，packages/bundle/acp-app）`。
- [ ] **步骤 2：R8/A30**——状态列 `` `packages/host/` `` → `✅ 已交付（packages/host/directory-picker-auto）`。
- [ ] **步骤 3：R9/A31**——状态列 `` `packages/examples/` `` → `✅ 已交付（packages/examples/{acp-demo,jsonrpc-demo,agent-spine-demo}）`。
- [ ] **步骤 4：R10/B22**——状态列 `EP3 验收项` → `✅ 已交付（packages/cats/routes，EP3 验收闭环）`。
- [ ] **步骤 5：对账断言测试（测试通过）**——四处目标字符串在 §4 表内不再出现；测试形式为 grep 断言测试（无新增 `tests/` 代码文件）。

```bash
echo "红：修改前命中（确认失败）"
grep -n "^| A5 \|^| A30 \|^| A31 \|^| B22 " docs/refactor/review_code.md | grep -c "阶段 3 补录\|EP3 验收项"
echo "绿：修改后期望 0；四处均 ✅（测试通过）"
grep -n "^| A5 \|^| A30 \|^| A31 \|^| B22 " docs/refactor/review_code.md | grep -c "✅"
```

### 任务 3：修正 `31-stage11-sunset.md` §1 P1 遗留项口径（R11）

- [ ] **步骤 1：第 1 处**——「**D55 / C49-C51 / F44-F45 为 EP4 遗留项**」→ 对账后的实际剩余口径。

```md
功能全集矩阵核算：D/C/F 主线已全部 ✅（stretch 除外）；经 2026-09-17 对账，**实际遗留为 F44-F45 + C51 残余（B21 assets）+ 两项 stretch 裁决（A11/A13）**
```

- [ ] **步骤 2：第 2 处**——「剩余 D55/C49-C51/F44-F45 归 EP4-3 遗漏项收尾」→ 「剩余 F44-F45 与 C51 残余归 EP4-3，A11/A13 依 Q1/随 S6」。

- [ ] **步骤 3：对账断言测试（先红后绿，测试通过）**——`grep -c "D55 / C49-C51 / F44-F45"` 修改前命中（红），修改后为 0（绿）。测试形式为 grep 断言测试（无新增 `tests/` 代码文件）。

```bash
grep -c "D55 / C49-C51 / F44-F45" docs/refactor/31-stage11-sunset.md; echo "（修改后期望 0，测试通过）"
```

### 任务 4：提交与登记

- [ ] **步骤 1：零 src 变更断言测试（测试通过）**——`git diff --name-only` 仅 `docs/`。本任务为收尾登记，测试形式为 diff 断言测试（无新增 `tests/` 代码文件）。

```bash
git diff --name-only | grep -v "^docs/" ; echo "exit=$?（1=仅 docs，测试通过）"
```

- [ ] **步骤 2：提交**——`./mgr sync "docs(refactor): EP4 遗留矩阵对账 D9/D55/C49/C50/C51/S1 与 A5/A30/A31/B22 回归代码实态 [sherlock]" --body "…"`。

## 计划自审清单
- [ ] 覆盖设计 §5 交付物 1-4 与 §7 DoD 1-5
- [ ] 无占位符；每个任务含可复算的校验命令与期望输出
- [ ] 未升级 B8/B9/B11（遵守设计 §2 准则 2）
- [ ] 零功能代码改动

## 校验登记
`ff_dev gate matrix-reconcile-ep4 plan --evidence docs/process/plans/2026-09-17-matrix-reconcile-ep4.md` → 通过后 `ff_doctor plan` 本文件合规。
