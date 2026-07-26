"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useShellConfig } from "../../lib/shell-config";
import { useHelmWebSocket } from "../../hooks/useHelmWebSocket";
import { HelmTaskPhase } from "../../lib/helm-types";

interface TaskHistoryItem {
  taskId: string;
  persona: string;
  phase: HelmTaskPhase;
  updatedAt: number;
}

const PERSONA_ICONS: Record<string, string> = {
  content: "📰",
  dev: "💻",
  education: "📚",
  life: "💝",
  novel: "📖",
  student: "🎓",
};

const PERSONA_LABELS: Record<string, string> = {
  content: "综合资讯",
  dev: "AI科技",
  education: "教育政策",
  life: "生活情感",
  novel: "小说娱乐",
  student: "K12教育",
};

const PERSONAS = [
  "content",
  "dev",
  "education",
  "life",
  "novel",
  "student",
] as const;

const PHASE_DOT_CLASS: Record<HelmTaskPhase, string> = {
  idle: "phase-dot-idle",
  creating: "phase-dot-creating",
  connecting: "phase-dot-connecting",
  running: "phase-dot-running",
  paused: "phase-dot-paused",
  waiting_review: "phase-dot-paused",
  completed: "phase-dot-completed",
  error: "phase-dot-error",
  rejected: "phase-dot-error",
  interrupted: "phase-dot-error",
};

const PHASE_LABEL: Record<HelmTaskPhase, string> = {
  idle: "空闲",
  creating: "创建中",
  connecting: "连接中",
  running: "执行中",
  paused: "已暂停",
  waiting_review: "待审核",
  completed: "已完成",
  error: "出错",
  rejected: "已拒绝",
  interrupted: "已中断",
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}时${m % 60}分`;
  if (m > 0) return `${m}分${s % 60}秒`;
  return `${s}秒`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function loadHistory(brand: string): TaskHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${brand}_helm_history`);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveHistory(brand: string, items: TaskHistoryItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${brand}_helm_history`,
      JSON.stringify(items.slice(0, 50))
    );
  } catch {}
}

export default function TaskSidebar() {
  const config = useShellConfig();
  const brand = config.brandName.toLowerCase();
  const helm = useHelmWebSocket();

  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setHistory(loadHistory(brand));
  }, [brand]);

  useEffect(() => {
    if (!helm.taskId || helm.phase === "idle") return;
    setHistory((prev) => {
      const filtered = prev.filter((h) => h.taskId !== helm.taskId);
      const next = [
        {
          taskId: helm.taskId!,
          persona: helm.persona,
          phase: helm.phase,
          updatedAt: Date.now(),
        },
        ...filtered,
      ].slice(0, 50);
      saveHistory(brand, next);
      return next;
    });
  }, [brand, helm.taskId, helm.phase, helm.persona]);

  useEffect(() => {
    if (helm.phase !== "running" && helm.phase !== "creating" && helm.phase !== "connecting") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [helm.phase]);

  const elapsed = useMemo(() => {
    if (!helm.startTime) return 0;
    return now - helm.startTime;
  }, [helm.startTime, now]);

  const hasActiveTask =
    helm.taskId && helm.phase !== "idle" && helm.phase !== "creating";

  return (
    <div className="task-sidebar">
      {hasActiveTask ? (
        <div className="ts-active">
          <div className="ts-section-label">当前任务</div>

          <div className="ts-task-id" title={helm.taskId!}>
            {helm.taskId!.slice(0, 8)}
          </div>

          {helm.persona && (
            <div className="ts-persona-badge">
              <span className="ts-persona-icon">
                {PERSONA_ICONS[helm.persona] || "✦"}
              </span>
              <span className="ts-persona-label">
                {PERSONA_LABELS[helm.persona] || helm.persona}
              </span>
            </div>
          )}

          <div className="ts-phase-row">
            <span className={`ts-phase-dot ${PHASE_DOT_CLASS[helm.phase]}`} />
            <span className="ts-phase-text">{PHASE_LABEL[helm.phase]}</span>
          </div>

          {helm.stageProgress.total > 0 && (
            <div className="ts-stage-progress">
              <span className="ts-stage-label">
                {helm.stageProgress.current}/{helm.stageProgress.total} 阶段
              </span>
              <div className="ts-stage-bar">
                <div
                  className="ts-stage-bar-fill"
                  style={{
                    width: `${(helm.stageProgress.current / helm.stageProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {elapsed > 0 && (
            <div className="ts-elapsed">{formatElapsed(elapsed)}</div>
          )}
        </div>
      ) : (
        <div className="ts-idle">
          <div className="ts-idle-brand">
            <div
              className="ts-idle-logo"
              style={{ background: config.brandColor }}
            >
              {config.brandShort}
            </div>
            <div className="ts-idle-title">{config.brandName}</div>
            <div className="ts-idle-subtitle">对话</div>
          </div>

          <div className="ts-idle-prompt">开始新任务</div>

          <div className="ts-persona-grid">
            {PERSONAS.map((p) => (
              <Link
                key={p}
                href="/helm"
                className="ts-persona-card"
                title={PERSONA_LABELS[p]}
              >
                <span className="ts-persona-card-icon">
                  {PERSONA_ICONS[p]}
                </span>
                <span className="ts-persona-card-label">
                  {PERSONA_LABELS[p]}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="ts-history">
        <div className="ts-section-header">
          <span className="ts-section-label">任务历史</span>
          <Link href="/helm" className="ts-new-btn">
            + 新建任务
          </Link>
        </div>

        {history.length === 0 ? (
          <div className="ts-history-empty">暂无历史任务</div>
        ) : (
          <div className="ts-history-list">
            {history.map((item) => (
              <Link
                key={item.taskId}
                href={`/helm/${item.taskId}`}
                className="ts-history-item"
              >
                <span className="ts-history-id">
                  {item.taskId.slice(0, 8)}
                </span>
                {item.persona && (
                  <span className="ts-history-persona">
                    {PERSONA_ICONS[item.persona] || "✦"}{" "}
                    {PERSONA_LABELS[item.persona] || item.persona}
                  </span>
                )}
                <span
                  className={`ts-history-pill ts-history-pill-${item.phase}`}
                >
                  {PHASE_LABEL[item.phase]}
                </span>
                <span className="ts-history-time">
                  {formatTime(item.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
