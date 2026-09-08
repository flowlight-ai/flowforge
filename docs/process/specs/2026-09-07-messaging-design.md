# EP1-3 messaging 主机内核核心移植设计（B4）

- 来源：clowder-ai `packages/api/src/domains/messaging`（B4），crosswalk 落点 D44（`10-stage-map.md`）
- 落点：`packages/chat/messaging`（新包 `@flowforge/chat-messaging`）
- 依据：`docs/refactor/review_code.md` §13.2 序号 2、§16 融合决策（B4 某批）
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9
- 编译：包级 `tsc --noEmit` exit 0 + oxlint 0 告警；ESM；文件 ≤1000 行

## 1. 范围界定

`messaging` 源约 26 个 TS 文件（域核心 + contract + stores 内存/Redis）。本批次（EP1-3）交付
**自包含、接口驱动、无外部平台依赖的"主机内核核心"**：

1. **契约（contract）**：`source-admission.ts`（Unicode 标量准入）、`host-types.ts`
   （Host-only 类型 + `MessagingError`/`SnapshotUnavailableHostError`）、`validate.ts`
   （draft/append 输入准入：INV-2、D-4、derivedFrom 顺序）
2. **信封投影**：`envelope.ts`（`projectEnvelope` / `parsePluginMessageExtra` /
   `readPluginMessageExtra` / `renderElementsText`，D-1 / P4）
3. **地址句柄**：`handles.ts`（`HandleService`，AC-2 / §4c，含 message-handle 幂等与撤销级联）
4. **幂等结算账本**：`ledger.ts`（`MessagingLedger`，AC-5 / §4a）
5. **存储端口 + 内存实现**：`stores/ports.ts`（`Ledger/Handle/EventLog/Cursor/AppendLock` 端口）、
   `memory.ts`（内存账本/句柄/事件日志/追加锁）、`memory-cursor.ts`（内存游标 + 冻结快照生命周期）

**本批次不交付（EP1-4 承接）**：`send-service`、`append-service`、`append-elements/output`、
`event-stream`、`snapshot-*`（capture/page/tokens）、`messaging-service`（createMessagingDomain 装配）、
`stores/factory` 与全部 `redis-*` 适配器。这些依赖 `IMessageStore` 投递语义与注入式 Redis seam，
属下一步。

## 2. 依赖映射（消除 @clowder-ai/* 与 @cat-cafe/*）

| 依赖 | FlowForge 等价 |
|---|---|
| `import type { MessageEnvelope, MessageElement, ... } from '@clowder-ai/plugin-contract'` + `MESSAGING_BOUNDS` / `isWireUInt53` / `validateMessagingRowInput` / `validateMessagingRowResult` | 新增 `@flowforge/plugin-contract` `src/messaging.ts`（wire 类型 + bounds + 权限校验器 + fail-closed 结构化校验），经包 `index.ts` 导出 |
| `import type { StoredMessage } from '../cats/services/stores/ports/MessageStore.js'` | `@flowforge/cats-stores/ports` 的 `StoredMessage`；因其暂无 `extra` 通道，本地以 `EnvelopeStoredMessage = StoredMessage & { extra?: { pluginMessage?: unknown } }` 相交类型适配（fail-closed 追加通道） |
| `@cat-cafe/shared` Redis 客户端 | 本批次不含 Redis 实现；EP1-4 采用 `@flowforge/infrastructure-redis-port` `RedisLikeClient`（仿 EP1-2 connectors 的注入式 seam），不依赖任何 `@cat-cafe/*` |

> 关键解耦：messaging 核心不引 `@cat-cafe/*`，不引 Redis 客户端；send/append/event-stream 服务下沉
> 到 EP1-4 后仍走同一 `stores/ports` seam。

## 3. 目录结构（目标）

```
packages/chat/messaging/
  src/
    index.ts
    contract/
      source-admission.ts
      host-types.ts
      validate.ts
    envelope.ts
    handles.ts
    ledger.ts
    stores/
      ports.ts
      memory.ts
      memory-cursor.ts
      index.ts
  tests/
    source-admission.spec.ts
    contract-validate.spec.ts
    envelope.spec.ts
    ledger.spec.ts
    handles.spec.ts
    memory-stores.spec.ts
    memory-cursor.spec.ts
```

## 4. 测试铁律对齐

- T1–T9：全部使用真实内存存储（`MemoryLedgerStore`/`MemoryHandleStore`/
  `MemoryEventLogStore`/`MemoryAppendLock`/`MemoryCursorStore`），**零 Mock**。
- 信封投影用真实 `StoredMessage` 行 + 结构化的 `pluginMessage` 载荷驱动（含 fail-closed 畸形载荷分支）。
- 契约校验直接对 `@flowforge/plugin-contract` 的 `validateMessagingRowInput/Result` 断言。

## 5. 交付与门禁

- ≥7 契约测试文件全绿；包级 `tsc -p tsconfig.json --noEmit` exit 0；`oxlint` 0 error / 0 warning；
- review_code §13.2 序号 2 ✅；`10-stage-map.md` D44 状态更新；task.md 勾选；
- 经 `mgr.ps1 sync` 提交 PR（类型 feat，scope messaging，署名 sherlock）。