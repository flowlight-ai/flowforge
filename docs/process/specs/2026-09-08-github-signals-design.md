# EP1-5 GitHub 等待生命周期域 github-signals 移植设计（B5 · C47）

- 来源：clowder-ai `packages/api/src/domains/github-signals`（B5），crosswalk 落点 C47（`10-stage-map.md` 行 201）
- 落点：`packages/infrastructure/github-signals`（新包 `@flowforge/infrastructure-github-signals`）
- 依据：`docs/refactor/review_code.md` §13.2、`docs/refactor/10-stage-map.md` C47、§16 融合决策
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9
- 编译：包级 `tsc -b tsconfig.host.json` exit 0 + `oxlint` 0 告警；ESM；文件 ≤1000 行
- 边界：本批次仅留盘，由主会话统一提交（不做 git add/commit/push/mgr）

## 1. 范围界定

`github-signals` 源 5 个 TS 文件，实现 **GitHub wait 生命周期**：谓词目录（predicate catalog）→
baseline readers（PR 三态 + Issue）→ wait 状态机（not_tracked / state_only / deduped / notified）→
GitHubWaitLifecycleService（观察/终止/恢复/投递 + owner fence + 并发 generation CAS + review
loop brake nextStep 覆盖）→ 渲染器。本批次交付**自包含、接口驱动、注入式 seam 的域内核**。

本批次交付：

1. **域名契约（contract）**：全部 `@cat-cafe/shared` 契型本地重建，按 `messaging.ts` /
   `signal-intake/contract/*` 既有拆分模式放置于 `src/contract/`：
   - `github-wait.ts`：`WaitOutcomeV1`、`WaitTerminationActor`、`WaitTerminationEventV1`、
     `AutomationState`、`PrAutomationState`、`IssueWaitAutomationState`、`TaskItem`；
   - `baseline.ts`：`GitHubWaitBaseline`、`GitHubPrWaitBaseline`、`GitHubIssueWaitBaseline`、
     `GitHubReviewThreadBaseline`、`GitHubCiBaselineBucket`、`GitHubWaitMatchedDelta`；
   - `predicate.ts`：`GitHubWaitPredicate`、`GitHubPrWaitPredicate`、`GitHubIssueWaitPredicate`、
     `GitHubWaitPredicateKind`、`AwaitStateV1`、`GitHubPrAwaitStateV1`、`GitHubIssueAwaitStateV1`、
     `WaitOwnerFence`、`WaitContinuationCarrierV1`、`GitHubWaitSubjectRef`；
   - `owner-fence.ts`：`parseWaitOwnerFence`、`parseWaitContinuationCarrier`、
     `createWaitContinuationCarrier`（自实现，语义与 clowder 一致；owner fence 即 wait outcome 上的
     `ownerFence` 字段，wire 形状见 §2）。
2. **谓词目录**：`GitHubWaitPredicateCatalog.ts`（zod `discriminatedUnion` 校验 + 去重 superRefine +
   `matchGitHubWaitPredicates` 纯函数，覆盖全部 kind 的匹配/去重/校验）。
3. **baseline readers**：`GitHubWaitBaselineReader.ts`（PR 三态：review/ci/conflict 归并 +
   cursor 归并 + collectorState）、`GitHubIssueWaitBaselineReader.ts`（Issue 单态）。
4. **wait 状态机（纯函数）**：`wait-state-machine.ts`（`transitionWaitState`、
   `markWaitOutcomeDelivered`、`markWaitOutcomeLegacyUnfenced`、`WaitTransitionEvent`、
   `WaitRuntimeState`），从 clowder `wait-state-machine.ts` 逐字移植为纯函数。
5. **注入式端口 + 内存实现**：
   - `ports/ITaskStore.ts`：`get` / `replaceAutomationStateIfGeneration` /
     `patchAutomationState` + `MemoryTaskStore`（真实实现，临界路径不 mock）；
   - `ports/ConnectorDelivery.ts`：`ConnectorDeliveryDeps` / `ConnectorDeliveryInput` /
     `deliverConnectorMessage` 交付端口（返回 `{ messageId, content }`）+ `MemoryConnectorDelivery`；
   - `ports/IWaitLifecycleEventLog.ts`：`append` 事件端口 + `MemoryWaitLifecycleEventLog`。
6. **GitHubWaitLifecycleService.ts**：observe（not_tracked/state_only/deduped/notified、
   owner fence 隔离、并发 generation 重试、review loop brake 的 nextStep 覆盖）、cancel /
   ownerChanged / recoverOutcome / recordOutcomeEvent、legacy-unfenced 隔离。
7. **渲染器**：`github-wait-renderer.ts`（review loop brake 分类 + `renderGitHubWaitOutcome`）。

**本批次不交付（EP2/EP4 下游承接）**：
- 真实 GitHub API 适配（fetchCi/fetchReviews/fetchComments/fetchMergeState/fetchReviewThreads 的直接实现）；
- `ITaskStore` 宿主接线（flowforge `cats-stores` SQLite）；
- `ConnectorDelivery` 真实投递（消息 store + socket 载体 append）；
- `IWaitLifecycleEventLog` 持久化（Redis/message-bundle 事件追加）。

## 2. 依赖映射（消除 @cat-cafe/* 与 @deepseek-ai/*）

| 依赖 | FlowForge 等价 / 处理 |
|---|---|
| `@cat-cafe/shared` 契型（WaitOutcomeV1/WaitTerminationActor/WaitTerminationEventV1/AutomationState/PrAutomationState/IssueWaitAutomationState/TaskItem）| flowforge 无该域类型 → **包内 `src/contract/github-wait.ts` 本地类型** |
| `@cat-cafe/shared` 契型（GitHub*Baseline/ReviewThread/ci bucket/predicate/matched delta）| **包内 `src/contract/{baseline,predicate}.ts` 本地类型** |
| `@cat-cafe/shared` `createWaitContinuationCarrier` / `parseWaitOwnerFence` | **包内 `src/contract/owner-fence.ts` 本地实现**（语义一致） |
| `../ball-custody/wait-state-machine.ts`（transitionWaitState/markWaitOutcomeDelivered/markWaitOutcomeLegacyUnfenced/WaitTransitionEvent）| **包内 `src/wait-state-machine.ts` 纯函数**（逐字移植） |
| `../ball-custody/WaitLifecycleEventLog.ts`（IWaitLifecycleEventLog）| **包内 `ports/IWaitLifecycleEventLog.ts` + 内存实现** |
| `../cats/services/stores/ports/TaskStore.ts`（ITaskStore）| flowforge 宿主 store 契型不同 → **包内 `ports/ITaskStore.ts` 注入式端口 + `MemoryTaskStore`** |
| `infrastructure/email/deliver-connector-message.ts`（ConnectorDeliveryDeps/Input/deliverConnectorMessage）| **包内 `ports/ConnectorDelivery.ts` 注入式交付端口 + `MemoryConnectorDelivery`**（返回 `{messageId, content}`） |
| `zod`（supplier of GitHubWaitPredicateCatalog）| `zod` peer/devDependency（workspace ^4.4.3） |

> 关键解耦：**不引任何 `@clowder-ai/*` 或 `@cat-cafe/*` 或 @deepseek-ai**。全部外部
> 平台/存储/交付 seam 均以包内注入式端口实现；唯一运行时依赖为 `zod`。

## 3. owner fence wire 形状（parseWaitOwnerFence）

从 clowder `@cat-cafe/shared` `github-wait.ts` 读取确认：`WaitOwnerFence` 为 wait outcome 上的
`ownerFence` 字段（非重建，随 outcome 固化）。两种形态：

- `{ kind: 'containing_task', generation: number }`（generation > 0，SafeInteger）
- `{ kind: 'action_successor', leaseId: string, generation: number }`（leaseId 非空、generation > 0）

`parseWaitOwnerFence(value)` fail-closed：非对象/数组/缺精确键/非法 generation → `null`。
`parseWaitContinuationCarrier(value)`：`{ v:1, waitId, outcomeId, ownerFence }` 精确键 + ownerFence
合法才返回冻结对象。`createWaitContinuationCarrier(waitId, outcome)` 构造后经解析校验。

## 4. 状态机（transitionWaitState）

- 事件：`predicates_matched` / `subject_terminal` / `expired` / `owner_changed` / `superseded` /
  `user_cancel`（均带 `generation` + `at`）。
- 前置校验：无 active await 或 generation 不匹配 → `generation_inactive` 未应用；`at >= expiresAt` →
  `expired` 终止。
- `predicates_matched` 且 `matched.length === 0` → `empty_match` 未应用。
- 终止：写入 `waitOutcome`（`delivery` = matched/subject_terminal → `pending`，否则 `not_applicable`；
  `nextStep` 仅 pending 时带 `continuation.then`；`matched`/`terminalSubjectState` 条件附加），并清空
  `await`。ownerFence 从 active await 复制，不重建。
- `markWaitOutcomeDelivered`：pending → delivered（仅同 outcomeId）。`markWaitOutcomeLegacyUnfenced`：
  pending 且 parseWaitOwnerFence 为 null → legacy_unfenced。

## 5. 边界归并（GitHubWaitLifecycleService.observe）

对每个 task（`pr_tracking` / `issue_tracking`），三种作风一次观察形成如下结果归并：

```
if !task 或非法 kind                          → not_tracked
if 已存在 pending waitOutcome                 → publishPending（投递或 quarantine）
if !active await:
    if subjectState                           → replace(state, done) → state_only(subject_terminal...)
    if collectorPatch                         → patchAutomationState → state_only(no_active_wait)
if subjectState                               → transition subject_terminal
else:
    matched = matchGitHubWaitPredicates(...)
    if matched empty 且 at < expiresAt        → state_only(predicates_not_matched)（collectorPatch 落库）
    else → transition predicates_matched
transitionWaitState 未应用                    → deduped(reason)
CAS replaceAutomationStateIfGeneration 失败    → 重试（≤3）→ deduped(generation_changed_concurrently)
waitOutcome 缺失                               → state_only(terminalized_without_outcome)
delivery != pending                           → state_only(outcome.reason)
delivery == pending → publishPending:
    parseWaitOwnerFence 为空                   → quarantineLegacyUnfenced（若 fence 恢复则转投递）
    否则 render → deliverConnectorMessage → markWaitOutcomeDelivered → notified(...)
```

**review loop brake nextStep 覆盖**：`observe(input.reviewLoopBrake)` 中 `pause_once` →
`[review-loop-brake]`；`warn_open` → `[review-loop-history-unavailable] <continuation.then>`；投影到
`await.continuation.then` 后传给状态机，仅影响 outcome.nextStep。

**并发 generation 重试**：`replaceAutomationStateIfGeneration` 用 `expectedGeneration` +
`expectedUpdatedAt` CAS；失败（installed === null）则 `continue` 重新读取，最多 3 次，超出返回
`deduped(generation_changed_concurrently)`。

**owner fence 隔离**：`observe` 在 pending outcome 上先 `parseWaitOwnerFence`；无合法 fence 时走
`quarantineLegacyUnfenced`（最多 3 次 CAS，标记 `legacy_unfenced`），避免无 continuation 承载的投递。

## 6. 目录结构（目标）

```
packages/infrastructure/github-signals/
  package.json / tsconfig.json / tsconfig.host.json
  src/
    index.ts                    # 聚合导出
    contract/
      github-wait.ts            # wait outcome / actor / event / automation / task
      baseline.ts               # PR/Issue/ReviewThread/ci bucket/matched delta
      predicate.ts              # predicate / await state / owner fence / carrier
      owner-fence.ts            # parseWaitOwnerFence / parseWaitContinuationCarrier / createWaitContinuationCarrier
    ports/
      ITaskStore.ts             # + MemoryTaskStore
      ConnectorDelivery.ts      # + MemoryConnectorDelivery
      IWaitLifecycleEventLog.ts # + MemoryWaitLifecycleEventLog
    wait-state-machine.ts       # 纯函数
    GitHubWaitPredicateCatalog.ts
    GitHubWaitBaselineReader.ts
    GitHubIssueWaitBaselineReader.ts
    GitHubWaitLifecycleService.ts
    github-wait-renderer.ts
  tests/（契约测试，禁 Mock）
```

## 7. 测试铁律对齐

- **T1–T9 / 禁 Mock**：全部契约测试使用真实内存实现（`MemoryTaskStore` / `MemoryConnectorDelivery` /
  `MemoryWaitLifecycleEventLog`）。临界路径（状态机迁移、CAS 重试、投递）不 mock。
- 谓词目录：各 kind 的匹配/去重/校验（重复 kind、reviewThreadIds 唯一性、数量 1..4）。
- baseline readers：PR 三态（review/ci/conflict）汇总 + Issue 单态；cursor 归并。
- GitHubWaitLifecycleService：状态机迁移（not_tracked/state_only/deduped/notified）、owner fence
  隔离、并发 generation 重试、review loop brake 的 nextStep 覆盖、cancel/ownerChanged/recoverOutcome。
- 渲染器：`renderGitHubWaitOutcome` 对 matched / subject_terminal / review-loop-brake 分支文案。

## 8. 交付与门禁

- ≥契约测试全绿；包级 `tsc -b tsconfig.host.json` exit 0；`oxlint` 0 error / 0 warning；
- 根级注册：`tsconfig.host.json` + `tsconfig.base.json`（paths）+ `tsconfig.json`（references）；
- `10-stage-map.md` C47、`task.md` 5、`review_code.md` 5 状态更新；本批次仅留盘，由上级提交。

## 9. EP 下游承接清单

- **EP2（真实平台/存储接线）**：GitHub API 适配（fetchCi/fetchReviews/等）、真实连接器交付
  （消息 store + socket + queue custody 载体）、`IWaitLifecycleEventLog` 持久化（Redis）。
- **EP4（域装配 / 宿主适配）**：`ITaskStore` 适配 flowforge `cats-stores` SQLite；交付端口适配
  flowforge 消息 store；wait lifecycle 与 cats/orchestration 装配。