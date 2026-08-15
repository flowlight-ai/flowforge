# FlowForge 0.2.0 重构方案 — 评审意见（review_hy）

> 评审人：hy（Agent 高级工程师 / 全栈视角）
> 评审对象：`docs/refactor/` 下 `00-overview.md`、`01-stack-decision.md`、`10-stage-map.md`、`20`–`30-*.md`
> 评审依据：实测 `ex/clowder-ai`（cat-cafe）、`ex/deepseek-harness`（dsh）真实代码结构 + flowforge 现有 Python/Next.js 代码
> 评审日期：2026-08-16
> 结论（首轮）：**有条件通过（Approve with required fixes）** — 架构方向正确、风险总体可控，但编码前必须补齐 6 项（见 §4）。
> 结论（第二轮 2026-08-16 修订后）：**通过（Approve）** —— 6 项阻塞已全部闭合，见 §9。

---

## 1. 我做了什么（评审范围）

- 通读 `docs/refactor/` 全部 12 份文档，逐阶段核对任务清单与验收门。
- 实读 `ex/deepseek-harness` 根结构、`pnpm-workspace.yaml`、`package.json`、以及 `packages/core/`、`packages/llm/` 实际目录。
- 依据已完成的 clowder-ai 技术分析（AgentRouter / cat-config-loader / tmux-gateway / agy-profile / 各 provider carrier 等真实文件）核对 C 系列能力。
- 比对 flowforge 现有 Python 侧（`forgemind/`、`evolution/`、`core/`、`config/forgekins/*.yaml`、`web/src/app/*`）与方案 F 系列映射。

---

## 2. 总体结论

方案**方向正确、结构完整、可落地**，是当前最合理的重构路径：

1. **目标清晰**：flowforge = clowder ∪ dsh ∪ flowforge 特色的"功能全集"，技术栈与插件机制对齐两个参考项目，品牌（Forgekin / SoulImprint / MindCouncil）保留。
2. **分阶段 + 双栈共存策略（D1）是对的**：Python 旧版全程保底、TS 渐进开发、功能齐平后切入口 —— 这是满足"不要影响现有功能"这一硬要求的唯一稳妥方式。
3. **技术栈决策（R01–R12）经得起实测核对**：dsh 确实是 pnpm monorepo + `vendor/{cordis,cosmokit,schemastery,group,hmr,include,loader,logger-console,timer}` + `packages/core/{scope,session,system-prompt,tools,agent,agent-default-model,agent-loop}` + `packages/llm/{llm,llm-deepseek,llm-pi-ai,llm-retry,token-meter}`，Node `^22.19 || >=24`；clowder 确实是 Fastify + socket.io + better-sqlite3 + 数据驱动 cat 身份 + provider carrier 模式。**方案描述与真实代码一致，没有臆测。**
4. **功能全集矩阵（10-stage-map §3）是优秀的验收基线**，D1–D27 / C1–C25 / F1–F14 覆盖了三端能力。

**但方案在"可安全开工"层面还有 6 个必须补齐的缺口（§4）。** 这些不是方向问题，而是会让"不影响现有功能"这条铁律在阶段 3/8 翻车的具体隐患。

---

## 3. 三项目对齐验证（带证据）

### 3.1 对齐 clowder-ai（群聊 / 灵智体 / 控制外部 CLI）— ✅ 成立

| 方案条目 | clowder 真实位置 | 验证 |
|---|---|---|
| C10 群聊线程 | `routes/threads.ts` | ✅ |
| C11 消息 + 行动 | `routes/messages.ts` | ✅ |
| C12 @mention 多体编排 | `services/agents/routing/AgentRouter.ts` + `MultiMentionOrchestrator.ts` + `route-parallel/serial.ts` | ✅ |
| C13 会话链 / 交接 | `routes/session-*`、`a2a-*.ts` | ✅（目录存在，建议阶段 5 实现时再核细） |
| C16 socket.io 实时投递 | `infrastructure/websocket/SocketManager.ts`、`ThreadSequencer.ts` | ✅ |
| C1–C5 灵智体（档案/注册表/队列/编排/转录） | `domains/cats/services/{profile,agents/registry,agents/invocation,orchestration,session}` + `cat-config-loader.ts:614`（`toAllCatConfigs`）、`:233`（`relationshipKey`）、`:187`（`sessionStrategySchema`） | ✅ |
| C7 蒸馏 | `domains/cats/services/distillation`（`Dossier`/`Distillation`） | ✅ |
| C17–C20 控制外部 CLI | `domains/limb`（LimbRegistry/LeaseManager/...）+ `domains/terminal/tmux-gateway.ts` + `services/agents/providers/{ClaudeAgentService.ts:60  spawn `claude -p ... stream-json`, CodexAgentService, GeminiAgentService, ...}` + `utils/cli-spawn.ts` | ✅ |
| C21 市场/插件 | `routes/marketplace.ts` + `domains/plugin/PluginRegistry.ts`（YAML manifest + host-inventory 控制面） | ⚠️ 见 §4.5（插件发现模型与 dsh 不一致） |

> clowder **没有** forgekin / 灵智 / 五闭环 / 跨厂商审议 概念（已确认）。这部分是 flowforge 独有 IP，方案把它放在阶段 7 自行移植，正确。

### 3.2 对齐 deepseek-harness（框架内核 / "一切皆插件"）— ✅ 成立

> 以下经 Explore-2 实读 `ex/deepseek-harness` 源码核对（含 `docs/architecture.md`）。

**核心机制（"一切皆插件"的真正含义，方案需据此落地）：**
- 内核 = **Cordis** 插件树：`boot()`（`packages/boot/app-boot/src/index.ts:757`）创建 `Context` → 装 `Loader`（`:771`）→ `mountRootInclude()`（`:486`）从 YAML 入口列表装载插件树。
- 插件形态（`packages/terminal/tool-terminal/src/index.ts:24-46`）：`name` + `inject:[服务]` + `Config`(schemastery) + 默认导出 `function(ctx,config)`；注册即 *effect*（`ctx.effect`），卸载自动回滚，**无需手写 teardown**。
- 装配文件：`packages/bundle/base/cordis.patch.yml`（`:15-60`）是一组 `insert` 行 `{id, name:'@deepseek-ai/dsh-...', config}`，按 profile→bundle→home→`--patch` 分层覆盖（last-write-wins），**不改 fork 即可改写任意行为**。
- 事件即扩展 API：`agent/pre-step`、`agent/request`、`agent/turn-stopping`（串行）、`tools/pre-execute→execute→post-execute→result`（`packages/core/tools/src/index.ts:142-208`），全部 *scope-filtered*（监听者只看本 agent）。

| 方案条目 | dsh 真实位置（实读锚点） | 验证 |
|---|---|---|
| D7 scope | `packages/core/scope` | ✅ |
| D1 session | `packages/core/session`（durable `SessionEvent` 事件溯源） | ✅ |
| D2 system-prompt | `packages/core/system-prompt` | ✅ |
| D3 tools | `packages/core/tools/src/index.ts:222` `ToolDefinition`；`:787` `ToolRuntime`(`ctx.tools`)；`:1037` `register()` 返回 disposer；`:1071` `restrict`；`:1110` `guard`；`schema.ts:545` `defineTool()` | ✅（细粒度吻合） |
| D4 agent | `packages/core/agent/src/runtime-types.ts:64` `Agent` 接口；`index.ts:256` `AgentRegistry`(`ctx.agents`)；`:372` `setFactory` 扩展点；`:405` `create/resume` | ✅ |
| D6 agent-loop | `packages/core/agent-loop/src/agent.ts:64` `ReactLoopAgent`；`:245` `turn()` 主循环；`:234` `pre-step`；`:296` `turn-stopping` | ✅ |
| D5 agent-default-model | `packages/core/agent-default-model` | ✅ |
| D8 hooks | `packages/hooks` | ✅ |
| D9–D22 插件族 | `packages/{mcp,skill,subagent,sandbox,shell,terminal,subprocess,workflow,plan,goal,todo,schedule,jobs,credentials,settings,lsp,fs,workspace,compaction,feedback,guard,identity,interaction,extensions}` 全部存在；MCP 桥接点 `packages/mcp/mcp-client/src/tools.ts:162`（`ctx.tools.register`） | ✅（目录名逐一吻合） |
| D23 API / D24 CLI / D25 boot+bundle+client+host | `packages/{web,boot,bundle,client,host}` + `apps/cli`（`dsh` bin，从 YAML 装配 Cordis 树） | ✅ |
| D27 LLM | `packages/llm/{llm,llm-deepseek,llm-pi-ai,llm-retry,token-meter}` | ✅（provider 抽象存在；**mock server 待确认**，见 §4.6） |
| R04 内核 | `vendor/{cordis,cosmokit,schemastery,group,hmr,include,loader,logger-console,timer}` | ✅ |

### 3.3 flowforge 特色映射 — ⚠️ 需要补 source crosswalk

F1–F14 指向 `forgemind/soul_imprint.py`、`evolution/self_dev_*.py`、`evolution/maturity.py`、`core/{capability,memory,knowledge_evolution,workflow_compiler,marketplace,teamact,observability,harness}.py`、`config/forgekins/*.yaml`。**这些 Python 源文件与新建 `packages/forgekin/*` 的 file→file 映射目前缺失**（见 §4.1）。Forgekin 是本次重构最难、最无参考可对齐的部分，必须有逐文件映射才能安全移植。

---

## 4. 必须在编码前补齐的 6 项（阻塞性）

### 4.1 缺 `02-source-crosswalk.md`（最高优先级）
方案目前只有"包名"，没有"file:line 级"的三方映射。对一个跨三仓、11 阶段的重构，**实现者必须有精确到文件的地图**：
`flowforge Python 文件 → clowder/dsh 源文件 → 新建 TS 包`。
否则阶段 1/2/4/7 开工后会反复返工。

**✅ 现状更新（Explore-1 + Explore-2 已完成三项目深读）：** 写 `02-source-crosswalk.md` 所需的两侧锚点现已齐备 ——
- clowder 侧：`AgentRouter.ts`、`cat-config-loader.ts:187/233/614/996`、`agy-profile-manager.ts`、`ProfileRepository.ts`、`tmux-gateway.ts`、`services/agents/providers/*`。
- dsh 侧：`boot/app-boot/src/index.ts:757/771/486`、`bundle/base/cordis.patch.yml:15-60`、`core/agent/src/index.ts:256/372/405`、`core/agent-loop/src/agent.ts:64/245`、`core/tools/src/index.ts:222/787/1037/1071/1110`、`core/tools/src/schema.ts:545`、`mcp/mcp-client/src/tools.ts:162`。
- 仅 **F 系列（Forgekin）** 还需回读 flowforge 现有 Python 源（`forgemind/`、`evolution/`、`core/`）即可补全。

**建议：评审通过后，我可直接产出 `02-source-crosswalk.md`**（D/C 系列锚点已现成，F 系列需半日回读）。这是解除"可安全开工"阻塞的最快路径。

### 4.2 双栈共存期间的"路由 / 数据 / 端口"冲突未定义（满足"不影响现有功能"的关键）
阶段 0–3 期间 Python(FastAPI :8000) 与 TS(Fastify) **同时在线**，但都暴露 `/api/v1/*`。方案只说"Python 旧版 pytest 保持全绿"作保底，**没说请求如何分流、DB 是否共用、端口如何并存**。
- 建议明确：过渡期 TS 挂载在**路径前缀或特性开关**后（如 `/api/v2/*` 或 per-route feature flag），Python 继续服务存量路由；better-sqlite3 新库与 Python 现有 DB 文件**物理隔离**（不同文件名/目录），避免锁冲突。
- 阶段 10 切入口时再统一路由。这条必须在 `20-stage0-infra.md` 里写清，否则阶段 3 一启动就会和线上功能打架。

### 4.3 "功能全集"范围过大，C21–C25 应降级为 stretch
方案声称 flowforge = clowder ∪ dsh 全集，但 clowder 的 IM 通道（飞书/Telegram/钉钉/企微）、world/community/story/排行榜、TTS/RSS/邮件/GitHub signals、Electron 桌面端（C21–C25）**与用户本次明确的 3 条需求（群聊 / 可进化智能体 / 控制外部 CLI）无关**，且体量巨大。
- 建议：把 C21–C25 标记为 **Phase 11 (stretch)**，从阶段 5 的必做清单里摘出（T5.9 world/community、T5.10 多 IM 通道改为"仅 WebChat + 预留适配接口"）。否则"工作量非常巨大"会变成"永远做不完"。

### 4.4 vendor cordis 的维护策略未定（D2 的长期坑）
方案说"从 ex/deepseek-harness vendor cordis 全家桶"且"以 ex/ 当前快照为准，不追踪上游"。但 dsh 自身 `pnpm-workspace.yaml` 用 `link:vendor/cosmokit` + `overrides` + `patchedDependencies(node-pty@1.1.0.patch)` 把 cordis 系锁死在自己 workspace。FlowForge 一旦 vendor 源码，就**继承了一份需要自己跟安全补丁/API 变更的 fork**。
- 建议二选一并在 `01-stack-decision.md` 写死：
  (a) **源码 vendor + 文档化 re-sync 流程**（定期从 dsh 快照 diff 合入）；或
  (b) **直接依赖已发布的 `@deepseek-ai/*` 包**（不 vendor 源码，仅对齐插件契约）。
  当前方案两头都没承诺，是隐性的长期维护负债。

### 4.5 插件发现模型存在两说（dsh cordis vs clowder YAML-manifest）
方案 R04 选了 dsh 的 cordis "一切皆插件"，但阶段 5 的 C21 market / 阶段 7 的 F11 插件市场又隐含 clowder 的 `PluginRegistry`（YAML manifest + host-inventory 控制面）语义。两套发现机制不同（cordis 是代码 `ctx.plugin()` 注入；clowder 是文件系统扫描 + 控制面审批）。
- 建议：在 `22-stage2-plugins.md` 明确 **FlowForge 自有插件（marketplace）用哪种发现模型**，避免阶段 2 与阶段 5/7 各做一套。

### 4.6 dsh LLM mock server 待确认（影响 T1.10/T1.11 测试基线）
方案称 dsh `packages/llm` 提供 "mock server 测试"。我实测 `packages/llm` 含 `llm / llm-deepseek / llm-pi-ai / llm-retry / token-meter` 及 `tests/*`，但**未确认存在一个独立 mock HTTP server**。阶段 1 的 agent-loop 单测依赖它。
- 建议：阶段 0/1 开工前先 `grep` 确认 dsh 确有可复用的 mock provider/server；若没有，方案应改为"FlowForge 自建 mock LLM provider"，并把这条写进 `21-stage1-core.md`。

---

## 5. 逐阶段意见（要点）

- **阶段 0（基础设施）**：总体 OK，但需补 §4.2 的路由/端口/DB 隔离设计 + §4.6 的 mock 确认 + 一份 CI 冒烟配置（R10 提到 vitest，但 stage 0 没给 CI 文档）。注意：本阶段会写 `vendor/cordis` 等代码，属首个编码阶段，**必须等用户评审通过后再动手**（与"先不要修改代码"一致）。
- **阶段 1（core）**：pkg 映射与 dsh 实测一致，风险低。落地前补 `02-source-crosswalk.md` 的 D 系列。
- **阶段 2（plugins）**：清单覆盖 D8–D22，合理。需先解决 §4.5 插件发现模型。sandbox 的 landlock-run 是 native 构建（dsh `native/landlock-run`），Windows 回退方案要明确（方案只在 limb 提了 node-pty 回退，sandbox 没提）。
- **阶段 3（api/cli）**：**最高冲突风险阶段**，务必先落地 §4.2 的路由分流。Fastify + socket.io 对齐 clowder 已验证可行。
- **阶段 4（cats）/ 5（chat）/ 6（limb）**：clowder 对齐证据充分（§3.1），按图施工即可。阶段 5 务必按 §4.3 砍掉 world/community/多 IM 通道。limb 的 Windows node-pty 回退（dsh 已 `patched node-pty@1.1.0`）要先验证本机能编。
- **阶段 7（forgekin）**：**最大不确定性**。无参考可对齐，纯 flowforge IP 移植。必须先把 F 系列 Python→TS file 映射做出来（§4.1）再开工；五闭环 / 跨厂商审议的"结构性护栏"验收点（T7.5 拒绝单一厂商）写得好，保留。
- **阶段 8（前端融合）**：三套 Next.js（flowforge / dsh / clowder）合并风险最高。方案只有"全页面合并"一句，**缺逐页 inventory→映射**（哪页保留 / 重写于 dsh / 重写于 clowder）。建议补 `28-stage8-web.md` 的页面级清单。
- **阶段 9（集成回归）/ 10（切入口）**：DoD 合理。阶段 10 的入口切换要与 §4.2 的分流策略呼应。

---

## 6. 流程 / 过程问题（与方案内容无关，但影响执行）

1. **Gitee API Token 已失效**：`flowlight/.mgr-token` 返回 `401 Access token does not exist`。`git` 级鉴权（fetch/push）仍可用，但 `./mgr pr` / `./mgr sync` 会失败。任何阶段提交 PR 前需先刷新该 token（GitHub token `~/.github-token` 不能用于 Gitee）。
2. **工作树里出现过越界的代码脚手架**：在按你"先不要修改代码"的要求整理前，树里已有 `vendor/cordis/src/*.ts`、`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`vitest.config.ts`、`pnpm-lock.yaml`、`tests/refactor/smoke.test.ts` 等实际代码。已按"评审前不写代码"的原则**全部 stash 保留**（`git stash list` 可见，可随时 `git stash pop` 恢复），当前树只留方案文档。建议评审通过后，从这些脚手架起步而不是直接从零写。
3. **命名契约依赖**：R11 引用 `docs/design/naming-contract.md`。开工前需确认该文件存在；若不存在，阶段 0 应一并产出。

---

## 7. 给我的下一步建议（等你拍板）

- [ ] 认可"有条件通过"结论，授权我补 `02-source-crosswalk.md`（F 系列需回读 flowforge Python 源）。
- [ ] 确认 §4.2 双栈路由/DB 隔离策略的写法（前缀 vs feature-flag）。
- [ ] 确认 §4.3 把 C21–C25 降级为 stretch。
- [ ] 确认 §4.4 vendor 维护策略（a 或 b）。
- [ ] 刷新 Gitee token 后再走 `./mgr` 提交流程。
- 以上 5 点闭合后，方案即可进入"按阶段编码"状态，且每一阶段都能满足"不影响现有功能 + 每阶段 `./mgr` 提交"的要求。

> 评审人注：本意见仅针对方案本身，未改动任何代码；脚手架仍在 stash 中，等你评审通过后再决定是否恢复并据此开工。

---

## 8. 补充（dsh 深读完成后）

Explore-2 已完成 `ex/deepseek-harness` 源码级分析，确认 §3.2 全部对齐属实，并给出可落地的细粒度锚点（见 §3.2 更新后的表格与 §4.1 现状更新）。关键结论：
- dsh 的"一切皆插件"是 **Cordis 插件树 + `cordis.patch.yml` 分层装配 + `ctx.effect` 自动回滚 + `agent/*`、`tools/*` 事件扩展**，**没有中心化 plugin registry 对象**（Loader 即加载器，各能力自带 Service 注册表）。这与方案 R04 一致，但方案 §4.5 关于"FlowForge 自有插件发现模型"的疑问现在更明确了：**FlowForge 应统一采用 dsh 的 YAML 装配模型**（而非 clowder 的文件系统扫描 + 控制面审批），否则两套机制会在阶段 2 与 5/7 打架 —— 倾向把 §4.5 的结论直接定为"采用 dsh cordis YAML 装配"。
- F 系列（Forgekin）仍是无参考可对齐的纯 flowforge IP，移植风险集中在阶段 7，需回读 Python 源后才能写 crosswalk。

至此三项目深读均已完成，方案的"深度分析 3 个项目"前提已满足；唯一待产出的交付物是 `02-source-crosswalk.md`（D/C 锚点已现成，F 待回读）。

---

## 9. 第二轮评审（2026-08-16 修订后）

你按 §4 的 6 项要求修订后，方案质量显著提升。**6 项阻塞性发现全部闭合**，结论由"有条件通过"上调为 **通过（Approve）**。

### 9.1 六项发现闭合确认

| 原发现 | 修订后落点 | 状态 |
|---|---|---|
| #1 缺 crosswalk | 新增 `02-source-crosswalk.md`（D→T / C→T / P→T 三向 file→file 地图 + 行为基线流程 §4） | ✅ |
| #2 双栈路由 / DB 隔离 | R18（Python `/api/v1/*` + TS `/api/v2/*`、socket.io `/v2`；`data/flowforge-v0.2.db` + `ff2:` keyPrefix 物理隔离）+ `31-stage11-sunset.md` | ✅ |
| #3 C21-C25 范围过大 | `10-stage-map.md §3.4` Stretch 清单（S1 IM / S2 TTS / S3 world·community），Phase 11 之后，不阻塞主线 | ✅ |
| #4 vendor 策略未定 | R16 定为"源码 vendor + 快照锁定 + 显式 re-sync"，re-sync 流程已写明 | ✅ |
| #5 插件发现两说 | R13 + `22-stage2-plugins.md`：内核 cordis 契约 + 应用层 `@flowforge/plugin-contract`（源自 clowder），统一 dsh YAML 装配模型，否决 clowder 目录扫描 | ✅ |
| #6 dsh mock server | `02-source-crosswalk.md` §1 确认 `packages/test-support/llm-mock-server` 存在，作阶段 1 测试基线 | ✅ |

### 9.2 仍需留意的次要项（非阻塞）

- R16 re-sync 目前是"显式执行"的人工流程，建议在阶段 0 加一个 CI 守卫（vendor 与 `ex/` 快照 diff 告警），避免悄悄偏离。
- 阶段 3 建议补一句"开发期 TS 用独立端口/db，仅阶段 10 才切 v1 入口"，把 R18 落到执行层面（当前已隐含）。
- R11 依赖 `docs/design/naming-contract.md`，开工前确认该文件存在或纳入阶段 0 产出。
- **新增议题：`*forge` 垂直项目（contentforge / devforge / mallforge / novelforge / stockforge）的迁移尚未作为独立阶段规划** —— 见我新建的 `32-other-forge-migration.md`。这些项目本就是 FlowForge 的"Plugin V3 域插件"，迁移路径清晰，但应纳入总阶段图（建议作为阶段 12）。

### 9.3 最终结论

方案现已达到"可安全开工"标准。进入编码前请确认 §7 的 5 个决策点，并将 `32-other-forge-migration.md` 纳入阶段图。之后可从阶段 0 起按 `./mgr` 提交（注意 Gitee token 仍失效，见 §6）。
