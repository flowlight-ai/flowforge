"use client";

import { useCallback, useEffect, useState } from "react";
import { FORGEKIN_COLORS, FORGEKIN_EMOJI } from "../../lib/council-types";

export interface VoteActiveState {
  question: string;
  /** 已投票数 */
  voteCount: number;
  /** 总投票人数 */
  totalVoters: number;
  /** 截止时间戳（ms） */
  deadline: number;
  /** 是否匿名 */
  anonymous: boolean;
  /** 选项列表 */
  options: string[];
  /** 各选项得票（非匿名时显示） */
  tally?: Record<string, number>;
  /** 已投票的智能体 ID（非匿名时显示） */
  votedBy?: string[];
}

interface VoteActiveBarProps {
  /** 当前活跃投票状态（null 表示无活跃投票，组件返回 null） */
  vote: VoteActiveState | null;
  /** 结束投票回调 */
  onEnd: () => void;
  /** 投票回调（选项 index） */
  onVote?: (optionIdx: number) => void;
  /** 当前用户已投的选项 index（-1 表示未投） */
  userVotedIdx?: number;
}

/**
 * VoteActiveBar — 投票进行中状态栏
 *
 * 用途：在聊天输入框上方显示活跃投票的进度、倒计时、结束按钮
 *
 * 视觉：
 *   - 黄色/橙色背景（参考 conn-amber 色系，但用 CSS 变量适配主题）
 *   - 投票图标 + 问题（截断）
 *   - 进度文本：已投 X/Y
 *   - 倒计时：M:SS
 *   - 结束按钮
 *   - 展开后显示选项和投票按钮
 *
 * 主题：CSS 变量驱动
 */
export function VoteActiveBar({
  vote,
  onEnd,
  onVote,
  userVotedIdx = -1,
}: VoteActiveBarProps) {
  const [remaining, setRemaining] = useState("");
  const [expanded, setExpanded] = useState(false);

  // 倒计时
  useEffect(() => {
    if (!vote) return;
    const update = () => {
      const diff = Math.max(0, vote.deadline - Date.now());
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [vote]);

  const handleEnd = useCallback(() => {
    onEnd();
  }, [onEnd]);

  const handleVote = useCallback(
    (idx: number) => {
      if (userVotedIdx >= 0) return; // 已投票
      onVote?.(idx);
    },
    [onVote, userVotedIdx]
  );

  if (!vote) return null;

  const progressText =
    vote.totalVoters > 0
      ? `已投 ${vote.voteCount}/${vote.totalVoters}`
      : `已投 ${vote.voteCount}`;

  return (
    <div
      data-council="vote-active-bar"
      style={{
        padding: "8px 16px",
        background:
          "color-mix(in srgb, var(--semantic-warning, #f59e0b) 12%, var(--bg-elevated))",
        borderBottom: "1px solid color-mix(in srgb, var(--semantic-warning, #f59e0b) 30%, var(--border))",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        fontSize: "13px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {/* 投票图标 */}
        <span
          style={{
            color: "var(--semantic-warning, #f59e0b)",
            fontSize: "16px",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          ◎
        </span>
        {/* 问题 */}
        <span
          style={{
            color: "var(--text)",
            fontWeight: 600,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "收起" : "展开"}
        >
          投票进行中: {vote.question}
        </span>
        {/* 进度 */}
        <span
          style={{
            color: "var(--semantic-warning, #f59e0b)",
            flexShrink: 0,
            fontSize: "12px",
            fontWeight: 500,
          }}
        >
          {progressText} · 剩余 {remaining}
        </span>
        {/* 展开按钮 */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--muted)",
            cursor: "pointer",
            padding: "2px 8px",
            borderRadius: "var(--radius-sm)",
            fontSize: "11px",
            flexShrink: 0,
          }}
          aria-expanded={expanded}
          aria-label={expanded ? "收起投票选项" : "展开投票选项"}
        >
          {expanded ? "▲" : "▼"}
        </button>
        {/* 结束按钮 */}
        <button
          type="button"
          onClick={handleEnd}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--muted)",
            cursor: "pointer",
            padding: "2px 10px",
            borderRadius: "var(--radius-sm)",
            fontSize: "11px",
            flexShrink: 0,
            transition: "color 0.15s, border-color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--semantic-critical, #ef4444)";
            e.currentTarget.style.borderColor = "var(--semantic-critical, #ef4444)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--muted)";
            e.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          结束投票
        </button>
      </div>

      {/* 展开后：选项列表 */}
      {expanded && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            paddingTop: "4px",
            borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
          }}
        >
          {vote.options.map((opt, idx) => {
            const tally = vote.tally?.[opt] ?? 0;
            const isVoted = userVotedIdx === idx;
            const percentage =
              vote.voteCount > 0 ? Math.round((tally / vote.voteCount) * 100) : 0;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleVote(idx)}
                disabled={userVotedIdx >= 0}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: isVoted
                    ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                    : "var(--bg)",
                  border: `1px solid ${
                    isVoted ? "var(--accent)" : "var(--border)"
                  }`,
                  color: "var(--text)",
                  cursor: userVotedIdx >= 0 ? "default" : "pointer",
                  fontSize: "12px",
                  textAlign: "left",
                  width: "100%",
                  opacity: userVotedIdx >= 0 && !isVoted ? 0.6 : 1,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {/* 进度条背景 */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${percentage}%`,
                    background:
                      "color-mix(in srgb, var(--accent) 8%, transparent)",
                    transition: "width 0.3s ease-out",
                    zIndex: 0,
                  }}
                />
                <span style={{ zIndex: 1, flex: 1 }}>{opt}</span>
                {tally > 0 && (
                  <span
                    style={{
                      zIndex: 1,
                      color: "var(--muted)",
                      fontSize: "11px",
                      flexShrink: 0,
                    }}
                  >
                    {tally} 票 · {percentage}%
                  </span>
                )}
                {isVoted && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ zIndex: 1, flexShrink: 0 }}
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}

          {/* 已投票智能体显示（非匿名） */}
          {!vote.anonymous && vote.votedBy && vote.votedBy.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                marginTop: "4px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--muted)",
                }}
              >
                已投票：
              </span>
              {vote.votedBy.map((id) => {
                const colors = FORGEKIN_COLORS[id] || { primary: "#888", secondary: "#333" };
                const emoji = FORGEKIN_EMOJI[id] || "🤖";
                return (
                  <span
                    key={id}
                    title={id}
                    style={{
                      width: "18px",
                      height: "18px",
                      borderRadius: "50%",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "10px",
                      background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
                      border: `1px solid ${colors.primary}66`,
                    }}
                  >
                    {emoji}
                  </span>
                );
              })}
            </div>
          )}

          {userVotedIdx >= 0 && (
            <div
              style={{
                marginTop: "4px",
                fontSize: "11px",
                color: "var(--accent)",
                fontWeight: 500,
              }}
            >
              ✓ 你已投票，等待其他智能体...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default VoteActiveBar;
