/**
 * Helm Panel Store (Zustand)
 *
 * 职责：管理 HelmLayout 的面板可见性、面板宽度、各种模态框开关
 *
 * 替代 HelmLayout 中的 useState：
 *   - panelVisibility / prevPanelVisibility
 *   - chatPanelWidth / rightPanelWidth
 *   - panelMenuOpen
 *   - showSettings / showMCPConfig / showAgentOrchestrator
 *   - showBrowserPreview / showSpecPanel / showWorktreePanel
 *   - showFigmaImporter / browserUrl / terminalCommands
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PanelVisibility {
  /** 左侧聊天/任务列表面板 */
  chat: boolean;
  /** 右侧编辑器/浏览器面板 */
  editor: boolean;
  /** 资源管理器面板 */
  explorer: boolean;
}

export interface TerminalCommand {
  id: string;
  command: string;
  output?: string;
  exitCode?: number;
  timestamp: number;
}

export interface HelmPanelState {
  /** 面板可见性 */
  panelVisibility: PanelVisibility;
  /** 上次面板可见性（响应式恢复用） */
  prevPanelVisibility: PanelVisibility;
  /** 左侧聊天面板宽度 */
  chatPanelWidth: number;
  /** 右侧编辑器面板宽度 */
  rightPanelWidth: number;
  /** 面板菜单是否展开 */
  panelMenuOpen: boolean;

  /** 各种模态框/抽屉可见性 */
  showSettings: boolean;
  showMCPConfig: boolean;
  showAgentOrchestrator: boolean;
  showBrowserPreview: boolean;
  showSpecPanel: boolean;
  showWorktreePanel: boolean;
  showFigmaImporter: boolean;

  /** 浏览器预览 URL */
  browserUrl: string;
  /** 终端命令历史 */
  terminalCommands: TerminalCommand[];

  /** 切换面板可见性 */
  togglePanel: (panel: keyof PanelVisibility) => void;
  /** 直接设置面板可见性 */
  setPanelVisibility: (visibility: Partial<PanelVisibility>) => void;
  /** 设置左侧聊天面板宽度 */
  setChatPanelWidth: (width: number) => void;
  /** 设置右侧编辑器面板宽度 */
  setRightPanelWidth: (width: number) => void;
  /** 切换面板菜单 */
  setPanelMenuOpen: (open: boolean) => void;

  /** 各类模态框开关 */
  setShowSettings: (show: boolean) => void;
  setShowMCPConfig: (show: boolean) => void;
  setShowAgentOrchestrator: (show: boolean) => void;
  setShowBrowserPreview: (show: boolean) => void;
  setShowSpecPanel: (show: boolean) => void;
  setShowWorktreePanel: (show: boolean) => void;
  setShowFigmaImporter: (show: boolean) => void;

  /** 设置浏览器 URL */
  setBrowserUrl: (url: string) => void;
  /** 添加终端命令 */
  addTerminalCommand: (command: TerminalCommand) => void;
  /** 清空终端命令 */
  clearTerminalCommands: () => void;

  /** 关闭所有模态框 */
  closeAllModals: () => void;
  /** 重置 */
  reset: () => void;
}

const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  chat: true,
  editor: true,
  explorer: true,
};

export const useHelmPanelStore = create<HelmPanelState>()(
  persist(
    (set, get) => ({
      panelVisibility: DEFAULT_PANEL_VISIBILITY,
      prevPanelVisibility: DEFAULT_PANEL_VISIBILITY,
      chatPanelWidth: 280,
      rightPanelWidth: 260,
      panelMenuOpen: false,

      showSettings: false,
      showMCPConfig: false,
      showAgentOrchestrator: false,
      showBrowserPreview: false,
      showSpecPanel: false,
      showWorktreePanel: false,
      showFigmaImporter: false,

      browserUrl: "https://example.com",
      terminalCommands: [],

      togglePanel: (panel) =>
        set((state) => {
          const next = {
            ...state.panelVisibility,
            [panel]: !state.panelVisibility[panel],
          };
          // 确保至少一个面板可见
          if (!next.chat && !next.editor && !next.explorer) {
            next.chat = true;
          }
          return { panelVisibility: next, prevPanelVisibility: state.panelVisibility };
        }),

      setPanelVisibility: (visibility) =>
        set((state) => ({
          panelVisibility: { ...state.panelVisibility, ...visibility },
        })),

      setChatPanelWidth: (width) => set({ chatPanelWidth: width }),
      setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
      setPanelMenuOpen: (open) => set({ panelMenuOpen: open }),

      setShowSettings: (show) => set({ showSettings: show }),
      setShowMCPConfig: (show) => set({ showMCPConfig: show }),
      setShowAgentOrchestrator: (show) => set({ showAgentOrchestrator: show }),
      setShowBrowserPreview: (show) => set({ showBrowserPreview: show }),
      setShowSpecPanel: (show) => set({ showSpecPanel: show }),
      setShowWorktreePanel: (show) => set({ showWorktreePanel: show }),
      setShowFigmaImporter: (show) => set({ showFigmaImporter: show }),

      setBrowserUrl: (url) => set({ browserUrl: url }),

      addTerminalCommand: (command) =>
        set((state) => ({
          terminalCommands: [...state.terminalCommands, command],
        })),

      clearTerminalCommands: () => set({ terminalCommands: [] }),

      closeAllModals: () =>
        set({
          showSettings: false,
          showMCPConfig: false,
          showAgentOrchestrator: false,
          showBrowserPreview: false,
          showSpecPanel: false,
          showWorktreePanel: false,
          showFigmaImporter: false,
          panelMenuOpen: false,
        }),

      reset: () =>
        set({
          panelVisibility: DEFAULT_PANEL_VISIBILITY,
          prevPanelVisibility: DEFAULT_PANEL_VISIBILITY,
          panelMenuOpen: false,
          showSettings: false,
          showMCPConfig: false,
          showAgentOrchestrator: false,
          showBrowserPreview: false,
          showSpecPanel: false,
          showWorktreePanel: false,
          showFigmaImporter: false,
        }),
    }),
    {
      name: "flowforge-helm-panel",
      partialize: (state) => ({
        chatPanelWidth: state.chatPanelWidth,
        rightPanelWidth: state.rightPanelWidth,
      }),
    }
  )
);
