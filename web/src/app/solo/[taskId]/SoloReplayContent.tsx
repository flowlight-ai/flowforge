"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StageTransition } from "@/components/helm/StageTransition";
import { ToolCallCard } from "@/components/helm/ToolCallCard";
import { ThinkingBlock } from "@/components/helm/ThinkingBlock";
import { HelmEditor } from "@/components/helm/HelmEditor";
import { HelmWSEvent, StreamEntry, StreamEntryType } from "@/lib/helm-types";

function eventToEntry(event: HelmWSEvent): StreamEntry {
  const typeMap: Record<string, StreamEntryType> = {
    "helm.stage.enter": "stage",
    "helm.tool.end": "tool-call",
    "helm.llm.reasoning": "thinking",
    "helm.step.intermediate": "intermediate",
    "helm.review.ready": "review",
    "helm.gate.verdict": "gate",
    "helm.task.completed": "system",
    "helm.task.error": "system",
  };
  return {
    id: `e-${event.seq}`,
    type: typeMap[event.type] || "system",
    timestamp: event.timestamp,
    data: event.payload,
  };
}

export default function HelmReplayContent() {
  const { taskId } = useParams();
  const [events, setEvents] = useState<HelmWSEvent[]>([]);
  const [finalDraft, setFinalDraft] = useState("");
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [playIndex, setPlayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    fetch(`/api/v1/tasks/${taskId}`)
      .then((r) => r.json())
      .then((data) => {
        const evts = data.helm_events || [];
        setEvents(evts);
        setFinalDraft(data.draft_content || "");
        setPlayIndex(evts.length ? 0 : -1);
        setEntries([...evts.slice(0, 1).map(eventToEntry)]);
      });
  }, [taskId]);

  useEffect(() => {
    if (!playing || playIndex >= events.length) {
      if (playIndex >= events.length && playing) setPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      setPlayIndex((i) => Math.min(i + 1, events.length));
    }, 180 / speed);
    return () => clearTimeout(timer);
  }, [playing, playIndex, speed, events.length]);

  useEffect(() => {
    setEntries([...events.slice(0, playIndex + 1).map(eventToEntry)]);
  }, [playIndex, events.length, events]);

  const handleSeek = (val: number) => {
    setPlaying(false);
    setPlayIndex(val);
  };

  const noop = () => {};

  return (
    <div className="helm-shell replay-mode">
      <div className="helm-topbar replay-topbar">
        <Link
          href="/helm"
          style={{ color: "var(--muted)", fontSize: "12px" }}
        >
          ← 返回
        </Link>
        <span
          style={{
            marginLeft: "12px",
            color: "var(--text-strong)",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          任务回放 · {taskId?.slice(0, 10)}
        </span>
      </div>

      <div className="execution-stream">
        {entries.map((entry) => (
          <div key={entry.id} className="stream-item">
            {entry.type === "stage" && (
              <StageTransition data={entry.data} />
            )}
            {entry.type === "tool-call" && (
              <ToolCallCard data={entry.data} onClick={noop} />
            )}
            {entry.type === "thinking" && (
              <ThinkingBlock data={entry.data} onClick={noop} />
            )}
          </div>
        ))}
      </div>

      <HelmEditor
        content={finalDraft}
        onChange={() => {}}
        readOnly
        wordCount={finalDraft.length}
      />

      <div className="replay-controls">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setPlaying(!playing)}
          disabled={playIndex >= events.length}
        >
          {playing ? "⏸ 暂停" : "▶ 播放"}
        </button>
        <input
          type="range"
          min={0}
          max={events.length}
          value={playIndex}
          onChange={(e) => handleSeek(+e.target.value)}
          style={{ flex: 1, maxWidth: "300px" }}
        />
        <span
          style={{
            fontSize: "11px",
            color: "var(--muted)",
            minWidth: "50px",
          }}
        >
          {playIndex}/{events.length}
        </span>
        <select
          value={speed}
          onChange={(e) => setSpeed(+e.target.value)}
          style={{
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "2px 8px",
            fontSize: "12px",
          }}
        >
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
          <option value={8}>8x</option>
        </select>
      </div>
    </div>
  );
}
