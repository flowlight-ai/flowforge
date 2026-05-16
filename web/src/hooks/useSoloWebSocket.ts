"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import {
  SoloWSEvent,
  StreamEntry,
  SoloTaskPhase,
  StreamEntryType,
  SoloWSOptions,
} from "../lib/solo-types";
import { useShellConfig } from "../lib/shell-config";

const MAX_RECONNECT = 10;
const EDITOR_THROTTLE_MS = 80;

let lastRAF = 0;

function getLSKey(brand: string): string {
  return `${brand}_solo_state`;
}

function saveState(
  brand: string,
  state: Record<string, any>
) {
  if (typeof window === "undefined") return;
  try {
    const existing = loadState(brand);
    const merged = { ...existing, ...state };
    localStorage.setItem(
      getLSKey(brand),
      JSON.stringify(merged)
    );
  } catch {}
}

function loadState(
  brand: string
): Record<string, any> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(getLSKey(brand));
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function clearState(brand: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getLSKey(brand));
  } catch {}
}

function eventToEntry(event: SoloWSEvent): StreamEntry {
  const typeMap: Record<string, StreamEntryType> = {
    "solo.stage.enter": "stage",
    "solo.tool.end": "tool-call",
    "solo.llm.reasoning": "thinking",
    "solo.llm.stream": "llm-stream",
    "solo.step.intermediate": "intermediate",
    "solo.draft.update": "draft-update",
    "solo.review.ready": "review",
    "solo.review.submitted": "review",
    "solo.gate.verdict": "gate",
    "solo.task.completed": "system",
    "solo.task.error": "system",
  };

  return {
    id: `e-${event.seq}`,
    type: typeMap[event.type] || "system",
    timestamp: event.timestamp,
    data: event.payload,
  };
}

export function useSoloWebSocket(opts?: SoloWSOptions) {
  const config = useShellConfig();
  const brand = config.brandName.toLowerCase();

  const WS_BASE =
    typeof window !== "undefined"
      ? config.wsBaseUrl ||
        `ws://${window.location.hostname}:8000`
      : "ws://localhost:8000";

  const restored =
    typeof window !== "undefined" ? loadState(brand) : {};

  const [phase, setPhase] = useState<SoloTaskPhase>(
    restored.phase || "idle"
  );
  const [taskId, setTaskId] = useState<string | null>(
    restored.taskId || null
  );
  const [entries, setEntries] = useState<StreamEntry[]>(
    restored.entries || []
  );
  const [draftContent, setDraftContent] = useState(
    restored.draftContent || ""
  );
  const [editorContent, setEditorContent] = useState(
    restored.editorContent || ""
  );
  const [stageProgress, setStageProgress] = useState(
    restored.stageProgress || { current: 0, total: 6 }
  );
  const [tokenStats, setTokenStats] = useState(
    restored.tokenStats || { total: 0, cost: 0 }
  );
  const [startTime, setStartTime] = useState<number | null>(
    restored.startTime || null
  );
  const [persona, setPersona] = useState(
    restored.persona || ""
  );
  const [intent, setIntent] = useState(
    restored.intent || ""
  );

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const lastSeq = useRef(
    restored.entries?.length
      ? (restored.entries as StreamEntry[]).length - 1
      : -1
  );
  const entriesRef = useRef<StreamEntry[]>(
    restored.entries || []
  );
  const editorContentRef = useRef(
    restored.editorContent || ""
  );
  const draftBuffer = useRef(restored.draftContent || "");
  const draftRAF = useRef(0);
  const optionsRef = useRef(opts);
  optionsRef.current = opts;

  const flushDraft = useCallback(() => {
    if (draftBuffer.current !== editorContentRef.current) {
      const content = draftBuffer.current;
      editorContentRef.current = content;
      setEditorContent(content);
      setDraftContent(content);
      saveState(brand, {
        draftContent: content,
        editorContent: content,
      });
      optionsRef.current?.onDraftUpdate?.(content, false);
    }
    draftRAF.current = 0;
  }, [brand]);

  const appendDraft = useCallback(
    (delta: string, isPartial: boolean) => {
      draftBuffer.current += delta;
      const now = performance.now();
      if (draftRAF.current) {
        cancelAnimationFrame(draftRAF.current);
      }
      if (now - lastRAF > EDITOR_THROTTLE_MS || !isPartial) {
        lastRAF = now;
        flushDraft();
      } else {
        draftRAF.current = requestAnimationFrame(flushDraft);
      }
    },
    [flushDraft]
  );

  const handleEvent = useCallback(
    (event: SoloWSEvent) => {
      switch (event.type) {
        case "solo.stage.enter":
          setStageProgress({
            current: event.payload.order,
            total: event.payload.total,
          });
          saveState(brand, {
            stageProgress: {
              current: event.payload.order,
              total: event.payload.total,
            },
          });
          optionsRef.current?.onStageEnter?.(
            event.payload.stage,
            event.payload.label,
            event.payload.order
          );
          break;
        case "solo.tool.start":
          optionsRef.current?.onToolCall?.("start", event.payload);
          break;
        case "solo.tool.end":
          optionsRef.current?.onToolCall?.("end", event.payload);
          break;
        case "solo.llm.reasoning":
          optionsRef.current?.onLLMReasoning?.(
            event.payload.agent_name,
            event.payload.delta_text
          );
          break;
        case "solo.llm.stream":
          optionsRef.current?.onLLMStream?.(
            event.payload.agent_name,
            event.payload.delta_text
          );
          break;
        case "solo.draft.update":
          appendDraft(
            event.payload.content || "",
            event.payload.is_partial ?? true
          );
          break;
        case "solo.review.ready":
          setPhase("waiting_review");
          saveState(brand, { phase: "waiting_review" });
          optionsRef.current?.onReviewReady?.(
            event.payload.draft_summary
          );
          break;
        case "solo.gate.verdict":
          optionsRef.current?.onGateVerdict?.(event.payload);
          break;
        case "solo.token.stats":
          setTokenStats({
            total: event.payload.total_tokens,
            cost: event.payload.estimated_cost,
          });
          saveState(brand, {
            tokenStats: {
              total: event.payload.total_tokens,
              cost: event.payload.estimated_cost,
            },
          });
          optionsRef.current?.onTokenStats?.(
            event.payload.total_tokens,
            event.payload.estimated_cost
          );
          break;
        case "solo.task.completed":
          setPhase("completed");
          saveState(brand, { phase: "completed" });
          optionsRef.current?.onCompleted?.(event.payload);
          break;
        case "solo.task.error":
          setPhase("error");
          saveState(brand, { phase: "error" });
          optionsRef.current?.onError?.(
            event.payload.step_name,
            event.payload.error_message
          );
          break;
        case "solo.task.paused":
          setPhase("paused");
          saveState(brand, { phase: "paused" });
          break;
        case "solo.task.resumed":
          setPhase("running");
          saveState(brand, { phase: "running" });
          break;
      }
    },
    [appendDraft, brand]
  );

  const persistEntries = useCallback(
    (newEntries: StreamEntry[]) => {
      saveState(brand, { entries: newEntries.slice(-500) });
    },
    [brand]
  );

  const connectWS = useCallback(
    (tid: string) => {
      setPhase("connecting");
      const ws = new WebSocket(`${WS_BASE}/ws/solo/${tid}`);

      ws.onopen = () => {
        reconnectCount.current = 0;
        setPhase("running");
        saveState(brand, { phase: "running", taskId: tid });
        setStartTime(Date.now());
        saveState(brand, { startTime: Date.now() });
        if (lastSeq.current > -1) {
          ws.send(
            JSON.stringify({
              type: "replay",
              from_seq: lastSeq.current + 1,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        const data: SoloWSEvent = JSON.parse(event.data);
        if ((data.type as string) === "pong") return;
        lastSeq.current = data.seq;
        const entry = eventToEntry(data);
        entriesRef.current = [...entriesRef.current, entry];
        setEntries([...entriesRef.current]);
        persistEntries(entriesRef.current);
        handleEvent(data);
      };

      ws.onclose = () => {
        if (reconnectCount.current < MAX_RECONNECT) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectCount.current),
            30000
          );
          reconnectCount.current++;
          setTimeout(() => connectWS(tid), delay);
        } else {
          setPhase("error");
          saveState(brand, { phase: "error" });
          optionsRef.current?.onError?.(
            "websocket",
            "连接丢失，请刷新页面"
          );
        }
      };

      wsRef.current = ws;
    },
    [WS_BASE, handleEvent, persistEntries, brand]
  );

  const disconnectWS = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => disconnectWS();
  }, [disconnectWS]);

  const createTask = useCallback(
    async (taskIntent: string, extra?: Record<string, any>) => {
      setPhase("creating");
      setPersona(extra?.persona || "");
      setIntent(taskIntent);
      entriesRef.current = [];
      setEntries([]);
      draftBuffer.current = "";
      editorContentRef.current = "";
      setEditorContent("");
      setDraftContent("");
      setTokenStats({ total: 0, cost: 0 });
      lastSeq.current = -1;
      clearState(brand);
      saveState(brand, { intent: taskIntent, ...extra });

      try {
        const r = await fetch("/api/v1/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: taskIntent,
            mode: "solo",
            interaction_mode: "solo",
            ...extra,
          }),
        });
        const data = await r.json();
        if (!r.ok) {
          setPhase("error");
          saveState(brand, { phase: "error" });
          optionsRef.current?.onError?.(
            "create",
            data.detail || "创建失败"
          );
          return;
        }
        const tid = data?.data?.task_id || data?.task_id || data?.id;
        if (!tid) {
          setPhase("error");
          saveState(brand, { phase: "error" });
          optionsRef.current?.onError?.("create", "未获取到 task_id");
          return;
        }
        setTaskId(tid);
        saveState(brand, { taskId: tid });
        connectWS(tid);
      } catch (e: any) {
        setPhase("error");
        saveState(brand, { phase: "error" });
        optionsRef.current?.onError?.("create", e.message);
      }
    },
    [connectWS, brand]
  );

  const resetState = useCallback(() => {
    clearState(brand);
    setPhase("idle");
    setTaskId(null);
    setEntries([]);
    entriesRef.current = [];
    setDraftContent("");
    setEditorContent("");
    editorContentRef.current = "";
    draftBuffer.current = "";
    setStageProgress({ current: 0, total: 6 });
    setTokenStats({ total: 0, cost: 0 });
    setStartTime(null);
    setPersona("");
    setIntent("");
    lastSeq.current = -1;
  }, [brand]);

  const restoreTask = useCallback(
    (tid: string, taskIntent: string, taskPersona: string, taskPhase: SoloTaskPhase) => {
      disconnectWS();
      setTaskId(tid);
      setIntent(taskIntent);
      setPersona(taskPersona);
      setPhase(taskPhase);
      entriesRef.current = [];
      setEntries([]);
      draftBuffer.current = "";
      editorContentRef.current = "";
      setEditorContent("");
      setDraftContent("");
      setTokenStats({ total: 0, cost: 0 });
      lastSeq.current = -1;
      saveState(brand, { taskId: tid, intent: taskIntent, persona: taskPersona, phase: taskPhase });
      if (taskPhase === "running" || taskPhase === "creating" || taskPhase === "connecting" || taskPhase === "waiting_review" || taskPhase === "paused") {
        connectWS(tid);
      }
    },
    [brand, connectWS, disconnectWS]
  );

  const pause = useCallback(() => {
    if (taskId)
      fetch(`/api/v1/tasks/${taskId}/pause`, { method: "POST" });
  }, [taskId]);

  const resume = useCallback(() => {
    if (taskId)
      fetch(`/api/v1/tasks/${taskId}/resume`, { method: "POST" });
  }, [taskId]);

  const skipCurrent = useCallback(() => {
    if (taskId)
      fetch(`/api/v1/tasks/${taskId}/skip`, { method: "POST" });
  }, [taskId]);

  const submitReview = useCallback(
    async (verdict: "pass" | "reject", feedback: string) => {
      if (!taskId) return;
      const r = await fetch(`/api/v1/tasks/${taskId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, feedback }),
      });
      return r.json();
    },
    [taskId]
  );

  const updateEditor = useCallback((content: string) => {
    editorContentRef.current = content;
    setEditorContent(content);
  }, []);

  return {
    phase,
    taskId,
    entries,
    draftContent,
    editorContent,
    stageProgress,
    tokenStats,
    startTime,
    persona,
    intent,
    createTask,
    resetState,
    restoreTask,
    updateEditor,
    pause,
    resume,
    skipCurrent,
    submitReview,
    connectWS,
    disconnectWS,
  };
}
