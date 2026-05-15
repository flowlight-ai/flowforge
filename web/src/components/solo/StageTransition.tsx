"use client";

interface Props {
  data: Record<string, any>;
  timestamp?: string;
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

export function StageTransition({ data, timestamp }: Props) {
  return (
    <div className="stage-transition">
      <span className="stage-marker">▶</span>
      <span className="stage-name">
        阶段 {data.order}：{data.label || data.stage}
      </span>
      {timestamp && (
        <span style={{ fontSize: "10px", opacity: 0.4, marginLeft: "6px" }}>
          {formatTime(timestamp)}
        </span>
      )}
      <span className="stage-progress">
        {data.order}/{data.total || 6}
      </span>
    </div>
  );
}
