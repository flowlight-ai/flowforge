/**
 * FlowForge Web — Zustand Stores 统一出口
 *
 * 设计原则：
 *   - 单一数据源：每个状态只在一个 store 中管理
 *   - 持久化：关键状态（sidebar 宽度、面板宽度）通过 localStorage 持久化
 *   - 可测试：所有状态变更通过 actions 显式触发
 *   - TypeScript 严格类型：所有 stores 使用 TypeScript 类型注解
 *
 * 8 个 stores：
 *   1. sidebarStore       — 左侧 ThreadSidebar 状态
 *   2. chatStore          — 聊天消息、附件、Diff
 *   3. helmWorkspaceStore — HelmLayout 工作区
 *   4. helmPlanStore      — Plan 任务执行计划
 *   5. helmEditorStore    — 右侧编辑器 Tab
 *   6. helmPanelStore     — 面板可见性、模态框开关
 *   7. approvalHubStore   — 审批中心
 *   8. threadStore        — 群聊会话管理（CRUD + 持久化）
 */

export { useSidebarStore } from "./sidebarStore";
export type { SidebarState } from "./sidebarStore";

export { useChatStore } from "./chatStore";
export type { ChatMessage, Attachment, DiffFile, ChatState } from "./chatStore";

export { useHelmWorkspaceStore } from "./helmWorkspaceStore";
export type { WorkspaceItem, DirBrowserItem, HelmWorkspaceState } from "./helmWorkspaceStore";

export { useHelmPlanStore } from "./helmPlanStore";
export type { PlanStep, Plan, HelmPlanState } from "./helmPlanStore";

export { useHelmEditorStore } from "./helmEditorStore";
export type { OpenTab, HelmEditorState } from "./helmEditorStore";

export { useHelmPanelStore } from "./helmPanelStore";
export type { PanelVisibility, TerminalCommand, HelmPanelState } from "./helmPanelStore";

export { useApprovalHubStore } from "./approvalHubStore";
export type { ApprovalItem, ApprovalStatus, ApprovalHubState } from "./approvalHubStore";

export { useThreadStore } from "./threadStore";
export type { Thread, ThreadStoreState } from "./threadStore";
