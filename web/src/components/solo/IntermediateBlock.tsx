"use client";

interface Props {
  data: Record<string, any>;
  timestamp?: string | number;
}

function formatTime(ts: string | number) {
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

export function IntermediateBlock({ data, timestamp }: Props) {
  const stepLabel =
    data.step_name === "topic" ? "📋 选题列表" : data.step_name;

  return (
    <div className="intermediate-block">
      <div className="intermediate-header">
        <span>{stepLabel}</span>
        {timestamp && (
          <span
            style={{ marginLeft: "auto", fontSize: "10px", opacity: 0.4 }}
          >
            {formatTime(timestamp)}
          </span>
        )}
      </div>
      {data.data?.topics && Array.isArray(data.data.topics) && (
        <div className="intermediate-list">
          {data.data.topics.slice(0, 8).map((t: any, i: number) => (
            <div key={i} className="intermediate-item">
              {typeof t === "string"
                ? t
                : t.title || t.topic || JSON.stringify(t)}
            </div>
          ))}
        </div>
      )}
      {data.data?.materials && (
        <div className="intermediate-summary">
          素材数量:{" "}
          {Array.isArray(data.data.materials)
            ? data.data.materials.length
            : 0}
        </div>
      )}
      {data.data?.content && typeof data.data.content === "string" && (
        <div className="intermediate-summary">
          内容长度: {data.data.content.length} 字
        </div>
      )}
      {data.data?.selected_topic && (
        <div
          className="intermediate-summary"
          style={{ fontWeight: 600, color: "var(--text-strong)" }}
        >
          选定选题:{" "}
          {typeof data.data.selected_topic === "string"
            ? data.data.selected_topic
            : data.data.selected_topic?.title || ""}
        </div>
      )}
    </div>
  );
}
