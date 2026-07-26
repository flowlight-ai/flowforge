"use client";

/**
 * Forgekin 详情页 —— 可进化智能体档案
 *
 * 路由：/admin/agents/[forgekinId]
 *
 * 5 个 Tab：
 *   1. 身份（Soul Imprint）       —— 基本身份信息
 *   2. 能力画像（Capability Profile）—— 能力维度
 *   3. 经验记忆（EchoStore）      —— 长期记忆
 *   4. 进化阶（Evolution Stage）  —— 能力成熟度
 *   5. 觉醒阶（Awakening Stage）  —— 自主性等级
 *
 * 数据来源：/api/v1/forgemind/roster，失败时使用静态兜底。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  FORGEKIN_COLORS,
  FORGEKIN_EMOJI,
  type ForgekinRosterItem,
} from "@/lib/council-types";
import { HubForgekinEditor } from "@/components/admin/agents/HubForgekinEditor";

/* ------------------------------------------------------------------ */
/* 类型与常量                                                          */
/* ------------------------------------------------------------------ */

type DetailTab =
  | "identity"
  | "capability"
  | "echo-store"
  | "evolution"
  | "awakening";

interface TabDef {
  id: DetailTab;
  label: string;
  englishLabel: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: "identity", label: "身份", englishLabel: "Soul Imprint", icon: "◉" },
  { id: "capability", label: "能力画像", englishLabel: "Capability Profile", icon: "▦" },
  { id: "echo-store", label: "经验记忆", englishLabel: "EchoStore", icon: "❖" },
  { id: "evolution", label: "进化阶", englishLabel: "Evolution Stage", icon: "▲" },
  { id: "awakening", label: "觉醒阶", englishLabel: "Awakening Stage", icon: "✦" },
];

const VALID_TAB_IDS = new Set<DetailTab>(TABS.map((t) => t.id));

/** 静态兜底花名册（与 EvolvableAgentTab 一致） */
const FALLBACK_ROSTER: ForgekinRosterItem[] = [
  { id: "wenxin", name: "文心", nickname: "文心", species: "BIO", available: true, role: { primary: "架构师" }, evolutionStage: "E3", awakeningStage: "E2" },
  { id: "sherlock", name: "夏洛克", nickname: "夏洛克", species: "BIO", available: true, role: { primary: "开发者" }, evolutionStage: "E3", awakeningStage: "E2" },
  { id: "luban", name: "鲁班", nickname: "鲁班", species: "BIO", available: true, role: { primary: "架构师" }, evolutionStage: "E3", awakeningStage: "E2" },
  { id: "vangogh", name: "梵高", nickname: "梵高", species: "BIO", available: true, role: { primary: "评审员" }, evolutionStage: "E3", awakeningStage: "E2" },
  { id: "davinci", name: "达芬奇", nickname: "达芬奇", species: "BIO", available: true, role: { primary: "测试员" }, evolutionStage: "E3", awakeningStage: "E2" },
];

/* ------------------------------------------------------------------ */
/* 内部组件：身份 Tab                                                  */
/* ------------------------------------------------------------------ */

function IdentityTabContent({ forgekin }: { forgekin: ForgekinRosterItem }) {
  return (
    <div className="space-y-3" data-forgekin-tab-content="identity">
      <DetailRow label="ID" value={forgekin.id} mono />
      <DetailRow label="名称" value={forgekin.name} />
      <DetailRow label="昵称" value={forgekin.nickname || "—"} />
      <DetailRow label="形态" value={forgekin.species || "BIO"} />
      <DetailRow label="主角色" value={forgekin.role?.primary || "—"} />
      {forgekin.role?.secondary && forgekin.role.secondary.length > 0 && (
        <DetailRow label="次角色" value={forgekin.role.secondary.join(" / ")} />
      )}
      <DetailRow label="描述" value={forgekin.role?.description || "（暂无描述）"} />
      <DetailRow label="在线状态" value={forgekin.available ? "在线" : "离线"} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 内部组件：能力画像 Tab                                              */
/* ------------------------------------------------------------------ */

function CapabilityTabContent({ forgekin }: { forgekin: ForgekinRosterItem }) {
  const capabilities = [
    { name: "推理能力", score: 0.78 },
    { name: "工具调用", score: 0.85 },
    { name: "代码生成", score: 0.72 },
    { name: "文档撰写", score: 0.68 },
    { name: "多轮对话", score: 0.9 },
  ];
  return (
    <div className="space-y-3" data-forgekin-tab-content="capability">
      <p className="text-xs text-[var(--cafe-text-muted,#6b7280)]">
        能力画像展示该可进化智能体在各能力维度的成熟度评分（占位数据，后续 Phase 接入 capability_profile）。
      </p>
      {capabilities.map((c) => (
        <div key={c.name}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-[var(--cafe-text-secondary,#9ca3af)]">{c.name}</span>
            <span className="font-mono text-[var(--cafe-accent,#ff5c5c)]">{(c.score * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--console-rail-item,#252633)] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${c.score * 100}%`,
                background: "var(--cafe-accent,#ff5c5c)",
              }}
            />
          </div>
        </div>
      ))}
      <p className="text-[10px] text-[var(--cafe-text-muted,#6b7280)] pt-2">
        形态：{forgekin.species || "BIO"} · 主角色：{forgekin.role?.primary || "—"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 内部组件：经验记忆 Tab                                              */
/* ------------------------------------------------------------------ */

function EchoStoreTabContent({ forgekin }: { forgekin: ForgekinRosterItem }) {
  const memories = [
    { id: "mem-001", summary: "首次参与灵议：用户系统架构设计", ts: "2025-10-12" },
    { id: "mem-002", summary: "完成代码评审任务：FlowForge 编译器模块", ts: "2025-10-18" },
    { id: "mem-003", summary: "工具调用失败重试策略沉淀", ts: "2025-11-02" },
  ];
  return (
    <div className="space-y-2" data-forgekin-tab-content="echo-store">
      <p className="text-xs text-[var(--cafe-text-muted,#6b7280)] mb-2">
        EchoStore 存储可进化智能体的长期经验记忆（占位数据，后续 Phase 接入 OpenSieve 检索）。
      </p>
      {memories.map((m) => (
        <div
          key={m.id}
          className="flex items-start gap-3 p-2.5 rounded-md border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)]"
          data-forgekin-echo={m.id}
        >
          <span className="flex-shrink-0 text-xs font-mono text-[var(--cafe-text-muted,#6b7280)] mt-0.5">
            {m.ts}
          </span>
          <span className="text-xs text-[var(--cafe-text-secondary,#9ca3af)]">{m.summary}</span>
        </div>
      ))}
      <p className="text-[10px] text-[var(--cafe-text-muted,#6b7280)] pt-1">
        归属：{forgekin.id}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 内部组件：进化阶 Tab                                                */
/* ------------------------------------------------------------------ */

function EvolutionTabContent({ forgekin }: { forgekin: ForgekinRosterItem }) {
  const stage = forgekin.evolutionStage || "E3";
  const stages = ["E1", "E2", "E3", "E4", "E5", "E6"];
  const currentIndex = stages.indexOf(stage);
  return (
    <div className="space-y-3" data-forgekin-tab-content="evolution">
      <p className="text-xs text-[var(--cafe-text-muted,#6b7280)]">
        进化阶（Evolution Stage）反映可进化智能体的能力成熟度，从 E1 到 E6 逐步提升。
      </p>
      <div className="flex items-center justify-between">
        {stages.map((s, i) => {
          const reached = i <= currentIndex;
          const isCurrent = s === stage;
          return (
            <div key={s} className="flex flex-col items-center gap-1 flex-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: reached
                    ? "var(--cafe-accent,#ff5c5c)"
                    : "var(--console-rail-item,#252633)",
                  color: reached ? "#fff" : "var(--cafe-text-muted,#6b7280)",
                  border: isCurrent
                    ? "2px solid var(--cafe-text,#e5e7eb)"
                    : "2px solid transparent",
                }}
              >
                {s}
              </div>
              {isCurrent && (
                <span className="text-[10px] text-[var(--cafe-accent,#ff5c5c)] font-medium">
                  当前
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[var(--cafe-text-secondary,#9ca3af)] pt-2">
        当前等级：{stage}（共 {stages.length} 级）
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 内部组件：觉醒阶 Tab                                                */
/* ------------------------------------------------------------------ */

function AwakeningTabContent({ forgekin }: { forgekin: ForgekinRosterItem }) {
  const stage = forgekin.awakeningStage || "E2";
  const stages = ["E1", "E2", "E3", "E4", "E5", "E6"];
  const currentIndex = stages.indexOf(stage);
  return (
    <div className="space-y-3" data-forgekin-tab-content="awakening">
      <p className="text-xs text-[var(--cafe-text-muted,#6b7280)]">
        觉醒阶（Awakening Stage）反映可进化智能体的自主性等级，从 E1（被动响应）到 E6（完全自主）。
      </p>
      <div className="flex items-center justify-between">
        {stages.map((s, i) => {
          const reached = i <= currentIndex;
          const isCurrent = s === stage;
          return (
            <div key={s} className="flex flex-col items-center gap-1 flex-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: reached
                    ? "var(--semantic-info,#3b82f6)"
                    : "var(--console-rail-item,#252633)",
                  color: reached ? "#fff" : "var(--cafe-text-muted,#6b7280)",
                  border: isCurrent
                    ? "2px solid var(--cafe-text,#e5e7eb)"
                    : "2px solid transparent",
                }}
              >
                {s}
              </div>
              {isCurrent && (
                <span className="text-[10px] text-[var(--semantic-info,#3b82f6)] font-medium">
                  当前
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[var(--cafe-text-secondary,#9ca3af)] pt-2">
        当前等级：{stage}（共 {stages.length} 级）
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 共用：详情行                                                        */
/* ------------------------------------------------------------------ */

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-[var(--cafe-border-subtle,#1f2030)]">
      <span className="flex-shrink-0 w-20 text-xs text-[var(--cafe-text-muted,#6b7280)] uppercase tracking-wider">
        {label}
      </span>
      <span
        className={`flex-1 text-sm text-[var(--cafe-text,#e5e7eb)] ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 内部组件：主体内容（使用 useSearchParams，需 Suspense 包裹）        */
/* ------------------------------------------------------------------ */

function ForgekinDetailInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const forgekinId = (params?.forgekinId as string) || "";

  // 从 query 解析初始 tab
  const initialTabParam = searchParams.get("tab");
  const initialTab: DetailTab = VALID_TAB_IDS.has(initialTabParam as DetailTab)
    ? (initialTabParam as DetailTab)
    : "identity";

  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [forgekin, setForgekin] = useState<ForgekinRosterItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // action=edit 时自动打开编辑器
  useEffect(() => {
    if (searchParams.get("action") === "edit") {
      setEditorOpen(true);
    }
  }, [searchParams]);

  // 拉取详情
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/v1/forgemind/roster")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const items: ForgekinRosterItem[] = data.builtin || data.roster || [];
        const found = items.find((it) => it.id === forgekinId);
        if (found) {
          setForgekin(found);
        } else {
          // 兜底：在静态花名册中查找
          const fallback = FALLBACK_ROSTER.find((it) => it.id === forgekinId);
          if (fallback) {
            setForgekin(fallback);
            setError("后端 roster 未返回该项，已使用静态数据兜底");
          } else {
            setError(`未找到 Forgekin: ${forgekinId}`);
          }
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        const fallback = FALLBACK_ROSTER.find((it) => it.id === forgekinId);
        if (fallback) setForgekin(fallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [forgekinId]);

  const handleTabChange = useCallback(
    (next: DetailTab) => {
      setTab(next);
      // 同步到 URL（替换以避免历史污染）
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      url.searchParams.delete("action");
      window.history.replaceState(null, "", url.toString());
    },
    []
  );

  const colors = forgekin
    ? FORGEKIN_COLORS[forgekin.id] || { primary: "#888", secondary: "#333" }
    : { primary: "#888", secondary: "#333" };
  const emoji = forgekin ? FORGEKIN_EMOJI[forgekin.id] || "🤖" : "🤖";

  return (
    <div className="forgekin-detail animate-rise p-6" data-forgekin-detail="root">
      {/* 返回链接 */}
      <div className="mb-4">
        <Link
          href="/admin/agents"
          className="text-xs text-[var(--cafe-text-muted,#6b7280)] hover:text-[var(--cafe-text,#e5e7eb)] transition-colors"
        >
          ← 返回智能体管理
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-[var(--cafe-text-muted,#6b7280)] text-sm">
          <div className="w-4 h-4 border-2 border-[var(--cafe-accent,#ff5c5c)] border-t-transparent rounded-full animate-spin mr-2" />
          加载 Forgekin 详情...
        </div>
      ) : !forgekin ? (
        <div
          className="p-4 rounded-md text-sm"
          style={{
            background: "var(--semantic-critical-surface,rgba(239,68,68,0.15))",
            color: "var(--semantic-critical,#ef4444)",
          }}
        >
          {error || "未找到该可进化智能体"}
        </div>
      ) : (
        <>
          {/* 顶部：基本信息卡 */}
          <div
            className="rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)] p-5 mb-4"
            data-forgekin-detail-header="true"
          >
            <div className="flex items-start gap-4">
              {/* 头像 */}
              <div
                className="flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center text-3xl"
                style={{
                  background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
                  border: `1px solid ${colors.primary}66`,
                }}
              >
                {emoji}
              </div>

              {/* 名称 + 角色 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-lg font-semibold text-[var(--cafe-text,#e5e7eb)]">
                    {forgekin.name}
                  </h1>
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
                <div className="text-sm text-[var(--cafe-text-muted,#6b7280)] mb-2">
                  <span className="font-mono">{forgekin.id}</span>
                  {" · "}
                  <span>{forgekin.role?.primary || "—"}</span>
                  {" · "}
                  <span>形态 {forgekin.species || "BIO"}</span>
                </div>
                {/* E3 / E2 徽章 */}
                <div className="flex gap-2">
                  <span
                    className="text-xs px-2 py-0.5 rounded font-mono"
                    style={{
                      background: "var(--cafe-accent,#ff5c5c)",
                      color: "#fff",
                    }}
                    data-forgekin-stage="evolution"
                  >
                    进化阶 {forgekin.evolutionStage || "E3"}
                  </span>
                  <span
                    className="text-xs px-2 py-0.5 rounded font-mono"
                    style={{
                      background: "var(--semantic-info,#3b82f6)",
                      color: "#fff",
                    }}
                    data-forgekin-stage="awakening"
                  >
                    觉醒阶 {forgekin.awakeningStage || "E2"}
                  </span>
                </div>
              </div>

              {/* 编辑按钮 */}
              <button
                type="button"
                onClick={() => setEditorOpen(true)}
                className="flex-shrink-0 text-xs px-3 py-1.5 rounded bg-[var(--cafe-accent,#ff5c5c)] text-white hover:opacity-90 transition-opacity"
                data-forgekin-detail-action="edit"
              >
                编辑
              </button>
            </div>

            {error && (
              <div
                className="mt-3 p-2 rounded text-xs"
                style={{
                  background: "var(--semantic-warning-surface,rgba(245,158,11,0.15))",
                  color: "var(--semantic-warning,#f59e0b)",
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Tab 切换栏 */}
          <div
            className="flex gap-1 mb-4 border-b border-[var(--cafe-border,#2a2c3a)]"
            data-forgekin-detail-tabbar="true"
          >
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleTabChange(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all border-b-2 -mb-px ${
                    active
                      ? "border-[var(--cafe-accent,#ff5c5c)] text-[var(--cafe-text,#e5e7eb)]"
                      : "border-transparent text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)]"
                  }`}
                  data-forgekin-detail-tab={t.id}
                  data-active={active ? "true" : "false"}
                  aria-current={active ? "page" : undefined}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                  <span className="text-[10px] opacity-60 hidden sm:inline">
                    {t.englishLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Tab 内容区 */}
          <div
            className="rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)] p-5"
            data-forgekin-detail-panel={tab}
          >
            {tab === "identity" && <IdentityTabContent forgekin={forgekin} />}
            {tab === "capability" && <CapabilityTabContent forgekin={forgekin} />}
            {tab === "echo-store" && <EchoStoreTabContent forgekin={forgekin} />}
            {tab === "evolution" && <EvolutionTabContent forgekin={forgekin} />}
            {tab === "awakening" && <AwakeningTabContent forgekin={forgekin} />}
          </div>
        </>
      )}

      {/* 编辑器抽屉 */}
      <HubForgekinEditor
        forgekinId={forgekinId}
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          // 清理 URL 中的 action=edit
          const url = new URL(window.location.href);
          if (url.searchParams.has("action")) {
            url.searchParams.delete("action");
            window.history.replaceState(null, "", url.toString());
          }
          router.replace(url.toString());
        }}
        onSaved={() => {
          // 保存成功后重新加载详情（简单实现：触发整页刷新的等效效果）
          setEditorOpen(false);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 默认导出：用 Suspense 包裹（useSearchParams 要求）                 */
/* ------------------------------------------------------------------ */

export default function ForgekinDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12 text-[var(--cafe-text-muted,#6b7280)] text-sm">
          <div className="w-4 h-4 border-2 border-[var(--cafe-accent,#ff5c5c)] border-t-transparent rounded-full animate-spin mr-2" />
          加载详情页...
        </div>
      }
    >
      <ForgekinDetailInner />
    </Suspense>
  );
}
