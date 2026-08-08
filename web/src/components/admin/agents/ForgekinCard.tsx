"use client";

/**
 * ForgekinCard — 可进化智能体卡片
 *
 * 来源：老版 flowforge /admin/agents page.tsx 卡片 + clowder-ai Forgekin 概念融合
 *
 * 显示：头像 / 名称 / 角色 / 形态 / 进化阶 / 觉醒阶 / 在线状态
 * 操作：编辑 / 进化 / 觉醒 / 谱系
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 */

import { ForgekinRosterItem, FORGEKIN_COLORS, FORGEKIN_EMOJI } from "@/lib/council-types";
import { useRouter } from "next/navigation";

interface ForgekinCardProps {
  forgekin: ForgekinRosterItem;
  onEdit?: (id: string) => void;
}

export function ForgekinCard({ forgekin, onEdit }: ForgekinCardProps) {
  const router = useRouter();
  const colors = FORGEKIN_COLORS[forgekin.id] || { primary: "#888", secondary: "#333" };
  const emoji = FORGEKIN_EMOJI[forgekin.id] || "🤖";

  const handleCardClick = () => {
    router.push(`/admin/agents/${forgekin.id}`);
  };

  const handleAction = (e: React.MouseEvent, action: "edit" | "evolve" | "awaken" | "lineage") => {
    e.stopPropagation();
    if (action === "edit" && onEdit) {
      onEdit(forgekin.id);
    } else if (action === "lineage") {
      router.push(`/admin/agents/${forgekin.id}?tab=lineage`);
    }
    // evolve/awaken 后续 Phase 补全
  };

  return (
    <div
      className="forgekin-card group cursor-pointer rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)] p-4 transition-all hover:border-[var(--cafe-accent,#ff5c5c)] hover:shadow-lg"
      onClick={handleCardClick}
      data-forgekin-card={forgekin.id}
    >
      {/* 头部：头像 + 在线状态 */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-2xl"
          style={{
            background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
            border: `1px solid ${colors.primary}66`,
          }}
        >
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className="font-mono text-sm font-semibold"
              style={{ color: colors.primary }}
            >
              {forgekin.id}
            </span>
            <span
              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
              style={{
                background: forgekin.available
                  ? "var(--semantic-success-surface,rgba(34,197,94,0.15))"
                  : "var(--semantic-critical-surface,rgba(239,68,68,0.15))",
                color: forgekin.available
                  ? "var(--semantic-success,#22c55e)"
                  : "var(--semantic-critical,#ef4444)",
              }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{
                  background: forgekin.available
                    ? "var(--semantic-success,#22c55e)"
                    : "var(--semantic-critical,#ef4444)",
                }}
              />
              {forgekin.available ? "在线" : "离线"}
            </span>
          </div>
          <div className="text-sm font-medium text-[var(--cafe-text,#e5e7eb)] truncate">
            {forgekin.name}
          </div>
          <div className="text-xs text-[var(--cafe-text-muted,#6b7280)] truncate">
            {forgekin.role?.primary || forgekin.species || "—"}
          </div>
        </div>
      </div>

      {/* 属性栏：形态 / 进化阶 / 觉醒阶 */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="rounded bg-[var(--console-rail-item,#252633)] py-1.5 px-1">
          <div className="text-[10px] text-[var(--cafe-text-muted,#6b7280)] uppercase">形态</div>
          <div className="text-xs font-medium text-[var(--cafe-text-secondary,#9ca3af)]">
            {forgekin.species || "BIO"}
          </div>
        </div>
        <div className="rounded bg-[var(--console-rail-item,#252633)] py-1.5 px-1">
          <div className="text-[10px] text-[var(--cafe-text-muted,#6b7280)] uppercase">进化阶</div>
          <div className="text-xs font-medium text-[var(--cafe-accent,#ff5c5c)]">
            {forgekin.evolutionStage || "E3"}
          </div>
        </div>
        <div className="rounded bg-[var(--console-rail-item,#252633)] py-1.5 px-1">
          <div className="text-[10px] text-[var(--cafe-text-muted,#6b7280)] uppercase">觉醒阶</div>
          <div className="text-xs font-medium text-[var(--semantic-info,#3b82f6)]">
            {forgekin.awakeningStage || "E2"}
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => handleAction(e, "edit")}
          className="flex-1 text-xs px-2 py-1.5 rounded bg-[var(--cafe-accent,#ff5c5c)] text-white hover:opacity-90 transition-opacity"
          data-forgekin-action="edit"
        >
          编辑
        </button>
        <button
          type="button"
          onClick={(e) => handleAction(e, "evolve")}
          className="flex-1 text-xs px-2 py-1.5 rounded bg-[var(--console-rail-item,#252633)] text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)] transition-colors"
          data-forgekin-action="evolve"
        >
          进化
        </button>
        <button
          type="button"
          onClick={(e) => handleAction(e, "awaken")}
          className="flex-1 text-xs px-2 py-1.5 rounded bg-[var(--console-rail-item,#252633)] text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)] transition-colors"
          data-forgekin-action="awaken"
        >
          觉醒
        </button>
        <button
          type="button"
          onClick={(e) => handleAction(e, "lineage")}
          className="flex-1 text-xs px-2 py-1.5 rounded bg-[var(--console-rail-item,#252633)] text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)] transition-colors"
          data-forgekin-action="lineage"
        >
          谱系
        </button>
      </div>
    </div>
  );
}
