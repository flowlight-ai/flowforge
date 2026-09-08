# EP1-4 实施计划：信号准入域 signal-intake 移植（B3 · C46，自包含批次）

- 依据：`docs/process/specs/2026-09-07-signal-intake-design.md`
- 批次目标：落 `packages/cats/signal-intake`（@flowforge/cats-signal-intake），
  SignalAdmission/RouteStore/MeetingIntake 全家/ASR 人物记忆队列/来源访问租约/
  LarkCliFeishuSourceResolver/ThreadDestinationAuthority，vitest/tsc/oxlint 全绿。
- 遵循：测试铁律 T1–T9，禁 Mock，仅留盘（不 git add / commit / push，运行 `./mgr`）。
- 边界：**不含** 真实交付接线（cats-invocation/消息 store 载体）、真实 Redis 驱动绑定、
  真实 `lark-cli` 凭据启用（EP2/EP4 承接，见设计 §6）。

## 步骤与门禁

| # | 步骤 | 产物 | 门禁 |
|---|---|---|---|
| 1 | 域契约类型（signals / asr-person-memory-scene / events-publish） | `src/contract/*` | 包级 tsc |
| 2 | 域内核：canonical-json / errors / IngressTrace / keys / DestinationAuthority / SignalRoute / SignalRuntimeLease / MeetingIntakeStore / codec | `src/*` | vitest 绿 |
| 3 | 会议产物预算/续页 + 资源服务 | `meeting-artifact-*` + `MeetingArtifactResourceService.ts` | vitest 绿 |
| 4 | 来源访问租约 + 会议入站服务/动作服务 | `SourceAccessLeaseService.ts` + `MeetingIntakeService.ts` + `MeetingIntakeActionService.ts` | vitest 绿 |
| 5 | 信号准入（注入式 inventory 端口 + 内存实现） | `SignalAdmissionService.ts` | vitest 绿 |
| 6 | ASR 人物记忆场景/队列载体 | `AsrPersonMemorySceneBuilder.ts` + `AsrPersonMemoryQueueCarrier.ts` | vitest 绿 |
| 7 | 线程目标权威 + LARK 解析 + 交付编排骨架 | `ThreadDestinationAuthority.ts` + `LarkCliFeishuSourceResolver.ts` + `ThreadMeetingArtifactDispatcher.ts` | vitest 绿 |
| 8 | Redis seam + 三个 Redis store | `src/redis/*` | vitest 绿 |
| 9 | 包骨架（package.json 声明 cats-shared/zod workspace 依赖，exports/files 对齐 messaging）+ tests | `packages/cats/signal-intake/` | pnpm 解析 |
| 10 | 全量核验 + oxlint + `10-stage-map.md` C46 状态更新 | 全包 | vitest/tsc/oxlint 全绿 |

## 文件清单

- 新增（src）：`index.ts` + `contract/{signals,asr-person-memory-scene,events-publish}.ts` +
  `canonical-json.ts` + `errors.ts` + `IngressTrace.ts` + `signal-intake-keys.ts` +
  `DestinationAuthority.ts` + `SignalRouteStore.ts` + `SignalRuntimeLeaseStore.ts` +
  `MeetingIntakeStore.ts` + `meeting-intake-codec.ts` + `meeting-artifact-read-budget.ts` +
  `meeting-artifact-resource-contract.ts` + `MeetingArtifactResourceService.ts` +
  `SourceAccessLeaseService.ts` + `MeetingIntakeService.ts` + `MeetingIntakeActionService.ts` +
  `SignalAdmissionService.ts` + `AsrPersonMemorySceneBuilder.ts` + `AsrPersonMemoryQueueCarrier.ts` +
  `ThreadDestinationAuthority.ts` + `LarkCliFeishuSourceResolver.ts` +
  `ThreadMeetingArtifactDispatcher.ts` + `redis/{seam,RedisSignalRouteStore,RedisMeetingIntakeStore,RedisSourceAccessLeaseStore}.ts` +
  `extract/{minutes-reference,token-estimate}.ts`。
- 测试：≥15 个契约测试文件（tests/*.spec.ts）。
- 文档：spec（上方已建）、plan（本文件）、`10-stage-map.md` C46。

## 验收

- ≥15 契约测试文件全绿；
- 包级 `tsc -p tsconfig.json --noEmit` exit 0；
- `oxlint` 0 error / 0 warning；
- 消除 `@clowder-ai/*` 与 `@cat-cafe/*` 引用（唯一 workspace 依赖 `@flowforge/cats-shared` + zod）；
- EP2/EP4 承接：真实交付接线、真实 Redis 驱动、真实 lark-cli 凭据、host-inventory/cats-stores 载体适配。