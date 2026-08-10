/**
 * Thread Drawer Store — 全局会话抽屉开关
 *
 * 管理 GlobalThreadDrawer 的展开/折叠状态，
 * 可从 ActivityBar 或任意位置调用 toggle() 切换。
 */

import { create } from "zustand";

interface ThreadDrawerState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useThreadDrawerStore = create<ThreadDrawerState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
