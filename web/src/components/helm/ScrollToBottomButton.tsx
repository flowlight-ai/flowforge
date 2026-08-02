"use client";

import { useEffect, useState, type RefObject } from "react";

interface ScrollToBottomButtonProps {
  scrollContainerRef: RefObject<HTMLElement | null>;
  messagesEndRef: RefObject<HTMLElement | null>;
  /** 重新计算可见性的信号（如消息数变化） */
  recomputeSignal?: string | number;
  /** 多语言/可访问性标识 */
  observerKey?: string;
}

/**
 * ScrollToBottomButton — 回到底部按钮
 *
 * 行为：
 *   - 监听滚动容器，远离底部时显示按钮
 *   - 点击平滑滚动到底部（messagesEndRef）
 *   - 接近底部时自动隐藏
 *   - 使用 IntersectionObserver 监听底部哨兵元素，性能更优
 *
 * 主题：全部使用 CSS 变量，跟随主题切换
 */
export function ScrollToBottomButton({
  scrollContainerRef,
  messagesEndRef,
  recomputeSignal,
  observerKey,
}: ScrollToBottomButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    const sentinelEl = messagesEndRef.current;
    if (!scrollEl || !sentinelEl) return;

    // 退化方案：若浏览器不支持 IntersectionObserver，使用滚动事件
    if (typeof IntersectionObserver === "undefined") {
      const onScroll = () => {
        const { scrollTop, scrollHeight, clientHeight } = scrollEl;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        setVisible(distanceFromBottom > 200);
      };
      scrollEl.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => scrollEl.removeEventListener("scroll", onScroll);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          // 当底部哨兵不可见时，显示按钮
          setVisible(!entry.isIntersecting);
        }
      },
      {
        root: scrollEl,
        threshold: 0,
        rootMargin: "0px 0px -100px 0px",
      }
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [scrollContainerRef, messagesEndRef, recomputeSignal, observerKey]);

  const handleClick = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="回到底部"
      title="回到底部"
      data-council-action="scroll-to-bottom"
      style={{
        position: "absolute",
        right: "20px",
        bottom: "20px",
        width: "36px",
        height: "36px",
        borderRadius: "50%",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15))",
        color: "var(--accent)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
        transition: "opacity 0.15s, transform 0.15s",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

export default ScrollToBottomButton;
