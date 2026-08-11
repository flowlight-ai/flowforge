"use client";

/**
 * WorkspaceArtifactsPanel — 产物中心
 *
 * 7 种产物类型（图片/文件/代码/PR/音频/视频/Widget）+ 全局/对话双源
 * 对应 clowder-ai 的 artifacts 模块
 */

import { useState, useEffect, useCallback } from "react";

// ── 类型定义 ───────────────────────────────────────────────────────

type ArtifactType = "image" | "file" | "code" | "pr" | "audio" | "video" | "widget";
type ArtifactSource = "global" | "thread";

interface ArtifactItem {
  id: string;
  type: ArtifactType;
  title: string;
  description?: string;
  source: ArtifactSource;
  threadId?: string;
  createdAt: string;
  size?: number;
  url?: string;
  thumbnail?: string;
  metadata?: Record<string, unknown>;
}

// ── 产物类型配置 ───────────────────────────────────────────────────

const ARTIFACT_TYPES: Array<{ id: ArtifactType; label: string; icon: string; color: string }> = [
  { id: "image", label: "图片", icon: "🖼️", color: "var(--chart-1)" },
  { id: "file", label: "文件", icon: "📄", color: "var(--chart-2)" },
  { id: "code", label: "代码", icon: "💻", color: "var(--chart-3)" },
  { id: "pr", label: "PR", icon: "🔀", color: "var(--chart-4)" },
  { id: "audio", label: "音频", icon: "🎵", color: "var(--chart-5)" },
  { id: "video", label: "视频", icon: "🎬", color: "var(--chart-6)" },
  { id: "widget", label: "Widget", icon: "🧩", color: "var(--chart-7)" },
];

// ── 产物卡片 ───────────────────────────────────────────────────────

function ArtifactCard({ artifact }: { artifact: ArtifactItem }) {
  const typeConfig = ARTIFACT_TYPES.find((t) => t.id === artifact.type);
  const timeAgo = new Date(artifact.createdAt).toLocaleDateString("zh-CN");

  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: "var(--radius-sm, 4px)",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        fontSize: "12px",
        cursor: "pointer",
        transition: "box-shadow 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "var(--shadow-sm)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.transform = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "18px" }}>{typeConfig?.icon || "📦"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {artifact.title}
          </div>
          {artifact.description && (
            <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {artifact.description}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
            <span>{timeAgo}</span>
            {artifact.size !== undefined && (
              <span>{artifact.size < 1024 ? `${artifact.size}B` : `${(artifact.size / 1024).toFixed(1)}KB`}</span>
            )}
            <span style={{ color: artifact.source === "thread" ? "var(--accent)" : "var(--info)" }}>
              {artifact.source === "thread" ? "对话" : "全局"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 类型选择器 ─────────────────────────────────────────────────────

function TypeSelector({
  selected,
  onChange,
}: {
  selected: ArtifactType | "all";
  onChange: (type: ArtifactType | "all") => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "4px",
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <button
        type="button"
        onClick={() => onChange("all")}
        style={{
          padding: "3px 8px",
          borderRadius: "var(--radius-sm, 4px)",
          fontSize: "10px",
          border: selected === "all" ? "1px solid var(--accent)" : "1px solid var(--border)",
          background: selected === "all" ? "var(--accent-subtle)" : "var(--bg)",
          color: selected === "all" ? "var(--accent)" : "var(--muted)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontWeight: selected === "all" ? 600 : 400,
        }}
      >
        全部
      </button>
      {ARTIFACT_TYPES.map((type) => (
        <button
          key={type.id}
          type="button"
          onClick={() => onChange(type.id)}
          style={{
            padding: "3px 8px",
            borderRadius: "var(--radius-sm, 4px)",
            fontSize: "10px",
            border: selected === type.id ? "1px solid var(--accent)" : "1px solid var(--border)",
            background: selected === type.id ? "var(--accent-subtle)" : "var(--bg)",
            color: selected === type.id ? "var(--accent)" : "var(--muted)",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: selected === type.id ? 600 : 400,
          }}
        >
          {type.icon} {type.label}
        </button>
      ))}
    </div>
  );
}

// ── 统计概览 ───────────────────────────────────────────────────────

function ArtifactStats({ artifacts }: { artifacts: ArtifactItem[] }) {
  const counts = ARTIFACT_TYPES.map((type) => ({
    ...type,
    count: artifacts.filter((a) => a.type === type.id).length,
  }));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
        gap: "6px",
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {counts.map((type) => (
        <div
          key={type.id}
          style={{
            textAlign: "center",
            padding: "6px 4px",
            borderRadius: "var(--radius-sm, 4px)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: "16px" }}>{type.icon}</div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: type.color, marginTop: "2px" }}>
            {type.count}
          </div>
          <div style={{ fontSize: "9px", color: "var(--muted)" }}>{type.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

interface ArtifactsPanelProps {
  threadId?: string | null;
}

export default function WorkspaceArtifactsPanel({ threadId }: ArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<ArtifactType | "all">("all");
  const [source, setSource] = useState<ArtifactSource | "all">("all");

  const fetchArtifacts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (threadId) params.set("threadId", threadId);
      const res = await fetch(`/api/v1/artifacts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setArtifacts(data.items ?? data.artifacts ?? []);
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  const filtered = artifacts.filter((a) => {
    if (filterType !== "all" && a.type !== filterType) return false;
    if (source !== "all" && a.source !== source) return false;
    return true;
  });

  if (loading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
        加载产物数据...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px" }}>📦</span>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>产物中心</span>
          <span style={{ fontSize: "10px", color: "var(--muted)" }}>({artifacts.length})</span>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            type="button"
            onClick={() => setSource("all")}
            style={{
              padding: "2px 6px",
              fontSize: "10px",
              borderRadius: "var(--radius-sm, 4px)",
              border: source === "all" ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: source === "all" ? "var(--accent-subtle)" : "var(--bg)",
              color: source === "all" ? "var(--accent)" : "var(--muted)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setSource("global")}
            style={{
              padding: "2px 6px",
              fontSize: "10px",
              borderRadius: "var(--radius-sm, 4px)",
              border: source === "global" ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: source === "global" ? "var(--accent-subtle)" : "var(--bg)",
              color: source === "global" ? "var(--accent)" : "var(--muted)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            全局
          </button>
          <button
            type="button"
            onClick={() => setSource("thread")}
            style={{
              padding: "2px 6px",
              fontSize: "10px",
              borderRadius: "var(--radius-sm, 4px)",
              border: source === "thread" ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: source === "thread" ? "var(--accent-subtle)" : "var(--bg)",
              color: source === "thread" ? "var(--accent)" : "var(--muted)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            对话
          </button>
        </div>
      </div>

      {/* 统计概览 */}
      <ArtifactStats artifacts={artifacts} />

      {/* 类型筛选 */}
      <TypeSelector selected={filterType} onChange={setFilterType} />

      {/* 产物列表 */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: "12px",
              }}
            >
              <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>📦</div>
              <div>暂无产物</div>
            </div>
          ) : (
            filtered.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}