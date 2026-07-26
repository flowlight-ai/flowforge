# Web 界面合并设计文档 (spec)

> 版本: V1.0 | 日期: 2026-07-25 | 状态: 待审核

## 1. 项目目标

将三个 Web 界面合并为一个统一的 FlowForge Web 应用：

| 来源 | 地址 | 技术 | 角色 |
|------|------|------|------|
| FlowForge 老界面 | localhost:5174 | Next.js 14 + TS | **合并主体** (保留框架和已有页面) |
| clowder-ai | — | Next.js + TS | **组件来源** (群聊+设置组件) |
| 新简化版 | localhost:8765 | 原生 HTML/JS | **功能来源** (群聊后端API) |

**合并后**: 单一 Next.js 应用运行在 5174，包含全部功能。

## 2. 现状分析

### 2.1 FlowForge 老界面 (5174) — 合并主体

**页面结构**:
```
/                    → 仪表盘 (系统状态、任务概览)
/tasks               → 任务列表
/review              → 审核中心
/review/[taskId]     → 单任务审核
/solo                → Helm Studio (核心工作台)
/solo/[taskId]       → Solo 任务回放
/admin/models        → 模型配置
/admin/agents        → Agent 管理
/admin/settings      → 系统设置
/logs                → 日志查看
```

**3 种聊天模式** (在 HelmLayout 的 ModeSelector 中):
1. **普通 (normal)**: 选择工作流 → 执行
2. **Helm**: AI 自主规划执行，中间可审核
3. **全自动 (auto)**: 全自动执行所有任务

**核心组件** (40+):
- 布局: ShellWrapper, Sidebar, ActivityBar, HelmLayout
- 聊天: ChatStream, ChatInput, ChatPrimitives, MarkdownRenderer
- 任务: TaskListPanel, TaskSidebar, HelmCreateDialog
- 执行: ExecutionStream, StepGroup, StepProgressTimeline, StepSummary
- 工具: ToolCallCard, LLMCallCard, ThinkingBlock, IntermediateBlock
- 面板: WorkspacePanel, MarkdownPanel, DiffViewer, TerminalPanel, BrowserPreview
- 编辑: HelmEditor, PlanPanel, SpecPanel, ArtifactPanel, DetailPanel
- 配置: SettingsPanel, MCPConfigPanel, ModeSelector, WorkflowSelector
- 高级: AgentOrchestrator, DynamicGraph, FigmaImporter, VoiceInput, WorktreePanel

**API 客户端**: `lib/flowforge-client.ts` — 封装 get/post/put/del，调用 FlowForge 8000 后端

### 2.2 clowder-ai — 组件来源

**设置页面结构** (SettingsShell + 14 个 section):
```
/settings?s=members     → 成员管理 (名册、协作对象、编排顺序)
/settings?s=profiles    → 猫猫画像 (能力画像、路由信号、来源追溯)
/settings?s=accounts    → 账户与密钥 (模型账户、凭据、执行身份)
/settings?s=im          → IM 对接 (飞书、钉钉、企微)
/settings?s=skills      → Skill 管理 (技能市场、安装计划)
/settings?s=mcp         → MCP 管理 (MCP 服务、工具目录)
/settings?s=plugins     → 插件集成 (插件状态、外部集成)
/settings?s=marketplace → 能力市场 (搜索安装能力包)
/settings?s=concierge   → 猫猫球 (形象、人设、值班猫)
/settings?s=voice       → 语音管理 (语音IO、术语表、TTS)
/settings?s=system      → 系统配置 (环境选项、运行时开关)
/settings?s=rules       → 协作与规则 (会话生命周期、注入体系)
/settings?s=notify      → 通知 (推送订阅、提醒策略)
/settings?s=ops         → 运维监控 (服务健康、命令工具)
```

**Hub 管理组件** (20+):
- HubAccountsTab, HubAgentSessionsTab, HubCatEditor
- HubCommandsTab, HubPermissionsTab, HubToolUsageTab
- HubQuotaBoardTab, HubGovernanceTab, HubEvalTab
- HubConnectorConfigTab, HubRoutingPolicyTab
- HubRuntimeSessionsTab, HubObservabilityTab, HubObservabilityOverview
- HubEnvFilesTab, HubLeaderboardTab, HubListModal
- HubMemberOverviewCard, HubEvalVerdictCard, HubEvalFrictionSections
- HubCoCreatorEditor, HubCallbackAuthPanel

**群聊组件**:
- GroupChatPanel — 群聊主面板
- AgentSelector — 灵智体选择器
- RoleAssignmentPanel — 角色分配面板 (primary/reviewer/tester)
- MultiAgentVisualization — 多Agent协作可视化
- useAgentMessages — Agent消息管理 Hook
- useChatCommands — 聊天命令 Hook
- useSendMessage — 消息发送 Hook
- chatStore — 聊天状态管理

### 2.3 新简化版 (8765) — 功能来源

**后端 API 端点** (app.py):
```
GET  /api/agents           → 5个灵智体列表
GET  /api/messages         → 消息历史
POST /api/chat             → 发送消息 → 灵智体响应
WS   /ws                   → 实时消息流
POST /api/verify/t7        → T7 LLM审核 (需从UI移除)
GET  /api/verify/t8        → T8 DOM验证 (需从UI移除)
GET  /api/context          → 多轮上下文
POST /api/push_back        → push back协议
GET  /api/bridge/status    → LLM Bridge状态
GET  /api/settings/llm     → LLM配置
GET  /api/settings/runtime → 运行时参数
GET  /api/tasks            → 任务列表
GET  /api/dashboard        → 看板数据
GET  /api/workflows        → 工作流列表
GET  /metrics              → Prometheus指标
```

## 3. 合并架构设计

### 3.1 总体架构

```
FlowForge Web (Next.js, localhost:5174)
├── 合并主体: 保留全部已有页面和组件
├── 新增群聊: 作为第4种模式集成到 HelmLayout
├── 合并设置: clowder-ai 设置组件移植到 /admin/*
├── 后端统一: 群聊API合并到 FlowForge 8000 后端
└── 移除T7/T8: 从用户界面移除，保留为开发者测试
```

### 3.2 聊天模式融合设计

**ModeSelector 扩展** (4种模式):

| 模式 | 标识 | 颜色 | 描述 | 数据源 |
|------|------|------|------|--------|
| 普通 | normal | bg-blue-600 | 选择工作流执行 | FlowForge 原有 |
| Helm | helm | bg-purple-600 | AI自主规划执行 | FlowForge 原有 |
| 全自动 | auto | bg-rose-600 | 全自动执行 | FlowForge 原有 |
| **群聊** | **council** | **bg-emerald-600** | **5灵智体协作群聊** | **新增 (8765功能)** |

**群聊模式 UI 布局** (复用 HelmLayout 框架):
```
┌─────────────────────────────────────────────────┐
│ ActivityBar | Sidebar (任务/灵智体/工作流)      │
├──────────┬──────────────────────────┬───────────┤
│ TaskList │  GroupChatPanel          │ AgentPanel│
│ Panel    │  ┌─────────────────────┐ │ ┌───────┐ │
│          │  │ 消息流 (多Agent并排) │ │ │灵智体 │ │
│          │  │ 文心: ...            │ │ │选择器 │ │
│          │  │ 梵高: ...            │ │ │       │ │
│          │  │ 达芬奇: ...          │ │ │角色   │ │
│          │  └─────────────────────┘ │ │分配   │ │
│          │  ┌─────────────────────┐ │ │       │ │
│          │  │ ChatInput (@mention)│ │ │可视化 │ │
│          │  └─────────────────────┘ │ └───────┘ │
├──────────┴──────────────────────────┴───────────┤
│ ModeSelector: 普通 | Helm | 全自动 | 群聊       │
└─────────────────────────────────────────────────┘
```

### 3.3 设置页面融合设计

**统一管理导航** (修改 layout.tsx 的 navSections):

```
主页:
  仪表盘 (/)

任务:
  任务列表 (/tasks)
  审核中心 (/review)

工作:
  Helm Studio (/solo)
  群聊频道 (/council)  ← 新增

管理:
  ├ 灵智体管理 (/admin/agents)         ← 合并 agents + members + profiles + concierge
  ├ Provider配置 (/admin/providers)    ← 合并 models + accounts
  ├ 系统设置 (/admin/settings)         ← 合并 settings + system + rules
  ├ 插件管理 (/admin/plugins)          ← 合并 plugins + marketplace + skills
  ├ MCP管理 (/admin/mcp)              ← 合并 MCPConfigPanel + mcp
  ├ 路由策略 (/admin/routing)          ← 新增 (routing + connector)
  ├ 权限管理 (/admin/permissions)      ← 新增
  ├ 治理中心 (/admin/governance)       ← 新增
  ├ 配额看板 (/admin/quotas)           ← 新增
  ├ 可观测性 (/admin/observability)    ← 合并 logs + ops + observability
  ├ IM对接 (/admin/im)                ← 新增
  ├ 环境文件 (/admin/env)              ← 新增
  ├ 工具统计 (/admin/tools)            ← 新增
  ├ 共创管理 (/admin/co-creators)      ← 新增
  └ 通知设置 (/admin/notify)           ← 新增
```

### 3.4 功能重复融合决策矩阵

| # | 功能 | FlowForge现有 | clowder-ai现有 | 融合方案 | 优先级 |
|---|------|-------------|---------------|---------|--------|
| F1 | 模型/Provider | /admin/models | accounts section | **合并** → /admin/providers: 统一管理OpenRoute providers、API keys、模型列表、健康检查 | P0 |
| F2 | Agent管理 | /admin/agents | members + profiles + concierge | **合并** → /admin/agents: 3个Tab(名册/画像/人设)，增加会话管理子页签 | P0 |
| F3 | 系统设置 | /admin/settings | system + rules | **合并** → /admin/settings: 2个Tab(系统配置/协作规则) | P0 |
| F4 | 审核评估 | /review | HubEvalTab + HubEvalVerdictCard | **增强** → /review: 增加评估判决卡片和摩擦分析视图 | P1 |
| F5 | 日志/可观测 | /logs | ops + HubObservabilityTab | **合并** → /admin/observability: 概览+详情布局 | P1 |
| F6 | MCP配置 | MCPConfigPanel | mcp section | **合并** → /admin/mcp: 统一MCP服务管理 | P1 |
| F7 | 插件 | 无 | plugins + marketplace | **新增** → /admin/plugins: 插件状态+市场安装 | P2 |
| F8 | 权限 | 无 | HubPermissionsTab | **新增** → /admin/permissions | P2 |
| F9 | 治理 | 无 | HubGovernanceTab | **新增** → /admin/governance | P2 |
| F10 | 配额 | 无 | HubQuotaBoardTab | **新增** → /admin/quotas | P2 |
| F11 | 路由策略 | 无 | HubRoutingPolicyTab + HubConnectorConfigTab | **新增** → /admin/routing | P2 |
| F12 | IM对接 | 无 | im section | **新增** → /admin/im | P3 |
| F13 | 语音 | VoiceInput | voice section | **合并** → VoiceInput组件增强 | P3 |
| F14 | 环境文件 | 无 | HubEnvFilesTab | **新增** → /admin/env | P3 |
| F15 | 工具统计 | 无 | HubToolUsageTab | **新增** → /admin/tools | P3 |
| F16 | 共创 | 无 | HubCoCreatorEditor | **新增** → /admin/co-creators | P3 |
| F17 | 通知 | 无 | notify section | **新增** → /admin/notify | P3 |
| F18 | 排行榜 | 无 | HubLeaderboardTab | **新增** → 集成到仪表盘 | P3 |

## 4. 实施计划

### Phase 1: 群聊模式合并 (P0)

**目标**: 将8765群聊功能作为第4种模式集成到5174

**任务清单**:
1. 修改 `ModeSelector.tsx` — 添加 `council` 模式
2. 创建 `components/helm/CouncilChatPanel.tsx` — 群聊主面板
3. 创建 `components/helm/ForgekinSelector.tsx` — 灵智体选择器 (参考 clowder-ai AgentSelector)
4. 创建 `components/helm/RoleAssignmentPanel.tsx` — 角色分配 (参考 clowder-ai)
5. 修改 `HelmLayout.tsx` — 当 mode=council 时渲染群聊面板
6. 创建 `app/council/page.tsx` — 独立群聊页面入口
7. 修改 `layout.tsx` — 导航增加"群聊频道"
8. 创建 `hooks/useCouncilChat.ts` — 群聊 Hook (调用 8000 后端 API)
9. 修改 FlowForge 8000 后端 — 添加群聊 API 端点 (从8765 app.py 移植)
10. 创建 `lib/council-types.ts` — 群聊类型定义

**API 集成** (群聊后端合并到 FlowForge 8000):
```
GET  /api/v1/forgemind/council/agents      → 灵智体列表
GET  /api/v1/forgemind/council/messages    → 消息历史
POST /api/v1/forgemind/council/chat        → 发送消息
WS   /api/v1/forgemind/council/ws          → 实时消息流
GET  /api/v1/forgemind/council/context     → 多轮上下文
GET  /api/v1/forgemind/council/bridge      → LLM Bridge状态
```

### Phase 2: 设置页面合并 (P0-P2)

**目标**: 将 clowder-ai 设置组件移植并融合到 FlowForge /admin/*

**任务清单** (按优先级):
1. **P0**: 创建 `/admin/providers` — 合并模型配置+账户密钥
2. **P0**: 重构 `/admin/agents` — 合并Agent管理+成员+画像+人设
3. **P0**: 重构 `/admin/settings` — 合并系统设置+协作规则
4. **P1**: 创建 `/admin/observability` — 合并日志+运维监控
5. **P1**: 增强 `/review` — 增加评估判决卡片
6. **P1**: 创建 `/admin/mcp` — 合并MCP配置
7. **P2**: 创建 `/admin/plugins` — 插件管理+市场
8. **P2**: 创建 `/admin/permissions` — 权限管理
9. **P2**: 创建 `/admin/governance` — 治理中心
10. **P2**: 创建 `/admin/quotas` — 配额看板
11. **P2**: 创建 `/admin/routing` — 路由策略+连接器
12. **P3**: 创建 `/admin/im`, `/admin/env`, `/admin/tools`, `/admin/co-creators`, `/admin/notify`
13. 修改 `layout.tsx` — 更新全部导航结构

### Phase 3: T7/T8移除 + 群聊设计优化 (P0)

**目标**: 移除用户界面中的T7/T8测试工具，优化群聊设计

**任务清单**:
1. 移除8765界面中的"验证(Ctrl+3)"活动栏按钮
2. 移除8765界面中的T7 LLM Audit面板
3. 移除8765界面中的T8 DOM Validation面板
4. **保留**消息气泡中的T7徽章 (质量证明，非测试工具)
5. 参考clowder-ai GroupChatPanel优化群聊UI:
   - 多Agent并排展示，每个有头像/名称/角色标签
   - Agent响应时间线展示
   - @mention输入框增强
   - 灵智体能量条/状态指示器
6. 群聊配置面板参考clowder-ai:
   - 灵智体选择器 (可勾选参与)
   - 角色分配 (primary/reviewer/tester)
   - 协作可视化图

### Phase 4: T7/T8测试验证 (P0)

**目标**: 合并完成后使用T7/T8测试验证

**T7测试** (LLM审核LLM产出):
- 验证群聊中灵智体响应携带 llm_meta (T1)
- 验证主响应携带 t7_badge (T7)
- 验证I9: 审计链与主链不同
- 验证内容非模板生成

**T8测试** (DOM验证):
- 验证群聊页面DOM结构正确
- 验证4种模式切换正常
- 验证设置页面Tab切换正常
- 验证导航链接可达
- 验证T7/T8测试工具已从UI移除

## 5. 文件结构 (合并后)

```
flowforge/web/src/
├── app/
│   ├── layout.tsx              ← 修改: 更新navSections
│   ├── page.tsx                ← 仪表盘
│   ├── tasks/page.tsx          ← 任务列表
│   ├── review/page.tsx         ← 审核中心 (增强)
│   ├── review/[taskId]/page.tsx
│   ├── solo/page.tsx           ← Helm Studio
│   ├── solo/[taskId]/page.tsx
│   ├── council/page.tsx        ← 新增: 群聊频道
│   └── admin/
│       ├── providers/page.tsx  ← 新增: Provider配置 (合并models+accounts)
│       ├── agents/page.tsx     ← 修改: Agent管理 (合并members+profiles+concierge)
│       ├── settings/page.tsx   ← 修改: 系统设置 (合并system+rules)
│       ├── mcp/page.tsx        ← 新增: MCP管理
│       ├── plugins/page.tsx    ← 新增: 插件管理
│       ├── routing/page.tsx    ← 新增: 路由策略
│       ├── permissions/page.tsx← 新增: 权限管理
│       ├── governance/page.tsx ← 新增: 治理中心
│       ├── quotas/page.tsx     ← 新增: 配额看板
│       ├── observability/page.tsx ← 新增: 可观测性 (合并logs+ops)
│       ├── im/page.tsx         ← 新增: IM对接
│       ├── env/page.tsx        ← 新增: 环境文件
│       ├── tools/page.tsx      ← 新增: 工具统计
│       ├── co-creators/page.tsx← 新增: 共创管理
│       └── notify/page.tsx     ← 新增: 通知设置
├── components/
│   ├── helm/
│   │   ├── ModeSelector.tsx        ← 修改: 添加council模式
│   │   ├── HelmLayout.tsx          ← 修改: 支持council模式渲染
│   │   ├── CouncilChatPanel.tsx    ← 新增: 群聊主面板
│   │   ├── ForgekinSelector.tsx    ← 新增: 灵智体选择器
│   │   ├── RoleAssignmentPanel.tsx ← 新增: 角色分配面板
│   │   ├── CouncilVisualization.tsx← 新增: 协作可视化
│   │   └── ... (原有组件保留)
│   ├── settings/                   ← 新增: 从clowder-ai移植
│   │   ├── SettingsShell.tsx
│   │   ├── SettingsNav.tsx
│   │   ├── SettingsContent.tsx
│   │   └── settings-nav-config.ts
│   ├── hub/                        ← 新增: 从clowder-ai移植
│   │   ├── HubAccountsTab.tsx
│   │   ├── HubAgentSessionsTab.tsx
│   │   ├── HubPermissionsTab.tsx
│   │   ├── HubGovernanceTab.tsx
│   │   ├── HubQuotaBoardTab.tsx
│   │   ├── HubEvalTab.tsx
│   │   ├── HubObservabilityTab.tsx
│   │   ├── HubRoutingPolicyTab.tsx
│   │   └── ...
│   └── ... (原有组件保留)
├── hooks/
│   ├── useCouncilChat.ts       ← 新增: 群聊Hook
│   ├── useApi.ts               ← 原有
│   └── ...
├── lib/
│   ├── council-types.ts        ← 新增: 群聊类型
│   ├── flowforge-client.ts     ← 修改: 增加群聊API
│   └── ...
└── ...
```

## 6. 后端API合并

将8765的群聊API合并到FlowForge 8000后端:

**新增端点** (在 `flowforge/app/api/endpoints/` 中):
```
forgemind_council.py:
  GET  /api/v1/forgemind/council/agents
  GET  /api/v1/forgemind/council/messages
  POST /api/v1/forgemind/council/chat
  WS   /api/v1/forgemind/council/ws
  GET  /api/v1/forgemind/council/context
  GET  /api/v1/forgemind/council/bridge
  GET  /api/v1/forgemind/council/settings/llm
  PUT  /api/v1/forgemind/council/settings/llm
```

**LLM Bridge 移植**: 将 `flowlight-ai/flowforge/flowforge/web/llm_bridge.py` 移植到 `flowforge/llm/council_bridge.py`

## 7. 验收标准

1. **4种模式可用**: 普通/Helm/全自动/群聊 均可正常切换和使用
2. **群聊功能完整**: 5个灵智体可响应、T7审计自动执行、消息实时推送
3. **设置页面完整**: 18个管理页面全部可达且功能正常
4. **T7/T8不可见**: 用户界面中无T7/T8测试工具入口
5. **T7测试通过**: 群聊响应携带llm_meta和t7_badge，I9满足
6. **T8测试通过**: DOM结构正确，页面切换正常，导航链接可达
7. **单端口运行**: 全部功能在 localhost:5174 可用
