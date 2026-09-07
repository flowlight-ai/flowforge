# 三项目深度对照审查 — 遗漏项、工程化流程插件规划与整体执行计划（review_code）

> 审查人：sherlock（AI 编码工具）
> 审查对象：flowforge TS 重构现状（`packages/`+`apps/`+`web/`）↔ `ex/deepseek-harness`（dsh）↔ `ex/clowder-ai`（cat-cafe）↔ `ex/superpowers`（工程化方法论第四源）↔ 业界开源工程实践（`ex/` 参照池：opencode/mini-swe-agent/pi/codebase-memory-mcp）
> 审查日期：2026-09-07（三轮：第一轮三源遗漏审查；第二轮工程化流程插件规划 + 文档规范差距 + 未完成任务全集 + 整体执行计划；第三轮 operator 裁决落定——EP0 插件定名 `@flowforge/plugin-dev`、新流程文档自 `docs/process/` 起步、确认**四源全量移植**（flowforge + dsh + clowder-ai + superpowers）并叠加业界工程实践参考）
> 审查方法：三方目录级全量 diff（dsh `packages/` 264 包、clowder `packages/`+`api/src/` 全域、flowforge `packages/` 283 包）+ superpowers 14 skill 全文精读 + 我方规范体系（rules/11、12、04-code-standards、dev-spec、git-workflow、test-iron-rules T1-T9）全文精读 + dsh/clowder 文档规范对照。
>
> **总结论**：
> 1. **第一优先级（operator 2026-09-07 指令，已裁决）**：引入软件工程化交付流程，以**独立插件 `@flowforge/plugin-dev`（软件工程化流程插件）**形式落地（§11），此后 flowforge 所有需求文档交付与需求代码交付全部基于该插件标准执行；先建流程底座，再谈剩余开发。四源全量移植（flowforge Python 旧版 + dsh + clowder-ai + superpowers），并叠加业界开源工程实践参考。
> 2. 文档规范现状：**静态分层规范强（SRS/SAD/SDD 三层对齐），动态开发流程规范缺位**——缺少"需求→计划→执行→验证→收尾"的文档流水线与 AI 可执行任务清单格式，需重构补齐（§12）。
> 3. 三源全量移植目标尚未闭环：60+ 项遗漏（dsh 37 项 §3、clowder 22 项 §4），P0 级 16 项（§9）。
> 4. 依赖合规（禁止 @deepseek-ai/@cat-cafe 依赖）已验证通过（§5）。
> 5. 未完成任务全集与整体执行计划见 §13/§14：EP0（工程化插件+文档规范）→ EP1（P0 遗漏移植）→ EP2（阶段 8 前端）→ EP3（阶段 9-10 集成与切换）→ EP4（阶段 11 Python 日落 + stretch）。

---

# 第一部分：三源对照遗漏审查（第一轮）

## 1. 审查范围

- **flowforge TS 现状**：`packages/`（61 域分组、283 包）、`vendor/`（9 库）、`apps/cli`、`web/`（Next.js，批次 56-59 进行中）。
- **dsh 参照**：`packages/`（264 包，含 `client/*` 47 个 UI 包与 `experimental/*` 9 包）、`apps/`、`vendor/`、`python/`、`native/`、`website/`、`snapshots/`、`patches/`、`examples/`。
- **clowder 参照**：`packages/{api,finance,mcp-server,shared,web}`、`api/src/{domains,routes,services,infrastructure,skills,marketplace,mcp,plugins,scripts,types,utils}`、`cat-cafe-skills/`、`sop-definitions/`、`desktop/`、`assets/`。
- **文档对账**：`docs/refactor/00-overview.md`、`10-stage-map.md`（§3 矩阵 D/C/F 三源）、`02-source-crosswalk.md`（file→file 锚点）。

## 2. 总体结论（第一轮）

1. 已登记矩阵（D1-D44 / C1-C42 / F1-F44）的绝大多数条目**真实交付**：目录结构、测试文件、`ctx.*` 服务挂载与 crosswalk 记录一致，git 历史可溯（PR #86-#147）。
2. **"功能全集 = 三源并集"的目标尚未闭环**：目录级 diff 发现一批从未进入矩阵的包/域（dsh `client/*`、`experimental/*`、`webhook/*`、`session-format/*` 等；clowder `mcp-server`、`signal-intake`、`messaging`、`connectors`、`cats/services` 8 个子域等），违反 D10"三源能力全部登记在案，禁止遗漏"的自设要求。
3. 存在 **crosswalk 状态漂移**（一处 ✅ 与实际不符：extensions 4 包缺 2）与**落点列失真**（3 处），需按 §6 纠偏。
4. 用户硬性要求"**不出现对 @deepseek-ai/@cat-cafe 的代码依赖**"已验证合规（§5），8 处源码引用均为注释级溯源说明，无真实 import。
5. 阶段 8（前端融合）为当前最大未完成块，且其前置（REST 控制器层、web-app bundle、socket.io/xterm 依赖）存在未登记缺口。

## 3. 发现 A：dsh 侧遗漏（代码级确认未移植）

> 以下按 `ex/deepseek-harness/packages/` 逐组 diff 确认在 flowforge 无对应包、亦无等价实现（源码关键词检索为空）。

| # | 包 | 职责 | 优先级 | 建议落点 |
|---|---|---|---|---|
| A1 | `api/session-controller` | 会话 REST 控制器（agent/assistant-stream/catalog/commands/control/file-references/history） | **P0** | 阶段 8 前置，`packages/api/` |
| A2 | `api/settings-controller` | 设置/凭证 REST 控制器 | **P0** | 同上 |
| A3 | `api/workspace-controller` | 工作区 REST 控制器（commands/directory-picker/feed） | **P0** | 同上 |
| A4 | `bundle/web-app` | web 模式装配模板（crosswalk L34 已提及但未落地；D24 已声明"web profile 依赖 web-app bundle"） | **P0** | 阶段 8 前置，`packages/bundle/` |
| A5 | `bundle/acp-app` | ACP 模式装配模板 | P1 | 阶段 3 补录 |
| A6 | `bundle/sdk-app` | SDK 模式装配模板 | P1 | 同上 |
| A7 | `bundle/sdk-minimal` | SDK 最小装配模板 | P1 | 同上 |
| A8 | `credentials/authorization` | OAuth 授权 invariant/types（独立于 credentials-local 的授权层） | **P0** | 阶段 2 补录 |
| A9 | `extensions/ui-cordis` | UI cordis 扩展（crosswalk L31 标记 ✅ 但实际缺失，见 §6-1） | **P0** | 阶段 8 相关 |
| A10 | `extensions/cordis-client-runner` | 客户端 cordis 运行器（同上） | **P0** | 阶段 8 相关 |
| A11 | `experimental/agent-team`（+ `agent-team-profile`/`agent-team-web-profile`/`client-ui-agent-team`/`tool-agent-team`，5 包） | 多智能体团队协作框架（mailbox/journal/lifecycle/activity/invariant） | P1 | **需裁决**（§15-1） |
| A12 | `experimental/inspector` | 调试检查器 | P2 | stretch |
| A13 | `experimental/code-runtime-python` | Python 代码运行时（worker） | P1 | 与 S6 相关，需裁决 |
| A14 | `experimental/webworker-packer` + `webworker-runtime` | WebWorker 打包与运行时 | P2 | stretch |
| A15 | `llm/deepseek-llm-api-extensions` | DeepSeek LLM API 扩展 | P1 | `packages/llm/` |
| A16 | `llm/plugin-package-inventory-deepseek` | DeepSeek 插件包清单 | P1 | 同上 |
| A17 | `session/session-format` + `session-format-catalog` + `session-format-v0-to-v1` + `session-format-v1-to-v2` | 会话格式版本化与迁移链（4 包）——会话持久化兼容的关键缺口 | **P0** | `packages/session/` |
| A18 | `session/session-log-deepseek` | 会话日志 L0 检索桥 | P1 | `packages/session/` |
| A19 | `session/session-turn-outline` | 会话轮次大纲 | P1 | 同上 |
| A20 | `session-query/session-log-export` | 会话日志导出（crosswalk L41 来源已列出、落点遗漏） | **P0** | `packages/session-query/` |
| A21 | `subprocess/win32-process` | Windows 进程管理工具（本仓主力平台为 Windows） | P1 | `packages/subprocess/` |
| A22 | `test-support/session-snapshot` | 会话快照测试支持 | P1 | `packages/test-support/` |
| A23 | `util/crypto` | 加密工具 | P1 | `packages/util/` |
| A24 | `util/deque` | 双端队列（`cats/invocation` 已自实现等价 queue，重复实现需收敛） | P2 | 统一收敛 |
| A25 | `util/http-proxy` | HTTP 代理工具（`cats-preview` 已局部实现） | P1 | 收敛统一 |
| A26 | `util/time` | 时间工具 | P1 | `packages/util/` |
| A27 | `util/values` | 值工具 | P1 | 同上 |
| A28 | `util/workspace-path` | 工作区路径工具（`cats/workspace`/`cats/shared` 已局部实现） | P1 | 收敛统一 |
| A29 | `webhook/webhook` + `webhook-github` | Webhook 接收与 GitHub 事件分发 | **P0** | `packages/webhook/`（新组） |
| A30 | `host/directory-picker-auto` | 自动目录选择器 | P2 | `packages/host/` |
| A31 | `examples/acp-demo` + `examples/jsonrpc-demo` | ACP/JSON-RPC 示例 | P2 | `packages/examples/` |
| A32 | `client/*` 46 包 | dsh Web UI 组件层（ui-chat/ui-plan/ui-goal/ui-jobs/ui-schedule/ui-trajectory/ui-deliverables/ui-settings-* 等，仅 `client/connection` 已移植） | **P0** | 阶段 8 按**能力级**登记（§15-2） |
| A33 | `apps/web` | Vite 宿主（现行决策：融入 Next.js `web/`，非包级 vendor） | 已决 | 登记决策即可 |
| A34 | `python/`（sdk + sdk-runtime） | Python SDK 桥 | 已登记 | S6 stretch ⬜（矩阵已有） |
| A35 | `website/` | VitePress 文档站 | P2 | **需裁决**（§15-4） |
| A36 | `snapshots/` | 预期输出快照测试目录（acp/sdk/session/web 四域） | P1 | 测试基建，EP3 |
| A37 | `patches/` | 依赖补丁（`@yao-pkg/pkg`、`node-pty`）；flowforge 无 `patchedDependencies` | P1 | Windows node-pty 路径需验证 |

## 4. 发现 B：clowder 侧遗漏（代码级确认未移植）

> 按 `packages/api/src/` 逐域 diff 确认；`routes/` 288 文件已由批次 55 做过语义 diff 并声明"其余平台面随阶段 8/9 按需对照"，此处仅列**整域缺失**项。

| # | 模块 | 职责 | 优先级 | 建议落点 |
|---|---|---|---|---|
| B1 | `packages/mcp-server` | **MCP 服务器**：canonical-tool-registry/tool-cutover/evidence/migration/bootstrap/cli 工具治理全家 + limb/memory/signals/collab/finance/audio server-toolsets + refresh-loop + protocol-server + json-schema-to-zod。flowforge 仅有 `mcp/mcp-client`，**服务器侧整包缺失** | **P0** | `packages/mcp/mcp-server` |
| B2 | `packages/finance` | 财经事实/频率数据域（配合 mcp-server finance toolset） | P1 | **需裁决**（§15-3） |
| B3 | `domains/signal-intake` | 信号准入域（25+ 文件）：SignalAdmission/RouteStore/MeetingIntake 全家/ASR 人物记忆队列/来源访问租约/LarkCliFeishuSourceResolver/ThreadDestinationAuthority + Redis stores | **P0** | `packages/cats/signal-intake` 或 `infrastructure/` |
| B4 | `domains/messaging` | Plugin Messaging 域（K-1/F288）：envelope/ledger/append-elements/event-stream/snapshot-capture/page-assembly/tokens + Redis Lua stores | **P0** | `packages/chat/messaging` |
| B5 | `domains/github-signals` | GitHub 等待生命周期（WaitLifecycleService/baseline readers/predicate catalog/wait renderer）——C33 email 域仅移植了 wait-lifecycle **端口**，本体未移植 | **P0** | `packages/infrastructure/github-signals` |
| B6 | `domains/services` | 服务面板域：service-manifest/lifecycle/config/process-termination + environment-detector + recommendation-matrix + loopback-url | P1 | `packages/cats/services-panel` |
| B7 | `infrastructure/connectors` | **IM connector 框架本体**（25+ 文件）：ConnectorRouter/CommandLayer/MessageFormatter/PermissionStore/ThreadBindingStore/gateway-bootstrap/lifecycle/reload-subscriber + FeishuQrBindClient + telegram-token + GitHubRepoWebhookHandler + mention-parser + StreamingOutboundHook + InboundMessageDedup——S1 stretch 仅覆盖"通道 ports + mock"，**框架本体未登记** | **P0** | `packages/infrastructure/connectors`（S1 升格为完整能力） |
| B8 | `api/src/skills` | 技能治理：skill-manage/meta/mount-ops/query/sync-all/sync-config/sync-engine + drift-detector/drift-resolver——governance（C34b）含 skill-sync 语义但**未做逐文件 diff 验证** | P1 | diff 后并入 `forgekin/governance` 或独立包 |
| B9 | `api/src/utils`（49 文件） | cli-error-patterns/cli-format/cat-mention-handle/active-project-root/claude-bg-job-ownership/reaper 等——F212/cli-diagnostics 部分已覆盖，其余未清点 | P1 | diff 清点后分域归位 |
| B10 | `api/src/scripts` | 运维脚本（backfill-usage-by-cat/migrate-signals/mint-agent-key 等） | P2 | EP3/EP4 运维期 |
| B11 | `api/src/mcp` | MCP 拓扑同步（mcp-drift-detector/drift-resolver/sync-all/sync-engine）——与 `forgekin/capabilities` healCatMcpTopology 覆盖关系未 diff | P1 | 验证后并入 `forgekin/capabilities` |
| B12 | `cats/services/context`（17 文件） | 会话上下文组装治理：ContextAssembler/governance-l0/IntentParser/MessageBundleCarrierResolver/message-bundle-quote-matching | **P0** | `packages/cats/context-assembly` |
| B13 | `cats/services/tool-usage`（8 文件） | 工具使用事件日志/归档/计数/normalize-mcp-tool-name/SkillLoadEventLog | P1 | `packages/cats/tool-usage` |
| B14 | `cats/services/runtime-session`（7 文件） | 外部运行时会话注册/RedisRuntimeSessionStore/SealReaper/CodexSessionReplacementProvenance | P1 | `packages/limb/runtime-session` |
| B15 | `cats/services/frustration`（4 文件） | 挫败检测（FrustrationDetector/retry-burst-detector/关键词） | P1 | `packages/cats/frustration` |
| B16 | `cats/services/cloud-bridge`（12 文件） | 云调用桥（cloud-invoke-bridge/return-binding/build-delta-payload/conversation-host-adapter） | P1 | `packages/cats/cloud-bridge` |
| B17 | `cats/services/first-run-quest`（3 文件） | 首次运行任务（client-detection/quest-blocks/quest-state）——区别于 C8 bootcamp | P1 | 并入 `packages/cats/bootcamp` 或独立 |
| B18 | `cats/services/collaboration` + `push` | reviewer-matcher / PushNotificationService（push 属 S2） | P2 | stretch |
| B19 | `cat-cafe-skills/`（20+ 技能包） | 技能**内容资产**（deep-research/expert-panel/cross-cat-handoff/debugging 等），非框架代码 | P1 | **需裁决**（§15-5） |
| B20 | `sop-definitions/` | SOP 定义内容（配合 F29 forgekin-sop 执行器） | P1 | `packages/forgekin/sop` 资产目录 |
| B21 | `assets/` | 音频/头像静态资源（audio-proxy/avatars 路由依赖） | P2 | 随 S2/平台路由 |
| B22 | `routes/` 平台面余量 | 批次 55 已声明"callback-*/config/debug 等平台面随阶段 8/9 按需对照"——需在阶段 9 收口清单中**强制复核** | P1 | EP3 验收项 |

## 5. 依赖合规检查（用户硬性要求：禁止 @deepseek-ai / @cat-cafe 依赖）

- 全仓 `package.json`（packages/apps/vendor/web）：**零命中** ✅。
- 源码 import 扫描：8 个文件出现 `@deepseek-ai/` 或 `@cat-cafe/` 字样，**全部为注释级溯源说明**（如 `limb/terminal/src/types.ts` 的"F212 诊断契约原宿主 @cat-cafe/shared，此处内联为本地契约"），无真实 import 语句 ✅。
- 结论：符合"全量移植、不依赖原仓库"红线；建议保留注释溯源但**禁止未来引入真实依赖**。

## 6. 文档状态漂移（crosswalk / stage-map 与实际不符）

1. **crosswalk L31**：`packages/extensions/*`（4 包）标记 ✅，实际仅 `tool-cordis` + `cordis-host-runner` 落地，`ui-cordis`、`cordis-client-runner` 缺失（A9/A10）——**状态虚报，需纠偏**。
2. **crosswalk L41**：session-query 来源列含 `session-log-export`，落点列遗漏（A20）。
3. **crosswalk L59**：AgentRegistry 落点写 `packages/cats/registry`，实际交付为 `forgekin/species`（代码在、落点列失真）。
4. **crosswalk L80**：Dossier 蒸馏落点写 `packages/cats/distillation`，实际并入 `cats/orchestration`（同上）。
5. **stage-map D9**："MCP 客户端/服务器"标记 ✅，实际 dsh 侧本就只有 `mcp-client`（已移植），但**clowder 的 `mcp-server` 从未进入矩阵**（B1）——表述易造成"服务器已交付"的误读。
6. **28-stage8-web.md**：任务清单 T8.1-T8.10 未包含 crosswalk L94 已声明的批次 56-59（实时通道/xterm/Playwright）对应条目，也未映射 dsh `client/*` 46 包的能力级清单（A32）。
7. **stage-map §3.4 S1**："IM 通道 ports + mock"的表述掩盖了 clowder `infrastructure/connectors` 框架本体未移植的事实（B7）——建议 S1 拆为"connector 框架（主线）+ 真实通道凭据启用（stretch）"。

## 7. 阶段 8（前端融合）未完成项证据

1. `web/package.json` **无 `socket.io-client`**——T8.2 群聊实时收发无依赖支撑（批次 56 声明待做）。
2. `web/package.json` **无 `@xterm/xterm`**——T8.4 终端面板无依赖支撑（批次 57 声明待做）。
3. `web/src/app/` 现有页面：admin/council/memory/mission/mission-control/mission-hub/review/signals/solo/tasks——**无 Threads/群聊页**，@mention 菜单/线程分支交互未落。
4. 前置层缺失：REST 控制器（A1-A3）与 `bundle/web-app`（A4）均未移植——TS web UI 的服务端 API 面尚不完整。

## 8. 工程卫生问题

1. 仓库根目录存在 40+ **未跟踪**临时文件（`_api_probe.py`、`_create_pr_batch2.py`、`_vitest_full.log`、`debug.log`、`pr_body.txt` 等）——虽未入库（git ls-files 核实），但应清理或补 `.gitignore` 规则。
2. `py.typed`/`__init__.py`/`__main__.py` 位于根目录——随阶段 11 Python 日落一并清理。
3. Python 遗留目录（`agents/`、`brain/`、`core/`、`llm/`、`loop/`、`forgemind/`、`evolution/`、`harness/`、`sop/`、`sdk.py`）完整保留——符合 D1 双栈共存策略 ✅（`forging/` 已删，F31 已 TS 化）。

## 9. 处置建议：遗漏项分级汇总

- **P0（16 项）**：A1-A4、A8-A10、A17、A20、A29、A32、B1、B3、B4、B5、B7、B12。
- **P1（25 项）**：A5-A7、A11、A13、A15-A16、A18-A19、A21-A23、A25-A28、A36-A37、B2、B6、B8-B9、B11、B13-B17、B19-B20、B22。
- **P2（9 项）**：A12、A14、A24、A30-A31、A35、B10、B18、B21。

## 10. ~~需用户裁决的开放问题~~（已并入 §15）

---

# 第二部分：工程化流程插件规划（P0-1 第一优先级）

> **依据**：operator 2026-09-07 指令——"引入软件工程化的开发方法和落地流程，指导 AI 进行规范化开发和落地；superpowers 流程能力和流程通过插件形式搞到 flowforge 项目中；此后 flowforge 所有需求开发全部以此插件的标准交付需求文档和需求代码"。本部分为该指令的落地方案，**排在所有剩余开发任务之前**。

## 11. 工程化流程插件（软件工程化流程插件，Software Engineering Process Plugin）

### 11.1 参照系分析：superpowers 方法论（D:\software\fl\ex\superpowers 精读结论）

superpowers 是"harness 无关的 AI 软件开发方法论"，由 14 个可组合 skill + 各 harness 的 bootstrap 注入机制构成。核心工作流：

```
brainstorming（需求澄清，苏格拉底式设计，产物=设计文档）
  → using-git-worktrees（隔离工作区，验证测试基线干净）
  → writing-plans（计划文档：任务=2-5 分钟粒度的步骤，含精确文件路径/完整代码/验证命令）
  → subagent-driven-development / executing-plans（每任务派发全新 subagent，两阶段审查）
  → test-driven-development（RED-GREEN-REFACTOR 铁律）
  → requesting-code-review（任务间审查，按严重级报告）
  → verification-before-completion（证据优先于声明）
  → finishing-a-development-branch（测试验证→merge/PR/丢弃→清理）
```

14 个 skill 清单（全量移植对象）：

| superpowers skill | 职责 | 流程阶段 |
|---|---|---|
| `brainstorming` | 需求头脑风暴→设计文档（分块呈现给人确认） | 需求 |
| `writing-plans` | 计划文档（bite-sized 任务、精确文件路径、完整代码、验证步骤、No Placeholders 铁律） | 计划 |
| `executing-plans` | 批次执行计划 + 人工检查点 | 执行 |
| `subagent-driven-development` | 每任务全新 subagent + 两阶段审查（spec 合规→代码质量） | 执行 |
| `dispatching-parallel-agents` | 并行 subagent 工作流 | 执行 |
| `test-driven-development` | TDD 铁律（无失败测试不写产品代码） | 执行 |
| `requesting-code-review` | 发起代码审查（强制审查点） | 审查 |
| `receiving-code-review` | 响应审查意见（按严重级处理） | 审查 |
| `systematic-debugging` | 4 阶段根因定位 | 执行 |
| `verification-before-completion` | 完成前验证（证据优先） | 验收 |
| `using-git-worktrees` | 隔离开发分支 | 执行 |
| `finishing-a-development-branch` | 收尾（验证→merge/PR→清理） | 收尾 |
| `writing-skills` | 编写新 skill 的方法论 | 元 |
| `using-superpowers` | 技能系统入口/引导 | 元 |

superpowers 的关键工程机制（porting-to-a-new-harness.md）：**skills 是 harness 无关的文档资产**（markdown 指令），bootstrap 注入是 per-harness 的，强制机制 = "session 启动即注入 + 技能自动触发 + 验收测试证明"。这正好匹配 operator 的第二个诉求："**无论换成什么 AI 开发工具，都可以基于我们的规范化文档进行 AI 自动化开发**"。

### 11.2 插件化设计：`@flowforge/plugin-dev`（软件工程化流程插件，operator 已定名）

**定位**：独立 cordis 插件（`packages/plugins/dev`），把 superpowers 工程化方法论全量改造为 flowforge 原生能力，同时保留 harness 无关的文档资产层。此后 flowforge 的需求交付（文档+代码）**必须**走该插件定义的流程状态机。

**双平面架构（关键设计决策）**：

1. **Plane 1 — 文档资产层（harness 无关，任何 AI 工具可用）**：
   - 流程规范文档（每个 skill 的方法论正文，改造后去除 Claude 专属措辞，适配 flowforge 命名契约）
   - 文档模板：需求设计文档模板（brainstorming 产物）、实施计划文档模板（writing-plans 产物：任务头/Files/Interfaces/Steps checkbox/No Placeholders 约束）
   - 存放规范：`docs/process/{specs,plans}/YYYY-MM-DD-<feature>.md`
   - 这一层满足"换任何 AI 工具都能照文档自动开发"
2. **Plane 2 — 插件执行层（flowforge 原生自动化）**：
   - cordis 服务 `ctx.forgeProcess`：流程状态机（`requirement → design → plan → implement → review → verify → finish`），持久化流程实例
   - 门禁（gates）：design 未签核禁止进 plan；plan 无对应测试步骤禁止 implement；implement 后强制 review；finish 前强制 verification（测试证据采集）
   - 与既有体系对接：git-workflow（mgr sync/PR）、test-iron-rules T1-T9、红线 15 条、`docs/rules/11-doc-layering`（F/A/D 静态分层）——**流程插件管"动态时序"，分层规范管"静态结构"，两者正交**
   - CLI 命令面（apps/cli 子命令）：`flowforge process new|design|plan|implement|review|verify|finish|status`
   - subagent 调度：复用 `packages/subagent/subagent-ff-sdk`（对应 superpowers 的 subagent-driven-development）
   - worktree 隔离：复用 limb/terminal 或 shell域能力实现 using-git-worktrees 等价物

**superpowers → 插件能力映射表（14 skill 全量映射）**：

| superpowers skill | 插件内落地形态 |
|---|---|
| brainstorming | `process design` 阶段指令资产 + design 文档模板 + 苏格拉底澄清问题生成器 |
| writing-plans | `process plan` 阶段指令资产 + plan 文档模板 + No-Placeholder 校验器（扫描 TBD/TODO/缺代码块） |
| executing-plans | `process implement` 批次执行 + 检查点暂停 |
| subagent-driven-development | 每任务派发 subagent（subagent-ff-sdk）+ 两阶段审查编排 |
| dispatching-parallel-agents | 并行任务派发编排器 |
| test-driven-development | implement 阶段门禁：步骤必须"先失败测试后实现"；与 T1-T9 融合（T1 禁 Mock LLM 优先为最高裁决） |
| requesting-code-review | `process review` 指令资产 + 审查清单（对齐 clowder 交叉 review P1/P2/P3） |
| receiving-code-review | 审查意见响应协议（严重级分类处理） |
| systematic-debugging | 调试方法论指令资产（4 阶段根因） |
| verification-before-completion | `process verify` 门禁：收集测试运行证据（exit code/覆盖率/截图），无证据不 finish |
| using-git-worktrees | worktree 隔离服务 |
| finishing-a-development-branch | `process finish`：全量测试→mgr sync 提 PR→清理 worktree |
| writing-skills | skill 编写元方法论（服务插件自身的 skill 资产迭代） |
| using-superpowers | 插件入口引导（README + session bootstrap 注入等价物） |

### 11.3 与我方既有规范的融合与冲突裁决（含待 operator 决策点 ⚠）

> 四源 + 业界实践并存必然产生规范冲突。下表为已裁决项；标 ⚠ 的为**待 operator 决策点**（不影响 EP0-1/EP0-2 先行动工，但影响 EP0-3 之后的行为面）。

| 维度 | 我方规范 | superpowers | 裁决 |
|---|---|---|---|
| 测试优先 | T1-T9 测试铁律；T1 禁止 Mock LLM 优先 | TDD 铁律"无失败测试不写代码"；llm-mock-server（dsh）仅限 unit/契约层 | **T1 最高**：涉及 LLM 的实现必须真实调用优先，mock 仅限 dsh llm-mock-server 既定边界 |
| 分支流 | mgr sync/PR 到主干，禁直推 | worktree + feature branch + PR | 融合：worktree 内开发，**出口必须走 mgr sync PR**（保留我方 git-workflow 为主） |
| 文档分层 | 11-doc-layering（spec/arch/design 三顶层 + F/A/D 三子目录） | docs/superpowers/plans/ 计划文档 | 融合：计划文档为**新增第四类流程文档**，存 `docs/process/plans/`，与 F/A/D 并行不冲突（F/A/D=结构，plan=时序） |
| 评审 | clowder 交叉 review P1/P2/P3 | requesting/receiving-code-review | 融合：两阶段审查（spec 合规→代码质量）采用 clowder P1/P2/P3 分级报告格式 |
| 提交 | mgr + 规范化 commit message + 智能体署名 | 每任务一 commit | 融合：任务粒度 commit + mgr 署名规范（每任务 commit 在 worktree 内，出口统一 mgr sync） |
| 设计先行 | 11.2 三阶段 SRS→SAD→SDD 不可颠倒 | brainstorming 产出设计文档并分块签核 | ⚠ **决策点 A（衔接粒度）**：forgeProcess 的 design 产物如何与 F/A/D 挂钩？提案：小需求 design 文档独立即可；跨域需求必须升格为 F/A/D 三件套（由门禁按"是否新增 capability"自动判定），待 operator 确认 |
| 流程粒度 | 批次（约 1-3 天粒度） | 任务（2-5 分钟步骤） | ⚠ **决策点 B（层级映射）**：提案：forgeProcess 的 plan=我方批次；superpowers task=批次内 checklist 步骤，不新开管理层级，待 operator 确认 |
| AI 工具无关 | 我方规范以 AI 工具视角编写（AGENTS.md） | harness 无关 skills + per-harness bootstrap | 融合：Plane 1 资产为通用规范（任何 AI 可读），Plane 2 插件为 flowforge 原生自动化 |
| Python 旧版行为基线 | pytest 全绿作为 golden reference | 无对应 | 维持我方：verification 门禁在双栈需求场景同时跑 pytest（TS 侧）与 vitest |
| ⚠ 决策点 C（subagent 身份） | 六智能体署名（sherlock/luban/davinci/wenxin…） | fresh subagent per task（无署名概念） | 提案：subagent 派发时绑定批次责任智能体署名（实现=sherlock，基础设施=luban，测试=davinci，文档=wenxin），保持 mgr 署名语义不变，待 operator 确认 |
| ⚠ 决策点 D（worktree 必选性） | 我方当前直接在 master 工作区开发 | superpowers 强制 worktree 隔离 | 提案：EP0 阶段 worktree 为**可选**（本机 Windows 长路径风险），流程状态机不强制；EP0-4 后按验证结果决定是否升级为强制，待 operator 确认 |

### 11.4 交付计划（EP0 批次划分 → 详细任务清单见 `33-stage-ep0-plugin-dev.md`）✅ 已全部交付

> 本表为总览；**七批次的具体任务清单（T0.x.y 级 checklist + 文件落点 + 验收命令）已细化在 `docs/refactor/33-stage-ep0-plugin-dev.md`**，EP0 执行以该文件为唯一任务依据。
> **交付状态（2026-09-07）**：EP0-1 ~ EP0-7 全部完成并合入主干（PR #152 + PR #153）。

| 批次 | 内容 | DoD | 状态 |
|---|---|---|---|
| EP0-1 | 插件骨架：`packages/plugins/dev`（@flowforge/plugin-dev：状态机/实例注册表/类型面）+ Plane 1 文档资产目录 `docs/process/` 建立 + 14 份流程指令资产移植（适配命名契约/对接 mgr 与 T1-T9/去除 harness 专属措辞） | 插件可安装；状态机单测全绿；14 份流程指令资产入库 | ✅ PR #152 |
| EP0-2 | 文档模板 4 件（design/plan/review/verification 模板）+ No-Placeholder 校验器 + plan 文档校验单测 | 模板可用；校验器能拦截 TBD/TODO/无代码块步骤 | ✅ PR #153 |
| EP0-3 | `ff_` CLI 命令族（operator 指令：前缀由 `flowforge process *` 替换为 `ff_dev`/`ff_doctor`）+ 四工作流模板（greenfield/feature/change/hotfix，DCP/TR 决策门照搬 devforge）+ 实例持久化（状态契约：状态在文件不在会话） | CLI 端到端冒烟 + 门禁单测 | ✅ PR #153 |
| EP0-4 | subagent 派发编排（TaskDispatcher 注入式驱动，无宿主时 NullDispatcher 人工降级——双向互操作）+ 两阶段审查（P1/P2/P3）+ verification 证据采集 | 以一个小需求端到端走完七阶段流程作为验收 | ✅ PR #153（实例 `ep0-plugin-dev` 7/7 完结，四产物齐备） |
| EP0-5 | 规范回填：`docs/rules/13-dev-process.md`（流程铁律）+ 入口三件套（AGENTS/CLAUDE/GEMINI）+ ts-ci.yml（L4 硬拦截）+ 04-code-standards 联动 + 存量治理基线（governance.md 台账） | 规范文档体系更新；**此后所有批次交付走 forgeProcess 流程** | ✅ PR #153 |

### 11.4a 遵从度五层体系（"提示词可以不听，CI 不放行"——EP0-4 落地）

| 层 | 手段 | 强度 |
|---|---|---|
| L0 入口引导 | AGENTS.md / CLAUDE.md / GEMINI.md 三件套（自然语言入口无需提示词模板：任何 AI 工具开工第一步读入口 + `ff_dev resume` 取状态锚点） | 软 |
| L1 方法论资产 | `docs/process/skills/` 14 份（harness 无关） | 软 |
| L2 状态机门禁 | `ff_dev advance` 拒绝无证据推进（三道硬门禁：design 签核 / plan No-Placeholder / verify 证据） | 硬（工具内） |
| L3 本地 Git 拦截 | mgr 提交前跑 `ff_doctor`（D5 裁决：独立批次实施） | 硬（本地，待接线） |
| L4 CI 强制拦截 | `.github/workflows/ts-ci.yml`：typecheck + vitest + `ff_doctor all`，PR 必须 | **硬（远端）** |

**双向互操作两场景（状态契约支撑）**：① flowforge 主导开发，换外部智能体/换 LLM 模型后凭 `ff_dev resume` 从中断处接续；② 外部 AI 工具主导开发 flowforge，凭状态文件（`docs/process/instances/<name>.json`）按同一规范接续。

### 11.5 后续交付方式切换（✅ 已生效，2026-09-07）

EP0 已完成，本 review_code.md §13/§14 中的每个开发批次都必须：① design 阶段产出设计文档（`docs/process/specs/`）；② plan 阶段产出计划文档（`docs/process/plans/`，过 No-Placeholder 校验）；③ implement（TDD）；④ 两阶段审查（`docs/process/reviews/`）；⑤ verification 证据（`docs/process/verifications/`）后 mgr sync PR。**这正是"文档→代码"流水线的闭环**。

---

# 第三部分：文档规范差距分析与重构规划

## 12. 文档规范体系差距分析（现状 vs 业界）

### 12.1 现有体系盘点（我方）

- `docs/rules/11-doc-layering.md`：SRS/SAD/SDD 三顶层 + F0XX/A0XX/D0XX 三子目录一一对应（**静态结构规范，强项**）
- `docs/rules/12-doc-refactor-methodology.md`：大规模文档重构方法论
- `docs/rules/04-code-style.md`、`05-dev-spec.md`、`07-coding-redlines.md`（15 红线）、`test-iron-rules.md`（T1-T9）：编码与测试规范
- `docs/git-workflow.md` + mgr：分支/PR/署名规范
- `docs/AGENTS.md`：AI 工具行为与文档写作规范
- `docs/refactor/00-10 + 11-29`：TS 重构专项规范（阶段地图/批次计划）

### 12.2 业界对照

| 参照 | 文档管理做法 | 我方差距 |
|---|---|---|
| **dsh** | `docs/development.md`+`testing.md` 双规范、每包 README、`website/` VitePress 文档站、AGENTS.md（构建顺序/vendor 纪律）、snapshots 预期输出 | 我方无文档站（A35 待裁决）、无预期输出快照体系（A36） |
| **clowder** | AGENTS.md Iron Laws、`feature-specs/`（规格先行）、`review-notes/`（评审记录）、`sop-definitions/` | 我方 review 记录散在 refactor/ 下未体系化；SOP 定义资产未迁移（B20） |
| **superpowers** | brainstorm→plan→execute 流程产物规范（design 文档+plan 文档+checkbox 步骤）、No Placeholders、验证后完成 | **我方完全缺失动态流程文档层**（EP0 补齐） |
| **opencode 等业界**（`ex/` 参照池） | AI 工具无关的指令文档 + 插件化能力 | 与 EP0 双平面设计方向一致 |

### 12.3 结论

我方规范体系"**强于静态结构（分层/命名/红线），弱于动态流程（开发时序/门禁/产物模板/AI 可执行性）**"。重构方向：**不推翻 11-doc-layering**，而是叠加第四类流程文档（design/plan/review/verification）+ 工程化插件门禁（§11），形成"结构×时序"正交互补的完整体系。

### 12.4 文档标准化任务清单（EP0-5 展开）

1. 新增 `docs/rules/13-dev-process.md`（软件开发流程铁律：七阶段时序、门禁、产物路径、AI 工具无关性要求）。
2. 新增 `docs/process/`：`README.md`（索引）+ `templates/`（design/plan/review/verification 4 模板）+ `assets/skills/`（14 指令资产）。
3. 更新 `docs/AGENTS.md` 与 `docs/refactor/04-code-standards.md`：引用流程插件为交付强制入口。
4. 存量文档迁移评估：`docs/refactor/` 29 个批次文档**保持原位**（历史交付记录），新流程文档从 `docs/process/` 起步。
5. 文档验收门禁：所有新规范文档 ≤50KB、编号续接、双语标题遵循 naming-contract。

---

# 第四部分：未完成任务全集与整体执行计划

## 13. 未完成任务全集（百万行级项目任务登记）

> 本节为"单一事实来源"：合并 ①阶段地图剩余 ②三源遗漏（§3/§4）③工程化插件（§11）④文档标准化（§12）⑤代码智能插件（§16）。每项任务按 §11.5 流程交付。

### 13.0 EP-CB — 代码智能插件 @flowforge/plugin-codebase（高优先级，operator 2026-09-07 第二指令）

> 源项目 `D:\software\fl\ex\codebase-memory-mcp`（纯 C，197 文件 / 14.4 万行：tree-sitter 知识图谱 + SQLite + 15+ MCP 工具）。
> 定位：dev 插件的基础（代码索引/文档生成）+ 任何上层模块与业务的快速索引底座。详见 §16 与 `34-stage-ep-cb-plugin-codebase.md`。
> **进度**：EP-CB0（骨架 + 存储引擎 + 结构层索引闭环）✅ PR #154——57 项契约测试全绿，真实仓库 8376 文件索引闭环；EP-CB1~4 待 Q14/Q15/Q17-Q19 裁决后推进。

### 13.1 EP0 — 工程化流程插件 + 文档规范（第一优先级，✅ 已完成）

见 §11.4（EP0-1 ~ EP0-7，PR #152 + PR #153 已合入）。**一切交付的底座，已就位。**

### 13.2 EP1 — 三源 P0 遗漏项移植（16 项，约 14 个批次）

| 序 | 任务 | 来源 | 预估批次 |
|---|---|---|---|
| 1 | `mcp-server` 整包（工具治理全家+6 toolsets+protocol-server） | B1 | 2 批次 |
| 2 | `infrastructure/connectors` IM 框架本体 | B7 | 2 批次 |
| 3 | `chat/messaging` 域（envelope/ledger/snapshot + Redis） | B4 | 1 批次 |
| 4 | `cats/signal-intake` 域（25+ 文件） | B3 | 2 批次 |
| 5 | `infrastructure/github-signals` 域 | B5 | 1 批次 |
| 6 | `cats/context-assembly`（17 文件） | B12 | 1 批次 |
| 7 | `api/session-controller` + `settings-controller` + `workspace-controller` | A1-A3 | 1 批次 |
| 8 | `session-format` 4 包 + `session-log-export` | A17/A20 | 1 批次 |
| 9 | `webhook` 2 包 | A29 | 1 批次 |
| 10 | `credentials/authorization` | A8 | 0.5 批次 |
| 11 | `extensions/ui-cordis` + `cordis-client-runner` | A9/A10 | 1 批次 |
| 12 | `bundle/web-app`（+acp/sdk 模板） | A4-A7 | 1 批次 |
| 13 | dsh `client/*` 能力级清单登记 + Next.js 融合实施 | A32 | 归入 EP2 |
| 14 | 矩阵补录：`10-stage-map.md` 增设 D45+/C43+/F45+ 编号 + crosswalk 漂移纠偏（§6） | 文档 | 0.5 批次 |

### 13.3 EP2 — 阶段 8 前端融合（含批次 56-59 + dsh client 能力）

1. 批次 56：socket.io-client 实时通道（web 依赖已确认缺失）。
2. 批次 57：xterm 终端面板。
3. 批次 58-59：Playwright 端到端 + 视觉回归。
4. Threads/群聊页 + @mention 菜单 + 线程分支交互（clowder packages/web 能力）。
5. dsh `client/*` 46 包能力级对照表（ui-chat/ui-jobs/ui-schedule/ui-goal/ui-plan/ui-trajectory/ui-deliverables/ui-settings-*/schema-form/locale 等）逐项融入 Next.js。
6. 前置依赖：EP1-7（REST 控制器）+ EP1-12（web-app bundle）。

### 13.4 EP3 — 阶段 9-10：集成回归 + 入口切换

1. 阶段 9 全量集成回归（三源功能矩阵核对，B22 路由平台面强制复核；snapshots 预期输出体系 A36）。
2. 阶段 10 入口切换：`flowforge` CLI 为唯一入口，web 入口切换到 TS 栈。
3. patches 体系补齐（A37：node-pty Windows 验证）。

### 13.5 EP4 — 阶段 11：Python 日落 + stretch

1. Python 遗留目录日落与删除计划（`agents/`、`brain/`、`core/`、`llm/`、`loop/`、`forgemind/`、`evolution/`、`harness/`、`sop/`、`sdk.py`、根目录 Python 标记文件、`_*.py` 临时文件清理）。
2. stretch 项按裁决结果排期：S1 真实通道凭据启用、S2（TTS/邮件推送/push）、S3、S4 desktop、S5 games、S6 Python SDK（A34）、S7。
3. P1/P2 遗漏项（A5-A7、A11、A13、A15-A16、A18-A19、A21-A23、A25-A28、A30-A31、B2、B6、B8-B9、B11、B13-B17、B19-B21、A35）。

## 14. 整体执行计划（时序）

```
EP0 工程化流程插件（✅ 已完成，PR #152/#153——一切交付的底座）
  ↓（此后所有批次走 forgeProcess 七阶段流程交付：ff_dev 状态机 + ff_doctor 拦截）
EP-CB 代码智能插件 @flowforge/plugin-codebase（高优先级，operator 2026-09-07 第二指令）
  ↓（plugin-codebase 是 dev 的基础与全仓库快速索引底座，与 EP1 并行推进时优先保障 EP-CB）
EP1 P0 遗漏移植（约 14 批次）——含矩阵补录
  ↓
EP2 阶段 8 前端融合（批次 56-59 + dsh client 能力级融入）
  ↓
EP3 阶段 9-10 集成回归 + 入口切换（含 snapshots/patches 基建）
  ↓
EP4 阶段 11 Python 日落 + stretch（按 §15 裁决结果）
```

**执行纪律**：每批次交付 = `ff_dev design → plan → implement(TDD) → review(两阶段) → verify → mgr sync PR`；本文件作为任务登记单一事实来源，每完成一项即在 §13 对应条目标注 ✅ + PR 号。

## 15. 决策问题登记表（含已裁决项）

> 状态图例：✅ 已裁决（operator 2026-09-07 指令）｜⚠ 待裁决（不影响 EP0-1/EP0-2 动工）

| # | 问题 | 状态 |
|---|---|---|
| Q1 | `experimental/agent-team` 5 包（dsh 多智能体团队框架）是否全量移植？与 forgekin/swarm（F16 群聊编排）概念边界需先明确（agent-team=同构 agent 组队执行；swarm=跨厂商能力路由） | ⚠ EP1 前裁决 |
| Q2 | dsh `client/*` 46 包按"能力级融入 Next.js"执行（现行决策，EP2 落实），阶段 8 任务清单按 UI 能力逐项登记为验收对照表 | ⚠ EP2 前确认 |
| Q3 | `packages/finance` + mcp-server finance toolset：财经数据域是否属于目标能力？若不要，B1 移植时剔除 finance/audio toolset 子集 | ⚠ EP1 前裁决 |
| Q4 | `website/` VitePress 文档站是否移植（当前文档全在 `docs/`）？ | ⚠ EP3 前裁决 |
| Q5 | `cat-cafe-skills/`（20+ 技能内容包）与 `sop-definitions/` 内容资产是否随代码全量移植并按 naming-contract 改造品牌措辞？ | ⚠ EP1 前裁决 |
| Q6 | signal-intake/messaging 的 Redis 重度依赖：确认按既有 `infrastructure/redis-port`（KV 注入式）模式移植，真实 Redis 后端按凭据启用？ | ⚠ EP1 前确认 |
| Q7 | EP0 插件命名 | ✅ **已定名 `@flowforge/plugin-dev`（软件工程化流程插件）**，包路径 `packages/plugins/dev` |
| Q8 | 新流程文档自 `docs/process/` 起步；旧批次文档保留 `docs/refactor/` 原位 | ✅ operator 确认 |
| Q9 | 四源全量移植立场（flowforge Python + dsh + clowder-ai + superpowers）+ 业界开源工程实践参考 | ✅ operator 确认 |
| Q10 | 决策点 A：forgeProcess design 产物与 F/A/D 分层的衔接粒度（小需求独立 design / 跨域需求强制升格 F/A/D 三件套） | ✅ 已裁决：小需求独立 design；跨域/新增 capability 需求升格（33-stage §8 A 项，随 EP1 首批次验证） |
| Q11 | 决策点 B：流程层级映射（forgeProcess plan = 我方批次；superpowers task = 批次内 checklist 步骤，不新开管理层级） | ✅ 已裁决（33-stage §8 B 项） |
| Q12 | 决策点 C：subagent 派发与六智能体署名的绑定规则 | ✅ 已裁决（33-stage §8 C 项：dispatcher 注入式署名） |
| Q13 | 决策点 D：worktree 隔离 EP0 期可选、EP0-4 后评估是否强制 | ✅ 已裁决（33-stage §8 D 项：保持可选，Windows 长路径风险） |
| Q14 | plugin-codebase 解析器依赖策略：web-tree-sitter（WASM，纯 TS 生态）/ node 原生绑定 / vendored 语法资产 | ⚠ EP-CB1 前裁决（EP-CB0 不涉及，见 §16.4 建议） |
| Q15 | plugin-codebase 与 packages/lsp（ctx.lsp seam）融合边界：图谱解析用 LSP 语义（Hybrid LSP 思想）还是纯 tree-sitter | ⚠ EP-CB4 前裁决（建议：LSP seam 作为语义增强源接入，不替代 tree-sitter 主链路） |
| Q16 | 索引数据落点：仓库本地 `.flowforge/codebase.db`（gitignore）vs 集中 `~/.flowforge/`（C 源项目两态并存） | ✅ 已裁决：仓库本地优先 + 集中注册表（EP-CB0 按建议执行，见 34-stage D-CB3） |
| Q17 | graph-ui 3D 可视化（C 源项目内置 web 服务）是否纳入移植范围 | ⚠ EP-CB3 前裁决（建议：纳入 EP2 前端融合，非核心链路） |
| Q18 | 162 语言全量语法资产 vs 先 TS/JS 后扩展的批次节奏 | ⚠ EP-CB1 前裁决（建议：先 TS/JS（本仓库自身即 TS）+ JSON/YAML/Markdown 结构层，语言资产按需增量） |
| Q19 | Cypher 查询引擎移植深度：全语法子集（C 源项目 cypher/ 模块）vs 先 search_graph 结构化查询后 Cypher | ⚠ EP-CB2 前裁决（建议：结构化查询先行，Cypher 子集随 EP-CB3 落地） |

---

# 第五部分：代码智能插件 @flowforge/plugin-codebase 移植规划（EP-CB）

## 16. 源项目对照与移植定位（operator 2026-09-07 第二指令）

> 指令原文要点：codebase-memory-mcp 作为重要插件高优先级全量移植，命名 `@flowforge/plugin-codebase`；
> 除了作为 dev 的基础（代码索引和文档生成）外，也是其他任何上层模块和其他业务的快速索引基础；
> 参考优秀框架发挥其他用途；项目中已有类似框架则融合到一起。

### 16.1 源项目架构解构（D:\software\fl\ex\codebase-memory-mcp）

纯 C 实现（197 文件 / 144,380 行），tree-sitter 语法分析 + 知识图谱 + SQLite 存储，原生可执行 MCP 服务器。
核心模块（src/ 下 15 个目录）：

| C 模块 | 职责 | TS 移植落点（plugin-codebase 内） |
|---|---|---|
| foundation | arena 内存池/兼容层（跨平台 fs/regex/thread） | 不移植（TS 运行时天然提供） |
| graph_buffer | 索引期内存图缓冲 → SQLite dump | `graph-model.ts` + `store.ts`（RAM-first 设计保留：先内存聚合再批量落盘） |
| store | SQLite 存储 + BM25 全文 + 向量 + 标签计数 | `store.ts`（node:sqlite 内置，FTS5 对齐 BM25） |
| pipeline | tree-sitter 抽取管线 + LSP 解析 | `pipeline/`（EP-CB1 语言抽取 + EP-CB4 LSP 融合） |
| semantic | 语义边（相似度/语义查询） | `semantic.ts`（EP-CB4） |
| simhash | 相似度去重边 | `simhash.ts`（EP-CB4） |
| cypher | Cypher 查询解析/执行引擎 | `cypher/`（EP-CB3） |
| traces | ingest_traces 轨迹摄取 | `traces.ts`（EP-CB3） |
| git | 变更检测（detect_changes） | `git.ts`（EP-CB2） |
| discover | 文件发现（gitignore/.cbmignore 感知） | `discover.ts`（EP-CB0） |
| watcher | 文件监视增量索引 | `watcher.ts`（EP-CB3） |
| daemon | 后台守护进程模式 | cordis 插件生命周期等价（不单独移植） |
| mcp | JSON-RPC MCP 服务器 + 工具注册 + 索引监督进程 | `tools/`（挂接 flowforge mcp 工具体系，形态对齐 tool-lsp） |
| cli | 命令行入口 | `bin/ff_codebase.mjs`（ff_ 命令族，对齐 plugin-dev） |
| ui | 3D 图可视化 web 服务 | EP2 前端融合（Q17，非核心链路） |

**MCP 工具面（17 个，全量移植对象）**：index_repository / search_graph / query_graph / trace_path /
get_code_snippet / get_file_outline / get_graph_schema / compare_graphs / get_architecture /
search_code / list_projects / delete_project / index_status / check_index_coverage / detect_changes /
manage_adr / ingest_traces。

**图谱模型（移植核心，数值与语义照搬）**：
- 节点标签：Function / Method / Class / Interface / Module / File / Folder / Route / Variable / Resource（K8s）/ Channel…
- 边类型：CALLS / USAGE / CALL_REFERENCE / INHERITS / IMPLEMENTS / CONTAINS_FOLDER / CONTAINS_FILE / IMPORTS / CROSS_HTTP_CALLS / CROSS_ASYNC_CALLS / CROSS_CHANNEL…
- 节点属性：complexity（圈复杂度）/ cognitive / loop_count / loop_depth / transitive_loop_depth /
  recursive / linear_scan_in_loop / alloc_in_loop / recursion_in_loop / unguarded_recursion /
  param_count / max_access_depth / signature / docstring / return_type / is_test / lines
- 索引模式：full（全文件+相似度/语义边）/ moderate（过滤文件+语义）/ fast（过滤文件，无语义）/
  cross-repo-intelligence（跨项目路由/信道匹配建 CROSS_* 边）
- 覆盖率诚实契约：skipped / parse_partial / excluded / not_indexed_files 明确上报，"缺席≠完整"

### 16.2 融合决策：项目内既有能力

| 既有能力 | 融合方式 |
|---|---|
| `packages/lsp`（@flowforge/lsp：ctx.lsp seam + @flowforge/tool-lsp 模型工具） | EP-CB4 对接：Hybrid LSP 思想落地——图谱的 CALL/USAGE 语义解析经 ctx.lsp 增强（Q15） |
| `packages/storage`（storage hub：node:sqlite 后端 @flowforge/storage-sqlite） | 存储驱动对齐：plugin-codebase 直接用 node:sqlite（同 storage-sqlite 驱动选型），图 schema 独立演进不并入 kv hub |
| `packages/mcp`（mcp-client） | 工具暴露形态对齐 tool-lsp 模式（模型面只读工具 + capability seam） |
| `@flowforge/plugin-dev` | plugin-codebase 是其"基础"：文档生成/代码索引为 dev 流程的 design/plan 阶段供料（EP-CB2 文档生成器对接 specs/plans 模板） |

### 16.3 移植策略：全量目标 + 分批交付（dev 打法复用）

全量移植 14.4 万行 C 不可能单批完成，按 dev 插件 EP0 打法分批：

| 批次 | 内容 | 核心交付 |
|---|---|---|
| EP-CB0 | 插件骨架 + 图谱域模型 + node:sqlite 存储引擎 + 结构层索引（Project→Folder→File→Module 树）+ 结构化查询（search/label/degree/分页契约）+ ff_codebase CLI + get_graph_schema/index_status/list_projects 工具 + FTS5 BM25 搜索 | 可对本仓库跑通"索引→查询→schema"闭环 |
| EP-CB1 | tree-sitter 解析管线（Q14 依赖裁决后）+ 符号级抽取（Function/Class/Method/Route/Variable + 复杂度属性族）+ CALLS/INHERITS/IMPLEMENTS/CONTAINS 边 + get_file_outline/get_code_snippet | 本仓库 TS/JS 符号图谱可用 |
| EP-CB2 | 工具面补全（trace_path/search_code/check_index_coverage/detect_changes/delete_project/compare_graphs/get_architecture/manage_adr）+ 文档生成器（对接 plugin-dev specs/plans 模板）+ git 变更检测 | dev 插件可消费的文档生成链路 |
| EP-CB3 | Cypher 查询引擎子集（Q19）+ ingest_traces + watcher 增量索引 + 持久化工件（压缩 artifact 团队共享） | 复杂多跳查询可用 |
| EP-CB4 | 语义层（semantic edges + simhash 相似度 + 向量检索）+ LSP 融合（Q15）+ cross-repo-intelligence 跨仓库智能 | Hybrid LSP 全量对齐 |

### 16.4 关键工程决策（移植即重构，非逐行翻译）

1. **语言运行时**：C 原生二进制 → TS 插件（cordis 形态，对齐 plugin-dev 包模板）；foundation/compat 层全部不移植（TS 运行时天然跨平台）。
2. **存储**：C 的 SQLite + FTS5 + 内存图缓冲 → `node:sqlite`（Node ≥22.5 内置，零外部依赖，与 storage-sqlite 同选型）；RAM-first 管线保留（先内存聚合再批量事务落盘）。
3. **索引监督进程**（C：MCP 服务端 spawn `cli --index-worker` 子进程防内存膨胀）→ TS 内采用同一模式：CLI 子命令 `ff_codebase index` 独立进程跑索引，插件/工具侧只读消费（隔离重活，崩不倒宿主）。
4. **覆盖率诚实契约照搬**：skipped/parse_partial/excluded 三态上报与"缺席≠完整"原则写入 EP-CB0 的存储与工具层。
5. **测试铁律适配**：T1-T9 不 Mock 原则对索引管线天然适配（真实文件真实解析）；测试语料用仓库真实结构 + fixture 微型仓库。
6. **命名契约**：包名 `@flowforge/plugin-codebase`、CLI `ff_codebase`（ff_ 命令族成员）、目录 `packages/plugins/codebase`、数据落点 `.flowforge/`（Q16）。

### 16.5 交付方式

EP-CB 各批次全部走 plugin-dev 七阶段流程（§11.5）：设计文档（specs/）→ 计划文档（plans/，No-Placeholder 校验）→ TDD 实现 → 两阶段审查（reviews/）→ 验证证据（verifications/）→ mgr sync PR。详细任务清单见 `docs/refactor/34-stage-ep-cb-plugin-codebase.md`（本部分为总览，该文件为唯一任务依据）。

---

> Agent Notes：本文件为三源对照与工程化规划的**任务登记单一事实来源**（2026-09-07 第二轮更新）。后续每完成一个批次：①在 §13 对应条目标 ✅ + PR 号；②EP0 完成后所有批次必须走 forgeProcess 七阶段流程（§11.5）；③全部 P0/P1 闭环、EP4 收尾后，本文件归档并在 `10-stage-map.md` 体现终态。
