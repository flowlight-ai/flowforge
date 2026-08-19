# FlowForge 0.2.0 — 技术栈决策（ADR-R01 ~ R22）

> 依据：`00-overview.md` §3；对齐基线：DeepSeek Harness（dsh，`ex/deepseek-harness`）与
> Clowder AI（cat-cafe，`ex/clowder-ai`）。
> 更新：2026-08-16 追加 R13 插件化规范 / R14 融合分层 / R15 Python 日落 /
> R16 vendor 维护 / R17 配置格式（全面对齐调查）/ R18 双栈隔离 / R19 技术栈对齐 /
> R20 开发规范对齐 / R21 测试规范对齐；
> 2026-08-18 追加 R22 zod 版本统一。
> 本次对齐调查基线（2026-08-16 实测）：dsh `cordis.patch.yml` 分层 patch + `agent-presets`
> YAML + settings 包；clowder `cat-template.json`(JSON) + `.cat-cafe/*.json` + frontmatter YAML
> + `env-registry.ts`(CAT_CAFE_*) + connector.yaml；详见 R17。

## R01 语言与严格度

- 结论：TypeScript（严格模式，`strict: true`），代码风格按 dsh `tsconfig.base.json`。
- 理由：两个参考项目均为 TS；TS 6 已装于 dsh 环境，类型安全支撑插件契约。
- 备选否决：JS+JSDoc（损失类型契约）、Python 保留（不符合对齐目标）。

## R02 包管理与构建

- 结论：pnpm workspace monorepo（`packageManager: pnpm@11`，本机 pnpm 10.30.3 兼容运行）；
  构建用 `tsc -b` + `tsdown`（对齐 dsh）。
- 布局：`vendor/*`、`packages/*/*`（域/包二级）、`apps/*`（对齐 dsh workspaces）。

## R03 运行时与引擎

- 结论：Node >= 22.19（dsh engines）；本机 v24.13.0 同时满足 clowder 的 >=24 要求。
- engines 声明 `^22.19.0 || >=24.0.0`。

## R04 框架内核（一切皆插件）

- 结论：cordis 4（vendor 自 dsh `vendor/cordis`），配套 vendor：
  cosmokit（工具库）、schemastery（配置 schema）、loader（插件加载）、
  logger-console（日志）、hmr（热更新）、timer（定时）、group、include。
- 契约：`Context` 上挂服务（`ctx.foo`），插件通过 `ctx.plugin()` 注册，
  事件经 `ctx.on/emit`，作用域通过 `scope` 原语管理（对齐 dsh `packages/core/scope`）。

## R05 API 服务与实时通道

- 结论：Fastify 4 + socket.io（对齐 clowder-ai `packages/api`：fastify + @fastify/websocket +
  socket.io）；OpenAPI 由 fastify 插件生成；OTEL 观测（clowder 已用）。
- 否决：dsh 内置 web server（不满足群聊实时需求）、Express（与 clowder 不一致）。

## R06 存储

- 结论：better-sqlite3 为主存储（clowder 主库），Redis 可选（消息/队列加速，`--memory` 模式可跳过）；
  抽象层采用 clowder `stores/ports/*` 接口 + dsh `storage` 包接口双适配。
- 否决：纯 Redis（单机部署负担）、Postgres（两参考项目均未采用）。

## R07 前端

- 结论：Next.js 14 + React 18 + Tailwind + Zustand + socket.io-client + xterm +
  CodeMirror（两项目前端同栈，直接融合）。
- 品牌：保留 Forgekin/灵智 UI 词汇，交互对齐 clowder（@mention 菜单、线程分支、终端面板）。

## R08 LLM 接入

- 结论：`packages/llm` 抽象（对齐 dsh `packages/llm`：provider 接口 + mock server 测试）；
  供应商适配：anthropic / openai / gemini / openroute（保留 flowforge `openroute_adapter` 能力）/
  通用 OpenAI 兼容。
- 客户端库：`@anthropic-ai/sdk`、`openai`、`@google/genai`（按 dsh/clowder 实际引用）。
- **Mock 基线已确认**：dsh 提供 `packages/test-support/llm-mock-server`
  （`startMockLlmServer` / `MockLlmBehavior`），阶段 1 vendor 之作为 agent-loop 测试基线
  （见 `02-source-crosswalk.md` §1）。

## R09 外部 Agent CLI 控制

- 结论：Limb 域（对齐 clowder）：LimbRegistry/LeaseManager/PairingStore/RemoteLimbNode/
  PluginLimbAdapter + terminal 域（tmux 网关 + node-pty 的 Windows 回退）。
- 支持清单：Claude Code（stream-json）、Codex（json）、Gemini CLI（stream-json/ACP）、
  Antigravity agy（plain text）、opencode（ndjson）。

## R10 测试与质量

- 结论：vitest 4（dsh 基线）+ node:test 兼容（clowder 部分测试保留）；oxlint（dsh）+ biome 检查
  （clowder 风格，仅根级）；覆盖率 v8。
- 测试策略：core/plugins 域用 vitest 单测；chat/cats/limb 域用 mock provider 集成；
  web 用 Playwright 冒烟（沿用现有 `_browsertest` 思路）。

## R11 命名与目录（P1 契约）

- **全量移植原则（2026-08-16 修订）**：dsh 与 clowder 的全部能力代码**整体复制**进本仓库
  （`packages/` 域/包布局对齐 dsh），**不留 `@deepseek-ai/*` / `@clowder-ai/*` 包依赖**；
  依赖闭包（cordis 生态 vendor 包、dsh 支撑包）一并复制并**统一改名 `@flowforge/*`**。
- 包命名：`@flowforge/*`；改名映射规则（机械替换，无特例）：
  `@deepseek-ai/cordis*` → `@flowforge/cordis*`、`@deepseek-ai/cosmokit` → `@flowforge/cosmokit`、
  `@deepseek-ai/schemastery` → `@flowforge/schemastery`、`@deepseek-ai/dsh-*` → `@flowforge/*`
  （去掉 `dsh-` 前缀，如 `@flowforge/scope`/`@flowforge/llm`），源码内 import 同步替换；
  `THIRD_PARTY_NOTICES.md` 保留原始包名与 LICENSE 声明。
- 代码标识：`Forgekin`/`SoulImprint`/`EchoStore`/`MindCodex`/`SpiritForge`/`MindCouncil`；
  禁止 P2 别名进入代码标识（`docs/design/naming-contract.md`）。

## R12 兼容与回退

- Python 旧版：原位保留（`flowforge/` 包 + `web/`），pyproject 不受 TS 目录影响；
  阶段 10 提供 `python/sdk` 桥（可选）；日落流程见 R15 / `31-stage11-sunset.md`。
- vendor 版本锁定：以 `ex/` 当前快照为准，不追踪上游（dsh 为 rc 版，迭代快）。

## R13 一切皆插件：插件开发契约（最高架构原则）

- 结论：**插件化前置**。阶段 0 即落地插件基座（宿主装配器 + 生命周期冒烟），
  阶段 1-8 所有产出均以 cordis 插件包形态接入，禁止游离于 `ctx` 之外的模块。
- 每个功能包必须满足六条契约：
  1. `package.json`：`name: @flowforge/<域>-<名>`，`peerDependencies: { "@flowforge/cordis": ... }`；
  2. 导出插件：`apply(ctx)` 函数或插件类（cordis 约定）；
  3. 依赖声明：`inject` 列出所需 `ctx.*` 服务（如 `['sessions', 'tools']`）；
  4. 配置 schema：可选 `schema`（schemastery），由 boot 合并进配置；
  5. 生命周期：created → ready → dispose 全部由 Context/scope 管理，卸载后 `ctx.*` 服务不可用；
  6. 测试：独立 vitest，验证可加载/可卸载/依赖注入正确。
- 宿主：`apps/cli` 是唯一装配器，通过 loader 读取插件清单（manifest，含 include/group 组合）
  按依赖顺序加载启动（对齐 dsh `packages/extensions` 的 cordis-host-runner 思路）。
- **应用层插件契约**：clowder 的 `@clowder-ai/plugin-contract`（0.1.0-beta.7）是应用域
  插件接口（cats/limb 等业务域插件），阶段 2 映射为 `@flowforge/plugin-contract`（基于
  cordis 插件扩展出应用级生命周期/权限钩子），与内核插件契约同源同构。
- **插件发现/装配模型（统一 dsh 模型，否决 clowder 文件系统扫描）**：
  - 装配入口 = cordis-loader 的 EntryTree：`loader.create/update/remove`，按模块名 import +
    配置驱动（vendor `loader` 包已复制）；文件树由 `cordis-plugin-include` 提供；
  - 装配清单以 **YAML 声明**（对齐 dsh `cordis.patch.yml` 与 koishi/cordis 生态），
    插件列表/启停/分组显式声明，不做隐式目录扫描；
  - clowder 的"插件目录自动发现"仅作为可选便利层（阶段 5+ 评估），不作为主模型。

## R14 三项目融合分层

- 结论：分层融合、单向依赖（内核 ← 框架 ← 应用 ← 品牌 ← 装配）：
  - 内核层 = dsh vendor cordis；框架层 = dsh core/plugins/llm（vendor 深度定制）；
  - 应用层 = clowder cats/chat/limb/terminal（vendor 深度定制）；
  - 品牌层 = flowforge forgekin（原创移植）；装配层 = apps/cli + apps/web。
- Python 旧版降级为**行为基线**（golden reference）：用例转写为 TS golden tests，
  `pytest` 在阶段 1-9 全程回归。
- 冲突消解（F1-F15）与概念映射表见 `03-fusion-strategy.md` §3-§4。

## R15 Python 日落与删除

- 结论：功能齐平（阶段 9）+ 入口切换（阶段 10）+ 稳定运行后，按 `31-stage11-sunset.md`
  执行 冻结（S11.1）→ 归档（S11.2）→ 删除（S11.3）三阶段；git 历史永久保留，
  数据迁移优先、只读兜底；`python/sdk` 桥接保留（可选）。

## R16 vendor 维护策略（cordis 及全部 vendor 包）

- 结论：**源码 vendor + 快照锁定 + 显式 re-sync**，不采用 npm 发布包依赖：
  - dsh 为 rc 版快速迭代且部分包不发布，clowder 含私有包，均无法稳定 npm 解析；
  - 锁定当前 `ex/` 快照（2026-08-16），vendor 目录即 fork，不自动追踪上游；
  - re-sync 流程（显式执行）：从 `ex/` 重新复制 → `git diff` 审查差异 → 更新
    `THIRD_PARTY_NOTICES.md` 快照日期 → 提交（`chore(vendor): re-sync dsh <pkg> 至 <snapshot>`）；
  - 禁止手改 vendor 源码；确需定制的包，先复制到 `packages/` 再改（保持 vendor 纯净可 diff）。
  - 含 dsh `packages/settings/settings` + `settings-file`（设置抽象：invariant/redact/types）
    与 `packages/test-support/llm-mock-server`（阶段 1 测试基线）。

## R17 配置体系统一（全面对齐 dsh + clowder，2026-08-16 实测）

- 结论：**运行时配置统一 YAML + schemastery schema 校验 + cordis-loader 装配**，
  并吸收 dsh patch 分层模型与 clowder 环境变量/运行态文件约定：
  - flowforge 现为 YAML（`config/*.yaml`），dsh 同为 YAML（`cordis.patch.yml`）、
    clowder 业务配置同为 YAML（connector.yaml、hook.yaml、frontmatter），格式天然一致，
    **无需改格式、需重构加载链路**（本项即对齐点）；
  - **装配分层（对齐 dsh）**：`bundle base → mode bundle → 用户 profile
    （`$FF_HOME/cordis.patch.yml`）→ `--patch` overlays → 环境变量开关`，patch 语法
    为 YAML 数组行 id 寻址（`- id:` / `insert:` / `disabled:` / `config:` 整体替换，
    `!!js` 表达式可引 `process.env.*` 与 `ctx.*`）；flowforge 的 `config/` 静态 YAML
    按域拆分为各插件的 schema 默认值 + 装配 patch 两层；
  - **配置 schema**：每个插件以 schemastery `schema` 声明自己的配置段（dsh 约定），
    boot 合并 + 校验，替代 Python 版无校验 `yaml.safe_load`；Python `config_version.py`
    的版本迁移逻辑移植为 schema 迁移函数（阶段 10 数据处置配合）；
  - **环境变量注册表（对齐 clowder `env-registry.ts`）**：集中登记 `FF_*` 变量
    （名称/默认值/分类/敏感标记，dsh 用 `DSH_*`、clowder 用 `CAT_CAFE_*`），
    禁止散落 `os.getenv`；敏感项走凭据插件（R09 credentials）；
  - **运行态文件（对齐 clowder `.cat-cafe/`）**：凭据/账户/偏好等运行态 JSON
    （`accounts.json`、`user-preferences.json`、`cat-catalog.json` 为 JSON，clowder 实测），
    flowforge 落 `data/` 或用户目录 `~/.flowforge/`，与静态 YAML 配置分离；
  - **档案/技能 frontmatter 保持 YAML**（clowder profile 与 dsh skill 均为 YAML
    frontmatter）；Forgekin 档案（P: `config/forgekins/*.yaml`）保持 YAML，
    结构对齐 clowder `cat-template.json` 的 breeds/variants 模型（概念映射见 F6）；
  - **LLM 路由/工作流/审批等业务配置**：迁移为对应插件的 schema 段（`models.yaml`→
    `llm` 插件 schema、`workflows/*.yaml`→`workflow` 插件 schema 等），目录形态保留。

### R17 §4 配置格式全景（dsh / clowder / flowforge 三方实测，2026-08-16）

结论先行：**三方的业务/装配/档案/技能/钩子配置全部是 YAML**，格式天然一致，flowforge 无需改写格式，
只需重构加载链路（schemastery schema + cordis-loader + patch 分层 + env-registry）。
JSON 仅用于运行态数据与工程链；环境变量统一走注册表。

**A. dsh 配置文件格式清单（`ex/deepseek-harness` 实测）**

| 文件/目录 | 格式 | 用途 | 对齐动作 |
|---|---|---|---|
| `cordis.yml` / `*.cordis.yml` / `cordis.patch.yml` | **YAML** | 插件装配：顶层列表 `- id:` / `name:` / `config:` / `disabled:` / `group:` / `isolate:`，支持 `!!js` 表达式（`process.env.*`/`ctx.*`） | 阶段 0 装配基座直接采用 |
| `apps/cli/config/agent-presets/<名>/preset.yml` | **YAML** | agent 预设元数据：`name`/`description`/`order` | 移植为 flowforge preset（对应 forgekins 档案入口） |
| `apps/cli/config/agent-presets/<名>/agent.cordis.yml` | **YAML** | agent 预设插件装配（realm 隔离、host/agent 分层） | 移植（阶段 2 preset 包） |
| `packages/bundle/*/cordis.patch.yml` | **YAML** | bundle→mode→profile→overlay 分层 patch 装配 | 阶段 0/3 移植 |
| `skills/*/SKILL.md` | **Markdown + YAML frontmatter** | 技能定义 | 阶段 2 skill 插件 |
| `hooks.json` / `codex-hooks.json` | **JSON** | Claude Code/Codex 事件钩子 | 阶段 2 hooks 插件 |
| `*.i18n.yaml` | **YAML** | 文档双语配对（en/zh 同构记录） | 仅 dsh 文档体系，项目文档可选用 |
| `settings` 包（invariant/redact/types） | TS + JSON | 设置抽象 | 阶段 2/3 移植 |
| session 持久化 | **JSONL / SQLite** | 会话事件日志 | 阶段 1 session 包 |
| `DSH_*` 环境变量 | env | 运行时覆盖（`DSH_HOME`/`DSH_PERMISSION_MODE`/`DSH_SNAPSHOT` 等） | 映射为 `FF_*` 注册表 |
| 工程链（package.json/tsconfig/knip/.oxlintrc） | **JSON** | 工具链 | 直接对齐 |
| `lefthook.yml` | YAML | git hooks | 可选（我方 mgr 流程优先） |

**B. clowder-ai 配置文件格式清单（`ex/clowder-ai` 实测）**

| 文件/目录 | 格式 | 用途 | 对齐动作 |
|---|---|---|---|
| `cat-template.json` | **JSON** | 灵智体档案模板：`roleTemplates`/`clientDefaults`/`coCreator`/`roster`/`reviewPolicy`/`breeds`/`variants`（含 CLI 适配器 `cli.command/outputFormat/defaultArgs/effort`、`contextBudget`、`voiceConfig`） | 阶段 4 映射为 Forgekin 档案结构（文件保持 YAML，见下） |
| `.cat-cafe/*.json`（accounts/user-preferences/proxy-upstreams/cat-catalog） | **JSON** | 运行态数据 | 落 `data/` + `~/.flowforge/`（R17 主文） |
| `connector.yaml`（IM 连接器 manifest） | **YAML** | `id/name/config[envName,type,label,sensitive,required,options]/steps` | 阶段 5 stretch S1 启用时移植 |
| `plugin.yaml`（插件 manifest） | **YAML** | `id/name/version/config[env 字段声明]/resources[mcp]` | 阶段 4-6 移植为插件装配声明 |
| `hook.yaml`（prompt 钩子，50+ 个） | **YAML** | `id/name/stage/order/version/enabled/template/resolver/inputs/tiers(safety/transparency/governance)` | 阶段 5 prompt-hooks 域 |
| cat profile frontmatter（`.md` 头） | **YAML frontmatter** | 档案正文 | 阶段 4 profile 包 |
| `cat-cafe-skills/manifest.yaml` + `agents/openai.yaml` | **YAML** | 技能包清单/agent 适配 | 阶段 4/5 |
| `assets/brand-dictionary.yaml` / `guides/registry.yaml` / `prompt-templates/workflow-triggers.yaml` | **YAML** | 品牌词/指南注册/工作流触发 | 阶段 4/7 |
| `src/config/env-registry.ts` | TS | `CAT_CAFE_*` 环境变量集中登记（名称/默认值/分类/敏感标记） | 移植为 `FF_*` 注册表（阶段 0 T0.19） |
| 数据文件 | SQLite + Redis | world/event-memory/evidence 等 | 双栈隔离（R18） |

**C. flowforge 现有 YAML 配置全量清单（`flowlight/flowforge` 实测）与对齐映射**

| 现有文件 | 格式 | 落点（TS） | 处理 |
|---|---|---|---|
| `config/default.yaml`（system/features/…） | YAML snake_case 无 schema | `packages/harness/config` | schema 化：feature 开关→`features` 插件 schema；system→boot 配置 |
| `config/{models,llm_route,provider_quota}.yaml` | YAML | `packages/llm/*` 插件 schema | 迁移为 llm 路由/配额 schema 段 |
| `config/{prompts,review_prompts,web_chat_prompts}.yaml` | YAML | `packages/core/system-prompt` + forgekin | 迁移 prompt 模板 schema |
| `config/{forgemind,evolution}.yaml` | YAML | `packages/forgekin/*` 插件 schema | 迁移 |
| `config/{im_council,im_channels,a2a_channels,agent_swarm,teamact_steer}.yaml` | YAML | `packages/forgekin/{council,swarm,im-council}` + `packages/chat` | 迁移（F17/F16/F18） |
| `config/{logging,trae_bridge,plugins,moderation,resilience,recovery_tiers,canary,scheduler,skill_library}.yaml*` | YAML | 对应插件 schema（observability/guard/schedule/skill/canary） | 迁移 |
| `config/{layer_mapping,execution_policy,checkpoint_config}.yaml*` | YAML | `packages/forgekin/compiler` + `packages/core/session` | 迁移 |
| `config/forgekins/*.yaml` + `forgemind/forgekins/*.yaml`（13 个档案） | **YAML** | `packages/cats/profile` + `packages/forgekin/imprint` | **保持 YAML**；结构吸收 clowder breeds/variants 字段（F6）；补 species/awakening/llm 段 |
| `config/workflows/*.yaml`（7 个）+ `workflows/*.yaml`（7 个） | **YAML** | `packages/forgekin/compiler` + `packages/plugins/workflow` | 迁移为工作流定义（schema 校验 + 执行图） |
| `config/sops/*.yaml` | YAML | `packages/forgekin/sop` | 迁移（SOP 系统，F29） |
| `config/marketplace/registry.yaml` | YAML | `packages/marketplace` | 迁移（F11） |
| `config/canary/default.yaml` | YAML | `packages/plugins/canary` | 迁移（F24） |
| `core/capability/config/{profiles,prompts}.yaml` | YAML | `packages/forgekin/capability` | 迁移 |
| `core/external_agent/config/{manifests/*,adapters,fallback,tool_allowlist,prompts}.yaml` | **YAML** | `packages/limb/adapters` + `packages/forgekin/external-agents` | 迁移为适配器 manifest（F9） |
| `core/memory_federation/config/*.yaml`、`core/world_engine/config/*.yaml` | YAML | `packages/forgekin/stores` + stretch S3 | 迁移 |
| `forgemind/config/{forging,prompts}.yaml` | YAML | `packages/forgekin/forging` | 迁移（F31） |
| `harness/config/{harness,prompts}.yaml` | YAML | `packages/harness/*` | 迁移（F10/F36） |
| `data/*.db`（flowforge/checkpoints/event_stream/states/tasks） | SQLite | `data/flowforge-v0.2.db` 分域 | 物理隔离只读迁移（R18） |

**D. 格式边界裁决（写入编码规范）**

1. **YAML 管声明**：插件装配（cordis.yml）、业务配置、档案/技能/钩子 frontmatter、工作流/SOP 定义一律 YAML（缩进 2 空格，我方 `04-code-style.md` §4.3）。
2. **JSON 管运行态**：账户/凭据/偏好/目录等运行态数据一律 JSON（clowder `.cat-cafe/` 约定），落 `data/` 或 `~/.flowforge/`，绝不混入静态配置。
3. **环境变量管覆盖**：`FF_*` 集中登记（env-registry），禁止散落 `os.getenv`/`process.env` 直接读取（对齐 dsh `DSH_*`/clowder `CAT_CAFE_*`）。
4. **schema 管校验**：每个插件的 YAML 配置段必须配 schemastery schema（对齐 dsh config-catalog 生成机制），Python `yaml.safe_load` 无校验链路全部废弃。
5. **.env 管密钥**：密钥仅经 .env（gitignored）+ 凭据插件，绝不入库（我方红线 11）。

## R18 双栈共存：路由分流与存储物理隔离

- 结论（满足"重构期间不影响现有功能"）：
  - **HTTP 路由分流**：Python 旧版保持 `/api/v1/*`（现网路径不变）；TS 版全部新路由
    挂 `/api/v2/*`（含 socket.io 命名空间 `/v2`），双栈可在同一进程端口或独立端口共存，
    前端按部署版本来选择前缀；阶段 10 切入口后 v1 进入日落（`31-stage11-sunset.md`）；
  - **存储物理隔离**：TS 版 better-sqlite3 数据库文件独立命名（`data/flowforge-v0.2.db`，
    分域表前缀），与 Python `data/` 现有库（不同文件名/目录）**绝不共享写**；
    Redis 客户端 = ioredis（clowder 同款，`keyPrefix: 'ff2:'` 约定）；迁移与只读挂载见
    `31-stage11-sunset.md` §4；
  - 双栈共享进程内端口时，由 `packages/api` 装配插件做 v1 反代（可选，默认独立端口）。

## R19 技术栈全景对齐（2026-08-16 实测两项目依赖清单）

- 结论：以下依赖为 TS 版必须对齐项，随对应阶段 vendor/安装（版本以 dsh/clowder 实测为准）：
  - **存储**：better-sqlite3 ^12（clowder 主库）+ ioredis（clowder 主力，keyPrefix 约定）+
    sqlite-vec（clowder 向量检索，可选）；dsh 侧 node:sqlite（session-query）作内嵌备选；
  - **Web**：fastify ^4 + @fastify/cookie|cors|multipart|static|websocket（clowder api 全套）+
    socket.io ^4 + ws + http-proxy（v1 反代）；
  - **schema**：双轨——运行时数据 zod ^4.4.3（统一决策见 R22）、配置 schema schemastery（dsh）；
  - **LLM/MCP**：@anthropic-ai/sdk、openai、@google/genai（dsh/clowder 实际引用）、
    @modelcontextprotocol/sdk ^1（clowder）；
  - **观测**：@opentelemetry 全套（api/core/sdk-node/trace/logs/metrics/exporter-otlp-http/
    exporter-prometheus/semantic-conventions，clowder api 实测清单），对齐 P: `core/observability.py`；
  - **终端/沙箱**：node-pty（clowder terminal Windows 回退）、@vscode/ripgrep（clowder）；
  - **解析/工具**：js-yaml（dsh）+ yaml 2 兼容（clowder frontmatter，统一解析器封装）、
    smol-toml（dsh）、js-tiktoken（clowder 计费）、nanoid、cron-parser、pino-roll；
  - **IM 通道 SDK**（阶段 5 stretch S1 启用时）：grammy/dingtalk-stream/@wecom/aibot-node-sdk/
    @larksuiteoapi/node-sdk/nodemailer/web-push/rss-parser（clowder api 实测）；
  - **工程链**：TS 6 + vitest 4 + oxlint + tsdown + tsx（已对齐 dsh）+ fast-check（dsh 属性测试）+
    knip + jscpd（dsh 质量门禁，可选）；clowder 的 biome 仅根级风格检查（R10）。
- 否决：clowder 的 TS 5.3 + biome 主链（与 dsh 不一致，统一 dsh 工具链）。

## R20 开发规范对齐（我方规范第一优先，未覆盖处按 dsh/clowder）

> ⚠ 重构期间规范执行以合并版 `04-code-standards.md` 为准（优先级 P0 我方 → P1 dsh → P2 clowder）；本 R20/R21 仅保留决策溯源，不再逐文件引用。

- 结论：**规范优先级 = flowforge 自有规范 > dsh 规范 > clowder 规范**；冲突时以我方规范为准，
  并以 R 系列决策落地（如 T1 与 dsh mock 的裁决见 R21）。
- **我方规范（第一优先，全部沿用）**：
  - `docs/rules/04-code-style.md`：YAML 缩进 2 空格；JSON 合法；.env 不提交密钥；前端 i18n react-i18next（zh/en 双语言同步更新）；
  - `docs/rules/05-dev-spec.md`：禁止盲目覆盖/禁止造假（写死分数/结果/状态/硬编码 `{status:ok}` 均违规）；运行时数据落 `data/`；
  - `docs/rules/07-coding-redlines.md` 15 条红线（禁止 Mock LLM 于 E2E、禁止假数据、禁止跳过验证、禁止改不相关代码、
    禁止删已有测试、禁止继承替代组合/插件、禁止业务逻辑写死平台代码、禁止硬编码提示词/路径/密钥/端口、
    禁止绕过 DI 直接实例化、禁止直接操作 DB、禁止偷工减料）；
  - `docs/rules/08-flowforge-boundary.md`、`11-doc-layering.md`、`12-doc-refactor-methodology.md`（文档分层与重构方法论）；
  - `docs/git-workflow.md` + `./mgr` 提交（每阶段提交 Gitee，禁止破坏性 git 操作）。
- **dsh 规范（我方未覆盖处按此，`ex/deepseek-harness/docs/development.md` 实测）**：
  - TS 严格模式：`tsconfig.base.json` 统一（strict），Host/Client 两聚合隔离（`tsconfig.host.json`/`tsconfig.client.json`，
    新包必须注册进恰好一个聚合）；
  - 构建顺序：`tsc -b host` → `tsdown host` → `tsc -b client` → `tsdown client` → web build；
  - 包规范：一个包 = 一个域（`packages/<域>/<名>`），导出插件 `apply(ctx)`，`peerDependencies` 声明 cordis；
  - 环境变量：gitignored `.env` + 集中注册表，绝不提交真实凭据；
  - TODO 标记三级：`FIXME`（阻塞发布）/ `TODO`（应尽快修）/ `XXX`（可择期），按紧急度选择；
  - 文档契约：公共 API 变更同步更新 README/JSDoc；`docs/` 中文档与源码逐字对齐用 `ts type-equiv` 机制（可选采用）；
  - vendor 编辑禁令：`vendor/*` 源码禁止手改，确需定制先复制到 `packages/`（R16）。
- **clowder 规范（Iron Laws，`ex/clowder-ai/AGENTS.md` 实测）**：
  - 数据安全：绝不删除/清空 Redis/SQLite 等持久存储；
  - 进程自保：不杀父进程、不改启动配置；
  - 配置不可变：运行态配置修改需人工介入；
  - 网络边界：不访问不属于本服务的 localhost 端口；
  - 交叉 review：同一人不审查自己代码，跨族 review 优先，finding 标注 P1（阻断）/P2（应修）/P3（可选）。
- **冲突裁决**：我方红线 9（禁止继承替代组合/插件）与 cordis 一切皆插件一致（R13）；
  红线 12（禁止绕过 DI）与 cordis ctx 服务解析一致；红线 13（禁止直接操作 DB）与 clowder stores/ports 一致（F4）；
  clowder "配置不可变"仅约束运行态文件，静态 YAML 装配以 patch 分层管理（R17），两者不冲突。

## R21 测试规范对齐（我方测试铁律第一优先，dsh 测试分层为基座）

> ⚠ 测试规范执行以合并版 `04-code-standards.md` §2.2/§3.2 为准；本 R21 仅保留决策溯源与裁决案例（T1 > dsh llm-mock-server）。

- 结论：**测试分层 = unit → coverage 门 → real-API e2e → snapshot → web browser**（对齐 dsh `docs/testing.md`），
  层内铁律以我方 T1-T9 为准（`docs/rules/test-iron-rules.md` + `docs/test/T001-T019`）。
- **分层定义（dsh 实测）**：
  - Unit（`pnpm test`）：vitest 于 `tests/**`，测试与代码同域；每个 registry 必须 HMR 安全测试（卸载 fiber 后断言清理）；
  - Coverage 门（`pnpm test:coverage`）：`packages/*/*/src` 每文件 100% 行覆盖（dsh 门禁；我方未涉及 → 按 dsh）；
  - Real-API e2e（`pnpm test:e2e`）：真实 provider API（我方 T1 强制真实 LLM），无 key 时套件自跳过（dsh 自跳过约定）；
  - Snapshot（`pnpm test:snapshot`）：keyless 录制回放（契约/传输层），回放输入非"假数据"（T2 适用 E2E 输入，不适用于回放夹具）；
  - Web browser（`pnpm test:web`）：Chromium + 快照对比，配合我方 T8（浏览器 DOM 验证 + LLM 审核）。
- **我方铁律的层内落实**：
  - T1（禁止 Mock LLM）覆盖 e2e/集成层：**dsh `llm-mock-server` 仅允许在 unit/契约层使用**（阶段 1 agent-loop 单测基线），
    任何 e2e/集成测试必须真实 LLM 或真实 CLI 适配器；
  - T2（禁止假数据）：测试输入必须真实场景数据；snapshot 回放夹具除外（其性质为契约基准）；
  - T3（禁止跳过验证）：断言必须具体（质量分/内容/状态机），禁止 `status in (…)` 泛断言；
  - T4（禁止 Mock 工具）：web_search/publish/fact_check 等真实调用；
  - T5（未实现即 Bug）：禁止 TODO 跳过未实现功能；
  - T6（必须采集指标）：E2E 必须 MetricsCollector 全量指标；
  - T7（LLM 内容必须 LLM 审核）：生成与审核不同模型；
  - T8（Web 必须浏览器验证 DOM）：Playwright 真实浏览器 + `domcontentloaded` + DOM 文本断言 + LLM 审核；
  - T9（运行时数据必须 data 目录）：测试产物同样遵守。
- **dsh 补充纪律（我方未涉及处）**：
  - Prefer the real implementation over a mock：仅 mock 昂贵/非确定性边界（LLM 适配器、网络、时钟），下游全部真实；
  - Verify the world, not the self-report：e2e 断言外部复验（重跑命令/重读文件），不得只探测 agent 自述；
  - Test the real entry path：产品级插件必须 REAL-composition 测试（boot 测试 cordis.yml 经 Loader/进程），
    package bin 跑 built `lib/bin.js`（plain node），断言缺失配置时退出码非零；
  - Source plane only：vitest 一律解析 `src`（vite-tsconfig-paths 指 `tsconfig.base.json`），不消费 built 产物；
  - 子进程启动模式：cordis 配置子进程从 built `lib/` 经双模启动器拉起，禁止手写 `--import tsx`；
  - Snapshot 时机：任何非平凡模型/协议/人可见变更，同 PR 内补/更 keyless 场景。
- **clowder 补充**：交叉 review 协议（P1/P2/P3）+ 测试覆盖验证纳入 review checklist。
- **冲突裁决**：dsh "coverage 100%/file" 与 clowder 覆盖率验证一致；dsh mock 边界与 T1 冲突时以 T1 为准（见上）。
- **每阶段 DoD 门**（`10-stage-map.md` §4）：`pnpm typecheck` + `pnpm lint` + 域 vitest 全绿 + 相关 snapshot 更新 + Python pytest 回归全绿 + `./mgr` 提交。

## R22 zod 版本统一（2026-08-18，全仓 `^4.4.3` 对齐 dsh）

- 结论：**全仓 zod 统一 `^4.4.3`（dsh 基线），废弃 v3.25.0 路线**；根 package.json 与
  全部依赖包（dsh 移植 22 包 + cats-shared peer/devDep）同版本。
- 背景：阶段 3/4 移植期根 package.json 临时钉 `zod ^3.25.0`（commit 785d61a 脚手架时期），
  依赖闭包同时存在 4.4.3（dsh 移植包）与 3.25.0（cats/根），双版本并存。本环境 registry 的
  `zod@3.25.0` tarball 为 **src-only 异常版**（无 dist/index.d.cts），迫使 `tsconfig` 启用
  `customConditions: ["@zod/source"]` 解析到源码，配合 `noUncheckedIndexedAccess` 产生海量
  zod 内部类型错误；且 src 解析使 `skipLibCheck` 失效，branded 类型（`@flowforge/brand` 的
  模块局部 `BRAND` unique symbol）经 zod v3 `ZodObject` 五参泛型的 `objectOutputType`
  条件类型展开后无法在下游声明发射中命名 → 35×TS4023 阻断。
- 决策依据（实测）：
  - dsh 全部 22 个 schema 包依赖 `zod ^4.4.3`，其 zod@4.4.3 tarball 自带构建产物
    （根级 `index.d.cts`/`index.js`），`skipLibCheck` 直接生效，零 hack；
  - dsh 同款 brand 模式（BRAND 不导出）+ v4 声明下声明发射全绿（`ZodObject<Shape, Config>`
    两参形态不展开 Output/Input 条件类型），证明 v4 消除 TS4023；
  - clowder 用 zod 3.25.76（带构建产物），但 clowder 侧代码经批次移植已按 v4 习惯改写，
    回归 v3 无收益；
  - 曾尝试的 v3 路线（`tsconfig.zodgenv3.json` 生成 v3 声明 + `scripts/patch-zod-types.ts`
    补丁折叠工厂签名）仍剩 35×TS4023 无法清零，维护成本高，已整体删除。
- 落地变更：
  - 根/cats-shared/22 个 dsh 移植包：`zod: ^4.4.3`（pnpm-lock 已清除 3.25.0）；
  - 删除 `tsconfig.base.json` 的 `customConditions: ["@zod/source"]`（v4 有 dist 无需源码解析）；
  - 删除 `tsconfig.zodgenv3.json` / `scripts/patch-zod-types.ts` / `gen:zod-types` 脚本钩子；
  - cats-shared v3 习惯改造为 v4：`z.record` 单参 → 双参（6 处）、`refine` 回调第二参 →
    `{ error: issue => … }` params 形式（cat-id-schema）；
  - `@flowforge/brand` 保持 dsh 原样（BRAND 模块局部，不导出）。
- 后续约束：新增包 schema 一律 `zod ^4.4.3`；禁止 `@zod/source` 条件与 zod 子路径
  （`zod/v3`、`zod/v4`）导入；v4 API 注意点——`z.record` 必须双参、`.passthrough()` 用
  `z.looseObject`、JSON 校验用 `z.json()`、JSON Schema 用 `z.toJSONSchema()`。
