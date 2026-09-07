# 三项目深度对照审查 — 遗漏项与问题清单（review_code）

> 审查人：sherlock（AI 编码工具）
> 审查对象：flowforge TS 重构现状（`packages/`+`apps/`+`web/`）↔ `ex/deepseek-harness`（dsh）↔ `ex/clowder-ai`（cat-cafe）
> 审查日期：2026-09-07（基于主干 HEAD，含批次 1-55 已合入交付）
> 审查方法：三方目录级全量 diff（dsh `packages/` 264 包、clowder `packages/`+`api/src/domains|routes|services|infrastructure|skills|utils|scripts`、flowforge `packages/` 283 包）+ 关键文件抽样核对 + `02-source-crosswalk.md` 文档对账。
> 结论：**主干完成度高（阶段 0-7 绝大多数条目已交付且有测试），但对照三源仍发现 5 类共 60+ 项遗漏/问题**：dsh 侧 37 项（§3）、clowder 侧 22 项（§4）、依赖合规 1 项（✅ 通过，§5）、文档状态漂移 7 项（§6）、阶段 8 前端缺口 4 项证据（§7）。其中 **P0 级 16 项**建议尽快补录进 `10-stage-map.md` 功能全集矩阵（§9），另有 6 个方向性问题需用户裁决（§10）。

---

## 1. 审查范围

- **flowforge TS 现状**：`packages/`（61 域分组、283 包）、`vendor/`（9 库）、`apps/cli`、`web/`（Next.js，批次 56-59 进行中）。
- **dsh 参照**：`packages/`（264 包，含 `client/*` 47 个 UI 包与 `experimental/*` 9 包）、`apps/`、`vendor/`、`python/`、`native/`、`website/`、`snapshots/`、`patches/`、`examples/`。
- **clowder 参照**：`packages/{api,finance,mcp-server,shared,web}`、`api/src/{domains,routes,services,infrastructure,skills,marketplace,mcp,plugins,scripts,types,utils}`、`cat-cafe-skills/`、`sop-definitions/`、`desktop/`、`assets/`。
- **文档对账**：`docs/refactor/00-overview.md`、`10-stage-map.md`（§3 矩阵 D/C/F 三源）、`02-source-crosswalk.md`（file→file 锚点）。

## 2. 总体结论

1. 已登记矩阵（D1-D44 / C1-C42 / F1-F44）的绝大多数条目**真实交付**：目录结构、测试文件、`ctx.*` 服务挂载与 crosswalk 记录一致，git 历史可溯（PR #86-#147）。
2. **"功能全集 = 三源并集"的目标尚未闭环**：本次目录级 diff 发现一批从未进入矩阵的包/域（dsh `client/*`、`experimental/*`、`webhook/*`、`session-format/*` 等；clowder `mcp-server`、`signal-intake`、`messaging`、`connectors`、`cats/services` 8 个子域等），违反 D10"三源能力全部登记在案，禁止遗漏"的自设要求。
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
| A11 | `experimental/agent-team`（+ `agent-team-profile`/`agent-team-web-profile`/`client-ui-agent-team`/`tool-agent-team`，5 包） | 多智能体团队协作框架（mailbox/journal/lifecycle/activity/invariant） | P1 | **需裁决**（§10-1） |
| A12 | `experimental/inspector` | 调试检查器 | P2 | stretch |
| A13 | `experimental/code-runtime-python` | Python 代码运行时（worker） | P1 | 与 S6 相关，需裁决 |
| A14 | `experimental/webworker-packer` + `webworker-runtime` | WebWorker 打包与运行时 | P2 | stretch |
| A15 | `llm/deepseek-llm-api-extensions` | DeepSeek LLM API 扩展（对齐上游 API 特性面） | P1 | `packages/llm/` |
| A16 | `llm/plugin-package-inventory-deepseek` | DeepSeek 插件包清单 | P1 | 同上 |
| A17 | `session/session-format` + `session-format-catalog` + `session-format-v0-to-v1` + `session-format-v1-to-v2` | 会话格式版本化与迁移链（4 包）——会话持久化兼容的关键缺口 | **P0** | `packages/session/` |
| A18 | `session/session-log-deepseek` | 会话日志 L0 检索桥（debug 包的 nativeL0Fetcher 对应物） | P1 | 同上 |
| A19 | `session/session-turn-outline` | 会话轮次大纲 | P1 | 同上 |
| A20 | `session-query/session-log-export` | 会话日志导出（crosswalk L41 来源已列出、落点遗漏） | **P0** | `packages/session-query/` |
| A21 | `subprocess/win32-process` | Windows 进程管理工具（本仓主力平台为 Windows） | P1 | `packages/subprocess/` |
| A22 | `test-support/session-snapshot` | 会话快照测试支持 | P1 | `packages/test-support/` |
| A23 | `util/crypto` | 加密工具 | P1 | `packages/util/` |
| A24 | `util/deque` | 双端队列（`cats/invocation` 已自实现等价 queue，存在重复实现风险） | P2 | 统一收敛 |
| A25 | `util/http-proxy` | HTTP 代理工具（`cats-preview` 已局部实现 PreviewProxyServer） | P1 | 收敛统一 |
| A26 | `util/time` | 时间工具 | P1 | `packages/util/` |
| A27 | `util/values` | 值工具 | P1 | 同上 |
| A28 | `util/workspace-path` | 工作区路径工具（`cats/workspace`/`cats/shared` 已局部实现） | P1 | 收敛统一 |
| A29 | `webhook/webhook` + `webhook-github` | Webhook 接收与 GitHub 事件分发 | **P0** | `packages/webhook/`（新组） |
| A30 | `host/directory-picker-auto` | 自动目录选择器 | P2 | `packages/host/` |
| A31 | `examples/acp-demo` + `examples/jsonrpc-demo` | ACP/JSON-RPC 示例 | P2 | `packages/examples/` |
| A32 | `client/*` 46 包 | dsh Web UI 组件层（ui-chat/ui-plan/ui-goal/ui-jobs/ui-schedule/ui-trajectory/ui-deliverables/ui-settings-* 等，仅 `client/connection` 已移植） | **P0** | 阶段 8 按**能力级**登记（§10-2） |
| A33 | `apps/web` | Vite 宿主（现行决策：融入 Next.js `web/`，非包级 vendor） | 已决 | 登记决策即可 |
| A34 | `python/`（sdk + sdk-runtime） | Python SDK 桥 | 已登记 | S6 stretch ⬜（矩阵已有） |
| A35 | `website/` | VitePress 文档站 | P2 | **需裁决**（§10-4） |
| A36 | `snapshots/` | 预期输出快照测试目录（acp/sdk/session/web 四域） | P1 | 测试基建，阶段 9 |
| A37 | `patches/` | 依赖补丁（`@yao-pkg/pkg`、`node-pty@1.2.0-beta.15`）；flowforge `pnpm-workspace.yaml` 无 `patchedDependencies` | P1 | Windows node-pty 路径需验证 |

## 4. 发现 B：clowder 侧遗漏（代码级确认未移植）

> 按 `packages/api/src/` 逐域 diff 确认；`routes/` 288 文件已由批次 55 做过语义 diff 并声明"其余平台面随阶段 8/9 按需对照"，此处仅列**整域缺失**项。

| # | 模块 | 职责 | 优先级 | 建议落点 |
|---|---|---|---|---|
| B1 | `packages/mcp-server` | **MCP 服务器**：canonical-tool-registry/tool-cutover/evidence/migration/bootstrap/cli 工具治理全家 + limb/memory/signals/collab/finance/audio server-toolsets + refresh-loop + protocol-server + json-schema-to-zod。flowforge 仅有 `mcp/mcp-client`，**服务器侧整包缺失** | **P0** | `packages/mcp/mcp-server` |
| B2 | `packages/finance` | 财经事实/频率数据域（配合 mcp-server finance toolset） | P1 | **需裁决**（§10-3） |
| B3 | `domains/signal-intake` | 信号准入域（25+ 文件）：SignalAdmission/RouteStore/MeetingIntake 全家/ASR 人物记忆队列/来源访问租约/LarkCliFeishuSourceResolver/ThreadDestinationAuthority + Redis stores | **P0** | `packages/cats/signal-intake` 或 `infrastructure/` |
| B4 | `domains/messaging` | Plugin Messaging 域（K-1/F288）：envelope/ledger/append-elements/event-stream/snapshot-capture/page-assembly/tokens + Redis Lua stores（append-lock/cursor/snapshot-state） | **P0** | `packages/chat/messaging` |
| B5 | `domains/github-signals` | GitHub 等待生命周期（WaitLifecycleService/baseline readers/predicate catalog/wait renderer）——C33 email 域仅移植了 wait-lifecycle **端口**，本体未移植 | **P0** | `packages/infrastructure/github-signals` |
| B6 | `domains/services` | 服务面板域：service-manifest/lifecycle/config/process-termination + environment-detector + recommendation-matrix + loopback-url | P1 | `packages/cats/services-panel` |
| B7 | `infrastructure/connectors` | **IM connector 框架本体**（25+ 文件）：ConnectorRouter/CommandLayer/MessageFormatter/PermissionStore/ThreadBindingStore/gateway-bootstrap/lifecycle/reload-subscriber + FeishuQrBindClient + telegram-token + GitHubRepoWebhookHandler + mention-parser + StreamingOutboundHook + InboundMessageDedup——S1 stretch 仅覆盖"通道 ports + mock"，**框架本体未登记** | **P0** | `packages/infrastructure/connectors`（S1 升格为完整能力） |
| B8 | `api/src/skills` | 技能治理：skill-manage/meta/mount-ops/query/sync-all/sync-config/sync-engine + drift-detector/drift-resolver——governance（C34b）含 skill-sync 语义但**未做逐文件 diff 验证** | P1 | diff 后并入 `forgekin/governance` 或独立包 |
| B9 | `api/src/utils`（49 文件） | cli-error-patterns/cli-format/cat-mention-handle/active-project-root/claude-bg-job-ownership/reaper/chatgpt-chat-url 等——F212/cli-diagnostics 部分已覆盖，其余未清点 | P1 | diff 清点后分域归位 |
| B10 | `api/src/scripts` | 运维脚本（backfill-usage-by-cat/migrate-signals/mint-agent-key/enable-negative-authorization 等） | P2 | 阶段 9/10 运维期 |
| B11 | `api/src/mcp` | MCP 拓扑同步（mcp-drift-detector/drift-resolver/sync-all/sync-engine）——与 `forgekin/capabilities` healCatMcpTopology 的覆盖关系未 diff | P1 | 验证后并入 `forgekin/capabilities` |
| B12 | `cats/services/context`（17 文件） | 会话上下文组装治理：ContextAssembler/governance-l0/IntentParser/MessageBundleCarrierResolver/message-bundle-quote-matching | **P0** | `packages/cats/context-assembly` |
| B13 | `cats/services/tool-usage`（8 文件） | 工具使用事件日志/归档/计数/normalize-mcp-tool-name/SkillLoadEventLog | P1 | `packages/cats/tool-usage` |
| B14 | `cats/services/runtime-session`（7 文件） | 外部运行时会话注册/RedisRuntimeSessionStore/SealReaper/CodexSessionReplacementProvenance | P1 | `packages/limb/runtime-session` |
| B15 | `cats/services/frustration`（4 文件） | 挫败检测（FrustrationDetector/retry-burst-detector/关键词） | P1 | `packages/cats/frustration` |
| B16 | `cats/services/cloud-bridge`（12 文件） | 云调用桥（cloud-invoke-bridge/return-binding/build-delta-payload/conversation-host-adapter） | P1 | `packages/cats/cloud-bridge` |
| B17 | `cats/services/first-run-quest`（3 文件） | 首次运行任务（client-detection/quest-blocks/quest-state）——区别于 C8 bootcamp | P1 | 并入 `packages/cats/bootcamp` 或独立 |
| B18 | `cats/services/collaboration` + `push` | reviewer-matcher / PushNotificationService（push 属 S2） | P2 | stretch |
| B19 | `cat-cafe-skills/`（20+ 技能包） | 技能**内容资产**（deep-research/expert-panel/cross-cat-handoff/debugging 等），非框架代码 | P1 | **需裁决**（§10-5） |
| B20 | `sop-definitions/` | SOP 定义内容（配合 F29 forgekin-sop 执行器） | P1 | `packages/forgekin/sop` 资产目录 |
| B21 | `assets/` | 音频/头像静态资源（audio-proxy/avatars 路由依赖） | P2 | 随 S2/平台路由 |
| B22 | `routes/` 平台面余量 | 批次 55 已声明"callback-*/config/debug 等平台面随阶段 8/9 按需对照"——需在阶段 9 收口清单中**强制复核** | P1 | 阶段 9 验收项 |

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

1. 仓库根目录存在 40+ **未跟踪**临时文件（`_api_probe.py`、`_create_pr_batch2.py`、`_vitest_full.log`、`debug.log`、`pr_body.txt` 等）——虽未入库（git ls-files 核实仅 `__init__.py`/`__main__.py` 被跟踪，属 Python 包标记），但应清理或补 `.gitignore` 规则，避免误提交。
2. `py.typed`/`__init__.py`/`__main__.py` 位于根目录——随阶段 11 Python 日落一并清理。
3. Python 遗留目录（`agents/`、`brain/`、`core/`、`llm/`、`loop/`、`forgemind/`、`evolution/`、`harness/`、`sop/`、`sdk.py`）完整保留——符合 D1 双栈共存策略 ✅（`forging/` 已删，F31 已 TS 化，符合预期）。

## 9. 处置建议：遗漏项分级汇总

- **P0（16 项，建议立即补录矩阵并排期）**：A1-A4、A8-A10、A17、A20、A29、A32、B1、B3、B4、B5、B7、B12。
- **P1（25 项）**：A5-A7、A11、A13、A15-A16、A18-A19、A21-A23、A25-A28、A36-A37、B2、B6、B8-B9、B11、B13-B17、B19-B20、B22。
- **P2（9 项）**：A12、A14、A24、A30-A31、A35、B10、B18、B21。
- **登记方式建议**：
  1. 在 `10-stage-map.md` §3.1/§3.2/§3.3 增设新编号（D45+ / C43+ / F45+），与 `02-source-crosswalk.md` 保持同源编号；
  2. P0 项分配至：阶段 3 补录（A1-A4、A20 控制器/bundle/导出）、阶段 8 前置（A32 能力清单 + T8 任务补条目）、阶段 2 补录（A8-A10）、新增批次插入当前进行中的阶段序列（B1/B3/B4/B5/B7/B12 建议作为"批次 56+"优先排期，先于阶段 8 收尾前完成 B1/B7 以支撑 mcp-server 与 IM 框架主线）；
  3. 每项补录需同步补 vitest（遵循 `04-code-standards.md` 测试铁律），并经 `./mgr sync` 走 PR（`docs(refactor): 补录三源对照遗漏项` + 对应 feat 批次）。

## 10. 需用户裁决的开放问题

1. **`experimental/agent-team` 5 包**（dsh 多智能体团队框架：mailbox/journal/lifecycle）：是否全量移植？它与 forgekin/swarm（F16 群聊编排）存在概念重叠，建议明确边界（agent-team = 同构 agent 组队执行；swarm = 跨厂商能力路由）后再决定移植或裁剪。
2. **dsh `client/*` 46 包策略**：现行决策是"能力级融入 Next.js `web/`"而非包级 vendor。需确认：阶段 8 任务清单是否按 dsh UI 能力逐项补齐登记（ui-chat/ui-jobs/ui-schedule/ui-goal/ui-plan/ui-trajectory/ui-deliverables/ui-settings-*/i18n(schema-form) 等），作为验收对照表？
3. **`packages/finance` + mcp-server finance toolset**：财经数据域是否属于 FlowForge 目标能力？若不要，B1 移植时应剔除 finance/audio toolset 子集。
4. **`website/` VitePress 文档站**：是否需要移植（当前 flowforge 文档全在 `docs/`，无独立网站）？
5. **`cat-cafe-skills/`（20+ 技能内容包）与 `sop-definitions/`**：内容资产是否随代码全量移植并改造为 Forgekin 品牌措辞（遵循 naming-contract P1 英文名优先）？
6. **signal-intake / messaging 的 Redis 重度依赖**：确认按既有 `infrastructure/redis-port`（KV 注入式）模式移植，真实 Redis 后端按凭据启用？

---

> Agent Notes：本文件为三源对照的**阶段性审查快照**（2026-09-07），不改动任何规范结论；后续每个批次交付时应回填 §3/§4 对应行的状态（沿用 ✅/🟦/⬜ 图例），并在全部 P0/P1 闭环后归档本文件至 §9 汇总表的"已完成"视图。
