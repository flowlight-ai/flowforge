/**
 * Helm Editor Store (Zustand)
 *
 * 职责：管理右侧编辑器面板的 Tab 状态
 *
 * 替代 HelmLayout 中的 useState：
 *   - openTabs / activeTabId / highlightFilePath / showSettingsInEditor
 */

import { create } from "zustand";

export interface OpenTab {
  /** Tab 唯一 ID（通常是文件路径） */
  id: string;
  /** Tab 标题（文件名） */
  title: string;
  /** Tab 类型 */
  type: "file" | "diff" | "settings" | "spec" | "markdown" | "browser";
  /** 文件路径（type=file/diff 时） */
  filePath?: string;
  /** Tab 内容（type=markdown 时） */
  content?: string;
  /** 是否可关闭 */
  closable?: boolean;
  /** Tab 图标（emoji 或 icon name） */
  icon?: string;
}

export interface HelmEditorState {
  /** 已打开的 Tab 列表 */
  openTabs: OpenTab[];
  /** 当前激活的 Tab ID */
  activeTabId: string | null;
  /** 高亮显示的文件路径（用于 diff 视图定位） */
  highlightFilePath: string | null;
  /** 是否在编辑器中显示设置面板 */
  showSettingsInEditor: boolean;

  /** 打开新 Tab（如已存在则激活） */
  openTab: (tab: OpenTab) => void;
  /** 关闭 Tab */
  closeTab: (id: string) => void;
  /** 关闭其他 Tab */
  closeOtherTabs: (id: string) => void;
  /** 关闭所有 Tab */
  closeAllTabs: () => void;
  /** 激活 Tab */
  setActiveTab: (id: string) => void;
  /** 更新 Tab 内容 */
  updateTabContent: (id: string, content: string) => void;
  /** 设置高亮文件路径 */
  setHighlightFilePath: (path: string | null) => void;
  /** 切换设置面板显示 */
  setShowSettingsInEditor: (show: boolean) => void;
  /** 重置 */
  reset: () => void;
}

export const useHelmEditorStore = create<HelmEditorState>((set, get) => ({
  openTabs: [],
  activeTabId: null,
  highlightFilePath: null,
  showSettingsInEditor: false,

  openTab: (tab) =>
    set((state) => {
      const existing = state.openTabs.find((t) => t.id === tab.id);
      if (existing) {
        // 已存在则激活，并合并更新
        return {
          openTabs: state.openTabs.map((t) =>
            t.id === tab.id ? { ...t, ...tab } : t
          ),
          activeTabId: tab.id,
        };
      }
      return {
        openTabs: [...state.openTabs, tab],
        activeTabId: tab.id,
      };
    }),

  closeTab: (id) =>
    set((state) => {
      const newTabs = state.openTabs.filter((t) => t.id !== id);
      const newActive =
        state.activeTabId === id
          ? newTabs.length > 0
            ? newTabs[newTabs.length - 1].id
            : null
          : state.activeTabId;
      return { openTabs: newTabs, activeTabId: newActive };
    }),

  closeOtherTabs: (id) =>
    set((state) => ({
      openTabs: state.openTabs.filter((t) => t.id === id),
      activeTabId: id,
    })),

  closeAllTabs: () => set({ openTabs: [], activeTabId: null }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTabContent: (id, content) =>
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.id === id ? { ...t, content } : t
      ),
    })),

  setHighlightFilePath: (path) => set({ highlightFilePath: path }),

  setShowSettingsInEditor: (show) => set({ showSettingsInEditor: show }),

  reset: () =>
    set({
      openTabs: [],
      activeTabId: null,
      highlightFilePath: null,
      showSettingsInEditor: false,
    }),
}));
