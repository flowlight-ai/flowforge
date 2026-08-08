"use client";

import { FORGEKIN_COLORS, FORGEKIN_EMOJI } from "../../lib/council-types";

interface PendingMemberBubbleProps {
  /** 正在响应的智能体 ID */
  forgekinId: string;
  /** 显示名称（兜底 forgekinId） */
  forgekinName?: string;
  /** 显示文案，默认"正在思考..." */
  label?: string;
}

/**
 * PendingMemberBubble — 智能体响应中占位气泡
 *
 * 来源：clowder-ai/packages/web/src/components/PendingMemberBubble.tsx（简化版）
 * 用途：当智能体已被触发但消息未到达时，显示带头像和动画的占位气泡
 *
 * 视觉：
 *   - 智能体头像（左侧）
 *   - 三点跳动动画 + 文案
 *   - 智能体主色作为强调色
 *
 * 主题：CSS 变量驱动
 */
export function PendingMemberBubble({
  forgekinId,
  forgekinName,
  label = "正在思考...",
}: PendingMemberBubbleProps) {
  const colors = FORGEKIN_COLORS[forgekinId] || { primary: "#888", secondary: "#333" };
  const emoji = FORGEKIN_EMOJI[forgekinId] || "🤖";
  const displayName = forgekinName || forgekinId;

  return (
    <div
      className="flex gap-2 py-1"
      data-council="pending-bubble"
      data-forgekin-id={forgekinId}
      style={{ animation: "council-fade-in 0.2s ease-out" }}
    >
      {/* 头像 */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base mt-0.5"
        style={{
          background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
          border: `1px solid ${colors.primary}66`,
        }}
      >
        {emoji}
      </div>
      {/* 消息体 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className="text-sm font-medium"
            style={{ color: "var(--text)" }}
          >
            {displayName}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded text-white"
            style={{ background: colors.primary }}
          >
            响应中
          </span>
        </div>
        <div
          className="rounded-lg px-3 py-2.5 inline-flex items-center gap-2"
          style={{
            background: `${colors.primary}11`,
            border: `1px solid ${colors.primary}33`,
          }}
        >
          {/* 三点跳动 */}
          <span className="flex gap-1" aria-hidden="true">
            <span
              className="rounded-full"
              style={{
                width: "6px",
                height: "6px",
                background: colors.primary,
                animation: "council-bounce 1.2s ease-in-out 0s infinite",
              }}
            />
            <span
              className="rounded-full"
              style={{
                width: "6px",
                height: "6px",
                background: colors.primary,
                animation: "council-bounce 1.2s ease-in-out 0.2s infinite",
              }}
            />
            <span
              className="rounded-full"
              style={{
                width: "6px",
                height: "6px",
                background: colors.primary,
                animation: "council-bounce 1.2s ease-in-out 0.4s infinite",
              }}
            />
          </span>
          <span
            className="text-xs italic"
            style={{ color: "var(--muted)" }}
          >
            {label}
          </span>
        </div>
      </div>
      <style>{`
        @keyframes council-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.6; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes council-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default PendingMemberBubble;
