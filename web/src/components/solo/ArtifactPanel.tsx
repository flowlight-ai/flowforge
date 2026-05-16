"use client";

import { useState, useMemo } from "react";
import { StreamEntry } from "../../lib/solo-types";

type TabId = "draft" | "refs" | "stats";

interface Props {
  draftContent: string;
  editorContent: string;
  entries: StreamEntry[];
  stageProgress: { current: number; total: number };
  tokenStats: { total: number; cost: number };
  startTime: number | null;
  elapsedMs: number;
  onEditorChange: (content: string) => void;
  onEditorSave: () => void;
}

function renderSimpleMarkdown(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^\- (.+)$/gm, "<li>$1</li>")
    .replace(/^\* (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<p>${html}</p>`;
}

function formatTime(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}分${rem}秒`;
  const h = Math.floor(m / 60);
  return `${h}时${m % 60}分`;
}

const TOOL_ICONS: Record<string, string> = {
  helixrag: "🔍",
  helixrag_search: "🔍",
  web_search: "🌐",
  scraper: "📄",
  llm: "🤖",
  llm_client: "🤖",
  toutiao_publisher: "📰",
  toutiao: "📰",
  wechat_publisher: "💬",
  wechat: "💬",
};

const TOOL_LABELS: Record<string, string> = {
  helixrag: "素材检索",
  helixrag_search: "素材检索",
  web_search: "网页搜索",
  scraper: "网页抓取",
  llm: "LLM 调用",
  llm_client: "LLM 调用",
  toutiao_publisher: "头条发布",
  toutiao: "头条发布",
  wechat_publisher: "微信发布",
  wechat: "微信发布",
};

export function ArtifactPanel({
  draftContent,
  editorContent,
  entries,
  stageProgress,
  tokenStats,
  startTime,
  elapsedMs,
  onEditorChange,
  onEditorSave,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("draft");
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState(editorContent);
  const [expandedRef, setExpandedRef] = useState<string | null>(null);

  const wordCount = useMemo(() => {
    return draftContent.replace(/\s/g, "").length;
  }, [draftContent]);

  const refEntries = useMemo(() => {
    return entries.filter(
      (e) =>
        e.type === "tool-call" &&
        e.data?.result &&
        !e.data?.error
    );
  }, [entries]);

  const toolCallCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      if (e.type === "tool-call" && e.data?.tool_name) {
        const name = e.data.tool_name;
        counts[name] = (counts[name] || 0) + 1;
      }
    }
    return counts;
  }, [entries]);

  const totalToolCalls = useMemo(() => {
    return Object.values(toolCallCounts).reduce((a, b) => a + b, 0);
  }, [toolCallCounts]);

  const avgStageTime = useMemo(() => {
    if (stageProgress.current <= 0 || elapsedMs <= 0) return 0;
    return Math.floor(elapsedMs / stageProgress.current);
  }, [stageProgress.current, elapsedMs]);

  const handleCopy = () => {
    navigator.clipboard.writeText(draftContent);
  };

  const handleExport = () => {
    const blob = new Blob([draftContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "output.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleEditStart = () => {
    setLocalContent(editorContent);
    setEditing(true);
  };

  const handleEditSave = () => {
    onEditorChange(localContent);
    onEditorSave();
    setEditing(false);
  };

  const handleEditCancel = () => {
    setEditing(false);
  };

  const toggleRef = (id: string) => {
    setExpandedRef((prev) => (prev === id ? null : id));
  };

  return (
    <div className="artifact-panel">
      <div className="artifact-tabs">
        {(
          [
            ["draft", "文稿"],
            ["refs", "参考"],
            ["stats", "统计"],
          ] as [TabId, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={`artifact-tab${activeTab === id ? " active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="artifact-body">
        {activeTab === "draft" && (
          <div className="artifact-draft">
            <div className="artifact-draft-toolbar">
              <span className="artifact-draft-words">{wordCount} 字</span>
              <div className="artifact-draft-actions">
                {!editing && (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleEditStart}
                    >
                      编辑
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleCopy}
                    >
                      复制
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleExport}
                    >
                      导出 MD
                    </button>
                  </>
                )}
                {editing && (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleEditSave}
                    >
                      保存
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleEditCancel}
                    >
                      取消
                    </button>
                  </>
                )}
              </div>
            </div>

            {editing ? (
              <textarea
                className="artifact-draft-editor"
                value={localContent}
                onChange={(e) => setLocalContent(e.target.value)}
                placeholder="编辑文稿内容..."
              />
            ) : (
              <div
                className="artifact-draft-preview editor-preview"
                dangerouslySetInnerHTML={{
                  __html: renderSimpleMarkdown(draftContent || "暂无文稿内容"),
                }}
              />
            )}
          </div>
        )}

        {activeTab === "refs" && (
          <div className="artifact-refs">
            {refEntries.length === 0 && (
              <div className="artifact-empty">暂无参考素材</div>
            )}
            {refEntries.map((entry) => {
              const data = entry.data;
              const toolName = data.tool_name || "unknown";
              const icon = TOOL_ICONS[toolName] || "🔧";
              const label = TOOL_LABELS[toolName] || toolName;
              const isWebSearch =
                toolName === "web_search" || toolName === "scraper";
              const isExpanded = expandedRef === entry.id;

              const summary = data.result?.data?.results
                ? `${data.result.data.results.length} 条结果`
                : data.result?.results
                  ? `${data.result.results.length} 条结果`
                  : "完成";

              const results: any[] =
                data.result?.data?.results || data.result?.results || [];

              return (
                <div key={entry.id} className="artifact-ref-card">
                  <div
                    className="artifact-ref-header"
                    onClick={() => toggleRef(entry.id)}
                  >
                    <span className="artifact-ref-icon">{icon}</span>
                    <span className="artifact-ref-name">{label}</span>
                    <span className="artifact-ref-summary">{summary}</span>
                    <span className="artifact-ref-time">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span
                      className={`artifact-ref-expand${isExpanded ? " open" : ""}`}
                    >
                      ▾
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="artifact-ref-detail">
                      {isWebSearch && results.length > 0
                        ? results.map((r: any, i: number) => (
                            <div key={i} className="artifact-ref-link-card">
                              <div className="artifact-ref-link-title">
                                {r.title || r.name || `结果 ${i + 1}`}
                              </div>
                              {r.url && (
                                <a
                                  className="artifact-ref-link-url"
                                  href={r.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {r.url}
                                </a>
                              )}
                              {r.snippet && (
                                <div className="artifact-ref-link-snippet">
                                  {r.snippet}
                                </div>
                              )}
                            </div>
                          ))
                        : data.result && (
                            <pre className="artifact-ref-json">
                              {JSON.stringify(data.result, null, 2)}
                            </pre>
                          )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "stats" && (
          <div className="artifact-stats">
            <div className="artifact-stats-section">
              <div className="artifact-stats-label">Token 用量</div>
              <div className="artifact-stats-row">
                <span className="artifact-stats-key">总 Token</span>
                <span className="artifact-stats-val">
                  {tokenStats.total.toLocaleString()}
                </span>
              </div>
              <div className="artifact-stats-row">
                <span className="artifact-stats-key">预估费用</span>
                <span className="artifact-stats-val">
                  ¥{tokenStats.cost.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="artifact-stats-section">
              <div className="artifact-stats-label">阶段进度</div>
              <div className="artifact-progress-bar">
                <div
                  className="artifact-progress-fill"
                  style={{
                    width:
                      stageProgress.total > 0
                        ? `${(stageProgress.current / stageProgress.total) * 100}%`
                        : "0%",
                  }}
                />
              </div>
              <div className="artifact-stats-row">
                <span className="artifact-stats-key">当前阶段</span>
                <span className="artifact-stats-val">
                  {stageProgress.current} / {stageProgress.total}
                </span>
              </div>
            </div>

            <div className="artifact-stats-section">
              <div className="artifact-stats-label">工具调用</div>
              <div className="artifact-stats-row">
                <span className="artifact-stats-key">总调用次数</span>
                <span className="artifact-stats-val">{totalToolCalls}</span>
              </div>
              {Object.entries(toolCallCounts).map(([name, count]) => (
                <div key={name} className="artifact-stats-row">
                  <span className="artifact-stats-key">
                    {TOOL_LABELS[name] || name}
                  </span>
                  <span className="artifact-stats-val">{count}</span>
                </div>
              ))}
            </div>

            <div className="artifact-stats-section">
              <div className="artifact-stats-label">耗时</div>
              <div className="artifact-stats-row">
                <span className="artifact-stats-key">已用时间</span>
                <span className="artifact-stats-val">
                  {startTime ? formatDuration(elapsedMs) : "—"}
                </span>
              </div>
              <div className="artifact-stats-row">
                <span className="artifact-stats-key">平均每阶段</span>
                <span className="artifact-stats-val">
                  {avgStageTime > 0 ? formatDuration(avgStageTime) : "—"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
