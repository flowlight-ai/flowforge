# EP1-4 信号准入域 signal-intake 移植设计（B3 · C46）

- 来源：clowder-ai `packages/api/src/domains/signal-intake`（B3），crosswalk 落点 C46（`10-stage-map.md` 行 200）
- 落点：`packages/cats/signal-intake`（新包 `@flowforge/cats-signal-intake`）
- 依据：`docs/refactor/review_code.md` §13.2、`docs/refactor/10-stage-map.md` C46、§16 融合决策
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9
- 编译：包级 `tsc -p tsconfig.json --noEmit` exit 0 + `oxlint` 0 告警；ESM；文件 ≤1000 行

## 1. 范围界定

`signal-intake` 源 26 个 TS 文件（含测试 15 个 JS）。本批次（EP1-4）交付 **自包含、接口驱动、
注入式 seam 的信号准入域**：信号准入（SignalAdmission）→ 会议入站（Meeting Intake）→ 产物交付
（Artifact Delivery）→ ASR 人物记忆场景（ASR Person-Memory Scene）→ 来源访问租约
（Source Access Lease）→ 飞书来源解析（LarkCli Feishu）的全链路域内核，以**本地内存契约实现**
确定性测试。

本批次交付：

1. **域名类型契约（contract）**：`signals.ts`（MeetingIntake / MeetingArtifactDescriptor /
   SignalRouteRecord / SignalRuntimeBinding / MeetingIntakeChoices / MeetingIntakeRepair +
   meetingIntakeNeedsAttention）、`asr-person-memory-scene.ts`（ASR 反射常量 + write-opportunity
   场景 schema + presentation-retry carrier，忠实移植 clowder `memory-write-opportunity.ts`）、
   `events-publish.ts`（EventsPublishInput/Result + SignalDeclaration + 结构校验 fail-closed）。
2. **域内核**：`canonical-json.ts`、`errors.ts`、`IngressTrace.ts`（+ Memory 采集）、
   `signal-intake-keys.ts`、`DestinationAuthority.ts`（+ Memory）、`SignalRouteStore.ts`（+ Memory）、
   `SignalRuntimeLeaseStore.ts`（+ Memory）、`MeetingIntakeStore.ts`（+ Memory 串行队列 CAS）、
   `meeting-intake-codec.ts`（fail-closed 编解码）。
3. **会议产物预算/续页**：`meeting-artifact-read-budget.ts`（本地确定性 token 估算 seam）、
   `meeting-artifact-resource-contract.ts`（MeetingArtifactResourceError + read 视图/校验）、
   `MeetingArtifactResourceService.ts`（owner/thread/cat 授权 + revision 校验 + 分页游标）。
4. **来源访问租约**：`SourceAccessLeaseService.ts`（Memory store + SourceResolverRegistry +
   SourceResolver 端口 + SourceAccessError）。
5. **会议入站工作流**：`MeetingIntakeService.ts`（confirm/dismiss/markRepair/clearRepair +
   CAS 写）、`MeetingIntakeActionService.ts`（confirm→execute-from-source→deliver 编排 + +dispatcher 端口）。
6. **信号准入**：`SignalAdmissionService.ts`（binding 校验 → 声明/结构校验 → 建 MeetingIntake 入账），
   依赖注入式 `SignalAdmissionInventory` 端口（**本地内存实现**）。
7. **ASR 人物记忆**：`AsrPersonMemorySceneBuilder.ts`（confirmed + data_only → dynamic scene）、
   `AsrPersonMemoryQueueCarrier.ts`（scene→Queue 消息绑定，载体读端口注入）。
8. **线程目标权威**：`ThreadDestinationAuthority.ts`（parsePrivateThreadHandle）——本地
   `MeetingThreadStore` 端口（`createdBy/deletedAt/preferredCats/participants`），**非** flowforge
   `StoredThread`（缺这些字段，见 §2）。
9. **飞书解析**：`LarkCliFeishuSourceResolver.ts`（canonical `feishu://meeting-artifacts/…` 句柄 +
   注入式 run/fs + 本地 `parseFeishuMinutesReference` 提取）。
10. **交付编排骨架**：`ThreadMeetingArtifactDispatcher.ts`（F292 envelope 构建 + 目标 cat 选择 +
   ASR 场景绑定 + 幂等键 + presentation-retry 资格与载体校验），交付通过注入式
   `MeetingThreadDeliveryPort`（见 §2 边界）。
11. **Redis/KV seam**：`redis/seam.ts`（本地最小 `SignalIntakeRedisClient` 接口 + 内存假实现 +
   Lua 常量），`redis/RedisSignalRouteStore.ts` / `RedisMeetingIntakeStore.ts` /
   `RedisSourceAccessLeaseStore.ts`。

**本批次不交付（EP2/EP4 下游承接）**：
- `ThreadMeetingArtifactDispatcher` 的真实交付接线（`deliver/retryPresentation` 面向
  flowforge `cats-invocation` + 消息 store 的 `extra/source/queueCustody` 载体 append）——
  flowforge `IMessageStore`/`cats-invocation` 尚缺该载体契约（见 §2）；
- 真实 Redis 驱动绑定（仅 seam + 内存假实现）；
- 真实 `lark-cli` 进程默认 `run`（默认回退为发起子进程，但外部 `lark-cli` 凭据启用按 stretch S1）。

## 2. 依赖映射（消除 @clowder-ai/* 与 @cat-cafe/*）

| 依赖 | FlowForge 等价 / 处理 |
|---|---|
| `@cat-cafe/shared`（MeetingIntake/MeetingArtifactDescriptor/SignalRouteRecord/SignalRuntimeBinding/MeetingIntakeChoices/MeetingIntakeRepair/CatId）| `@flowforge/cats-shared` 无这些域类型 → **包内 `contract/signals.ts` 本地类型**；`CatId` 复用 `@flowforge/cats-shared`（`createCatId`/`CatId`，已 path 别名） |
| `@cat-cafe/shared`（ASR_PERSON_MEMORY_REFLEX_ENTRY_V1/asrPersonMemoryDynamicSceneEntryV1Schema/writeOpportunityGenerationId/writeOpportunityPresentationRetryCarrierV1Schema/BoundAsrPersonMemoryScene）| cats-shared 无 → **包内 `contract/asr-person-memory-scene.ts`**（忠实复制 clowder `memory-write-opportunity.ts`，zod ^4.4.3） |
| `@clowder-ai/plugin-contract`（EventsPublishInput/Result/SignalDeclaration/validateEventsPublishInput/validateDeclaredEventsPublishInput）| flowforge `@flowforge/plugin-contract` 无 signal 校验 → **包内 `contract/events-publish.ts`**（fail-closed 结构 + 声明校验 + 局部 JSON-schema 子集校验） |
| `../plugin/host-inventory`（PluginInventoryStore）| flowforge `cats-plugin-inventory` 的 manifest 无 `signals`/signalSchemas → **注入式本地 `SignalAdmissionInventory` 端口 + 内存实现**（域内核不直耦 host-inventory） |
| `cats/services/stores/ports/{MessageStore,ThreadStore}`（StoredMessage/Thread + extra/source/queueCustody 载体）| flowforge `StoredMessage` 无 `extra`/`source`、`StoredThread` 无 `createdBy/preferredCats/participants` → **本地 `MeetingArtifactCarrierReader` / `MeetingThreadStore` / `MeetingThreadDeliveryPort` 端口**，宿主适配为 EP2 下游 |
| `cats/services/agents/invocation/*`（InvocationQueue/QueueProcessor/createInitialQueuedMessageCustody/projectQueueReceipt/socket）| flowforge `cats-invocation` 为抽象 seam，无同契约 → **注入式 `MeetingThreadDeliveryPort`**，真实接线为 EP2 下游 |
| `@cat-cafe/shared/utils` RedisClient（eval/get/set NX·PX/smembers/mget/sadd）| `@flowforge/infrastructure-redis-port` `RedisLikeClient` 缺 string `set` 位 → **包内本地 `SignalIntakeRedisClient` seam（含 set NX/PX + eval + smembers/mget）+ 内存假实现**（仿 EP1-2 connectors 注入式） |
| `@clowder-ai/feishu-meeting-intake` `parseFeishuMinutesReference` | 外部发布包 `0.1.0-alpha.9` → **包内 `extract/minutes-reference.ts` 本地实现**（自包含 URL/token 提取） |
| `utils/token-counter` `estimateTokens`（js-tiktoken）| 避免重依赖 → **包内 `extract/token-estimate.ts` 本地确定性估算**（单调、可测），文档标注为本地近似 |

> 关键解耦：**不引任何 `@clowder-ai/*` 或 `@cat-cafe/*`**。全部外部平台/存储/调用方 seam
> 均以包内端口注入；仅 `@flowforge/cats-shared`（`CatId`）作为唯一运行时 workspace 依赖。

## 3. 目录结构（目标）

```
packages/cats/signal-intake/
  package.json / tsconfig.json
  src/
    index.ts
    canonical-json.ts
    errors.ts
    IngressTrace.ts
    signal-intake-keys.ts
    DestinationAuthority.ts
    SignalRouteStore.ts
    SignalRuntimeLeaseStore.ts
    MeetingIntakeStore.ts
    meeting-intake-codec.ts
    meeting-artifact-read-budget.ts
    meeting-artifact-resource-contract.ts
    MeetingArtifactResourceService.ts
    SourceAccessLeaseService.ts
    MeetingIntakeService.ts
    MeetingIntakeActionService.ts
    SignalAdmissionService.ts
    AsrPersonMemorySceneBuilder.ts
    AsrPersonMemoryQueueCarrier.ts
    ThreadDestinationAuthority.ts
    LarkCliFeishuSourceResolver.ts
    ThreadMeetingArtifactDispatcher.ts
    contract/
      signals.ts
      asr-person-memory-scene.ts
      events-publish.ts
    redis/
      seam.ts
      RedisSignalRouteStore.ts
      RedisMeetingIntakeStore.ts
      RedisSourceAccessLeaseStore.ts
    extract/
      minutes-reference.ts
      token-estimate.ts
  tests/（≥15 契约测试文件，禁 Mock）
```

## 4. 测试铁律对齐

- **T1–T9 / 禁 Mock**：全部契约测试使用真实内存实现（`MemoryMeetingIntakeStore`/
  `MemorySignalRouteStore`/`MemorySignalRuntimeLeaseStore`/`MemorySourceAccessLeaseStore`/
  `SignalAdmissionMemoryInventory`/`MemoryMeetingThreadStore`/`MemorySignalIntakeRedisClient`）。
- 信号准入用真实内存 `SignalAdmissionMemoryInventory` + `MemoryMeetingIntakeStore` + 真实路由/租约，
  断言 receipt 与各授权拒绝分支（AUTHORITY_MISMATCH/GRANT_MISSING/STALE_GRANT/RUNTIME_LEASE_*/
  ROUTE_UNAVAILABLE/STALE_ROUTE/IDEMPOTENCY_CONFLICT/SOURCE_IDENTITY_CONFLICT）。
- 会议入站与产物读取：真实 `MemoryMeetingIntakeStore` + `MemoryDestinationAuthority` +
  内存 `SourceAccessLeaseService`（真实租约/真实 resolver 返回制品）+ 真实 `MemoryMeetingThreadStore`，
  断言 confirm→resolve→deliver 状态机与分页游标。
- LarkCli 解析：`run` 注入假 stdout、临时目录用真实 `mkdtemp`、`readText` 用真实文件读取，
  断言路径逃逸防护（真实 fs）与错误映射（SOURCE_AUTH_REQUIRED/SOURCE_NOT_READY/SOURCE_DELETED）。
- ASR 场景：真实场景/机会 schema，断言 `buildAsrPersonMemoryDynamicScenes` 的门条件与
  `writeOpportunityGenerationId` 稳定性。
- Redis seam：`MemorySignalIntakeRedisClient`（实现 4 个 Lua 语义）驱动 Redis store，断言 accept/
  CAS/claim/revoke 全 outcome。

## 5. 交付与门禁

- ≥15 契约测试文件全绿；包级 `tsc -p tsconfig.json --noEmit` exit 0；`oxlint` 0 error / 0 warning；
- `10-stage-map.md` C46 状态更新；EP 下游承接清单维护于 §6；
- 经 `mgr.ps1 sync` 提交 PR（类型 feat，scope signal-intake，署名）——本批次仅留盘，由上级提交。

## 6. EP 下游承接清单

- **EP2（IM/凭据接线）**：`ThreadMeetingArtifactDispatcher` 真实交付（cats-invocation + 消息 store
  载体 append + socket）、真实 `lark-cli` 进程凭据启用、`LarkCliFeishuSourceResolver` 默认 `run` 落真。
- **EP4（域装配 / 宿主适配）**：`SignalAdmissionInventory` 适配 flowforge `cats-plugin-inventory`
  （manifest 补 `signals` + signalSchemas 通道）；`MeetingThreadStore`/`MeetingArtifactCarrierReader`/
  `MeetingThreadDeliveryPort` 适配 flowforge `cats-stores`/`cats-invocation`；Redis seam 接真实驱动。