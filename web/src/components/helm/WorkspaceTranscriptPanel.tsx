"use client";

/**
 * WorkspaceTranscriptPanel — 转录面板
 *
 * 文字记录面板，显示对话/音频转录文本
 * 对应 clowder-ai 的 transcript 模块
 */

import { useState, useEffect, useCallback } from "react";

// ── 类型定义 ───────────────────────────────────────────────────────

interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  durationMs?: number;
  confidence?: number;
  source: "live" | "recorded" | "imported";
  language?: string;
}

// ── 说话者颜色 ─────────────────────────────────────────────────────

const SPEAKER_COLORS: Record<string, string> = {
  user: "var(--info)",
  assistant: "var(--accent)",
  system: "var(--muted)",
};

function getSpeakerColor(speaker: string): string {
  return SPEAKER_COLORS[speaker.toLowerCase()] || `hsl(${speaker.length * 60 % 360}, 60%, 60%)`;
}

// ── 转录条目 ───────────────────────────────────────────────────────

function TranscriptEntryItem({ entry }: { entry: TranscriptEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString("zh-CN");
  const speakerColor = getSpeakerColor(entry.speaker);

  return (
    <div
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: "var(--radius-sm, 4px)",
            fontSize: "10px",
            fontWeight: 600,
            background: `${speakerColor}20`,
            color: speakerColor,
          }}
        >
          {entry.speaker}
        </span>
        <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "var(--mono)" }}>
          {time}
        </span>
        {entry.durationMs !== undefined && (
          <span style={{ fontSize: "10px", color: "var(--muted)" }}>
            ({entry.durationMs < 1000 ? `${entry.durationMs}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`})
          </span>
        )}
        {entry.confidence !== undefined && (
          <span
            style={{
              fontSize: "9px",
              padding: "1px 4px",
              borderRadius: "3px",
              background: entry.confidence > 0.9 ? "var(--ok-subtle)" : entry.confidence > 0.7 ? "var(--warn-subtle)" : "var(--danger-subtle)",
              color: entry.confidence > 0.9 ? "var(--ok)" : entry.confidence > 0.7 ? "var(--warn)" : "var(--destructive)",
            }}
          >
            {Math.round(entry.confidence * 100)}%
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: "9px", color: "var(--muted)" }}>
          {entry.source === "live" ? "实时" : entry.source === "recorded" ? "录制" : "导入"}
        </span>
      </div>
      <div style={{ fontSize: "12px", color: "var(--text)", lineHeight: 1.6, paddingLeft: "4px" }}>
        {entry.text}
      </div>
      {entry.language && entry.language !== "zh" && (
        <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
          🌐 {entry.language}
        </div>
      )}
    </div>
  );
}

// ── 搜索栏 ─────────────────────────────────────────────────────────

function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 8px",
          borderRadius: "var(--radius-sm, 4px)",
          border: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <span style={{ fontSize: "12px", color: "var(--muted)" }}>🔍</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索转录内容..."
          style={{
            flex: 1,
            background: "none",
            border: "none",
            color: "var(--text)",
            fontSize: "12px",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            style={{
              background: "none",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "inherit",
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// ── 统计信息 ───────────────────────────────────────────────────────

function TranscriptStats({ entries }: { entries: TranscriptEntry[] }) {
  const speakers = Array.from(new Set(entries.map((e) => e.speaker)));
  const totalDuration = entries.reduce((sum, e) => sum + (e.durationMs || 0), 0);
  const avgConfidence = entries.filter((e) => e.confidence !== undefined).reduce((sum, e, _, arr) => sum + (e.confidence || 0) / arr.length, 0);

  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        padding: "6px 12px",
        borderBottom: "1px solid var(--border)",
        fontSize: "10px",
        color: "var(--muted)",
        flexWrap: "wrap",
      }}
    >
      <span>条目: <strong style={{ color: "var(--text)" }}>{entries.length}</strong></span>
      <span>说话者: <strong style={{ color: "var(--text)" }}>{speakers.length}</strong></span>
      {totalDuration > 0 && (
        <span>总时长: <strong style={{ color: "var(--text)" }}>{(totalDuration / 1000).toFixed(1)}s</strong></span>
      )}
      {avgConfidence > 0 && (
        <span>平均置信度: <strong style={{ color: "var(--text)" }}>{(avgConfidence * 100).toFixed(0)}%</strong></span>
      )}
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

interface TranscriptPanelProps {
  threadId?: string | null;
}

export default function WorkspaceTranscriptPanel({ threadId }: TranscriptPanelProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchTranscripts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (threadId) params.set("threadId", threadId);
      const res = await fetch(`/api/v1/transcripts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.items ?? data.entries ?? data.transcripts ?? []);
      }
    } catch {
      setError("无法加载转录数据");
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    fetchTranscripts();
  }, [fetchTranscripts]);

  const filtered = searchQuery.trim()
    ? entries.filter(
        (e) =>
          e.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.speaker.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : entries;

  if (loading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
        加载转录数据...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--destructive)", fontSize: "12px" }}>
        {error}
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
          <span style={{ fontSize: "14px" }}>📝</span>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>转录记录</span>
          <span style={{ fontSize: "10px", color: "var(--muted)" }}>({entries.length})</span>
        </div>
        <button
          type="button"
          onClick={fetchTranscripts}
          style={{
            padding: "2px 8px",
            fontSize: "10px",
            background: "var(--accent-subtle)",
            color: "var(--accent)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius-sm, 4px)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          刷新
        </button>
      </div>

      {/* 统计信息 */}
      {entries.length > 0 && <TranscriptStats entries={entries} />}

      {/* 搜索 */}
      <SearchBar value={searchQuery} onChange={setSearchQuery} />

      {/* 转录列表 */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "24px",
              textAlign: "center",
              color: "var(--muted)",
              fontSize: "12px",
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>📝</div>
            <div>{searchQuery ? "未找到匹配的转录内容" : "暂无转录记录"}</div>
          </div>
        ) : (
          filtered.map((entry) => (
            <TranscriptEntryItem key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}