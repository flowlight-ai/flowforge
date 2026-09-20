# 36 — Stretch 剩余批次解决方案设计（S2/S4/S5/S6）

> 类型：EP4 stretch 后续｜前置：`35-stage-stretch-batch.md`（三张已收口）+ `31-stage11-sunset.md` §7 排期表
> 决策点：Q3（finance 剔除）、Q4（文档站暂缓）、Q1（agent-team 暂缓）——已裁决，不在此表
> 本表各批次**随 operator 指令逐批准入**；每条列"可动工性 / 依赖门禁 / 最小首子项"。

---

## 0. 总览：四批次现状研判（2026-09-19 勘察）

| # | 能力 | 现状落点（flowforge 已有） | 真实缺口 | 可动工性 |
|---|---|---|---|---|
| S2 | TTS/语音 / RSS / 邮件 / GitHub signals | email ✅ / github-signals ✅ / connectors ✅ / redis-port ✅ / revile `audio-proxy.ts` 留 501 宿主点 | TTS 合成引擎、RSS 聚合（依赖外部服务/凭据） | 低（缺服务） |
| S4 | 桌面端 desktop | `@yao-pkg/pkg` 打包先例（D54）；web Next.js 前端可承载 | Electron 壳（main/preload/托盘/单实例/窗口） | **高（纯 TS/Electron，无外部凭据）** |
| S5 | 游戏/信号 games | `cats/shared/types/game.ts` 类型 + `mcp-server/toolsets/collab/game-action` | 游戏引擎本体（WerewolfLobby / GameOrchestrator）+ `/game` 路由 | 中（依赖 LLM + 引擎移植） |
| S6 | Python↔TS 桥接 SDK | `code-runtime-python` ✅（内嵌执行 Python） | **对外**网关（外部 Python 程序调用 flowforge：LLM chat / 注册 tool/agent/事件订阅），方向 = ACP/stdio（基于 `acp-app`/`sdk-app`） | 中（需先澄清目标面） |

**要点**：S4 唯一满足"即时动工、零外部凭据"，且 user 已下达准入指令 → 建议 **S4 为首启批次**。

---

## 1. S4 — 桌面端 desktop（首启候选）

### 1.1 目标澄清
port clowder `desktop/`（`cat-cafe-desktop`）：**服务编排器 + 浏览器壳**。主进程 `main.js`：
- 起后端服务（Redis/API/Web），随后加载 `http://localhost:3003`（web 前端）；
- `BrowserWindow`（Splash + 主窗，`contextIsolation:true` / `nodeIntegration:false`）+ `preload.js` 暴露 `desktopBridge`（IPC：splash 状态/更新提示/更新进度/更新设置/更新动作）；
- **Tray 托盘**：关闭时隐藏到托盘、托盘退出停止服务并 `app.quit()`；单实例锁；窗口导航守卫；外部链接走系统浏览器。

### 1.2 可动工性
- 零外部凭据；flowforge 已有 `web/` Next.js 前端 + `@yao-pkg/pkg` 打包先例（D54 治理）。
- **依赖门禁**：Node 运行时可加载本地 web 产物；Electron/electron-builder 引入是否与本仓库"零原生"策略冲突需确认（convention：可接受 devDependency 打包工具，运行时仍走 pkg 产物）。

### 1.3 拆分矩阵（最小首子项 → 后续）
| 子项 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| S4-1 | **端口契约 + 壳脚手架**：`DesktopShell` 主进程编排（spawn 后端→HTTP 健康探测→加载 URL）+ `preload` 桥（`desktopBridge` 暴露契约）+ 配置（端口/URL）外置 | 无（注入式 spawn/HTTP） | **✅ 已交付（2026-09-19）**：`@flowforge/desktop`（`packages/apps/desktop`）——`resolveDesktopConfig`（env 注入式，端口/URL/根路径规范化）+ `DesktopBridgeContract`（splash-status/update prompt/progress/update settings/action 词汇）+ 包内 `DesktopInvariantViolation` 不变式 + `InMemoryDesktopBridge` 总线 + `DesktopShellOrchestrator`（spawn→health 探测→URL，注入式 BackendSpawner/ReadinessProbe/持久化）；21 包级 vitest / tsc exit 0 / oxlint 0；Electron 集成（S4-2）后置 |
| S4-2 | Electron 集成：`main.js`/`preload.js` 包装壳（窗口/托盘/单实例/导航守卫）+ electron-builder 打包装配 | Electron 打包工具 | 后续 |
| S4-3 | 更新/升级流程（desktopBridge 的 update 通道）承接 host 平台 | pkg 产物源 | 后续 |

---

## 2. S5 — 游戏/信号 games

### 2.1 目标澄清
port clowder `packages/api/src/routes/games.ts`（`gameRoutes`，`gameStartSchema` 现仅 `gameType:'werewolf'`）+ `game-command-interceptor.ts`（`parseGameCommand`/`sanitizeCatIds`/`buildGameSeats`）+ `game-actions.ts`（`/api/game/:gameId/action`，校验 `x-cat-id`/线程所有权/round/phase/seat）。flowforge 已有 `cats/shared/types/game.ts`（Seat/GameDefinition/GameRuntime/GameView）+ MCP `collab/game-action`。

### 2.2 可动工性
- 中。类型层已具备；缺口是**引擎逻辑**（WerewolfLobby 状态机 + GameOrchestrator 动作分派）。
- **依赖门禁**：LLM（角色发言/裁决）；游戏线程/消息存储（chat probe 已有）。

### 2.3 拆分矩阵
| 子项 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| S5-1 | **命令解析 + 座位构建** pure 层（`parseGameCommand`/`sanitizeCatIds`/`buildGameSeats` + schema 校验）移植为注入式纯函数 | 无 | **✅ 已交付（2026-09-19）**：`@flowforge/cats-games`（`packages/cats/games`）忠实移植 game-command-interceptor（parse/sanitize/build + 常量词汇 + clampToPreset）+ zod seatSchema/gameStartSchema/parsedGameCommandSchema/safeParseParsedGameCommand（`z.record` 双参对齐 zod v4 惯例），复用 `@flowforge/cats-shared` `Seat`，零 LLM/传输依赖注入式纯函数；30 包级 vitest / tsc exit 0 / oxlint 0 |
| S5-2a | **LLM 注入 seam**（决策面适配层）：AI 端口 + prompt 构造 + AI 玩家适配器 + 测试双例 | 无（纯注入式，可离线） | **✅ 已交付（2026-09-20）**：详见行下注 |
| S5-2b | 完整引擎状态机（WerewolfLobby + GameOrchestrator 动作分派） | S5-2a + LLM runtime | 待 LLM runtime 注入 |
| S5-3 | `/game` 路由 + MCP game-action 接线 | S5-1/S5-2 | 后接线 |

> **S5-2a 注**（2026-09-20 交付）：`@flowforge/cats-games` 新增 `src/llm/` 三件套 + 测试双例——①`ai-provider.ts`：`GameAIProvider` 端口（`generateAction(prompt,schema)→{actionName,targetSeat?}` + `generateSpeech(prompt)→string`，对齐 clowder `AIProvider` 但改名避歧义）+ `assertAIActionResponse` 不变式守卫（在 seam 边界把 LLM 输出当非安全输入校验：actionName 非空 string、targetSeat 合法座次）；②`werewolf-prompt.ts`：`buildWerewolfPrompt` 忠实移植 clowder werewolf-prompts 全角色（wolf/seer/witch/guard/hunter/idiot/villager）；③`ai-player.ts`：`GameWerewolfAIPlayer` 适配器（`decideNightAction`/`decideSpeech`/`decideVote`/`decideSpeechWithFormat`，动作经 assert 校验后转 `GameAction`）；④`ai-provider-fakes.ts`：`NoopGameAIProvider`（any call → `GameLlmInvariantViolation`）+ `ScriptedGameAIProvider`（FIFO `actions`/`speeches` 队列 + 调用记录，队列耗尽即 throw）。57 包级 vitest（新增 27：seam/guard 7 + prompt 8 + adapter 6 + fakes 6）/ tsc exit 0 / oxlint 0。完整引擎 S5-2b 待 LLM runtime 注入。随 PR 提交。

---

## 3. S6 — Python↔TS 桥接 SDK

### 3.1 目标澄清（关键）
旧 `python/legacy/sdk.py` = **外部 Python 程序调用 flowforge**（暴露 `FlowForgeSDK`：LLM chat、注册 tool/agent、事件订阅、插件注册、`models/tools/agents` 注册表）。这与 `code-runtime-python`（flowforge **内嵌执行** Python）是**两个相反方向**——S6 缺的是"对外"接入面。
- 方向判别：沿用 dsh A34 的 **ACP/stdio**（`@flowforge/acp-app`/`sdk-app` 已存在对外 stdio SDK 形态）为底座，做 **Python 客户端 SDK**（Python 侧调用 ACP/stdio → flowforge agent），或 HTTP 网关。
- 需 operator 先定：**S6 = Python 客户端库（对 ACP/stdio）** 还是 **通用对外 HTTP 网关**。

### 3.2 拆分矩阵（待方向定后再细化）
| 子项 | 内容 | 状态 |
|---|---|---|
| S6-0 | **方向裁决**：Python 客户端库（ACP/stdio）vs HTTP 网关 | **先裁决** |
| S6-1 | 依裁决：Python 侧 SDK 包（`py/` stdio 客户端，复用 code-runtime-python 协议经验）或 TS 对外网关 | 裁决后 |

---

## 4. S2 — TTS/语音 / RSS / 邮件 / GitHub signals

### 4.1 现状
email / github-signals / connectors / redis-port 已交付；`audio-proxy.ts` 已把 SSE `/api/audio/events` 归宿主 S2 平台路由。真正缺口仅 **TTS 合成引擎 + RSS 聚合**，均需**外部服务/凭据**。

### 4.2 可动工性
- 低：无外部服务前无法落地真实 TTS/RSS。
- **建议**：S2 保持"端口 + mock + 显式地址门控"（对齐 B21 audio-proxy 的 `audioServiceUrl` 显式注入模式），**待凭据/服务准入**——本轮**不排期动工**，仅登记可复用 seam 位置。

---

## 5. 建议启动顺序与门禁

| 顺序 | 批次 | 理由 | 门禁 |
|---|---|---|---|
| 1 | S4（先 S4-1） | 唯一零外部凭据、即时动工、符合 operator 准入指令 | ✅ S4-1 已交付（2026-09-19）；S4-2 依 Electron 工具链裁决 |
| 2 | S5（先 S5-1） | pure 层即时动工；引擎后续需 LLM | ✅ S5-1 已交付（2026-09-19）；**S5-2a LLM seam 已交付（2026-09-20）**；S5-2b 完整引擎依 LLM runtime |
| 3 | S6 | 先裁决方向（S6-0） | operator 定方向 |
| 4 | S2 | 缺服务，保持 ports，待凭据 | 外部 TTS/RSS 凭据 |

---

## 6. 待 operator 裁决点

| # | 决策 | 影响 |
|---|---|---|
| R1 | 确认 **S4 首启**（含 S4-1 壳脚手架先行） | S4 全部子项 |
| R2 | S6 方向：**Python 客户端库（ACP/stdio）** vs 通用 HTTP 网关 | S6-0/S6-1 |
| R3 | Electron/electron-builder 作为 **devDependency 打包工具** 是否接受 | S4-2 |
| R4 | S2 本轮**保持 ports 不排期**，确认 | S2 |

---

> **执行纪律**：本表为方案设计与排期单一事实来源；批次启动后登记 `review_code.md` §13.5 第 2 项、`task.md` EP4 行 2、`10-stage-map.md` §3.4 对应行，走 ff_dev 七阶段 + ff_doctor 门禁 + mgr PR。