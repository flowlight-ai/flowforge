"use client";

/**
 * HubEvalFrictionSections — 评估摩擦分析分区
 *
 * 用于 HubEvalTab 内部，渲染 EvalHubFrictionProjection 的摩擦分析视图：
 *   - 建议修复条目（actionableCandidates）：含 followupDraft 草案
 *   - 仅引用条目（referenceOnly）：仅保留链接语义
 *   - 原始报告跳转按钮（openWorkspaceFile）
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 主题：使用 var(--cafe-xxx) CSS 变量。
 * 独立性：仅依赖 HubEvalTypes 类型，不依赖上游
 */

import type { ReactNode } from "react";
import type { EvalHubFrictionProjection } from "./HubEvalTypes";

interface HubEvalFrictionSectionsProps {
  friction: EvalHubFrictionProjection | undefined;
  /** 打开工作区文件（用于跳转到原始报告） */
  openWorkspaceFile: (path: string) => void;
}

export function HubEvalFrictionSections({
  friction,
  openWorkspaceFile,
}: HubEvalFrictionSectionsProps) {
  if (!friction || friction.projectionStatus !== "available") {
    return (
      <div
        className="mt-4 rounded-lg border border-dashed px-3 py-3 text-sm"
        style={{
          borderColor: "var(--cafe-border,#2a2c3a)",
          background: "var(--cafe-surface,#1e1f26)",
          color: "var(--cafe-text-secondary,#9ca3af)",
        }}
        data-eval-friction="unavailable"
      >
        这条 <code className="font-mono text-xs">eval:friction</code> verdict 还没有可读的
        Phase D raw report，Hub 不会伪造&ldquo;建议修复&rdquo;。
      </div>
    );
  }

  const hasAnyProjection =
    friction.actionableCandidates.length > 0 || friction.referenceOnly.length > 0;

  return (
    <div className="mt-4 space-y-3" data-eval-friction="available">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="text-xs font-medium"
          style={{ color: "var(--cafe-text-muted,#6b7280)" }}
        >
          Friction Rollup 视图
        </div>
        {friction.source?.rawReportPath && (
          <JumpButton onClick={() => openWorkspaceFile(friction.source?.rawReportPath ?? "")}>
            原始报告
          </JumpButton>
        )}
      </div>

      {!hasAnyProjection && (
        <div
          className="rounded-lg border border-dashed px-3 py-3 text-sm"
          style={{
            borderColor: "var(--cafe-border,#2a2c3a)",
            background: "var(--cafe-surface,#1e1f26)",
            color: "var(--cafe-text-secondary,#9ca3af)",
          }}
          data-eval-friction="empty"
        >
          本期 friction rollup 没有形成&ldquo;建议修复&rdquo;或&ldquo;仅引用&rdquo;条目。
        </div>
      )}

      {friction.actionableCandidates.length > 0 && (
        <div className="space-y-2" data-eval-friction-section="actionable">
          <div
            className="text-sm font-semibold"
            style={{ color: "var(--cafe-text,#e5e7eb)" }}
          >
            建议修复
          </div>
          <p
            className="text-xs"
            style={{ color: "var(--cafe-text-muted,#6b7280)" }}
          >
            仅是 proposal draft，不会自动开 thread。
          </p>
          {friction.actionableCandidates.map((candidate) => (
            <div
              key={candidate.clusterId}
              className="rounded-lg border px-3 py-3"
              style={{
                borderColor: "var(--cafe-border,#2a2c3a)",
                background: "var(--cafe-surface,#1e1f26)",
              }}
              data-eval-friction-candidate={candidate.clusterId}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="text-sm font-semibold"
                  style={{ color: "var(--cafe-text,#e5e7eb)" }}
                >
                  {candidate.followupDraft.title}
                </div>
                <MetaPill>{candidate.severity}</MetaPill>
                <MetaPill>{candidate.count} signals</MetaPill>
              </div>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
              >
                {candidate.followupDraft.summary}
              </p>
              <p
                className="mt-2 text-xs"
                style={{ color: "var(--cafe-text-muted,#6b7280)" }}
              >
                通道: {candidate.channels.join(", ")} · 传感器形态:{" "}
                {candidate.sensorForms.join(", ")}
              </p>
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--cafe-text-muted,#6b7280)" }}
              >
                draft evidence: {candidate.followupDraft.evidenceRefs.length} ·
                reference-only evidence: {candidate.referenceOnlyEvidenceRefs.length}
              </p>
            </div>
          ))}
        </div>
      )}

      {friction.referenceOnly.length > 0 && (
        <div className="space-y-2" data-eval-friction-section="reference-only">
          <div
            className="text-sm font-semibold"
            style={{ color: "var(--cafe-text,#e5e7eb)" }}
          >
            仅引用
          </div>
          <p
            className="text-xs"
            style={{ color: "var(--cafe-text-muted,#6b7280)" }}
          >
            这些 cluster 只保留链接语义，不重复开启修复出口。
          </p>
          {friction.referenceOnly.map((cluster) => (
            <div
              key={cluster.clusterId}
              className="rounded-lg border px-3 py-3"
              style={{
                borderColor: "var(--cafe-border,#2a2c3a)",
                background: "var(--cafe-surface,#1e1f26)",
              }}
              data-eval-friction-reference={cluster.clusterId}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="text-sm font-semibold"
                  style={{ color: "var(--cafe-text,#e5e7eb)" }}
                >
                  {cluster.representative}
                </div>
                <MetaPill>{cluster.severity}</MetaPill>
                <MetaPill>{cluster.count} signals</MetaPill>
              </div>
              <p
                className="mt-2 text-xs"
                style={{ color: "var(--cafe-text-muted,#6b7280)" }}
              >
                通道: {cluster.channels.join(", ")} · 传感器形态:{" "}
                {cluster.sensorForms.join(", ")} · evidence: {cluster.evidenceRefs.length}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 内联原语                                                            */
/* ------------------------------------------------------------------ */

function JumpButton({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
      style={{
        borderColor: "var(--cafe-border,#2a2c3a)",
        color: "var(--cafe-text-secondary,#9ca3af)",
      }}
      data-eval-friction-action="jump"
    >
      {children}
    </button>
  );
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{
        background: "var(--cafe-bg,#0f1015)",
        color: "var(--cafe-text-muted,#6b7280)",
      }}
    >
      {children}
    </span>
  );
}

export default HubEvalFrictionSections;
