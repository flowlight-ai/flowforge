"use client";

/**
 * /mission/[id] — 任务详情页
 *
 * 展示单个任务的完整信息、进度历史、关联可进化智能体。
 * 移植自 clowder-ai mission/[id]，简化为只读详情视图。
 *
 * API：GET /api/v1/missions/{id}
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface MissionDetail {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly priority: string;
  readonly assignee?: string;
  readonly forgekinId?: string;
  readonly tags: readonly string[];
  readonly progress: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dueAt?: string;
  readonly history: ReadonlyArray<{
    readonly at: string;
    readonly actor: string;
    readonly action: string;
    readonly detail?: string;
  }>;
}

interface PageProps {
  readonly params: { id: string };
}

export default function MissionDetailPage({ params }: PageProps) {
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/missions/${encodeURIComponent(params.id)}`);
      if (res.status === 404) {
        setDetail(null);
        setError("任务不存在");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MissionDetail;
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="animate-rise">
        <div className="card" style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>加载中...</div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="animate-rise" data-mission="detail-error">
        <div className="card" style={errorBoxStyle}>
          <span>任务详情加载失败：{error ?? "未知错误"}</span>
          <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise" data-mission="detail">
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <Link href="/mission-hub" style={{ color: "var(--muted)", fontSize: "12px", textDecoration: "none" }}>
            ← 返回 Mission Hub
          </Link>
          <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
        </div>
        <h2 className="page-title" style={{ margin: "8px 0 4px 0" }}>{detail.title}</h2>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          任务 ID：<code style={{ fontFamily: "monospace", fontSize: "12px" }}>{detail.id}</code>
        </p>

        <div
          data-mission="detail-meta"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <Meta label="状态" value={<span className="pill">{detail.status}</span>} />
          <Meta label="优先级" value={<span className="pill">{detail.priority}</span>} />
          <Meta label="负责人" value={detail.assignee ? `@${detail.assignee}` : "未指派"} />
          <Meta label="可进化智能体" value={detail.forgekinId ? `◆ ${detail.forgekinId.slice(0, 8)}` : "-"} />
          <Meta label="创建时间" value={detail.createdAt.slice(0, 19)} />
          <Meta label="更新时间" value={detail.updatedAt.slice(0, 19)} />
          <Meta label="截止时间" value={detail.dueAt ? detail.dueAt.slice(0, 19) : "-"} />
          <Meta label="进度" value={`${detail.progress.toFixed(0)}%`} />
        </div>

        {detail.tags.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "6px" }}>标签</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {detail.tags.map((t) => (
                <span key={t} className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)" }}>#{t}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "6px" }}>描述</div>
          <div style={{ padding: "12px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: "13px", lineHeight: 1.6, color: "var(--fg)", whiteSpace: "pre-wrap" }}>
            {detail.description || "（无描述）"}
          </div>
        </div>

        <div data-mission="detail-history">
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "8px" }}>历史记录（{detail.history.length}）</div>
          {detail.history.length === 0 ? (
            <div style={emptyStyle}>无历史记录</div>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
              {detail.history.map((h, idx) => (
                <li
                  key={idx}
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "12px",
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: "8px",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontFamily: "monospace", color: "var(--muted)" }}>{h.at.slice(0, 19)}</span>
                  <span>
                    <strong style={{ color: "var(--accent)" }}>{h.actor}</strong> · {h.action}
                    {h.detail && <span style={{ color: "var(--muted)" }}> — {h.detail}</span>}
                  </span>
                  <span className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)" }}>{idx + 1}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <div style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg)" }}>{value}</div>
    </div>
  );
}

const refreshBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--accent)",
  fontSize: "13px",
  fontWeight: 600,
};

const errorBoxStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "var(--radius-sm)",
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  fontSize: "13px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const retryBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--danger)",
  fontWeight: 600,
  fontSize: "12px",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "20px",
  color: "var(--muted)",
  fontSize: "13px",
};
