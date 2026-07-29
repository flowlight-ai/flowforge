"use client";

/**
 * HelmRightPanel — 右侧面板（Phase 3 拆分）
 *
 * 从 HelmLayout 拆出，包含：
 *   - 编辑器面板（MarkdownPanel / BrowserPreview / SpecPanel 三选一）
 *   - 资源管理器面板（WorkspacePanel / AgentOrchestrator / WorktreePanel 三选一）
 *   - 面板间的 ResizeHandle
 *
 * 面板可见性 + 模态框开关来自 useHelmPanelStore（zustand 单例 store）。
 * 编辑器 Tab / Diff 状态由父组件通过 props 传入（useState hook 单实例）。
 */

import dynamic from "next/dynamic";
import { useHelmPanelStore } from "../../stores/helmPanelStore";
import { ResizeHandle } from "./ChatPrimitives";
import MarkdownPanel, { type OpenTab } from "./MarkdownPanel";
import WorkspacePanel from "./WorkspacePanel";
import { type DiffFile } from "./DiffViewer";
import type { HelmTaskPhase } from "../../lib/helm-types";

const BrowserPreview = dynamic(() => import("./BrowserPreview"), { ssr: false });
const SpecPanel = dynamic(() => import("./SpecPanel"), { ssr: false });
const AgentOrchestrator = dynamic(() => import("./AgentOrchestrator"), {
  ssr: false,
});
const WorktreePanel = dynamic(() => import("./WorktreePanel"), { ssr: false });

interface HelmRightPanelProps {
  phase: HelmTaskPhase;
  taskId: string | null;
  workspaceName: string;
  // 编辑器 Tab 状态
  openTabs: OpenTab[];
  activeTabId: string | null;
  highlightFilePath: string | null;
  showSettingsInEditor: boolean;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onContentChange: (tabId: string, content: string) => void;
  onWorkspaceFileOpen: (filePath: string, fileName: string) => void;
  onCloseSettings: () => void;
  onOpenSettings: () => void;
  // Diff 状态
  diffFiles: DiffFile[];
  onAcceptDiffFile: (filePath: string) => void;
  onRejectDiffFile: (filePath: string) => void;
  onRevertAllDiffs: () => void;
}

export default function HelmRightPanel({
  phase,
  taskId,
  workspaceName,
  openTabs,
  activeTabId,
  highlightFilePath,
  showSettingsInEditor,
  onTabSelect,
  onTabClose,
  onContentChange,
  onWorkspaceFileOpen,
  onCloseSettings,
  onOpenSettings,
  diffFiles,
  onAcceptDiffFile,
  onRejectDiffFile,
  onRevertAllDiffs,
}: HelmRightPanelProps) {
  const {
    panelVisibility,
    togglePanel,
    showBrowserPreview,
    showSpecPanel,
    showAgentOrchestrator,
    showWorktreePanel,
    browserUrl,
    setBrowserUrl,
    rightPanelWidth,
    setRightPanelWidth,
  } = useHelmPanelStore();

  return (
    <>
      {/* 编辑器面板（始终渲染，不可见时加 collapsed 类） */}
      <div
        className={`helm-editor-panel${
          !panelVisibility.editor ? " collapsed" : ""
        }`}
      >
        {showBrowserPreview ? (
          <BrowserPreview
            url={browserUrl}
            onNavigate={(url) => setBrowserUrl(url)}
          />
        ) : showSpecPanel ? (
          <SpecPanel spec="" tasks={[]} checklist={[]} onUpdate={() => {}} />
        ) : (
          <MarkdownPanel
            tabs={openTabs}
            activeTabId={activeTabId}
            onTabSelect={onTabSelect}
            onTabClose={onTabClose}
            onContentChange={onContentChange}
            phase={phase}
            showSettings={showSettingsInEditor}
            onCloseSettings={onCloseSettings}
            panelVisibility={panelVisibility}
            onTogglePanel={(panel) => togglePanel(panel)}
            onOpenSettings={onOpenSettings}
            collapsed={!panelVisibility.editor}
            diffFiles={diffFiles}
            onAcceptDiffFile={onAcceptDiffFile}
            onRejectDiffFile={onRejectDiffFile}
            onRevertAllDiffs={onRevertAllDiffs}
          />
        )}
      </div>

      {/* 资源管理器面板（条件渲染） */}
      {panelVisibility.explorer && (
        <>
          <ResizeHandle
            onResize={(dx) => {
              const current = useHelmPanelStore.getState().rightPanelWidth;
              setRightPanelWidth(Math.max(180, Math.min(400, current - dx)));
            }}
          />
          <div
            className="helm-explorer-panel"
            style={{
              width: rightPanelWidth,
              minWidth: 180,
              maxWidth: 400,
            }}
          >
            {showAgentOrchestrator ? (
              <AgentOrchestrator
                agents={[]}
                onToggle={() => {}}
                onConfigure={() => {}}
                onReorder={() => {}}
              />
            ) : showWorktreePanel ? (
              <WorktreePanel
                worktrees={[]}
                onCreate={() => {}}
                onSwitch={() => {}}
                onDelete={() => {}}
              />
            ) : (
              <WorkspacePanel
                taskId={taskId}
                workspaceName={workspaceName}
                onFileOpen={onWorkspaceFileOpen}
                highlightFilePath={highlightFilePath}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}
