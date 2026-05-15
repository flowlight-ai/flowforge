"use client";

import { useState, useCallback, useMemo } from "react";
import { useSoloWebSocket } from "@/hooks/useSoloWebSocket";
import Link from "next/link";
import { ExecutionStream } from "./ExecutionStream";
import { DetailPanel } from "./DetailPanel";
import { SoloEditor } from "./SoloEditor";
import { SoloStatusBar } from "./SoloStatusBar";
import { SoloCreateDialog } from "./SoloCreateDialog";
import { useShellConfig } from "@/lib/shell-config";

export default function SoloLayout() {
  const [detailEntry, setDetailEntry] = useState<any>(null);
  const config = useShellConfig();

  const solo = useSoloWebSocket({
    onDraftUpdate: (content, isPartial) => {
      if (!isPartial) solo.updateEditor(content);
    },
  });

  const elapsed = useMemo(() => {
    if (!solo.startTime) return 0;
    return Math.floor((Date.now() - solo.startTime) / 1000);
  }, [solo.startTime, solo.phase]);

  const handleEntryClick = useCallback((entry: any) => {
    setDetailEntry((prev: any) =>
      prev?.id === entry.id ? null : entry
    );
  }, []);

  const closeDetail = useCallback(() => setDetailEntry(null), []);

  const showCreateDialog =
    solo.phase === "idle" ||
    solo.phase === "error" ||
    solo.phase === "completed";

  return (
    <>
      <div
        className={`solo-shell${detailEntry ? " detail-open" : ""}`}
      >
        <div className="solo-topbar">
          <span className="solo-brand">
            <Link
              href="/"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              {config.brandName}
            </Link>
            <span className="topbar-sep">/</span>
            <Link
              href="/solo"
              style={{
                color: "var(--text-strong)",
                textDecoration: "none",
              }}
            >
              Solo Studio
            </Link>
          </span>
          {solo.persona && (
            <>
              <span className="solo-sep">|</span>
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--muted-strong)",
                }}
              >
                {solo.persona}
              </span>
            </>
          )}
          {solo.taskId && (
            <>
              <span className="solo-sep">|</span>
              <span
                className="solo-task-id"
                title={solo.taskId}
              >
                {solo.taskId.slice(0, 8)}
              </span>
              <span className="solo-progress">
                {solo.stageProgress.current}/
                {solo.stageProgress.total}
              </span>
            </>
          )}
          <div className="solo-topbar-spacer" />
          {solo.phase !== "idle" && solo.phase !== "creating" && (
            <button
              onClick={solo.resetState}
              style={{
                border: "1px solid var(--border-strong)",
                borderRadius: "6px",
                background: "var(--bg-elevated)",
                color: "var(--muted)",
                padding: "4px 10px",
                cursor: "pointer",
                fontSize: "12px",
                marginRight: "8px",
              }}
              title="开始新任务"
            >
              + 新任务
            </button>
          )}
          <span className="solo-tokens">
            Token: {solo.tokenStats.total} · ¥
            {solo.tokenStats.cost.toFixed(2)}
          </span>
        </div>

        <ExecutionStream
          entries={solo.entries}
          phase={solo.phase}
          onEntryClick={handleEntryClick}
          selectedId={detailEntry?.id}
          startTime={solo.startTime}
        />

        <DetailPanel entry={detailEntry} onClose={closeDetail} />

        <SoloEditor
          content={solo.editorContent}
          onChange={solo.updateEditor}
          readOnly={
            solo.phase !== "waiting_review" &&
            solo.phase !== "completed"
          }
          wordCount={solo.editorContent.length}
        />

        <SoloStatusBar
          phase={solo.phase}
          onPause={solo.pause}
          onResume={solo.resume}
          onSkip={solo.skipCurrent}
          elapsed={elapsed}
        />
      </div>

      {showCreateDialog && (
        <SoloCreateDialog
          visible={showCreateDialog}
          loading={solo.phase === "creating"}
          onSubmit={solo.createTask}
        />
      )}
    </>
  );
}
