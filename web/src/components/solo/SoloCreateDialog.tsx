"use client";

import { useState } from "react";
import { useShellConfig } from "../../lib/shell-config";

interface Props {
  visible: boolean;
  loading: boolean;
  onSubmit: (intent: string, extra?: Record<string, any>) => void;
}

export function SoloCreateDialog({ visible, loading, onSubmit }: Props) {
  const config = useShellConfig();
  const [intent, setIntent] = useState("");
  const [mode, setMode] = useState<string>("solo");

  if (!visible) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim()) return;
    onSubmit(intent.trim(), { mode });
  };

  const canSubmit = loading || !intent.trim();

  return (
    <div className="solo-overlay">
      <div
        className="solo-dialog animate-rise"
        style={{ maxWidth: "560px", width: "90vw" }}
      >
        <div className="dialog-header">
          <span className="dialog-icon">🚀</span>
          <span className="dialog-title">Solo 执行</span>
        </div>

        <p className="dialog-desc">
          {config.brandName} 将全程自主执行任务，你可在右侧实时观察并随时干预。
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">执行意图</label>
            <textarea
              className="input"
              rows={4}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="描述你想执行的任务..."
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">执行模式</label>
            <div style={{ display: "flex", gap: "6px" }}>
              {["solo", "interactive"].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: "var(--radius-sm)",
                    border:
                      mode === m
                        ? `2px solid ${config.brandColor}`
                        : "1px solid var(--border-strong)",
                    background:
                      mode === m ? `${config.brandColor}1a` : "var(--bg)",
                    color:
                      mode === m ? config.brandColor : "var(--muted)",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  {m === "solo" ? "全自动" : "交互式"}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={canSubmit}
            style={{ width: "100%" }}
          >
            {loading ? "创建中..." : "开始执行 →"}
          </button>
        </form>
      </div>
    </div>
  );
}
