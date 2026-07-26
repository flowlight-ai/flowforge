"use client";

/**
 * MarketplaceCard — 能力包卡片
 *
 * 展示能力包名称、作者、简介、安装数、评分、版本、安装按钮。
 * 移植自 clowder-ai artifact-card，简化为只读卡片。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 */

import { useState } from "react";

export interface MarketplaceArtifact {
  readonly id: string;
  readonly ecosystem: string;
  readonly artifactId: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly author: string;
  readonly category: string;
  readonly version: string;
  readonly installs: number;
  readonly rating: number;
  readonly tags: readonly string[];
  readonly verified?: boolean;
  readonly featured?: boolean;
}

interface MarketplaceCardProps {
  readonly artifact: MarketplaceArtifact;
  readonly onInstall?: (id: string) => void;
}

export function MarketplaceCard({ artifact, onInstall }: MarketplaceCardProps) {
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  const handleInstall = async () => {
    if (!onInstall || installing || installed) return;
    setInstalling(true);
    try {
      await onInstall(artifact.id);
      setInstalled(true);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      data-marketplace="card"
      data-marketplace-id={artifact.id}
      data-marketplace-category={artifact.category}
      style={{
        padding: "14px",
        background: "var(--bg-elevated)",
        border: artifact.featured
          ? "1px solid color-mix(in srgb, var(--accent) 50%, var(--border))"
          : "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        position: "relative",
      }}
    >
      {artifact.featured && (
        <span
          data-marketplace-badge="featured"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontSize: "10px",
            fontWeight: 700,
            color: "var(--accent)",
            background: "color-mix(in srgb, var(--accent) 18%, transparent)",
            padding: "2px 6px",
            borderRadius: "10px",
          }}
        >
          ★ 精选
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingRight: artifact.featured ? 60 : 0 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--radius-sm)",
            background: "var(--accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {artifact.displayName.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg)", display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artifact.displayName}</span>
            {artifact.verified && (
              <span title="已验证" style={{ color: "var(--ok)", fontSize: "11px" }}>✓</span>
            )}
          </div>
          <div style={{ fontSize: "11px", color: "var(--muted)" }}>
            @{artifact.author} · v{artifact.version}
          </div>
        </div>
      </div>

      <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5, minHeight: "36px" }}>
        {artifact.description.length > 80 ? artifact.description.slice(0, 79) + "…" : artifact.description}
      </div>

      {artifact.tags.length > 0 && (
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {artifact.tags.slice(0, 4).map((t) => (
            <span key={t} className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)", fontSize: "10px" }}>
              #{t}
            </span>
          ))}
        </div>
      )}

      <div
        data-marketplace="stats"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--muted)" }}
      >
        <div style={{ display: "flex", gap: "10px" }}>
          <span>↓ {formatCount(artifact.installs)}</span>
          <span style={{ color: artifact.rating >= 0.85 ? "var(--ok)" : "var(--warn)" }}>
            ★ {(artifact.rating * 100).toFixed(0)}%
          </span>
        </div>
        <span className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)", fontSize: "10px" }}>
          {artifact.category}
        </span>
      </div>

      <button
        data-marketplace-action="install"
        onClick={handleInstall}
        disabled={installing || installed || !onInstall}
        style={{
          padding: "6px 12px",
          borderRadius: "var(--radius-sm)",
          border: "none",
          background: installed ? "var(--ok)" : "var(--accent)",
          color: "#fff",
          fontSize: "12px",
          fontWeight: 600,
          cursor: installing || installed || !onInstall ? "not-allowed" : "pointer",
          opacity: installing ? 0.6 : 1,
        }}
      >
        {installed ? "已安装 ✓" : installing ? "安装中..." : "安装"}
      </button>
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
