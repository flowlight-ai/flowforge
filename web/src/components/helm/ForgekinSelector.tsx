"use client";

import { useState, useCallback } from "react";
import { ForgekinRosterItem, FORGEKIN_COLORS, FORGEKIN_EMOJI, ROLE_CONFIG, ForgekinRole } from "../../lib/council-types";

interface ForgekinSelectorProps {
  roster: ForgekinRosterItem[];
  participantIds: string[];
  roleAssignment: Record<string, ForgekinRole>;
  /** 已静音的智能体 ID 列表（静音后不参与消息触发） */
  mutedIds: string[];
  onToggleParticipant: (forgekinId: string) => void;
  onSetRole: (forgekinId: string, role: ForgekinRole) => void;
  onToggleMute: (forgekinId: string) => void;
  compact?: boolean;
}

/**
 * ForgekinSelector — 智能体选择器
 *
 * 显示所有可用的智能体，支持：
 *   - 勾选/取消参与群聊
 *   - 分配角色（primary/reviewer/tester/observer）
 *   - 显示智能体头像、名称、物种、角色
 *   - 在线状态指示（基于 available 字段）
 *   - 详情展开（点击查看进化阶、觉醒阶、描述等）
 *   - 静音切换（静音后该智能体不参与消息触发）
 *
 * UI 改进（v4）：
 *   - 全部使用 CSS 变量，主题切换时所有组件同步变色
 *   - 角色徽章使用智能体主色（colors.primary），不再用 Tailwind 类
 *   - 头像添加在线状态点（绿点在线 / 灰点离线）
 *   - 卡片可展开显示详细信息
 *   - 静音按钮（仅参与者显示，静音后图标变化）
 *
 * 参考 AgentSelector 设计
 */
export default function ForgekinSelector({
  roster,
  participantIds,
  roleAssignment,
  mutedIds,
  onToggleParticipant,
  onSetRole,
  onToggleMute,
  compact = false,
}: ForgekinSelectorProps) {
  // 展开详情的智能体 ID 列表（可同时展开多个）
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (roster.length === 0) {
    return (
      <div
        className="p-4 text-sm text-center"
        style={{ color: "var(--muted)" }}
      >
        加载智能体花名册中...
      </div>
    );
  }

  return (
    <div className="forgekin-selector flex flex-col gap-2 p-3">
      {!compact && (
        <div className="flex items-center justify-between mb-1">
          <h3
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--muted)" }}
          >
            智能体 ({participantIds.length}/{roster.length})
          </h3>
          <span
            className="text-[10px]"
            style={{ color: "var(--muted)", opacity: 0.7 }}
          >
            勾选参与 · 分配角色
          </span>
        </div>
      )}
      {roster.map((item) => {
        const isParticipant = participantIds.includes(item.id);
        const isMuted = mutedIds.includes(item.id);
        const isExpanded = expandedIds.has(item.id);
        const isOnline = item.available && !item.error;
        const role = roleAssignment[item.id] || "observer";
        const colors = FORGEKIN_COLORS[item.id] || { primary: "#888", secondary: "#333" };
        const emoji = FORGEKIN_EMOJI[item.id] || "🤖";
        const roleCfg = ROLE_CONFIG[role];

        return (
          <div
            key={item.id}
            className="forgekin-card rounded-lg border transition-all"
            style={{
              borderColor: isParticipant ? colors.primary : "var(--border)",
              background: isParticipant
                ? `linear-gradient(135deg, ${colors.primary}11, transparent)`
                : "var(--bg)",
              opacity: isParticipant ? (isMuted ? 0.55 : 1) : 0.6,
            }}
          >
            <div className="flex items-center gap-2 p-2">
              {/* 勾选框 */}
              <button
                onClick={() => onToggleParticipant(item.id)}
                className="flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all"
                style={{
                  background: isParticipant ? colors.primary : "transparent",
                  borderColor: isParticipant ? colors.primary : "var(--border-strong, var(--border))",
                  border: "none",
                  cursor: "pointer",
                }}
                title={isParticipant ? "取消参与" : "加入群聊"}
                aria-label={isParticipant ? "取消参与" : "加入群聊"}
              >
                {isParticipant && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>

              {/* 头像 + 在线状态点 */}
              <div
                className="flex-shrink-0 relative cursor-pointer"
                onClick={() => toggleExpand(item.id)}
                title={isExpanded ? "收起详情" : "展开详情"}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleExpand(item.id);
                  }
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-base"
                  style={{
                    background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
                    border: `1px solid ${colors.primary}66`,
                  }}
                >
                  {emoji}
                </div>
                {/* 在线状态点 — 右下角小圆点 */}
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                  style={{
                    background: isOnline ? "#22c55e" : "var(--muted)",
                    border: "2px solid var(--bg-elevated)",
                  }}
                  title={isOnline ? "在线" : "离线"}
                  aria-label={isOnline ? "在线" : "离线"}
                />
              </div>

              {/* 名称与角色 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--text)" }}
                  >
                    {item.name}
                  </span>
                  {isParticipant && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded text-white"
                      style={{ background: colors.primary }}
                      title={roleCfg.label}
                    >
                      {roleCfg.icon} {roleCfg.label}
                    </span>
                  )}
                  {isMuted && isParticipant && (
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--muted)" }}
                      title="已静音"
                      aria-label="已静音"
                    >
                      🔇
                    </span>
                  )}
                </div>
                <div
                  className="text-[11px] truncate"
                  style={{ color: "var(--muted)" }}
                >
                  {item.role?.primary || item.species}
                </div>
              </div>

              {/* 展开按钮 */}
              <button
                onClick={() => toggleExpand(item.id)}
                className="flex-shrink-0 transition-transform"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  padding: "2px 4px",
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                }}
                title={isExpanded ? "收起详情" : "展开详情"}
                aria-label={isExpanded ? "收起详情" : "展开详情"}
                aria-expanded={isExpanded}
              >
                <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {/* 展开后的详情面板 */}
            {isExpanded && (
              <div
                className="px-3 pb-3 pt-1 space-y-2"
                style={{
                  borderTop: "1px solid var(--border)",
                  background: "color-mix(in srgb, var(--bg) 60%, transparent)",
                }}
              >
                {/* 描述 */}
                {item.role?.description && (
                  <div>
                    <div
                      className="text-[10px] font-semibold uppercase mb-0.5"
                      style={{ color: "var(--muted)" }}
                    >
                      描述
                    </div>
                    <div
                      className="text-[11px] leading-relaxed"
                      style={{ color: "var(--text)" }}
                    >
                      {item.role.description}
                    </div>
                  </div>
                )}
                {/* 物种 */}
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-semibold uppercase"
                    style={{ color: "var(--muted)" }}
                  >
                    物种:
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--text)" }}
                  >
                    {item.species}
                  </span>
                </div>
                {/* 进化阶 */}
                {item.evolutionStage && (
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-semibold uppercase"
                      style={{ color: "var(--muted)" }}
                    >
                      进化阶:
                    </span>
                    <span
                      className="text-[11px] px-1.5 py-0.5 rounded"
                      style={{
                        color: colors.primary,
                        background: `${colors.primary}22`,
                        fontWeight: 600,
                      }}
                    >
                      {item.evolutionStage}
                    </span>
                  </div>
                )}
                {/* 觉醒阶 */}
                {item.awakeningStage && (
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-semibold uppercase"
                      style={{ color: "var(--muted)" }}
                    >
                      觉醒阶:
                    </span>
                    <span
                      className="text-[11px] px-1.5 py-0.5 rounded"
                      style={{
                        color: "var(--accent-2, #14b8a6)",
                        background: "color-mix(in srgb, var(--accent-2, #14b8a6) 14%, transparent)",
                        fontWeight: 600,
                      }}
                    >
                      {item.awakeningStage}
                    </span>
                  </div>
                )}
                {/* 副角色 */}
                {item.role?.secondary && item.role.secondary.length > 0 && (
                  <div>
                    <div
                      className="text-[10px] font-semibold uppercase mb-0.5"
                      style={{ color: "var(--muted)" }}
                    >
                      副角色
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {item.role.secondary.map((s, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            color: "var(--text)",
                            background: "var(--bg-hover, color-mix(in srgb, var(--accent) 6%, transparent))",
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* 错误状态 */}
                {item.error && (
                  <div
                    className="text-[10px] px-2 py-1 rounded"
                    style={{
                      color: "var(--semantic-critical, #ef4444)",
                      background: "color-mix(in srgb, var(--semantic-critical, #ef4444) 8%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--semantic-critical, #ef4444) 30%, transparent)",
                    }}
                  >
                    ⚠ {item.error}
                  </div>
                )}
              </div>
            )}

            {/* 角色分配按钮组 + 静音按钮（仅参与者显示） */}
            {isParticipant && !compact && (
              <div className="flex items-center gap-1 px-2 pb-2">
                {(Object.keys(ROLE_CONFIG) as ForgekinRole[]).map((r) => {
                  const isActiveRole = role === r;
                  return (
                    <button
                      key={r}
                      onClick={() => onSetRole(item.id, r)}
                      className="text-[10px] px-1.5 py-0.5 rounded transition-all"
                      style={{
                        background: isActiveRole ? colors.primary : "var(--bg)",
                        color: isActiveRole ? "#fff" : "var(--muted)",
                        border: `1px solid ${isActiveRole ? colors.primary : "var(--border)"}`,
                        cursor: "pointer",
                      }}
                      title={ROLE_CONFIG[r].label}
                    >
                      {ROLE_CONFIG[r].icon}
                    </button>
                  );
                })}
                {/* 静音切换按钮 */}
                <button
                  onClick={() => onToggleMute(item.id)}
                  className="text-[10px] px-1.5 py-0.5 rounded transition-all ml-auto"
                  style={{
                    background: isMuted
                      ? "color-mix(in srgb, var(--semantic-warning, #f59e0b) 14%, transparent)"
                      : "var(--bg)",
                    color: isMuted
                      ? "var(--semantic-warning, #f59e0b)"
                      : "var(--muted)",
                    border: `1px solid ${
                      isMuted
                        ? "color-mix(in srgb, var(--semantic-warning, #f59e0b) 40%, transparent)"
                        : "var(--border)"
                    }`,
                    cursor: "pointer",
                  }}
                  title={isMuted ? "取消静音" : "静音此智能体"}
                  aria-label={isMuted ? "取消静音" : "静音此智能体"}
                  aria-pressed={isMuted}
                >
                  {isMuted ? "🔇" : "🔊"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
