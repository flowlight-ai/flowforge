"use client";

/**
 * EvolvableAgentTab — 可进化智能体 Tab
 *
 * 依据 WEB-FUSION-DESIGN.md §6.2：
 *   显示 5 个内置 Forgekin 卡片网格
 *
 * 数据来源：/api/v1/forgemind/roster
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 */

import { useEffect, useState } from "react";
import { ForgekinRosterItem } from "@/lib/council-types";
import { ForgekinCard } from "./ForgekinCard";

interface EvolvableAgentTabProps {
  onEdit?: (id: string) => void;
  onCountChange?: (count: number) => void;
}

const FALLBACK_ROSTER: ForgekinRosterItem[] = [
  { id: "wenxin", name: "文心", nickname: "文心", species: "BIO", available: true, role: { primary: "架构师" }, evolutionStage: "E3", awakeningStage: "E2" },
  { id: "sherlock", name: "夏洛克", nickname: "夏洛克", species: "BIO", available: true, role: { primary: "开发者" }, evolutionStage: "E3", awakeningStage: "E2" },
  { id: "luban", name: "鲁班", nickname: "鲁班", species: "BIO", available: true, role: { primary: "架构师" }, evolutionStage: "E3", awakeningStage: "E2" },
  { id: "vangogh", name: "梵高", nickname: "梵高", species: "BIO", available: true, role: { primary: "评审员" }, evolutionStage: "E3", awakeningStage: "E2" },
  { id: "davinci", name: "达芬奇", nickname: "达芬奇", species: "BIO", available: true, role: { primary: "测试员" }, evolutionStage: "E3", awakeningStage: "E2" },
];

export function EvolvableAgentTab({ onEdit, onCountChange }: EvolvableAgentTabProps) {
  const [roster, setRoster] = useState<ForgekinRosterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/forgemind/roster")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const items: ForgekinRosterItem[] = data.builtin || data.roster || [];
        setRoster(items.length > 0 ? items : FALLBACK_ROSTER);
        onCountChange?.(items.length || FALLBACK_ROSTER.length);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setRoster(FALLBACK_ROSTER);
        onCountChange?.(FALLBACK_ROSTER.length);
      })
      .finally(() => setLoading(false));
  }, [onCountChange]);

  return (
    <div className="evolvable-tab" data-agents-content="evolvable">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--cafe-text,#e5e7eb)]">
          可进化智能体花名册
        </h2>
        <p className="text-sm text-[var(--cafe-text-muted,#6b7280)] mt-0.5">
          5 个内置 Forgekin（wenxin / sherlock / luban / vangogh / davinci）· 来自 ForgeMind 引擎
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-[var(--cafe-text-muted,#6b7280)]">
          <div className="w-5 h-5 border-2 border-[var(--cafe-accent,#ff5c5c)] border-t-transparent rounded-full animate-spin mr-2" />
          加载花名册...
        </div>
      ) : (
        <>
          {error && (
            <div
              className="mb-4 p-3 rounded-lg text-sm"
              style={{
                background: "var(--semantic-warning-surface,rgba(245,158,11,0.15))",
                color: "var(--semantic-warning,#f59e0b)",
              }}
            >
              无法连接 ForgeMind 服务：{error}，已使用静态花名册兜底
            </div>
          )}
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            }}
            data-forgekin-grid="root"
          >
            {roster.map((item) => (
              <ForgekinCard key={item.id} forgekin={item} onEdit={onEdit} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
