"use client";

/**
 * useHelmEditor — 编辑器 Tab 状态 Hook（Phase 3 拆分）
 *
 * 管理 MarkdownPanel 所需的 OpenTab 状态（使用 MarkdownPanel.OpenTab 类型，
 * 而非 helmEditorStore.OpenTab，因为 MarkdownPanel 依赖 filePath/fileName/
 * content/originalContent/isDirty 字段）。
 *
 * 替代 HelmLayout 中的 useState：
 *   openTabs / activeTabId / highlightFilePath / showSettingsInEditor
 */

import { useState, useCallback } from "react";
import type { OpenTab } from "../MarkdownPanel";
import type { PanelVisibility } from "../../../stores/helmPanelStore";
import type { useHelmWebSocket } from "../../../hooks/useHelmWebSocket";

type HelmWS = ReturnType<typeof useHelmWebSocket>;

interface UseHelmEditorOptions {
  /** 显示指定面板（同时更新 prevPanelVisibility 以支持响应式恢复） */
  showPanel: (panel: "chat" | "editor" | "explorer") => void;
  /** 当前面板可见性 */
  panelVisibility: PanelVisibility;
}

export function useHelmEditor(helm: HelmWS, opts: UseHelmEditorOptions) {
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [highlightFilePath, setHighlightFilePath] = useState<string | null>(
    null
  );
  const [showSettingsInEditor, setShowSettingsInEditor] = useState(false);

  const handleFileOpen = useCallback(
    (filePath: string, fileName: string) => {
      // 打开文件时自动展开 editor 面板
      if (!opts.panelVisibility.editor) {
        opts.showPanel("editor");
      }

      const tabId = `tab-${filePath}`;
      const existingTab = openTabs.find((t) => t.id === tabId);

      const apiPrefix = `/api/v1/workspace/${helm.taskId}/files/`;
      const relativePath = filePath.startsWith(apiPrefix)
        ? filePath.slice(apiPrefix.length)
        : fileName;

      if (existingTab) {
        setActiveTabId(tabId);
        setHighlightFilePath(relativePath);
        return;
      }

      const newTab: OpenTab = {
        id: tabId,
        filePath,
        fileName: fileName || filePath.split(/[/\\]/).pop() || "未命名",
        content: "",
        originalContent: "",
        isDirty: false,
      };

      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
      setHighlightFilePath(relativePath);

      if (filePath.startsWith("/api/")) {
        fetch(filePath)
          .then((r) => (r.ok ? r.text() : ""))
          .then((content) => {
            if (content) {
              try {
                const data = JSON.parse(content);
                if (data.content !== undefined) {
                  const fileContent =
                    typeof data.content === "string"
                      ? data.content
                      : JSON.stringify(data.content, null, 2);
                  setOpenTabs((prev) =>
                    prev.map((t) =>
                      t.id === tabId
                        ? { ...t, content: fileContent, originalContent: fileContent }
                        : t
                    )
                  );
                  return;
                }
              } catch {
                // noop
              }
              setOpenTabs((prev) =>
                prev.map((t) =>
                  t.id === tabId
                    ? { ...t, content, originalContent: content }
                    : t
                )
              );
            }
          })
          .catch(() => {});
      } else {
        const draftContent = helm.editorContent;
        if (draftContent) {
          setOpenTabs((prev) =>
            prev.map((t) =>
              t.id === tabId
                ? { ...t, content: draftContent, originalContent: draftContent }
                : t
            )
          );
        }
      }
    },
    [openTabs, helm.editorContent, helm.taskId, opts.panelVisibility.editor, opts.showPanel]
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      setOpenTabs((prev) => prev.filter((t) => t.id !== tabId));
      if (activeTabId === tabId) {
        setActiveTabId((prev) => {
          const remaining = openTabs.filter((t) => t.id !== tabId);
          if (remaining.length > 0) {
            const closedIdx = openTabs.findIndex((t) => t.id === tabId);
            const nextIdx = Math.min(closedIdx, remaining.length - 1);
            return remaining[nextIdx].id;
          }
          return null;
        });
      }
    },
    [activeTabId, openTabs]
  );

  const handleTabSelect = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      const tab = openTabs.find((t) => t.id === tabId);
      if (tab) {
        setHighlightFilePath(tab.fileName);
      }
    },
    [openTabs]
  );

  const handleContentChange = useCallback((tabId: string, content: string) => {
    setOpenTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return { ...t, content, isDirty: content !== t.originalContent };
      })
    );
  }, []);

  const handleWorkspaceFileOpen = useCallback(
    (filePath: string, fileName: string) => {
      handleFileOpen(filePath, fileName);
      // 从 explorer 打开时自动展开 explorer 面板
      if (!opts.panelVisibility.explorer) {
        opts.showPanel("explorer");
      }
      const apiPrefix = `/api/v1/workspace/${helm.taskId}/files/`;
      const relativePath = filePath.startsWith(apiPrefix)
        ? filePath.slice(apiPrefix.length)
        : fileName;
      setHighlightFilePath(relativePath);
    },
    [handleFileOpen, helm.taskId, opts.panelVisibility.explorer, opts.showPanel]
  );

  const handleSettingsClick = useCallback(() => {
    setShowSettingsInEditor(true);
    opts.showPanel("editor");
  }, [opts.showPanel]);

  const clearTabs = useCallback(() => {
    setOpenTabs([]);
    setActiveTabId(null);
    setHighlightFilePath(null);
  }, []);

  return {
    openTabs,
    setOpenTabs,
    activeTabId,
    setActiveTabId,
    highlightFilePath,
    setHighlightFilePath,
    showSettingsInEditor,
    setShowSettingsInEditor,
    handleFileOpen,
    handleTabClose,
    handleTabSelect,
    handleContentChange,
    handleWorkspaceFileOpen,
    handleSettingsClick,
    clearTabs,
  };
}
