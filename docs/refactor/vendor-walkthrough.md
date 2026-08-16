# `vendor/` 源码走读（专家版）—— flowforge 插件内核与装配层

> 面向评审人 / 架构师。如需入门讲解，见同目录 `vendor-walkthrough-beginner.md`。
> 所有结论基于实际代码行号（`file_path:line`），未对文件做任何修改。

## 0. 九库三层架构

| 层 | 库 | 角色 |
|---|---|---|
| **内核** | `cordis` | 插件框架本体："一切皆插件"，`ctx.plugin()` 注册、`ctx.effect()` 登记副作用、卸载时逆序回滚 |
| **工具** | `cosmokit` | 零依赖"小 lodash"（数组/对象/字符串/时间/二进制/clone/deepEqual） |
| | `schemastery` | 链式 builder 的配置 Schema 定义/校验/类型推导，实现标准 `StandardSchemaV1` |
| | `timer` | 随 cordis 上下文自动释放的定时器服务（防泄漏） |
| **装配** | `loader` | 把"声明式 entry list（YAML）"变成运行中的 cordis 插件图；分层合并/热重载/隔离 |
| | `group` | 仅一行再导出；分组逻辑在 `loader/config/group.ts` 的 `Group` |
| | `include` | 把一份 YAML/JSON 挂成可持久化的 loader 子树，用 `patches` 做 last-write-wins overlay |
| | `hmr` | 监听文件变化，安全局部热重载（externals 全量重启、用户代码局部重载） |
| | `logger-console` | cordis `Logger` 的 `Exporter` 实现（Node + 浏览器） |

依赖方向单向：`cosmokit` → `schemastery`/`cordis 各库`；`schemastery` 只通过标准 `~standard` 接口与 cordis 解耦；`timer`/`loader`/`group`/`include`/`hmr` 全部建立于 cordis 原语之上。

## 1. 一条核心数据流（必须先建立的心智模型）

```
new Context()
  └─ 构造根 Fiber(ACTIVE) + 装 reflect/registry/events/logger 四个内置 Service
ctx.plugin(MyPlugin, cfg)
  └─ RegistryService.plugin (registry.ts:316)
       └─ new Fiber(ctx, cfg, inject, runtime) (fiber.ts:222)
            └─ ctx = parent.extend({fiber:this})  —— 派生隔离子作用域
            └─ 依赖就绪后 _reload()→_execute() (fiber.ts:646/356)
                 └─ 跑 MyPlugin(ctx, cfg)
                      ├─ ctx.provide('x', v) → reflect.provide → fiber.effect(...) (reflect.ts:277)
                      ├─ ctx.on('e', fn)     → events.on → fiber.effect(...) (events.ts:288)
                      └─ ctx.effect(()=>{...}) → 直接入 _disposables (fiber.ts:418)
卸载（服务消失 / plugin.dispose / ctx 卸载）
  └─ Fiber._unload() (fiber.ts:675)
       └─ _disposables.clear()  —— 返回【逆序】列表 → 逐 await runDisposable
```

**关键结论**：所有"资源"（服务、监听器、任意副作用）最终都收敛到 `fiber._disposables` 这个 `DisposableList`，卸载时统一逆序释放——这就是"effect 自动回滚"的物理实现。

## 2. 内核 `cordis`（9 文件）

- **`context.ts`** — 对外 `Context` 接口/类。构造器返回 `new Proxy(this, ReflectService.handler)`（context.ts:74），属性读写全走代理陷阱；用 `Context.is` 这个**全局符号**判定跨 realm（vendor 副本与宿主各持一份 cordis 时仍成立）。`extend()`（:99）用原型链派生子作用域（父级永不改）；`isolate()`（:121）/ `intercept()`（:139）建立隔离 scope 与 per-plugin 配置覆盖。
- **`reflect.ts`** — DI 真正发生处。`handler.get`（:136）的解析算法：从调用方 ctx 沿 `fiber.parent` 父链向上，找**最近的、且同隔离 scope**的已 `provide` 实现；若声明了 `inject` 却不可用即抛错。`provide()`（:277）把服务注册也做成一个 `fiber.effect`，注销时 `notify` 所有依赖方触发其 `_refresh`/`_reload`——即"服务消失 → 依赖插件自动卸载"级联机制。
- **`fiber.ts`**（最复杂，约 755 行）— 一个 `ctx.plugin()` = 一个 Fiber，承载状态机 `PENDING→LOADING→ACTIVE→FAILED/DISPOSED/UNLOADING`。`effect()`（:415）用 `disposables.splice(0).reverse()` 逆序释放；`DisposableList.clear()`（utils）本身也逆序，双重保证 LIFO/RAII。`_reload`/`_unload`/`update`（:646/:675/:736）用 `inertia` 串行化多次变更、`internal/update` waterfall 支持 HMR veto。
- **`registry.ts`** — `ctx.plugin`/`ctx.inject` 落地。`plugin()`（:316）建 Fiber 并返回 `Fiber & PromiseLike`，可直接 `await ctx.plugin(...)` 等加载完成、错误即 reject。`Runtime`（:136）是"同一插件所有实例"的共享记录，fiber 是 per-load 实例。
- **`events.ts`** — 事件总线，5 种派发：`emit`(同步)/`parallel`(并发)/`serial`(顺序bail)/`bail`(同步短路)/`waterfall`(中间件链)。监听器是 fiber effect（:254），随卸载自动清理；`internal/*` 系列钩子是扩展点（生命周期、配置热更新、读写拦截、派发诊断）。
- **`service.ts`** — 能力推荐基类。子类 `extends Service` 构造即 `ctx.reflect.provide` 注册（:42），随卸载注销；`resolveConfig()`（:86）做分层配置合并（祖先 intercept 在先、base、head 在后），flowforge 的 per-plugin/环境覆盖可直接复用。
- **`logger.ts`** — 内置 `logger` 服务范例：可调用 + 多 exporter + fiber 级 effect；`WeakRef<Fiber>` 让日志携带来源 fiber 而不阻止回收。
- **`utils.ts`** — 共享设施：`DisposableList`（O(1) 删除 + clear 逆序）、`symbols`（全用 `Symbol.for` 全局共享）、traceable 上下文传播代理（:117-233，使嵌套服务方法再触发的子 effect 正确归属调用方 ctx）、长栈错误拼接。
- **`index.ts`** — barrel 再导出，无逻辑。

## 3. 工具库

- **`cosmokit`** — 注意语义差异：`isNullable` 含 `void` 不含 `0/''/NaN`；`pick` 默认丢 `undefined`；`remove` 是唯一原地修改的数组函数；`deepEqual` 非严格下 `null===undefined`；`Time.getTimezoneOffset` 在**模块加载瞬间固定**（隐式全局可变状态）；`parseTime("90")` 无单位会静默返回 `0`。
- **`schemastery`**（902 行）— Schema 既可被 `new`/调用做校验，又是不可变链式 builder；`~standard` getter（:275）实现 `StandardSchemaV1`，cordis 据此校验插件 `Config`。**两大隐性风险**：① 默认宽松——`object`/`dict` 非 strict 时 `merge` 把未声明 key 透传（拼写错误配置被静默接受）；② 嵌套 schema 校验会**就地改写父对象字段**（尤其 `transform`/`bitset`）。插件加载配置后不应再信任原始输入对象。
- **`timer`** — 所有定时器包在 `ctx.effect` 中（防泄漏）。`ctx.timeout(delay)` 返回的 Promise 在 ctx 销毁时 **reject**；`interval(delay)` 异步迭代器的 `next()` 单槽（必须 await 完一次再取下一次，否则丢 tick）；`throttle` 是 leading-edge。沙箱已禁用原生 `setTimeout`，强制用 `ctx.timeout/interval`。

## 4. 装配层（统一 dsh YAML 装配模型的运行时）

- **`loader/index.ts`** — `Loader` 是 entry 树所有者。`internal/config` 钩子（:92）对 group/include 这类 tree-carrier 短路，使其内嵌 `!!js` 推迟到子行自身 ctx 求值——分层装配基石。`internal/plugin` 钩子（:117）把"因故卸载的插件"持久化为 `disabled=true` 并 `tree.write()`。根 Loader 树 `write()` 是 no-op（:162），**只有 `Include` 子类才落盘**。
- **`loader/config/entry.ts`** — `Entry.update()`（:142）的分支设计是核心：**仅 `name/inject/group` 变更才整插件重启；纯 config 变更走 `fiber.update` 热更新**。事务失败回滚。
- **`loader/config/group.ts`** — group 即"config 是子 entry 列表的 entry"，`Group.update`（:59）用 `Promise.allSettled` + 逆序回滚保证批量装配原子性。
- **`loader/config/isolate.ts`** — 服务隔离 realm：`LocalRealm`（`#id` 私有）/ `GlobalRealm`（`@label` 按标签共享）；`loader/patch-context` 七步协议做隔离切换 + realm GC。
- **`loader/config/include.ts`** — `applyEntryPatches()`（:58）是 bundle→mode→profile→overlay 的引擎：**按 patch 顺序 last-write-wins，且 overlay 是"按 key 浅覆盖 / 整块 config 替换"，不是深合并**（最易踩坑点）。`structuredClone` 保证输入永不变异，热重载可重复 apply。
- **`loader/config/utils.ts`** — `!!js` 用 `with(ctx){eval(expr)}` 在 entry 激活时求值。
- **`loader/internal.ts`** — 取 Node 内部 ESM loader，适配 V1/V2，是 HMR 强依赖 `--expose-internals` 的原因。
- **`group/src/index.ts`** — 仅 `export default Group`，分组逻辑全在 loader。
- **`include/src/index.ts`** — YAML `!!js` 标签 + `EntryListSchema` + `Include extends EntryTree`（原子写 `.tmp`→`rename`，失败重试用 `WRITE_RETRY_LIMIT`）。
- **`hmr/`** — `partialReload`（:400）分类算法（accepted/declined 沿依赖图向下游传播）、清 ESM+CJS 缓存（先备份回滚）、复用 `fiber.entry`/`entry.fiber` 重建以保留状态；externals（CLI worker 依赖树）变更走 `loader.exit()` 全量重启。
- **`logger-console/`** — `shared.ts` 的 `ConsoleExporter` 基类 + Node/Browser 两实现。

## 5. 与 flowforge 重构的关联

flowforge 计划"统一采用 dsh 的 cordis YAML 装配模型"替代 clowder 的目录扫描+控制面审批，vendor 正是该模型的运行时。重点复用的 10 项机制：

1. `ctx.plugin`/`ctx.inject` 作为唯一插件入口（返回 PromiseLike 可 await）
2. `ctx.effect` 逆序 unwind（资源清理契约，杜绝泄漏）
3. `ctx.provide`/`Service` 子类 = 能力注入（数据库/网关等内核能力写成 `extends Service`）
4. DI 解析与 `ctx.isolate` 多租户/多环境隔离
5. `Service.resolveConfig` 分层配置合并（替代自造合并）
6. 事件 5 模式 + 监听器随卸载清理
7. `internal/*` 钩子挂调试面板/HMR/权限代理
8. `ctx.extend/isolate/intercept` 廉价不可变作用域（不用可变全局态）
9. traceable 上下文传播（嵌套副作用正确归属）
10. 标准 schema 配置校验（`ValidationError` + `fiber.await()` reject）

## 6. 给评审团队的重点边界/坑

- **vendor 应冻结**：按 AGENTS.md 是"源码 vendor"，flowforge 应包装/继承/调用，需改则上溯 deepseek-harness 上游。
- **overlay 浅覆盖非深合并**（include:121-124）：mode/profile 层给同一插件贡献部分 config 必须用不重叠 key，否则后层整块覆盖前层。
- **tree-carrier 字面量约定脆弱**（group/include 靠 `static [EntryGroup.key]=true`）：任何承载子清单的新插件都必须打此标记，否则内嵌 `!!js` 被提前求值。
- **根 Loader 树不落盘**：YAML 替代控制面审批的落库路径必须经 `Include` 或自写 `EntryTree` 子类。
- **HMR externals 全量重启**：不要把"控制面审批逻辑"放进会被当作 externals 的入口依赖，否则失去热更新优势。
- **`Time.getTimezoneOffset` 模块加载时固定、schemastery 用 `globalThis` 模块变量**：测试并发/SSR 注意隔离。
- **schemastery 默认宽松 + 就地改写**：插件加载配置后只用校验返回值，不信任原始输入。
- 源码用 `.ts` 扩展名相对导入，构建需支持 ESM `.ts` 解析（tsx/打包器/扩展名重写）。
