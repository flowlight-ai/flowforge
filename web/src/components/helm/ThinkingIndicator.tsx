"use client";

import { FORGEKIN_COLORS, FORGEKIN_EMOJI } from "../../lib/council-types";

interface ThinkingIndicatorProps {
  /** 正在响应的智能体 ID 列表 */
  forgekinIds: string[];
  /** 取消回调（可选，未提供则不显示取消按钮） */
  onCancel?: () => void;
  /** 显示文案 */
  label?: string;
}

/**
 * ThinkingIndicator — 思考中指示器
 *
 * 来源：clowder-ai/packages/web/src/components/ThinkingIndicator.tsx（简化版）
 * 用途：替代简单的 loading dots，显示具体哪些智能体正在响应
 *
 * 视觉：
 *   - 显示参与的智能体头像（最多 5 个，超过显示 +N）
 *   - "智能体讨论中..."文案
 *   - 可选取消按钮
 *
 * 主题：CSS 变量驱动
 */
export function ThinkingIndicator({
  forgekinIds,
  onCancel,
  label = "智能体讨论中...",
}: ThinkingIndicatorProps) {
  if (forgekinIds.length === 0) return null;

  // 最多显示 5 个头像
  const visibleIds = forgekinIds.slice(0, 5);
  const overflowCount = forgekinIds.length - visibleIds.length;

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 rounded-lg"
      data-council="thinking-indicator"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        color: "var(--muted)",
        fontSize: "13px",
      }}
    >
      {/* 头像堆叠 */}
      <div className="flex items-center -space-x-2">
        {visibleIds.map((id) => {
          const colors = FORGEKIN_COLORS[id] || { primary: "#888", secondary: "#333" };
          const emoji = FORGEKIN_EMOJI[id] || "🤖";
          return (
            <div
              key={id}
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
              style={{
                background: `linear-gradient(135deg, ${colors.primary}44, ${colors.secondary}44)`,
                border: `2px solid var(--bg-elevated)`,
                zIndex: 1,
              }}
              title={id}
            >
              {emoji}
            </div>
          );
        })}
        {overflowCount > 0 && (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
            style={{
              background: "var(--bg)",
              border: "2px solid var(--bg-elevated)",
              color: "var(--muted)",
            }}
          >
            +{overflowCount}
          </div>
        )}
      </div>
      {/* 跳动点 */}
      <span className="flex gap-1" aria-hidden="true">
        <span
          className="rounded-full"
          style={{
            width: "4px",
            height: "4px",
            background: "var(--accent)",
            animation: "council-thinking-bounce 1.4s ease-in-out 0s infinite",
          }}
        />
        <span
          className="rounded-full"
          style={{
            width: "4px",
            height: "4px",
            background: "var(--accent)",
            animation: "council-thinking-bounce 1.4s ease-in-out 0.2s infinite",
          }}
        />
        <span
          className="rounded-full"
          style={{
            width: "4px",
            height: "4px",
            background: "var(--accent)",
            animation: "council-thinking-bounce 1.4s ease-in-out 0.4s infinite",
          }}
        />
      </span>
      <span className="italic">{label}</span>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto text-xs px-2 py-0.5 rounded transition-colors"
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--muted)",
            cursor: "pointer",
          }}
          title="取消灵议"
          aria-label="取消灵议"
        >
          ✕ 取消
        </button>
      )}
      <style>{`
        @keyframes council-thinking-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.6; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default ThinkingIndicator;
