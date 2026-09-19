# design: 既有债务整备批次（root typecheck / lint / 逻辑类 vitest 修复）

> 实例：`debt-remediation` ｜ 阶段：design ｜ 关联计划：[`../plans/2026-09-18-debt-remediation.md`](../plans/2026-09-18-debt-remediation.md)

## 1. 背景与问题说明 (N)

- **N1 全仓 typecheck 红**：`pnpm typecheck`（`tsc -b tsconfig.host.json`，include `packages/*/*/tests/**/*.ts`）产出 **292 条 `error TS`**，退出码 1。根因：测试文件此前未被纳入 host latent 强类型检查（strict + `exactOptionalPropertyTypes` + 品牌/枚举字面量类型），随重构落地后首次暴露。**均位于 `tests/`，不涉及生产 `src/` 运行时行为**。
- **N2 全仓 lint 黄红**：`pnpm lint`（`oxlint .`）产出 **1 error + 100 warnings**，退出码 1。1 error = `integration-perf.spec.ts:37` 未用导入 `SessionId`；100 warnings 几乎全部为「Unused oxlint-disable directive」——既有代码注解了 `oxlint-disable` 但对应规则在当前 oxlint 版本下不再触发（规则名过时 / 已内置 / 豁免超额）。
- **N3 vitest 部分红**：46 文件 / 144 用例失败，成因混合：**逻辑类**（可确定性复现，如 `session-persistence` 的 `SessionPersistenceCorruptionError`、`session-persistence-jsonl/win32.spec.ts` 的 `redactSecrets`、`settings` redact/segment 语义）与**环境依赖类**（外部 e2b 沙箱、llm-pi-ai 外部 LLM、sandbox-windows-acl Windows ACL/FFI 平台依赖、`64 MiB combined boundary` 大内存用例、`23329ms` 深链超时等）。

## 2. 架构 (A) —— 三线并进、互不耦合

| 线 | 门禁 | 现状 | 目标 ⇢ 结果 | 顺序 |
|---|---|---|---|---|
| L1 lint | `pnpm lint` | 1e/100w | 0e/0w exit 0 ✅ | 1（最快绿） |
| L2 typecheck | `pnpm typecheck` | 272 err（61 TS6307 + 211 契约） | exit 0 ✅ | 2 |
| L3 vitest 逻辑类 | `pnpm vitest run <path>` | 逻辑类若干 | 单跑全绿 ✅（35 文件 / 273 用例） | 3 |

- L1/L2 互不依赖，先绿可先提交；L3 只在被修文件级验证，不追求全仓 46 全绿（环境依赖类登记）。
- 生产 `src/` 语义冻结：本批次禁止修改业务逻辑；仅当类型契约声明残缺确需修 `src` 类型时允许，且必须逐条在验证证据标注（下策）。

## 3. 关键决策点 (D)

- **D1 typecheck 治理策略**：逐包修复 tests 类型契约直至 root exit 0。若某条类型错误反映真实 bug（测试断言到运行时行为），**单独登记汇报，不擅改语义**。（plan 默认，operator 已采纳推荐项）
- **D2 vitest 目标**：仅逻辑类修复；环境依赖类进台账 §5 不强行改绿。（plan 默认）
- **D3 lint warnings 处置**：先核对每处 disable 是否 no-op——no-op 则移除 directive（保留原注释说明）；实际仍违反则保留。
- **D4 大内存/超时用例**：`64 MiB`、`23329ms`、`panoptes env timeout` 属环境/资源限制，归类为环境依赖类，登记台账。
- **D5 win32.spec.ts redactSecrets**：对齐实际 redaction 语义修正断言（如属断言过时），判定为逻辑类。

## 4. typecheck 错误类别清单（依据 `_d_typecheck.log` 292 条聚类）

| 类别 | 描述 | 处置 |
|---|---|---|
| T1 字面量↔枚举/品牌 | `string` 赋给 `CatColor`/`ClientId` 等品牌类型 | 测试改用对应字面量类型断言/`satisfies` |
| T2 exactOptionalPropertyTypes | 显式 `undefined` 赋给 optional 属性 | 用条件展开或类型收窄 |
| T3 缺字段 | 构造对象缺 `v`/`readableContent` 等必填 | 补齐测试 fixture 字段 |
| T4 可空缩窄 | `SessionRecord \| undefined` 传参 | 断言/非空或重构测试调用 |
| T5 其余 | 剩余杂项 | 逐条按包内类型面修复 |

> 台账见 `_d_typecheck.log`（根仓，不入库）。

## 5. vitest 环境依赖类台账（不做强制改绿）

| 文件 | 类别 | 说明 |
|---|---|---|
| `packages/e2b/*`（4 文件） | 外部沙箱 | 依赖真实 e2b 云沙箱 |
| `packages/llm/llm-pi-ai/*`（6 文件） | 外部 LLM | 依赖 pi-ai 服务/密钥 |
| `packages/sandbox/sandbox-windows-acl/*`（9 文件） | 平台 ACL/FFI | Windows ACL/FFI 运行时依赖 |
| `packages/llm/llm adapter-failure`、`token-meter` | 外部/计时 | 外部模型/时钟敏感 |
| `packages/core/tools gen-tool-catalog` 等 | 生成目录依赖 | 依赖固定资产目录存在 |

> vitest 全量最终 46 失败中的逻辑类子集在计划 §任务 3 修复，其余以上台账登记。<some_truncated>可复算的修复范围以 Task 3 实测为准。

## 6. 交付物
1. This design doc
2. The plan doc（`docs/process/plans/2026-09-18-debt-remediation.md`）
3. L1/L2 全绿（lint 0/0 exit 0；typecheck exit 0）
4. L3 逻辑类 vitest 修复清单 + §5 环境台账
5. review_code.md / task.md 批次登记
6. mgr PR（携带验证证据）

## 7. DoD
- [x] `pnpm lint` → Found 0 warnings and 0 errors（exit 0）
- [x] `pnpm typecheck` → exit 0
- [x] L3 被修逻辑类文件单跑全绿（35 文件 / 273 用例）；环境依赖类已登台账
- [x] 生产 src 业务语义零改动（①`tsconfig.host.json` 补缺失 root references，属结构装配，非业务逻辑；②若干 src 包清理 no-op 的 `oxlint-disable`/`eslint-disable` 抑制注释——仅删注释指令、保留原说明、零行为改动，属 L1 lint 100 warnings 主体；③tests 仅修类型契约/lint）
- [x] review_code.md / task.md 登记 + PR 提交完成

## 校验登记
`ff_dev gate debt-remediation design --evidence docs/process/specs/2026-09-18-debt-remediation-design.md` → 通过后跑 plan 门禁。