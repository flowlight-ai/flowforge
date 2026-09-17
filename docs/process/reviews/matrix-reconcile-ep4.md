# review: EP4 遗留矩阵对账（docs↔代码实态）

> 实例：`matrix-reconcile-ep4` ｜ 规格：`docs/process/specs/2026-09-17-matrix-reconcile-ep4-design.md` ｜ 计划：`docs/process/plans/2026-09-17-matrix-reconcile-ep4.md`
> 审查日期：2026-09-17 ｜ 工作流：change ｜ 改动面：6 文件全在 `docs/`

## 阶段一：规格合规审查（Spec Compliance）

逐项核对设计 §1.1 的 R1-R11 是否落地、是否越界。

| R | 目标处 | 落地 | 核对方式 |
|---|---|---|---|
| R1 | `10-stage-map.md` D9 | ✅ 状态列改「server 侧亦已交付」+ EP1-1a/1b PR 号；勘误语保留但事实更正 | `git diff` 该行 |
| R2 | 同上 D55 | ✅ `⬜`→`🟦`，登记 6 类已交付落点 + 3 项裁决态残余 | 同上 |
| R3 | 同上 C49 | ✅ `⬜`→`✅`，登记六包及 src/tests 规模 | 同上 |
| R4 | 同上 C50 | ✅ `⬜`→`🟦`，与 review_code §4 B8/B9/B11 同证 + 残余口径一致 | 同上 |
| R5 | 同上 C51 | ✅ `⬜`→`🟦`，finance/B19/B20/B22 逐项 + B21 残余 | 同上 |
| R6 | 同上 S1 | ✅ 保留 `🟪`，删除已失效的内嵌「⬜ C44/EP1-2」 | 同上 |
| R7 | `review_code.md` §4 A5 | ✅ → `✅ 已交付（EP1-12，packages/bundle/acp-app）` | `grep '^| A5 '` |
| R8 | 同上 A30 | ✅ → `✅ 已交付（packages/host/directory-picker-auto）` | `grep '^| A30 '` |
| R9 | 同上 A31 | ✅ → `✅ 已交付（packages/examples/{...}）` | `grep '^| A31 '` |
| R10 | 同上 B22 | ✅ → `✅ 已交付 + EP3 复核完成` | `grep '^| B22 '` |
| R11 | `31-stage11-sunset.md` §1 P1 两处 | ✅ 遗留项口径改为 `F44-F45 + C51 残余(B21) + A11/A13/A35 stretch` | `grep -c "D55 / C49-C51"` = 0 |

**边界合规**：
- 设计 §5「零 `src/` 变更」→ 暂存区 `git diff --cached --name-only` 仅 6 个 `docs/` 路径 ✅
- 设计 §2 准则 2「不升级有明确残余的项」→ B8/B9/B11 保持 🟦 未被改动 ✅
- 设计 §2 准则 3「不重写既有证据链」→ review_code B 系列证据单元格正文未被删改 ✅（仅 A5/A30/A31/B22 四处状态列与 B22 状态列）
- 未触碰 `python/legacy/`（S11.2 归档态）✅

**结论**：R1-R11 全部落地，无越界，无遗漏。**P0/P1 缺陷：0**。

## 阶段二：质量审查（Quality）

### P1（必须修，已修）
无。

### P2（应修，已处理）
- **P2-1｜并发写入导致全局 DoD 断言失效**：计划任务 4 步骤 1 的断言原为「`git diff --name-only` 仅 `docs/`」，实测工作区存在**非本批**变更（`.gitignore`、`python/legacy-pytest-baseline-2026-09-16/pytest-unit-baseline-2026-09-16.txt`，疑为并行会话的 S11.2 归档/基线产物）。
  **处置**：把断言口径从「全局工作区」收窄为「**本批暂存区**」（`git diff --cached --name-only | grep -v '^docs/'` → 空），不改动、不提交那两个文件；并在本 review 与 verification 中显式留痕。此口径更准确（对本批改动面负责），符合设计 §2 准则 1 的可追溯要求。

### P3（可延后）
- **P3-1｜C49 的 tool-usage 测试命名不一致**：其余包用 `tests/*.spec.ts`，`cats/tool-usage` 用 `tests/*.test.ts`（5 个文件）。对账已按实际计数（15 src/5 tests），命名统一属独立代码规范批次，本批不做。
- **P3-2｜C50 残余项未量化**：B8 记「剩余纯工具待后续 diff 复核」、skill 级 drift「待 operator 裁决」，无确切清单。属待裁决项，非对账可闭合范围（设计 §6 方案 B 已明确排除）。

## 审查结论

- 规格合规：**通过**（R1-R11 全落地，边界无越界）
- 质量：**通过**（P1=0；P2-1 已按「本批改动面」口径收窄并留痕；P3 两项延后）
- 放行至 verify 阶段：**是**
