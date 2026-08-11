"use client";

/**
 * BootcampProgressBar — 灵智训练营进度条
 *
 * 参考 clowder-ai BootcampListModal.tsx 的 12 阶段进度展示
 * （packages/web/src/components/BootcampListModal.tsx:41-46）
 *
 * 在群聊界面顶部展示当前训练营阶段和进度百分比，
 * 并提供"推进阶段"按钮供用户手动推进（调试/跳过用）。
 */

import { useState, useCallback } from "react";
import {
  BootcampPhase,
  PHASE_ORDER,
  PHASE_LABELS,
  getPhaseProgress,
  getPhaseIndex,
} from "../../lib/bootcamp-types";

interface BootcampProgressBarProps {
  threadId: string;
  phase: BootcampPhase;
  /** 是否显示阶段推进按钮（默认 false，仅训练营引导者可见） */
  showAdvance?: boolean;
  onPhaseAdvanced?: (newPhase: BootcampPhase) => void;
}

export function BootcampProgressBar({
  threadId,
  phase,
  showAdvance = false,
  onPhaseAdvanced,
}: BootcampProgressBarProps) {
  const [advancing, setAdvancing] = useState(false);
  const progress = getPhaseProgress(phase);
  const currentIdx = getPhaseIndex(phase);

  /** 推进到下一阶段 */
  const advanceToNext = useCallback(async () => {
    const idx = PHASE_ORDER.indexOf(phase);
    if (idx === -1 || idx >= PHASE_ORDER.length - 1) return;

    const nextPhase = PHASE_ORDER[idx + 1];
    setAdvancing(true);
    try {
      const res = await fetch(`/api/v1/bootcamp/threads/${threadId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_phase: nextPhase }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("推进阶段失败:", err);
        return;
      }
      const data = await res.json();
      if (onPhaseAdvanced) {
        onPhaseAdvanced(data.current_phase as BootcampPhase);
      }
    } catch (e) {
      console.error("推进阶段异常:", e);
    } finally {
      setAdvancing(false);
    }
  }, [threadId, phase, onPhaseAdvanced]);

  return (
    <div
      style={{
        padding: "8px 12px",
        background: "var(--bg-elevated)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        fontSize: "12px",
      }}
    >
      <span style={{ fontSize: "14px" }}>🎓</span>
      <span style={{ color: "var(--accent)", fontWeight: 600, whiteSpace: "nowrap" }}>
        灵智训练营
      </span>
      <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
        第 {currentIdx}/{PHASE_ORDER.length} 阶段 · {PHASE_LABELS[phase]}
      </span>

      {/* 进度条 */}
      <div
        style={{
          flex: 1,
          height: "6px",
          background: "var(--bg)",
          borderRadius: "3px",
          overflow: "hidden",
          minWidth: "80px",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "var(--accent)",
            borderRadius: "3px",
            transition: "width 0.3s ease",
          }}
        />
      </div>

      <span style={{ color: "var(--muted)", fontSize: "11px", whiteSpace: "nowrap" }}>
        {progress}%
      </span>

      {/* 阶段推进按钮（仅 showAdvance 时显示） */}
      {showAdvance && phase !== "phase-11-farewell" && (
        <button
          onClick={advanceToNext}
          disabled={advancing}
          style={{
            padding: "3px 10px",
            background: advancing ? "var(--bg)" : "var(--accent)",
            color: advancing ? "var(--muted)" : "var(--accent-foreground, #fff)",
            border: "none",
            borderRadius: "4px",
            fontSize: "11px",
            cursor: advancing ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
          title="推进到下一阶段"
        >
          {advancing ? "推进中..." : "下一阶段 →"}
        </button>
      )}
    </div>
  );
}

export default BootcampProgressBar;
