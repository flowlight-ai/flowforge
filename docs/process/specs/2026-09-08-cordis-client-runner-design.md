# EP1-11 设计：Cordis 动态插件的浏览器运行时与展示逻辑注入式移植

> **批号**：EP1-11 ｜ **包**：`@flowforge/cordis-client-runner` + `@flowforge/ui-cordis`
> **来源**：dsh `@deepseek-ai/dsh-cordis-client-runner`（client 半）+ `@deepseek-ai/dsh-client-ui-cordis`
> **来源编号**：A9 / A10（`10-stage-map.md` 矩阵 D50）｜ **生效版本**：0.1.0-rc.1
> **流程阶段**：design → plan → implement → review → verify → finish

---

## 1. 背景与目标

FlowForge 重构将全部 dsh / clowder / flowforge-Python 能力按"注入式 seam"模式整包移植为纯 TypeScript 包，
并配套契约测试。EP1-11 覆盖两个位于**页面/浏览器侧**、不可分割的核心能力：

- **`cordis-client-runner`**（A10）：把模型撰写的浏览器半源码变成页面上被 guard-facade 包装的活插件。
  按包加载/卸载排队、按 run-id 收敛、为渲染崩溃归属运行的所有权索引、Cordis 运行编排
  （approve / decline / start / reconcile）、只读 inspect 注册表、客户端 timer Service。
- **`ui-cordis`**（A9）：运行生命周期卡片（`cordis_define` / `cordis_run` / `cordis_stop` / `cordis_undefine`）
  的重放稳定视图模型、全局插件库存面板的模型侧（单飞读、重连复位、显式移除留痕）、
  每会话运行卡覆盖索引、可见状态派生，以及本地化文案。

**排除范围**：React/DOM 渲染胶水（Row / Panel 组件、slot 注册、`inputTriggers` 的 `@pluginId` 斜杠源）不在本批移植，
由宿主（EP2 前端融合）接线。真实的 `SlotRegistry`、`Context`、`Service`/`Loader`/`ClientModuleSystem`、Remote 传输均不在本包。

## 2. seam 策略

两个包彻底抽离全部原 cordis / dsh 依赖，替换为**包内注入式端口 + 真实内存实现**（无 mock），并满足既定约束：
零 `@deepseek-ai/*`、`@cat-cafe/*`、`@clowder-ai/*` 引用，无 cordis Service/Context feathers。

| 原 dsh/cordis 依赖 | 注入式端口 | 内存实现 |
|---|---|---|
| `SlotRegistry`／slot 插槽 | `ClientSlotsPort` / `SlotDeclarationSpec` / `LiveSlotNode` | `MemoryClientSlots` / `createMemoryClientSlots` |
| `Context` / `Service` / `Loader` / `ClientModuleSystem` | `ServiceHostPort` | `MemoryServiceHost` / `createMemoryServiceHost` |
| 样式宿主（React `CSSProperties`） | `StyleDocumentPort` / `StyleNode` | `MemoryStyleDocument` / `createMemoryStyleDocument` |
| 模块加载器 | `LoaderModulesPort` / `PackageFiber` | `MemoryLoaderModules` / `createMemoryLoaderModules` |
| `dsh-api-remotes` Remote 传输 | `CordisRunHostSeam`（runHostHalf / getClientCode / resolveRequestRun / settleUserRun） | 契约测试内联内存 seam |
| dsh `dsh-client-ui-slots` `HostObservable` | `HostObservable<T>`（getSnapshot/subscribe） | 库存 / 运行卡索引自持 |
| dsh `dsh-client-ui-tool` `Block` | `ToolCallViewModelBlock`（仅保留模型所需字段） | 测试 helper 构造 |
| dsh `dsh-util-values` `JsonValue` | 包级 `JsonValue`（values.ts） | — |
| dsh `dsh-client-ui-slots` 的 `declare module` locale 增强 | 无（本包只发布字典与 `CordisKey` 键空间） | `zh` / `en` / `dictionaries` |

### 不变式伴侣（invariant companions）

`cordis-client-runner` 对跨面状态（如同一插件不可并发运行、run-id 收敛单调、loaded 集合与活动 run 一致）
以纯函数不变式伴侣校验；宿主把不变量回填到 `InvariantSink`（可选）。这是对原 guard-facade
"静态守卫 + 动态托管"哲学的可测试复刻。

## 3. 包结构

### 3.1 `@flowforge/cordis-client-runner`（`packages/extensions/cordis-client-runner`）

```
src/
  types.ts            wire-safe 词汇（身份/行/决议/直播集/撤回）
  values.ts           JsonValue
  messages.ts         外部化用户文案与重定向语（规则 3）
  evaluator.ts        isDynamicCordisPlugin / evaluateClientHalf / DynamicCordisStyles
  guard.ts            whitelisting 动态 ctx facade（denyService / denyRead / readOnly）
  runtime.ts          DynamicCordisPackageRunner / DynamicCordisLivePackage / errorDetails
  orchestrator.ts     CordisRunOrchestrator / CordisRunHostSeam / CordisRunActivity（runHost/approve/decline/start/reconcile）
  inspect-registry.ts 只读 inspect 提供者注册表与查询结算
  providers.ts        jsonStringField 等 JSON 安全访问器
  api-catalog.ts / slot-catalog.ts  API 与槽位目录（重定向清册）
  timer.ts            客户端 timer Service（包级实现，setTimeout 类型修正）
  memory.ts           memoryCordisClientRuntime 装配工厂
  ports/: slots.ts / service-host.ts / style.ts / loader-modules.ts
tests/  evaluator / ports / runtime / guard / orchestrator / inspect-registry / memory .spec.ts
```

### 3.2 `@flowforge/ui-cordis`（`packages/extensions/ui-cordis`）

```
src/
  index.ts            公共导出面（默认导出 createCordisInventory）
  types.ts            types-only 子路径：事件词汇 + 全部 seam 类型
  events.ts           从 @flowforge/cordis-client-runner 复出的客户端词汇
  observable.ts       HostObservable<T>
  block.ts            ToolCallViewModelBlock（settled / running 联合）
  dynamic-port.ts     CordisDynamicPort / CordisActionResult / CordisInventoryRow
  card-model.ts       cordisDefineCard / cordisRunCard / cordisActionCard
  status.ts           cordisVisibleStatus / packageOf
  inventory.ts        createCordisInventory（单飞读 + 重连复位 + 显式移除留痕）
  run-card-index.ts   CordisRunCardRegistry / cordisToolViewKey
  locales.ts          NS / zh / en / CordisKey / dictionaries
tests/  card-model / status / inventory / run-card-index .spec.ts
```

### 3.3 依赖声明

- `ui-cordis` 仅类型依赖 `@flowforge/cordis-client-runner`（`tsconfig.references` → `../cordis-client-runner`，
  主/宿双 tsconfig 各带 `references`，host 引用对方 `tsconfig.host.json`）。
- 根 `tsconfig.base.json` paths 登记 `@flowforge/cordis-client-runner{,/types,/values}` 与 `@flowforge/ui-cordis{,/types}`。
- ESM，`type: module`，`main` / `types` 指向 `lib/`，导出映射含 `.`、`./types`、`./src/*`、`./package.json`，
  `license: MIT`，`publishConfig.access: public`。

## 4. 关键决策点

| # | 决策 | 记录 |
|---|---|---|
| Q-P1-11-1 | ui-cordis 与 runner 拆为**两个独立包**（沿 dsh 双包边界），而非合并，保持消费边界与宿主接线清晰 | 采用 |
| Q-P1-11-2 | `DynamicCordisLivePackage`、`CordisRunActivity` 等直播/活动类型归 runner 的 types 面，ui-cordis 经 `events.ts` 复出 | 采用 |
| Q-P1-11-3 | inventory 采用**单飞读 + generation 复位**而非增量 patch 缓存：wire 公告无标签、定义可增删，patch-in-place 会漂移 | 采用（复刻 dsh 语义） |
| Q-P1-11-4 | 运行卡覆盖索引按**每会话 store**；同一 `key(pluginId.packageId)` 仅更高 log `seq` 覆盖 | 采用 |
| Q-P1-11-5 | 本地化：只发布 `zh`/`en` 字典与 `CordisKey` 键空间，不注册 locale registry（宿主 i18n 自绑定） | 采用 |
| Q-P1-11-6 | 原 React 渲染、slot 注入、斜杠源一律不移植；全部 via 注入 seam 交由宿主 | 采用 |

## 5. 验收准则（DoD）

- `pnpm vitest run packages/extensions/ui-cordis packages/extensions/cordis-client-runner`：**82 个契约测试全绿**
  （runner 52 + ui-cordis 30），真实内存 seam、无 mock、确定性。
- `pnpm tsc -b packages/extensions/ui-cordis/tsconfig.json` → exit 0。
- `pnpm tsc -b packages/extensions/cordis-client-runner/tsconfig.json` → exit 0。
- `pnpm oxlint packages/extensions/ui-cordis packages/extensions/cordis-client-runner` → 0 警告/错误。
- 零 `@deepseek-ai/*` / `@cat-cafe/*` / `@clowder-ai/*` / cordis Service 引用。
- 全部用户可见文案与重定向语外部化至 `messages.ts` / `locales.ts`，无硬编码字符串。

---

> Agent Notes：本实施遵循 `docs/rules/13-dev-process.md` 注入 seam 移植规范；正式产物仅含 EP1-11 内容，
> 无历史残留。宿主接线（真实 slot 宿主、Remote、React 渲染、i18n 注册）归 EP2。