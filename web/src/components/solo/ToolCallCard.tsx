"use client";

interface Props {
  data: Record<string, any>;
  onClick: () => void;
  timestamp?: string;
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
  shell_executor: "⌨",
  git_operations: "🔀",
  code_quality: "📐",
  security_scanner: "🔒",
  test_runner: "🧪",
  cicd_trigger: "🚀",
  monitoring: "📊",
};

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

export function ToolCallCard({ data, onClick, timestamp }: Props) {
  const icon = TOOL_ICONS[data.tool_name] || "🔧";
  const hasError = !!data.error;
  const durationStr = data.duration_ms ? `${data.duration_ms}ms` : "";

  const resultCount = data.result?.data?.results
    ? data.result.data.results.length
    : data.result?.results
      ? data.result.results.length
      : data.result
        ? Object.keys(data.result).filter(
            (k) => k !== "success" && k !== "error"
          ).length
        : 0;

  return (
    <div
      className={`tool-card${hasError ? " error" : ""}`}
      onClick={onClick}
    >
      <div className="tool-card-header">
        <span className="tool-icon">{icon}</span>
        <span className="tool-name">{data.tool_name}</span>
        {hasError && (
          <span className="tool-error-badge" title={data.error}>
            ⚠
          </span>
        )}
        {durationStr && <span className="tool-duration">{durationStr}</span>}
        {timestamp && (
          <span style={{ fontSize: "10px", opacity: 0.4 }}>
            {formatTime(timestamp)}
          </span>
        )}
      </div>
      {(data.params || data.result) && (
        <div className="tool-card-body">
          {data.params && (
            <div className="tool-summary">
              参数: {Object.keys(data.params).join(", ")}
            </div>
          )}
          {data.result && !hasError && (
            <div className="tool-summary">
              返回: {resultCount > 0 ? `${resultCount} 条结果` : "完成"}
            </div>
          )}
          {data.result && hasError && (
            <div
              className="tool-summary"
              style={{ color: "var(--danger)" }}
            >
              {data.error}
            </div>
          )}
        </div>
      )}
      <div className="tool-card-hint">点击查看详情 →</div>
    </div>
  );
}
