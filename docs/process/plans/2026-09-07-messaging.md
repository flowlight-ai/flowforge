# EP1-3 实施计划：messaging 主机内核核心移植（B4，自包含批次）

- 依据：`docs/process/specs/2026-09-07-messaging-design.md`
- 批次目标：落 `packages/chat/messaging`（@flowforge/chat-messaging）+ @flowforge/plugin-contract
  messaging 契约类型（`src/messaging.ts`），vitest/tsc/oxlint 全绿，mgr PR。
- 遵循：测试铁律 T1–T9，禁 Mock。
- 边界：**不含** send/append/event-stream/snapshot 服务与 Redis 适配器（EP1-4 承接）。

## 步骤与门禁

| # | 步骤 | 产物 | 门禁 |
|---|---|---|---|
| 1 | 契约类型落地 @flowforge/plugin-contract（messaging.ts + index 导出） | `packages/plugin-contract/.../src/messaging.ts` | 包级 tsc |
| 2 | 包骨架 + workspace 依赖（@flowforge/plugin-contract、@flowforge/cats-stores）+ tsconfig.base paths + 根 tsconfig 注册 | `packages/chat/messaging/` | pnpm install 解析 |
| 3 | TDD 红：7 契约测试文件 | `tests/*.spec.ts` | vitest 红 |
| 4 | 契约核心（source-admission/host-types/validate） | `src/contract/*` | vitest 绿 |
| 5 | 信封投影 + 句柄 + 账本 | `src/envelope.ts`、`handles.ts`、`ledger.ts` | vitest 绿 |
| 6 | 存储端口 + 内存实现（memory/memory-cursor）+ index 导出面 | `src/stores/*`、`src/index.ts` | tsc |
| 7 | 全量核验 + oxlint | 全包 | vitest/tsc/oxlint 全绿 |
| 8 | mgr sync 提交 PR + review_code §13.2 序号 2 ✅ + 10-stage-map D44 + task.md | PR | mgr 通过 |

## 文件清单

- 新增（src）：`index.ts` + `contract/{source-admission,host-types,validate}.ts` +
  `envelope.ts` + `handles.ts` + `ledger.ts` + `stores/{ports,memory,memory-cursor,index}.ts`。
- 测试：7 个 `*.spec.ts` 契约测试文件。
- 契约类型：`packages/plugin-contract/.../src/messaging.ts`（新增）。
- 文档：spec 本文件上方已建、plan 本文件、review_code §13.2、10-stage-map D44、task.md。

## 验收

- ≥7 契约测试文件全绿；
- 包级 `tsc -p tsconfig.json --noEmit` exit 0；
- `oxlint` 0 error / 0 warning；
- 消除 `@clowder-ai/*` 与 `@cat-cafe/*` 引用；
- EP1-4 承接清单：send/append/event-stream/snapshot 服务、redis-* 适配器、factory、messaging-service 装配。