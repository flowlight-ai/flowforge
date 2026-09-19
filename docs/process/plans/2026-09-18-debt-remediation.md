# plan: 既有债务整备批次（root typecheck / lint / 逻辑类 vitest 修复）

> 实例：`debt-remediation` ｜ 规格（Spec）：`docs/process/specs/2026-09-18-debt-remediation-design.md` ｜ 工作流：change

**目标（Goal）**：根层三项既有债务清零——① `pnpm typecheck`（tsc -b tsconfig.host.json）272 条 `error TS`（61 TS6307 + 211 契约）全部修复至退出码 0；② `pnpm lint`（oxlint .）1 error + 100 warnings 清零；③ vitest 46 失败文件中的**逻辑类**失败修复，**环境依赖类**（外部 e2b / llm-pi-ai / sandbox-windows-acl 平台依赖）登记不强行改绿。

**架构（Architecture）**：见设计 §2——三项债务相互独立，按「lint → typecheck → vitest」顺序推进以尽早让可复算门禁变绿；不改动任何 `src/` 生产代码语义，仅修正 `tests/` 的 type 契约与 lint 合规。

**技术栈（Tech Stack）**：TypeScript + vitest + oxlint + tsc（均已有）。

## 全局约束
- **禁止改动生产 `src/` 业务逻辑**；仅允许在确属类型契约残缺/声明不当时修 `src` 类型声明（需在验证证据中标注）。
- typecheck 修复目标 = 仅让校验层匹配既有类型面，不重写测试断言含义；若一条类型错误反映真实 bug，单独登记并汇报，不擅自改语义。
- 单文件改动遵循既有包风格；不新增依赖；不触碰 docs 正式三件套（spec/arch/design）之外的无关内容。

## 任务清单

### 任务 1：lint 清零（oxlint：1 error + 100 warnings）

- [x] **步骤 1：定位根因**——全仓 `pnpm lint` 实测 1 error + 100 warnings；error 为 `github-signals/tests/fixtures.ts` 未用解构变量，warnings 为 no-op `oxlint-disable` directive。
- [x] **步骤 2：修 error**——`github-signals/tests/fixtures.ts` 未用变量 `automationState` 改为 `_automationState`；该文件随 `makeIssueTaskWithoutAutomation` 保持 10 组契约测试可运行。
- [x] **步骤 3：清 no-op**——逐一核对 `oxlint-disable`/`eslint-disable` directive，仅删 no-op 指令、保留原注释说明，零行为改动。
- [x] **步骤 4（验证命令）**——重跑全仓 lint 确认清零。

```bash
pnpm lint   # 期望: Found 0 warnings and 0 errors.  / exit 0
```

- **测试文件/步骤（plan→implement 门禁校验项）**：`packages/infrastructure/github-signals/tests/fixtures.ts`（未用变量改 `_automationState`）随包级契约测试复跑，改后无 lint no-op；`npx vitest run packages/infrastructure/github-signals` 10 组契约全绿。

> **实测结算**：oxlint 全仓 3344 文件 → **0 error / 0 warning / exit 0**。

### 任务 2：typecheck 清零（tsc -b tsconfig.host.json）

- [x] **步骤 1：按包聚类错误**——实测 **272 条**（61 TS6307 + 211 契约）。TS6307 根因 = 5 个既有交付包缺失 root reference（`credentials/authorization`、`infrastructure/connectors`、`extensions/cordis-client-runner`、`extensions/ui-cordis`、`session-query/session-log-export`）使 tests 相对导入 `../src/*.ts` 把 src 拉进 root program。
- [x] **步骤 2：补 root references**——在 `tsconfig.host.json` 补 references 指向各包既有复合 `tsconfig.json`，核实引用唯一后全清 TS6307。

```bash
grep -c "packages/credentials/authorization" tsconfig.host.json   # 期望唯一引用
```

- [x] **步骤 3：修 211 条契约**——按包分包并行修复（非空断言 `!`、品牌构造函数 `createCatId`/`createUserId`、移除对象字面量非法属性、`unknown` 缩窄、`as EvidenceRef` 等），仅改 tests 类型契约，src 语义零改动。
- [x] **步骤 4（验证命令）**——重跑 root typecheck 确认零 error。

```bash
pnpm typecheck   # tsc -b tsconfig.host.json --force  → 期望 exit 0 / 无 error TS
```

- **测试文件/步骤（plan→implement 门禁校验项）**：5 个缺 root reference 包的 `tests/**/*.ts` 契约文件 + `tsconfig.host.json`；`pnpm typecheck` 全零报错，随后抽跑受影响包契约测试确认语义未改。

### 任务 3：vitest 逻辑类失败修复

- [x] **步骤 1：判定类别**——对 46 失败文件逐一判类；逻辑类可确定性复现（如 `session-persistence` 的 `SessionPersistenceCorruptionError`、`session-persistence-jsonl/win32.spec.ts` 的 `redactSecrets`、`settings` redact/segment 语义），环境依赖类（外部 e2b / llm-pi-ai / sandbox-windows-acl / 64MiB 大内存 / 深链超时）登记 design §5。
- [x] **步骤 2：修逻辑类**——仅修改确定性失败文件（35 个逻辑类文件）断言，不触碰环境依赖类。
- [x] **步骤 3：登记环境台账**——环境依赖类统一登 `docs/process/specs/2026-09-18-debt-remediation-design.md` §5。
- [x] **步骤 4（验证命令）**——单跑被修逻辑类文件确认全绿。

```bash
pnpm vitest run <35 个被修逻辑类测试路径>   # 期望: Test Files 35 passed / Tests 273 passed / exit 0
```

- **测试文件/步骤（plan→implement 门禁校验项）**：35 个被修逻辑类测试文件经 `pnpm vitest run <被修路径>` 单跑全绿（35 passed / 273 passed）；环境依赖类（e2b 外部沙箱 / llm-pi-ai 外部 LLM / sandbox-windows-acl 平台 ACL-FFI / 64MiB 大内存 / 深链超时）登台账不强行改绿。

```bash
pnpm vitest run packages/session/session-persistence packages/session/session-persistence-jsonl packages/settings   # 代表性子集：逻辑类全绿
```

### 任务 4：矩阵登记 + 验证 + 提交

- [ ] **步骤 1**：登记本批次至 `docs/refactor/review_code.md`（新 §13.x）与 `docs/refactor/task.md`，勾选状态。
- [ ] **步骤 2**：验证证据逐条 `ff_dev evidence` 登记（lint 0/0 exit 0、typecheck exit 0、vitest 逻辑类绿），并 `ff_dev gate debt-remediation verify --score <n> --evidence docs/process/verifications/debt-remediation.md`。
- [ ] **步骤 3（提交命令）**：`./mgr sync` 提交（`chore(refactor)` type + [sherlock] 署名，含实例名与验证结论）。

```bash
./mgr sync "chore(refactor): debt-remediation 根层 lint/typecheck/逻辑类vitest 三清 [sherlock]" --body "…"
```

- **测试文件/步骤（plan→implement 门禁校验项）**：提交前最终回归 `pnpm lint`（0e/0w）与 `pnpm typecheck`（exit 0）复跑并**测试确认**不回退；`docs/process/verifications/debt-remediation.md` 证据逐条 exit 0；`./mgr` 前置 `ff_doctor all` 通过并**测试确认**合规。

```bash
pnpm lint && pnpm typecheck   # 期望双双 exit 0，作为提交前回归测试
```

## 计划自审清单
- [x] 覆盖 design §交付物与 DoD
- [x] 无占位符；每任务含可复算命令与测试步骤
- [x] 生产 src 语义零改动（仅补 root references 结构装配 + tests 类型契约 + src lint 抑制指令清理）
- [x] 环境依赖类失败已登记台账而非强改绿

## 校验登记
`ff_dev gate debt-remediation plan --evidence docs/process/plans/2026-09-18-debt-remediation.md` → 通过后 `ff_doctor plan` 本文件合规。