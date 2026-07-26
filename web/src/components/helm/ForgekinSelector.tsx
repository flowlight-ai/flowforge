"use client";

import { ForgekinRosterItem, FORGEKIN_COLORS, FORGEKIN_EMOJI, ROLE_CONFIG, ForgekinRole } from "../../lib/council-types";

interface ForgekinSelectorProps {
  roster: ForgekinRosterItem[];
  participantIds: string[];
  roleAssignment: Record<string, ForgekinRole>;
  onToggleParticipant: (forgekinId: string) => void;
  onSetRole: (forgekinId: string, role: ForgekinRole) => void;
  compact?: boolean;
}

/**
 * ForgekinSelector — 灵智体选择器
 *
 * 显示所有可用的灵智体，支持：
 *   - 勾选/取消参与群聊
 *   - 分配角色（primary/reviewer/tester/observer）
 *   - 显示灵智体头像、名称、物种、角色
 *
 * 参考 clowder-ai AgentSelector 设计，适配 FlowForge 暗色主题
 */
export default function ForgekinSelector({
  roster,
  participantIds,
  roleAssignment,
  onToggleParticipant,
  onSetRole,
  compact = false,
}: ForgekinSelectorProps) {
  if (roster.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 text-center">
        加载灵智体花名册中...
      </div>
    );
  }

  return (
    <div className="forgekin-selector flex flex-col gap-2 p-3">
      {!compact && (
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            灵智体 ({participantIds.length}/{roster.length})
          </h3>
          <span className="text-[10px] text-gray-600">勾选参与 · 分配角色</span>
        </div>
      )}
      {roster.map((item) => {
        const isParticipant = participantIds.includes(item.id);
        const role = roleAssignment[item.id] || "observer";
        const colors = FORGEKIN_COLORS[item.id] || { primary: "#888", secondary: "#333" };
        const emoji = FORGEKIN_EMOJI[item.id] || "🤖";
        const roleCfg = ROLE_CONFIG[role];

        return (
          <div
            key={item.id}
            className={`forgekin-card rounded-lg border transition-all ${
              isParticipant
                ? "border-emerald-700 bg-emerald-900/20"
                : "border-gray-800 bg-gray-900/40 opacity-60"
            }`}
          >
            <div className="flex items-center gap-2 p-2">
              {/* 勾选框 */}
              <button
                onClick={() => onToggleParticipant(item.id)}
                className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  isParticipant
                    ? "bg-emerald-600 border-emerald-600"
                    : "border-gray-600 hover:border-gray-400"
                }`}
                title={isParticipant ? "取消参与" : "加入群聊"}
              >
                {isParticipant && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>

              {/* 头像 */}
              <div
                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base"
                style={{
                  background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
                  border: `1px solid ${colors.primary}66`,
                }}
                title={`${item.name} · ${item.role?.description || ""}`}
              >
                {emoji}
              </div>

              {/* 名称与角色 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-200 truncate">
                    {item.name}
                  </span>
                  {isParticipant && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded text-white ${roleCfg.color}`}
                      title={roleCfg.label}
                    >
                      {roleCfg.icon} {roleCfg.label}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 truncate">
                  {item.role?.primary || item.species}
                </div>
              </div>
            </div>

            {/* 角色分配按钮组（仅参与者显示） */}
            {isParticipant && !compact && (
              <div className="flex gap-1 px-2 pb-2">
                {(Object.keys(ROLE_CONFIG) as ForgekinRole[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => onSetRole(item.id, r)}
                    className={`text-[10px] px-1.5 py-0.5 rounded transition-all ${
                      role === r
                        ? `${ROLE_CONFIG[r].color} text-white`
                        : "bg-gray-800 text-gray-500 hover:bg-gray-700"
                    }`}
                    title={ROLE_CONFIG[r].label}
                  >
                    {ROLE_CONFIG[r].icon}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
