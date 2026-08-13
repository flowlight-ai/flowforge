/**
 * Helm Workspace Store (Zustand)
 *
 * 职责：管理工作区（workspace）列表、当前工作区、新建工作区对话框
 *
 * 替代 HelmLayout 中的 useState：
 *   - workspaceList / currentWorkspace / wsDropdownOpen
 *   - newWorkspaceName / showNewWorkspaceInput
 *   - showDirBrowser / dirBrowserItems / dirBrowserPath
 */

import { create } from "zustand";

export interface WorkspaceItem {
  name: string;
  display_name: string;
  path: string;
  task_count: number;
  created_at: string;
}

export interface DirBrowserItem {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface HelmWorkspaceState {
  /** 工作区列表 */
  workspaceList: WorkspaceItem[];
  /** 当前工作区名称 */
  currentWorkspace: string;
  /** 工作区下拉菜单是否展开 */
  wsDropdownOpen: boolean;
  /** 新建工作区输入框值 */
  newWorkspaceName: string;
  /** 是否显示新建工作区输入框 */
  showNewWorkspaceInput: boolean;
  /** 是否显示目录浏览器 */
  showDirBrowser: boolean;
  /** 目录浏览器条目 */
  dirBrowserItems: DirBrowserItem[];
  /** 目录浏览器当前路径 */
  dirBrowserPath: string;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 设置工作区列表 */
  setWorkspaceList: (list: WorkspaceItem[]) => void;
  /** 设置当前工作区 */
  setCurrentWorkspace: (name: string) => void;
  /** 切换下拉菜单 */
  setWsDropdownOpen: (open: boolean) => void;
  /** 设置新建工作区名称 */
  setNewWorkspaceName: (name: string) => void;
  /** 切换新建工作区输入框显示 */
  setShowNewWorkspaceInput: (show: boolean) => void;
  /** 切换目录浏览器显示 */
  setShowDirBrowser: (show: boolean) => void;
  /** 设置目录浏览器条目 */
  setDirBrowserItems: (items: DirBrowserItem[]) => void;
  /** 设置目录浏览器路径 */
  setDirBrowserPath: (path: string) => void;
  /** 从后端拉取工作区列表 */
  fetchWorkspaceList: () => Promise<void>;
  /** 创建新工作区 */
  createWorkspace: (name: string) => Promise<boolean>;
  /** 重置状态 */
  reset: () => void;
}

export const useHelmWorkspaceStore = create<HelmWorkspaceState>((set, get) => ({
  workspaceList: [],
  currentWorkspace: "default",
  wsDropdownOpen: false,
  newWorkspaceName: "",
  showNewWorkspaceInput: false,
  showDirBrowser: false,
  dirBrowserItems: [],
  dirBrowserPath: "",
  loading: false,
  error: null,

  setWorkspaceList: (list) => {
    // 按 created_at 倒序排序
    const sorted = [...list].sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || "")
    );
    set({ workspaceList: sorted });
    // 如果当前工作区不在列表中，切换到 default
    const { currentWorkspace } = get();
    if (sorted.length > 0 && !sorted.find((w) => w.name === currentWorkspace)) {
      set({ currentWorkspace: "default" });
    }
  },

  setCurrentWorkspace: (name) => set({ currentWorkspace: name }),

  setWsDropdownOpen: (open) => set({ wsDropdownOpen: open }),

  setNewWorkspaceName: (name) => set({ newWorkspaceName: name }),

  setShowNewWorkspaceInput: (show) => set({ showNewWorkspaceInput: show }),

  setShowDirBrowser: (show) => set({ showDirBrowser: show }),

  setDirBrowserItems: (items) => set({ dirBrowserItems: items }),

  setDirBrowserPath: (path) => set({ dirBrowserPath: path }),

  fetchWorkspaceList: async () => {
    set({ loading: true, error: null });
    try {
      const r = await fetch("/api/v1/workspace/named");
      if (!r.ok) {
        set({ workspaceList: [], loading: false });
        return;
      }
      const data = await r.json();
      const workspaces = (data?.workspaces || []) as WorkspaceItem[];
      get().setWorkspaceList(workspaces);
      set({ loading: false });
    } catch (err) {
      set({ workspaceList: [], loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  createWorkspace: async (name) => {
    if (!name.trim()) return false;
    try {
      const r = await fetch("/api/v1/workspace/named", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!r.ok) {
        set({ error: `Create workspace failed: ${r.status}` });
        return false;
      }
      await get().fetchWorkspaceList();
      set({ currentWorkspace: name.trim(), newWorkspaceName: "", showNewWorkspaceInput: false });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  reset: () =>
    set({
      wsDropdownOpen: false,
      newWorkspaceName: "",
      showNewWorkspaceInput: false,
      showDirBrowser: false,
      dirBrowserItems: [],
      dirBrowserPath: "",
    }),
}));
