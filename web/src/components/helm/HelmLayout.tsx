"use client";

/**
 * HelmLayout — FlowForge Helm 主布局（Phase 3 模块化重构）
 * 重构前：1446 行 / 50+ useState → 重构后：≤250 行
 * 状态委托给 hooks/stores，渲染委托给 5 个子组件。
 *
 * 重构说明（v2）：
 *   - /solo 路由专注 Helm 单 Agent 模式
 *   - 群聊（council）已迁移到 /council 独立路由（使用 移植 UI）
 *   - URL 参数 ?mode=council 会触发重定向到 /council
 *   - ?mode=normal 和 ?mode=auto 已废弃，静默映射为 helm
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useHelmWebSocket } from "../../hooks/useHelmWebSocket";
import { useShellConfig } from "../../lib/shell-config";
import { useHelmWorkspaceStore } from "../../stores/helmWorkspaceStore";
import { useHelmPanelStore } from "../../stores/helmPanelStore";
import { appendTaskHistory } from "./helm-utils";
import { ChatMessage } from "./helm-types";
import { ResizeHandle } from "./ChatPrimitives";
import type { HelmMode } from "./ModeSelector";
import HelmLeftPanel from "./HelmLeftPanel";
import HelmWorkspaceBar from "./HelmWorkspaceBar";
import HelmMainPanel from "./HelmMainPanel";
import HelmRightPanel from "./HelmRightPanel";
import HelmModals from "./HelmModals";
import { useHelmWorkspace } from "./hooks/useHelmWorkspace";
import { useHelmPanels } from "./hooks/useHelmPanels";
import { useHelmPlan } from "./hooks/useHelmPlan";
import { useHelmDiff } from "./hooks/useHelmDiff";
import { useHelmEditor } from "./hooks/useHelmEditor";
import { useHelmCommands } from "./hooks/useHelmCommands";

export default function HelmLayout() {
  /* ── Solo 模式：仅 Helm，council 重定向到 /council ── */
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlMode = searchParams?.get("mode") as HelmMode | null;

  // council → 重定向到 /council 独立路由
  useEffect(() => {
    if (urlMode === "council") {
      router.replace("/council");
    }
  }, [urlMode, router]);

  // normal/auto 静默映射为 helm
  const initialMode: HelmMode = urlMode === "council" ? "helm" : "helm";
  const [mode, setMode] = useState<HelmMode>(initialMode);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [resumePrompt, setResumePrompt] = useState<{ task_id: string; intent: string } | null>(null);

  const config = useShellConfig();
  const helm = useHelmWebSocket({
    onDraftUpdate: (content, isPartial) => { if (!isPartial) helm.updateEditor(content); },
  });
  const panels = useHelmPanels();
  const plan = useHelmPlan(helm);
  const diff = useHelmDiff(helm);
  const editor = useHelmEditor(helm, { showPanel: panels.showPanel, panelVisibility: panels.panelVisibility });

  const resetChat = useCallback(() => { helm.resetState(); setUserMessages([]); }, [helm]);
  const resetAll = useCallback(() => { helm.resetState(); setUserMessages([]); editor.clearTabs(); }, [helm, editor]);

  const workspace = useHelmWorkspace({ helm, resetAll, setRefreshCounter, setWorkspaceRefreshKey });

  const { handleCommand } = useHelmCommands({
    helm,
    panelVisibility: panels.panelVisibility,
    togglePanel: panels.togglePanel, showPanel: panels.showPanel,
    setShowSettings: panels.setShowSettings, setShowSpecPanel: panels.setShowSpecPanel,
    setShowAgentOrchestrator: panels.setShowAgentOrchestrator, setShowWorktreePanel: panels.setShowWorktreePanel,
    attachments: diff.attachments, diffFiles: diff.diffFiles,
    setDiffFiles: diff.setDiffFiles, setAttachments: diff.setAttachments,
    setUserMessages, setCurrentPlan: plan.setCurrentPlan, setPlanLoading: plan.setPlanLoading,
  });

  const elapsed = useMemo(() => helm.startTime ? Math.floor((Date.now() - helm.startTime) / 1000) : 0, [helm.startTime, helm.phase]);

  // 任务历史记录 + 完成时刷新计数
  useEffect(() => {
    if (helm.taskId && helm.phase !== "idle" && helm.phase !== "creating" && helm.phase !== "connecting") {
      appendTaskHistory(config.brandName.toLowerCase(), { taskId: helm.taskId, persona: helm.persona, intent: helm.intent, phase: helm.phase, timestamp: Date.now() });
    }
    if (helm.phase === "completed" || helm.phase === "error" || helm.phase === "interrupted") setRefreshCounter((c) => c + 1);
  }, [helm.taskId, helm.phase, config.brandName]);

  // 完成时更新工作区状态
  useEffect(() => {
    if (helm.taskId && helm.phase === "completed") {
      fetch(`/api/v1/workspace/${helm.taskId}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) }).catch(() => {});
    }
  }, [helm.taskId, helm.phase]);

  // 完成时刷新工作区列表
  useEffect(() => {
    if (helm.phase === "completed" || helm.phase === "error" || helm.phase === "interrupted") useHelmWorkspaceStore.getState().fetchWorkspaceList();
  }, [helm.phase]);

  // 检测未完成任务
  useEffect(() => {
    fetch("/api/v1/workspace/incomplete").then((r) => (r.ok ? r.json() : { tasks: [] })).then((data) => {
      const tasks = data.tasks || [];
      if (tasks.length > 0) { const t = tasks[0]; setResumePrompt({ task_id: t.task_id, intent: t.intent || t.task_id }); }
    }).catch(() => {});
  }, []);

  const onRefreshTask = useCallback(() => {
    if (!helm.taskId) return;
    fetch(`/api/v1/tasks/${helm.taskId}`).then((r) => r.json()).then((d) => {
      if (d?.data?.status === "completed") helm.restoreTask(helm.taskId!, helm.intent || "", helm.persona || "default", "completed");
    }).catch(() => {});
  }, [helm]);

  return (
    <div className="helm-shell-v2" data-helm="layout" data-mode={mode}>
      <HelmLeftPanel
        phase={helm.phase} intent={helm.intent} taskId={helm.taskId} elapsed={elapsed}
        workspaceName={workspace.currentWorkspace}
        onNewTask={resetChat}
        onRestoreChat={(msgs) => setUserMessages(msgs)}
        onSwitchTask={(tid, intent, persona, phase) => { setUserMessages([]); helm.restoreTask(tid, intent, persona, phase); }}
        refreshTrigger={refreshCounter} workspaceRefreshKey={workspaceRefreshKey}
      />

      {panels.panelVisibility.chat && (
        <>
          <div className="helm-chat-panel" style={{ width: panels.chatPanelWidth, minWidth: 200, maxWidth: 400 }}>
            <HelmWorkspaceBar
              mode={mode} setMode={setMode} brandName={config.brandName}
              onSwitchWorkspace={workspace.onSwitchWorkspace} onDeleteWorkspace={workspace.onDeleteWorkspace}
              onCreateWorkspace={workspace.onCreateWorkspace} onBrowseDirectory={workspace.onBrowseDirectory}
            />
            <HelmMainPanel
              mode={mode} setMode={setMode} selectedWorkflow={selectedWorkflow} setSelectedWorkflow={setSelectedWorkflow}
              helm={helm} brandName={config.brandName} plan={plan} diff={diff}
              onFileOpen={editor.handleFileOpen} selectedModel={selectedModel} setSelectedModel={setSelectedModel}
              userMessages={userMessages} setUserMessages={setUserMessages} onCommand={handleCommand}
              resumePrompt={resumePrompt}
              onResumePrompt={() => { if (resumePrompt) { helm.restoreTask(resumePrompt.task_id, resumePrompt.intent, "default", "running"); setResumePrompt(null); } }}
              onDismissResumePrompt={() => setResumePrompt(null)}
              onRefreshTask={onRefreshTask} onClearChat={resetChat}
            />
          </div>
          <ResizeHandle onResize={(dx) => {
            const w = useHelmPanelStore.getState().chatPanelWidth;
            useHelmPanelStore.getState().setChatPanelWidth(Math.max(200, Math.min(400, w + dx)));
          }} />
        </>
      )}

      <HelmRightPanel
        phase={helm.phase} taskId={helm.taskId} workspaceName={workspace.currentWorkspace}
        openTabs={editor.openTabs} activeTabId={editor.activeTabId} highlightFilePath={editor.highlightFilePath}
        showSettingsInEditor={editor.showSettingsInEditor}
        onTabSelect={editor.handleTabSelect} onTabClose={editor.handleTabClose}
        onContentChange={editor.handleContentChange} onWorkspaceFileOpen={editor.handleWorkspaceFileOpen}
        onCloseSettings={() => editor.setShowSettingsInEditor(false)} onOpenSettings={editor.handleSettingsClick}
        diffFiles={diff.diffFiles}
        onAcceptDiffFile={diff.removeDiffFile} onRejectDiffFile={diff.removeDiffFile}
        onRevertAllDiffs={diff.clearDiffFiles}
      />

      <HelmModals selectedModel={selectedModel} />
    </div>
  );
}
