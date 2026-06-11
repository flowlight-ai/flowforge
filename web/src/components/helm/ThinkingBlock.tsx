"use client";

interface Props {
  data: Record<string, any>;
  onClick: () => void;
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

export function ThinkingBlock({ data, onClick, timestamp }: Props) {
  const text = data.delta_text || "";
  const preview = text.slice(0, 150);

  return (
    <div className="thinking-block" onClick={onClick}>
      <div className="thinking-header">
        <span>🧠 思考过程</span>
        {data.agent_name && (
          <span className="thinking-agent">({data.agent_name})</span>
        )}
        {timestamp && (
          <span
            style={{ marginLeft: "auto", fontSize: "10px", opacity: 0.5 }}
          >
            {formatTime(timestamp)}
          </span>
        )}
      </div>
      <div className="thinking-preview">
        {preview}
        {text.length > 150 ? "..." : ""}
      </div>
      <div className="thinking-hint">点击查看完整思考 →</div>
    </div>
  );
}
