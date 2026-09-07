# EP1-2 connectors IM 框架本体移植设计（B7）

- 来源：clowder-ai `packages/api/src/infrastructure/connectors`（B7），crosswalk 落点 D43（`10-stage-map.md`）
- 落点：`packages/infrastructure/connectors`（新包 `@flowforge/infrastructure-connectors`）
- 依据：`docs/refactor/review_code.md` §13.2 序号 2、§16 融合决策
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9
- 编译：包级 `tsc --noEmit` exit 0 + oxlint 0 告警；ESM；文件 ≤1000 行

## 1. 范围界定

`connectors` 源约 67 个 TS 文件。其中 **IM 框架本体（自包含、接口驱动、不绑定具体 IM 平台凭据）** 为 EP1-2 交付对象；
依赖外部平台 SDK/凭据的适配器（feishu/dingtalk/telegram/wecom-agent/wecom-bot/weixin/xiaoyi）与 github-repo-event、
media（STT/媒体上传）属 EP2/EP4 承接，**不在此批次**。

本批次（EP1-2 框架本体）交付：

1. **绑定存储接口层**：`connector-thread-binding-store.ts`（IConnectorThreadBindingStore + MemoryConnectorThreadBindingStore + RedisConnectorThreadBindingStore）
2. **去重**：`inbound-message-dedup.ts`（InboundMessageDedup，内存 LRU 类）
3. **入站编排**：`connector-router.ts`（ConnectorRouter：去重 → 绑定查找/建 thread → 写消息（ConnectorSource）→ 触发猫调用）
4. **命令层**：`connector-command-layer.ts`（/new /threads /use /where /thread /commands /cats /status /history /unbind /allow-group /deny-group /focus /ask /focus）
5. **命令助手**：`connector-command-helpers.ts`（buildThreadDeepLink/auditSlashCommand/buildCommandsList/buildCatsInfo/buildStatusInfo/matchByFeatId/matchByListIndex/matchByIdPrefix/matchByTitle 等）
6. **消息格式化**：`connector-message-formatter.ts`（MessageEnvelope / CardAction / FormatInput + format / formatMinimal / formatCommand）
7. **权限存储接口层**：`connector-permission-store.ts`（IConnectorPermissionStore + MemoryConnectorPermissionStore + RedisConnectorPermissionStore）
8. **出站投递钩子**：`outbound-delivery-hook.ts`（IOutboundAdapter / IStreamableOutboundAdapter / ThreadMeta + OutboundDeliveryHook：富块解码、媒体回退、limb fanout）
9. **编排出站流**：`streaming-outbound-hook.ts`（StreamingOutboundHook：placeholder→edit 内联流，K2 契约）
10. **mention 解析**：`mention-parser.ts`（parseMentions，零宽字符/markdown 噪声清洗 + 首文命中）
11. **富块纯文本**：`rich-block-plaintext.ts`（renderAllRichBlocksPlaintext）
12. **外部连接器注册表**：`external-connector-registry.ts`（ExternalConnectorMeta + register/update/GetAll/unregister/clear）
13. **网关装配**：`connector-gateway-bootstrap.ts` / `connector-gateway-lifecycle.ts`（bootstrap 注册外部连接器、lifecycle 启停托管钩子）
14. **绑定键 DSL**：`connector-binding-keys.ts`

## 2. 依赖映射（消除 @cat-cafe/*）

| @cat-cafe/shared 依赖 | FlowForge 等价 |
|---|---|
| `type CatId` / `CatRegistry` / `normalizeCatId` | `@flowforge/cats-shared`（ids.ts / registry/normalize-cat-id.ts） |
| `ConnectorSource` / `ConnectorDefinition` / `ConnectorThreadBinding` / `getConnectorDefinition`/`getAllConnectorDefinitions`/`registerConnectorDefinition`/`unregisterConnectorDefinition` | `@flowforge/cats-shared` `types/connector.ts`（已齐备） |
| `RichBlock` + 各块类型 | `@flowforge/cats-shared` `types/rich.ts`（已齐备） |
| `parseCommand` | `@flowforge/cats-shared` `command-parser.ts` |
| `catRegistry`（displayName lookup） | `@flowforge/cats-shared` registry（宿主注入 `catLookup?: (catId)=>DisplayInfo | undefined`，避免包内直耦 CatRegistry） |
| `@cat-cafe/shared/utils` RedisClient | `@flowforge/infrastructure-redis-port` `RedisLikeClient`（缺 `hexists`/`hdel` → 包内以本地辅助封装补齐，不改 redis-port 契约本体，见 Q6 已裁决注入式） |
| `fastify` FastifyBaseLogger | 抽象 `Logger` 最小接口（info/warn/error），宿主注入，不引 fastify 包 |

> 关键解耦：**不引任何 `@cat-cafe/*`**。出站适配器抽象 IOutboundAdapter 由插件/宿主注入，`external-connector-registry` 与 `im-connector-loader` 不硬编码各平台适配器。

## 3. 目录结构（目标）

```
packages/infrastructure/connectors/
  src/
    index.ts
    connector-thread-binding-store.ts
    connector-permission-store.ts
    inbound-message-dedup.ts
    connector-router.ts
    connector-command-layer.ts
    connector-command-helpers.ts
    connector-message-formatter.ts
    outbound-delivery-hook.ts
    streaming-outbound-hook.ts
    mention-parser.ts
    rich-block-plaintext.ts
    external-connector-registry.ts
    connector-gateway-bootstrap.ts
    connector-gateway-lifecycle.ts
    connector-binding-keys.ts
  tests/
    connector-thread-binding-store.spec.ts
    connector-permission-store.spec.ts
    inbound-message-dedup.spec.ts
    connector-router.spec.ts
    connector-command-layer.spec.ts
    connector-command-helpers.spec.ts
    connector-message-formatter.spec.ts
    outbound-delivery-hook.spec.ts
    streaming-outbound-hook.spec.ts
    mention-parser.spec.ts
    rich-block-plaintext.spec.ts
    external-connector-registry.spec.ts
```

## 4. 测试铁律对齐

- T1–T9：真实存储（Memory store）、临时目录（出站媒体 data-uri → 真实临时文件）、**禁 Mock**。
- Router/CommandLayer 以真实 Memory 绑定存储 + 真实富块 + 真实 mention 解析注入驱动，断言 CommandResult/边效应。
- OutboundDeliveryHook 用真实 `IOutboundAdapter` 桩实现（记录发送调用）验证富块解码与媒体回退分支。

## 5. 交付与门禁

- ≥12 契约测试文件全绿；包级 `tsc -p tsconfig.json --noEmit` exit 0；`oxlint` 0 error / 0 warning；
- review_code §13.2 序号 2 ✅；`10-stage-map.md` D43 状态更新；task.md 序号 2 勾选；
- 经 `mgr.ps1 sync` 提交 PR（类型 feat，scope connectors，署名）。