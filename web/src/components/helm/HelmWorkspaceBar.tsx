"use client";

/**
 * HelmWorkspaceBar — 工作区选择器栏（Phase 3 拆分）
 *
 * 从 HelmLayout 拆出，包含：
 *   - 工作区下拉选择器
 *   - 新建工作区输入框
 *   - 目录浏览器触发按钮
 *   - 群聊模式切换按钮
 *
 * 状态来源：useHelmWorkspaceStore（zustand 单例 store）
 */

import { useHelmWorkspaceStore, type WorkspaceItem } from "../../stores/helmWorkspaceStore";
import type { HelmMode } from "./ModeSelector";

interface HelmWorkspaceBarProps {
  mode: HelmMode;
  setMode: (mode: HelmMode) => void;
  brandName: string;
  onSwitchWorkspace: (ws: WorkspaceItem) => void;
  onDeleteWorkspace: (ws: WorkspaceItem) => void;
  onCreateWorkspace: (name: string, isFullPath: boolean) => void;
  onBrowseDirectory: () => void;
}

export default function HelmWorkspaceBar({
  mode,
  setMode,
  brandName,
  onSwitchWorkspace,
  onDeleteWorkspace,
  onCreateWorkspace,
  onBrowseDirectory,
}: HelmWorkspaceBarProps) {
  const {
    currentWorkspace,
    workspaceList,
    wsDropdownOpen,
    setWsDropdownOpen,
    newWorkspaceName,
    setNewWorkspaceName,
    showNewWorkspaceInput,
    setShowNewWorkspaceInput,
  } = useHelmWorkspaceStore();

  return (
    <div
      className="helm-workspace-selector"
      data-ws-dropdown
      style={{ display: "flex", alignItems: "center", gap: 4 }}
    >
      <button
        className="helm-ws-trigger"
        onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
        style={{ flex: 1, minWidth: 0 }}
      >
        <span className="helm-ws-trigger-icon">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        <span className="helm-ws-trigger-name">
          {currentWorkspace || `${brandName} Helm`}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`helm-ws-chevron${wsDropdownOpen ? " open" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* 群聊模式切换按钮 */}
      <button
        type="button"
        className="helm-council-link"
        title="切换到群聊模式（5 个可进化智能体协作）"
        onClick={() => setMode("council")}
        aria-pressed={mode === "council"}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 6,
          background:
            mode === "council"
              ? "rgba(16,185,129,0.35)"
              : "rgba(16,185,129,0.15)",
          border: "1px solid rgba(16,185,129,0.3)",
          color: "#10b981",
          fontSize: 14,
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        data-helm-mode-toggle="council"
      >
        👥
      </button>

      {wsDropdownOpen && (
        <div className="helm-ws-dropdown">
          <div className="helm-ws-dropdown-header">
            <span>工作区</span>
            <button
              className="helm-ws-new-btn"
              onClick={() => setShowNewWorkspaceInput(!showNewWorkspaceInput)}
              title="新建工作区"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          {showNewWorkspaceInput && (
            <div className="helm-ws-new-input-row">
              <input
                className="helm-ws-new-input"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="名称或完整路径（如 D:\\myproject）"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newWorkspaceName.trim()) {
                    const input = newWorkspaceName.trim();
                    const isFullPath =
                      /^[A-Za-z]:\\/.test(input) ||
                      input.startsWith("/") ||
                      input.includes("\\");
                    onCreateWorkspace(input, isFullPath);
                  }
                  if (e.key === "Escape") {
                    setShowNewWorkspaceInput(false);
                    setNewWorkspaceName("");
                  }
                }}
                autoFocus
              />
              <button
                className="helm-ws-browse-btn"
                onClick={onBrowseDirectory}
                title="浏览本地目录"
              >
                📂
              </button>
            </div>
          )}

          <div className="helm-ws-dropdown-list">
            {workspaceList.length === 0 ? (
              <div className="helm-ws-empty">暂无工作区</div>
            ) : (
              workspaceList.map((ws) => (
                <div
                  key={ws.name}
                  className={`helm-ws-item${
                    ws.name === currentWorkspace ? " active" : ""
                  }`}
                  onClick={() => onSwitchWorkspace(ws)}
                >
                  <span className="helm-ws-item-status">
                    <span className="ws-status-dot" />
                  </span>
                  <span className="helm-ws-item-name">
                    <span className="helm-ws-item-wsname">
                      {ws.display_name || ws.name}
                    </span>
                    <span className="helm-ws-item-path">{ws.path}</span>
                  </span>
                  <span className="helm-ws-item-task-count">
                    {ws.task_count || 0}
                  </span>
                  <button
                    className="helm-ws-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWorkspace(ws);
                    }}
                    title="删除工作区"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
