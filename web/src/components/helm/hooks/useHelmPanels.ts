"use client";

/**
 * useHelmPanels — 面板可见性 + 模态框状态 Hook（Phase 3 拆分）
 *
 * 封装 helmPanelStore，补充：
 *   - 响应式：窄屏（≤900px）自动收起 editor/explorer，宽屏恢复
 *   - Ctrl+K / Cmd+K 全局快捷键：聚焦聊天输入框并填入 "/"
 *
 * 替代 HelmLayout 中的 useState：
 *   panelVisibility / prevPanelVisibility / chatPanelWidth / rightPanelWidth
 *   panelMenuOpen / showSettings / showMCPConfig / showAgentOrchestrator
 *   showBrowserPreview / showSpecPanel / showWorktreePanel / showFigmaImporter
 *   browserUrl / terminalCommands
 */

import { useEffect, useRef, useCallback } from "react";
import {
  useHelmPanelStore,
  type PanelVisibility,
} from "../../../stores/helmPanelStore";

export function useHelmPanels() {
  const store = useHelmPanelStore();
  const prevVisibilityRef = useRef<PanelVisibility>(store.panelVisibility);

  // 响应式：窄屏自动收起 editor/explorer，宽屏恢复
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 900px)");
    const handleResize = (e: MediaQueryListEvent | MediaQueryList) => {
      const state = useHelmPanelStore.getState();
      if (e.matches) {
        // 收起前保存当前状态
        prevVisibilityRef.current = state.panelVisibility;
        state.setPanelVisibility({ editor: false, explorer: false });
      } else {
        const saved = prevVisibilityRef.current;
        state.setPanelVisibility({
          editor: saved.editor,
          explorer: saved.explorer,
        });
      }
    };
    handleResize(mql);
    mql.addEventListener("change", handleResize);
    return () => mql.removeEventListener("change", handleResize);
  }, []);

  // Ctrl+K / Cmd+K 全局快捷键：聚焦聊天输入框
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        const textarea =
          document.querySelector<HTMLTextAreaElement>(".chat-input-textarea");
        if (textarea) {
          textarea.focus();
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value"
          )?.set;
          if (setter) {
            setter.call(textarea, "/");
          } else {
            textarea.value = "/";
          }
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  /**
   * 显示指定面板（同时更新 prevPanelVisibility 以支持响应式恢复）。
   * 用于 handleFileOpen / handleSettingsClick 等需要自动展开面板的场景。
   */
  const showPanel = useCallback(
    (panel: "chat" | "editor" | "explorer") => {
      const state = useHelmPanelStore.getState();
      const next: PanelVisibility = { ...state.panelVisibility, [panel]: true };
      useHelmPanelStore.setState({
        panelVisibility: next,
        prevPanelVisibility: next,
      });
    },
    []
  );

  return {
    ...store,
    showPanel,
  };
}
