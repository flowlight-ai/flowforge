"use client";

import { useEffect, useState, type RefObject } from "react";

interface MessageNavigatorProps {
  /** 消息总数（用于显示进度） */
  totalMessages: number;
  /** 滚动容器的 ref */
  scrollContainerRef: RefObject<HTMLElement | null>;
}

/**
 * MessageNavigator — 消息导航器
 *
 * 来源：clowder-ai/packages/web/src/components/MessageNavigator.tsx（简化版）
 * 用途：当消息超过 5 条时显示，提供上下翻页按钮和当前位置指示
 *
 * 视觉：
 *   - 浮动在消息流右侧中部
 *   - 显示当前消息位置 / 总消息数
 *   - 上/下按钮可平滑滚动到上/下一条消息边界
 *
 * 主题：CSS 变量驱动
 */
export function MessageNavigator({
  totalMessages,
  scrollContainerRef,
}: MessageNavigatorProps) {
  const [currentIdx, setCurrentIdx] = useState(totalMessages);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    // 找到所有消息元素（带 data-message-idx 属性）
    const updatePosition = () => {
      const messages = el.querySelectorAll<HTMLElement>("[data-message-idx]");
      if (messages.length === 0) {
        setVisible(false);
        return;
      }
      setVisible(true);

      // 找到当前可视区域中靠上的消息
      const containerTop = el.scrollTop;
      const containerBottom = containerTop + el.clientHeight;
      let firstVisibleIdx = 0;
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg) continue;
        const msgTop = msg.offsetTop;
        if (msgTop >= containerTop - 10) {
          firstVisibleIdx = i + 1;
          break;
        }
      }
      setCurrentIdx(Math.min(firstVisibleIdx, messages.length));
    };

    el.addEventListener("scroll", updatePosition, { passive: true });
    updatePosition();
    return () => el.removeEventListener("scroll", updatePosition);
  }, [scrollContainerRef, totalMessages]);

  // 滚动到上/下一条消息
  const scrollToMessage = (direction: "up" | "down") => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const messages = el.querySelectorAll<HTMLElement>("[data-message-idx]");
    if (messages.length === 0) return;

    const containerTop = el.scrollTop;
    const targetIdx =
      direction === "up"
        ? Math.max(0, currentIdx - 2)
        : Math.min(messages.length - 1, currentIdx);

    const target = messages[targetIdx];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (!visible || totalMessages <= 5) return null;

  const btnBase: React.CSSProperties = {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    color: "var(--muted)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "color 0.15s, background 0.15s",
  };

  return (
    <div
      data-council="message-navigator"
      style={{
        position: "absolute",
        right: "12px",
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "6px",
        padding: "6px 4px",
        borderRadius: "var(--radius-md, 8px)",
        background: "color-mix(in srgb, var(--bg-elevated) 80%, transparent)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "var(--shadow-sm, 0 2px 4px rgba(0,0,0,0.08))",
        zIndex: 5,
      }}
    >
      <button
        type="button"
        onClick={() => scrollToMessage("up")}
        style={btnBase}
        title="上一条消息"
        aria-label="上一条消息"
        disabled={currentIdx <= 1}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      <div
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--text)",
          minWidth: "32px",
          textAlign: "center",
          lineHeight: 1.2,
        }}
      >
        <div>{currentIdx}</div>
        <div style={{ color: "var(--muted)", fontSize: "9px" }}>/ {totalMessages}</div>
      </div>
      <button
        type="button"
        onClick={() => scrollToMessage("down")}
        style={btnBase}
        title="下一条消息"
        aria-label="下一条消息"
        disabled={currentIdx >= totalMessages}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
  );
}

export default MessageNavigator;
