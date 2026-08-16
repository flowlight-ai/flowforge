"use client";

/**
 * EvolvableAgentTab — 可进化智能体 Tab
 *
 * 依据 WEB-FUSION-DESIGN.md §6.2：
 *   显示 9 个内置 Forgekin 卡片网格（5 通用 + 4 新增）
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

// 兜底花名册：与 forgemind/forgekins/*.yaml 保持一致（9 个预置 Forgekin）
const FALLBACK_ROSTER: ForgekinRosterItem[] = [
  // 5 通用 Forgekin（F046 v1.1 §9.2 五闭环）
  { id: "wenxin", name: "文心", nickname: "文心", species: "bio", available: true, role: { primary: "documenter" }, evolutionStage: "E3", awakeningStage: "E3", llm_provider: "opencode", llm_model: "deepseek-v4-flash-free", llm_mode: "cli" },
  { id: "sherlock", name: "夏洛克", nickname: "夏洛克", species: "bio", available: true, role: { primary: "developer" }, evolutionStage: "E4", awakeningStage: "E4", llm_provider: "codex", llm_model: "Doubao-Seed2.0", llm_mode: "cli" },
  { id: "luban", name: "鲁班", nickname: "鲁班", species: "bio", available: true, role: { primary: "architect" }, evolutionStage: "E3", awakeningStage: "E3", llm_provider: "gemini", llm_model: "gemini-2.5-flash", llm_mode: "cli" },
  { id: "vangogh", name: "梵高", nickname: "梵高", species: "bio", available: true, role: { primary: "reviewer" }, evolutionStage: "E3", awakeningStage: "E3", llm_provider: "claude_code", llm_model: "Doubao-Seed2.0", llm_mode: "cli" },
  { id: "davinci", name: "达芬奇", nickname: "达芬奇", species: "bio", available: true, role: { primary: "tester" }, evolutionStage: "E3", awakeningStage: "E3", llm_provider: "codebuddy", llm_model: "hy3", llm_mode: "cli" },
  // 4 新增 Forgekin（F041 产品 + F042 运维 + 专属态 + F045 桥接）
  { id: "keane", name: "凯恩", nickname: "鹰·凯恩", species: "bio", available: true, role: { primary: "product-manager" }, evolutionStage: "E3", awakeningStage: "E3", llm_provider: "iflow", llm_model: "GLM-5.1", llm_mode: "cli" },
  { id: "humming", name: "蜂鸟", nickname: "蜂鸟·闪电", species: "bio", available: true, role: { primary: "devops" }, evolutionStage: "E3", awakeningStage: "E3", llm_provider: "opencode", llm_model: "deepseek-v4-flash-free", llm_mode: "cli" },
  { id: "sqrl", name: "铃鼓", nickname: "铃鼓", species: "bio", available: true, role: { primary: "coder" }, evolutionStage: "E3", awakeningStage: "E3", llm_provider: "opencode", llm_model: "deepseek-v4-flash-free", llm_mode: "cli" },
  { id: "butterfly", name: "幻蝶", nickname: "幻蝶", species: "bio", available: true, role: { primary: "bridge" }, evolutionStage: "E3", awakeningStage: "E3", llm_provider: "trae", llm_model: "", llm_mode: "bridge" },
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
          9 个内置 Forgekin（wenxin / sherlock / luban / vangogh / davinci / keane / humming / sqrl / butterfly）· 来自 ForgeMind 引擎
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
