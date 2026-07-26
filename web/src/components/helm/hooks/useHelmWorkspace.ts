"use client";

/**
 * useHelmWorkspace — 工作区状态 + 操作 Hook（Phase 3 拆分）
 *
 * 封装 helmWorkspaceStore，补充：
 *   - 挂载时拉取工作区列表 + 60 秒轮询
 *   - 点击外部关闭工作区下拉菜单
 *   - 工作区操作回调（切换/删除/新建/浏览目录）
 *
 * 替代 HelmLayout 中的 useState + 工作区操作回调。
 */

import { useEffect, useCallback } from "react";
import {
  useHelmWorkspaceStore,
  type WorkspaceItem,
} from "../../../stores/helmWorkspaceStore";
import type { useHelmWebSocket } from "../../../hooks/useHelmWebSocket";

type HelmWS = ReturnType<typeof useHelmWebSocket>;

interface UseHelmWorkspaceOptions {
  helm: HelmWS;
  resetAll: () => void;
  setRefreshCounter: React.Dispatch<React.SetStateAction<number>>;
  setWorkspaceRefreshKey: React.Dispatch<React.SetStateAction<number>>;
}

export function useHelmWorkspace(opts?: UseHelmWorkspaceOptions) {
  const store = useHelmWorkspaceStore();

  // 挂载时拉取工作区列表 + 60 秒轮询
  useEffect(() => {
    store.fetchWorkspaceList();
    const interval = setInterval(() => {
      useHelmWorkspaceStore.getState().fetchWorkspaceList();
    }, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 点击外部关闭 wsDropdown（通过 data-ws-dropdown 标记定位容器）
  useEffect(() => {
    if (!store.wsDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const el = document.querySelector("[data-ws-dropdown]");
      if (el && !el.contains(e.target as Node)) {
        useHelmWorkspaceStore.getState().setWsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [store.wsDropdownOpen]);

  // ── 工作区操作回调（需要 deps） ──
  const onSwitchWorkspace = useCallback(
    (ws: WorkspaceItem) => {
      if (!opts) return;
      const wsStore = useHelmWorkspaceStore.getState();
      wsStore.setCurrentWorkspace(ws.name);
      wsStore.setWsDropdownOpen(false);
      opts.resetAll();
      fetch(`/api/v1/workspace/named/${ws.name}/tasks`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const tasks = data?.tasks || [];
          if (tasks.length > 0) {
            const latest = tasks.sort((a: any, b: any) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()
            )[0];
            opts.helm.restoreTask(
              latest.task_id,
              latest.intent || latest.task_id,
              latest.persona || "default",
              "completed"
            );
          }
        })
        .catch(() => {});
      useHelmWorkspaceStore.getState().fetchWorkspaceList();
      opts.setRefreshCounter((c) => c + 1);
      opts.setWorkspaceRefreshKey((k) => k + 1);
    },
    [opts]
  );

  const onDeleteWorkspace = useCallback(
    (ws: WorkspaceItem) => {
      if (!opts || ws.name === "default") return;
      fetch(`/api/v1/workspace/named/${ws.name}`, { method: "DELETE" }).then(
        () => {
          const wsStore = useHelmWorkspaceStore.getState();
          wsStore.fetchWorkspaceList();
          if (ws.name === wsStore.currentWorkspace) {
            wsStore.setCurrentWorkspace("default");
            opts.resetAll();
          }
        }
      );
    },
    [opts]
  );

  const onCreateWorkspace = useCallback(
    (name: string, isFullPath: boolean) => {
      if (!opts) return;
      const body = isFullPath
        ? {
            name: name.split(/[/\\]/).filter(Boolean).pop() || name,
            path: name,
          }
        : { name };
      fetch("/api/v1/workspace/named", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(() => {
        const wsStore = useHelmWorkspaceStore.getState();
        wsStore.setCurrentWorkspace(body.name);
        wsStore.setNewWorkspaceName("");
        wsStore.setShowNewWorkspaceInput(false);
        wsStore.fetchWorkspaceList();
        opts.resetAll();
      });
    },
    [opts]
  );

  const onBrowseDirectory = useCallback(() => {
    fetch("/api/v1/system/browse-directory", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const wsStore = useHelmWorkspaceStore.getState();
        wsStore.setDirBrowserItems(data?.roots || []);
        wsStore.setDirBrowserPath("");
        wsStore.setShowDirBrowser(true);
      })
      .catch(() => {});
  }, []);

  return {
    ...store,
    onSwitchWorkspace,
    onDeleteWorkspace,
    onCreateWorkspace,
    onBrowseDirectory,
  };
}
