# EP1-11 实施计划：Cordis 浏览器运行时与展示逻辑注入式移植

> **批号**：EP1-11 ｜ **包**：`@flowforge/cordis-client-runner` + `@flowforge/ui-cordis`
> **来源**：A9/A10（D50）｜ **设计**：`docs/process/specs/2026-09-08-cordis-client-runner-design.md`
> **流程阶段**：implement → review → verify → finish

---

## 步骤清单

### S1 `@flowforge/cordis-client-runner`（A10 运行时 seam）

- [x] 包骨架：`package.json`（ESM，`@flowforge/cordis-client-runner`，0.1.0-rc.1，导出映射 `.`/`./types`/`./src/*`/`./package.json`）+ `tsconfig.json` + `tsconfig.host.json`
- [x] `ports/`：`slots.ts`（`ClientSlotsPort` + `MemoryClientSlots` + `SlotDeclarationSpec` + `LiveSlotNode`）、`service-host.ts`、`style.ts`、`loader-modules.ts`（各端口 + 真实内存实现）
- [x] `types.ts` wire-safe 词汇、`values.ts` `JsonValue`、`messages.ts` 外部化文案
- [x] `evaluator.ts`（`isDynamicCordisPlugin` / `evaluateClientHalf` / `DynamicCordisStyles`）
- [x] `guard.ts` 动态 ctx 白名单 facade、`runtime.ts` `DynamicCordisPackageRunner` + 直播集
- [x] `orchestrator.ts` `CordisRunOrchestrator` + `CordisRunHostSeam` + 活动类型
- [x] `inspect-registry.ts`、`providers.ts`、`api-catalog.ts`、`slot-catalog.ts`、`timer.ts`
- [x] `memory.ts` `memoryCordisClientRuntime` 装配；`index.ts` 导出面
- [x] 契约测试：`evaluator/ports/runtime/guard/orchestrator/inspect-registry/memory .spec.ts`

### S2 `@flowforge/ui-cordis`（A9 展示逻辑，依赖 runner）

- [x] 包骨架：`package.json` + `tsconfig.json`（加入 `references → ../cordis-client-runner`）+ `tsconfig.host.json`
- [x] seam：`observable.ts` `HostObservable`、`block.ts` `ToolCallViewModelBlock`、`dynamic-port.ts` `CordisDynamicPort`
- [x] 纯逻辑：`card-model.ts`、`status.ts`、`inventory.ts`、`run-card-index.ts`
- [x] 词汇与文案：`events.ts`（复出 runner 词汇）、`types.ts`（types-only 子路径）、`locales.ts`、`index.ts`
- [x] 契约测试：`card-model / status / inventory / run-card-index .spec.ts`

### S3 根配置登记

- [x] `tsconfig.base.json` paths 增补 `@flowforge/ui-cordis{,/types}`（runner 三别名已就绪）
- [x] 双包 references 双向接线（host 引 host）

### S4 验证（DoD，见设计 §5）

- [x] `pnpm vitest run packages/extensions/ui-cordis packages/extensions/cordis-client-runner` → **82/82 绿**
- [x] `pnpm tsc -b packages/extensions/ui-cordis/tsconfig.json` → exit 0
- [x] `pnpm tsc -b packages/extensions/cordis-client-runner/tsconfig.json` → exit 0
- [x] `pnpm oxlint packages/extensions/ui-cordis packages/extensions/cordis-client-runner` → 0 警告
- [x] 零禁用依赖检查 + 文案外部化确认

### S5 文档与追踪

- [ ] `docs/refactor/task.md` 行 11 置 🟩（标注 PR）
- [ ] `docs/refactor/10-stage-map.md` D50 行置 🟩
- [ ] `docs/refactor/review_code.md` §13.1 行 11 登记
- [ ] mgr PR 提交（主会话执行，本批仅落盘）

---

## 交付物清册

| 类别 | 产物 |
|---|---|
| 源 | runner 21 源文件 + ui-cordis 11 源文件（`src/**`） |
| 测试 | runner 7 + ui-cordis 4 = **11 契约文件 / 82 用例** |
| 文档 | 本计划 + 设计（含 ui-cordis 说明） |
| 追踪 | task.md / 10-stage-map.md / review_code.md 置 🟩 |

> Agent Notes：PR # 号由主会话经 mgr 提交后回填；本批不执行 git 操作。