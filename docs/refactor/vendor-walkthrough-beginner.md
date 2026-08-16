# `vendor/` 源码走读（小白版）—— 带你像看故事一样理解代码

> 如果你觉得专家版看不懂，从这份开始。配套：专家版 `vendor-walkthrough.md`、映射表 `vendor-mapping-flowforge.md`、可运行 demo `vendor-demo.ts`。

## 一、先建立直觉：这些代码在解决什么问题？

flowforge 想做一件大事：**把"能聊天的 AI 智能体、能调工具、能多人群聊、能热更新"等一堆功能，用"插件(plugin)"的方式拼起来**，而不是把功能全写死在一个程序里。

`vendor/`（vendor = 第三方源码，这里指我们从 deepseek-harness 直接"搬"进来的代码）就是这套**插件系统的发动机**。

最贴切的比喻——**cordis 是一间"共享办公室"**：

- 你想加一个新功能？就像**带一台设备入驻办公室**（这就是一个 plugin，插件）。
- 办公室里有些**公共设施**（电、网、打印机）——对应代码里的 **Service（服务）**，比如数据库、消息总线。
- 你入驻时领到一个**工位/工作证**——对应 **Context（上下文/作用域）**，它决定你能用到哪些设施。
- 你借了东西要还——对应 **effect（副作用/清理登记）**，插件搬走时系统按"后借先还"自动帮你归还，不会漏。
- "按菜单上菜"的人——对应 **Loader（装配器）**，菜单就是一份 YAML 配置文件。

下面把所有英文术语先给你一张对照表，后面出现时我也会再标一次。

## 二、小白术语词典（英文 → 中文，配比喻）

| 英文 | 中文 | 比喻 |
|---|---|---|
| **plugin** | 插件 | 你带进办公室的一台设备/一项功能 |
| **Context** | 上下文 / 作用域 | 你的工位证，决定你能用哪些设施 |
| **Service** | 服务 | 办公室公共设施（电、网、数据库） |
| **effect** | 副作用 / 清理登记 | "借东西要还"的借条 |
| **Fiber**（纤维） | 插件运行实例 | 你这次入驻的"生命周期记录本" |
| **DI / Dependency Injection** | 依赖注入 | 你伸手说"我要电"，系统递给你，不用自己找 |
| **Loader** | 装配器 / 加载器 | 按菜单(YAML)上菜的人 |
| **overlay** | 叠加层 / 覆盖 | 透明胶片叠加，后放的盖住先放的 |
| **isolate** | 隔离 | 给某个设施划独立房间，互不影响 |
| **schema** | 模式 / 结构规则 | 填表规则：每格填什么类型、默认值 |
| **HMR (Hot Module Replacement)** | 热模块替换 | 换灯泡不关总闸，改代码不重启程序 |
| **bundle** | 基础打包层 | 菜单的"底图" |
| **profile** | 配置档 | 一层透明胶片，如"测试环境"胶片 |
| **realm** | 隔离域 | 按标签共享的独立房间 |
| **dispose / disposable** | 清理 / 可清理项 | 搬走时的一一归还动作 |
| **inject** | 依赖声明 / 注入 | "我需要电"的申报 |
| **intercept** | 拦截 / 配置覆盖 | 在某设施上叠加一层自定义配置 |
| **Runtime** | 运行时实例集合 | "同一台设备所有入驻记录"的总档 |
| **standard-schema** | 标准模式 | 各库通用的"填表规则"标准格式 |

## 三、维度一·定位：九个库在 flowforge 里各干什么？

把这九个子目录分成三层，从上往下看：

**第 1 层 · 发动机 `cordis`（最核心，先吃透它）**
> 没有它就没有"插件系统"。它负责：开办公室(Context)、让人入驻(plugin)、提供设施(Service)、借还东西(effect)、发通知(event)。

**第 2 层 · 工具箱（被上面所有人用）**
- `cosmokit`：通用小工具（数组去重、深拷贝、时间换算等），相当于"瑞士军刀"，自己不依赖任何框架。
- `schemastery`：配置"填表规则"。插件要读配置时，用它定义"这个配置长啥样、默认值多少、超不超标"，加载时自动校验。
- `timer`：带"自动关灯"的定时器。你用 `ctx.timeout()` 开定时器，办公室关门它自动停，不会变成"幽灵定时器"一直跑。

**第 3 层 · 装配与运维（把插件组织成产品）**
- `loader`：核心。**把一份 YAML"菜单"变成真正在跑的插件**。还管分层合并、热重载、隔离。
- `group`：只是把 loader 里的"分组能力"再导出一下（真正逻辑在 loader 里）。
- `include`：把一份 YAML/JSON 文件变成"可保存的菜单子树"，并支持 overlay 叠加。
- `hmr`：文件改了，自动热更新对应插件，不重启整个程序。
- `logger-console`：日志输出后端（在终端/浏览器打印日志）。

一句话总结各库角色：**cordis 定规则 → cosmokit/schemastery/timer 当工具 → loader/include/group/hmr 按菜单组装并热更新 → logger-console 负责喊话。**

## 四、维度二·执行流程走读：从开门到关门，一步步

我用一个最朴素的例子，带你看代码怎么流动（下面的行号来自 vendor 源码，你对着文件看更易懂）：

```ts
import { Context } from '@flowforge/cordis'

// ① 开办公室
const ctx = new Context()
//    内部做了：建一个"根 Fiber(Fiber=运行实例)" + 装上 4 个内置设施(reflect/registry/events/logger)

// ② 带一台设备入驻（注册一个插件）
ctx.plugin((ctx) => {
  // ③ 提供一个设施（Service）
  ctx.provide('greeter', { hello: (n: string) => `你好, ${n}` })

  // ④ 借一样东西：监听"有人进群"事件，并登记清理
  ctx.on('user/join', (n: string) => console.log(ctx.greeter.hello(n)))

  // ⑤ 再借一样：开定时器，登记"怎么关"
  ctx.effect(() => {
    const t = setInterval(() => console.log('tick'), 1000)
    return () => clearInterval(t)   // ← 归还函数
  })
})
```

**代码背后发生了什么（对应源码）：**

1. `new Context()`（`context.ts:71`）：构造器返回 `new Proxy(...)`——意思是"以后你读 `ctx.xxx`，都先经过一道门卫(reflect 的代理陷阱)处理"，这样它才能做"依赖注入"。
2. `ctx.plugin(...)`（`registry.ts:316`）：创建一个 **Fiber（运行实例）**（`fiber.ts:222`）。Fiber 就是"你这次入驻的生命周期记录本"。
3. 运行你的插件函数时（`fiber.ts:356` `_execute`）：
   - `ctx.provide('greeter', ...)` → 走 `reflect.ts:277`，把 'greeter' 登记成设施，**并且这本身也是一个 effect**——意味着插件搬走时它会自动注销。
   - `ctx.on(...)` → 走 `events.ts:288`，监听器被包成一个 effect（`events.ts:254`）——插件搬走，监听器自动移除。
   - `ctx.effect(...)` → 走 `fiber.ts:418`，你的"归还函数"被收进 `_disposables`（一个清理清单）。
4. **关门（卸载）时**（`fiber.ts:675` `_unload`）：调用 `_disposables.clear()`，它返回**逆序**列表，一个个执行归还函数。**为什么逆序？** 因为你后借的东西往往依赖先借的（先通电才能开电脑），所以要"后借先还"，这叫 RAII 原则，避免还错了顺序导致悬空引用。

> 小白记住一句话：**在 cordis 里，"打开即需关闭"的东西，统统用 `ctx.effect(() => { ...; return () => 清理 })` 登记，你不用操心什么时候关，系统兜底。**

## 五、维度三·实战举例：flowforge 里你会怎么写/怎么配

**例 1：写一个"数据库服务"（用 Service 基类，最规范写法）**

```ts
import { Context, Service } from '@flowforge/cordis'

class DatabaseService extends Service {
  constructor(ctx: Context, public url: string) {
    super(ctx, 'db')   // 设施名叫 'db'；构造即自动注册成 ctx.db
  }
  query(sql: string) { /* 真正查库 */ }
}

ctx.plugin((ctx) => {
  const db = new DatabaseService(ctx, 'sqlite://data/flowforge.db')
  // 现在任何插件都能 ctx.db.query(...) 用到它
  // 本插件卸载时，db 自动注销，依赖 db 的其它插件也会被自动"请走"
})
```

**例 2：用 schemastery 给插件定义"填表规则"（配置 schema）**

```ts
import { Schema } from '@flowforge/schemastery'

export const Config = Schema.object({
  model: Schema.string().default('deepseek-v4'),   // 字符串，默认 deepseek-v4
  temperature: Schema.number().min(0).max(2).step(0.1),  // 0~2，步进0.1
  debug: Schema.boolean().default(false),
})
// cordis 加载插件前会用这个规则校验用户填的配置，填错直接报错
```

**例 3：用 Loader + YAML "按菜单上菜"（flowforge 真正的装配方式）**

```yaml
# cordis.yml —— 一张基础菜单(bundle)
- name: '@flowforge/plugin-llm-deepseek'
  config:
    apiKey: '!!js process.env.DEEPSEEK_KEY'   # !!js = 运行时执行这段 JS 取值
- name: '@flowforge/plugin-acp-agent'
  config:
    model: 'deepseek-v4'

# overlay 叠加层：在底图之上，再盖一层"回放测试"胶片
patches:
  - id: llm-deepseek
    disabled: true                 # 把上面的 deepseek 关掉
  - id: llm-replay
    name: '@flowforge/plugin-llm-replay'   # 换成回放插件
```

含义：**base 菜单是底图，patches 是一层透明胶片，胶片上的内容盖住底图（last-write-wins，后写覆盖先写）**。这就是为什么 flowforge 能用"基础配置 + 环境配置 + 用户覆盖"层层叠加，而不用改底层文件。

## 六、维度四·设计思想：为什么这么设计？（小白版）

**思想 1：一切皆插件 + 自动归还 = 不漏资源**
传统程序里，你开定时器、连数据库，得自己记得关，一忘就内存泄漏。cordis 把"清理"变成**登记制(effect)**：你只管借，系统在插件生命周期结束时统一逆序归还。这是整个框架最值钱的设计。

**思想 2：Context 用"工位继承"做隔离，而非全局变量**
每个插件拿到的是"子工位"(子 Context)，它继承父级所有设施，但只能用自己的副本，绝不改父级。这保证了**多插件并行、多环境共存互不污染**——对应 `ctx.isolate(name, label)`（隔离）和 `ctx.extend()`（派生）。

**思想 3：依赖注入(DI)——"要什么伸手拿，不用自己造"**
插件里写 `ctx.db` 就能拿到数据库，不用关心它在哪、谁创建的。系统从"最近的、同隔离域的"设施里给你。缺失还会直接报错，早发现早修。

**思想 4：分层装配(overlay)——配置像透明胶片叠加**
`bundle → mode → profile → overlay`，每层是一张胶片，后放的盖先放的。好处：基础配置不动，换环境只换最上面一层；回滚也只需抽掉一层。代价（坑，见下节）：overlay 是"整块覆盖"不是"深合并"。

**思想 5：热更新(HMR)不丢状态**
改一个插件文件，hmr 只重建这个插件对应的 Fiber，并复用原来的"入驻记录本"(fiber.entry)，所以**配置和会话状态还在**，不像重启程序全清空。但如果你改的是"框架本身"(externals)，它会宁可全量重启，保证安全。

## 七、维度五·小白避雷（最容易踩的坑）

1. **overlay 是"整块覆盖"，不是"合并"**：假设基础层给插件 A 配了 `{a:1, b:2}`，你的 profile 层只想改 `b`，写了 `{b:3}`——结果 `a` 会被**整个丢掉**（变成只剩 `{b:3}`）。要改部分字段，两层必须用不重叠的 key，或把完整 config 写全。
2. **schemastery 默认"宽容"**：你配置里拼错字段名（如 `temprature`），它**不会报错，直接忽略**。调试时以为是配置生效了，其实根本没读。
3. **schemastery 会"就地改写"你的对象**：比如 `transform` 类型会把字符串日期当场改成 `Date` 对象，原对象被改了。所以插件加载配置后，**只用校验返回值，别再信你传进去的原始对象**。
4. **`ctx.timeout(毫秒)` 返回的 Promise，办公室关门时会 reject（报错）**：如果你 `await ctx.timeout(1000)`，插件被卸载时这个 await 会抛异常，要 try/catch 接住。
5. **timer 的 `interval` 循环要"一次 await 完再取下一次"**：它的 `next()` 是单槽的，抢着取会"丢 tick"。
6. **YAML 里 `parseTime("90")` 没写单位会静默变成 0**：写超时时间一定要带单位，如 `"90s"`。
7. **vendor 代码别改**：按项目规范，这是"搬来的源码"，要改得去上游 deepseek-harness 改，否则以后同步会冲突。

## 八、一页纸速记（给评审/自己回看）

- **cordis** = 插件发动机：开办公室(Context) → 入驻(plugin/Fiber) → 提供设施(Service/provide) → 借还东西(effect，逆序归还) → 发通知(event)。
- **cosmokit / schemastery / timer** = 工具：瑞士军刀 / 配置填表规则 / 自动关灯的定时器。
- **loader / include / group / hmr** = 装配运维：按 YAML 菜单上菜、叠加层覆盖、分组、热更新不丢状态。
- **logger-console** = 日志打印。
- **flowforge 用它做什么**：用 cordis 当插件内核，用 loader 的 YAML 分层装配替代"扫描目录+审批"的旧方式，把 chat/agent/limb/forgekin 等全做成插件。
