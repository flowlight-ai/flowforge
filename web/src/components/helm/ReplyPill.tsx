"use client";

import type { CouncilMessage } from "../../lib/council-types";

interface ReplyPillProps {
  /** 被引用的消息 */
  replyTo: CouncilMessage;
  /** 点击 pill 的回调（通常是滚动到原消息） */
  onClick?: () => void;
}

/**
 * ReplyPill — 引用回复消息的 pill 显示
 *
 * 用途：在新消息气泡内显示被引用的原消息片段
 *
 * 视觉：
 *   ┌─────────────────────────────────┐
 *   │ ▌ 文心 · 原消息内容片段...       │
 *   └─────────────────────────────────┘
 *   新消息内容...
 *
 * 主题：CSS 变量驱动
 */
export function ReplyPill({ replyTo, onClick }: ReplyPillProps) {
  const displayName =
    replyTo.source === "user"
      ? "我"
      : replyTo.forgekinName || "智能体";
  const snippet = replyTo.content
    .replace(/\n/g, " ")
    .slice(0, 80);
  const isTruncated = replyTo.content.length > 80;

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left mb-1.5 px-2.5 py-1 rounded-md text-xs transition-colors"
      style={{
        background: "color-mix(in srgb, var(--accent) 6%, transparent)",
        borderLeft: "2px solid var(--accent)",
        color: "var(--muted)",
        cursor: onClick ? "pointer" : "default",
      }}
      title="点击查看原消息"
      data-reply-to-id={replyTo.id}
    >
      <span
        className="font-semibold"
        style={{ color: "var(--accent)" }}
      >
        {displayName}
      </span>
      <span style={{ color: "var(--muted)", margin: "0 4px" }}>·</span>
      <span style={{ color: "var(--muted)" }}>
        {snippet}
        {isTruncated && "..."}
      </span>
    </button>
  );
}

export default ReplyPill;
