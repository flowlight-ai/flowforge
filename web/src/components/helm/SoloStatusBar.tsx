"use client";

import { HelmTaskPhase } from "../../lib/helm-types";

interface Props {
  phase: HelmTaskPhase;
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
  elapsed?: number;
}

export function HelmStatusBar({
  phase,
  onPause,
  onResume,
  onSkip,
  elapsed,
}: Props) {
  if (phase === "idle" || phase === "creating" || phase === "connecting")
    return null;

  const canControl = phase === "running" || phase === "paused";
  const elapsedStr = elapsed
    ? `${Math.floor(elapsed / 60)}分${Math.floor(elapsed % 60)}秒`
    : "";

  return (
    <div className="helm-statusbar">
      <span className={`status-dot ${phase}`}>
        {phase === "running"
          ? "● 执行中"
          : phase === "paused"
            ? "⏸ 已暂停"
            : phase === "waiting_review"
              ? "⏸ 待审核"
              : phase === "completed"
                ? "✓ 已完成"
                : phase === "error"
                  ? "✗ 出错"
                  : "○ 就绪"}
      </span>
      {elapsedStr && (
        <span className="status-elapsed">{elapsedStr}</span>
      )}
      <div className="statusbar-actions">
        {phase === "running" && (
          <button className="btn btn-ghost btn-sm" onClick={onPause}>
            暂停
          </button>
        )}
        {phase === "paused" && (
          <button className="btn btn-ghost btn-sm" onClick={onResume}>
            继续
          </button>
        )}
        {(phase === "running" || phase === "paused") && (
          <button className="btn btn-ghost btn-sm" onClick={onSkip}>
            跳过当前
          </button>
        )}
        {!canControl && (
          <span
            className="status-hint"
            style={{ color: "var(--muted)", fontSize: "12px" }}
          >
            等待系统调度...
          </span>
        )}
      </div>
    </div>
  );
}
