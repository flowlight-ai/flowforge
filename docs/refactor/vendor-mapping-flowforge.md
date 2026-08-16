# cordis 概念 → FlowForge 真实插件 映射表

> 配套：专家版 `vendor-walkthrough.md`、小白版 `vendor-walkthrough-beginner.md`、可运行 demo `vendor-demo.ts`。
> 参考：`docs/refactor/03-fusion-strategy.md`（概念映射表 F1–F12）、`22-stage2-plugins.md`、`32-other-forge-migration.md` 以及 deepseek-harness / clowder 包结构。

## A-1 · 核心机制映射（抽象概念 → flowforge 用法）

| cordis 概念 | FlowForge 里对应什么 | 说明 / 位置 |
|---|---|---|
| **Context（上下文）** | 每个插件入驻时的"作用域"；flowforge 用 `ctx.extend`/`ctx.isolate` 给**每个会话 / 租户 / agent** 派生子作用域 | 启动入口在 `apps/cli`、各插件内部 |
| **Service（服务）** | 内核能力一律写成 `extends Service` 的子类，构造即注册成 `ctx.xxx` | 见 A-2 |
| **plugin（插件）** | "一切皆插件"——每个能力都是一个 cordis 插件 | `packages/*` 下每个能力目录 |
| **effect（副作用）** | 所有"打开即需关闭"的资源：tmux 会话、数据库连接、长轮询、事件订阅、定时器 | `limb/terminal`、`db`、各监听器 |
| **event（事件）** | 内部解耦通信：消息到达、agent 状态变更、`internal/config` 配置热更新 | `events` 总线 |
| **provide（提供）** | 把能力注册成 `ctx.xxx`，插件卸载自动注销并通知依赖方 | `reflect.ts:277` |
| **inject（依赖声明）** | 插件声明"我需要 db / llm"，缺失即报错、就绪才激活 | `registry.ts:Inject` |
| **isolate（隔离）** | 多租户 / 多环境同跑互不污染（同名设施按 label 各用各的） | `loader/config/isolate.ts` |
| **Loader + YAML** | `cordis.yml` 把整个 flowforge 装配起来（替代旧"扫描目录+审批"） | `apps/cli` 启动、`loader` |
| **schemastery Config** | 每个插件声明自己的"配置填表规则"，加载前自动校验 | 各插件 `export const Config` |
| **HMR（热模块替换）** | 改插件/配置不重启程序，就地热更新且保留会话状态 | dev 模式、`hmr` |

## A-2 · Service / 插件 具体映射（flowforge 真实组件）

| cordis Service 名 | FlowForge 真实组件 | 来源 / 位置 |
|---|---|---|
| `ctx.llm` | **LLM provider carrier（大模型接入层）**：deepseek / pi-ai / claude / codex / gemini / agy / opencode | `packages/llm/*`（源自 deepseek-harness `llm/`） |
| `ctx.agents` / `ctx.cat` | **forgekin（可进化智能体）**——对应 clowder 的 cats | 阶段 7，`27-stage7-forgekin.md`；devforge 已定义 24 个 forgekin（coder/reviewer/test_generator/deployer/architect…） |
| `ctx.threads` / `ctx.chat` | **会话线程 / 消息**（群聊主体） | 源自 clowder `threads/messages` |
| `ctx.tools` | **工具注册表**（`tools/*` 事件扩展） | deepseek-harness `core/tools`（如 `core/tools/src/index.ts:222`） |
| `ctx.agentLoop` | **agent 执行循环**（一轮对话怎么跑工具/思考） | deepseek-harness `core/agent-loop`（`agent.ts:64/245`） |
| `ctx.limb` | **终端 / tmux 网关**（让 agent 操作 shell） | 源自 clowder `limb/terminal`（node-pty + tmux-gateway） |
| `ctx.council` | **议事频道（council channels）** | flowforge Plugin V3 的 `register_council_channels`（`32-other-forge-migration.md`） |
| `ctx.router` | **@mention 路由**（消息 @ 谁就派给哪个 agent） | 源自 clowder `AgentRouter.ts` |
| `ctx.db` | **数据存储**（物理隔离的 `flowforge-v2.db`） | 阶段 0 基础设施；R18 双栈隔离 |
| `ctx.timer` | **定时器**（随上下文自动停） | `vendor/timer` |
| `ctx.logger` | **日志**（内置 + `logger-console` 输出） | cordis 内置 + `vendor/logger-console` |

**插件(plugin)实例对照**：

| 插件 | 对应能力 | 来源 |
|---|---|---|
| `@flowforge/plugin-llm-deepseek` | deepseek 大模型接入 | dsh `llm-deepseek` |
| `@flowforge/plugin-acp-agent` | ACP 协议 agent | dsh `acp` |
| `@flowforge/plugin-tool-*` | 各类工具（搜索/执行/读文件…） | dsh `tools/*` + flowforge 自有 |
| forgekin 插件（coder/reviewer/…） | 可进化角色智能体 | devforge `config/agents/*.yaml` |
| `contentforge / mallforge / novelforge / stockforge` | 各业务垂直域（内容/电商/小说/股票） | 已是 Plugin V3 域插件 → 阶段 12 翻成 cordis bundle（`32`） |

> 一句话：**flowforge 的"内核能力"是 Service，"业务能力"是 plugin，两者都活在 cordis 的 Context 里，靠 effect 自动归还资源，靠 Loader 的 YAML 组装成最终产品。**
