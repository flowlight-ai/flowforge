"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useInputHistory — 输入历史记录 Hook
 *
 * 用途：在聊天输入框中按 ↑/↓ 键召回历史消息（类似终端历史）
 *
 * 行为：
 *   - 按 ↑ 键：向后回溯历史（更早的消息）
 *   - 按 ↓ 键：向前推进历史（更新的消息）
 *   - 在历史记录中编辑会创建新条目（不修改历史）
 *   - 持久化到 localStorage（按会话维度隔离）
 *
 * 使用方式：
 *   const { history, addToHistory, navigateHistory, resetNavigation } = useInputHistory("council");
 *   // 在 keydown 中：
 *   if (e.key === "ArrowUp") { const item = navigateHistory("up", currentText); if (item !== null) setInputText(item); }
 */

const MAX_HISTORY = 50;

export function useInputHistory(scope: string = "default") {
  const storageKey = `flowforge-input-history-${scope}`;
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // 当前在历史中的位置（-1 表示不在历史中，即在输入新内容）
  // 0 = 最新一条，1 = 上一条，以此类推
  const navigationIdxRef = useRef(-1);
  // 进入历史导航前的当前输入（用于按 ↓ 回到最新时恢复）
  const draftBeforeNavigationRef = useRef<string>("");

  // 持久化
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(history));
    } catch {
      // 静默失败（localStorage 满 / 沙箱）
    }
  }, [history, storageKey]);

  /** 添加一条历史记录（去重，去空） */
  const addToHistory = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      // 去重：如果最新一条和当前相同，不重复添加
      if (prev[0] === trimmed) return prev;
      const next = [trimmed, ...prev].slice(0, MAX_HISTORY);
      return next;
    });
    // 重置导航位置
    navigationIdxRef.current = -1;
    draftBeforeNavigationRef.current = "";
  }, []);

  /** 重置导航位置（用户手动编辑或发送消息后调用） */
  const resetNavigation = useCallback(() => {
    navigationIdxRef.current = -1;
    draftBeforeNavigationRef.current = "";
  }, []);

  /**
   * 导航历史记录
   * @param direction "up" = 向上（更早），"down" = 向下（更新）
   * @param currentText 当前输入框文本（用于保存草稿）
   * @returns 返回应该设置到输入框的文本，或 null 表示不修改
   */
  const navigateHistory = useCallback(
    (direction: "up" | "down", currentText: string): string | null => {
      if (history.length === 0) return null;

      if (direction === "up") {
        // 进入历史导航前保存当前草稿
        if (navigationIdxRef.current === -1) {
          draftBeforeNavigationRef.current = currentText;
          navigationIdxRef.current = 0;
          return history[0] ?? null;
        }
        // 已经在历史中，继续向上
        const nextIdx = Math.min(navigationIdxRef.current + 1, history.length - 1);
        if (nextIdx === navigationIdxRef.current) return null; // 已经到最老
        navigationIdxRef.current = nextIdx;
        return history[nextIdx] ?? null;
      }

      // direction === "down"
      if (navigationIdxRef.current === -1) return null; // 不在历史中
      const nextIdx = navigationIdxRef.current - 1;
      if (nextIdx < 0) {
        // 回到最新（恢复草稿）
        navigationIdxRef.current = -1;
        return draftBeforeNavigationRef.current;
      }
      navigationIdxRef.current = nextIdx;
      return history[nextIdx] ?? null;
    },
    [history],
  );

  /** 清空历史 */
  const clearHistory = useCallback(() => {
    setHistory([]);
    navigationIdxRef.current = -1;
    draftBeforeNavigationRef.current = "";
  }, []);

  return {
    history,
    addToHistory,
    navigateHistory,
    resetNavigation,
    clearHistory,
    /** 当前是否在历史导航中（用于光标定位等） */
    isNavigating: navigationIdxRef.current !== -1,
  };
}
