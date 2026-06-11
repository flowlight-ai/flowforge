"use client";

interface Props {
  entry: Record<string, any> | null;
  onClose: () => void;
}

function formatJSON(obj: any): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function DetailPanel({ entry, onClose }: Props) {
  if (!entry) return <div className="detail-panel" />;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className="detail-title">
          {entry.type === "tool-call" ? "🔧 工具调用详情" : "🧠 思考详情"}
        </span>
        <button className="detail-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="detail-body">
        {entry.data && (
          <pre className="detail-json">{formatJSON(entry.data)}</pre>
        )}
      </div>
    </div>
  );
}
