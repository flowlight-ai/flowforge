# FlowForge Web 融合设计文档 (Web Fusion Design Spec)

> **版本**：V3.0 | **日期**：2026-07-25 | **状态**：待 operator 审核
> **替代**：V2.0（已废弃）— V2.0 虽列出清单但缺乏对真实代码的深度重构方案，且未覆盖状态管理融合、样式系统融合、HelmLayout 1425 行代码重构、T8 测试根本性重构
> **依据**：
> - [design/naming-contract.md v2.0](../docs/design/naming-contract.md) — P0/P1/P2 三层命名体系（权威源）
> - [spec.md §2.3](../docs/spec.md) — 智能体分类规格
> - clowder-ai `packages/web/src/` 完整代码调研（含 AppShell / ActivityBar / ChatContainer / SettingsShell 等）
> - FlowForge `flowforge/web/src/` 真实代码调研（含 HelmLayout 1425 行、ShellWrapper、layout.tsx 等）
> - 用户反馈："T8 测试通过了但实际界面没法用" — T8 测试设计存在根本性缺陷

---

## §0 文档变更说明

### V2.0 严重问题（已废弃）

| # | 问题 | 根因 |
|---|------|------|
| Q1 | 未深度分析 HelmLayout 1425 行代码 | V2.0 只说"重构 HelmLayout"，未说明如何处理现有的 TaskListPanel/ChatStream/MarkdownPanel/WorkspacePanel 四列布局、Plan 状态、Diff 状态、Attachments 状态等 50+ 个 useState |
| Q2 | 未覆盖状态管理融合 | flowforge/web 完全没有 zustand stores，clowder-ai 有 chatStore/sidebarStore/gameStore/guideStore/taskStore/approvalHubStore 等 6+ stores，V2.0 未说明如何融合 |
| Q3 | 未覆盖样式系统融合 | clowder-ai layout.tsx 引入 11 个 vendor CSS 文件（theme-tokens/cat-persona-tokens/console-tokens/console-shell/console-controls 等），flowforge/web 只有 globals.css，V2.0 未说明迁移方案 |
| Q4 | 未覆盖 ConfirmProvider/ThemeProvider/ToastContainer 等基础组件 | clowder-ai RootLayout 有 7 个全局 Provider/组件，flowforge/web 只有 ShellConfigProvider，V2.0 只是简单提及 |
| Q5 | T8 测试增强方案不根本 | V2.0 增加了 14 个用例，但仍是"DOM 存在 + 选择器查询"思路，没有从"用户能否完成完整任务"角度设计，这就是 T8 通过但界面没法用的根本原因 |
| Q6 | 未考虑 ModeSelector 已存在但未被使用 | flowforge/web 的 ModeSelector.tsx 已定义 4 种模式，但 HelmLayout 根本没引入它，V2.0 未说明这一现状 |
| Q7 | 未考虑 navSections 中的旧入口 | layout.tsx 第 30 行有 `/council` 独立入口，第 38 行有 `/admin/models` 旧入口，V2.0 未说明清理方案 |

### V3.0 改进目标

1. **基于真实代码状态**：所有重构方案都基于对 HelmLayout 1425 行、ShellWrapper、layout.tsx 的逐行分析
2. **状态管理融合**：新建 zustand stores，桥接 flowforge 现有 useState 与 clowder-ai store 模式
3. **样式系统融合**：迁移 vendor CSS，建立 console-tokens 设计令牌体系
4. **基础组件补全**：移植 ConfirmProvider/ThemeProvider/ToastContainer/BrakeModal/GuideOverlay 等 7 个全局组件
5. **HelmLayout 分模块重构**：将 1425 行拆分为 8 个独立模块，分阶段迁移
6. **T8 测试根本性重构**：从"DOM 存在"升级为"用户任务完成度"，引入 Task-Based Testing 方法论

---

## §1 设计原则

### §1.1 命名规范铁律（依据 naming-contract.md v2.0）

**铁律**：本文档及所有代码必须严格遵循 P0/P1/P2 三层命名体系

| 优先级 | 名称类型 | 使用场景 | 示例 |
|:------:|---------|---------|------|
| **P0** | 官方名称（AI 业界术语） | 设计文档正文、代码注释 | Evolvable Agent / Static Agent / Multi-Agent Deliberation |
| **P1** | 项目英文名 | 代码类名、API 路径、配置项 | Forgekin / ForgeMind / EchoStore / MindCouncil |
| **P2** | 体系别名（仅社交） | 社区讨论、博客 | 灵智体 / 灵忆 / 灵议 / 育灵 |

**本文档使用规范**：
- 正文大量使用 P0 官方名称（如"可进化智能体（Evolvable Agent）"）
- 代码示例使用 P1 项目英文名（如 `ForgekinCard`、`/api/v1/forgekins`）
- P2 体系别名仅在引用社区语境时出现，首次出现必须双标注
- UI 文案：中文界面用 P0 为主（如"可进化智能体"），不暴露 P2 别名作为主标识

### §1.2 单一 Shell 统一架构（铁律）

```
┌──────────────────────────────────────────────────────────────────┐
│ ActivityBar │ ThreadSidebar  │ TopBar                            │
│   (52px)    │   (resizable)  │   (52px)                          │
│             │                ├───────────────────────────────────┤
│  - 对话      │  - 线程列表     │                                   │
│  - 记忆      │  - 项目切换     │                                   │
│  - Mission  │  - 标签过滤     │       Main Content                │
│  - 信号      │  - 新建线程     │                                   │
│  - 审批      │                │                                   │
│  - 管家      │                │                                   │
│  - 演示浮窗   │                │                                   │
│  - 主题      │                │                                   │
│  - 设置      │                │                                   │
└──────────────────────────────────────────────────────────────────┘
```

**铁律**：
1. 除 `/showcase`、`/story` 等纯展示页面外，所有路由必须共享 ShellWrapper
2. 严禁任何"裸渲染"页面（V1.0 的 `/council` 是反例）
3. `/solo`（Helm Studio）使用专属 HelmLayout（三栏布局），但仍受 ShellWrapper 外壳保护
4. ShellWrapper 必须打上 `data-shell="wrapper"` 标记，便于 T8 测试

### §1.3 模式内嵌而非独立路由

4 种聊天模式都是 HelmLayout 的内部状态，不再有独立路由：

| 模式 | URL | 主聊天区组件 | 状态来源 |
|------|-----|------------|---------|
| 普通（normal） | `/solo?mode=normal` | `ChatStream` + `WorkflowSelector` | `useHelmWebSocket` |
| Helm | `/solo?mode=helm` | `ChatStream`（自主模式） | `useHelmWebSocket` |
| 全自动（auto） | `/solo?mode=auto` | `ChatStream`（全自动） | `useHelmWebSocket` |
| **群聊（council）** | **`/solo?mode=council`** | **`CouncilChatPanel`** | `useCouncilChat` |

- `/council` 路由保留作为向后兼容入口，301 重定向到 `/solo?mode=council`
- 模式切换通过 ModeSelector 完成，不跳转路由
- ModeSelector 必须真正集成到 HelmLayout（V1.0 已定义但未使用）

### §1.4 智能体分类清晰体现（依据 naming-contract.md §2）

```
/admin/agents
├── Tab 1: 可进化智能体 (Evolvable Agent / Forgekin)
│   ├── 5 个内置 Forgekin：wenxin / sherlock / luban / vangogh / davinci
│   ├── 卡片显示：Soul Imprint、EchoStore、CapabilityProfile、EvolutionStage、AwakeningStage
│   └── 详情编辑：参考 clowder-ai HubCatEditor（身份/账户/路由/高级运行时）
└── Tab 2: 静态智能体 (Static Agent)
    ├── FlowForge 内置：DeclarativeAgent / ReActAgent / PlanExecuteAgent
    └── 外部接入：Claude Code / Codex / OpenCode / Trae（通过 ExternalAgentAdapter）
```

### §1.5 T8 测试根本性重构（铁律）

T8 测试必须从"DOM 存在"升级为"用户任务完成度"：

| 层级 | V1.0/V2.0 做法 | V3.0 做法 |
|------|---------------|----------|
| L1 元素存在 | `query_selector_all` | 保留 |
| L2 文本匹配 | `expected_text in content` | 保留 |
| L3 布局可用性 | 无 | **新增**：关键交互元素可见、可点击、尺寸合理 |
| L4 交互功能 | 无 | **新增**：Tab 切换、模式切换、模态框打开关闭 |
| L5 视觉一致性 | 无 | **新增**：所有页面共享 Shell，无裸页面 |
| L6 跨页面跳转 | 无 | **新增**：导航链接可达，回退正常 |
| **L7 任务完成度** | **无** | **新增**：模拟用户完成完整任务（如"创建 Forgekin"全流程） |
| **L8 LLM 审核 DOM** | **无** | **新增**：对 DOM 截图调用 LLM 审核可用性 |

---

## §2 现状深度分析

### §2.1 flowforge/web 真实代码状态

#### §2.1.1 layout.tsx（65 行）

**关键问题**：
- 第 13 行：`helmPaths: ["/solo", "/council"]` — 让 `/solo` 和 `/council` 跳过 ShellWrapper
- 第 30 行：`{ href: "/council", label: "灵议群聊", icon: "👥" }` — 旧入口，违反 P0 命名（"灵议"是 P2 别名）
- 第 38 行：`{ href: "/admin/models", label: "Provider", icon: "⚙" }` — 旧入口，应迁移到 `/admin/providers`
- 第 59-61 行：只有 `ShellConfigProvider > ShellWrapper`，缺失 ThemeProvider/ConfirmProvider/ToastContainer 等

#### §2.1.2 ShellWrapper.tsx（95 行）

**关键问题**：
- 第 16 行：`const isHelm = (config.helmPaths ?? ["/helm"]).some((p) => pathname.startsWith(p))`
- 第 18-20 行：`if (isHelm) { return <>{children}</>; }` — 裸渲染，无 ActivityBar、无 Sidebar、无 TopBar
- 第 23-93 行：非 Helm 路由使用简单 grid 布局（258px Sidebar + TopBar），与 clowder-ai AppShell 完全不同
- **完全没有 ActivityBar 组件**（clowder-ai 有 52px ActivityBar）
- **没有 zustand store 管理状态**

#### §2.1.3 HelmLayout.tsx（1425 行！）

**关键问题**：
- 第 50-103 行：50+ 个 useState，包括 panelVisibility、openTabs、diffFiles、attachments、currentPlan 等
- 第 164 行：`const config = useShellConfig();` — 使用 ShellConfig，但未使用 ModeSelector
- 第 940-1423 行：四列布局（TaskListPanel + ChatPanel + EditorPanel + ExplorerPanel）
- 第 979-1006 行：`<a href="/council">👥</a>` — 跳转链接，而非模式内嵌
- **完全没有引入 ModeSelector 组件**（已存在但未使用）
- **没有 council 模式分支**，无论 mode 是什么都渲染相同的 ChatStream
- 自定义 CSS 类 `helm-shell-v2`、`helm-tasklist-column`、`helm-chat-panel`、`helm-editor-panel`、`helm-explorer-panel` — 与 clowder-ai 的 `console-shell` 架构不兼容

**现有 50+ useState 状态清单**（需要迁移到 zustand stores）：
1. chat 相关：userMessages、resumePrompt、currentPlan、planLoading、newlyAddedSteps、diffFiles、attachments
2. workspace 相关：workspaceList、currentWorkspace、wsDropdownOpen、newWorkspaceName、showNewWorkspaceInput、showDirBrowser、dirBrowserItems、dirBrowserPath
3. editor 相关：openTabs、activeTabId、highlightFilePath、showSettingsInEditor
4. panel 相关：panelVisibility、prevPanelVisibility、chatPanelWidth、rightPanelWidth、panelMenuOpen、showSettings、showMCPConfig、showAgentOrchestrator、showBrowserPreview、showSpecPanel、showWorktreePanel、showFigmaImporter、browserUrl、terminalCommands
5. model 相关：selectedModel

#### §2.1.4 ModeSelector.tsx（79 行）

**关键问题**：
- 已定义 4 种模式（normal/helm/auto/council）
- **但 HelmLayout 根本没有 import 这个组件**
- 第 24 行：`council: { label: "群聊", color: "bg-emerald-600", desc: "5灵智体协作群聊" }` — "灵智体"是 P2 别名，违反命名规范

#### §2.1.5 council/page.tsx（16 行）

**关键问题**：
- 因 `helmPaths` 配置跳过 ShellWrapper
- 渲染裸 `<CouncilChatPanel showSidebar={true} />`
- 这就是"布局混乱没法用"的直接原因

#### §2.1.6 缺失的全局组件

| clowder-ai 组件 | flowforge/web 状态 |
|----------------|------------------|
| ThemeProvider | ❌ 缺失 |
| ThemeApplier | ❌ 缺失 |
| ConfirmProvider | ❌ 缺失 |
| ToastContainer | ❌ 缺失 |
| BrakeModal | ❌ 缺失 |
| GuideOverlay | ❌ 缺失 |
| SessionBootstrap | ❌ 缺失 |
| CatHueInjector | ❌ 缺失 |
| ActivityBar | ❌ 缺失 |
| ConciergeHost | ❌ 缺失 |
| ApprovalHubDrawer | ❌ 缺失 |
| FloatingPresentationSurfaceHost | ❌ 缺失 |

#### §2.1.7 缺失的 zustand stores

| clowder-ai store | flowforge/web 状态 |
|-----------------|------------------|
| chatStore | ❌ 缺失（用 useState 替代） |
| sidebarStore | ❌ 缺失 |
| gameStore | ❌ 缺失（游戏化功能） |
| guideStore | ❌ 缺失 |
| taskStore | ❌ 缺失 |
| approvalHubStore | ❌ 缺失 |
| callbackAuthStore | ❌ 缺失 |

#### §2.1.8 缺失的 vendor CSS

clowder-ai layout.tsx 引入 11 个 vendor CSS：
1. `/vendor/app/theme-tokens.css` — 主题令牌
2. `/vendor/app/cat-persona-tokens.css` — 智能体人格令牌
3. `/vendor/app/cat-persona-derived.css` — 智能体派生令牌
4. `/vendor/app/connector-tokens.css` — 连接器令牌
5. `/vendor/app/theme-extras.css` — 主题扩展
6. `/vendor/app/console-tokens.css` — 控制台令牌
7. `/vendor/app/console-shell.css` — 控制台 Shell 样式
8. `/vendor/app/console-controls.css` — 控制台控件样式
9. `/vendor/app/werewolf-theme.css` — 狼人杀主题（游戏化）
10. `/vendor/xterm/xterm.css` — 终端样式

flowforge/web 只有 `globals.css`，缺失上述所有样式系统。

### §2.2 clowder-ai 真实代码状态（参考标准）

#### §2.2.1 layout.tsx 架构

```typescript
// clowder-ai/packages/web/src/app/layout.tsx
<SessionBootstrap />
<CatHueInjector />
<ThemeProvider>
  <ThemeApplier />
  <ConfirmProvider>
    <AppShell>{children}</AppShell>
  </ConfirmProvider>
  <BrakeModal />
  <GuideOverlay />
  <ToastContainer />
</ThemeProvider>
```

#### §2.2.2 AppShell 架构

```typescript
// clowder-ai/packages/web/src/components/AppShell.tsx
const CHROMELESS_ROUTES = ['/story', '/story-export', '/pixel-brawl', '/showcase'];
const SIDEBAR_HIDDEN_ROUTES = ['/settings', '/marketplace', '/signals', '/memory', '/mission'];

if (isExport || CHROMELESS_ROUTES.some((r) => pathname.startsWith(r))) {
  return <>{children}</>;
}

const showSidebar = isOpen && isDesktop && !SIDEBAR_HIDDEN_ROUTES.some((r) => pathname.startsWith(r));

return (
  <div className="console-shell flex h-screen h-dvh overflow-hidden">
    <ActivityBar />                                          {/* 52px 活动栏 */}
    <CallbackAuthSnapshotMount />                            {/* 回调认证快照 */}
    {showSidebar && (
      <div className="flex items-stretch flex-shrink-0">
        <div style={{ width }} className="flex-shrink-0">
          <ThreadSidebar onClose={close} className="w-full" />
        </div>
        <ResizeHandle direction="horizontal" ... />          {/* 可拖拽调整宽度 */}
      </div>
    )}
    <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
    <FloatingPresentationSurfaceHost />                      {/* 演示浮窗 */}
    <ConciergeHost />                                       {/* 管家球 */}
  </div>
);
```

#### §2.2.3 ActivityBar 架构（357 行）

主导航（4 个）：
- `home` → `/` 对话
- `memory` → `/memory` 记忆
- `mission` → `/mission-hub` Mission Hub
- `signals` → `/signals` 信号

底部组件：
- `ApprovalHubButton` — 审批中心（badge count）
- `ConciergeRailToggle` — 管家球唤回
- `PresentationRailToggle` — 演示浮窗切换
- `ThemeMenu` — 主题切换
- `SettingsButton` → `/settings`
- `PinnedSections` — 钉选的设置 section

---

## §3 融合后总体架构

### §3.1 三层架构

```
Layer 3: 业务路由层（app/ 路由）
  ├── (shell)/*         — 受 ShellWrapper 保护的业务页面
  ├── (helm)/*          — Helm Studio 专属布局（仍受 ShellWrapper 外壳保护）
  └── (chromeless)/*    — 无 Shell 的展示页面（story/showcase）

Layer 2: Shell 层（components/Shell*）
  ├── ShellWrapper      — 全局外壳（决定是否显示 ActivityBar/Sidebar）
  ├── ActivityBar       — 左侧 52px 活动栏（移植 clowder-ai）
  ├── ThreadSidebar     — 可调整宽度的对话线程侧边栏（移植 clowder-ai）
  ├── TopBar            — 52px 顶部栏（新建）
  ├── ConciergeHost     — 全局管家球（root mount）
  ├── FloatingPresentationSurfaceHost — 演示浮窗（root mount）
  ├── ApprovalHubDrawer — 全局审批抽屉（root mount）
  ├── ToastContainer    — 全局通知
  ├── BrakeModal        — 紧急刹车
  ├── GuideOverlay      — 引导覆盖层
  └── ConfirmProvider   — 全局确认对话框

Layer 1: 业务组件层（components/helm/ + components/admin/ + components/settings/ ...）
```

### §3.2 完整路由树

```
/                                 → 仪表盘（系统状态、任务概览、排行榜）
/tasks                            → 任务列表
/review                           → 审核中心（增强：合并 HubEvalTab）
/review/[taskId]                  → 单任务审核
/solo                             → Helm Studio（4 种模式：normal/helm/auto/council）
/solo/[taskId]                    → Solo 任务回放
/memory                           → 记忆中心（移植 clowder-ai MemoryHub）
  /memory/catalog                 → 记忆目录
  /memory/graph                   → 记忆图谱
  /memory/health                  → 记忆健康
  /memory/search                  → 记忆搜索
  /memory/status                  → 记忆状态
/mission-hub                      → 任务中心（移植 clowder-ai）
/mission-control                  → 任务控制台
/signals                          → 信号总览
  /signals/sources                → 信号源管理
/admin                            → 管理中心首页（卡片导航）
/admin/agents                     → 智能体管理（双 Tab：可进化 + 静态）
/admin/providers                  → Provider 配置（合并 models + accounts）
/admin/settings                   → 设置中心（14 个 section，clowder-ai SettingsShell 架构）
/admin/observability              → 可观测性（合并 logs + ops + HubObservabilityTab）
/admin/mcp                        → MCP 管理
/admin/plugins                    → 插件管理
/admin/marketplace                → 能力市场
/admin/permissions                → 权限管理
/admin/governance                 → 治理中心
/admin/quotas                     → 配额看板
/admin/routing                    → 路由策略
/admin/im                         → IM 对接
/admin/env                        → 环境文件
/admin/tools                      → 工具统计
/admin/co-creators                → 共创管理
/admin/notify                     → 通知设置
/showcase/*                       → 展示页（chromeless）
/story/[storyId]                  → 故事页（chromeless）
```

**已删除/重定向路由**：
- `/council` → 301 重定向到 `/solo?mode=council`
- `/admin/models` → 301 重定向到 `/admin/providers`
- `/logs` → 301 重定向到 `/admin/observability`

### §3.3 全局组件挂载关系

```
app/layout.tsx (RootLayout)
  └── SessionBootstrap                              ← 新增（clowder-ai 移植）
  └── CatHueInjector                                ← 新增（clowder-ai 移植，重命名为 ForgekinHueInjector）
  └── ThemeProvider                                 ← 新增（clowder-ai 移植）
       └── ThemeApplier                             ← 新增（clowder-ai 移植）
       └── ConfirmProvider                          ← 新增（clowder-ai 移植）
            └── ShellWrapper                        ← 重构
                 ├── ActivityBar                    ← 新增（clowder-ai 移植）
                 ├── ThreadSidebar                  ← 新增（clowder-ai 移植，替代现有 Sidebar）
                 ├── TopBar                         ← 新增
                 ├── <main> {children} </main>
                 ├── FloatingPresentationSurfaceHost ← 新增（clowder-ai 移植）
                 ├── ConciergeHost                  ← 新增（clowder-ai 移植）
                 └── ApprovalHubDrawer              ← 新增（clowder-ai 移植）
       └── BrakeModal                               ← 新增（clowder-ai 移植）
       └── GuideOverlay                             ← 新增（clowder-ai 移植）
       └── ToastContainer                           ← 新增（clowder-ai 移植）
```

---

## §4 Shell 层统一方案

### §4.1 layout.tsx 重构

**当前问题**：`helmPaths: ["/solo", "/council"]` 让 `/council` 跳过 ShellWrapper，且缺少 7 个全局 Provider。

**重构方案**：

```typescript
// app/layout.tsx
import { SessionBootstrap } from "@/components/SessionBootstrap";
import { ForgekinHueInjector } from "@/components/ForgekinHueInjector";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeApplier } from "@/components/ThemeApplier";
import { ConfirmProvider } from "@/components/useConfirm";
import { BrakeModal } from "@/components/BrakeModal";
import { GuideOverlay } from "@/components/GuideOverlay";
import { ToastContainer } from "@/components/ToastContainer";
import { ShellConfigProvider } from "@/lib/shell-config";
import ShellWrapper from "@/components/ShellWrapper";
import { ShellConfig } from "@/lib/types";

const shellConfig: ShellConfig = {
  brandName: "FlowForge",
  brandShort: "FF",
  brandColor: "#ff5c5c",
  brandSubtitle: "AI Agent OS",
  version: "v0.1.0",
  // 取消 helmPaths — 所有路由都受 ShellWrapper 保护
  chromelessPaths: ["/showcase", "/story", "/story-export"],  // 仅展示页无 Shell
  navSections: [
    {
      label: "主页",
      items: [{ href: "/", label: "仪表盘", icon: "overlay" }],
    },
    {
      label: "工作",
      items: [
        { href: "/solo", label: "Helm Studio", icon: "bolt" },
        // 删除 /council 独立入口 — 通过 /solo 内 ModeSelector 切换
      ],
    },
    {
      label: "记忆与任务",
      items: [
        { href: "/memory", label: "记忆中心", icon: "memory" },
        { href: "/mission-hub", label: "Mission Hub", icon: "mission" },
        { href: "/signals", label: "信号", icon: "signal" },
        { href: "/tasks", label: "任务列表", icon: "list" },
        { href: "/review", label: "审核中心", icon: "check" },
      ],
    },
    {
      label: "管理",
      items: [
        { href: "/admin", label: "管理中心", icon: "grid" },
        { href: "/admin/agents", label: "智能体", icon: "robot" },
        { href: "/admin/providers", label: "Provider", icon: "gear" },
        { href: "/admin/settings", label: "设置中心", icon: "wrench" },
        { href: "/admin/observability", label: "可观测性", icon: "chart" },
      ],
    },
  ],
};

export const metadata: Metadata = {
  title: "FlowForge - AI Agent OS",
  description: "AI Agent Operating System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 迁移 clowder-ai vendor CSS */}
        <link rel="stylesheet" href="/vendor/app/theme-tokens.css" />
        <link rel="stylesheet" href="/vendor/app/forgekin-persona-tokens.css" />
        <link rel="stylesheet" href="/vendor/app/forgekin-persona-derived.css" />
        <link rel="stylesheet" href="/vendor/app/connector-tokens.css" />
        <link rel="stylesheet" href="/vendor/app/theme-extras.css" />
        <link rel="stylesheet" href="/vendor/app/console-tokens.css" />
        <link rel="stylesheet" href="/vendor/app/console-shell.css" />
        <link rel="stylesheet" href="/vendor/app/console-controls.css" />
        <link rel="stylesheet" href="/vendor/xterm/xterm.css" />
      </head>
      <body className="min-h-screen">
        <SessionBootstrap />
        <ForgekinHueInjector />
        <ThemeProvider>
          <ThemeApplier />
          <ConfirmProvider>
            <ShellConfigProvider config={shellConfig}>
              <ShellWrapper>{children}</ShellWrapper>
            </ShellConfigProvider>
          </ConfirmProvider>
          <BrakeModal />
          <GuideOverlay />
          <ToastContainer />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**关键变更**：
1. 删除 `helmPaths`，新增 `chromelessPaths`
2. 删除 `/council` 和 `/admin/models` 旧入口
3. 引入 9 个 vendor CSS 文件
4. 引入 7 个全局 Provider/组件
5. `navSections` 使用 P0 命名（"智能体"而非"灵智体"）

### §4.2 ShellWrapper.tsx 重构

**当前问题**：`isHelm` 时裸渲染，无 ActivityBar，无 zustand store。

**重构方案**：

```typescript
// components/ShellWrapper.tsx
"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useSidebarStore } from "@/stores/sidebarStore";
import { useShellConfig } from "../lib/shell-config";
import { ActivityBar } from "./ActivityBar";
import { ThreadSidebar } from "./ThreadSidebar";
import { TopBar } from "./TopBar";
import { ConciergeHost } from "./concierge/ConciergeHost";
import { FloatingPresentationSurfaceHost } from "./workspace/FloatingPresentationSurfaceHost";
import { ApprovalHubDrawer } from "./ApprovalHubDrawer";
import { ResizeHandle } from "./workspace/ResizeHandle";

// 与 clowder-ai 一致：展示页无 Shell
const CHROMELESS_ROUTES = ["/showcase", "/story", "/story-export"];

// 与 clowder-ai 一致：这些路由隐藏 ThreadSidebar（因为有自带侧边栏）
const SIDEBAR_HIDDEN_ROUTES = ["/admin/settings", "/admin/marketplace", "/signals", "/memory", "/mission"];

export default function ShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const config = useShellConfig();
  const { isOpen, width, close, handleResize, resetWidth } = useSidebarStore();
  const isDesktop = useIsDesktop();

  const isChromeless = (config.chromelessPaths ?? CHROMELESS_ROUTES).some((p) => pathname.startsWith(p));

  if (isChromeless) {
    return <>{children}</>;
  }

  const showSidebar = isOpen && isDesktop && !SIDEBAR_HIDDEN_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <div className="console-shell flex h-screen h-dvh overflow-hidden" data-shell="wrapper">
      <Suspense fallback={<div className="w-[52px] flex-shrink-0" aria-hidden="true" />}>
        <ActivityBar />
      </Suspense>
      {showSidebar && (
        <div className="flex items-stretch flex-shrink-0">
          <div style={{ width }} className="flex-shrink-0">
            <ThreadSidebar onClose={close} className="w-full" />
          </div>
          <ResizeHandle
            direction="horizontal"
            label="左侧对话栏"
            onResize={handleResize}
            onCollapse={close}
            onDoubleClick={resetWidth}
            showLine={false}
          />
        </div>
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
      <FloatingPresentationSurfaceHost />
      <ConciergeHost />
      <ApprovalHubDrawer />
    </div>
  );
}
```

**关键变更**：
1. 删除 `isHelm` 裸渲染逻辑
2. 引入 `ActivityBar`（52px，clowder-ai 移植）
3. 引入 `ThreadSidebar`（可调整宽度，clowder-ai 移植，替代现有 Sidebar）
4. 引入 `TopBar`（52px，新建）
5. 引入 4 个全局浮窗组件
6. 使用 `useSidebarStore` 管理侧边栏状态（替代 useState）
7. 添加 `data-shell="wrapper"` 标记（T8 测试用）

### §4.3 ActivityBar 移植

从 `clowder-ai/packages/web/src/components/ActivityBar.tsx` 完整移植，调整如下：

| clowder-ai 字段 | flowforge 字段 | 说明 |
|----------------|---------------|------|
| `home` → `/` | `home` → `/` | 对话主页 |
| `memory` → `/memory` | `memory` → `/memory` | 记忆中心 |
| `mission` → `/mission-hub` | `mission` → `/mission-hub` | Mission Hub |
| `signals` → `/signals` | `signals` → `/signals` | 信号 |
| `/settings` | `/admin/settings` | 设置入口（路径调整） |
| `useChatStore` | `useChatStore`（新建） | 状态管理 |
| `useApprovalHubStore` | `useApprovalHubStore`（新建） | 审批状态 |
| `ConciergeRailToggle` | `ConciergeRailToggle`（移植） | 管家球唤回 |
| `ThemeMenu` | `ThemeMenu`（移植） | 主题切换 |

### §4.4 ThreadSidebar 移植

从 `clowder-ai/packages/web/src/components/ThreadSidebar/` 完整移植（17 个文件）：

```
components/ThreadSidebar/
├── ThreadSidebar.tsx          ← 主侧边栏
├── ThreadItem.tsx             ← 线程项
├── ForgekinSelector.tsx       ← Forgekin 选择器（重命名自 CatSelector）
├── LabelFilterBar.tsx         ← 标签过滤
├── SectionGroup.tsx           ← 分组
├── SidebarTabIcon.tsx         ← Tab 图标
├── ThreadForgekinSettings.tsx ← 线程级 Forgekin 配置（重命名自 ThreadCatSettings）
├── ThreadLabelPicker.tsx      ← 标签选择
├── ThreadOrganizerModal.tsx   ← 线程整理
├── DirectoryBrowser.tsx       ← 目录浏览
├── DirectoryPickerModal.tsx   ← 目录选择
├── active-workspace.ts        ← 活动工作区
├── collapse-state.ts          ← 折叠状态
├── thread-navigation.ts       ← 线程导航
├── thread-utils.ts            ← 线程工具
├── use-collapse-state.ts      ← 折叠状态 Hook
└── use-project-pins.ts        ← 项目钉选 Hook
```

**命名重命名**（依据 naming-contract.md）：
- `CatSelector` → `ForgekinSelector`
- `ThreadCatSettings` → `ThreadForgekinSettings`
- `/api/cats` → `/api/v1/forgekins`
- `/api/threads` → `/api/v1/threads`

---

## §5 聊天模式融合设计

### §5.1 HelmLayout 1425 行代码分模块重构方案

**当前问题**：HelmLayout.tsx 是 1425 行的巨型组件，包含 50+ 个 useState，且未使用 ModeSelector。

**重构策略**：拆分为 8 个独立模块，状态迁移到 zustand stores。

#### §5.1.1 模块拆分

```
components/helm/
├── HelmLayout.tsx              ← 主布局（精简到 200 行以内）
├── HelmWorkspaceBar.tsx        ← 工作区栏（从原 961-1149 行拆出）
├── HelmLeftPanel.tsx           ← 左侧任务列表面板（从原 942-956 行拆出）
├── HelmMainPanel.tsx           ← 主聊天区（根据 mode 切换）
├── HelmRightPanel.tsx          ← 右侧编辑器/浏览器/Spec 面板（从原 1199-1267 行拆出）
├── HelmModals.tsx              ← 各种模态框（Settings/MCP/Figma/DirBrowser）
├── hooks/
│   ├── useHelmWorkspace.ts     ← 工作区状态（从原 166-213 行拆出）
│   ├── useHelmPlan.ts          ← Plan 状态（从原 264-391 行拆出）
│   ├── useHelmDiff.ts          ← Diff 状态（从原 231-262 行拆出）
│   ├── useHelmEditor.ts        ← 编辑器 Tab 状态（从原 814-911 行拆出）
│   ├── useHelmPanels.ts        ← 面板可见性状态（从原 101-162 行拆出）
│   └── useHelmCommands.ts      ← 命令处理（从原 708-812 行拆出）
└── stores/
    ├── helmWorkspaceStore.ts   ← 工作区 zustand store
    ├── helmPlanStore.ts        ← Plan zustand store
    ├── helmEditorStore.ts      ← 编辑器 zustand store
    └── helmPanelStore.ts       ← 面板可见性 zustand store
```

#### §5.1.2 主布局 HelmLayout.tsx 重构后（≤200 行）

```typescript
// components/helm/HelmLayout.tsx
"use client";

import { useState, useEffect } from "react";
import { useHelmWebSocket } from "../../hooks/useHelmWebSocket";
import { useShellConfig } from "../../lib/shell-config";
import { useHelmWorkspaceStore } from "./stores/helmWorkspaceStore";
import { useHelmPlanStore } from "./stores/helmPlanStore";
import { useHelmEditorStore } from "./stores/helmEditorStore";
import { useHelmPanelStore } from "./stores/helmPanelStore";
import { useHelmCommands } from "./hooks/useHelmCommands";
import HelmWorkspaceBar from "./HelmWorkspaceBar";
import HelmLeftPanel from "./HelmLeftPanel";
import HelmMainPanel from "./HelmMainPanel";
import HelmRightPanel from "./HelmRightPanel";
import HelmModals from "./HelmModals";
import ModeSelector from "./ModeSelector";
import type { HelmMode } from "./ModeSelector";

export default function HelmLayout() {
  const [mode, setMode] = useState<HelmMode>("helm");

  // 从 zustand stores 获取状态（替代 50+ useState）
  const { currentWorkspace, workspaceList, fetchWorkspaceList } = useHelmWorkspaceStore();
  const { currentPlan, setCurrentPlan, planLoading } = useHelmPlanStore();
  const { openTabs, activeTabId, setActiveTabId } = useHelmEditorStore();
  const { panelVisibility, setPanelVisibility } = useHelmPanelStore();

  const config = useShellConfig();

  const helm = useHelmWebSocket({
    onDraftUpdate: (content, isPartial) => {
      if (!isPartial) helm.updateEditor(content);
    },
  });

  const { handleCommand } = useHelmCommands(helm);

  // 同步 task 状态到 workspace
  useEffect(() => {
    if (helm.phase === "completed" || helm.phase === "error" || helm.phase === "interrupted") {
      fetchWorkspaceList();
    }
  }, [helm.phase, fetchWorkspaceList]);

  return (
    <div className="helm-layout flex flex-col h-full" data-helm="layout" data-mode={mode}>
      {/* 顶部工作区栏 */}
      <HelmWorkspaceBar
        currentWorkspace={currentWorkspace}
        workspaceList={workspaceList}
        onSwitchWorkspace={(ws) => useHelmWorkspaceStore.getState().setCurrentWorkspace(ws)}
      />

      {/* 主体三栏布局 */}
      <div className="helm-body flex-1 flex min-h-0">
        {panelVisibility.chat && (
          <HelmLeftPanel
            phase={helm.phase}
            intent={helm.intent}
            taskId={helm.taskId}
            onNewTask={() => helm.resetState()}
            onSwitchTask={(tid, intent, persona, phase) => helm.restoreTask(tid, intent, persona, phase)}
          />
        )}

        <HelmMainPanel
          mode={mode}
          helm={helm}
          currentPlan={currentPlan}
          planLoading={planLoading}
          onPlanConfirm={(planId, steps) => { /* ... */ }}
          onPlanReject={(planId) => { /* ... */ }}
          onChatSubmit={(text, persona, model) => { /* ... */ }}
          onCommand={handleCommand}
        />

        {panelVisibility.editor && (
          <HelmRightPanel
            mode={mode}
            openTabs={openTabs}
            activeTabId={activeTabId}
            onTabSelect={setActiveTabId}
          />
        )}
      </div>

      {/* 底部模式选择器（4 种模式） */}
      <ModeSelector
        mode={mode}
        onModeChange={setMode}
        selectedWorkflow={null}
        onWorkflowChange={() => {}}
      />

      {/* 各种模态框 */}
      <HelmModals />
    </div>
  );
}
```

#### §5.1.3 ModeSelector 重构（修复命名 + 真正集成）

```typescript
// components/helm/ModeSelector.tsx
"use client";

import { useState, useEffect } from "react";

export type HelmMode = "normal" | "helm" | "auto" | "council";

interface ModeSelectorProps {
  mode: HelmMode;
  onModeChange: (mode: HelmMode) => void;
  selectedWorkflow: string | null;
  onWorkflowChange: (wf: string | null) => void;
}

const MODE_CONFIG: Record<HelmMode, { label: string; color: string; desc: string }> = {
  normal: { label: "普通", color: "bg-blue-600", desc: "选择工作流执行" },
  helm: { label: "Helm", color: "bg-purple-600", desc: "AI 自主规划执行" },
  auto: { label: "全自动", color: "bg-rose-600", desc: "全自动执行" },
  council: { label: "群聊", color: "bg-emerald-600", desc: "5 个可进化智能体协作群聊" },  // P0 命名
};

export default function ModeSelector({ mode, onModeChange, selectedWorkflow, onWorkflowChange }: ModeSelectorProps) {
  // ... 与原实现类似，但添加 data-mode 标记
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-800 bg-gray-900/80" data-mode-selector="container">
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {(Object.keys(MODE_CONFIG) as HelmMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            data-mode={m}                                          // T8 测试标记
            data-active={mode === m ? "true" : "false"}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              mode === m ? `${MODE_CONFIG[m].color} text-white shadow-sm` : "text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            }`}
            title={MODE_CONFIG[m].desc}
          >
            {MODE_CONFIG[m].label}
          </button>
        ))}
      </div>
      {/* ... 工作流选择器 */}
    </div>
  );
}
```

#### §5.1.4 HelmMainPanel 模式分支

```typescript
// components/helm/HelmMainPanel.tsx
"use client";

import { useMemo } from "react";
import ChatStream from "./ChatStream";
import ChatInput from "./ChatInput";
import CouncilChatPanel from "./CouncilChatPanel";
import { entryToChatMessages, mergeStreamingMessages } from "./helm-utils";
import type { HelmMode } from "./ModeSelector";

interface HelmMainPanelProps {
  mode: HelmMode;
  helm: any;  // useHelmWebSocket 返回值
  currentPlan: any;
  planLoading: boolean;
  onPlanConfirm: (planId: string, steps?: any[]) => void;
  onPlanReject: (planId: string) => void;
  onChatSubmit: (text: string, persona?: string, model?: string) => void;
  onCommand: (cmd: string) => void;
}

export default function HelmMainPanel({ mode, helm, currentPlan, planLoading, onPlanConfirm, onPlanReject, onChatSubmit, onCommand }: HelmMainPanelProps) {
  const chatMessages = useMemo(() => {
    const msgs = [];
    for (const entry of helm.entries) msgs.push(...entryToChatMessages(entry));
    msgs.sort((a, b) => (typeof a.timestamp === "number" ? a.timestamp : new Date(a.timestamp).getTime()) - (typeof b.timestamp === "number" ? b.timestamp : new Date(b.timestamp).getTime()));
    return mergeStreamingMessages(msgs);
  }, [helm.entries]);

  // 根据 mode 切换主聊天区
  if (mode === "council") {
    return (
      <div className="helm-main-panel flex-1 flex flex-col min-w-0" data-panel="council-chat">
        <CouncilChatPanel showSidebar={false} compact />
      </div>
    );
  }

  return (
    <div className="helm-main-panel flex-1 flex flex-col min-w-0" data-panel="chat-stream">
      <ChatStream
        messages={chatMessages}
        phase={helm.phase}
        currentPlan={currentPlan}
        planLoading={planLoading}
        onPlanConfirm={onPlanConfirm}
        onPlanReject={onPlanReject}
      />
      <ChatInput
        phase={helm.phase}
        onSubmit={onChatSubmit}
        onCommand={onCommand}
        onStop={helm.resetState}
        interactionMode={helm.interactionMode}
        onInteractionModeChange={helm.setInteractionMode}
      />
    </div>
  );
}
```

### §5.2 /council 路由处理

```typescript
// app/council/page.tsx
import { redirect } from "next/navigation";

export default function CouncilPage() {
  redirect("/solo?mode=council");
}
```

### §5.3 CouncilChatPanel 优化（移植 clowder-ai ChatContainer）

从 `clowder-ai/packages/web/src/components/ChatContainer.tsx`（已确认 800+ 行）移植以下功能：

1. **多线程支持**：每个群聊会话独立线程，支持切换、删除、重命名
2. **@mention 增强**：参考 clowder-ai `PathCompletionMenu`，支持路径补全
3. **角色分配**：参考 clowder-ai `RoleAssignmentPanel`（primary/reviewer/tester）
4. **协作可视化**：参考 clowder-ai `MultiAgentVisualization`，展示 Agent 协作图
5. **状态指示器**：每个 Forgekin 显示在线/离线/思考中状态
6. **能量条**：参考 clowder-ai `CatTokenUsage`，显示 Token 用量
7. **投票配置**：参考 clowder-ai `VoteConfigModal`，支持配置投票机制
8. **审批集成**：参考 clowder-ai `ApprovalPanel`，关键动作需审批
9. **消息操作**：参考 clowder-ai `MessageActions`，支持复制/重发/引用
10. **T7 徽章**：每条 Forgekin 响应携带 T7 审核徽章（不影响用户使用）

---

## §6 智能体管理中心设计（/admin/agents 重构）

### §6.1 双 Tab 分类（依据 naming-contract.md §2）

```typescript
// app/admin/agents/page.tsx
"use client";

import { useState } from "react";
import { EvolvableAgentTab } from "@/components/admin/agents/EvolvableAgentTab";
import { StaticAgentTab } from "@/components/admin/agents/StaticAgentTab";

export default function AgentsPage() {
  const [tab, setTab] = useState<"evolvable" | "static">("evolvable");

  return (
    <div className="admin-agents" data-admin="agents">
      <div className="page-header">
        <h1>智能体管理</h1>
        <p>可进化智能体（Evolvable Agent / Forgekin）+ 静态智能体（Static Agent）</p>
      </div>

      <div className="tab-bar">
        <button
          onClick={() => setTab("evolvable")}
          data-agents-tab="evolvable"
          data-active={tab === "evolvable" ? "true" : "false"}
          className={tab === "evolvable" ? "active" : ""}
        >
          🦉 可进化智能体 (Forgekin) <span className="badge">5</span>
        </button>
        <button
          onClick={() => setTab("static")}
          data-agents-tab="static"
          data-active={tab === "static" ? "true" : "false"}
          className={tab === "static" ? "active" : ""}
        >
          ⚙ 静态智能体 (Static Agent) <span className="badge">N</span>
        </button>
      </div>

      {tab === "evolvable" ? <EvolvableAgentTab /> : <StaticAgentTab />}
    </div>
  );
}
```

### §6.2 可进化智能体 Tab（5 个 Forgekin）

```typescript
// components/admin/agents/EvolvableAgentTab.tsx
const ROSTER = [
  { id: "wenxin", name: "文心", role: "架构师", species: "BIO", emoji: "🦉", evolutionStage: "E3", awakeningStage: "E2" },
  { id: "sherlock", name: "夏洛克", role: "开发者", species: "BIO", emoji: "🐕", evolutionStage: "E3", awakeningStage: "E2" },
  { id: "luban", name: "鲁班", role: "架构师", species: "BIO", emoji: "🦫", evolutionStage: "E3", awakeningStage: "E2" },
  { id: "vangogh", name: "梵高", role: "评审员", species: "BIO", emoji: "🦚", evolutionStage: "E3", awakeningStage: "E2" },
  { id: "davinci", name: "达芬奇", role: "测试员", species: "BIO", emoji: "🦅", evolutionStage: "E3", awakeningStage: "E2" },
];

function EvolvableAgentTab() {
  return (
    <div className="evolvable-tab" data-agents-content="evolvable">
      <div className="forgekin-grid">
        {ROSTER.map((forgekin) => (
          <ForgekinCard key={forgekin.id} forgekin={forgekin} />
        ))}
      </div>
    </div>
  );
}

function ForgekinCard({ forgekin }: { forgekin: typeof ROSTER[0] }) {
  return (
    <div className="forgekin-card" data-forgekin-card={forgekin.id}>
      <div className="avatar">{forgekin.emoji}</div>
      <div className="name">{forgekin.name}</div>
      <div className="role">{forgekin.role}</div>
      <div className="species">形态: {forgekin.species}</div>
      <div className="evolution-stage">进化阶: {forgekin.evolutionStage}</div>
      <div className="awakening-stage">觉醒阶: {forgekin.awakeningStage}</div>
      <div className="actions">
        <button onClick={() => openHubCatEditor(forgekin.id)}>编辑</button>
        <button onClick={() => openEvolutionDialog(forgekin.id)}>进化</button>
        <button onClick={() => openAwakeningDialog(forgekin.id)}>觉醒</button>
        <button onClick={() => viewLineage(forgekin.id)}>谱系</button>
      </div>
    </div>
  );
}
```

### §6.3 静态智能体 Tab

```typescript
// components/admin/agents/StaticAgentTab.tsx
function StaticAgentTab() {
  const [subTab, setSubTab] = useState<"builtin" | "external">("builtin");

  return (
    <div className="static-tab" data-agents-content="static">
      <div className="sub-tab-bar">
        <button onClick={() => setSubTab("builtin")} data-static-subtab="builtin">FlowForge 内置</button>
        <button onClick={() => setSubTab("external")} data-static-subtab="external">外部接入</button>
      </div>

      {subTab === "builtin" ? (
        <BuiltinStaticAgentList>
          {/* DeclarativeAgent / ReActAgent / PlanExecuteAgent / ReflexionAgent */}
        </BuiltinStaticAgentList>
      ) : (
        <ExternalAgentList>
          {/* Claude Code / Codex / OpenCode / Trae（ExternalAgentAdapter） */}
        </ExternalAgentList>
      )}
    </div>
  );
}
```

### §6.4 HubCatEditor 移植（重命名为 HubForgekinEditor）

从 `clowder-ai/packages/web/src/components/HubCatEditor.tsx` 移植，包括 10 个子组件：

| clowder-ai 子组件 | flowforge 重命名 | 功能 |
|------------------|----------------|------|
| `hub-cat-editor-fields.tsx` | `hub-forgekin-editor-fields.tsx` | 基础表单字段 |
| `hub-cat-editor-advanced.tsx` | `hub-forgekin-editor-advanced.tsx` | 高级运行时参数 |
| `hub-cat-editor-voice.tsx` | `hub-forgekin-editor-voice.tsx` | 语音配置 |
| `hub-cat-editor-color-field.tsx` | `hub-forgekin-editor-color-field.tsx` | 颜色字段 |
| `hub-cat-editor.sections.tsx` | `hub-forgekin-editor.sections.tsx` | 分区渲染 |
| `hub-cat-editor.model.ts` | `hub-forgekin-editor.model.ts` | 模型字段 |
| `hub-cat-editor.payload.ts` | `hub-forgekin-editor.payload.ts` | 提交 payload |
| `hub-cat-editor.protocols.ts` | `hub-forgekin-editor.protocols.ts` | 协议字段 |
| `hub-cat-editor.acp.ts` | `hub-forgekin-editor.acp.ts` | ACP（Agent Communication Protocol） |
| `hub-cat-editor.client.ts` | `hub-forgekin-editor.client.ts` | 客户端逻辑 |

**字段映射**（依据 naming-contract.md §9.2）：

| clowder-ai 字段 | flowforge 字段 | 说明 |
|----------------|---------------|------|
| `cat.name` | `forgekin.name` | 名称 |
| `cat.breed` | `forgekin.species` | 形态（BIO/ORG/OBJ/VIRTUAL/HYBRID） |
| `cat.role` | `forgekin.role` | 角色（架构师/开发者/评审员/测试员/文档员） |
| `cat.account` | `forgekin.account` | 模型账户 |
| `cat.model` | `forgekin.model` | 模型 |
| `cat.system_prompt` | `forgekin.system_prompt` | 系统提示词 |
| `cat.tools` | `forgekin.tools` | 工具集 |
| `cat.capabilities` | `forgekin.capability_profile` | 能力画像 |
| `cat.routing` | `forgekin.routing` | 路由策略 |
| `cat.advanced` | `forgekin.advanced` | 高级运行时 |

### §6.5 Forgekin 详情页（`/admin/agents/[forgekinId]`）

详情页包含 5 个 Tab（依据 naming-contract.md §3）：

1. **身份（Soul Imprint / 持久身份）**：价值锚点、长期记忆、red lines
2. **能力画像（Capability Profile）**：能力维度、盲点、能力雷达图
3. **经验记忆（EchoStore / 情景记忆）**：情景记忆列表、时间线、检索
4. **进化阶（Evolution Stage / 能力成熟度等级）**：E1-E6 当前阶段、晋升记录
5. **觉醒阶（Awakening Stage / 自主性等级）**：E1-E6 自主范围、晋升记录

---

## §7 设置中心融合（clowder-ai SettingsShell 完整移植）

### §7.1 /admin/settings 重构为 SettingsShell 架构

从 `clowder-ai/packages/web/src/components/settings/` 完整移植：

```typescript
// app/admin/settings/page.tsx
"use client";

import { SettingsShell } from "@/components/settings/SettingsShell";

export default function AdminSettingsPage() {
  return <SettingsShell />;
}
```

```typescript
// components/settings/SettingsShell.tsx
export function SettingsShell() {
  return (
    <div className="settings-shell flex h-full" data-settings="shell">
      <aside className="settings-nav w-[220px] flex-shrink-0">
        <h1>设置</h1>
        <SettingsNav activeSection={activeSection} onSelect={handleSelect} />
      </aside>
      <div className="settings-content flex-1 overflow-y-auto">
        <SettingsContent section={activeSection} />
      </div>
    </div>
  );
}
```

### §7.2 14 个 Section 移植清单

| # | Section ID | 标签 | 描述 | 来源 | 与 FlowForge 现有合并 |
|---|-----------|------|------|------|---------------------|
| 1 | members | 成员管理 | 成员名册、协作对象、编排顺序 | clowder-ai | 合并 `/admin/agents`（可进化智能体配置） |
| 2 | profiles | 能力画像 | CapabilityProfile、路由信号、来源追溯 | clowder-ai | 新增 |
| 3 | accounts | 账户与密钥 | API Key、凭据、执行身份 | clowder-ai | 合并 `/admin/models`（providers） |
| 4 | im | IM 对接 | 飞书/钉钉/企微 | clowder-ai | 合并 `/admin/im` |
| 5 | skills | Skill 管理 | 技能市场、安装计划 | clowder-ai | 新增 |
| 6 | mcp | MCP 管理 | MCP 服务、工具目录 | clowder-ai | 合并 `/admin/mcp` |
| 7 | plugins | 插件集成 | 插件状态、外部集成 | clowder-ai | 合并 `/admin/plugins` |
| 8 | marketplace | 能力市场 | 搜索安装能力包 | clowder-ai | 合并 `/admin/marketplace` |
| 9 | concierge | 管家 | 管家形象、人设、值班 | clowder-ai | 新增 |
| 10 | voice | 语音管理 | 语音 IO、术语表、TTS | clowder-ai | 新增 |
| 11 | system | 系统配置 | 环境选项、运行时开关 | clowder-ai | 合并 `/admin/settings`（系统部分） |
| 12 | rules | 协作与规则 | 提示词注入、协作规则 | clowder-ai | 合并 `/admin/settings`（规则部分） |
| 13 | notify | 通知 | 推送订阅、提醒策略 | clowder-ai | 合并 `/admin/notify` |
| 14 | ops | 运维监控 | 服务健康、命令工具 | clowder-ai | 合并 `/admin/observability` |

### §7.3 primitives/ 组件库移植

从 `clowder-ai/packages/web/src/components/settings/primitives/` 完整移植 22 个基础组件：

```
components/settings/primitives/
├── ActionRenderer.tsx
├── ConfigFieldRenderer.tsx
├── SettingsBadge.tsx
├── SettingsBreadcrumb.tsx
├── SettingsCard.tsx
├── SettingsCodeField.tsx
├── SettingsCollapsibleCard.tsx
├── SettingsDeleteButton.tsx
├── SettingsEmptyState.tsx
├── SettingsField.tsx
├── SettingsFilterTabs.tsx
├── SettingsHubLink.tsx
├── SettingsIconButton.tsx
├── SettingsInlineItem.tsx
├── SettingsPillButton.tsx
├── SettingsPrimaryButton.tsx
├── SettingsRow.tsx
├── SettingsSecondaryButton.tsx
├── SettingsSection.tsx
├── SettingsStatusStrip.tsx
├── SettingsText.tsx
├── SettingsToolbar.tsx
└── index.ts
```

---

## §8 Hub 组件完整移植清单

### §8.1 Hub 组件分类与归属

| 组件 | 来源 | 归属路由 | 用途 |
|------|------|---------|------|
| HubListModal | clowder-ai | 全局（ActivityBar 入口） | Hub 模态框 |
| HubAccountsTab | clowder-ai | `/admin/settings?s=accounts` | 账户管理 |
| HubForgekinEditor | clowder-ai（重命名自 HubCatEditor） | `/admin/agents`（编辑模态框） | Forgekin 编辑器 |
| HubPermissionsTab | clowder-ai | `/admin/permissions` | 权限管理 |
| HubGovernanceTab | clowder-ai | `/admin/governance` | 治理状态 |
| HubQuotaBoardTab | clowder-ai | `/admin/quotas` | 配额看板 |
| HubRoutingPolicyTab | clowder-ai | `/admin/routing` | 路由策略 |
| HubEvalTab | clowder-ai | `/review`（增强） | 评估中心 |
| HubObservabilityTab | clowder-ai | `/admin/observability` | 可观测性 |
| HubObservabilityOverview | clowder-ai | `/admin/observability` | 可观测性总览 |
| HubEnvFilesTab | clowder-ai | `/admin/env` | 环境文件 |
| HubConnectorConfigTab | clowder-ai | `/admin/routing`（连接器子 Tab） | 连接器配置 |
| HubAgentSessionsTab | clowder-ai | `/admin/agents/[id]?tab=sessions` | 智能体会话 |
| HubRuntimeSessionsTab | clowder-ai | `/admin/observability?tab=runtime` | 运行时会话 |
| HubToolUsageTab | clowder-ai | `/admin/tools` | 工具使用统计 |
| HubLeaderboardTab | clowder-ai | `/`（仪表盘子模块） | 排行榜 |
| HubCommandsTab | clowder-ai | `/admin/settings?s=rules`（命令子 Tab） | 命令管理 |
| HubCallbackAuthPanel | clowder-ai | `/admin/observability?tab=callback` | 回调认证 |
| HubCoCreatorEditor | clowder-ai | `/admin/co-creators` | 共创管理 |
| HubClaudeRescueSection | clowder-ai | `/admin/settings?s=system`（救援子节） | Claude 救援 |
| HubMemberOverviewCard | clowder-ai | `/admin/agents`（成员卡片） | 成员概览 |
| HubEvalVerdictCard | clowder-ai | `/review`（评估判决） | 评估判决卡片 |
| HubEvalFrictionSections | clowder-ai | `/review`（摩擦分析） | 评估摩擦分析 |
| HubConfigIcons | clowder-ai | settings primitives | 配置图标 |
| HubStrategyTypes | clowder-ai | `/admin/routing` | 策略类型 |
| HubQuotaPools | clowder-ai | `/admin/quotas` | 配额池 |
| HubTagEditor | clowder-ai | `/admin/agents`（标签编辑） | 标签编辑 |

---

## §9 缺失功能补全

### §9.1 ConciergeHost（管家球）

**来源**：`clowder-ai/packages/web/src/components/concierge/`（14 个文件）

**移植内容**：ConciergeHost、ConciergeBall、ConciergePanel、ConciergeToolbar、ConciergeRailToggle、ConciergeMessageContent、InvestigationProgress 及相关 Hooks

**归属**：ShellWrapper root 全局挂载

### §9.2 Memory Hub（记忆中心）

**来源**：`clowder-ai/packages/web/src/components/memory/`（15 个文件）

**路由**：
- `/memory` → MemoryHub
- `/memory/catalog` → CollectionCatalog
- `/memory/graph` → CollectionGraph
- `/memory/health` → HealthReport
- `/memory/search` → EvidenceSearch
- `/memory/status` → IndexStatus

### §9.3 Mission Hub / Mission Control（任务中心）

**来源**：`clowder-ai/packages/web/src/app/mission-hub/`、`mission-control/`、`mission/`

**路由**：
- `/mission-hub` → Mission Hub 主页
- `/mission-control` → Mission Control 控制台
- `/mission` → Mission 详情

### §9.4 Signals（信号系统）

**来源**：`clowder-ai/packages/web/src/app/signals/`

**路由**：
- `/signals` → 信号总览
- `/signals/sources` → 信号源管理

### §9.5 Marketplace（能力市场）

**来源**：`clowder-ai/packages/web/src/components/marketplace/`

**路由**：`/admin/marketplace`

### §9.6 其他缺失组件

| 组件 | 来源 | 归属 |
|------|------|------|
| BrakeModal | clowder-ai | ShellWrapper root |
| GuideOverlay | clowder-ai | ShellWrapper root |
| ThemeApplier / ThemeProvider / ThemeMenu / ThemeToggle | clowder-ai | RootLayout |
| FirstRunQuestWizard | clowder-ai | 首次访问引导 |
| SessionBootstrap | clowder-ai | RootLayout |
| SystemNoticeBar | clowder-ai | TopBar 内 |
| ConnectionStatusBar | clowder-ai | TopBar 内 |
| ParallelStatusBar | clowder-ai | HelmLayout 状态栏 |
| MobileStatusSheet | clowder-ai | 移动端 |
| HistorySearchModal | clowder-ai | 全局搜索 |
| Lightbox | clowder-ai | 图片预览 |
| MermaidDiagram | clowder-ai | Mermaid 图表 |

---

## §10 后端 API 融合

### §10.1 现有 FlowForge API（保留）

| 路径 | 方法 | 用途 |
|------|------|------|
| `/api/v1/system/agents` | GET | 系统智能体列表 |
| `/api/v1/forgemind/roster` | GET | Forgekin 花名册 |
| `/api/v1/settings/models` | GET | 模型列表 |
| `/api/v1/settings/providers` | GET | Provider 列表 |
| `/api/v1/settings/workflows` | GET | 工作流列表 |
| `/api/v1/graph/workflows` | GET | 工作流图 |
| `/api/v1/dashboard` | GET | 仪表盘 |
| `/api/v1/metrics` | GET | Prometheus 指标 |

### §10.2 新增 API（从 clowder-ai 移植）

| 路径 | 方法 | 用途 | 来源 |
|------|------|------|------|
| `/api/v1/forgekins` | GET | Forgekin 列表 | clowder-ai `/api/cats` |
| `/api/v1/forgekins/[id]` | GET/PUT | Forgekin 详情/更新 | clowder-ai `/api/cats/[id]` |
| `/api/v1/forgekins/council/messages` | GET | 群聊消息历史 | clowder-ai `/api/messages` |
| `/api/v1/forgekins/council/chat` | POST | 发送群聊消息 | clowder-ai `/api/chat` |
| `/api/v1/forgekins/council/ws` | WS | 实时消息流 | clowder-ai `/ws` |
| `/api/v1/threads` | GET/POST | 线程管理 | clowder-ai `/api/threads` |
| `/api/v1/threads/[id]` | GET/DELETE | 单线程 | clowder-ai |
| `/api/v1/threads/[id]/messages` | GET | 线程消息 | clowder-ai |
| `/api/v1/threads/[id]/forgekins` | GET/PUT | 线程 Forgekin 配置 | clowder-ai |
| `/api/v1/memory/collections` | GET/POST | 记忆集合 | clowder-ai |
| `/api/v1/memory/recall` | POST | 记忆检索 | clowder-ai |
| `/api/v1/memory/health` | GET | 记忆健康 | clowder-ai |
| `/api/v1/missions` | GET/POST | 任务管理 | clowder-ai |
| `/api/v1/signals` | GET | 信号列表 | clowder-ai |
| `/api/v1/signals/sources` | GET/POST | 信号源 | clowder-ai |
| `/api/v1/quota/pools` | GET | 配额池 | clowder-ai |
| `/api/v1/governance/status` | GET | 治理状态 | clowder-ai |
| `/api/v1/permissions` | GET/PUT | 权限 | clowder-ai |
| `/api/v1/routing/policies` | GET/PUT | 路由策略 | clowder-ai |
| `/api/v1/connectors` | GET/POST | 连接器 | clowder-ai |
| `/api/v1/skills` | GET/POST | Skill | clowder-ai |
| `/api/v1/mcp/servers` | GET/POST | MCP 服务 | clowder-ai |
| `/api/v1/plugins` | GET/POST | 插件 | clowder-ai |
| `/api/v1/marketplace/search` | POST | 市场搜索 | clowder-ai |
| `/api/v1/concierge/config` | GET/PUT | 管家配置 | clowder-ai |
| `/api/v1/voice/config` | GET/PUT | 语音配置 | clowder-ai |
| `/api/v1/notify/subscriptions` | GET/POST | 通知订阅 | clowder-ai |
| `/api/v1/ops/services` | GET | 运维服务 | clowder-ai |
| `/api/v1/env/files` | GET/PUT | 环境文件 | clowder-ai |
| `/api/v1/co-creators` | GET/POST | 共创管理 | clowder-ai |
| `/api/v1/eval/verdicts` | GET | Eval 判决 | clowder-ai |
| `/api/v1/eval/friction` | GET | Eval 摩擦 | clowder-ai |
| `/api/v1/leaderboard` | GET | 排行榜 | clowder-ai |
| `/api/v1/tool-usage` | GET | 工具使用统计 | clowder-ai |
| `/api/v1/audit/events` | GET | 审计事件 | clowder-ai |
| `/api/v1/callbacks/auth` | GET/PUT | 回调认证 | clowder-ai |

### §10.3 API 路径命名规范

- 所有 API 路径使用 `/api/v1/` 前缀（FlowForge 现有）
- 资源用复数（`/api/v1/forgekins`、`/api/v1/threads`）
- 子资源用嵌套（`/api/v1/threads/{id}/messages`）
- 动作用 POST + 动词（`/api/v1/forgekins/council/chat`）
- **严禁使用 clowder-ai 的 `/api/cats` 等术语**，必须使用 FlowForge 命名（forgekins）

---

## §11 状态管理融合

### §11.1 新建 zustand stores 清单

flowforge/web 完全没有 zustand stores，需要新建以下 7 个 stores：

```typescript
// stores/chatStore.ts        ← 聊天状态（替代 HelmLayout 50+ useState）
// stores/sidebarStore.ts     ← 侧边栏状态（isOpen/width/handleResize）
// stores/helmWorkspaceStore.ts ← 工作区状态（currentWorkspace/workspaceList）
// stores/helmPlanStore.ts    ← Plan 状态（currentPlan/planLoading）
// stores/helmEditorStore.ts  ← 编辑器状态（openTabs/activeTabId）
// stores/helmPanelStore.ts   ← 面板可见性状态（panelVisibility）
// stores/approvalHubStore.ts ← 审批状态（pending/count）
```

### §11.2 状态迁移映射

| HelmLayout useState | 迁移到 zustand store | 说明 |
|---------------------|---------------------|------|
| `userMessages` | `chatStore.userMessages` | 用户消息 |
| `currentPlan` / `planLoading` / `newlyAddedSteps` | `helmPlanStore` | Plan 状态 |
| `diffFiles` / `attachments` | `chatStore` | Diff/附件 |
| `workspaceList` / `currentWorkspace` / `wsDropdownOpen` | `helmWorkspaceStore` | 工作区 |
| `openTabs` / `activeTabId` / `highlightFilePath` | `helmEditorStore` | 编辑器 Tab |
| `panelVisibility` / `chatPanelWidth` / `rightPanelWidth` | `helmPanelStore` | 面板可见性 |
| `showSettings` / `showMCPConfig` / `showAgentOrchestrator` 等 | `helmPanelStore` | 模态框可见性 |

### §11.3 状态管理设计原则

1. **单一数据源**：每个状态只在一个 store 中管理
2. **持久化**：使用 `persist` 中间件持久化关键状态（如 sidebar 宽度、面板可见性）
3. **DevTools**：所有 stores 启用 Redux DevTools 支持
4. **TypeScript 严格类型**：所有 stores 使用 TypeScript 类型注解

---

## §12 样式系统融合

### §12.1 vendor CSS 迁移清单

从 `clowder-ai/packages/web/public/vendor/app/` 复制以下 9 个 CSS 文件到 `flowforge/web/public/vendor/app/`：

1. `theme-tokens.css` — 主题令牌（CSS 变量定义）
2. `forgekin-persona-tokens.css` — Forgekin 人格令牌（重命名自 cat-persona-tokens.css）
3. `forgekin-persona-derived.css` — Forgekin 派生令牌（重命名自 cat-persona-derived.css）
4. `connector-tokens.css` — 连接器令牌
5. `theme-extras.css` — 主题扩展
6. `console-tokens.css` — 控制台令牌
7. `console-shell.css` — 控制台 Shell 样式
8. `console-controls.css` — 控制台控件样式
9. `xterm/xterm.css` — 终端样式

### §12.2 CSS 变量重命名

依据 naming-contract.md，将 clowder-ai 的 cat-cafe 相关 CSS 变量重命名为 forgekin：

| clowder-ai CSS 变量 | flowforge CSS 变量 |
|---------------------|-------------------|
| `--cat-cafe-accent` | `--forgekin-accent` |
| `--cat-persona-bg` | `--forgekin-persona-bg` |
| `--console-rail-bg` | `--console-rail-bg`（保留） |
| `--console-border-soft` | `--console-border-soft`（保留） |

### §12.3 globals.css 重构

flowforge/web 的 `globals.css` 需要：
1. 移除与 vendor CSS 重复的样式
2. 保留 FlowForge 特有的样式（如 `helm-shell-v2` 相关）
3. 添加 `data-*` 属性选择器样式（T8 测试用）

---

## §13 T8 测试根本性重构

### §13.1 V1.0 T8 测试的根本性问题

V1.0 T8 测试只验证：
- `page.goto(url)` + `query_selector_all`
- 期望文本包含
- API 响应 200

**这就是 T8 通过但界面没法用的根本原因**：测试只验证"元素存在"，没验证"用户能否完成完整任务"。

### §13.2 V3.0 T8 测试 8 层验证体系

```python
# tests/e2e/test_t8_v3.py

class T8TestSuite:
    """T8 测试 8 层验证体系"""

    # L1: 元素存在（V1.0 已有）
    async def test_l1_element_exists(self):
        """验证关键 DOM 元素存在"""
        pass

    # L2: 文本匹配（V1.0 已有）
    async def test_l2_text_match(self):
        """验证关键文本存在"""
        pass

    # L3: 布局可用性（V3.0 新增）
    async def test_l3_shell_wrapper_consistency(self):
        """所有非展示页路由必须受 ShellWrapper 保护"""
        routes = ["/", "/tasks", "/review", "/solo", "/memory", "/mission-hub",
                  "/signals", "/admin", "/admin/agents", "/admin/settings"]
        for route in routes:
            page = await browser.new_page()
            await page.goto(f"http://localhost:5174{route}", wait_until="domcontentloaded")
            shell = await page.query_selector("[data-shell='wrapper']")
            assert shell is not None, f"路由 {route} 缺失 ShellWrapper"

    async def test_l3_activity_bar_visible(self):
        """ActivityBar 在所有页面可见且 52px 宽"""
        for route in ["/", "/tasks", "/solo"]:
            page = await browser.new_page()
            await page.goto(f"http://localhost:5174{route}", wait_until="domcontentloaded")
            activity_bar = await page.query_selector("[data-activity-bar]")
            assert activity_bar is not None
            bbox = await activity_bar.bounding_box()
            assert bbox["width"] == 52, f"ActivityBar 宽度: {bbox['width']}"

    async def test_l3_no_bare_pages(self):
        """验证 /council 重定向到 /solo?mode=council"""
        page = await browser.new_page()
        await page.goto("http://localhost:5174/council", wait_until="domcontentloaded")
        assert "/solo" in page.url
        assert "mode=council" in page.url

    # L4: 交互功能（V3.0 新增）
    async def test_l4_mode_selector_switch(self):
        """4 种聊天模式切换正常"""
        page = await browser.new_page()
        await page.goto("http://localhost:5174/solo", wait_until="domcontentloaded")

        for mode in ["normal", "helm", "auto", "council"]:
            await page.click(f"[data-mode='{mode}']")
            await page.wait_for_selector(f"[data-mode-selector='container'] [data-active='true'][data-mode='{mode}']", timeout=5000)
            # 验证主聊天区组件已切换
            if mode == "council":
                await page.wait_for_selector("[data-panel='council-chat']", timeout=5000)
            else:
                await page.wait_for_selector("[data-panel='chat-stream']", timeout=5000)

    async def test_l4_settings_nav_switch(self):
        """设置中心 14 个 section 切换正常"""
        page = await browser.new_page()
        await page.goto("http://localhost:5174/admin/settings", wait_until="domcontentloaded")

        sections = ["members", "profiles", "accounts", "im", "skills", "mcp", "plugins",
                    "marketplace", "concierge", "voice", "system", "rules", "notify", "ops"]
        for section in sections:
            await page.click(f"[data-settings-nav='{section}']")
            await page.wait_for_selector(f"[data-settings-content='{section}']", timeout=5000)

    async def test_l4_agents_tab_switch(self):
        """智能体管理双 Tab 切换正常"""
        page = await browser.new_page()
        await page.goto("http://localhost:5174/admin/agents", wait_until="domcontentloaded")

        await page.click("[data-agents-tab='evolvable']")
        await page.wait_for_selector("[data-agents-content='evolvable']", timeout=5000)
        cards = await page.query_selector_all("[data-forgekin-card]")
        assert len(cards) == 5, f"Expected 5 Forgekin cards, got {len(cards)}"

        await page.click("[data-agents-tab='static']")
        await page.wait_for_selector("[data-agents-content='static']", timeout=5000)

    # L5: 视觉一致性（V3.0 新增）
    async def test_l5_visual_consistency(self):
        """所有页面视觉风格一致"""
        page = await browser.new_page()
        routes = ["/", "/tasks", "/solo", "/admin", "/admin/agents", "/admin/settings"]

        for route in routes:
            await page.goto(f"http://localhost:5174{route}", wait_until="domcontentloaded")
            bg = await page.evaluate("() => getComputedStyle(document.body).backgroundColor")
            assert bg in ["rgb(13, 13, 18)", "rgb(14, 16, 21)"], \
                f"Route {route} has invalid bg: {bg}"
            font = await page.evaluate("() => getComputedStyle(document.body).fontFamily")
            assert "sans-serif" in font, f"Route {route} has invalid font: {font}"

    # L6: 跨页面跳转（V3.0 新增）
    async def test_l6_navigation_links(self):
        """导航链接可达，回退正常"""
        page = await browser.new_page()
        await page.goto("http://localhost:5174", wait_until="domcontentloaded")

        nav_links = [
            ("/tasks", "任务列表"),
            ("/solo", "Helm Studio"),
            ("/memory", "记忆中心"),
            ("/admin", "管理中心"),
            ("/admin/agents", "智能体"),
            ("/admin/settings", "设置中心"),
        ]
        for href, label in nav_links:
            await page.click(f"a[href='{href}']")
            await page.wait_for_load_state("domcontentloaded")
            assert href in page.url, f"Failed to navigate to {href}"
            body_text = await page.evaluate("() => document.body.innerText.length")
            assert body_text > 100, f"Page {href} has too little content"

    # L7: 任务完成度（V3.0 新增 - 核心改进）
    async def test_l7_create_forgekin_task(self):
        """模拟用户完成完整任务：访问智能体管理 → 查看可进化智能体 → 切换到静态智能体"""
        page = await browser.new_page()
        await page.goto("http://localhost:5174/admin/agents", wait_until="domcontentloaded")

        # Step 1: 验证默认显示可进化智能体 Tab
        await page.wait_for_selector("[data-agents-content='evolvable']", timeout=5000)

        # Step 2: 验证 5 个 Forgekin 卡片
        cards = await page.query_selector_all("[data-forgekin-card]")
        assert len(cards) == 5

        # Step 3: 切换到静态智能体 Tab
        await page.click("[data-agents-tab='static']")
        await page.wait_for_selector("[data-agents-content='static']", timeout=5000)

        # Step 4: 验证 Tab 状态保持
        active_tab = await page.get_attribute("[data-agents-tab='static']", "data-active")
        assert active_tab == "true"

    async def test_l7_council_mode_task(self):
        """模拟用户完成完整任务：访问 Helm Studio → 切换到群聊模式 → 验证 CouncilChatPanel 渲染"""
        page = await browser.new_page()
        await page.goto("http://localhost:5174/solo", wait_until="domcontentloaded")

        # Step 1: 验证 ShellWrapper 存在
        shell = await page.query_selector("[data-shell='wrapper']")
        assert shell is not None

        # Step 2: 切换到 council 模式
        await page.click("[data-mode='council']")
        await page.wait_for_selector("[data-panel='council-chat']", timeout=5000)

        # Step 3: 验证 mode 状态
        active_mode = await page.get_attribute("[data-helm='layout']", "data-mode")
        assert active_mode == "council"

    # L8: LLM 审核 DOM（V3.0 新增 - 核心 T7 联动）
    async def test_l8_llm_audit_dom(self):
        """对关键页面截图调用 LLM 审核可用性"""
        from tests.e2e.libs.t7_llm_auditor import T7LLMAuditor

        auditor = T7LLMAuditor()
        routes_to_audit = ["/", "/solo", "/admin/agents", "/admin/settings"]

        for route in routes_to_audit:
            page = await browser.new_page()
            await page.goto(f"http://localhost:5174{route}", wait_until="domcontentloaded")
            screenshot = await page.screenshot(full_page=True)

            # 调用 LLM 审核 DOM 可用性
            audit_result = await auditor.audit_dom_usability(
                screenshot=screenshot,
                route=route,
                criteria=[
                    "布局是否完整（有顶部导航、侧边栏、主内容区）",
                    "是否有明显的视觉破损或元素重叠",
                    "是否符合现代 Web 应用的可用性标准",
                    "是否暴露了测试相关元素（如 T7/T8 字样）",
                ],
            )
            assert audit_result.passed, f"Route {route} DOM 可用性审核失败: {audit_result.reason}"
```

### §13.3 T8 测试用例总数

| 类别 | 用例数 | 说明 |
|------|-------|------|
| L1 元素存在 | 6 | V1.0 已有 |
| L2 文本匹配 | 4 | V1.0 已有 |
| L3 布局可用性 | 4 | V3.0 新增 |
| L4 交互功能 | 5 | V3.0 新增 |
| L5 视觉一致性 | 2 | V3.0 新增 |
| L6 跨页面跳转 | 3 | V3.0 新增 |
| **L7 任务完成度** | **5** | **V3.0 核心新增** |
| **L8 LLM 审核 DOM** | **4** | **V3.0 核心新增** |
| **合计** | **33** | |

### §13.4 `data-*` 标记规范

所有组件必须添加 `data-*` 标记，便于 T8 测试选择器查询：

| 组件 | 标记 | 用途 |
|------|------|------|
| ShellWrapper | `data-shell="wrapper"` | L3 布局一致性 |
| ActivityBar | `data-activity-bar` | L3 布局可用性 |
| ThreadSidebar | `data-thread-sidebar` | L3 布局可用性 |
| TopBar | `data-top-bar` | L3 布局可用性 |
| ModeSelector | `data-mode-selector="container"` | L4 交互功能 |
| ModeSelector 按钮 | `data-mode="{mode}" data-active="true/false"` | L4 交互功能 |
| HelmLayout | `data-helm="layout" data-mode="{mode}"` | L4 交互功能 |
| HelmMainPanel | `data-panel="chat-stream"` 或 `data-panel="council-chat"` | L4 交互功能 |
| AgentsPage Tab | `data-agents-tab="evolvable/static" data-active="true/false"` | L4 交互功能 |
| AgentsPage Content | `data-agents-content="evolvable/static"` | L4 交互功能 |
| ForgekinCard | `data-forgekin-card="{id}"` | L4 交互功能 |
| SettingsNav | `data-settings-nav="{section}"` | L4 交互功能 |
| SettingsContent | `data-settings-content="{section}"` | L4 交互功能 |

---

## §14 实施计划

### §14.1 Phase 1: 基础设施补全（P0）

**目标**：补全全局 Provider、vendor CSS、zustand stores

**任务**：
1. 移植 9 个 vendor CSS 文件到 `flowforge/web/public/vendor/app/`
2. 创建 `components/SessionBootstrap.tsx`
3. 创建 `components/ForgekinHueInjector.tsx`（重命名自 CatHueInjector）
4. 移植 `components/ThemeProvider.tsx` + `ThemeApplier.tsx` + `ThemeMenu.tsx`
5. 移植 `components/useConfirm.tsx`（ConfirmProvider）
6. 移植 `components/ToastContainer.tsx`
7. 移植 `components/BrakeModal.tsx`
8. 移植 `components/GuideOverlay.tsx`
9. 新建 7 个 zustand stores：chatStore / sidebarStore / helmWorkspaceStore / helmPlanStore / helmEditorStore / helmPanelStore / approvalHubStore

**验收**：layout.tsx 引入所有全局 Provider，应用启动无报错

### §14.2 Phase 2: Shell 层统一（P0）

**目标**：所有页面共享统一 Shell，杜绝裸页面

**任务**：
1. 重构 `app/layout.tsx` — 移除 `helmPaths`，改为 `chromelessPaths`，引入 9 个全局 Provider
2. 重构 `components/ShellWrapper.tsx` — 始终显示 ActivityBar/ThreadSidebar/TopBar
3. 移植 `components/ActivityBar.tsx`（从 clowder-ai）
4. 移植 `components/ThreadSidebar/`（17 个文件，从 clowder-ai）
5. 创建 `components/TopBar.tsx`
6. 移植 `components/concierge/ConciergeHost.tsx`（14 个文件）
7. 移植 `components/workspace/FloatingPresentationSurfaceHost.tsx`
8. 移植 `components/ApprovalHubDrawer.tsx`
9. 删除旧的 `components/Sidebar.tsx`（被 ThreadSidebar 替代）
10. 为 ShellWrapper 添加 `data-shell="wrapper"` 标记

**验收**：所有路由显示统一的 ActivityBar + ThreadSidebar + TopBar

### §14.3 Phase 3: HelmLayout 拆分与模式融合（P0）

**目标**：将 1425 行 HelmLayout 拆分为 8 个模块，4 种模式真正集成

**任务**：
1. 创建 4 个 zustand stores（helmWorkspaceStore / helmPlanStore / helmEditorStore / helmPanelStore）
2. 创建 6 个 hooks（useHelmWorkspace / useHelmPlan / useHelmDiff / useHelmEditor / useHelmPanels / useHelmCommands）
3. 创建 `HelmWorkspaceBar.tsx`（从原 961-1149 行拆出）
4. 创建 `HelmLeftPanel.tsx`（从原 942-956 行拆出）
5. 创建 `HelmMainPanel.tsx`（含 mode 分支逻辑）
6. 创建 `HelmRightPanel.tsx`（从原 1199-1267 行拆出）
7. 创建 `HelmModals.tsx`（从原 1273-1422 行拆出）
8. 重构 `HelmLayout.tsx`（精简到 200 行以内，使用 ModeSelector）
9. 重构 `ModeSelector.tsx`（修复命名 + 添加 `data-*` 标记）
10. 重构 `app/council/page.tsx`（重定向到 `/solo?mode=council`）

**验收**：在 `/solo` 内可切换 4 种模式，council 模式渲染 CouncilChatPanel

### §14.4 Phase 4: 智能体管理中心（P0）

**目标**：`/admin/agents` 双 Tab 设计，清晰区分可进化 vs 静态

**任务**：
1. 重构 `app/admin/agents/page.tsx` — 双 Tab 结构
2. 创建 `components/admin/agents/EvolvableAgentTab.tsx` — 5 个 Forgekin 卡片
3. 创建 `components/admin/agents/StaticAgentTab.tsx` — 静态智能体列表
4. 创建 `components/admin/agents/ForgekinCard.tsx` — Forgekin 卡片
5. 移植 `components/HubForgekinEditor.tsx` 系列（10 个子组件，重命名自 HubCatEditor）
6. 创建 `app/admin/agents/[forgekinId]/page.tsx` — Forgekin 详情页（5 Tab）
7. 在卡片添加 `data-forgekin-card` 标记

**验收**：`/admin/agents` 显示双 Tab，可进化 Tab 显示 5 个 Forgekin 卡片

### §14.5 Phase 5: 设置中心融合（P0-P1）

**目标**：clowder-ai SettingsShell 完整移植到 `/admin/settings`

**任务**：
1. 移植 `components/settings/SettingsShell.tsx` + `SettingsNav.tsx` + `SettingsContent.tsx`
2. 移植 `components/settings/settings-nav-config.ts`（14 个 section）
3. 移植 `components/settings/primitives/`（22 个基础组件）
4. 移植 14 个 section 内容组件
5. 在 SettingsNav 添加 `data-settings-nav` 标记
6. 在 SettingsContent 添加 `data-settings-content` 标记

**验收**：`/admin/settings` 显示 14 个 section，每个 section 可切换

### §14.6 Phase 6: Hub 组件移植（P1）

**目标**：将 20+ Hub 组件移植到对应路由

**任务**（按 §8.1 清单）：移植所有 Hub 组件到对应路由

**验收**：所有 Hub 组件可在对应路由访问

### §14.7 Phase 7: 缺失功能补全（P1-P2）

**目标**：补全 Memory Hub、Mission Hub、Signals、Marketplace 等

**任务**（按 §9 清单）：移植所有缺失功能到对应路由

**验收**：所有缺失功能可在对应路由访问

### §14.8 Phase 8: 后端 API 融合（P0-P1）

**目标**：将 clowder-ai 后端 API 合并到 FlowForge 8000

**任务**（按 §10.2 清单）：创建所有新 API 端点并注册到 router

**验收**：所有前端 API 调用可成功返回数据

### §14.9 Phase 9: T8 测试根本性重构（P0）

**目标**：T8 测试从 10 个用例扩展到 33 个用例，引入 8 层验证体系

**任务**：
1. 创建 `tests/e2e/test_t8_v3.py` — 8 层验证体系
2. 创建 `tests/e2e/libs/t7_llm_auditor.py` — LLM 审核 DOM 模块
3. 在所有组件添加 `data-*` 标记（便于 T8 选择器查询）
4. 编写 L7 任务完成度测试用例（5 个完整任务流程）
5. 编写 L8 LLM 审核 DOM 测试用例（4 个关键页面）

**验收**：T8 测试 33/33 通过

---

## §15 验收标准

### §15.1 功能完整性

| # | 标准 | 验证方式 |
|---|------|---------|
| F1 | 4 种聊天模式在 `/solo` 内可切换 | T8 L4 交互测试 |
| F2 | `/council` 重定向到 `/solo?mode=council` | T8 L3 布局测试 |
| F3 | `/admin/agents` 双 Tab 显示 5 个 Forgekin + N 个静态智能体 | T8 L4 交互测试 |
| F4 | `/admin/settings` 14 个 section 可切换 | T8 L4 交互测试 |
| F5 | 20+ Hub 组件在对应路由可访问 | T8 L1 元素测试 |
| F6 | Memory Hub、Mission Hub、Signals、Marketplace 可访问 | T8 L1 元素测试 |
| F7 | 所有 clowder-ai 后端 API 在 FlowForge 8000 可用 | API 测试 |
| F8 | T7/T8 测试工具在用户界面不可见 | T8 L5 视觉测试 |

### §15.2 布局可用性

| # | 标准 | 验证方式 |
|---|------|---------|
| L1 | 所有非展示页路由受 ShellWrapper 保护，无裸页面 | T8 L3 布局一致性 |
| L2 | ActivityBar 在所有页面可见且 52px 宽 | T8 L3 布局测试 |
| L3 | ThreadSidebar 在所有页面可见且可调整宽度 | T8 L3 布局测试 |
| L4 | TopBar 在所有页面可见且 52px 高 | T8 L3 布局测试 |
| L5 | HelmLayout 内 4 种模式切换不跳转路由 | T8 L4 交互测试 |

### §15.3 T8 测试通过

| # | 标准 |
|---|------|
| T1 | T8 L1 元素存在 6/6 通过 |
| T2 | T8 L2 文本匹配 4/4 通过 |
| T3 | T8 L3 布局可用性 4/4 通过 |
| T4 | T8 L4 交互功能 5/5 通过 |
| T5 | T8 L5 视觉一致性 2/2 通过 |
| T6 | T8 L6 跨页面跳转 3/3 通过 |
| T7 | T8 L7 任务完成度 5/5 通过 |
| T8 | T8 L8 LLM 审核 DOM 4/4 通过 |
| **合计** | **T8 33/33 通过** |

### §15.4 T7 测试通过

| # | 标准 |
|---|------|
| T7 | T7 LLM 审核 4/4 通过（V1.0 已有） |
| T7+ | 群聊中 Forgekin 响应携带 `llm_meta` 和 `t7_badge` |

### §15.5 命名规范

| # | 标准 |
|---|------|
| N1 | 所有代码使用 P1 项目英文名（Forgekin / ForgeMind / EchoStore 等） |
| N2 | 所有 UI 文案使用 P0 官方名称为主（"可进化智能体"而非"灵智体"） |
| N3 | 严禁在代码中出现 `cat-cafe` / `clowder` / `cat_cafe` 字样 |
| N4 | API 路径使用 `/api/v1/forgekins` 而非 `/api/cats` |

---

## §16 风险与缓解

### §16.1 技术风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| HelmLayout 1425 行拆分引入回归 | 高 | 高 | 分 8 个 Phase 逐步拆分，每 Phase 独立验收 |
| clowder-ai API 与 FlowForge API 字段不一致 | 高 | 高 | 字段映射表 + 单元测试 |
| ThreadSidebar 状态管理与 FlowForge 冲突 | 中 | 高 | 保留 zustand store，独立运行 |
| Hub 组件依赖 clowder-ai shared 包 | 高 | 中 | 提取 shared 类型到 FlowForge lib/ |
| vendor CSS 冲突 | 中 | 中 | 逐步迁移，每步验证样式 |
| T8 测试用例过多导致 CI 慢 | 中 | 低 | 分组运行，并行执行 |

### §16.2 项目风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 工作量超预期 | 高 | 高 | 分 9 个 Phase，每 Phase 独立验收 |
| operator 不满意 | 中 | 高 | 每 Phase 完成后请 operator 验收 |

---

## §17 附录

### §17.1 命名映射表（依据 naming-contract.md §9.2）

| clowder-ai 术语 | FlowForge P0 官方名称 | FlowForge P1 项目英文名 |
|----------------|---------------------|----------------------|
| Cat | Evolvable Agent | Forgekin |
| Cat Café | Agent Onboarding Platform | forgemind |
| Breed | Agent Morphology | ForgekinSpecies |
| Cat Profile | Capability Profile | CapabilityProfile |
| Cat Memory | Episodic Memory Store | EchoStore |
| Pack System | Multi-Agent Deliberation | MindCouncil |
| cat-cafe | FlowForge（外品牌） | FlowForge |
| Clowder AI | （严禁作为 FlowForge 品牌） | — |

### §17.2 文件路径映射表

| clowder-ai 路径 | flowforge 路径 |
|----------------|---------------|
| `packages/web/src/components/ActivityBar.tsx` | `flowforge/web/src/components/ActivityBar.tsx` |
| `packages/web/src/components/AppShell.tsx` | `flowforge/web/src/components/ShellWrapper.tsx`（融合） |
| `packages/web/src/components/ThreadSidebar/` | `flowforge/web/src/components/ThreadSidebar/` |
| `packages/web/src/components/ChatContainer.tsx` | `flowforge/web/src/components/helm/CouncilChatPanel.tsx`（融合） |
| `packages/web/src/components/HubCatEditor.tsx` | `flowforge/web/src/components/HubForgekinEditor.tsx`（重命名） |
| `packages/web/src/components/concierge/` | `flowforge/web/src/components/concierge/` |
| `packages/web/src/components/memory/` | `flowforge/web/src/components/memory/` |
| `packages/web/src/components/settings/` | `flowforge/web/src/components/settings/` |
| `packages/web/src/components/marketplace/` | `flowforge/web/src/components/marketplace/` |
| `packages/web/src/stores/` | `flowforge/web/src/stores/` |
| `packages/web/public/vendor/app/` | `flowforge/web/public/vendor/app/` |

### §17.3 关联文档

- [design/naming-contract.md v2.0](../docs/design/naming-contract.md) — 命名契约（权威源）
- [spec.md](../docs/spec.md) — 需求规格说明书
- [arch.md](../docs/arch.md) — 架构设计说明书
- [design.md](../docs/design.md) — 详细设计说明书
- [MERGE-SPEC.md](./MERGE-SPEC.md) — V1.0（已废弃）

### §17.4 文档维护

- **维护者**：架构师可进化智能体（猫头鹰·鲁班，Forgekin：Luban）
- **审核者**：operator（首席愿景官）+ 评审员可进化智能体（孔雀·梵高，Forgekin：Vangogh）
- **更新规则**：每次 Phase 完成后更新本文档，记录实施差异
- **变更历史**：

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| V1.0 | 2026-07-25 | 初版（MERGE-SPEC.md，已废弃） | Trae CN（agent） |
| V2.0 | 2026-07-25 | 列出清单但缺乏深度重构方案（已废弃） | Trae CN（agent） |
| V3.0 | 2026-07-25 | 基于真实代码深度分析，覆盖 HelmLayout 1425 行拆分、状态管理融合、样式系统融合、T8 测试根本性重构 | Trae CN（agent） |

---

> **审核请求**：请 operator 审核本设计文档，确认后开始 Phase 1 实施。
