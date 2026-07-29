/**
 * Sidebar Store (Zustand)
 *
 * 来源：clowder-ai/packages/web/src/stores/sidebarStore.ts
 * 职责：管理左侧 ThreadSidebar 的展开/折叠、宽度、调整逻辑
 *
 * 设计原则：
 *   - 单一数据源：所有 sidebar 状态都来自此 store
 *   - 持久化：宽度通过 localStorage 持久化
 *   - 可测试：所有状态变更通过 actions 显式触发
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SidebarState {
  /** 是否展开（false = 折叠为 0 宽度） */
  isOpen: boolean;
  /** 当前宽度（px） */
  width: number;
  /** 最小宽度 */
  minWidth: number;
  /** 最大宽度 */
  maxWidth: number;
  /** 上次宽度（用于折叠后恢复） */
  lastWidth: number;

  /** 展开 sidebar */
  open: () => void;
  /** 折叠 sidebar */
  close: () => void;
  /** 切换展开/折叠 */
  toggle: () => void;
  /** 设置宽度（带边界约束） */
  setWidth: (width: number) => void;
  /** 拖拽调整宽度（用于 ResizeHandle） */
  handleResize: (delta: number) => void;
  /** 双击重置宽度 */
  resetWidth: () => void;
}

const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const RESET_WIDTH = 280;

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      isOpen: true,
      width: DEFAULT_WIDTH,
      minWidth: MIN_WIDTH,
      maxWidth: MAX_WIDTH,
      lastWidth: DEFAULT_WIDTH,

      open: () => {
        const { lastWidth } = get();
        set({ isOpen: true, width: lastWidth });
      },

      close: () => {
        const { width } = get();
        set({ isOpen: false, lastWidth: width });
      },

      toggle: () => {
        const { isOpen } = get();
        if (isOpen) {
          get().close();
        } else {
          get().open();
        }
      },

      setWidth: (newWidth: number) => {
        const { minWidth, maxWidth } = get();
        const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
        set({ width: clamped, lastWidth: clamped });
      },

      handleResize: (delta: number) => {
        const { width, minWidth, maxWidth } = get();
        const newWidth = Math.max(minWidth, Math.min(maxWidth, width + delta));
        set({ width: newWidth, lastWidth: newWidth });
      },

      resetWidth: () => {
        set({ width: RESET_WIDTH, lastWidth: RESET_WIDTH });
      },
    }),
    {
      name: "flowforge-sidebar",
      partialize: (state) => ({ width: state.width, lastWidth: state.lastWidth }),
    }
  )
);
