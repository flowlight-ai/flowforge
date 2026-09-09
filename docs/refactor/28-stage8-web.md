# 阶段 8：前端融合（合并两前端）

> 目标：Next.js 前端同时保留 flowforge 页面与 clowder-ai 群聊交互，品牌词保留
> Forgekin/灵智，交互对齐 clowder（@mention 菜单、线程分支、终端面板）。

## 任务清单

- [x] T8.1 `packages/web` 基础：Next.js 14 + Tailwind + Zustand + socket.io-client 工程（批次56 2026-09-08：顶层 `web/` 原地并入根 workspace，前端包名 `@flowforge/web-app`，CI 分层 ts-ci/web-ci，流程实例 plugin-web-t81）
- [x] T8.2 群聊页：Threads 列表/线程详情/@mention 菜单/线程分支（对齐 clowder 交互）（2026-09-09 批次4 + `web/e2e/council.spec.ts` @mention 弹出/退出闭环）
- [x] T8.3 灵智档案页：Forgekin 列表/详情/档案编辑/审批（clowder cats 档案 UI + Forgekin 品牌）（`/admin/agents` 双 Tab + `/admin/agents/[forgekinId]` 5-Tab 详情页 + `HubForgekinEditor` 编辑抽屉 + `data-forgekin-*` 锚点；2026-09-09 增 `web/e2e/forgekin.spec.ts` 3 用例闭环）
- [x] T8.4 终端面板：xterm 组件（对接 limb 输出流）（批次57 seam `@flowforge/terminal-panel` + 2026-09-09 真实接入 `LiveTerminalPanel`：`@xterm/xterm` 适配 `TerminalViewLike` + `TerminalPanelController` 组合根 + workspace/exec 桥 + mock 回退，PR #169）
- [x] T8.5 管理台：保留 flowforge admin/*（agents/plugins/marketplace/mcp/models/observability/
      permissions/quotas/routing/settings/tools/governance）（`web/src/app/admin/*` 13 子页齐备，`e2e/routes.ts` 收录 admin 全路由冒烟）
- [x] T8.6 业务页：保留 council（群聊）/mission/memory/review/signals/solo/tasks（`/council` `/mission-hub` `/mission-control` `/memory/*` `/review` `/signals/*` `/solo` `/tasks` 齐备，`e2e/routes.ts` 收录全业务路由冒烟）
- [x] T8.7 市场页：marketplace / 技能包（`components/marketplace/Marketplace.tsx` —— 搜索/分类/排序/`/api/v1/marketplace/search` + install + `/admin/marketplace` 路由）
- [x] T8.8 Bootcamp 引导向导（对齐 clowder bootcamp wizard）（`components/helm/BootcampWizard.tsx` —— 12 阶段流程欢迎页 + `/api/v1/bootcamp/threads` 创建 + lead agent 选择 + 完成后跳 `/council/{threadId}`）
- [x] T8.9 深色主题与品牌（Forgekin 标识、灵智配色）（`theme-tokens.css` 亮/暗双层 CSS 语义 token + `ThemeProvider` light/dark/system 三态 + `[data-theme="dark"]` 覆盖）
- [x] T8.10 Playwright 冒烟：全页面路由可达、群聊收发、终端面板渲染（沿用 _browsertest 思路）（`e2e/routes-smoke.spec.ts` 34 静态路由 <400 + 错误页兜底 + expectedFrag 稳定渲染 + `e2e/council.spec.ts` 3 用例 + `e2e/forgekin.spec.ts` 3 用例；真实终端面板渲染 DOM 由 `LiveTerminalPanel`/`data-*` 承接）

## 验收标准

1. `pnpm dev` 启动后所有页面路由可访问。
2. 群聊页可实时收发消息、@mention 弹出灵智体菜单。
3. 终端面板可显示 mock CLI 输出。
4. 品牌词合规（P1 英文名 + 双标注规则，见 naming-contract）。
5. Python 旧版 `pytest` 回归全绿（旧版 web 不受影响）。

## dsh client/* 46 包能力级对照表（A32 / Q2 现行决策）

> 用途：阶段 8 验收对照表。按「UI 能力」逐项登记 dsh `client/*` UI 组件包 → 落点 T 任务 → 交付形态，前端融合时逐项勾选闭环。
> 登记于 **EP1-13**（2026-09-09），实际代码落实随 EP2 阶段 8 各批次推进（Q2 现行决策：能力级融入 Next.js）。

| UI 能力 | dsh `client/*` 包 | 落点 T 任务 | 交付形态 |
|---|---|---|---|
| 通讯-消息流 | `ui-chat` / `ui-conversation` / `ui-renderer` | T8.2 群聊页 | 对话列表/会话渲染（对齐 clowder 交互） |
| 通讯-反馈 | `ui-message-feedback` / `ui-user-questions` | T8.2 | 消息反馈/澄清提问交互 |
| 通讯-附件/输入 | `ui-attachment` / `ui-input-trigger` | T8.2 | 附件上传/输入触发 |
| 通讯-指令/审批 | `ui-commands` / `ui-approval` | T8.3 灵智档案 / T8.6 业务页 | 指令面板 / 审批流 UI |
| 会话-布局 | `ui-layout` / `ui-sidebar` / `ui-slots` | T8.1 基建 | 布局容器/侧栏/插槽装载 |
| 会话-主题/品牌 | `ui-theme` / `ui-brand-official` / `ui-primitives` | T8.9 深色主题与品牌 | 主题令牌/品牌资源/基础原语 |
| 规划/目标/作业/调度/轨迹 | `ui-plan` / `ui-goal` / `ui-jobs` / `ui-schedule` / `ui-trajectory` | T8.6 业务页 | 计划/目标/任务/调度/轨迹面板 |
| 生成物-交付/工作区/参考 | `ui-deliverables` / `ui-workspace` / `ui-reference` | T8.6 / T8.7 市场页 | 交付物/工作区/参考面板 |
| 设置-管理台 | `ui-settings` / `ui-settings-general` / `ui-settings-models` / `ui-settings-plugins` / `ui-settings-plugin-inventory` | T8.5 管理台 | 设置页与各子设置面板 |
| 选择-模型/子代理/技能/工具 | `ui-model-selection` / `ui-subagent` / `ui-skill` / `ui-tool` / `ui-agent-preset` / `ui-permission-presets` / `ui-directory-picker-browse` / `ui-directory-picker-native` | T8.5 / T8.3 | 模型/子代理/技能/工具/目录选择器 |
| 会话-状态 | `ui-session` | T8.2 / T8.6 | 会话状态/归档展示 |
| 工作流-运行 | `ui-workflow-run` | T8.6 | 工作流运行视图 |
| 基础设施-传输 | `connection` | T8.1（已落 `@flowforge/client-connection`） | 浏览器↔主机实时/HTTP 传输 |
| 基础设施-国际化 | `locale` | T8.1 | i18n 文案通道 |
| 基础设施-渲染框架 | `modules` / `schema-form` | T8.1 / T8.3 | 模块装载 / schema 表单渲染 |

> **边界**：括号中 `ui-settings-plugin-inventory` 等以能力级登记，具体组件按 T8 任务推进时分批细化；`connection` 已在 EP1 移植为 `@flowforge/client-connection`，本表仅作能力归属登记。

## 提交信息模板

```
feat(web): 前端融合(群聊/灵智档案/管理台) [sherlock]
```
